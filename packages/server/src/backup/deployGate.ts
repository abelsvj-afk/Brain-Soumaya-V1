/**
 * G0 backup — the deploy gate (increment B5; spec §10, plan §1/§4-B5).
 *
 * §10 preserved the manual deploy safeguard (a fresh export, a
 * brain.db backup, a downgrade acknowledgment) and required the
 * automatic system to be wired to it explicitly: DEPLOY REFUSES
 * WITHOUT A CURRENT LATEST-GOOD. This module is that wiring.
 *
 * WHERE THE GATE BITES — stated honestly. Production deploys happen
 * by merging to `main`, which Fly's native GitHub auto-deploy picks
 * up on its own; no in-repo code runs between the merge and Fly's
 * build, GitHub Actions is blocked on this account, and a boot-time
 * refusal inside the app would take the live brain down instead of
 * gating anything. So the gate is an OPERATOR-RUN check that must
 * PASS before the merge/deploy step (deploy-gate-cli.ts; the deploy
 * checklist in DEPLOYMENT.md makes it step zero). It refuses loudly
 * and specifically, and its PASS is the recorded precondition for
 * the deploy proceeding.
 *
 * WHAT IT CHECKS, in order:
 *  (a) CURRENT LATEST-GOOD (spec §10's condition, evaluated on the
 *      production status report from B3's buildBackupStatus):
 *      the off-volume store is configured; the off-volume INDEX —
 *      the copy a restore would actually use (G0-AC-05) — reads
 *      cleanly and names a latest-good; the app's local record names
 *      the SAME latest-good (no promotion crash-window divergence);
 *      and its age is within the staleness bound (STALE_AFTER_MS,
 *      24h — the same bound the status panel's `latestGoodStale`
 *      already applies; plan §1's RPO). Any failure refuses the
 *      deploy WITHOUT triggering a backup: a fresh attempt must not
 *      paper over a safety net that is broken or has never existed.
 *  (b) THE FRESH PRE-DEPLOY BACKUP (plan §1: an on-demand backup
 *      before every production deploy): the gate triggers one
 *      through B3's route surface with trigger 'pre_deploy' and
 *      requires the full pipeline outcome — the attempt PROMOTED,
 *      i.e. verified locally, encrypted, stored off-volume, and
 *      re-verified (B2's chain). A pipeline failure, a local-only
 *      verification, or a busy pipeline refuses, naming the stage.
 *  (c) ADVANCEMENT: the status is read AGAIN and the off-volume
 *      index must now name the pre-deploy backup as latest-good —
 *      the gate trusts the store's word over the run's own report.
 *
 * The verdict's checks are named and ordered; a refusal lists EVERY
 * failed condition, never just the first. Nothing here deploys,
 * merges, or mutates anything except the one backup run in (b) —
 * and that run goes through the same single pipeline lock as every
 * other trigger (runner.ts), so the gate can never interleave with
 * a scheduled run.
 *
 * Two deliberate semantics, recorded so they are not rediscovered
 * as surprises: (1) the pre-check is STRICTER than plan K1's note
 * (which observed the fresh pre-deploy backup is why deploy
 * freshness needs no separate threshold) — §10's words are "deploy
 * refuses without a current latest-good", so a stale prior
 * latest-good refuses at (a) even though (b) would freshen it; the
 * remedy is named in the refusal (take a backup, re-run the gate).
 * (2) A pre-deploy attempt is an attempt like any other for the
 * scheduler's slot coverage (schedule.ts: any attempt at/after the
 * 03:30 slot covers it — the same is true of manual and golden
 * runs), so a gate run in the small window after the slot stands in
 * for that day's scheduled run, as a fresh promoted daily-tier
 * backup in its own right.
 */
import { STALE_AFTER_MS } from "./schedule.js";
import type { BackupStatusReport } from "./status.js";

export type DeployGateCheckName =
  | "status_unreachable"
  | "offvolume_configured"
  | "index_readable"
  | "latest_good_exists"
  | "latest_good_current"
  | "latest_good_consistent"
  | "predeploy_backup_promoted"
  | "latest_good_advanced";

export interface DeployGateCheck {
  name: DeployGateCheckName;
  ok: boolean;
  /** One specific sentence: what was verified, or exactly what failed and the remedy. */
  detail: string;
}

