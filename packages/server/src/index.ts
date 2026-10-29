import { buildContext } from "./context.js";
import { createApp } from "./api/server.js";
import { NodesRepo } from "./repositories/nodes.repo.js";
import { setTelegramWebhook, sendDailyDigests, tgSend, createTelegramSpaceSender, type TelegramSpaceSendReport } from "./telegram/bot.js";
import { runToolRouter } from "./agent/tools/router.js";
import { createPolicyNotify, sweepNotifications } from "./agent/notify/boundary.js";
import { runEternityContact } from "./npcs/eternityContact.js";
import { createEternityVoice } from "./npcs/eternityVoiceProvider.js";
import { sweepPendingPushes } from "./push/outbox.js";
import { captureEpisode } from "./agent/episodic.js"; // W2: job_run capture (§5.1)
import { selectJob, executeJob, researchEnabled } from "./maintenance/agent.js";
import { nextAutonomyBatch } from "./maintenance/autonomyBatch.js";
import { evolveLore } from "./lore/engine.js";
import { refreshPersona } from "./persona/derive.js";
import { reconcileConstellations } from "./analysis/constellationReconcile.js";
import { proposeDreamCycle } from "./analysis/dreamCycle.js";
import { runConsolidation } from "./agent/consolidation/run.js";
import type { LlmJudge } from "./agent/userModel.js";
import { stepUndertaking } from "./analysis/undertakings.js";
import { applyCognitiveGravity } from "./analysis/cognitive.js";
import { sweepWorldProposals } from "./worlds/mutation.js";
import { sweepApprovals } from "./agent/approvals.js";
import { sweepDuplicates } from "./analysis/dedup.js";
import { sweepWorkingMemory } from "./analysis/workingMemory.js";
import { generateInquiry } from "./analysis/inquiry.js";
import { maybeGenerateChapter, backfillInitialChapter } from "./analysis/timeline.js";
import { stepIdeas, splitRipeIdea } from "./analysis/ideas.js";
import { stepSkills } from "./analysis/skills.js";
import { stepIdentities } from "./analysis/identity.js";
import { mergeDuplicatePeople } from "./analysis/people.js";
import { rollPastEvents } from "./analysis/future.js";
import { stepDrives } from "./analysis/drives.js";
import { DEFAULT_SPACE } from "./db/schema.js";
import { EconomyRepo } from "./economy.js";
import { spaceTimezone, localDay } from "./agent/notify/policy.js";

const PORT = Number(process.env.PORT ?? 3001);

const ctx = await buildContext();
const app = createApp(ctx);
// Eternity's own voice: the free Gemini key when one is configured, else the shared provider, else none (his own lines).
const eternityVoice = await createEternityVoice(ctx);
console.log(`[eternity] voice: ${eternityVoice ? eternityVoice.via : "offline lines (no AI key)"}`);

// Verbatim-Recall V1 boot recovery (sections 12E / 18.3 / 18.4.4): log
// the preserved-source count, backfill chunk vectors, and resume any
// sources a crash left pending. Best-effort and non-blocking — a
// recovery failure never stops the server from serving.
void (async () => {
  try {
    const { logPreservedSourceCount, backfillChunkVec, recoverPendingSources } = await import("./sources/recovery.js");
    logPreservedSourceCount(ctx.handle);
    const indexed = await backfillChunkVec(ctx.handle, ctx.embeddings);
    if (indexed > 0) console.log(`[sources] chunk vec backfill: ${indexed} chunk(s) indexed`);
    const rec = await recoverPendingSources(ctx.handle, { embeddings: ctx.embeddings, llm: ctx.llm }, ctx);
    if (rec.reclaimed > 0 || rec.resumed > 0) {
      console.log(`[sources] recovery: ${rec.reclaimed} lease(s) reclaimed, ${rec.resumed} source(s) resumed`);
    }
  } catch (err) {
    console.warn("[sources] boot recovery failed (server continues):", err);
  }
})();

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] embeddings: ${ctx.embeddings.model} (${ctx.embeddings.dim}d)`);
  console.log(
    `[server] llm: ${ctx.llm.model} ${ctx.llm.available ? "(active)" : "(heuristic fallback — set GEMINI_API_KEY)"}`,
  );
});

// Graceful shutdown: on a deploy, Fly sends SIGTERM and needs the machine to
// release the /data volume so the new machine can mount it. If we don't close the
// SQLite handle, the volume stays busy ("EBUSY unmounting /data") and the deploy
// stalls / health checks flap. Checkpoint the WAL + close the DB, then exit fast.
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} — shutting down gracefully`);
  const done = () => {
    try {
      ctx.handle.sqlite.pragma("wal_checkpoint(TRUNCATE)"); // flush WAL into the db file
    } catch { /* best-effort */ }
    try {
      ctx.handle.sqlite.close(); // release the /data file handle so the volume can unmount
    } catch { /* best-effort */ }
    process.exit(0);
  };
  // Stop accepting new connections, then close the DB. Hard-exit after 8s so a
  // lingering keep-alive socket can never hold the volume busy indefinitely.
  server.close(done);
  setTimeout(done, 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Telegram: if a bot token + webhook secret + public URL are set, point Telegram
// at our webhook on boot. Without all three we stay silent (feature is opt-in).
const tgToken = process.env.TELEGRAM_BOT_TOKEN;
const tgSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, "");
if (tgToken && tgSecret && publicUrl) {
  void setTelegramWebhook(tgToken, `${publicUrl}/api/telegram/webhook/${tgSecret}`, tgSecret);
} else if (tgToken) {
  console.log("[telegram] set TELEGRAM_WEBHOOK_SECRET and PUBLIC_URL to auto-register the webhook");
}

