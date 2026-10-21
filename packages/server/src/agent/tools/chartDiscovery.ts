import type { Tool, ToolContext, ToolInvocation, ToolResult } from "./types.js";
import { actionFiredToday } from "../../communication/context.js";
import { CodexDiscoveriesRepo } from "../../repositories/codexDiscoveries.repo.js";

/**
 * Chart Discovery (SOUMAYA_TOOLS.md tool #8). As the galaxy grows, Soumaya notices
 * genuinely notable structures — a dense constellation, a brilliantly-connected memory,
 * a sector that's become a landmark — and records them as "field notes" in the Codex,
 * in her own voice. Deterministic detection (each keyed so it's charted once), offline,
 * rate-limited to at most one new note per day so the Codex fills over a lifetime.
 */

interface Candidate {
  key: string;
  title: string;
  lore: string;
  icon: string;
  focusId: number | null;
  reason: string;
}

/** The first genuinely-notable, not-yet-charted structure — or null. */
function findDiscovery(tc: ToolContext): Candidate | null {
  const s = tc.ctx.handle.sqlite;
  const repo = new CodexDiscoveriesRepo(tc.ctx.handle, tc.spaceId);
  const fresh = (c: Candidate) => (repo.has(c.key) ? null : c);

  // 1) A dense constellation hub (≥ 8 members) → a landmark of the galaxy.
  const hub = s
    .prepare(
      `SELECT m.id AS id, m.label AS label, COUNT(e.id) AS c
       FROM nodes m JOIN edges e ON e.source = m.id AND e.relationship = 'summarizes' AND e.space_id = m.space_id
       WHERE m.space_id = ? AND m.kind = 'moc' AND m.deleted_at IS NULL
       GROUP BY m.id HAVING c >= 8 ORDER BY c DESC LIMIT 1`,
    )
    .get(tc.spaceId) as { id: number; label: string; c: number } | undefined;
  if (hub) {
    const cand = fresh({
      key: `hub:${hub.id}`,
      title: `Landmark: “${hub.label}”`,
      icon: "🌌",
      focusId: hub.id,
      lore: `The constellation “${hub.label}” has grown dense enough — ${hub.c} memories — to be a landmark of your galaxy. A whole region of your mind you can now navigate by.`,
      reason: `constellation "${hub.label}" reached ${hub.c} members`,
    });
    if (cand) return cand;
  }

  // 2) The brightest nexus — a memory that's become richly connected (degree ≥ 10).
  const nexus = s
    .prepare(
      `SELECT n.id AS id, n.label AS label,
        (SELECT COUNT(*) FROM edges e WHERE e.space_id = n.space_id AND (e.source = n.id OR e.target = n.id)) AS deg
       FROM nodes n WHERE n.space_id = ? AND n.deleted_at IS NULL AND (n.kind IS NULL OR n.kind = 'memory')
       ORDER BY deg DESC LIMIT 1`,
    )
    .get(tc.spaceId) as { id: number; label: string; deg: number } | undefined;
  if (nexus && nexus.deg >= 10) {
    const cand = fresh({
      key: `nexus:${nexus.id}`,
      title: `Brightest Nexus: “${nexus.label}”`,
      icon: "🌟",
      focusId: nexus.id,
      lore: `“${nexus.label}” has drawn ${nexus.deg} connections into its orbit — the most gravitational memory in your galaxy right now. So much falls toward it that it lights the space around it.`,
      reason: `"${nexus.label}" reached degree ${nexus.deg}`,
    });
    if (cand) return cand;
  }

  // 3) A sector that's crossed a landmark size (25 / 50 / 100 memories of one type).
  const sector = s
    .prepare(
      `SELECT type, COUNT(*) AS c FROM nodes
       WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind = 'memory')
       GROUP BY type ORDER BY c DESC LIMIT 1`,
    )
    .get(tc.spaceId) as { type: string; c: number } | undefined;
  if (sector) {
    const milestone = [100, 50, 25].find((m) => sector.c >= m);
    if (milestone) {
      const cand = fresh({
        key: `sector:${sector.type}:${milestone}`,
        title: `A Sector Comes of Age`,
        icon: "🗺️",
        focusId: null,
        lore: `Your “${sector.type}” region has crossed ${milestone} bodies — no longer a scattering of stars but a true sector of your cosmos, with a gravity all its own.`,
        reason: `sector "${sector.type}" reached ${milestone}`,
      });
      if (cand) return cand;
    }
  }

  return null;
}