export interface DeployGateVerdict {
  outcome: "pass" | "refused";
  checks: DeployGateCheck[];
  /** Names of the failed checks — the specific conditions the deploy was refused on. */
  refusals: DeployGateCheckName[];
  /** The pre-deploy attempt the gate triggered (null when none was). */
  preDeployAttemptId: string | null;
  /** The latest-good the off-volume index names at the end (null when none/unreadable). */
  latestGoodId: string | null;
}

/** The POST /api/backup/run response body (routes/backup.ts). */
export interface BackupRunResponse {
  ok: boolean;
  offVolume: "promoted" | "not_configured" | "failed";
  failureStage: string | null;
  failureDetail: string | null;
  retention: { prunedCount: number } | null;
  retentionError: string | null;
  attempt: {
    id: string;
    createdAt: string;
    finishedAt: string | null;
    trigger: string;
    tier: string | null;
    pinned: boolean;
    state: string;
    offVolumeOutcome: string | null;
    snapshotBytes: number | null;
  };
}

export type DeployGateRunOutcome =
  | { kind: "completed"; result: BackupRunResponse }
  | { kind: "busy" }
  | { kind: "http_error"; status: number; message: string };

/**
 * The production surface the gate talks to. Tests inject a fake;
 * production uses HttpDeployGateClient against the B3 routes (which
 * are owner-gated — the client carries the operator's own space
 * credential, see the CLI).
 */
export interface DeployGateClient {
  getStatus(): Promise<BackupStatusReport>;
  runPreDeployBackup(): Promise<DeployGateRunOutcome>;
}

const STALE_HOURS = STALE_AFTER_MS / 3_600_000;

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Shape guards (review P2-1). The HTTP client decodes JSON it does
 * not control the provenance of as far as this module is concerned;
 * a 200 with a malformed body must become a named refusal, never a
 * TypeError escaping the gate — the gate's contract is fail-closed
 * WITH the condition named. The guards check exactly the fields the
 * evaluations dereference or judge on.
 */
function asStatusReport(x: unknown): BackupStatusReport | null {
  if (!isRecord(x)) return null;
  if (!isRecord(x.offVolume) || typeof x.offVolume.configured !== "boolean") return null;
  if (!isRecord(x.offVolume.index) || typeof x.offVolume.index.status !== "string") return null;
  const good = x.latestGood;
  if (good !== null && (!isRecord(good) || typeof good.id !== "string")) return null;
  if (x.latestGoodIndexId !== null && typeof x.latestGoodIndexId !== "string") return null;
  if (typeof x.latestGoodStale !== "boolean" || typeof x.latestGoodDiverged !== "boolean") return null;
  if (x.latestGoodAgeMs !== null && typeof x.latestGoodAgeMs !== "number") return null;
  return x as unknown as BackupStatusReport;
}

function asRunResponse(x: unknown): BackupRunResponse | null {
  if (!isRecord(x)) return null;
  if (x.offVolume !== "promoted" && x.offVolume !== "not_configured" && x.offVolume !== "failed") return null;
  if (!isRecord(x.attempt)) return null;
  if (typeof x.attempt.id !== "string" || typeof x.attempt.state !== "string") return null;
  if (typeof x.attempt.trigger !== "string") return null;
  return x as unknown as BackupRunResponse;
}

function fmtAge(ageMs: number | null): string {
  if (ageMs === null) return "of unknown age";
  return `${(ageMs / 3_600_000).toFixed(1)}h old`;
}

function refusalsOf(checks: DeployGateCheck[]): DeployGateCheckName[] {
  return checks.filter((c) => !c.ok).map((c) => c.name);
}

/**
 * Condition (a) — the five pre-checks over one status report, in
 * gate order. Pure: the same report always yields the same checks.
 */