// Soumaya background heartbeat: light, server-side upkeep so the brain stays tidy
// even when no client is open. STRICTLY FREE work — it never calls the LLM, so it
// can never drain the API key (all token-spending jobs stay client + Research Mode
// gated). For now it expires due action items across every space (see
// expireActionItems below).
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS ?? 1000 * 60 * 15);
function expireActionItems() {
  // Sweep every brain: find due action items across all spaces, then expire each
  // within its own space (so the log + deletion stay correctly scoped).
  const due = ctx.handle.sqlite
    .prepare(
      `SELECT id, label, space_id AS spaceId FROM nodes
       WHERE kind = 'action' AND deleted_at IS NULL AND expires_at <= ?`,
    )
    .all(new Date().toISOString()) as { id: number; label: string; spaceId: string }[];
  if (due.length === 0) return;

  const bySpace = new Map<string, { id: number; label: string }[]>();
  for (const d of due) {
    if (!bySpace.has(d.spaceId)) bySpace.set(d.spaceId, []);
    bySpace.get(d.spaceId)!.push({ id: d.id, label: d.label });
  }

  for (const [spaceId, items] of bySpace) {
    const summary = items.map((d) => d.label).join("; ");
    try {
      ctx.handle.sqlite
        .prepare(
          `INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, ?, ?, ?)`,
        )
        .run(
          spaceId,
          "action_expired",
          `Action items timed out: ${summary}`,
          JSON.stringify(items.map((d) => d.id)),
        );
    } catch {
      /* logging is best-effort */
    }
    const repo = new NodesRepo(ctx.handle, spaceId);
    for (const d of items) repo.delete(d.id);
  }
  console.log(`[soumaya] expired ${due.length} action item(s) across ${bySpace.size} brain(s)`);
}

setInterval(() => {
  try {
    // Expire timed-out action items (summarized into the activity log).
    // (The old heartbeat also pruned one weak edge GLOBALLY — cross-tenant
    // mutation from global state, duplicating the autonomy loop's per-space,
    // logged pruning job at a different threshold. Dropped; the loop owns it.)
    expireActionItems();
  } catch (err) {
    console.error("[soumaya] heartbeat error:", err);
  }
}, HEARTBEAT_MS);
// Sweep action items more often than the main heartbeat so they expire on time.
setInterval(() => {
  try {
    expireActionItems();
  } catch (err) {
    console.error("[soumaya] action sweep error:", err);
  }
}, 60_000);

