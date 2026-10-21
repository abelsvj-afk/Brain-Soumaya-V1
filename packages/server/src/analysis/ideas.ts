import { COGNITIVE_META, IDEA_PROMOTE_SUPPORT } from "@brain/shared";
import type { AppContext } from "../context.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { knn, getEmbedding, upsertEmbedding } from "../db/vec.js";
import { ftsUpsert } from "../db/fts.js";
import { cleanAliases } from "./cognitiveTokens.js";

/**
 * Ideas lifecycle (Cognitive Layer Phase 3, docs/COGNITIVE_LAYER.md). An `idea` is
 * a potential future — the one cognitive kind that is NOT durable. It has a real
 * arc:
 *
 *   • GROW    — as memories come to support it, its importance (→ mass → size +
 *               brightness) rises. A well-supported idea reads as a hot young star.
 *   • FADE    — if nothing reinforces it, it dims; a fully-ignored, unsupported idea
 *               eventually fades out of the galaxy entirely (it was never permanent).
 *   • MERGE   — two near-identical ideas collapse into the stronger one, its support
 *               redirected, so duplicates don't clutter your mind.
 *   • PROMOTE — a matured idea (enough support) can graduate into a GOAL: a durable,
 *               gravity-exerting anchor with progress. That's you committing to it.
 *
 * All deterministic + offline (no LLM). Runs each autonomy tick via `stepIdeas`;
 * promotion is user-triggered (`promoteIdeaToGoal`). Fading leans on the existing
 * celestial system — ideas aren't entropy-exempt, so lowering importance is all it
 * takes for them to visibly cool and shrink.
 */

const IDEA = COGNITIVE_META.idea;
const GOAL = COGNITIVE_META.goal;
/** Importance gained per supporting edge. */
const GROW_STEP = 0.06;
/** Ceiling so an idea never outshines a real goal without being promoted. */
const GROW_CAP = 0.78;
/** Floor an idea dims toward when ignored. */
const FADE_FLOOR = 0.12;
/** No tending for this long → it starts to dim. */
const FADE_STALE_DAYS = 14;
/** Dim applied per stale run. */
const FADE_STEP = 0.05;
/** Unsupported + untended this long → it fades out of the galaxy entirely. */
const FADE_ARCHIVE_DAYS = 30;
/** Cosine at/above which two ideas are "the same idea" and merge. */
const MERGE_SIM = 0.82;
/** Support count at which an idea is ripe to become a goal. Shared with the client
 *  (MindPanel.tsx's "ripe" indicator) via @brain/shared — one source of truth. */
export const PROMOTE_SUPPORT = IDEA_PROMOTE_SUPPORT;