export function evaluatePreChecks(status: BackupStatusReport): DeployGateCheck[] {
  const checks: DeployGateCheck[] = [];
  const index = status.offVolume.index;

  checks.push(
    status.offVolume.configured
      ? {
          name: "offvolume_configured",
          ok: true,
          detail: "the off-volume store is configured on the production app",
        }
      : {
          name: "offvolume_configured",
          ok: false,
          detail:
            "the production app has NO off-volume store configured (the BACKUP_R2_* secrets are absent) — " +
            "there is no off-volume safety net to deploy behind",
        },
  );

  checks.push(
    index.status === "ok"
      ? {
          name: "index_readable",
          ok: true,
          detail: `the off-volume backup index reads cleanly (${index.entryCount} entries, ${index.promotedCount} promoted)`,
        }
      : {
          name: "index_readable",
          ok: false,
          detail:
            `the off-volume backup index is ${index.status}${index.detail ? `: ${index.detail}` : ""} — ` +
            "latest-good cannot be established from the store, so the safety net cannot be verified",
        },
  );

  const localGood = status.latestGood;
  const indexGoodId = status.latestGoodIndexId;
  if (localGood !== null && indexGoodId !== null) {
    checks.push({
      name: "latest_good_exists",
      ok: true,
      detail: `latest-good is ${indexGoodId} (promoted ${localGood.promotedAt ?? localGood.createdAt})`,
    });
  } else if (localGood === null && indexGoodId === null) {
    checks.push({
      name: "latest_good_exists",
      ok: false,
      detail:
        "no backup has ever been promoted — neither the app's record nor the off-volume index names a latest-good",
    });
  } else if (indexGoodId === null) {
    checks.push({
      name: "latest_good_exists",
      ok: false,
      detail:
        `the app's local record names latest-good ${localGood?.id}, but the off-volume index — ` +
        "the copy a restore would actually use — names none; the deploy is refused on the store's word",
    });
  } else {
    checks.push({
      name: "latest_good_exists",
      ok: false,
      detail:
        `the off-volume index names latest-good ${indexGoodId}, but the app's local record names none — ` +
        "the two halves of the promotion record disagree",
    });
  }

  if (localGood === null) {
    checks.push({
      name: "latest_good_current",
      ok: false,
      detail: "there is no latest-good to be current — spec §10: deploy refuses without a current latest-good",
    });
  } else if (status.latestGoodStale) {
    checks.push({
      name: "latest_good_current",
      ok: false,
      detail:
        `latest-good ${localGood.id} is ${fmtAge(status.latestGoodAgeMs)}, past the ${STALE_HOURS}h bound ` +
        "(spec §10: deploy refuses without a CURRENT latest-good) — take a backup first " +
        "(status panel → “Back up now”, or wait for the daily run), then re-run the gate",
    });
  } else {
    checks.push({
      name: "latest_good_current",
      ok: true,
      detail: `latest-good is ${fmtAge(status.latestGoodAgeMs)}, within the ${STALE_HOURS}h bound`,
    });
  }

  if (status.latestGoodDiverged) {
    checks.push({
      name: "latest_good_consistent",
      ok: false,
      detail:
        `the off-volume index names latest-good ${indexGoodId} but the app's local record names ` +
        `${localGood?.id} — they disagree (a promotion's crash window); resolve before deploying`,
    });
  } else if (indexGoodId === null) {
    checks.push({
      name: "latest_good_consistent",
      ok: true,
      detail:
        "the off-volume index names no latest-good, so there is no pair to diverge — " +
        "existence itself is judged by latest_good_exists",
    });
  } else {
    checks.push({
      name: "latest_good_consistent",
      ok: true,
      detail: "the off-volume index and the app's local record name the same latest-good",
    });
  }

  return checks;
}

function evaluateRunOutcome(outcome: DeployGateRunOutcome): DeployGateCheck {
  const name = "predeploy_backup_promoted" as const;
  if (outcome.kind === "busy") {
    return {
      name,
      ok: false,
      detail:
        "a backup run is already in progress on the production app (the pipeline runs one at a time) — " +
        "wait for it to finish, then re-run the gate; nothing was deployed",
    };
  }
  if (outcome.kind === "http_error") {
    return {
      name,
      ok: false,
      detail: `the pre-deploy backup request failed (HTTP ${outcome.status}: ${outcome.message})`,
    };
  }
  const { result } = outcome;
  if (result.offVolume === "promoted" && result.attempt.state === "promoted") {
    // The gate asked for a specific thing — a PRE-DEPLOY backup — so
    // it also verifies the answer is that thing (review P3): the
    // route reports ok=false only on failure and stamps the trigger
    // from the same request, so either mismatch means the answer
    // came from something other than the gate's own run.
    if (result.attempt.trigger !== "pre_deploy") {
      return {
        name,
        ok: false,
        detail:
          `the run that answered was not the pre-deploy backup the gate requested ` +
          `(its trigger is "${result.attempt.trigger}") — the gate does not take another run's word for its backup`,
      };
    }
    if (result.ok !== true) {
      return {
        name,
        ok: false,
        detail: "the pre-deploy run answered with ok=false despite reporting a promotion — the answer is not trusted",
      };
    }
    return {
      name,
      ok: true,
      detail:
        `the pre-deploy backup ${result.attempt.id} ran the full pipeline and PROMOTED — ` +
        "verified locally, encrypted, stored off-volume, and re-verified" +
        (result.retentionError
          ? ` (note: retention reported an error afterwards — ${result.retentionError}; the backup itself is intact)`
          : ""),
    };
  }
  if (result.offVolume === "failed") {
    return {
      name,
      ok: false,
      detail:
        `the pre-deploy backup did not promote — the pipeline failed at the ` +
        `${result.failureStage ?? "unknown"} stage${result.failureDetail ? `: ${result.failureDetail}` : ""}; ` +
        "the previous latest-good is untouched, and the deploy is refused",
    };
  }
  return {
    name,
    ok: false,
    detail:
      "the pre-deploy backup verified LOCALLY only — the off-volume leg did not run, so it never " +
      "became latest-good; a local-only backup is not a deploy-grade safety net",
  };
}