// Soumaya's tool-router (docs/SOUMAYA_TOOLS.md): every 60s each brain lets her tools
// act on their own — starting with firing due reminders. Free + offline; delivery
// goes to Telegram if the brain is linked, and every action is logged either way.
setInterval(() => {
  void (async () => {
    try {
      const rows = ctx.handle.sqlite.prepare(`SELECT id FROM spaces`).all() as { id: string }[];
      const spaceIds = rows.length > 0 ? rows.map((r) => r.id) : [DEFAULT_SPACE];
      // Phase 2: all proactive sends go through the notification policy boundary.
      // Tools pass metadata; the policy decides send-now vs queue vs drop, and the
      // outbox sweeper below delivers deferred items. Raw send is Telegram-only.
      // Batch A (RE-01/RE-02): the raw sender classifies outcomes —
      // a refused send is reported "refused" (definite), a no-response
      // send "ambiguous", and a space with no linked chat throws
      // NoRecipientsError — so the boundary records delivery honestly.
      // H-2 (REG-191): the sender returns a per-chat report, so a retry
      // re-attempts only the chats still pending.
      const rawSend = tgToken
        ? createTelegramSpaceSender(ctx.handle, tgToken)
        : async (_spaceId: string, _text: string): Promise<TelegramSpaceSendReport> => ({ attempted: [] });
      const policyNotify = createPolicyNotify({
        sqlite: ctx.handle.sqlite,
        handle: ctx.handle, // W2: DbHandle for episode capture
        send: rawSend,
        audit: (spaceId, action, detail) => {
          // Content-free audit via agent_logs. Columns: action, description, targets.
          try {
            ctx.handle.sqlite
              .prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, ?, ?, '[]')`)
              .run(spaceId, action, detail);
          } catch { /* audit must never break delivery */ }
        },
        workerId: `tick-${process.pid}`,
      });
      const notify = tgToken ? policyNotify : undefined;
      for (const spaceId of spaceIds) {
        // Eternity reaches out on his own (wake-up + one visitation a day; docs/specs/eternity-autonomy-2026-10-29.md
        // §2c): the in-app inbox always, Telegram through the same policy boundary as every proactive send.
        try {
          const contact = await runEternityContact(ctx.handle, spaceId, { voice: eternityVoice, notify: tgToken ? policyNotify : undefined });
          if (contact.sent) console.log(`[eternity] ${spaceId.slice(0, 8)}: ${contact.sent} (${contact.reason})`);
        } catch (err) {
          console.error("[eternity] contact error:", err);
        }
        const results = await runToolRouter(ctx, spaceId, { notify });
        const acted = results.filter((r) => r.ok).length;
        if (acted > 0) {
          console.log(`[tools] ${spaceId.slice(0, 8)}: ${acted} tool action(s)`);
          // W2 §5.1: router tick WITH findings — capture after the tick.
          // Ticks with no findings are not captured (§5.3). Best-effort,
          // never throws, never blocks the sweep.
          void Promise.resolve()
            .then(() =>
              captureEpisode(ctx.handle, spaceId, {
                kind: "job_run",
                summary: `Background tool-router tick fired ${acted} tool action(s)`,
              }),
            )
            .catch(() => {});
        }
      }
      // Phase 2: deliver queued notifications + recover crashed leases.
      if (tgToken) {
        const sweep = await sweepNotifications(
          {
            sqlite: ctx.handle.sqlite,
            handle: ctx.handle, // W2: DbHandle for episode capture
            send: rawSend,
            audit: (spaceId, action, detail) => {
              try {
                ctx.handle.sqlite
                  .prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, ?, ?, '[]')`)
                  .run(spaceId, action, detail);
              } catch { /* audit must never break delivery */ }
            },
            workerId: `sweep-${process.pid}`,
          },
          new Date()
        );
        if (sweep.sent > 0 || sweep.ambiguous > 0 || sweep.failed > 0 || sweep.retried > 0 || sweep.dropped > 0) {
          console.log(`[notify] sweep: ${sweep.sent} sent, ${sweep.retried} retried, ${sweep.failed} failed, ${sweep.ambiguous} ambiguous, ${sweep.dropped} dropped, ${sweep.queued} queued`);
        }
      }
      // Web push (Round 3 policy follow-up): drain policy-deferred pushes
      // on the same tick — deliberately OUTSIDE the tgToken gate above, so
      // push-only brains (no Telegram configured) still receive pushes
      // the policy held back for quiet hours / the daily cap. Strict
      // no-op when VAPID is unconfigured.
      try {
        const pushSweep = await sweepPendingPushes(ctx.handle, { workerId: `push-sweep-${process.pid}` });
        if (pushSweep.sent > 0 || pushSweep.ambiguous > 0 || pushSweep.failed > 0 || pushSweep.dropped > 0) {
          console.log(`[push] sweep: ${pushSweep.sent} sent, ${pushSweep.deferred} deferred, ${pushSweep.failed} failed, ${pushSweep.dropped} dropped, ${pushSweep.ambiguous} ambiguous`);
        }
      } catch (err) {
        console.error("[push] sweep error:", err);
      }
    } catch (err) {
      console.error("[tools] router sweep error:", err);
    }
  })();
}, 60_000);