export const chartDiscoveryTool: Tool = {
  name: "chart_discovery",
  description:
    "Report the Codex field notes (galaxy discoveries) recorded so far, plus any notable structure that is ready to be charted. Call with NO arguments in conversation (\"what discoveries are in my Codex?\") — read-only: it lists what exists and never records a new entry. (The router's detector-shaped call, carrying a candidate key/title/lore, still records a discovery exactly as before.)",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Router-internal candidate key; omit in conversation." },
      title: { type: "string", description: "Router-internal; omit in conversation." },
      lore: { type: "string", description: "Router-internal; omit in conversation." },
      icon: { type: "string", description: "Router-internal; omit in conversation." },
      focusId: { type: "number", description: "Router-internal; omit in conversation." },
    },
    required: [],
    additionalProperties: false,
  },

  detect(tc: ToolContext): ToolInvocation[] {
    // Once per SPACE-local day (owner rule 2026-10-21 — the guard follows
    // the user's own day, never the UTC day of the stored timestamp).
    if (actionFiredToday(tc.ctx.handle, tc.spaceId, "tool:chart_discovery", new Date(tc.now))) return [];
    const cand = findDiscovery(tc);
    if (!cand) return [];
    return [{ tool: "chart_discovery", args: { ...cand }, reason: cand.reason }];
  },

  async run(tc: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
    const key = String(args.key ?? "");
    // Telegram Parity Phase 4 — conversational path: no candidate key means
    // the model is ASKING about the Codex, not charting. Read-only: list
    // what is recorded (+ any uncharted candidate findDiscovery() sees,
    // reported as pending — never written from conversation). The router
    // path below (key present) records the discovery exactly as before.
    if (!key) {
      const existing = new CodexDiscoveriesRepo(tc.ctx.handle, tc.spaceId).list();
      const lines = [
        `CODEX DISCOVERIES (exact, from the Codex — ${existing.length} field note(s) recorded):`,
        ...existing.slice(0, 20).map((d) => `  - ${d.icon} ${d.title} (charted ${d.createdAt.slice(0, 10)}): ${d.lore}`),
        ...(existing.length > 20 ? [`  … and ${existing.length - 20} more (list truncated at 20).`] : []),
      ];
      if (existing.length === 0) lines.push("  (none yet — the Codex fills as the galaxy grows.)");
      const pending = findDiscovery(tc);
      if (pending) {
        lines.push(`Not yet charted: a new discovery is ready — "${pending.title}" (${pending.reason}). It will be recorded on the next maintenance pass; do NOT claim it is already in the Codex.`);
      }
      return {
        ok: true,
        summary: `chart_discovery (conversational): ${existing.length} recorded${pending ? ", 1 pending" : ""}`,
        message: lines.join("\n"),
      };
    }
    const added = new CodexDiscoveriesRepo(tc.ctx.handle, tc.spaceId).add({
      key,
      title: String(args.title ?? "A discovery"),
      lore: String(args.lore ?? ""),
      icon: String(args.icon ?? "✦"),
      focusId: typeof args.focusId === "number" ? args.focusId : null,
    });
    if (!added) return { ok: false, summary: `already charted ${key}` };
    const msg = `✦ Charted a new Codex entry: ${String(args.title)}. Take a look.`;
    let delivered = false;
    try {
      await tc.notify(msg);
      delivered = true;
    } catch {
      /* logged regardless */
    }
    return { ok: true, summary: `charted "${String(args.title)}"`, delivered, message: msg };
  },
};