/** How many memories support an idea (incoming `supports` edges). */
function supportCount(ctx: AppContext, spaceId: string, id: number): number {
  return (ctx.handle.sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM edges WHERE space_id = ? AND target = ? AND relationship = 'supports'`,
    )
    .get(spaceId, id) as { c: number }).c;
}

/** Days since an idea was last tended (falls back to creation). */
function daysSinceTended(ctx: AppContext, spaceId: string, id: number): number {
  const r = ctx.handle.sqlite
    .prepare(
      `SELECT julianday('now') - julianday(COALESCE(last_tended_at, created_at)) AS d
       FROM nodes WHERE id = ? AND space_id = ?`,
    )
    .get(id, spaceId) as { d: number } | undefined;
  return r ? r.d : 0;
}

export interface IdeasStep {
  grown: number;
  faded: number;
  merged: number;
}

/**
 * Advance every idea one lifecycle step: merge duplicates, grow the supported,
 * dim the stale, and archive the fully-faded. Free + offline. Returns the counts.
 */
export function stepIdeas(ctx: AppContext, spaceId: string): IdeasStep {
  const s = ctx.handle.sqlite;
  const repo = new NodesRepo(ctx.handle, spaceId);
  const step: IdeasStep = { grown: 0, faded: 0, merged: 0 };

  const ideas = () =>
    s
      .prepare(
        `SELECT id, importance FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND kind = 'idea' ORDER BY id ASC`,
      )
      .all(spaceId) as { id: number; importance: number | null }[];

  // ── MERGE near-identical ideas first (fewer ideas to grow/fade after). ──────
  const gone = new Set<number>();
  for (const idea of ideas()) {
    if (gone.has(idea.id)) continue;
    const emb = getEmbedding(s, idea.id);
    if (!emb) continue;
    const twins = knn(s, emb, 6, spaceId).filter((h) => h.nodeId !== idea.id && h.similarity >= MERGE_SIM);
    for (const t of twins) {
      if (gone.has(t.nodeId)) continue;
      const other = s
        .prepare(`SELECT id, kind FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
        .get(t.nodeId, spaceId) as { id: number; kind: string | null } | undefined;
      if (!other || other.kind !== "idea") continue;
      // Keep the better-supported idea; fold the other into it.
      const keepId = supportCount(ctx, spaceId, idea.id) >= supportCount(ctx, spaceId, other.id) ? idea.id : other.id;
      const dropId = keepId === idea.id ? other.id : idea.id;
      // Redirect the dropped idea's supporting memories onto the survivor.
      const backers = s
        .prepare(`SELECT source FROM edges WHERE space_id = ? AND target = ? AND relationship = 'supports'`)
        .all(spaceId, dropId) as { source: number }[];
      for (const b of backers) {
        const dup = s
          .prepare(`SELECT 1 FROM edges WHERE space_id = ? AND source = ? AND target = ? AND relationship = 'supports'`)
          .get(spaceId, b.source, keepId);
        if (!dup) {
          s.prepare(
            `INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, 'supports', 0.7)`,
          ).run(spaceId, b.source, keepId);
        }
      }
      repo.delete(dropId); // removes the dropped idea + its now-redundant edges
      gone.add(dropId);
      step.merged++;
      try {
        s.prepare(
          `INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'idea_merged', ?, ?)`,
        ).run(spaceId, "Two near-identical ideas merged into one.", JSON.stringify([keepId, dropId]));
      } catch {
        /* best-effort */
      }
      if (dropId === idea.id) break; // this idea is gone; stop pairing it
    }
  }

  // ── GROW / FADE / ARCHIVE the survivors. ────────────────────────────────────
  for (const idea of ideas()) {
    if (gone.has(idea.id)) continue;
    const supports = supportCount(ctx, spaceId, idea.id);
    const stale = daysSinceTended(ctx, spaceId, idea.id);

    // Fully ignored + unsupported for a long time → it fades out entirely.
    if (supports === 0 && stale > FADE_ARCHIVE_DAYS) {
      repo.delete(idea.id);
      step.faded++;
      try {
        s.prepare(
          `INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'idea_faded', ?, ?)`,
        ).run(spaceId, "An unreinforced idea faded away.", JSON.stringify([idea.id]));
      } catch {
        /* best-effort */
      }
      continue;
    }

    // Grow with support; dim if it's gone stale. Clamp to the idea band.
    let next = IDEA.importance + supports * GROW_STEP;
    if (stale > FADE_STALE_DAYS) next -= FADE_STEP;
    next = Math.max(FADE_FLOOR, Math.min(GROW_CAP, next));

    const prev = idea.importance ?? IDEA.importance;
    if (Math.abs(next - prev) > 0.001) {
      s.prepare(`UPDATE nodes SET importance = ? WHERE id = ? AND space_id = ?`).run(next, idea.id, spaceId);
      if (next > prev) step.grown++;
      else step.faded++;
    }
  }

  return step;
}

/** Minimum supporting memories before an idea can be considered for a split. */
const SPLIT_MIN_SUPPORT = 5;
/** Two seed memories this dissimilar (cosine ≤) mean the idea holds two threads. */
const SPLIT_SEED_SIM = 0.45;

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!;
  return dot; // embeddings are L2-normalized, so dot = cosine
}

/**
 * Idea SPLIT (Phase 3, deferred item): when an idea has accumulated enough support
 * that its backing memories clearly form TWO distinct threads, branch it into two
 * ideas so a blurred "maybe-project" resolves into its real parts. Branch names come
 * from `summarizeSector` (implemented on every provider, so this is offline-safe —
 * the heuristic names each cluster from its memories; a cloud LLM names them better).
 *
 * Conservative: at most one split per run, only genuine two-cluster ideas, and skip
 * when over the API budget so it never drives cloud spend from free autonomy. Returns
 * the new idea's id if a split happened, else null.
 */
