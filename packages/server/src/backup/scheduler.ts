/**
 * G0 backup — in-app scheduler (increment B3; plan §1 K1).
 *
 * A plain interval loop in the always-on server process, following
 * the repo's existing loop pattern (heartbeat / autonomy): evaluate
 * every minute, and once immediately at boot. Each evaluation asks
 * the pure decision in schedule.ts — driven by the attempt RECORD in
 * the database, not by process memory — whether a run is due:
 *
 * - on time at the 03:30 America/New_York slot → trigger 'schedule';
 * - the slot passed with no attempt recorded (the app was down, or
 *   the latest-good has gone stale because a day was missed) →
 *   trigger 'catch_up', fired at the first evaluation that sees it —
 *   including the boot evaluation, so a missed day is never silently
 *   skipped. (Latest-good age itself is a status signal, not a
 *   trigger — see schedule.ts for the 25-hour-day reasoning.)
 *
 * Because the decision reads the database, a restart cannot duplicate
 * a slot (an attempt at/after the slot instant covers it) and cannot
 * lose one. An overlap guard keeps a slow run from stacking with the
 * next tick. NOTHING in an evaluation is fatal — not a pipeline throw
 * (the stages record operational failures on the attempt row
 * themselves) and not even a failure to read the attempt record:
 * evaluate() guards its whole body, because it is called
 * fire-and-forget and an escaping rejection would take the server
 * down. Worst case, a tick is skipped and logged.
 *
 * Kill switch: BACKUP_SCHEDULER=off (checked by the caller and here).
 */
import type { DbHandle } from "../db/client.js";
import { latestBackupAttemptCreatedMs } from "./service.js";
import { BackupRunBusyError, runBackupPipeline } from "./runner.js";
import {
  decideBackupRun,
  type BackupDecision,
  type BackupRunFacts,
} from "./schedule.js";

export interface BackupSchedulerDeps {
  handle: DbHandle;
  /** Directory local snapshots are written into (runner.resolveBackupDir). */
  dir: string;
  /** Evaluation interval. Default 60s. */
  tickMs?: number;
  /** Clock override (tests). */
  now?: () => Date;
  /** Pipeline override (tests). */
  runPipeline?: typeof runBackupPipeline;
  /** Log sink for run outcomes. Default console.log. */
  log?: (message: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface BackupSchedulerHandle {
  stop(): void;
  /** Run one evaluation now; resolves with the decision it acted on (null if one was already in flight, or if the evaluation itself failed and was skipped — it never rejects). */
  evaluate(): Promise<BackupDecision | null>;
}

export function startBackupScheduler(deps: BackupSchedulerDeps): BackupSchedulerHandle | null {
  const env = deps.env ?? process.env;
  if (env.BACKUP_SCHEDULER === "off") return null;
  const now = deps.now ?? (() => new Date());
  const runPipeline = deps.runPipeline ?? runBackupPipeline;
  const log = deps.log ?? ((message: string) => console.log(message));

  let running = false;
  let stopped = false;

  const evaluate = async (): Promise<BackupDecision | null> => {
    if (running || stopped) return null;
    // EVERYTHING in this body is guarded — including the facts read.
    // evaluate() is invoked fire-and-forget (boot + interval), so any
    // escape becomes an unhandled rejection, and Node's default for
    // those is to kill the whole server process. A scheduler that can
    // crash the app it protects has failed its only job: whatever goes
    // wrong here (locked DB, missing table, disk error) is logged and
    // the evaluation is skipped; the next tick retries.
    try {
      const facts: BackupRunFacts = {
        latestAttemptMs: latestBackupAttemptCreatedMs(deps.handle),
      };
      const decision = decideBackupRun(now(), facts);
      if (!decision.run) return decision;
      running = true;
      try {
        const result = await runPipeline(deps.handle, {
          dir: deps.dir,
          trigger: decision.trigger,
          tier: decision.tier,
        });
        log(
          `[backup] ${decision.trigger} run (${decision.tier}, slot ${decision.slotDateKey}) → ` +
            (result.offVolume === "promoted"
              ? "promoted (latest-good)"
              : result.offVolume === "not_configured"
                ? "verified locally — off-volume not configured"
                : `failed at ${result.failureStage}: ${result.failureDetail}`),
        );
        if (result.retentionError) {
          console.error(`[backup] retention after promotion failed: ${result.retentionError}`);
        }
      } catch (err) {
        if (err instanceof BackupRunBusyError) {
          // A manual/golden run holds the pipeline lock — this tick
          // simply stands down; the slot is covered by that attempt.
          log("[backup] tick skipped — a backup run is already in progress");
        } else {
          console.error("[backup] scheduled run error:", err);
        }
      } finally {
        running = false;
      }
      return decision;
    } catch (err) {
      console.error("[backup] scheduler evaluation failed — skipping this tick:", err);
      return null;
    }
  };

  const timer = setInterval(() => {
    // Belt and braces on top of evaluate()'s internal guard: the
    // rejection of a fire-and-forget call must be impossible.
    void evaluate().catch((err) => console.error("[backup] scheduler tick error:", err));
  }, deps.tickMs ?? 60_000);
  timer.unref?.();
  // Boot check: a slot missed while the app was down fires here, at
  // the first evaluation, instead of waiting for the next tick.
  void evaluate().catch((err) => console.error("[backup] scheduler boot check error:", err));

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    evaluate,
  };
}
