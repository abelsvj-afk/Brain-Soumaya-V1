import type { AppContext } from "../context.js";
import { ingest, ingestWithContext } from "../ingestion/pipeline.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { EconomyRepo, EARN_MEMORY, EARN_LINK } from "../economy.js";
import { StreakRepo, STREAK_DAY_BONUS } from "../streak.js";
import { detectForesight } from "./foresight.js";
import { spaceTimezone, localDay } from "../agent/notify/policy.js";

/**
 * The Daily Contact — once a day SOUMAYA initiates. She prepares the single most
 * valuable question she could ask about your brain (interview instinct, but
 * proactive) plus her best recent discovery, and leads the arrival screen with
 * them. Answering IS logging: the reply is ingested, linked to the memory she
 * asked about, and pays the normal earn path — so the daily ritual literally
 * makes the brain smarter.
 *
 * Fully deterministic + offline-safe: the question ladder reads graph state, no
 * LLM call is needed to ASK (the cloud mind only gets involved when the answer
 * is ingested like any other memory).
 */

export interface DailyContact {
  date: string;
  question: {
    text: string;
    /** The memory it's about (fly-to target); null for brain-wide questions. */
    nodeId: number | null;
    nodeLabel: string | null;
    /** Why she's asking — drives the icon + copy in the UI. */
    source: "research" | "contradiction" | "cooling" | "heavy";
    /** The contradiction insight behind rung 2 — resolved when answered. */
    insightId?: number;
  } | null;
  /** Her best recent discovery (latest synthesis insight), one line. */
  discovery: { text: string; nodeId: number | null } | null;
  /** A recurring-negative pattern about to recur (foresight), if any. */
  foresight: { text: string; inDays: number } | null;
  answered: boolean;
}

/** The SPACE's local calendar date (owner rule 2026-10-21: the daily
 *  question rolls over at the user's own midnight, never UTC midnight).
 *  Timezone from space_meta via the notify layer — the same source as
 *  quiet hours, the digest, and the streak. */
const today = (ctx: AppContext, spaceId: string): string =>
  localDay(new Date(), spaceTimezone(ctx.handle.sqlite, spaceId));

/** Pick the most valuable question she could ask right now (deterministic ladder). */
function pickQuestion(ctx: AppContext, spaceId: string): DailyContact["question"] {
  const s = ctx.handle.sqlite;

  // 1. A deep-dive already ASKED clarifying questions nobody answered — the
  //    highest-signal ask in the system, sitting unnoticed on a Details card.
  const research = s
    .prepare(
      `SELECT id, label, research_questions AS q FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND research_questions IS NOT NULL
       ORDER BY importance DESC LIMIT 1`,
    )
    .get(spaceId) as { id: number; label: string; q: string } | undefined;
  if (research) {
    try {
      const qs = JSON.parse(research.q) as string[];
      if (Array.isArray(qs) && qs[0]) {
        return { text: qs[0], nodeId: research.id, nodeLabel: research.label, source: "research" };
      }
    } catch {
      /* malformed stored questions — fall through */
    }
  }

  // 2. A recent unresolved contradiction — she genuinely can't reconcile it alone.
  const contradiction = s
    .prepare(
      `SELECT i.id AS insightId, i.text, i.node_a AS nodeA, n.label FROM insights i
       JOIN nodes n ON n.id = i.node_a
       WHERE i.space_id = ? AND i.kind = 'contradiction'
         AND i.created_at >= datetime('now', '-14 days')
       ORDER BY i.score DESC, i.id DESC LIMIT 1`,
    )
    .get(spaceId) as { insightId: number; text: string; nodeA: number; label: string } | undefined;
  if (contradiction) {
    return {
      text: `Two of your memories pull in opposite directions — ${contradiction.text} Which feels true today?`,
      nodeId: contradiction.nodeA,
      nodeLabel: contradiction.label,
      source: "contradiction",
      insightId: contradiction.insightId,
    };
  }

  // 3. An important memory going cold — is it still true? What changed?
  const cooling = s
    .prepare(
      `SELECT id, label FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL
         AND (kind IS NULL OR kind NOT IN ('action','moc'))
         AND COALESCE(importance, 0.4) >= 0.55
         AND last_tended_at IS NOT NULL
         AND julianday('now') - julianday(last_tended_at) > 10
       ORDER BY importance DESC LIMIT 1`,
    )
    .get(spaceId) as { id: number; label: string } | undefined;
  if (cooling) {
    return {
      text: `"${cooling.label}" has been drifting cold for a while. Is it still true — and what's changed since you last touched it?`,
      nodeId: cooling.id,
      nodeLabel: cooling.label,
      source: "cooling",
    };
  }

  // 4. An emotionally heavy memory with almost no connections — she knows it
  //    matters but doesn't understand it well enough to help.
  const heavy = s
    .prepare(
      `SELECT n.id, n.label FROM nodes n
       WHERE n.space_id = ? AND n.deleted_at IS NULL
         AND (n.kind IS NULL OR n.kind NOT IN ('action','moc'))
         AND ABS(COALESCE(n.emotional_weight, 0)) >= 0.5
         AND (SELECT COUNT(*) FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id)) <= 1
       ORDER BY ABS(n.emotional_weight) DESC LIMIT 1`,
    )
    .get(spaceId) as { id: number; label: string } | undefined;
  if (heavy) {
    return {
      text: `"${heavy.label}" carries real weight but sits almost alone in your galaxy. What's the story around it?`,
      nodeId: heavy.id,
      nodeLabel: heavy.label,
      source: "heavy",
    };
  }

  return null;
}

