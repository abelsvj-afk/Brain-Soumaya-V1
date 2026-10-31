import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import BackupPanel from "./BackupPanel.js";
import * as api from "../api/backup.js";

/**
 * G0 B3 panel tests — G0-AC-11's rendering half: latest attempt and
 * latest-good are distinct blocks, and every time renders in the
 * viewer's local timezone (asserted against the same Date API the
 * panel uses, so the assertions hold in any gate timezone).
 */

const GOOD_AT = "2026-03-08T09:00:00.000Z";
const ATTEMPT_AT = "2026-03-09T14:55:00.000Z";

const status = (over: Partial<api.BackupStatus> = {}): api.BackupStatus => ({
  generatedAt: "2026-03-09T15:00:00.000Z",
  schedule: {
    timezone: "America/New_York",
    dailyTime: "03:30",
    nextRunAt: "2026-03-10T07:30:00.000Z",
    catchUpDue: false,
  },
  offVolume: {
    configured: true,
    index: {
      status: "ok",
      detail: null,
      entryCount: 3,
      promotedCount: 3,
      prunedCount: 0,
      latestGoodId: "good-1",
    },
  },
  latestAttempt: {
    id: "good-1",
    createdAt: GOOD_AT,
    finishedAt: GOOD_AT,
    trigger: "schedule",
    tier: "weekly",
    pinned: false,
    state: "promoted",
    failureStage: null,
    failureDetail: null,
    offVolumeOutcome: null,
    snapshotBytes: 2048,
  },
  latestGood: {
    id: "good-1",
    createdAt: GOOD_AT,
    promotedAt: GOOD_AT,
    tier: "weekly",
    snapshotBytes: 2048,
  },
  latestGoodAgeMs: 30 * 3_600_000,
  latestGoodStale: true,
  latestGoodIndexId: "good-1",
  latestGoodDiverged: false,
  latestLocalVerified: { id: "good-1", createdAt: GOOD_AT, tier: "weekly", snapshotBytes: 2048 },
  ...over,
});

const local = (iso: string) => new Date(iso).toLocaleString();

beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe("the owner's backup panel (G0-AC-11)", () => {
  it("is simply absent for anyone who is not the owner — including while loading", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(null);
    const { container } = render(<BackupPanel />);
    // No placeholder text at any point: the panel renders nothing
    // until the owner's status arrives, and nothing ever for others.
    expect(container.textContent).toBe("");
    await waitFor(() => expect(container.textContent).not.toMatch(/Checking backups/));
    expect(container.querySelector(".backup-panel")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("an index/local latest-good divergence is loud in the panel (review P2-6)", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(
      status({ latestGoodIndexId: "idx-good", latestGoodDiverged: true }),
    );
    const { container } = render(<BackupPanel />);
    await waitFor(() => expect(screen.getByText("Latest good backup")).toBeTruthy());
    expect(container.textContent).toMatch(/index names a different latest-good \(idx-good\)/);
    expect(container.textContent).toMatch(/a restore would use the index one/);
  });

  it("shows latest-good with a local time, its age, and the STALE warning — distinct from the attempt", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(status());
    const { container } = render(<BackupPanel />);
    await waitFor(() => expect(screen.getByText("Latest good backup")).toBeTruthy());
    const text = container.textContent ?? "";
    // Viewer-local rendering: the panel shows the same string the
    // viewer's own clock produces for that instant — never raw UTC.
    expect(text).toContain(local(GOOD_AT));
    expect(text).not.toContain(GOOD_AT);
    expect(text).toMatch(/Age: 1d 6h/);
    expect(text).toMatch(/STALE: older than 24 hours/);
    // The attempt block is its own labelled block.
    expect(screen.getByText("Latest attempt")).toBeTruthy();
    expect(text).toMatch(/automatic — daily schedule/);
    // A weekly-tier attempt says what the tier MEANS (Sunday's keeper),
    // not just the bare word "weekly".
    expect(text).toMatch(/weekly keeper/);
  });

  it("a fresh latest-good shows its age with no STALE warning", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(
      status({ latestGoodAgeMs: 2 * 3_600_000, latestGoodStale: false }),
    );
    const { container } = render(<BackupPanel />);
    await waitFor(() => expect(screen.getByText("Latest good backup")).toBeTruthy());
    expect(container.textContent).toMatch(/Age: 2h 0m/);
    expect(container.textContent).not.toMatch(/STALE/);
  });

  it("a failed attempt never masquerades as the good backup", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(
      status({
        latestAttempt: {
          id: "attempt-2",
          createdAt: ATTEMPT_AT,
          finishedAt: ATTEMPT_AT,
          trigger: "manual",
          tier: "daily",
          pinned: false,
          state: "failed",
          failureStage: "encrypt",
          failureDetail: "BACKUP_ENCRYPTION_KEY is not set",
          offVolumeOutcome: null,
          snapshotBytes: 2048,
        },
      }),
    );
    const { container } = render(<BackupPanel />);
    await waitFor(() => expect(screen.getByText("Latest attempt")).toBeTruthy());
    const text = container.textContent ?? "";
    expect(text).toMatch(/Failed at the encrypt stage/);
    expect(text).toMatch(/previous latest good backup is untouched/);
    // The good block still shows the older promoted backup.
    expect(text).toContain(local(GOOD_AT));
    expect(text).toContain(local(ATTEMPT_AT));
  });

  it("not configured: the attempt reads verified-local, and there is no good backup yet", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(
      status({
        offVolume: {
          configured: false,
          index: {
            status: "not_configured",
            detail: null,
            entryCount: 0,
            promotedCount: 0,
            prunedCount: 0,
            latestGoodId: null,
          },
        },
        latestAttempt: {
          id: "attempt-1",
          createdAt: ATTEMPT_AT,
          finishedAt: ATTEMPT_AT,
          trigger: "schedule",
          tier: "daily",
          pinned: false,
          state: "verified_local",
          failureStage: null,
          failureDetail: null,
          offVolumeOutcome: "not_configured",
          snapshotBytes: 1024,
        },
        latestGood: null,
        latestGoodAgeMs: null,
        latestGoodStale: true,
        latestLocalVerified: {
          id: "attempt-1",
          createdAt: ATTEMPT_AT,
          tier: "daily",
          snapshotBytes: 1024,
        },
      }),
    );
    const { container } = render(<BackupPanel />);
    await waitFor(() => expect(screen.getByText("Latest good backup")).toBeTruthy());
    const text = container.textContent ?? "";
    expect(text).toMatch(/No backup has been promoted yet/);
    expect(text).toMatch(/STALE: there is no good backup/);
    expect(text).toMatch(/Verified locally — the off-volume copy is not configured/);
    expect(text).toMatch(/Off-volume copy: not configured/);
  });

  it("a corrupt index is loud and specific in the panel", async () => {
    vi.spyOn(api, "getBackupStatus").mockResolvedValue(
      status({
        offVolume: {
          configured: true,
          index: {
            status: "corrupt",
            detail: "backup index is corrupt (invalid JSON: Unexpected token)",
            entryCount: 0,
            promotedCount: 0,
            prunedCount: 0,
            latestGoodId: null,
          },
        },
      }),
    );
    const { container } = render(<BackupPanel />);
    await waitFor(() => expect(screen.getByText("Latest good backup")).toBeTruthy());
    expect(container.textContent).toMatch(/INDEX CORRUPT/);
    expect(container.textContent).toMatch(/invalid JSON/);
    expect(container.textContent).toMatch(/nothing was silently reset/);
  });

  it("Back up now and Golden call the right triggers and reload the status", async () => {
    const get = vi.spyOn(api, "getBackupStatus").mockResolvedValue(status());
    const run = vi.spyOn(api, "runBackupNow").mockResolvedValue({
      ok: true,
      offVolume: "promoted",
      failureStage: null,
      failureDetail: null,
      attempt: {
        id: "attempt-9",
        createdAt: ATTEMPT_AT,
        trigger: "manual",
        tier: "daily",
        pinned: false,
        state: "promoted",
        offVolumeOutcome: null,
        snapshotBytes: 2048,
      },
    });
    render(<BackupPanel />);
    await waitFor(() => expect(screen.getByText("Back up now")).toBeTruthy());
    fireEvent.click(screen.getByText("Back up now"));
    await waitFor(() => expect(run).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByText("Golden backup (pinned)"));
    await waitFor(() => expect(run).toHaveBeenCalledWith(true));
    // Each run reloads the status (initial load + one per run).
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(3));
  });
});
