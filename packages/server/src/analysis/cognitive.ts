import { COGNITIVE_META, COGNITIVE_KINDS, skillTier, type CognitiveKind } from "@brain/shared";
import type { AppContext } from "../context.js";
import type { DbHandle } from "../db/client.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { knn, getEmbedding, upsertEmbedding } from "../db/vec.js";
import { ftsUpsert } from "../db/fts.js";
import { isRejected, recordRejection } from "./rejections.js";
import { buffsForSpace, applyGrowthMultiplier } from "../relics/buffs.js";
// Pure token / name-matching helpers live in cognitiveTokens.ts (Post-MVP D4). Import
// what this module uses internally; re-export the public ones so people/candidates/
// identity's `import … from "./cognitive.js"` are unchanged.
import { NAME_ONLY_KINDS, anchorMatchTokens, cleanAliases, isCognitiveKind, mentions } from "./cognitiveTokens.js";
export { labelTokens, NAME_ONLY_KINDS, mentions } from "./cognitiveTokens.js";

/**
 * The cognitive layer (docs/COGNITIVE_LAYER.md). Cognitive objects are `nodes`
 * rows with a CognitiveKind — the same proven pattern as `moc`/`belief`. Their
 * colour/label/size/durability come from the single-source COGNITIVE_META map so
 * the galaxy render, the Legend, and the Mind panel can never drift.
 *
 * The signature dynamic — "memories drift toward the goal they support" — needs
 * NO orbit rewrite: the orbit system already parents each body to its heaviest
 * connected neighbour, so a HEAVY cognitive anchor (high importance) + `supports`
 * edges makes its memories orbit it. `linkCognitiveAnchor` grows those edges by
 * BOTH a literal name/keyword match (reliable for people + named things — a bare
 * name embeds too weakly for pure vector search to catch) AND a semantic knn pass
 * (for related-but-not-named memories). Linking runs IMMEDIATELY on create/edit so
 * connections appear at once, and again periodically via `applyCognitiveGravity`.
 */

/**
 * Cosine floor for the SEMANTIC pass. Raised from 0.55 (too loose — it linked a
 * person to any vaguely-similar note) to 0.75, matching the strict bar real
 * memories link at. Better to miss a subtle link than to invent a false one.
 */
const GRAVITY_THRESHOLD = 0.75;
/** Max new supports edges per anchor per run, split by match type. */
const MAX_SEMANTIC = 3;
const MAX_KEYWORD = 8;
/** Hard ceiling on how many memories a single anchor may auto-gather in total, so a
 *  common name can't slowly accrete dozens of links across many autonomy runs. */
const MAX_ANCHOR_LINKS = 12;

/**
 * Words too common to be a reliable NAME/keyword match. A person called "Will",
 * "Mark", "May", "Grace", "Hope" must NOT link to every memory containing that
 * everyday word — that's what produced 20-30 bogus connections to a person. We drop
 * these as single-word match tokens (multi-word names like "Will Smith" still match as
 * a phrase). Better to miss a link on a common-word name than invent dozens.
 */

/** Create a cognitive object (offline-safe) and immediately link its memories. */
export async function createCognitive(
  ctx: AppContext,
  spaceId: string,
  kind: CognitiveKind,
  label: string,
  content: string,
  opts: { date?: string; aliases?: string[] } = {},
): Promise<number> {
  const meta = COGNITIVE_META[kind];
  const repo = new NodesRepo(ctx.handle, spaceId);
  const emb = await ctx.embeddings.embed(`${label}. ${content}`);
  // Cognitive objects use `type:"concept"` (abstract) but a cognitive `kind`.
  // A future_event carries its date in `remind_at` (drives the timeline + roll-past).
  // A life_vision may also carry an optional target date in the same column — never
  // a reminder for this kind (C2.1-locked); the two consumer-exclusion audits already
  // in place (reminder.ts/dailyDigest.ts/awayDigest.ts/dueReminders.ts) cover it
  // regardless of whether it was set at creation or later via updateCognitive's patch.
  const node = repo.create(
    {
      label: label.slice(0, 200),
      type: "concept",
      kind,
      content: content.slice(0, 4000) || label,
      importance: meta.importance,
      color: meta.color,
      origin: "user",
      progress: meta.hasProgress ? 0 : undefined,
      aliases: cleanAliases(opts.aliases),
      remindAt: kind === "future_event" || kind === "life_vision" ? opts.date : undefined,
    },
    emb,
  );
  // Link right away so related memories appear under it the moment it's created.
  try {
    linkCognitiveAnchor(ctx, spaceId, node.id, node.label, emb);
  } catch {
    /* best-effort; the autonomy sweep will retry */
  }
  return node.id;
}

