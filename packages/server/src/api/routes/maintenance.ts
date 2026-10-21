import { Router } from "express";
import { z } from "zod";
import { CODEX_STATIC_KEYS } from "@brain/shared";
import type { AppContext } from "../../context.js";
import { EconomyRepo, EARN_CODEX_DISCOVERY } from "../../economy.js";
import { CodexDiscoveriesRepo } from "../../repositories/codexDiscoveries.repo.js";
import { NodesRepo } from "../../repositories/nodes.repo.js";
import { StreakRepo } from "../../streak.js";
import { agentLogs, dailyLogs } from "../../db/schema.js";
import { spaceOf } from "../middleware.js";
import { eq, desc } from "drizzle-orm";
import { selectJob, executeJob, researchEnabled, setResearchEnabled } from "../../maintenance/agent.js";
import { activeUndertaking } from "../../analysis/undertakings.js";
import { toolHealthSummary } from "../../agent/tools/health.js";

const CompleteJobSchema = z.object({
  type: z.enum(["synthesis", "calibration", "patrol", "pruning", "harmonization", "research", "merging", "sector_vibe", "daily_log"]),
  targets: z.array(z.number()),
});

// Only an explicit allow-list of user-facing keys may be written through this public
// route (the raw `settings` table also holds the deployment's budget/usage counters).
// `research_enabled` is the one settable flag, and it's stored PER SPACE.
const SettingsWriteSchema = z.object({
  key: z.enum(["research_enabled"]),
  value: z.string().max(64),
});

// The rewardable Codex catalog lives in @brain/shared (CODEX_STATIC_KEYS) — the
// single source of truth the web client's Codex is also built from, so the two
// can no longer silently drift (IM-93: the old hand-mirrored copy here never
// gained the mind-* entries, five phenomena, or any field notes, and their
// claims were rejected 400). The two dynamic families are verified against the
// space's real data instead: constellation entries against its MOC hubs, and
// field notes against the discoveries Soumaya actually charted for it.
function isClaimableCodexKey(ctx: AppContext, spaceId: string, key: string): boolean {
  if (CODEX_STATIC_KEYS.has(key)) return true;
  const m = /^constellation-(\d+)$/.exec(key);
  if (m) {
    const hub = ctx.handle.sqlite
      .prepare(`SELECT 1 FROM nodes WHERE id = ? AND space_id = ? AND kind = 'moc' AND deleted_at IS NULL`)
      .get(Number(m[1]), spaceId);
    return hub != null;
  }
  const fn = /^fieldnote-(.+)$/.exec(key);
  if (fn) return new CodexDiscoveriesRepo(ctx.handle, spaceId).has(fn[1]!);
  return false;
}