/** Her best recent discovery — the latest substantive synthesis insight. */
function pickDiscovery(ctx: AppContext, spaceId: string): DailyContact["discovery"] {
  const row = ctx.handle.sqlite
    .prepare(
      `SELECT text, node_a AS nodeId FROM insights
       WHERE space_id = ? AND kind = 'synthesis'
         AND created_at >= datetime('now', '-7 days')
       ORDER BY score DESC, id DESC LIMIT 1`,
    )
    .get(spaceId) as { text: string; nodeId: number } | undefined;
  return row ? { text: row.text, nodeId: row.nodeId } : null;
}

/**
 * Today's contact for a space — built once per day and persisted, so the question
 * doesn't shuffle on every reload.
 */
export function getDailyContact(ctx: AppContext, spaceId: string): DailyContact {
  const s = ctx.handle.sqlite;
  const date = today(ctx, spaceId);
  const existing = s
    .prepare(`SELECT payload, answered FROM daily_contact WHERE space_id = ? AND date = ?`)
    .get(spaceId, date) as { payload: string; answered: number } | undefined;
  if (existing) {
    try {
      const parsed = JSON.parse(existing.payload) as DailyContact;
      return { ...parsed, answered: existing.answered === 1 };
    } catch {
      /* rebuild below */
    }
  }
  const contact: DailyContact = {
    date,
    question: pickQuestion(ctx, spaceId),
    discovery: pickDiscovery(ctx, spaceId),
    foresight: (() => {
      const f = detectForesight(ctx.handle, spaceId);
      return f ? { text: f.text, inDays: f.inDays } : null;
    })(),
    answered: false,
  };
  s.prepare(
    `INSERT OR REPLACE INTO daily_contact (space_id, date, payload, answered) VALUES (?, ?, ?, 0)`,
  ).run(spaceId, date, JSON.stringify(contact));
  return contact;
}

/**
 * Answer today's contact: the reply becomes a REAL memory (normal ingest —
 * extraction, linking, embedding), tied to the memory she asked about, and pays
 * the standard earn path (fuel + streak). Returns what was created.
 */
export async function answerDailyContact(
  ctx: AppContext,
  spaceId: string,
  text: string,
): Promise<{ nodeIds: number[]; fuelEarned: number; streakAdvanced: boolean }> {
  const contact = getDailyContact(ctx, spaceId);
  const result = await ingestWithContext(
    ctx.handle,
    { embeddings: ctx.embeddings, llm: ctx.llm },
    ctx,
    text,
    spaceId,
  );
  const nodeIds = result.nodes.map((n) => n.id);

  // Tie the answer to the memory she asked about — that's the whole point:
  // her question fills a specific gap in the graph.
  const qNode = contact.question?.nodeId ?? null;
  if (qNode != null && nodeIds[0] != null) {
    const edges = new EdgesRepo(ctx.handle, spaceId);
    if (!edges.exists(nodeIds[0], qNode) && !edges.exists(qNode, nodeIds[0])) {
      edges.create({ source: nodeIds[0], target: qNode, relationship: "relates_to", weight: 0.6 });
    }
    new NodesRepo(ctx.handle, spaceId).tend(qNode); // her ask warmed it too
  }

  // CONSUME the question — without this the ladder re-picked the same one every
  // day forever ("come back tomorrow, she'll have a new one" was a lie):
  // - research: shift the answered question off the node + file the answer;
  // - contradiction: the user just told her which side is true — resolve it.
  // (Cooling rotates via the tend above; heavy rotates via the new edge.)
  const q = contact.question;
  if (q?.source === "research" && q.nodeId != null) {
    const node = new NodesRepo(ctx.handle, spaceId).getById(q.nodeId);
    const remaining = (node?.researchQuestions ?? []).filter((x) => x !== q.text);
    const answers = { ...(node?.researchAnswers ?? {}), [q.text]: text.slice(0, 2000) };
    new NodesRepo(ctx.handle, spaceId).updateResearch(
      q.nodeId,
      remaining.length > 0 ? remaining : null,
      answers,
    );
  } else if (q?.source === "contradiction" && q.insightId != null) {
    ctx.handle.sqlite
      .prepare(`DELETE FROM insights WHERE id = ? AND space_id = ?`)
      .run(q.insightId, spaceId);
  }

  // Same earn path as the ingest route (answering IS tending).
  const { advanced } = new StreakRepo(ctx.handle, spaceId).touch();
  const fuelEarned =
    EARN_MEMORY + EARN_LINK * result.associativeEdges.length + (advanced ? STREAK_DAY_BONUS : 0);
  new EconomyRepo(ctx.handle, spaceId).add(fuelEarned);

  ctx.handle.sqlite
    .prepare(`UPDATE daily_contact SET answered = 1 WHERE space_id = ? AND date = ?`)
    .run(spaceId, contact.date);

  return { nodeIds, fuelEarned, streakAdvanced: advanced };
}
