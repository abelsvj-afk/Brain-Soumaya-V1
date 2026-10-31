/**
 * G0 increment B5 — the deploy gate (spec §10, plan §1 + §4-B5).
 *
 * §10 preserved the manual deploy safeguard (a fresh export, a
 * brain.db backup, a downgrade acknowledgment) and required the
 * automatic system to be wired to it explicitly: DEPLOY REFUSES
 * WITHOUT A CURRENT LATEST-GOOD. Deploys happen by merge to main →
 * Fly native auto-deploy, which no in-repo code can intercept after
 * the fact, so the gate is an operator-run check that must PASS
 * before the merge: it reads the production backup status, refuses
 * loudly and specifically when latest-good is absent / stale /
 * unverifiable, then takes the fresh pre-deploy backup through the
 * B3 trigger surface (trigger 'pre_deploy') and verifies that it
 * promoted and became the index's latest-good.
 *
 * These tests pin the gate's semantics:
 *  - condition (a): latest-good exists (in the off-volume INDEX —
 *    the copy a restore would use), is current (≤ 24h, the
 *    STALE_AFTER_MS bound B3's status already computes), the index
 *    reads cleanly, and index + local record agree;
 *  - a failed pre-check refuses WITHOUT triggering any backup;
 *  - condition (b): the pre-deploy backup must PROMOTE — a pipeline
 *    failure, a local-only verification, a busy pipeline, and a
 *    post-run index that does not name the new backup all refuse,
 *    each naming its condition;
 *  - the HTTP client speaks to the real routes' shapes, and the
 *    route records the 'pre_deploy' trigger the gate asks for.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import { createDb, type DbHandle } from "../db/client.js";
import { EMBED_DIM } from "../db/vec.js";
import type { BackupStatusReport } from "../backup/status.js";
import {
  HttpDeployGateClient,
  evaluatePreChecks,
  formatDeployGateVerdict,
  runDeployGate,
  type BackupRunResponse,
  type DeployGateClient,
  type DeployGateRunOutcome,
} from "../backup/deployGate.js";
import { backupRoutes } from "../api/routes/backup.js";
import { requireSpace } from "../api/middleware.js";
import type { AppContext } from "../context.js";
import { parseDeployGateArgs } from "../backup/deploy-gate-cli.js";

const HOUR = 3_600_000;

// ── Fixtures ─────────────────────────────────────────────────────────

function statusReport(over: Partial<BackupStatusReport> = {}): BackupStatusReport {
  return {
    generatedAt: "2026-10-31T12:00:00.000Z",
    schedule: {
      timezone: "America/New_York",
      dailyTime: "03:30",
      nextRunAt: "2026-11-01T08:30:00.000Z",
      catchUpDue: false,
    },
    offVolume: {
      configured: true,
      index: {
        status: "ok",
        detail: null,
        entryCount: 3,
        promotedCount: 2,
        prunedCount: 0,
        latestGoodId: "good-1",
      },
    },
    latestAttempt: null,
    latestGood: {
      id: "good-1",
      createdAt: "2026-10-31T07:30:51.318Z",
      promotedAt: "2026-10-31T07:30:53.872Z",
      tier: "daily",
      snapshotBytes: 15_532_032,
    },
    latestGoodAgeMs: 4.5 * HOUR,
    latestGoodStale: false,
    latestGoodIndexId: "good-1",
    latestGoodDiverged: false,
    latestLocalVerified: null,
    ...over,
  };
}

function runResponse(over: Partial<BackupRunResponse> = {}): BackupRunResponse {
  return {
    ok: true,
    offVolume: "promoted",
    failureStage: null,
    failureDetail: null,
    retention: { prunedCount: 0 },
    retentionError: null,
    attempt: {
      id: "pre-1",
      createdAt: "2026-10-31T12:00:10.000Z",
      finishedAt: "2026-10-31T12:00:12.000Z",
      trigger: "pre_deploy",
      tier: "daily",
      pinned: false,
      state: "promoted",
      offVolumeOutcome: null,
      snapshotBytes: 15_532_032,
    },
    ...over,
  };
}

class FakeClient implements DeployGateClient {
  runCalls = 0;
  constructor(
    private readonly statuses: Array<BackupStatusReport | Error>,
    private readonly runOutcome: DeployGateRunOutcome | Error,
  ) {}
  async getStatus(): Promise<BackupStatusReport> {
    const next = this.statuses.shift();
    if (next === undefined) throw new Error("FakeClient: no scripted status left");
    if (next instanceof Error) throw next;
    return next;
  }
  async runPreDeployBackup(): Promise<DeployGateRunOutcome> {
    this.runCalls += 1;
    if (this.runOutcome instanceof Error) throw this.runOutcome;
    return this.runOutcome;
  }
}

const failedNames = (checks: Array<{ name: string; ok: boolean }>): string[] =>
  checks.filter((c) => !c.ok).map((c) => c.name);

// ── Condition (a): the pre-checks (spec §10) ─────────────────────────

describe("evaluatePreChecks — deploy refuses without a current latest-good", () => {
  it("passes all five checks on a healthy report", () => {
    const checks = evaluatePreChecks(statusReport());
    expect(checks.map((c) => c.name)).toEqual([
      "offvolume_configured",
      "index_readable",
      "latest_good_exists",
      "latest_good_current",
      "latest_good_consistent",
    ]);
    expect(failedNames(checks)).toEqual([]);
  });

  it("refuses when the off-volume store is not configured", () => {
    const checks = evaluatePreChecks(
      statusReport({ offVolume: { configured: false, index: statusReport().offVolume.index } }),
    );
    expect(failedNames(checks)).toContain("offvolume_configured");
  });

  it("refuses when the off-volume index is corrupt — latest-good cannot be established from the store", () => {
    const base = statusReport();
    const checks = evaluatePreChecks(
      statusReport({
        offVolume: {
          configured: true,
          index: { ...base.offVolume.index, status: "corrupt", detail: "index failed validation" },
        },
        latestGoodIndexId: null,
      }),
    );
    const names = failedNames(checks);
    expect(names).toContain("index_readable");
    const check = checks.find((c) => c.name === "index_readable");
    expect(check?.detail).toContain("corrupt");
  });

  it("refuses when no backup has ever been promoted", () => {
    const checks = evaluatePreChecks(
      statusReport({ latestGood: null, latestGoodIndexId: null, latestGoodAgeMs: null, latestGoodStale: true }),
    );
    expect(failedNames(checks)).toContain("latest_good_exists");
  });

  it("refuses when the local record names a latest-good but the off-volume index names none (the restore source is authoritative)", () => {
    const base = statusReport();
    const checks = evaluatePreChecks(
      statusReport({
        offVolume: { configured: true, index: { ...base.offVolume.index, latestGoodId: null } },
        latestGoodIndexId: null,
      }),
    );
    expect(failedNames(checks)).toContain("latest_good_exists");
    const check = checks.find((c) => c.name === "latest_good_exists");
    expect(check?.detail).toContain("good-1"); // names the local-only good it refuses to trust
  });

  it("refuses when latest-good is stale — older than the 24h bound", () => {
    const checks = evaluatePreChecks(
      statusReport({ latestGoodAgeMs: 30 * HOUR, latestGoodStale: true }),
    );
    expect(failedNames(checks)).toEqual(["latest_good_current"]);
    const check = checks.find((c) => c.name === "latest_good_current");
    expect(check?.detail).toContain("30.0h");
    expect(check?.detail).toContain("24h");
  });

  it("refuses when the index and the local record name different latest-goods (diverged)", () => {
    const checks = evaluatePreChecks(statusReport({ latestGoodDiverged: true, latestGoodIndexId: "good-2" }));
    expect(failedNames(checks)).toEqual(["latest_good_consistent"]);
    const check = checks.find((c) => c.name === "latest_good_consistent");
    expect(check?.detail).toContain("good-2");
    expect(check?.detail).toContain("good-1");
  });

  it("names EVERY failed condition at once — the refusal is specific and complete", () => {
    const checks = evaluatePreChecks(
      statusReport({
        offVolume: {
          configured: false,
          index: { status: "not_configured", detail: null, entryCount: 0, promotedCount: 0, prunedCount: 0, latestGoodId: null },
        },
        latestGood: null,
        latestGoodIndexId: null,
        latestGoodAgeMs: null,
        latestGoodStale: true,
      }),
    );
    const names = failedNames(checks);
    expect(names).toContain("offvolume_configured");
    expect(names).toContain("index_readable");
    expect(names).toContain("latest_good_exists");
    expect(names).toContain("latest_good_current");
  });
});

// ── The full gate ────────────────────────────────────────────────────

describe("runDeployGate — pre-check, fresh pre-deploy backup, re-verify", () => {
  it("PASSES: current latest-good, the pre-deploy backup promotes, and the index advances to it", async () => {
    const after = statusReport({
      latestGood: {
        id: "pre-1",
        createdAt: "2026-10-31T12:00:10.000Z",
        promotedAt: "2026-10-31T12:00:12.000Z",
        tier: "daily",
        snapshotBytes: 15_532_032,
      },
      latestGoodAgeMs: 0,
      latestGoodIndexId: "pre-1",
    });
    const client = new FakeClient([statusReport(), after], { kind: "completed", result: runResponse() });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("pass");
    expect(verdict.refusals).toEqual([]);
    expect(verdict.preDeployAttemptId).toBe("pre-1");
    expect(verdict.latestGoodId).toBe("pre-1");
    expect(client.runCalls).toBe(1);
    expect(failedNames(verdict.checks)).toEqual([]);
  });

  it("refuses at the pre-check WITHOUT triggering a backup when latest-good is absent", async () => {
    const client = new FakeClient(
      [statusReport({ latestGood: null, latestGoodIndexId: null, latestGoodAgeMs: null, latestGoodStale: true })],
      { kind: "completed", result: runResponse() },
    );
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toContain("latest_good_exists");
    expect(client.runCalls).toBe(0);
  });

  it("refuses at the pre-check WITHOUT triggering a backup when latest-good is stale", async () => {
    const client = new FakeClient(
      [statusReport({ latestGoodAgeMs: 49 * HOUR, latestGoodStale: true })],
      { kind: "completed", result: runResponse() },
    );
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["latest_good_current"]);
    expect(client.runCalls).toBe(0);
  });

  it("refuses when the status endpoint cannot be read at all — fail closed, named", async () => {
    const client = new FakeClient([new Error("fetch failed")], { kind: "completed", result: runResponse() });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["status_unreachable"]);
    expect(client.runCalls).toBe(0);
  });

  it("refuses when the pre-deploy backup fails verification — naming the pipeline stage and detail", async () => {
    const failed = runResponse({
      ok: false,
      offVolume: "failed",
      failureStage: "verify",
      failureDetail: "MUST-BE-NONEMPTY table empty: sources",
      attempt: { ...runResponse().attempt, state: "failed", offVolumeOutcome: null },
    });
    const client = new FakeClient([statusReport()], { kind: "completed", result: failed });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["predeploy_backup_promoted"]);
    const check = verdict.checks.find((c) => c.name === "predeploy_backup_promoted");
    expect(check?.detail).toContain("verify");
    expect(check?.detail).toContain("sources");
  });

  it("refuses when the pre-deploy backup only verifies locally (off-volume leg never ran)", async () => {
    const localOnly = runResponse({
      ok: false,
      offVolume: "not_configured",
      attempt: { ...runResponse().attempt, state: "verified_local", offVolumeOutcome: "not_configured" },
    });
    const client = new FakeClient([statusReport()], { kind: "completed", result: localOnly });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["predeploy_backup_promoted"]);
  });

  it("refuses when a backup run is already in progress (the pipeline's one-at-a-time refusal)", async () => {
    const client = new FakeClient([statusReport()], { kind: "busy" });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["predeploy_backup_promoted"]);
    const check = verdict.checks.find((c) => c.name === "predeploy_backup_promoted");
    expect(check?.detail).toContain("already in progress");
  });

  it("refuses when the pre-deploy request itself errors (HTTP failure surfaces its message)", async () => {
    const client = new FakeClient([statusReport()], { kind: "http_error", status: 500, message: "The backup attempt could not be started." });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["predeploy_backup_promoted"]);
    const check = verdict.checks.find((c) => c.name === "predeploy_backup_promoted");
    expect(check?.detail).toContain("500");
  });

  it("refuses when the post-run index does not name the new backup as latest-good", async () => {
    // The run claims promotion, but the index still names the old good:
    // the gate trusts the store's word over the run's.
    const client = new FakeClient([statusReport(), statusReport()], { kind: "completed", result: runResponse() });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["latest_good_advanced"]);
    expect(verdict.preDeployAttemptId).toBe("pre-1");
  });

  it("refuses when the post-run status cannot be read", async () => {
    const client = new FakeClient([statusReport(), new Error("connection reset")], { kind: "completed", result: runResponse() });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["latest_good_advanced"]);
  });

  it("refuses WITHOUT triggering a backup on the not-configured, corrupt-index, and diverged pre-checks too", async () => {
    const base = statusReport();
    const cases: Array<[string, BackupStatusReport]> = [
      ["offvolume_configured", statusReport({ offVolume: { configured: false, index: base.offVolume.index } })],
      [
        "index_readable",
        statusReport({
          offVolume: { configured: true, index: { ...base.offVolume.index, status: "corrupt", detail: "bad" } },
          latestGoodIndexId: null,
        }),
      ],
      ["latest_good_consistent", statusReport({ latestGoodDiverged: true, latestGoodIndexId: "good-2" })],
    ];
    for (const [name, report] of cases) {
      const client = new FakeClient([report], { kind: "completed", result: runResponse() });
      const verdict = await runDeployGate(client);
      expect(verdict.outcome).toBe("refused");
      expect(verdict.refusals).toContain(name);
      expect(client.runCalls).toBe(0);
    }
  });

  it("refuses when the run request itself throws (transport failure becomes a named refusal, never an exception)", async () => {
    const client = new FakeClient([statusReport()], new Error("socket hang up"));
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["predeploy_backup_promoted"]);
  });

  it("refuses when the run's answer is not the pre-deploy attempt the gate asked for (wrong trigger)", async () => {
    const wrong = runResponse({ attempt: { ...runResponse().attempt, trigger: "manual" } });
    const client = new FakeClient([statusReport()], { kind: "completed", result: wrong });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["predeploy_backup_promoted"]);
  });

  it("advancement is pinned per half: index advanced but the local record did not → refused", async () => {
    const after = statusReport({ latestGoodIndexId: "pre-1" }); // local latestGood still good-1
    const client = new FakeClient([statusReport(), after], { kind: "completed", result: runResponse() });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["latest_good_advanced"]);
  });

  it("advancement is pinned per half: local record advanced but the index did not → refused", async () => {
    const after = statusReport({
      latestGood: { id: "pre-1", createdAt: "2026-10-31T12:00:10.000Z", promotedAt: "2026-10-31T12:00:12.000Z", tier: "daily", snapshotBytes: 1 },
      latestGoodAgeMs: 0,
      // latestGoodIndexId still "good-1"
    });
    const client = new FakeClient([statusReport(), after], { kind: "completed", result: runResponse() });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["latest_good_advanced"]);
  });

  it("advancement refuses when the post-run pair diverged or the new good already reads stale", async () => {
    const advancedGood = {
      id: "pre-1",
      createdAt: "2026-10-31T12:00:10.000Z",
      promotedAt: "2026-10-31T12:00:12.000Z",
      tier: "daily",
      snapshotBytes: 1,
    };
    const diverged = statusReport({ latestGood: advancedGood, latestGoodAgeMs: 0, latestGoodIndexId: "pre-1", latestGoodDiverged: true });
    const v1 = await runDeployGate(new FakeClient([statusReport(), diverged], { kind: "completed", result: runResponse() }));
    expect(v1.refusals).toEqual(["latest_good_advanced"]);
    const stale = statusReport({ latestGood: advancedGood, latestGoodAgeMs: 30 * HOUR, latestGoodStale: true, latestGoodIndexId: "pre-1" });
    const v2 = await runDeployGate(new FakeClient([statusReport(), stale], { kind: "completed", result: runResponse() }));
    expect(v2.refusals).toEqual(["latest_good_advanced"]);
  });
});

// ── Malformed payloads: the gate fails closed, never throws (review P2-1) ──

describe("runDeployGate — malformed payloads become named refusals", () => {
  it("a malformed status report (empty object) refuses as status_unreachable, no exception", async () => {
    const client = new FakeClient([{} as BackupStatusReport], { kind: "completed", result: runResponse() });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["status_unreachable"]);
    expect(client.runCalls).toBe(0);
  });

  it("a null status report refuses the same way", async () => {
    const client = new FakeClient([null as unknown as BackupStatusReport], { kind: "completed", result: runResponse() });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["status_unreachable"]);
  });

  it("a run result with no attempt refuses at predeploy_backup_promoted, no exception", async () => {
    const malformed = { offVolume: "promoted" } as unknown as BackupRunResponse;
    const client = new FakeClient([statusReport()], { kind: "completed", result: malformed });
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["predeploy_backup_promoted"]);
  });

  it("a malformed post-run status refuses at latest_good_advanced, no exception", async () => {
    const client = new FakeClient(
      [statusReport(), null as unknown as BackupStatusReport],
      { kind: "completed", result: runResponse() },
    );
    const verdict = await runDeployGate(client);
    expect(verdict.outcome).toBe("refused");
    expect(verdict.refusals).toEqual(["latest_good_advanced"]);
  });
});

// ── The verdict's printed form (the CLI's output contract) ──────────

describe("formatDeployGateVerdict — loud, specific, names conditions", () => {
  it("a PASS verdict says the deploy may proceed and names the pre-deploy backup", async () => {
    const after = statusReport({
      latestGood: { id: "pre-1", createdAt: "2026-10-31T12:00:10.000Z", promotedAt: "2026-10-31T12:00:12.000Z", tier: "daily", snapshotBytes: 1 },
      latestGoodAgeMs: 0,
      latestGoodIndexId: "pre-1",
    });
    const verdict = await runDeployGate(new FakeClient([statusReport(), after], { kind: "completed", result: runResponse() }));
    const text = formatDeployGateVerdict(verdict);
    expect(text).toContain("DEPLOY GATE: PASS");
    expect(text).toContain("pre-1");
  });

  it("a REFUSED verdict names every failed condition and says the deploy must not proceed", async () => {
    const verdict = await runDeployGate(
      new FakeClient([statusReport({ latestGoodAgeMs: 30 * HOUR, latestGoodStale: true })], { kind: "completed", result: runResponse() }),
    );
    const text = formatDeployGateVerdict(verdict);
    expect(text).toContain("DEPLOY GATE: REFUSED");
    expect(text).toContain("latest_good_current");
    expect(text).toContain("must NOT proceed");
  });
});

// ── The HTTP client (real route shapes) ──────────────────────────────

describe("HttpDeployGateClient", () => {
  const fakeFetch = (handler: (url: string, init?: RequestInit) => Promise<unknown>) =>
    handler as unknown as typeof fetch;

  it("getStatus reads /api/backup/status with the operator's space credential header", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const client = new HttpDeployGateClient({
      baseUrl: "https://brain.example.test/",
      spaceId: "space-owner",
      fetchFn: fakeFetch(async (url, init) => {
        seenUrl = url;
        seenInit = init;
        return { ok: true, status: 200, json: async () => statusReport() };
      }),
    });
    const report = await client.getStatus();
    expect(seenUrl).toBe("https://brain.example.test/api/backup/status");
    expect((seenInit?.headers as Record<string, string>)["x-space-id"]).toBe("space-owner");
    expect(report.latestGood?.id).toBe("good-1");
  });

  it("getStatus throws on a non-200 (the gate turns that into status_unreachable)", async () => {
    const client = new HttpDeployGateClient({
      baseUrl: "https://brain.example.test",
      spaceId: "space-owner",
      fetchFn: fakeFetch(async () => ({ ok: false, status: 403, json: async () => ({ error: "owner only" }) })),
    });
    await expect(client.getStatus()).rejects.toThrow(/403/);
  });

  it("runPreDeployBackup posts { preDeploy: true } and maps 200 / 409 / 500", async () => {
    const bodies: string[] = [];
    const mk = (res: unknown) =>
      new HttpDeployGateClient({
        baseUrl: "https://brain.example.test",
        spaceId: "space-owner",
        fetchFn: fakeFetch(async (_url, init) => {
          bodies.push(String(init?.body ?? ""));
          return res;
        }),
      });
    const done = await mk({ ok: true, status: 200, json: async () => runResponse() }).runPreDeployBackup();
    expect(done.kind).toBe("completed");
    expect(bodies[0]).toBe(JSON.stringify({ preDeploy: true }));

    const busy = await mk({ ok: false, status: 409, json: async () => ({ error: "busy" }) }).runPreDeployBackup();
    expect(busy).toEqual({ kind: "busy" });

    const err = await mk({ ok: false, status: 500, json: async () => ({ error: "could not start" }) }).runPreDeployBackup();
    expect(err).toEqual({ kind: "http_error", status: 500, message: "could not start" });
  });
});

// ── The CLI's argument contract ──────────────────────────────────────

describe("deploy-gate-cli parseDeployGateArgs", () => {
  it("defaults to the production origin; --base-url and --json parse", () => {
    expect(parseDeployGateArgs([], {})).toEqual({ baseUrl: "https://brain-soumaya-v1.fly.dev", json: false });
    expect(parseDeployGateArgs(["--base-url", "https://x.test/", "--json"], {})).toEqual({
      baseUrl: "https://x.test/",
      json: true,
    });
    expect(parseDeployGateArgs([], { DEPLOY_GATE_BASE_URL: "https://env.test" }).baseUrl).toBe("https://env.test");
  });

  it("a flag where the --base-url value belongs is a usage error, not a URL (review P3)", () => {
    expect(() => parseDeployGateArgs(["--base-url", "--json"], {})).toThrow(/unrecognized or incomplete/);
    expect(() => parseDeployGateArgs(["--bogus"], {})).toThrow(/unrecognized or incomplete/);
    expect(() => parseDeployGateArgs(["--base-url"], {})).toThrow(/unrecognized or incomplete/);
  });
});

// ── The route records the gate's trigger ─────────────────────────────

/**
 * A minimal WORKING brain (mirrors g0BackupScheduler.test.ts): one
 * honest row in every MUST-BE-NONEMPTY table of inventory v5, so the
 * real pipeline's default enforcement passes. The three v5
 * MAY-BE-EMPTY reclassifications stay empty, legitimately.
 */
