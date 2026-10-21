import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { personProfile } from "../../analysis/people.js";
import { anchorMatchTokens, mentions } from "../../analysis/cognitiveTokens.js";
import { entityLookupTool } from "./entityLookup.js";

/**
 * Telegram Parity Phase 5-A: prepare me (`prepare_me`) — a dossier on one
 * person or topic, assembled ONLY from data the brain already holds:
 *
 *  - PERSON (resolved literally, exactly like `people_lookup`: name /
 *    alias / description-text match over tracked people): their stored
 *    profile + history and the tone of interactions from `personProfile()`
 *    (interactions, recency, derived tone), plus OPEN THREADS — unresolved
 *    items linked to them (see below).
 *  - TOPIC (anything else): the entity itself with ALL its graph
 *    connections, via `entity_lookup`'s own machinery (this tool literally
 *    runs that tool for the resolved node), plus open threads mentioning
 *    it.
 *
 * OPEN THREADS (shared definition, both paths): live nodes that are
 * unresolved work or pending choices — kind = 'action', OR a node carrying
 * a `remind_at` (a pending reminder), OR a decision (`type = 'decision'`) —
 * that are LINKED to the subject: connected by an edge in either direction,
 * or literally mentioning the subject's label in their label/content.
 * Capped, with honest truncation.
 *
 * If the name/topic matches NOTHING, the result says so plainly — no
 * dossier is invented. Person resolution wins over topic resolution (a
 * tracked person is the more specific subject), matching how the user
 * means "prepare me for <person>".
 *
 * Read-only. No approval required. Space-scoped via tc.spaceId throughout.
 */

const MAX_OPEN_THREADS = 20;
const MAX_INTERACTIONS_SHOWN = 10;

interface PersonRow {
  id: number;
  label: string;
  type: string;
  kind: string | null;
  content: string;
  aliases: string | null;
}

function aliasesText(aliasesJson: string | null): string {
  if (!aliasesJson) return "";
  try {
    const parsed: unknown = JSON.parse(aliasesJson);
    if (Array.isArray(parsed)) return parsed.map(String).join(", ");
  } catch {
    /* ignore malformed */
  }
  return "";
}

interface ThreadRow {
  id: number;
  label: string;
  type: string;
  kind: string | null;
  remind_at: string | null;
  via: string;
}

/** Unresolved items linked to the subject node (edge in either direction,
 *  or a literal mention of the subject — full label or one of its anchor
 *  tokens, e.g. a person's first name, via `anchorMatchTokens`, the same
 *  tokens the cognitive layer uses for name matching), ordered by id. */
function openThreads(tc: ToolContext, subjectId: number, subjectTokens: string[]): { threads: ThreadRow[]; total: number } {
  const s = tc.ctx.handle.sqlite;
  const linked = s
    .prepare(
      `SELECT DISTINCT n.id AS id, n.label AS label, n.type AS type, n.kind AS kind, n.remind_at AS remind_at
       FROM edges e JOIN nodes n ON n.id = CASE WHEN e.source = ? THEN e.target ELSE e.source END
       WHERE e.space_id = ? AND (e.source = ? OR e.target = ?)
         AND n.deleted_at IS NULL AND n.superseded_at IS NULL AND (n.status IS NULL OR n.status != 'archived')`,
    )
    .all(subjectId, tc.spaceId, subjectId, subjectId) as Omit<ThreadRow, "via">[];
  const byId = new Map<number, ThreadRow>(linked.map((r) => [r.id, { ...r, via: "graph connection" }]));

  // Literal mentions in otherwise-unlinked open items (same `mentions`
  // whole-word/phrase matching the people/entity tools use).
  const open = s
    .prepare(
      `SELECT id, label, type, kind, content, remind_at FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND superseded_at IS NULL
         AND (status IS NULL OR status != 'archived')
         AND (kind = 'action' OR remind_at IS NOT NULL OR type = 'decision')
       ORDER BY id ASC`,
    )
    .all(tc.spaceId) as (Omit<ThreadRow, "via"> & { content: string })[];
  for (const r of open) {
    if (r.id === subjectId) continue;
    if (byId.has(r.id)) continue; // already linked by an edge (the SQL above pre-filtered to open items)
    if (subjectTokens.some((t) => mentions(r.label, t) || mentions(r.content, t))) {
      byId.set(r.id, { id: r.id, label: r.label, type: r.type, kind: r.kind, remind_at: r.remind_at, via: "mentions the subject" });
    }
  }
  // Edge-linked rows that are NOT open items don't belong in the list.
  const threads = [...byId.values()]
    .filter((r) => r.kind === "action" || r.remind_at !== null || r.type === "decision")
    .sort((a, b) => a.id - b.id);
  return { threads: threads.slice(0, MAX_OPEN_THREADS), total: threads.length };
}

function threadLines(tc: ToolContext, subjectId: number, subjectTokens: string[]): string[] {
  const { threads, total } = openThreads(tc, subjectId, subjectTokens);
  if (total === 0) return ["OPEN THREADS: none — no unresolved actions, pending reminders, or decisions are linked to this subject."];
  return [
    `OPEN THREADS (unresolved actions / pending reminders / decisions linked to this subject): ${total}`,
    ...threads.map(
      (t) =>
        `  - #${t.id} "${t.label}" [${t.kind === "action" ? "action" : t.type === "decision" ? "decision" : "reminder"}${t.remind_at ? `, remind_at ${t.remind_at}` : ""}; via ${t.via}]`,
    ),
    ...(total > threads.length ? [`  (Showing ${threads.length} of ${total} — capped at ${MAX_OPEN_THREADS}.)`] : []),
  ];
}