export async function splitRipeIdea(ctx: AppContext, spaceId: string): Promise<number | null> {
  if (ctx.usage.overBudget()) return null; // never spend from free autonomy
  const s = ctx.handle.sqlite;
  const ideas = s
    .prepare(`SELECT id, label FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND kind = 'idea'`)
    .all(spaceId) as { id: number; label: string }[];

  for (const idea of ideas) {
    const backers = s
      .prepare(
        `SELECT n.id, n.label, n.content FROM edges e JOIN nodes n ON n.id = e.source
         WHERE e.space_id = ? AND e.target = ? AND e.relationship = 'supports' AND n.deleted_at IS NULL`,
      )
      .all(spaceId, idea.id) as { id: number; label: string; content: string }[];
    if (backers.length < SPLIT_MIN_SUPPORT) continue;

    const embs = new Map<number, Float32Array>();
    for (const b of backers) {
      const e = getEmbedding(s, b.id);
      if (e) embs.set(b.id, e);
    }
    const withEmb = backers.filter((b) => embs.has(b.id));
    if (withEmb.length < SPLIT_MIN_SUPPORT) continue;

    // Two seeds = the most dissimilar pair. If even they're similar, it's one thread.
    let seedA = withEmb[0]!;
    let seedB = withEmb[1]!;
    let worst = 2;
    for (let i = 0; i < withEmb.length; i++) {
      for (let j = i + 1; j < withEmb.length; j++) {
        const sim = cosine(embs.get(withEmb[i]!.id)!, embs.get(withEmb[j]!.id)!);
        if (sim < worst) {
          worst = sim;
          seedA = withEmb[i]!;
          seedB = withEmb[j]!;
        }
      }
    }
    if (worst > SPLIT_SEED_SIM) continue; // one coherent idea, not two

    // Assign each backer to its nearer seed.
    const groupA: typeof withEmb = [];
    const groupB: typeof withEmb = [];
    for (const b of withEmb) {
      const e = embs.get(b.id)!;
      (cosine(e, embs.get(seedA.id)!) >= cosine(e, embs.get(seedB.id)!) ? groupA : groupB).push(b);
    }
    if (groupA.length < 2 || groupB.length < 2) continue; // not a clean two-way split

    // Name each branch (offline-safe: heuristic summarizes from the cluster's labels).
    const nameA = (await ctx.llm.summarizeSector(groupA.map((m) => ({ label: m.label, content: m.content })))).slice(0, 80);
    const nameB = (await ctx.llm.summarizeSector(groupB.map((m) => ({ label: m.label, content: m.content })))).slice(0, 80);

    // Keep the original idea as branch A (renamed); create a new idea for branch B and
    // move B's supporting edges onto it.
    s.prepare(`UPDATE nodes SET label = ? WHERE id = ? AND space_id = ?`).run(nameA || idea.label, idea.id, spaceId);
    const repo = new NodesRepo(ctx.handle, spaceId);
    const meta = COGNITIVE_META.idea;
    const emb = await ctx.embeddings.embed(nameB || `${idea.label} (branch)`);
    const branch = repo.create(
      { label: nameB || `${idea.label} (branch)`, type: "concept", kind: "idea", content: nameB || idea.label, importance: meta.importance, color: meta.color, origin: "agent" },
      emb,
    );
    const edges = new EdgesRepo(ctx.handle, spaceId);
    for (const b of groupB) {
      s.prepare(`DELETE FROM edges WHERE space_id = ? AND source = ? AND target = ? AND relationship = 'supports'`).run(spaceId, b.id, idea.id);
      if (!edges.exists(b.id, branch.id)) {
        edges.create({ source: b.id, target: branch.id, relationship: "supports", weight: 0.7 });
      }
    }
    try {
      s.prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'idea_split', ?, ?)`).run(
        spaceId,
        `An idea split into two threads: "${nameA || idea.label}" and "${nameB}".`,
        JSON.stringify([idea.id, branch.id]),
      );
    } catch {
      /* best-effort */
    }
    return branch.id; // one split per run
  }
  return null;
}

/**
 * USER-TRIGGERED idea split / merge (IM-136, docs/COGNITIVE_LAYER.md Phase 3).
 * The autonomy loop above already grows/fades ideas and merges/splits them on
 * its own judgement; these are the MANUAL counterparts the Mind tab drives —
 * the user decides, so there is no similarity/budget gate, and the semantics
 * are deliberately conservative and least-destructive:
 *
 * SPLIT — the original idea keeps its label, content, and identity. A NEW idea
 * is created for the branch the user names. Supporting memories are partitioned
 * by embedding nearness: a backer moves to the new branch only when it is
 * strictly nearer the new branch's embedding than the original's; backers with
 * no embedding stay with the original. Nothing is deleted and no support is
 * lost — the union of both ideas' backers equals the original's.
 *
 * MERGE — the survivor (keepId, chosen by the user) absorbs the other idea:
 * every edge touching the dropped idea is re-pointed at the survivor (same
 * relationship + weight; an exact duplicate is skipped, never doubled), the
 * dropped idea's content is appended to the survivor's when it isn't already
 * there, and the dropped idea's LABEL is kept on the survivor as an alias (plus
 * the union of both alias lists) so the folded idea stays discoverable by its
 * old name. The dropped idea itself is SOFT-deleted (deleted_at + merged_into,
 * the recoverable NodesRepo path) — never hard-deleted. Edges BETWEEN the pair,
 * self-loops, and duplicate leftovers touching the dropped idea are removed as
 * subsumed by the merge. The survivor keeps its own progress/importance.
 */
export async function splitIdeaManual(
  ctx: AppContext,
  spaceId: string,
  id: number,
  opts: { newLabel: string; content?: string },
): Promise<{ newId: number; moved: number } | null> {
  const s = ctx.handle.sqlite;
  const orig = s
    .prepare(`SELECT label, content FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL AND kind = 'idea'`)
    .get(id, spaceId) as { label: string; content: string } | undefined;
  if (!orig) return null;
  const newLabel = opts.newLabel.trim().slice(0, 200);
  if (!newLabel) return null;
  // The branch inherits the original's content unless the user wrote its own —
  // splitting a thought shouldn't silently discard what the thought said.
  const newContent = (opts.content?.trim() ? opts.content : orig.content).slice(0, 4000);

  const repo = new NodesRepo(ctx.handle, spaceId);
  const meta = COGNITIVE_META.idea;
  const embB = await ctx.embeddings.embed(`${newLabel}. ${newContent}`);
  const branch = repo.create(
    { label: newLabel, type: "concept", kind: "idea", content: newContent || newLabel, importance: meta.importance, color: meta.color, origin: "user" },
    embB,
  );

  // Partition the supporting memories by nearness to each branch's embedding.
  const embA = getEmbedding(s, id);
  const backers = s
    .prepare(`SELECT source, weight FROM edges WHERE space_id = ? AND target = ? AND relationship = 'supports'`)
    .all(spaceId, id) as { source: number; weight: number }[];
  const edges = new EdgesRepo(ctx.handle, spaceId);
  let moved = 0;
  if (embA) {
    for (const b of backers) {
      const be = getEmbedding(s, b.source);
      if (!be) continue; // no embedding → stays with the original (nothing lost)
      if (cosine(be, embB) <= cosine(be, embA)) continue; // nearer (or tied) → stays
      s.prepare(`DELETE FROM edges WHERE space_id = ? AND source = ? AND target = ? AND relationship = 'supports'`).run(spaceId, b.source, id);
      if (!edges.exists(b.source, branch.id)) {
        s.prepare(`INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, 'supports', ?)`).run(spaceId, b.source, branch.id, b.weight);
      }
      moved++;
    }
  }
  try {
    s.prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'idea_split_manual', ?, ?)`).run(
      spaceId,
      `You split "${orig.label}" — "${newLabel}" branched off with ${moved} supporting memor${moved === 1 ? "y" : "ies"}.`,
      JSON.stringify([id, branch.id]),
    );
  } catch {
    /* best-effort */
  }
  return { newId: branch.id, moved };
}