// 24/7 autonomy (Phase C): the thinking agent, server-side. Opt-in via AUTONOMY=on.
// Every tick it iterates each brain, picks ONE meaningful job and runs it — using
// the SAME selection/execution + gating as the browser loop (maintenance/agent.ts):
// LLM-backed work needs Research Mode + USD budget; expansion also needs Fuel; free
// upkeep always runs. So with Research Mode off it just keeps brains tidy for free,
// and it can never exceed the budget. Patrol (a pure no-op log) is skipped to avoid
// log spam. A re-entrancy guard prevents overlapping ticks if an LLM job runs long.
// On by default now (the "while you were away" companion needs her working in the
// background). Fully gated — free upkeep always runs, but paid/LLM work still needs
// Research Mode + budget + Fuel, and withClaim prevents double-running with a browser
// tab — so it can never overspend. Set AUTONOMY=off to disable entirely.
if (process.env.AUTONOMY !== "off") {
  const AUTONOMY_MS = Number(process.env.AUTONOMY_MS ?? 1000 * 60 * 5);
  // Bounded, rotating per-tick space batch (see autonomyBatch.ts's own doc comment):
  // with the default cap, a deployment with <= AUTONOMY_MAX_SPACES_PER_TICK spaces
  // still processes every space every tick (no behavior change from before this
  // existed) — only once the tenant count actually grows past the cap does this
  // bound per-tick work and rotate fairly through the full list across ticks,
  // instead of the same early rows (by id order) winning forever while a slow tick
  // starves everything after them. In-memory only — see the module for why a
  // restart resetting it to the start of the list is harmless.
  const AUTONOMY_MAX_SPACES_PER_TICK = Number(process.env.AUTONOMY_MAX_SPACES_PER_TICK ?? 20);
  let autonomyCursor = 0;
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const rows = ctx.handle.sqlite.prepare(`SELECT id FROM spaces ORDER BY id ASC`).all() as { id: string }[];
      const allSpaceIds = rows.length > 0 ? rows.map((r) => r.id) : [DEFAULT_SPACE];
      const { batch: spaceIds, nextCursor } = nextAutonomyBatch(allSpaceIds, autonomyCursor, AUTONOMY_MAX_SPACES_PER_TICK);
      autonomyCursor = nextCursor;
      // Per-tick ceiling on cloud-LLM jobs across ALL brains, so a deployment with many
      // spaces can't fire a burst of paid work before the USD counter catches up.
      const MAX_PAID_PER_TICK = Number(process.env.AUTONOMY_MAX_PAID_PER_TICK ?? 4);
      const PAID = new Set(["synthesis", "merging", "research", "sector_vibe", "daily_log"]);
      let paidThisTick = 0;
      for (const spaceId of spaceIds) {
        // Keep the auto-derived "About Me" persona current (free, throttled to ~6h).
        try {
          refreshPersona(ctx.handle, spaceId);
        } catch (e) {
          console.error("[autonomy] persona refresh failed:", e);
        }
        // Constellation re-evaluation (free, offline): pull memories that have drifted
        // into a constellation's gravity in as visible members, a few at a time.
        try {
          reconcileConstellations(ctx.handle, spaceId);
        } catch (e) {
          console.error("[autonomy] constellation reconcile failed:", e);
        }
        // Dream cycle (Level 2): once per SPACE-local day per brain, consolidate the densest
        // cluster into a durable belief. LLM when Research Mode + budget allow (counts
        // toward the paid ceiling); otherwise a free offline template. Additive-only.
        // Phase 4: the belief is PROPOSED, not written — the brain's own mutation
        // needs the owner's yes (kind 'brain_belief' in the approvals inbox).
        try {
          const today = localDay(new Date(), spaceTimezone(ctx.handle.sqlite, spaceId));
          const dreamt = ctx.handle.sqlite
            .prepare(`SELECT last_dream_date FROM space_meta WHERE space_id = ?`)
            .get(spaceId) as { last_dream_date: string | null } | undefined;
          if (dreamt?.last_dream_date !== today) {
            const canPay =
              researchEnabled(ctx, spaceId) && !ctx.usage.overBudget() && paidThisTick < MAX_PAID_PER_TICK;
            const proposed = await proposeDreamCycle(ctx, spaceId, canPay);
            if (proposed != null) {
              if (canPay) paidThisTick++;
              ctx.handle.sqlite
                .prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`)
                .run(spaceId);
              ctx.handle.sqlite
                .prepare(`UPDATE space_meta SET last_dream_date = ? WHERE space_id = ?`)
                .run(today, spaceId);
              // Log the dream so it's VISIBLE (activity feed + a "she dreamed" notification) —
              // background intelligence must announce itself, not run silently.
              // The proposal title carries the distilled belief label; no node
              // exists yet, so there is nothing to read back from nodes.
              ctx.handle.sqlite
                .prepare(`INSERT INTO agent_logs (space_id, agent, action, description, targets) VALUES (?, 'soumaya', 'dream', ?, ?)`)
                .run(spaceId, `Dreamed a belief for your approval: "${proposed.proposal.title}"`, JSON.stringify([proposed.proposal.id]));
              console.log(`[autonomy] ${spaceId.slice(0, 8)}: proposed belief #${proposed.proposal.id}`);
            }
          }
        } catch (e) {
          console.error("[autonomy] dream cycle failed:", e);
        }
        // Phase 4 (§17 rail): the scheduled sweep — proposals wait quietly
        // (no expiry, no forced decision); the sweep retries approved-but-
        // unapplied proposals and surfaces pending counts. It also runs the
        // tool-approval sweep, so pending approvals of both kinds surface in
        // the one inbox. Background context: no conversational principal,
        // no-op notify (a retried tool's notification has nowhere to go from
        // a sweep; its executed status is recorded and visible).
        try {
          const world = await sweepWorldProposals(ctx, spaceId);
          const approvals = await sweepApprovals({
            ctx,
            spaceId,
            now: Date.now(),
            notify: async () => {},
          });
          if (world.pending > 0 || world.approvedUnapplied > 0 || approvals.expired > 0 || approvals.retried > 0) {
            console.log(
              `[autonomy] ${spaceId.slice(0, 8)}: sweep world=${JSON.stringify(world)} approvals=${JSON.stringify(approvals)}`,
            );
          }
        } catch (e) {
          console.error("[autonomy] proposal sweep failed:", e);
        }
        // W3 consolidation (sibling to the dream cycle — a SEPARATE job
        // with its own claim/window/state in consolidation_runs; the two
        // are never merged: dream = world/nodes → belief nodes, W3 =
        // user/episodes → user_model). Quiet-hours + once-per-window
        // gating lives inside runConsolidation (space-local window from
        // the Phase 2 policy); skip outcomes are silent. LLM work is
        // bounded by the run's own per-space ledger
        // (space_meta.w3_llm_budget); with Research Mode/budget off the
        // adapters are withheld and Phases A+B + template C still run
        // (§14). A+B never depend on the LLM.
        try {
          const canPayW3 =
            researchEnabled(ctx, spaceId) && !ctx.usage.overBudget() && paidThisTick < MAX_PAID_PER_TICK;
          const w3Judge: LlmJudge = async (input) => {
            const r = await ctx.llm.detectContradiction(
              { label: input.candidate.slice(0, 80), content: input.candidate },
              { label: input.entry.content.slice(0, 80), content: input.entry.content },
              0,
            );
            return r.conflict ? "contradiction" : "compatible";
          };
          const w3Outcome = await runConsolidation(ctx.handle, spaceId, {
            llmJudge: canPayW3 ? w3Judge : null,
            extractor:
              canPayW3 && ctx.llm.consolidate
                ? async (cands) => {
                    const out = await ctx.llm.consolidate!(
                      cands.map((c) => ({
                        label: c.summary.slice(0, 80),
                        content: `${c.summary} ${c.detail ?? ""}`,
                      })),
                    );
                    return [
                      {
                        content: out.belief,
                        slot: "belief",
                        topicLabels: [],
                        route: "self" as const,
                        episodeIds: cands.map((c) => c.episodeId),
                      },
                    ];
                  }
                : null,
          });
          if (w3Outcome.status !== "skipped") {
            if (canPayW3) paidThisTick++;
            console.log(`[autonomy] ${spaceId.slice(0, 8)}: w3 consolidation ${w3Outcome.status}`);
          }
        } catch (e) {
          console.error("[autonomy] w3 consolidation failed:", e);
        }
        // Cognitive gravity (free, offline): pull memories toward the goals /
        // identity / skills they support, so the galaxy models what you're working
        // toward, not just what you remember.
        // Her real background work BURNS a little Fuel, so the gauge visibly drains as
        // she tidies your galaxy (it used to only ever go up unless Research Mode was on).
        // Bounded, and it self-recovers via regen + what you earn logging memories.
        const fuel = new EconomyRepo(ctx.handle, spaceId);
        let upkeepSpent = 0;
        let gravityDone = 0;
        let dupsDone = 0;
        try {
          gravityDone = applyCognitiveGravity(ctx, spaceId);
          if (gravityDone > 0) {
            const cost = Math.min(gravityDone, 8) * 0.06;
            fuel.spend(cost);
            upkeepSpent += cost;
          }
        } catch (e) {
          console.error("[autonomy] cognitive gravity failed:", e);
        }
        // De-duplication (free, offline): true-merge near-identical memories so the
        // galaxy doesn't sprawl with redundant copies. Bounded per tick; nothing lost.
        try {
          dupsDone = await sweepDuplicates(ctx, spaceId);
          if (dupsDone > 0) {
            const cost = dupsDone * 0.35;
            fuel.spend(cost);
            upkeepSpent += cost;
            console.log(`[autonomy] ${spaceId.slice(0, 8)}: merged ${dupsDone} duplicate memor(ies)`);
          }
        } catch (e) {
          console.error("[autonomy] dedup sweep failed:", e);
        }
        // Give the Fuel drain a VISIBLE cause: log meaningful upkeep to her activity feed
        // (Night Replay / the logs view) so the gauge never ticks down mysteriously.
        if (upkeepSpent >= 0.3) {
          try {
            const bits = [
              gravityDone > 0 ? `drew ${gravityDone} gravity link${gravityDone === 1 ? "" : "s"}` : "",
              dupsDone > 0 ? `merged ${dupsDone} duplicate${dupsDone === 1 ? "" : "s"}` : "",
            ].filter(Boolean);
            ctx.handle.sqlite
              .prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'upkeep', ?, '[]')`)
              .run(spaceId, `Tidied your galaxy — ${bits.join(", ")} (−${upkeepSpent.toFixed(1)}⛽ upkeep).`);
          } catch { /* best-effort */ }
        }
        // Working Memory (Cognitive Layer Phase 2): decay the mind space — evaporate
        // spent thought-motes and consolidate the ones that kept coming back into
        // real memories. Free/offline (promotion only embeds locally).
        try {
          const wm = await sweepWorkingMemory(ctx, spaceId);
          if (wm.promoted > 0) {
            console.log(`[autonomy] ${spaceId.slice(0, 8)}: consolidated ${wm.promoted} thought(s)`);
          }
        } catch (e) {
          console.error("[autonomy] working-memory sweep failed:", e);
        }
        // Proactive intelligence (free, offline): notice a new structural connection
        // (a memory bridging two people/goals, sitting near an anchor, or an emerging
        // theme) and raise ONE grounded question for the user to answer.
        try {
          if (generateInquiry(ctx, spaceId) != null) fuel.spend(0.25);
        } catch (e) {
          console.error("[autonomy] inquiry generation failed:", e);
        }
        // The Chronicle (free, offline, deterministic): when there's REAL change
        // (blended momentum + emotion trend + milestones) and the cadence allows it
        // (min gap + monthly cap → ~1-3/month), write a new life-timeline chapter.
        try {
          // Seed the opening chapter from existing history once (established brains
          // aren't blank), then write new chapters as real change accrues.
          const seeded = backfillInitialChapter(ctx, spaceId);
          if (seeded) console.log(`[autonomy] ${spaceId.slice(0, 8)}: seeded opening chapter "${seeded.title}"`);
          const chapter = maybeGenerateChapter(ctx, spaceId);
          if (chapter) console.log(`[autonomy] ${spaceId.slice(0, 8)}: wrote chapter "${chapter.title}" (${chapter.trend})`);
        } catch (e) {
          console.error("[autonomy] chapter generation failed:", e);
        }
        // Ideas lifecycle (Cognitive Layer Phase 3, free/offline): grow supported
        // ideas, dim + archive ignored ones, merge duplicates. Promotion to a goal
        // stays user-triggered.
        try {
          stepIdeas(ctx, spaceId);
          // Branch a two-thread idea into two (offline-safe naming; skips over-budget).
          await splitRipeIdea(ctx, spaceId);
        } catch (e) {
          console.error("[autonomy] ideas step failed:", e);
        }
        // Skills leveling (Cognitive Layer Phase 4, free/offline): brighten + level
        // up skills from accumulated practice (supporting memories).
        try {
          stepSkills(ctx, spaceId);
        } catch (e) {
          console.error("[autonomy] skills step failed:", e);
        }
        // Identity core (Cognitive Layer Phase 5, free/offline): re-weigh each
        // identity by the memories that affirm vs contest it, brightening/dimming it.
        // After gravity so a negated mention's mis-added supports edge gets corrected.
        try {
          stepIdentities(ctx, spaceId);
        } catch (e) {
          console.error("[autonomy] identity step failed:", e);
        }
        // People (Cognitive Layer Phase 6, free/offline): keep the roster clean by
        // merging duplicate person entities (same name) into one.
        try {
          mergeDuplicatePeople(ctx, spaceId);
        } catch (e) {
          console.error("[autonomy] people merge failed:", e);
        }
        // Phase 7 (free/offline): roll past-due future events into memory, and
        // advance drives — fulfil/expire intentions, brighten motivations.
        try {
          rollPastEvents(ctx, spaceId);
          stepDrives(ctx, spaceId);
        } catch (e) {
          console.error("[autonomy] phase-7 step failed:", e);
        }
        // Undertakings (Level 2): a multi-day arc so her autonomy has narrative.
        // Free (advances by elapsed days, tends one relevant memory per step);
        // start/finish are logged so the user sees the arc begin and complete.
        try {
          const event = stepUndertaking(ctx, spaceId);
          if (event) {
            ctx.handle.sqlite
              .prepare(`INSERT INTO agent_logs (space_id, action, description, targets) VALUES (?, 'undertaking', ?, '[]')`)
              .run(spaceId, event);
          }
        } catch (e) {
          console.error("[autonomy] undertaking step failed:", e);
        }
        const job = await selectJob(ctx, spaceId);
        if (!job || job.type === "patrol") continue; // skip the no-op patrol fallback
        // Once the per-tick paid budget is spent, only free upkeep runs this tick.
        if (PAID.has(job.type) && paidThisTick >= MAX_PAID_PER_TICK) continue;
        if (PAID.has(job.type)) paidThisTick++;
        const detail = await executeJob(ctx, spaceId, job);
        if (detail) {
          console.log(`[autonomy] ${spaceId.slice(0, 8)}: ${job.type}`);
          // Lore mutates as memories change: append a free heuristic chapter to the
          // worked memory so its story grows on its own over time.
          const target = job.targets[0];
          if (target != null) {
            const trig = job.type === "merging" ? "merged" : job.type === "synthesis" ? "linked" : "evolved";
            try {
              evolveLore(ctx.handle, spaceId, "memory", String(target), trig);
            } catch (e) {
              console.error("[autonomy] lore evolve failed:", e);
            }
          }
        }
      }
    } catch (err) {
      console.error("[autonomy] loop error:", err);
    } finally {
      running = false;
    }
  }, AUTONOMY_MS);
  console.log(`[autonomy] server-side loop ON (every ${AUTONOMY_MS}ms)`);
}

// Proactive nudges (Phase B): once per UTC day, push each linked chat its brain's
// daily digest (fresh memories, latent connections, cooling beacons). The sweep is
// idempotent within the day, so an hourly tick simply fires it on the first run
// after midnight UTC. Like the heartbeat, the digest is FREE (no LLM). Opt-in: it
// only runs when a bot token is set, and only chats that /link receive anything.
if (tgToken) {
  const DIGEST_SWEEP_MS = Number(process.env.TELEGRAM_DIGEST_SWEEP_MS ?? 1000 * 60 * 60);
  setInterval(() => {
    void sendDailyDigests(ctx, (chatId, text) => tgSend(tgToken, chatId, text))
      .then((sent) => {
        if (sent > 0) console.log(`[telegram] pushed daily digest to ${sent} chat(s)`);
      })
      .catch((err) => console.error("[telegram] digest sweep error:", err));
  }, DIGEST_SWEEP_MS);
}