export function maintenanceRoutes(ctx: AppContext): Router {
  const r = Router();

  /**
   * GET /api/maintenance/next-job
   * Returns the next "meaningful" task for the Soumaya agent. The selection
   * ladder + all token/fuel gating live in maintenance/agent.ts so the browser
   * loop and the server-side 24/7 loop choose jobs identically.
   */
  r.get("/next-job", async (req, res) => {
    const job = await selectJob(ctx, spaceOf(res));
    if (!job) {
      res.status(404).json({ error: "No nodes available for maintenance." });
      return;
    }
    res.json(job);
  });

  /**
   * POST /api/maintenance/complete-job
   * Commits the results of a maintenance task to the database.
   */
  r.post("/complete-job", async (req, res) => {
    const parsed = CompleteJobSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid job completion data" });
      return;
    }
    try {
      // Execution + logging + fuel all live in the shared agent service.
      const detail = await executeJob(ctx, spaceOf(res), parsed.data);
      res.json({ ok: detail != null, detail: detail ?? "No-op (target unavailable)." });
    } catch (err) {
      console.error("[maintenance] complete-job failed:", err);
      res.status(500).json({ error: "Job execution failed." });
    }
  });

  /**
   * GET /api/maintenance/logs
   * Returns recent activity logs.
   */
  r.get("/logs", async (req, res) => {
    const logs = await ctx.handle.db
      .select()
      .from(agentLogs)
      .where(eq(agentLogs.spaceId, spaceOf(res)))
      .orderBy(desc(agentLogs.id))
      .limit(50)
      .all();
    res.json(logs);
  });

  // Last-fired timestamp per autonomous tool — the Soumaya tab's "Autonomous systems"
  // diagnostics box, so a silently-dormant tool is a visible fact, not a surprise.
  r.get("/tool-health", (_req, res) => {
    res.json(toolHealthSummary(ctx.handle, spaceOf(res)));
  });

  /**
   * GET /api/maintenance/daily-log
   * Returns the most recent Captain's log.
   */
  r.get("/daily-log", async (req, res) => {
    const log = await ctx.handle.db
      .select()
      .from(dailyLogs)
      .where(eq(dailyLogs.spaceId, spaceOf(res)))
      .orderBy(desc(dailyLogs.id))
      .limit(1)
      .get();
    
    if (log) {
      res.json(log);
    } else {
      res.status(404).json({ error: "No daily log found" });
    }
  });

  /**
   * GET /api/maintenance/fuel -> this brain's Celestial Economy fuel.
   */
  r.get("/fuel", (_req, res) => {
    res.json(new EconomyRepo(ctx.handle, spaceOf(res)).toFuel());
  });

  /**
   * POST /api/maintenance/commission -> a PLAYER-CONTROLLED Fuel SINK. Spend Fuel to have
   * Soumaya do a valuable job on demand right now (instead of only her passive upkeep) —
   * this is what gives the currency a purpose so it doesn't just pin at the cap. "warm"
   * instantly tends your coldest memories (deterministic + offline). Costs COMMISSION_COST
   * Fuel; refuses if you can't afford it.
   */
  r.post("/commission", (req, res) => {
    const spaceId = spaceOf(res);
    const kind = String((req.body as { kind?: unknown })?.kind ?? "warm");
    const econ = new EconomyRepo(ctx.handle, spaceId);
    const COMMISSION_COST = 25;
    if (econ.toFuel().fuel < COMMISSION_COST) {
      res.status(402).json({ error: "Not enough Fuel", cost: COMMISSION_COST });
      return;
    }
    if (kind !== "warm") {
      res.status(400).json({ error: "Unknown commission" });
      return;
    }
    // The coldest memories = those tended (or created) longest ago.
    const cold = ctx.handle.sqlite
      .prepare(
        `SELECT id, label FROM nodes
         WHERE space_id = ? AND deleted_at IS NULL AND (kind IS NULL OR kind = 'memory')
         ORDER BY COALESCE(last_tended_at, created_at) ASC LIMIT 12`,
      )
      .all(spaceId) as { id: number; label: string }[];
    if (cold.length === 0) {
      res.status(400).json({ error: "Nothing to warm yet" });
      return;
    }
    econ.spend(COMMISSION_COST);
    const nodes = new NodesRepo(ctx.handle, spaceId);
    for (const c of cold) nodes.tend(c.id);
    res.json({ ok: true, warmed: cold.length, labels: cold.slice(0, 4).map((c) => c.label), fuel: econ.toFuel(), cost: COMMISSION_COST });
  });

  /**
   * POST /api/maintenance/fuel/burn { amount } -> spend Fuel her fast flight used.
   * Amount is clamped to a small ceiling so a crafted request can't drain the tank.
   */
  r.post("/fuel/burn", (req, res) => {
    const amount = Number((req.body as { amount?: unknown })?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: "amount must be a positive number" });
      return;
    }
    const econ = new EconomyRepo(ctx.handle, spaceOf(res));
    econ.spend(Math.min(amount, 5)); // per-call cap; ignores overspend (never negative)
    res.json(econ.toFuel());
  });

  /**
   * POST /api/maintenance/codex-claim { key } -> grant a one-time fuel reward for
   * discovering a Codex entry. Idempotent per (space, key) AND validated against
   * the real Codex catalog — client-invented keys would otherwise mint fuel and
   * bloat codex_claims forever.
   */
  r.post("/codex-claim", (req, res) => {
    const key = String(req.body?.key ?? "").slice(0, 80);
    const spaceId = spaceOf(res);
    if (!key || !isClaimableCodexKey(ctx, spaceId, key)) {
      res.status(400).json({ error: "Unknown codex entry." });
      return;
    }
    const existed = ctx.handle.sqlite
      .prepare(`SELECT 1 FROM codex_claims WHERE space_id = ? AND reward_key = ?`)
      .get(spaceId, key);
    if (existed) {
      res.json({ awarded: false, fuel: new EconomyRepo(ctx.handle, spaceId).get() });
      return;
    }
    ctx.handle.sqlite
      .prepare(`INSERT OR IGNORE INTO codex_claims (space_id, reward_key) VALUES (?, ?)`)
      .run(spaceId, key);
    const fuel = new EconomyRepo(ctx.handle, spaceId).add(EARN_CODEX_DISCOVERY);
    res.json({ awarded: true, fuel });
  });

  /**
   * GET /api/maintenance/undertaking -> her current multi-day arc (or null).
   */
  r.get("/undertaking", (_req, res) => {
    res.json(activeUndertaking(ctx, spaceOf(res)));
  });

  /**
   * GET /api/maintenance/streak -> this brain's daily-tending streak.
   */
  r.get("/streak", (_req, res) => {
    res.json(new StreakRepo(ctx.handle, spaceOf(res)).get());
  });

  /**
   * GET /api/maintenance/settings — only the user-facing flags, resolved for THIS
   * space. (The raw settings table also holds deployment counters/budget rows that
   * must not leak to tenants.)
   */
  r.get("/settings", (_req, res) => {
    res.json({ research_enabled: String(researchEnabled(ctx, spaceOf(res))) });
  });

  /**
   * POST /api/maintenance/settings — Research Mode is per-space now, so one brain
   * flipping it can't switch paid autonomous work on/off for every tenant.
   */
  r.post("/settings", (req, res) => {
    const parsed = SettingsWriteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Unsupported setting.", issues: parsed.error.issues });
      return;
    }
    setResearchEnabled(ctx, spaceOf(res), parsed.data.value === "true");
    res.json({ ok: true });
  });

  return r;
}