/** User-triggered merge of two ideas: dropId folds into keepId. See block above. */
export async function mergeIdeasManual(
  ctx: AppContext,
  spaceId: string,
  keepId: number,
  dropId: number,
): Promise<boolean> {
  if (keepId === dropId) return false;
  const s = ctx.handle.sqlite;
  const read = (nid: number) =>
    s
      .prepare(`SELECT label, content, aliases FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL AND kind = 'idea'`)
      .get(nid, spaceId) as { label: string; content: string; aliases: string | null } | undefined;
  const keep = read(keepId);
  const drop = read(dropId);
  if (!keep || !drop) return false;

  const parseAliases = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
      const p: unknown = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  };
  // The folded idea's label stays discoverable as an alias on the survivor.
  const mergedAliases = cleanAliases([...parseAliases(keep.aliases), ...parseAliases(drop.aliases), drop.label]);
  const mergedContent =
    drop.content && drop.content !== keep.content && !keep.content.includes(drop.content)
      ? `${keep.content}\n\n${drop.content}`.slice(0, 4000)
      : keep.content;

  const tx = s.transaction(() => {
    // Union every edge touching the dropped idea onto the survivor.
    const touching = s
      .prepare(`SELECT source, target, relationship, weight FROM edges WHERE space_id = ? AND (source = ? OR target = ?)`)
      .all(spaceId, dropId, dropId) as { source: number; target: number; relationship: string; weight: number }[];
    const existsEdge = s.prepare(
      `SELECT 1 FROM edges WHERE space_id = ? AND source = ? AND target = ? AND relationship = ?`,
    );
    const insertEdge = s.prepare(
      `INSERT INTO edges (space_id, source, target, relationship, weight) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const e of touching) {
      const other = e.source === dropId ? e.target : e.source;
      if (other === keepId || other === dropId) continue; // pair/self edges are subsumed
      const src = e.source === dropId ? keepId : other;
      const tgt = e.target === dropId ? keepId : other;
      if (src === tgt) continue;
      if (existsEdge.get(spaceId, src, tgt, e.relationship)) continue; // never double an edge
      insertEdge.run(spaceId, src, tgt, e.relationship, e.weight);
    }
    // Whatever still touches the dropped idea is a duplicate of an edge the
    // survivor already holds (or the pair's own edge) — subsumed, so removed.
    s.prepare(`DELETE FROM edges WHERE space_id = ? AND (source = ? OR target = ?)`).run(spaceId, dropId, dropId);
    s.prepare(`UPDATE nodes SET content = ?, aliases = ? WHERE id = ? AND space_id = ?`).run(
      mergedContent,
      mergedAliases ? JSON.stringify(mergedAliases) : null,
      keepId,
      spaceId,
    );
  });
  tx();

  // Refresh the survivor's search/vector presence for its grown content, exactly
  // like updateCognitive does after an edit (no gravity re-link — the union above
  // already placed every link deliberately).
  const emb = await ctx.embeddings.embed(`${keep.label}. ${mergedContent}`);
  upsertEmbedding(s, keepId, emb);
  ftsUpsert(s, keepId, keep.label, mergedContent);
  new NodesRepo(ctx.handle, spaceId).softDelete(dropId, keepId);
  try {
    s.prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'idea_merged_manual', ?, ?)`).run(
      spaceId,
      `You merged "${drop.label}" into "${keep.label}" — links and evidence were unioned, nothing was deleted.`,
      JSON.stringify([keepId, dropId]),
    );
  } catch {
    /* best-effort */
  }
  return true;
}