/** Edit a cognitive object's label/content: re-embed + re-index + re-link. */
export async function updateCognitive(
  ctx: AppContext,
  spaceId: string,
  id: number,
  patch: { label?: string; content?: string; aliases?: string[]; date?: string | null },
): Promise<boolean> {
  const s = ctx.handle.sqlite;
  const row = s
    .prepare(`SELECT label, content, kind FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
    .get(id, spaceId) as { label: string; content: string; kind: string | null } | undefined;
  if (!row || !isCognitiveKind(row.kind)) return false; // only cognitive nodes are editable here
  const label = (patch.label ?? row.label).slice(0, 200);
  const content = (patch.content ?? row.content).slice(0, 4000) || label;
  if (patch.aliases !== undefined) {
    s.prepare(`UPDATE nodes SET aliases = ? WHERE id = ? AND space_id = ?`).run(
      cleanAliases(patch.aliases) ? JSON.stringify(cleanAliases(patch.aliases)) : null,
      id,
      spaceId,
    );
  }
  // Life Vision target date (docs/specs/life-vision.md, C2.1-locked): only "life_vision"
  // may have its remind_at updated post-creation here — future_event's date stays
  // creation-time-only (unchanged), so this never touches its roll-past behavior.
  if (patch.date !== undefined && row.kind === "life_vision") {
    s.prepare(`UPDATE nodes SET remind_at = ? WHERE id = ? AND space_id = ?`).run(patch.date, id, spaceId);
  }
  s.prepare(`UPDATE nodes SET label = ?, content = ? WHERE id = ? AND space_id = ?`).run(label, content, id, spaceId);
  const emb = await ctx.embeddings.embed(`${label}. ${content}`);
  upsertEmbedding(s, id, emb);
  ftsUpsert(s, id, label, content);
  new NodesRepo(ctx.handle, spaceId).tend(id);
  try {
    linkCognitiveAnchor(ctx, spaceId, id, label, emb);
  } catch {
    /* best-effort */
  }
  return true;
}

export interface CognitiveItem {
  id: number;
  kind: CognitiveKind;
  label: string;
  content: string;
  progress: number | null;
  /** Set once a goal actually finished (never cleared). Always null for other kinds. */
  completedAt: string | null;
  degree: number;
  /**
   * Batch L (MIN-05, REG-136) — incoming `supports` edges: the count the
   * "Ripe" label is DEFINED on (the server's ripeIdeaIds counts exactly
   * this). `degree` counts every edge touching the node, either direction,
   * any relationship — applying the shared IDEA_PROMOTE_SUPPORT threshold
   * to it certified ideas ripe that no memory supports.
   */
  supportCount: number;
  aliases: string[];
  createdAt: string;
  /** Life Vision's target date (docs/specs/life-vision.md) — reminder semantics for
   *  every other kind, but never fires anything for kind "life_vision" (C2.1-locked). */
  remindAt: string | null;
}

/** List cognitive objects, optionally filtered by kind (newest first). */
export function listCognitive(
  ctx: AppContext,
  spaceId: string,
  kind?: CognitiveKind,
): CognitiveItem[] {
  const kinds = kind ? [kind] : (Object.keys(COGNITIVE_META) as CognitiveKind[]);
  const placeholders = kinds.map(() => "?").join(",");
  // Degree (count of this space's edges touching the node, either direction) is
  // computed as ONE grouped aggregation over edge endpoints, joined onto the
  // page — never a correlated per-row COUNT(*). The correlated form could not
  // drive the source/target indexes through its OR, so SQLite scanned EVERY
  // edge in the space for EVERY returned row (measured: ~0.45s at 25k edges,
  // ~1.9s at 100k — see gate-run/cogperf-record.md). The aggregation is
  // restricted to the page's own nodes (the CTE), so it groups only edges that
  // touch a returned row instead of every endpoint in the space. The UNION
  // (not UNION ALL) of (endpoint, edge id) pairs keeps a self-loop counting
  // exactly once, matching the old OR-count semantics edge-for-edge.
  const rows = ctx.handle.sqlite
    .prepare(
      `WITH page AS (
         SELECT n.id, n.kind, n.label, n.content, n.progress, n.completed_at AS completedAt, n.aliases, n.created_at AS createdAt,
           n.remind_at AS remindAt
         FROM nodes n
         WHERE n.space_id = ? AND n.deleted_at IS NULL AND n.kind IN (${placeholders})
         ORDER BY n.id DESC LIMIT 100
       )
       SELECT p.id, p.kind, p.label, p.content, p.progress, p.completedAt, p.aliases, p.createdAt,
         p.remindAt, COALESCE(d.degree, 0) AS degree, COALESCE(s.supports, 0) AS supportCount
       FROM page p
       LEFT JOIN (
         SELECT endpoint AS node_id, COUNT(*) AS degree
         FROM (
           SELECT source AS endpoint, id AS edge_id FROM edges
           WHERE space_id = ? AND source IN (SELECT id FROM page)
           UNION
           SELECT target AS endpoint, id AS edge_id FROM edges
           WHERE space_id = ? AND target IN (SELECT id FROM page)
         )
         GROUP BY endpoint
       ) d ON d.node_id = p.id
       LEFT JOIN (
         SELECT target AS node_id, COUNT(*) AS supports
         FROM edges
         WHERE space_id = ? AND target IN (SELECT id FROM page) AND relationship = 'supports'
         GROUP BY target
       ) s ON s.node_id = p.id
       ORDER BY p.id DESC`,
    )
    .all(spaceId, ...kinds, spaceId, spaceId, spaceId) as (Omit<CognitiveItem, "kind" | "aliases"> & { kind: string; aliases: string | null })[];
  return rows.map((r) => {
    let aliases: string[] = [];
    try {
      if (r.aliases) {
        const parsed: unknown = JSON.parse(r.aliases);
        // The column is meant to hold a JSON array, but a legacy/double-encoded row
        // can hold any valid JSON — a bare string, a number, an object. Trusting the
        // parse result's type shipped a bare string to the client, whose `.join()`
        // on the Mind panel then threw mid-render and unmounted the whole app.
        // Coerce exactly like parseTags (nodes.repo.ts): only a real array is kept,
        // its elements mapped through String; anything else degrades to [].
        if (Array.isArray(parsed)) aliases = parsed.map(String);
      }
    } catch {
      /* ignore */
    }
    return { ...r, kind: r.kind as CognitiveKind, aliases };
  });
}

/**
 * Batch L (MIN-06, REG-137) — the TRUE total of cognitive objects matching
 * the filter, independent of listCognitive's 100-row page. The list read
 * truncates silently at 100; without this the tab presents the returned
 * count as the mapped count and older items vanish from search. Same kind
 * filter as listCognitive so the route's `{ items, total }` always agree.
 */
export function countCognitive(ctx: AppContext, spaceId: string, kind?: CognitiveKind): number {
  const kinds = kind ? [kind] : (Object.keys(COGNITIVE_META) as CognitiveKind[]);
  const placeholders = kinds.map(() => "?").join(",");
  const row = ctx.handle.sqlite
    .prepare(
      `SELECT COUNT(*) AS n FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND kind IN (${placeholders})`,
    )
    .get(spaceId, ...kinds) as { n: number };
  return row.n;
}

/**
 * Aggregated, deterministic summary of the Mind tab's cognitive objects OTHER than
 * people — goals, ideas, skills, identity, mental models, intentions, future events,
 * motivations. Grouped by kind (matching how the Mind tab itself renders them), with
 * progress% (and skill tier) for the kinds that track it. Same "null when there's
 * nothing to say" contract as `financialSnapshotText`/`peopleSnapshotText` (people get
 * their own richer interaction/tone treatment in analysis/people.ts — this covers
 * everything else the Mind tab tracks, since it's more than just tracked people).
 *
 * Takes a raw `DbHandle` (not `AppContext`) — matching `financialSnapshotText`/
 * `peopleSnapshotText`'s own signatures, since all three are called from `chat()`,
 * which only has a handle. `listCognitive` only ever reads `ctx.handle.sqlite`
 * internally, so a minimal shim is safe here.
 */
export function cognitiveSnapshotText(handle: DbHandle, spaceId: string): string | null {
  const items = listCognitive({ handle } as AppContext, spaceId).filter((it) => it.kind !== "person_entity");
  if (items.length === 0) return null;

  const byKind = new Map<CognitiveKind, CognitiveItem[]>();
  for (const it of items) {
    if (!byKind.has(it.kind)) byKind.set(it.kind, []);
    byKind.get(it.kind)!.push(it);
  }

  const lines: string[] = [];
  for (const kind of COGNITIVE_KINDS) {
    const group = byKind.get(kind);
    if (!group || group.length === 0) continue;
    const meta = COGNITIVE_META[kind];
    const parts = group.slice(0, 10).map((it) => {
      if (!meta.hasProgress) return it.label;
      const pct = Math.round((it.progress ?? 0) * 100);
      const tier = kind === "skill" ? ` (${skillTier(it.progress ?? 0)})` : "";
      return `${it.label} ${pct}%${tier}`;
    });
    lines.push(`${meta.icon} ${meta.label}s: ${parts.join(", ")}`);
  }
  if (lines.length === 0) return null;

  return ["MIND TAB — other tracked cognitive objects (aggregated, cite naturally):", lines.join("\n")].join("\n");
}

/**
 * Sever one memory's link to a cognitive anchor and remember it as unrelated, so
 * gravity never re-draws it. (The per-chip "×" in the Mind tab.)
 */
export function unlinkMemory(ctx: AppContext, spaceId: string, anchorId: number, memoryId: number): boolean {
  const s = ctx.handle.sqlite;
  const changed = s
    .prepare(
      `DELETE FROM edges WHERE space_id = ? AND ((source = ? AND target = ?) OR (source = ? AND target = ?))`,
    )
    .run(spaceId, memoryId, anchorId, anchorId, memoryId).changes;
  recordRejection(ctx, spaceId, memoryId, anchorId);
  return changed > 0;
}

/**
 * Bulk cleanup: sever every supporting memory of an anchor that does NOT actually
 * name it (or one of its aliases) — i.e. the loose "vibe" links from the old model.
 * Each pruned pair is remembered as unrelated. Returns how many were pruned.
 */
export function pruneAnchorLinks(ctx: AppContext, spaceId: string, anchorId: number): number {
  const s = ctx.handle.sqlite;
  const anchor = s
    .prepare(`SELECT label, aliases, kind FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
    .get(anchorId, spaceId) as { label: string; aliases: string | null; kind: string | null } | undefined;
  if (!anchor) return 0;
  const tokens = anchorMatchTokens(anchor.label, anchor.aliases);
  // No usable match tokens (e.g. a person whose only name is a common word) → we can't
  // tell which memories genuinely belong, so DON'T strip them all. Leave it untouched;
  // the total-degree cap still bounds it, and the user can add a distinctive alias.
  if (tokens.length === 0) return 0;
  const nameOnly = anchor.kind != null && NAME_ONLY_KINDS.has(anchor.kind);
  // A person/identity may ONLY hold memories that literally name it — so also sweep the
  // loose associative (`relates_to`) links similarity dragged in. Goals/skills legitimately
  // gather thematically, so for them we only prune the stricter `supports` mis-links.
  const rels = nameOnly ? "('supports','relates_to')" : "('supports')";
  const edgeRows = s
    .prepare(
      `SELECT id, source, target, relationship FROM edges
       WHERE space_id = ? AND (source = ? OR target = ?) AND relationship IN ${rels}`,
    )
    .all(spaceId, anchorId, anchorId) as { source: number; target: number }[];
  let pruned = 0;
  for (const e of edgeRows) {
    const memId = e.source === anchorId ? e.target : e.source;
    const mem = s
      .prepare(
        `SELECT label, content FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL
           AND (kind IS NULL OR kind = 'memory')`,
      )
      .get(memId, spaceId) as { label: string; content: string } | undefined;
    if (!mem) continue; // only prune links to real memories (never anchor↔anchor/hubs)
    const hay = `${mem.label}\n${mem.content}`;
    if (tokens.length > 0 && tokens.some((t) => mentions(hay, t))) continue; // genuinely names it → keep
    if (unlinkMemory(ctx, spaceId, anchorId, memId)) pruned++;
  }
  return pruned;
}

/**
 * Trim an over-linked anchor down to `cap` by dropping its WEAKEST memory links (keeps
 * the strongest, most-relevant ones). Unlike pruneAnchorLinks this doesn't reject the
 * pairs — a legitimately thematic goal/skill can re-gather the best ones later; it just
 * shouldn't hold 79 at once. Returns how many links were removed.
 */
export function trimAnchorLinks(
  ctx: AppContext,
  spaceId: string,
  anchorId: number,
  cap: number = MAX_ANCHOR_LINKS,
): number {
  const s = ctx.handle.sqlite;
  const rows = s
    .prepare(
      `SELECT e.id FROM edges e
         JOIN nodes n ON n.id = (CASE WHEN e.source = ? THEN e.target ELSE e.source END)
       WHERE e.space_id = ? AND (e.source = ? OR e.target = ?)
         AND e.relationship IN ('supports','relates_to')
         AND n.deleted_at IS NULL AND (n.kind IS NULL OR n.kind = 'memory')
       ORDER BY e.weight ASC`,
    )
    .all(anchorId, spaceId, anchorId, anchorId) as { id: number }[];
  const excess = rows.length - cap;
  if (excess <= 0) return 0;
  const del = s.prepare(`DELETE FROM edges WHERE id = ? AND space_id = ?`);
  let removed = 0;
  for (let i = 0; i < excess; i++) {
    del.run(rows[i]!.id, spaceId);
    removed++;
  }
  return removed;
}

// Matches the "Goal Achiever" achievement's own threshold (achievements.ts), so the
// in-panel celebration and that badge fire at the same moment, not two slightly
// different definitions of "done."
const GOAL_COMPLETE_THRESHOLD = 0.999;

/**
 * Set a cognitive object's 0..1 progress (goal completion / skill level). A goal
 * crossing GOAL_COMPLETE_THRESHOLD for the first time is stamped with `completedAt`
 * (permanent — never cleared even if progress is later nudged back down) and logged,
 * so finishing a goal is a real, one-time moment instead of a number that quietly
 * stops moving. Skills reaching 1.0 (Expert) are a different, ongoing kind of "done"
 * and are deliberately not given this same one-time treatment.
 */
export function setCognitiveProgress(
  ctx: AppContext,
  spaceId: string,
  id: number,
  value: number,
): boolean {
  const s = ctx.handle.sqlite;
  const row = s
    .prepare(`SELECT kind, label, completed_at AS completedAt, progress FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
    .get(id, spaceId) as { kind: string; label: string; completedAt: string | null; progress: number | null } | undefined;
  if (!row) return false;
  // Relic Buffs v2 §10: growth-slowing held relics scale INCREASES only;
  // a self-made decrease is applied unscaled. Computed fresh, never stored.
  const v = applyGrowthMultiplier(row.progress ?? 0, value, buffsForSpace(ctx.handle, spaceId).growthMultiplier);

  const justCompleted = row.kind === "goal" && row.completedAt == null && v >= GOAL_COMPLETE_THRESHOLD;
  s.prepare(
    `UPDATE nodes SET progress = ?, completed_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE completed_at END
     WHERE id = ? AND space_id = ?`,
  ).run(v, justCompleted ? 1 : 0, id, spaceId);
  new NodesRepo(ctx.handle, spaceId).tend(id);

  if (justCompleted) {
    try {
      s.prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'goal_completed', ?, ?)`).run(
        spaceId,
        `You did it — "${row.label}" is complete.`,
        JSON.stringify([id]),
      );
    } catch {
      /* best-effort */
    }
  }
  return true;
}

