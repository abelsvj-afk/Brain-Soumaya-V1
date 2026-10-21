import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { personProfile, recentPeopleSummaries } from "../../analysis/people.js";
import { anchorMatchTokens, mentions } from "../../analysis/cognitiveTokens.js";

/**
 * Telegram Parity Phase 1: people as a conversational tool — the father fix
 * (findings §3).
 *
 * People are matched by NAME, not by meaning, by design in this codebase
 * ("a bare name embeds too weakly for pure vector search to catch" —
 * analysis/cognitive.ts). So this tool never uses vector search:
 *
 * - No query → the tracked-people roster, reusing `recentPeopleSummaries`
 *   (the same one-query aggregation behind the Mind-tab snapshot) with its
 *   cap raised via the `limit` arg. Truncation is stated honestly in the
 *   output ("showing X of Y") instead of presenting a subset as the whole —
 *   the "~2 relationships" failure was exactly that.
 * - With a query → LITERAL whole-word/phrase match (cognitiveTokens'
 *   `mentions`) over each person's label + aliases + content, in both
 *   directions: the query appearing in the person's text (query "father"
 *   finds a bare-name person whose CONTENT says he is the owner's father),
 *   and the person's name/alias appearing in the query ("tell me about
 *   <name>"). A single match also gets `personProfile` detail (their
 *   interactions).
 *
 * Candidates are people nodes: kind = 'person_entity' (tracked, Mind tab)
 * plus extraction-typed type = 'person' nodes, labeled by which they are.
 *
 * Read-only. No approval required. Space-scoped via tc.spaceId throughout.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

interface PersonRow {
  id: number;
  label: string;
  type: string;
  kind: string | null;
  content: string;
  aliases: string | null;
}

function clampLimit(raw: unknown): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(n));
}

/** JSON-array alias text for matching/display; malformed values yield "". */
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

export const peopleLookupTool: Tool = {
  name: "people_lookup",
  description:
    "Look up the people in the user's brain. With no query, returns the tracked-people roster (name, interaction count, last interaction, tone) — use it for 'who do I know / show me my relationships' questions. With a query, finds people by LITERAL match over their name, aliases, and description text (e.g. query 'father' finds the person whose entry says he is the user's father) — use it whenever the user asks about a person by name or by relationship role.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Optional. A name, alias, or relationship role (e.g. 'father', 'my sister') to match literally against people's names, aliases, and descriptions. Omit to get the full tracked-people roster.",
      },
      limit: {
        type: "integer",
        description: "Max people to return (1-200, default 20). Raise it when the user asks for everyone.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  detect(_tc: ToolContext): ToolInvocation[] {
    // The agent loop invokes this directly; the deterministic router never does.
    return [];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const s = tc.ctx.handle.sqlite;
    const limit = clampLimit(args.limit);
    const query = String(args.query ?? "").trim();

    // ----- No query: the tracked-people roster. -----
    if (!query) {
      const total = (
        s
          .prepare(
            `SELECT COUNT(*) AS c FROM nodes WHERE space_id = ? AND deleted_at IS NULL AND kind = 'person_entity'`,
          )
          .get(tc.spaceId) as { c: number }
      ).c;
      const roster = recentPeopleSummaries(tc.ctx.handle, tc.spaceId, limit);
      if (roster.length === 0) {
        return {
          ok: true,
          summary: "people_lookup: roster empty",
          message: "TRACKED PEOPLE: none — the user does not track any people yet.",
        };
      }
      const lines = roster.map((p) => {
        const when = p.lastAt ? `, last interaction ${p.lastAt.slice(0, 10)}` : ", no interactions yet";
        return `- #${p.id} ${p.label} (${p.interactionCount} interaction${p.interactionCount === 1 ? "" : "s"}${when}, tone: ${p.tone})`;
      });
      const truncated =
        roster.length < total
          ? `\nShowing ${roster.length} of ${total} tracked people (truncated at limit ${limit} — call again with a larger limit to see everyone).`
          : "";
      return {
        ok: true,
        summary: `people_lookup: roster ${roster.length} of ${total} people`,
        message:
          `TRACKED PEOPLE (complete roster of the ${total} people the user tracks — this is everyone, not a sample):\n` +
          lines.join("\n") +
          truncated,
      };
    }

    // ----- With a query: literal match over label + aliases + content. -----
    const people = s
      .prepare(
        `SELECT id, label, type, kind, content, aliases FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND superseded_at IS NULL
           AND (kind = 'person_entity' OR type = 'person')
         ORDER BY id ASC`,
      )
      .all(tc.spaceId) as PersonRow[];

    type Scored = { row: PersonRow; via: string; score: number };
    const hits: Scored[] = [];
    for (const row of people) {
      const aliases = aliasesText(row.aliases);
      // Direction 1: the query appears in the person's own text. This is the
      // father fix — the role word lives in the CONTENT, not the name.
      if (mentions(row.label, query)) hits.push({ row, via: "name", score: 3 });
      else if (aliases && mentions(aliases, query)) hits.push({ row, via: "alias", score: 2 });
      else if (mentions(row.content, query)) hits.push({ row, via: "description text", score: 1 });
      else {
        // Direction 2: the person's name/alias appears in the query
        // ("tell me about <name>") — the anchor-match tokens the cognitive
        // layer itself uses for name-only kinds.
        const token = anchorMatchTokens(row.label, row.aliases).find((t) => mentions(query, t));
        if (token) hits.push({ row, via: `name mentioned in the query ("${token}")`, score: 3 });
      }
    }
    hits.sort((a, b) => b.score - a.score || a.row.id - b.row.id);
    const shown = hits.slice(0, limit);

    if (shown.length === 0) {
      return {
        ok: true,
        summary: "people_lookup: 0 matches",
        message: `PEOPLE LOOKUP: no tracked person literally matches "${query}" in their name, aliases, or description. Say so honestly — do not guess who it might be. (Use people_lookup with no query to see everyone tracked.)`,
      };
    }

    const lines: string[] = [
      `PEOPLE LOOKUP for "${query}" — literal matches (${shown.length}${hits.length > shown.length ? ` of ${hits.length}, truncated at limit ${limit}` : ""}):`,
    ];
    for (const { row, via } of shown) {
      const aliases = aliasesText(row.aliases);
      lines.push(
        `- #${row.id} ${row.label} [matched via ${via}; ${row.kind === "person_entity" ? "tracked person (person_entity)" : `node type "person"`}]` +
          (aliases ? ` — also known as: ${aliases}` : "") +
          `\n  Description: ${row.content.slice(0, 500)}`,
      );
    }

    // Single match → full profile detail (their interactions) when the
    // person is a tracked person_entity (personProfile's contract).
    if (shown.length === 1 && shown[0]!.row.kind === "person_entity") {
      const profile = personProfile(tc.ctx, tc.spaceId, shown[0]!.row.id);
      if (profile) {
        lines.push(
          `Profile for ${shown[0]!.row.label}: ${profile.count} interaction(s), tone: ${profile.tone}, last interaction: ${profile.lastAt ? profile.lastAt.slice(0, 10) : "none recorded"}.`,
        );
        if (profile.interactions.length > 0) {
          lines.push("Interactions (memories that mention them, newest first):");
          for (const it of profile.interactions.slice(0, 10)) {
            lines.push(`  - #${it.id} "${it.label}" (${it.createdAt.slice(0, 10)})`);
          }
        }
      }
    }

    return {
      ok: true,
      summary: `people_lookup: ${shown.length} match(es) for query`,
      targets: shown.map((h) => h.row.id),
      message: lines.join("\n"),
    };
  },
};