/** Ids of ideas ripe to become goals (enough support), for a nudge / UI hint. */
export function ripeIdeaIds(ctx: AppContext, spaceId: string): number[] {
  const rows = ctx.handle.sqlite
    .prepare(
      `SELECT n.id AS id,
         (SELECT COUNT(*) FROM edges e WHERE e.space_id = n.space_id AND e.target = n.id AND e.relationship = 'supports') AS sup
       FROM nodes n WHERE n.space_id = ? AND n.deleted_at IS NULL AND n.kind = 'idea'`,
    )
    .all(spaceId) as { id: number; sup: number }[];
  return rows.filter((r) => r.sup >= PROMOTE_SUPPORT).map((r) => r.id);
}

/**
 * Promote an idea into a GOAL — committing to it. The node keeps its identity,
 * label, content, edges and supporting memories, but becomes a durable,
 * gravity-exerting anchor with progress. Returns false if the id isn't an idea.
 */
export function promoteIdeaToGoal(ctx: AppContext, spaceId: string, id: number): boolean {
  const s = ctx.handle.sqlite;
  const row = s
    .prepare(`SELECT kind FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
    .get(id, spaceId) as { kind: string | null } | undefined;
  if (!row || row.kind !== "idea") return false;
  s.prepare(
    `UPDATE nodes SET kind = 'goal', importance = ?, color = ?, progress = 0 WHERE id = ? AND space_id = ?`,
  ).run(GOAL.importance, GOAL.color, id, spaceId);
  new NodesRepo(ctx.handle, spaceId).tend(id);
  try {
    s.prepare(
      `INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'idea_promoted', ?, ?)`,
    ).run(spaceId, "An idea matured into a goal you committed to.", JSON.stringify([id]));
  } catch {
    /* best-effort */
  }
  return true;
}