function evaluateAdvancement(after: BackupStatusReport, attemptId: string): DeployGateCheck {
  const name = "latest_good_advanced" as const;
  const problems: string[] = [];
  if (after.latestGoodIndexId !== attemptId) {
    problems.push(`the off-volume index names latest-good ${after.latestGoodIndexId ?? "none"} instead of the new backup`);
  }
  if (after.latestGood?.id !== attemptId) {
    problems.push(`the app's local record names latest-good ${after.latestGood?.id ?? "none"} instead of the new backup`);
  }
  if (after.latestGoodDiverged) problems.push("the index and the local record diverged");
  if (after.latestGoodStale) problems.push("the new latest-good already reads as stale");
  if (problems.length === 0) {
    return {
      name,
      ok: true,
      detail: `the off-volume index now names the pre-deploy backup ${attemptId} as latest-good`,
    };
  }
  return {
    name,
    ok: false,
    detail: `after the pre-deploy run, ${problems.join("; ")} — the gate trusts the store's word over the run's own report`,
  };
}

/**
 * The full gate: pre-checks → (only if they pass) the fresh
 * pre-deploy backup → re-read and advancement check. Fail-closed at
 * every step: an unreadable status or a failed request is a named
 * refusal, never an exception escaping to the operator.
 */
export async function runDeployGate(client: DeployGateClient): Promise<DeployGateVerdict> {
  let rawBefore: BackupStatusReport;
  try {
    rawBefore = await client.getStatus();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const checks: DeployGateCheck[] = [
      {
        name: "status_unreachable",
        ok: false,
        detail:
          `the production backup status could not be read (${detail}) — ` +
          "the gate cannot verify anything, so the deploy is refused",
      },
    ];
    return { outcome: "refused", checks, refusals: refusalsOf(checks), preDeployAttemptId: null, latestGoodId: null };
  }
  const before = asStatusReport(rawBefore);
  if (before === null) {
    const checks: DeployGateCheck[] = [
      {
        name: "status_unreachable",
        ok: false,
        detail:
          "the production backup status answered with a MALFORMED report (missing or mistyped fields) — " +
          "the gate cannot verify anything from it, so the deploy is refused",
      },
    ];
    return { outcome: "refused", checks, refusals: refusalsOf(checks), preDeployAttemptId: null, latestGoodId: null };
  }

  const checks = evaluatePreChecks(before);
  if (checks.some((c) => !c.ok)) {
    return {
      outcome: "refused",
      checks,
      refusals: refusalsOf(checks),
      preDeployAttemptId: null,
      latestGoodId: before.latestGoodIndexId,
    };
  }

  let runOutcome: DeployGateRunOutcome;
  try {
    runOutcome = await client.runPreDeployBackup();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    runOutcome = { kind: "http_error", status: 0, message: `the request itself failed (${detail})` };
  }
  // A completed run with a malformed body is a refusal at this
  // stage, in the same named shape as any other run failure.
  if (runOutcome.kind === "completed" && asRunResponse(runOutcome.result) === null) {
    checks.push({
      name: "predeploy_backup_promoted",
      ok: false,
      detail:
        "the pre-deploy backup request answered with a MALFORMED result (no attempt record) — " +
        "its promotion cannot be verified, so the deploy is refused",
    });
    return {
      outcome: "refused",
      checks,
      refusals: refusalsOf(checks),
      preDeployAttemptId: null,
      latestGoodId: before.latestGoodIndexId,
    };
  }
  const runCheck = evaluateRunOutcome(runOutcome);
  checks.push(runCheck);
  const attemptId = runOutcome.kind === "completed" ? runOutcome.result.attempt.id : null;
  if (!runCheck.ok) {
    return {
      outcome: "refused",
      checks,
      refusals: refusalsOf(checks),
      preDeployAttemptId: attemptId,
      latestGoodId: before.latestGoodIndexId,
    };
  }

  let rawAfter: BackupStatusReport;
  try {
    rawAfter = await client.getStatus();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.push({
      name: "latest_good_advanced",
      ok: false,
      detail: `the post-run backup status could not be read (${detail}) — the promotion cannot be confirmed from the store`,
    });
    return {
      outcome: "refused",
      checks,
      refusals: refusalsOf(checks),
      preDeployAttemptId: attemptId,
      latestGoodId: before.latestGoodIndexId,
    };
  }
  const after = asStatusReport(rawAfter);
  if (after === null) {
    checks.push({
      name: "latest_good_advanced",
      ok: false,
      detail:
        "the post-run backup status answered with a MALFORMED report — " +
        "the promotion cannot be confirmed from the store, so the deploy is refused",
    });
    return {
      outcome: "refused",
      checks,
      refusals: refusalsOf(checks),
      preDeployAttemptId: attemptId,
      latestGoodId: before.latestGoodIndexId,
    };
  }
  checks.push(evaluateAdvancement(after, attemptId!));
  const refused = checks.some((c) => !c.ok);
  return {
    outcome: refused ? "refused" : "pass",
    checks,
    refusals: refusalsOf(checks),
    preDeployAttemptId: attemptId,
    latestGoodId: after.latestGoodIndexId,
  };
}