/**
 * Link one cognitive anchor to the memories it should pull into its orbit, via two
 * complementary passes (both create `supports` edges memory→anchor, so the heavier
 * anchor becomes their orbital parent). Only REAL memories are pulled — never other
 * cognitive anchors, hubs, or actions. Returns how many new edges were formed.
 *
 *  1. NAME / KEYWORD match — the memory literally mentions the anchor (whole-word).
 *     This is what makes adding a person "Mara" connect the memories about her;
 *     a bare name embeds too weakly for vector search alone to catch it.
 *  2. SEMANTIC match — strongly-similar memories that don't name it outright.
 */
export function linkCognitiveAnchor(
  ctx: AppContext,
  spaceId: string,
  anchorId: number,
  label: string,
  emb?: Float32Array,
): number {
  const s = ctx.handle.sqlite;
  const edges = new EdgesRepo(ctx.handle, spaceId);
  let formed = 0;

  const anchorRow = s
    .prepare(`SELECT kind, aliases FROM nodes WHERE id = ? AND space_id = ?`)
    .get(anchorId, spaceId) as { kind: string | null; aliases: string | null } | undefined;
  const anchorKind = anchorRow?.kind;

  // Total-degree guard: if this anchor already holds MAX_ANCHOR_LINKS supporters, stop
  // auto-gathering. Prevents a slow accretion of dozens of links across autonomy runs.
  const existing = (
    s.prepare(`SELECT COUNT(*) AS n FROM edges WHERE space_id = ? AND target = ? AND relationship = 'supports'`).get(spaceId, anchorId) as { n: number }
  ).n;
  if (existing >= MAX_ANCHOR_LINKS) return 0;
  const remaining = MAX_ANCHOR_LINKS - existing; // total this call may add across both passes

  const isRealMemory = (id: number) =>
    s
      .prepare(
        `SELECT 1 FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL
           AND (kind IS NULL OR kind = 'memory')`,
      )
      .get(id, spaceId) != null;

  const link = (memId: number): boolean => {
    if (memId === anchorId) return false;
    if (edges.exists(memId, anchorId) || edges.exists(anchorId, memId)) return false;
    if (isRejected(ctx, spaceId, memId, anchorId)) return false; // user said "not related"
    if (!isRealMemory(memId)) return false;
    edges.create({ source: memId, target: anchorId, relationship: "supports", weight: 0.7 });
    formed++;
    return true;
  };

  // 1) Name / keyword / ALIAS match — so "my girlfriend did X" links to the person
  //    you've told her that alias belongs to, even without her actual name.
  const tokens = anchorMatchTokens(label, anchorRow?.aliases ?? null);
  if (tokens.length > 0) {
    const likeClause = tokens.map(() => `lower(content) LIKE ? OR lower(label) LIKE ?`).join(" OR ");
    const params: string[] = [];
    for (const t of tokens) params.push(`%${t}%`, `%${t}%`);
    const rows = s
      .prepare(
        `SELECT id, label, content FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind = 'memory') AND (${likeClause})
         ORDER BY id DESC LIMIT 80`,
      )
      .all(spaceId, ...params) as { id: number; label: string; content: string }[];
    let made = 0;
    for (const r of rows) {
      if (made >= MAX_KEYWORD || formed >= remaining) break;
      const hay = `${r.label}\n${r.content}`;
      if (!tokens.some((t) => mentions(hay, t))) continue; // enforce whole-word match
      if (link(r.id)) made++;
    }
  }

  // 2) Semantic match — SKIPPED for people/identities (they link by name only, so a
  // merely-similar memory can't be mistaken for a real connection to a person).
  const embedding = anchorKind && NAME_ONLY_KINDS.has(anchorKind) ? undefined : emb ?? getEmbedding(s, anchorId);
  if (embedding) {
    const hits = knn(s, embedding, 12, spaceId).filter(
      (h) => h.nodeId !== anchorId && h.similarity >= GRAVITY_THRESHOLD,
    );
    let made = 0;
    for (const h of hits) {
      if (made >= MAX_SEMANTIC || formed >= remaining) break;
      if (link(h.nodeId)) made++;
    }
  }

  return formed;
}

/**
 * Cognitive gravity (free, offline, autonomy step): re-run linking for every
 * cognitive anchor so memories keep drifting toward the goals/people/identity/etc.
 * they serve as the brain grows. Returns how many new supports edges were formed.
 */
export function applyCognitiveGravity(ctx: AppContext, spaceId: string): number {
  const anchors = ctx.handle.sqlite
    .prepare(
      `SELECT id, label FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND kind IN (${COGNITIVE_KINDS.map(() => "?").join(",")})`,
    )
    .all(spaceId, ...COGNITIVE_KINDS) as { id: number; label: string }[];
  let formed = 0;
  for (const a of anchors) formed += linkCognitiveAnchor(ctx, spaceId, a.id, a.label);
  return formed;
}
