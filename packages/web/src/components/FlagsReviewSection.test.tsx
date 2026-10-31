import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

// FlagsReviewSection tests — adapted from SettingsPanel.flags.test.tsx
// (the section moved into the Your Words panel, owner settlement
// 2026-10-31). Same assertions as the Settings-era suite; T-F numbering
// preserved for traceability:
//   T-F1 content-free descriptors (profile as #id, never its name)
//   T-F2 mark reviewed moves the row under the Reviewed filter
//   T-F3 delete is two-step, names table + row id, removes on confirm
//   T-F4 a dangling flag offers dismiss instead of delete
//   T-F5 fail-soft: an unreachable list says so, never pretends empty

const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

const listUnresolvedFlags = vi.fn();
const reviewUnresolvedFlag = vi.fn();
const deleteUnresolvedFlagRow = vi.fn();
const dismissUnresolvedFlag = vi.fn();
vi.mock("../api/forgetRequests.js", () => ({
  listUnresolvedFlags: (...a: unknown[]) => listUnresolvedFlags(...a),
  reviewUnresolvedFlag: (...a: unknown[]) => reviewUnresolvedFlag(...a),
  deleteUnresolvedFlagRow: (...a: unknown[]) => deleteUnresolvedFlagRow(...a),
  dismissUnresolvedFlag: (...a: unknown[]) => dismissUnresolvedFlag(...a),
}));

import { FlagsReviewSection } from "./FlagsReviewSection.js";
import type { UnresolvedFlagsList } from "../api/forgetRequests.js";

const UM_FLAG = {
  flagId: 1,
  requestId: 10,
  sourceId: 5,
  table: "user_model" as const,
  rowId: 7,
  policyReason: "stated_user_model",
  status: "open" as const,
  createdAt: "2026-10-26T00:00:00.000Z",
  reviewedAt: null,
  targetMissing: false,
  slot: "belief",
  origin: "stated",
  topicLabels: ["home"],
  confidence: 0.9,
  validAt: null,
};

const PROF_FLAG = {
  flagId: 2,
  requestId: 10,
  sourceId: 5,
  table: "instruction_profiles" as const,
  rowId: 3,
  policyReason: "instruction_profile",
  status: "open" as const,
  createdAt: "2026-10-26T00:00:00.000Z",
  reviewedAt: null,
  targetMissing: false,
  mode: "always",
  priority: 0,
  enabled: true,
  profileCreatedAt: "2026-10-26T00:00:00.000Z",
};

const INITIAL: UnresolvedFlagsList = { open: [UM_FLAG, PROF_FLAG], reviewed: [], reviewedCount: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  (window as unknown as { confirm: () => boolean }).confirm = () => true;
});

afterEach(() => cleanup());

describe("FlagsReviewSection — Forgotten words flagged for review", () => {
  // T-F1
  it("lists open flags with content-free descriptors (profile renders as #id, never its name)", async () => {
    listUnresolvedFlags.mockResolvedValue(INITIAL);
    render(<FlagsReviewSection />);
    await screen.findByText(/Forgotten words — flagged for review/);
    await screen.findByText("Your stated words");
    expect(screen.getByText("Instruction profile #3")).toBeTruthy();
    expect(screen.getByText("To review (2)")).toBeTruthy();
    // Controlled-vocabulary descriptors only — no content, no profile name.
    expect(screen.getByText(/belief · stated/)).toBeTruthy();
    expect(screen.getByText(/always · priority 0 · enabled/)).toBeTruthy();
    expect(screen.queryByText(/my unique probe/)).toBeNull();
  });

  // T-F2
  it("mark reviewed moves the row under the Reviewed filter", async () => {
    const reviewedUm = { ...UM_FLAG, status: "reviewed" as const, reviewedAt: "2026-10-26T01:00:00.000Z" };
    const after: UnresolvedFlagsList = { open: [PROF_FLAG], reviewed: [reviewedUm], reviewedCount: 1 };
    listUnresolvedFlags.mockResolvedValueOnce(INITIAL).mockResolvedValueOnce(after);
    reviewUnresolvedFlag.mockResolvedValue(reviewedUm);
    render(<FlagsReviewSection />);
    await screen.findByText("Your stated words");
    const card = screen.getByText("Your stated words").parentElement!;
    fireEvent.click(within(card).getByText("Mark reviewed"));
    await screen.findByText("Reviewed (1)");
    expect(reviewUnresolvedFlag).toHaveBeenCalledWith(1);
    expect(pushToast).toHaveBeenCalledWith("Marked as reviewed.", "✓", 3000);
    fireEvent.click(screen.getByText("Reviewed (1)"));
    expect(screen.getByText("Your stated words")).toBeTruthy();
    expect(screen.getByText("Reviewed.")).toBeTruthy();
    expect(screen.queryByText("Instruction profile #3")).toBeNull();
  });

  // T-F3
  it("delete is two-step, names table + row id, and removes the row on confirm", async () => {
    const after: UnresolvedFlagsList = { open: [UM_FLAG], reviewed: [], reviewedCount: 0 };
    listUnresolvedFlags.mockResolvedValueOnce(INITIAL).mockResolvedValueOnce(after);
    deleteUnresolvedFlagRow.mockResolvedValue({ ...PROF_FLAG, status: "resolved_deleted" as const });
    render(<FlagsReviewSection />);
    await screen.findByText("Instruction profile #3");
    const card = screen.getByText("Instruction profile #3").parentElement!;
    fireEvent.click(within(card).getByText("Delete row"));
    // Explicit confirm names the table + row id before anything is deleted.
    expect(screen.getByText(/Delete this instruction profile \(#3\)\?/)).toBeTruthy();
    expect(deleteUnresolvedFlagRow).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByText("Delete permanently"));
    await screen.findByText("To review (1)");
    expect(deleteUnresolvedFlagRow).toHaveBeenCalledWith(2);
    expect(screen.queryByText("Instruction profile #3")).toBeNull();
    expect(pushToast).toHaveBeenCalledWith("Row deleted.", "✓", 3000);
  });

  // T-F4
  it("a dangling flag offers dismiss instead of delete", async () => {
    const dangling = { ...PROF_FLAG, targetMissing: true };
    const initial: UnresolvedFlagsList = { open: [dangling], reviewed: [], reviewedCount: 0 };
    const after: UnresolvedFlagsList = { open: [], reviewed: [], reviewedCount: 0 };
    listUnresolvedFlags.mockResolvedValueOnce(initial).mockResolvedValueOnce(after);
    dismissUnresolvedFlag.mockResolvedValue({ ...dangling, status: "dismissed" as const });
    render(<FlagsReviewSection />);
    await screen.findByText("This row is already gone.");
    expect(screen.queryByText("Delete row")).toBeNull();
    fireEvent.click(screen.getByText("Dismiss flag"));
    await screen.findByText("Nothing flagged — no forgotten words are waiting for review.");
    expect(dismissUnresolvedFlag).toHaveBeenCalledWith(2);
  });

  // T-F5
  it("fail-soft: an unreachable list says so instead of pretending nothing is flagged", async () => {
    listUnresolvedFlags.mockResolvedValue(null);
    render(<FlagsReviewSection />);
    await screen.findByText(/Forgotten words — flagged for review/);
    expect(await screen.findByText(/Couldn't reach the server/)).toBeTruthy();
  });
});