/** The printed verdict — the operator-facing form the CLI emits. */
export function formatDeployGateVerdict(verdict: DeployGateVerdict): string {
  const lines: string[] = ["G0 DEPLOY GATE — production deploy safety check (spec §10)"];
  for (const check of verdict.checks) {
    lines.push(`  ${check.ok ? "✓" : "✗"} ${check.name} — ${check.detail}`);
  }
  if (verdict.outcome === "pass") {
    lines.push(
      `DEPLOY GATE: PASS — current latest-good verified and a fresh pre-deploy backup ` +
        `(${verdict.preDeployAttemptId}) promoted. The deploy may proceed.`,
    );
  } else {
    lines.push(
      `DEPLOY GATE: REFUSED — failed conditions: ${verdict.refusals.join(", ")}. The deploy must NOT proceed.`,
    );
  }
  return lines.join("\n");
}

/** fetch-based client against the production B3 backup routes. */
export interface DeployGateHttpOptions {
  /** App origin, e.g. https://brain-soumaya-v1.fly.dev (trailing slashes trimmed). */
  baseUrl: string;
  /** The operator's owner space id — the routes are owner-gated; this is a credential and is never logged. */
  spaceId: string;
  fetchFn?: typeof fetch;
}

export class HttpDeployGateClient implements DeployGateClient {
  private readonly baseUrl: string;
  private readonly spaceId: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: DeployGateHttpOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.spaceId = opts.spaceId;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  async getStatus(): Promise<BackupStatusReport> {
    const res = await this.fetchFn(`${this.baseUrl}/api/backup/status`, {
      headers: { "x-space-id": this.spaceId },
    });
    if (!res.ok) {
      throw new Error(`the status endpoint answered HTTP ${res.status}`);
    }
    return (await res.json()) as BackupStatusReport;
  }

  async runPreDeployBackup(): Promise<DeployGateRunOutcome> {
    const res = await this.fetchFn(`${this.baseUrl}/api/backup/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": this.spaceId },
      body: JSON.stringify({ preDeploy: true }),
    });
    if (res.status === 409) return { kind: "busy" };
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body?.error === "string" && body.error.length > 0) message = body.error;
      } catch {
        // A non-JSON error body keeps the HTTP-status message.
      }
      return { kind: "http_error", status: res.status, message };
    }
    return { kind: "completed", result: (await res.json()) as BackupRunResponse };
  }
}