export const prepareMeTool: Tool = {
  name: "prepare_me",
  description:
    "Build a dossier to prepare the user for a person or a topic. For a tracked person: their profile/history, the tone of past interactions, and open threads (unresolved actions, reminders, decisions linked to them). For a topic: the entity and all its graph connections, plus open threads mentioning it. Give the person's name or the topic in personOrTopic. If nothing matches, the result says so plainly — never invent a dossier.",
  parameters: {
    type: "object",
    properties: {
      personOrTopic: {
        type: "string",
        description: "The name of a tracked person, or a topic/entity label, to prepare a dossier on.",
      },
    },
    required: ["personOrTopic"],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const query = String(args.personOrTopic ?? "").trim();
    if (!query) return { ok: false, summary: "prepare_me: no personOrTopic given" };
    const s = tc.ctx.handle.sqlite;

    // ----- Person path: literal match over tracked people (people_lookup's
    // own matching: name / alias / description text, both directions). -----
    const people = s
      .prepare(
        `SELECT id, label, type, kind, content, aliases FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND superseded_at IS NULL
           AND (kind = 'person_entity' OR type = 'person')
         ORDER BY id ASC`,
      )
      .all(tc.spaceId) as PersonRow[];
    type Scored = { row: PersonRow; score: number };
    const hits: Scored[] = [];
    for (const row of people) {
      const aliases = aliasesText(row.aliases);
      if (mentions(row.label, query)) hits.push({ row, score: 3 });
      else if (aliases && mentions(aliases, query)) hits.push({ row, score: 2 });
      else if (mentions(row.content, query)) hits.push({ row, score: 1 });
      else {
        const token = anchorMatchTokens(row.label, row.aliases).find((t) => mentions(query, t));
        if (token) hits.push({ row, score: 3 });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.row.id - b.row.id);

    if (hits.length > 0 && hits[0]!.row.kind === "person_entity") {
      const person = hits[0]!.row;
      const profile = personProfile(tc.ctx, tc.spaceId, person.id);
      const aliases = aliasesText(person.aliases);
      const lines = [
        `DOSSIER — PERSON: ${person.label} (#${person.id})`,
        ...(aliases ? [`Also known as: ${aliases}`] : []),
        `Profile (as stored): ${person.content.slice(0, 1000)}`,
      ];
      if (profile) {
        lines.push(
          `Interactions: ${profile.count} on record; last interaction: ${profile.lastAt ? profile.lastAt.slice(0, 10) : "none recorded"}.`,
          `Tone of interactions: ${profile.tone} (derived from the emotional weight of the interaction memories — warm / heavy / mixed / neutral).`,
        );
        if (profile.interactions.length > 0) {
          lines.push("History (interaction memories, newest first):");
          for (const it of profile.interactions.slice(0, MAX_INTERACTIONS_SHOWN)) {
            lines.push(`  - #${it.id} "${it.label}" (${it.createdAt.slice(0, 10)})`);
          }
          if (profile.count > MAX_INTERACTIONS_SHOWN) {
            lines.push(`  (Showing ${MAX_INTERACTIONS_SHOWN} of ${profile.count} interactions.)`);
          }
        } else {
          lines.push("History: no interaction memories are recorded for this person yet.");
        }
      } else {
        lines.push("Interactions: no profile data is recorded for this person yet.");
      }
      lines.push(...threadLines(tc, person.id, [person.label, ...anchorMatchTokens(person.label, person.aliases)]));
      return {
        ok: true,
        summary: `prepare_me: person dossier for "${person.label}" (#${person.id})`,
        targets: [person.id],
        message: lines.join("\n"),
      };
    }

    // ----- Topic path: resolve one entity (entity_lookup's literal label
    // resolution), then reuse entity_lookup itself for the connections. -----
    const repo = new NodesRepo(tc.ctx.handle, tc.spaceId);
    const candidates = repo
      .all()
      .filter((n) => n.label.toLowerCase() === query.toLowerCase() || mentions(n.label, query));
    if (candidates.length === 0) {
      return {
        ok: true,
        summary: `prepare_me: no match for "${query}"`,
        message: `PREPARE: nothing in this brain matches "${query}" — no tracked person and no entity carries that name or topic. Say so plainly; do NOT invent a dossier. (people_lookup / entity_lookup can show what does exist.)`,
      };
    }
    if (candidates.length > 1) {
      return {
        ok: true,
        summary: `prepare_me: "${query}" ambiguous (${candidates.length} candidates)`,
        targets: candidates.map((c) => c.id),
        message:
          `PREPARE: "${query}" matches ${candidates.length} different entities — ask the user which one they mean, or call again with the more specific label:\n` +
          candidates.map((c) => `- #${c.id} [${c.type}] ${c.label}`).join("\n"),
      };
    }
    const node = candidates[0]!;
    const lookup = await entityLookupTool.run(tc, { id: node.id });
    const lines = [
      `DOSSIER — TOPIC: ${node.label} (#${node.id})`,
      ...(lookup.message ? [lookup.message] : [`Content: ${node.content.slice(0, 1000)}`]),
      ...threadLines(tc, node.id, [node.label, ...anchorMatchTokens(node.label, node.aliases ? JSON.stringify(node.aliases) : null)]),
    ];
    return {
      ok: true,
      summary: `prepare_me: topic dossier for "${node.label}" (#${node.id})`,
      targets: [node.id],
      message: lines.join("\n"),
    };
  },
};