function seedWorkingBrain(h: DbHandle): void {
  const s = h.sqlite;
  const vec = Buffer.from(new Float32Array(EMBED_DIM).fill(0.5).buffer);
  s.prepare(
    `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
     VALUES ('space-test', 'Test Brain', 'tester', 'h', 's')`,
  ).run();
  s.prepare(`INSERT INTO settings (key, value) VALUES ('seed', '1')`).run();
  s.prepare(`INSERT INTO space_meta (space_id) VALUES ('space-test')`).run();
  s.prepare(`INSERT INTO user_persona (space_id, body) VALUES ('space-test', 'test persona')`).run();
  const node = s
    .prepare(
      `INSERT INTO nodes (space_id, label, type, content)
       VALUES ('space-test', 'A memory', 'note', 'something worth keeping')`,
    )
    .run();
  const nodeId = Number(node.lastInsertRowid);
  s.prepare(`INSERT INTO edges (space_id, source, target, relationship) VALUES ('space-test', ?, ?, 'relates')`).run(nodeId, nodeId);
  const source = s
    .prepare(
      `INSERT INTO sources (space_id, kind, raw_bytes, content_hash, byte_length)
       VALUES ('space-test', 'note', ?, 'seedhash', 4)`,
    )
    .run(Buffer.from("seed"));
  const sourceId = Number(source.lastInsertRowid);
  const schunk = s
    .prepare(
      `INSERT INTO source_chunks (space_id, source_id, ordinal, text, start_offset, end_offset)
       VALUES ('space-test', ?, 0, 'seed text', 0, 9)`,
    )
    .run(sourceId);
  const sourceChunkId = Number(schunk.lastInsertRowid);
  s.prepare(`INSERT INTO sources_fts (rowid, text) VALUES (?, 'seed text')`).run(sourceChunkId);
  s.prepare(`INSERT INTO node_sources (space_id, node_id, source_id, chunk_id) VALUES ('space-test', ?, ?, ?)`).run(nodeId, sourceId, sourceChunkId);
  const doc = s.prepare(`INSERT INTO knowledge_docs (space_id, name) VALUES ('space-test', 'seed doc')`).run();
  const docId = Number(doc.lastInsertRowid);
  const kchunk = s
    .prepare(`INSERT INTO knowledge_chunks (space_id, doc_id, ordinal, content) VALUES ('space-test', ?, 0, 'seed chunk')`)
    .run(docId);
  const knowledgeChunkId = Number(kchunk.lastInsertRowid);
  s.prepare(
    `INSERT INTO episodes (space_id, kind, summary, occurred_at, recorded_at)
     VALUES ('space-test', 'session', 'seed episode', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run();
  s.prepare(`INSERT INTO nodes_fts (rowid, label, content) VALUES (?, 'A memory', 'something worth keeping')`).run(nodeId);
  s.prepare(`INSERT INTO vec_nodes (node_id, embedding) VALUES (?, ?)`).run(BigInt(nodeId), vec);
  s.prepare(`INSERT INTO vec_docs (chunk_id, embedding) VALUES (?, ?)`).run(BigInt(knowledgeChunkId), vec);
  s.prepare(`INSERT INTO vec_source_chunks (chunk_id, embedding) VALUES (?, ?)`).run(BigInt(sourceChunkId), vec);
  const profile = s
    .prepare(`INSERT INTO instruction_profiles (space_id, name, body) VALUES ('space-test', 'seed profile', 'be nice')`)
    .run();
  s.prepare(`INSERT INTO vec_profiles (profile_id, embedding) VALUES (?, ?)`).run(BigInt(Number(profile.lastInsertRowid)), vec);
  s.prepare(
    `INSERT INTO user_model (space_id, slot, content, confidence, valid_at, origin)
     VALUES ('space-test', 'belief', 'seed belief', 0.9, '2026-01-01T00:00:00Z', 'stated')`,
  ).run();
  s.prepare(`INSERT INTO daily_logs (space_id, content) VALUES ('space-test', 'seed log')`).run();
  s.prepare(`INSERT INTO fin_account (space_id) VALUES ('space-test')`).run();
  s.prepare(`INSERT INTO fin_source (space_id) VALUES ('space-test')`).run();
  s.prepare(`INSERT INTO fin_income (space_id, date) VALUES ('space-test', '2026-01-01')`).run();
  const bill = s
    .prepare(`INSERT INTO fin_bill (space_id, name, anchor_date) VALUES ('space-test', 'seed bill', '2026-01-01')`)
    .run();
  s.prepare(`INSERT INTO fin_bill_occurrence (space_id, bill_id, due_date) VALUES ('space-test', ?, '2026-01-01')`).run(Number(bill.lastInsertRowid));
  s.prepare(`INSERT INTO fin_paystub (space_id, net_cents) VALUES ('space-test', 100)`).run();
}

describe("backup route — the pre-deploy trigger (B5)", () => {
  let handle: DbHandle;
  let dir: string;
  let savedEnv: NodeJS.ProcessEnv;
  let base = "";
  let server: import("node:http").Server;

  beforeEach(async () => {
    savedEnv = { ...process.env };
    delete process.env.BACKUP_ENCRYPTION_KEY;
    handle = createDb(":memory:");
    seedWorkingBrain(handle);
    dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "g0-b5-"));
    handle.sqlite
      .prepare(
        `INSERT INTO spaces (id, name, gamer_tag, passcode_hash, passcode_salt)
         VALUES ('space-owner', 'Owner Brain', 'owner', 'h', 's')`,
      )
      .run();
    process.env.OWNER_SPACE_IDS = "space-owner";
    process.env.BACKUP_DIR = dir;
    const app = express();
    app.use(express.json());
    app.use("/api/backup", requireSpace(handle), backupRoutes({ handle } as AppContext));
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}/api/backup`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env = savedEnv;
    handle.sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (body: unknown) =>
    fetch(`${base}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-space-id": "space-owner" },
      body: JSON.stringify(body),
    });

  it("POST /run { preDeploy: true } records trigger 'pre_deploy' (daily tier, unpinned)", async () => {
    const res = await run({ preDeploy: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attempt: { trigger: string; tier: string; pinned: boolean } };
    expect(body.attempt.trigger).toBe("pre_deploy");
    expect(body.attempt.tier).toBe("daily");
    expect(body.attempt.pinned).toBe(false);
  });

  it("golden still wins when both flags are sent (documented precedence)", async () => {
    const res = await run({ golden: true, preDeploy: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { attempt: { trigger: string } };
    expect(body.attempt.trigger).toBe("golden");
  });
});
