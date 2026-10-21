import type {
  JourneyLink,
  JourneyLinkKind,
  JourneyLinkSummary,
  JourneySuggestion,
  JourneySuggestions,
} from "@brain/shared";
import type { AppContext } from "../context.js";
import { getEmbedding, knnJourneys } from "../db/vec.js";
import { DEFAULT_LINK_OPTIONS } from "../ingestion/associativeLink.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";

/**
 * Capture-time Journey suggestion/auto-link (docs/specs/journeys-connective-tissue.md) and
 * link hydration for the Journeys detail view. Kept out of both the repo (relational rows
 * only, per JourneysRepo's own scope) and the route (validate → delegate → json) — this is
 * the "service" layer CLAUDE.md's architecture notes call for.
 */

// Silent auto-link bar — reuse the EXACT constant already proven in production for
// memory-to-memory associative linking (ingestion/associativeLink.ts), so this feature
// inherits that track record instead of guessing a new number.
const AUTO_LINK_THRESHOLD = DEFAULT_LINK_OPTIONS.threshold;
// Below this, a match is noise, not worth even a one-tap suggestion. No existing
// codebase constant to reuse — this floor is new to this feature.
const SUGGEST_THRESHOLD = 0.4;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with",
  "my", "is", "at", "by", "it", "this", "that", "from", "your", "you",
]);

/** Lowercase, strip punctuation, drop stopwords/short tokens — enough to catch obvious
 *  cases ("Rent" -> a Journey titled "Buy My First Home") without any ML. */
function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

/** Money kinds only — the keyword-heuristic finance path never auto-links (FinancePanel's
 *  own "Zero-AI: manual entry" design promise), and their hydration shape (label + amount)
 *  differs from a plain node. `dateCol` is absent for `bill`: a bill row is a recurring
 *  schedule, not a dated transaction, so it hydrates with no `occurredAt` rather than a
 *  fabricated one. */
const FINANCE_TABLE: Partial<Record<JourneyLinkKind, { table: string; labelCol: string; amountCol: string; dateCol?: string }>> = {
  income: { table: "fin_income", labelCol: "platform", amountCol: "net_cents", dateCol: "date" },
  expense: { table: "fin_expense", labelCol: "merchant", amountCol: "amount_cents", dateCol: "date" },
  bill: { table: "fin_bill", labelCol: "name", amountCol: "amount_cents" },
};

/** Plain label-only kinds — no amount, no suggestion source (yet), just hydration. */
const LABEL_TABLE: Partial<Record<JourneyLinkKind, { table: string; labelCol: string }>> = {
  insight: { table: "insights", labelCol: "text" },
  doc: { table: "knowledge_docs", labelCol: "name" },
  goal: { table: "fin_goal", labelCol: "name" },
};

/**
 * Candidate Journeys for a freshly captured/edited object, split into `autoLink` (silently
 * linked, ≥0.72 similarity — same bar as memory-to-memory auto-linking) and `suggested`
 * (0.40–0.72, one-tap to confirm). Nodes use the already-computed embedding (free — every
 * node is embedded at ingestion regardless); finance rows use a plain keyword-overlap
 * heuristic and NEVER appear in `autoLink`, honoring FinancePanel's "Zero-AI" design.
 */
