/**
 * G0 backup routes (increment B3) — mounted behind requireSpace in
 * api/server.ts and additionally OWNER-gated here: backups describe
 * (and snapshot) the whole deployment's database, so the status and
 * the triggers belong to the owner's brain only (the same convention
 * as the Voices console in routes/story.ts). Everyone else gets 403,
 * and the web panel simply isn't there for them.
 *
 * GET  /api/backup/status → the status report (status.ts): latest
 *      attempt vs latest-good as separate fields, latest-good age,
 *      next scheduled run, off-volume/index health. All times are ISO
 *      instants — the panel renders them in the viewer's local time.
 * POST /api/backup/run { golden?: boolean, preDeploy?: boolean } →
 *      run one attempt through the shared pipeline NOW: golden ⇒
 *      trigger 'golden' (tier golden, pinned at creation; golden
 *      wins if both flags are sent); preDeploy ⇒ trigger
 *      'pre_deploy' (the deploy gate's fresh pre-deploy backup,
 *      spec §10, increment B5 — recorded distinctly so status can
 *      show a deploy was preceded by its own backup); otherwise
 *      trigger 'manual'. This is the "back up now" surface the
 *      status panel's buttons call, and the trigger surface B5's
 *      deploy gate uses (backup/deployGate.ts).
 */
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../../context.js";
import { spaceOf } from "../middleware.js";
import { isOwnerSpace } from "../../auth/owner.js";
import { BackupRunBusyError, resolveBackupDir, runBackupPipeline } from "../../backup/runner.js";
import { buildBackupStatus } from "../../backup/status.js";

const RunBody = z.object({ golden: z.boolean().optional(), preDeploy: z.boolean().optional() });

export function backupRoutes(ctx: AppContext): Router {
  const r = Router();

  const requireOwner = (res: import("express").Response): boolean => {
    if (isOwnerSpace(spaceOf(res))) return true;
    res
      .status(403)
      .json({ error: "Backup status and controls are available to the owner's brain only." });
    return false;
  };

  r.get("/status", async (_req, res) => {
    if (!requireOwner(res)) return;
    try {
      res.json(await buildBackupStatus(ctx.handle));
    } catch (err) {
      // The builder is defensive about the off-volume index; anything
      // that still throws is a server fault, reported as one — never
      // dressed up as backup state.
      console.error("[backup] status build failed:", err);
      res.status(500).json({ error: "Backup status could not be built." });
    }
  });

  r.post("/run", async (req, res) => {
    if (!requireOwner(res)) return;
    const parsed = RunBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Body must be { golden?: boolean, preDeploy?: boolean }" });
      return;
    }
    const golden = parsed.data.golden === true;
    const preDeploy = parsed.data.preDeploy === true;
    try {
      const result = await runBackupPipeline(ctx.handle, {
        dir: resolveBackupDir(),
        trigger: golden ? "golden" : preDeploy ? "pre_deploy" : "manual",
        appCommit: process.env.GIT_COMMIT,
      });
      res.json({
        ok: result.offVolume !== "failed",
        offVolume: result.offVolume,
        failureStage: result.failureStage,
        failureDetail: result.failureDetail,
        retention: result.retention,
        retentionError: result.retentionError,
        attempt: {
          id: result.attempt.id,
          createdAt: result.attempt.createdAt,
          finishedAt: result.attempt.finishedAt,
          trigger: result.attempt.trigger,
          tier: result.attempt.tier,
          pinned: result.attempt.pinned,
          state: result.attempt.state,
          offVolumeOutcome: result.attempt.offvolumeOutcome,
          snapshotBytes: result.attempt.snapshotBytes,
        },
      });
    } catch (err) {
      if (err instanceof BackupRunBusyError) {
        // A scheduled/catch-up/manual run is already in flight — runs
        // never interleave (shared dir + index). An honest 409, not a
        // failure of this request's making.
        res.status(409).json({ error: "A backup run is already in progress — wait for it to finish, then try again." });
        return;
      }
      console.error("[backup] manual run failed:", err);
      res.status(500).json({ error: "The backup attempt could not be started." });
    }
  });

  return r;
}