export function suggestJourneys(
  ctx: AppContext,
  spaceId: string,
  kind: JourneyLinkKind,
  refId: number,
): JourneySuggestions {
  const journeys = new JourneysRepo(ctx.handle, spaceId).list();
  const byId = new Map(journeys.map((j) => [j.id, j]));

  if (kind === "node") {
    const vec = getEmbedding(ctx.handle.sqlite, refId);
    if (!vec) return { autoLink: [], suggested: [] };
    const hits = knnJourneys(ctx.handle.sqlite, vec, 20, spaceId);
    const autoLink: JourneySuggestion[] = [];
    const suggested: JourneySuggestion[] = [];
    for (const h of hits) {
      const journey = byId.get(h.journeyId);
      if (!journey) continue;
      if (h.similarity >= AUTO_LINK_THRESHOLD) autoLink.push({ journey, score: h.similarity, tier: "auto" });
      else if (h.similarity >= SUGGEST_THRESHOLD) suggested.push({ journey, score: h.similarity, tier: "suggested" });
    }
    return { autoLink, suggested };
  }

  const fin = FINANCE_TABLE[kind];
  if (fin) {
    const row = ctx.handle.sqlite
      .prepare(`SELECT ${fin.labelCol} AS label FROM ${fin.table} WHERE id = ? AND space_id = ?`)
      .get(refId, spaceId) as { label: string | null } | undefined;
    const words = row?.label ? keywords(row.label) : new Set<string>();
    if (words.size === 0) return { autoLink: [], suggested: [] };
    const suggested = journeys
      .map((j) => ({ journey: j, score: overlapCount(words, keywords(`${j.title} ${j.description}`)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x): JourneySuggestion => ({ journey: x.journey, score: x.score, tier: "suggested" }));
    return { autoLink: [], suggested };
  }

  return { autoLink: [], suggested: [] }; // no suggestion source yet for this kind
}

/** Hydrate raw {kind, refId} link rows into something a detail view can render directly —
 *  a dangling ref (the linked row was deleted since linking) is silently skipped rather
 *  than shown as a broken row.
 *
 *  IM-86 remainder: task/chat/achievement used to be skipped wholesale because they
 *  have no dedicated source table (see JourneysRepo.REF_TABLE). What the data
 *  actually allows, without inventing titles:
 *  - `task`: tasks ARE nodes rows (action items — docs/specs/journeys-connective-
 *    tissue.md; NodeInspector renders JourneyChips for actions as nodes), so a
 *    task ref that resolves to a live node hydrates with that node's real label
 *    + its occurred/created date, and carries `nodeRefId` for fly-to.
 *  - `task` (unresolvable), `chat`, `achievement`: no source row exists to take
 *    a label from (chats are not persisted as rows; achievements are a client-side
 *    string-id catalog, so a numeric refId cannot map to one). These still render
 *    as per-link rows with a truthful generic label ("Linked chat") and the
 *    link's own created_at as `linkedAt` — grouped items, never fabricated
 *    titles, and no longer collapsed into a single counted line. */
export function hydrateJourneyLinks(ctx: AppContext, spaceId: string, links: JourneyLink[]): JourneyLinkSummary[] {
  const out: JourneyLinkSummary[] = [];
  for (const link of links) {
    const linkedAt = link.createdAt ? { linkedAt: link.createdAt } : {};
    if (link.kind === "task") {
      const row = ctx.handle.sqlite
        .prepare(`SELECT label, occurred_at, created_at FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
        .get(link.refId, spaceId) as { label: string; occurred_at: string | null; created_at: string } | undefined;
      if (row) {
        out.push({
          kind: "task", refId: link.refId, label: row.label, nodeRefId: link.refId,
          occurredAt: row.occurred_at ?? row.created_at, ...linkedAt,
        });
      } else {
        out.push({ kind: "task", refId: link.refId, label: "Linked task", ...linkedAt });
      }
      continue;
    }
    if (link.kind === "chat" || link.kind === "achievement") {
      out.push({
        kind: link.kind, refId: link.refId,
        label: link.kind === "chat" ? "Linked chat" : "Linked achievement",
        ...linkedAt,
      });
      continue;
    }
    if (link.kind === "node") {
      const row = ctx.handle.sqlite
        .prepare(`SELECT label FROM nodes WHERE id = ? AND space_id = ? AND deleted_at IS NULL`)
        .get(link.refId, spaceId) as { label: string } | undefined;
      if (row) out.push({ kind: "node", refId: link.refId, label: row.label, ...linkedAt });
      continue;
    }
    const fin = FINANCE_TABLE[link.kind];
    if (fin) {
      const cols = fin.dateCol
        ? `${fin.labelCol} AS label, ${fin.amountCol} AS amount, ${fin.dateCol} AS occurredAt`
        : `${fin.labelCol} AS label, ${fin.amountCol} AS amount`;
      const row = ctx.handle.sqlite
        .prepare(`SELECT ${cols} FROM ${fin.table} WHERE id = ? AND space_id = ?`)
        .get(link.refId, spaceId) as { label: string | null; amount: number; occurredAt?: string } | undefined;
      if (row) {
        const fallback = link.kind === "income" ? "Income" : link.kind === "expense" ? "Expense" : "Bill";
        out.push({
          kind: link.kind,
          refId: link.refId,
          label: row.label || fallback,
          amount: row.amount,
          ...(row.occurredAt ? { occurredAt: row.occurredAt } : {}),
          ...linkedAt,
        });
      }
      continue;
    }
    const lbl = LABEL_TABLE[link.kind];
    if (lbl) {
      const row = ctx.handle.sqlite
        .prepare(`SELECT ${lbl.labelCol} AS label FROM ${lbl.table} WHERE id = ? AND space_id = ?`)
        .get(link.refId, spaceId) as { label: string } | undefined;
      if (row) out.push({ kind: link.kind, refId: link.refId, label: row.label, ...linkedAt });
    }
    // Every other kind is handled above (node/finance/task/chat/achievement);
    // anything left is a kind with no hydration path at all — skip rather than guess.
  }
  return out;
}
