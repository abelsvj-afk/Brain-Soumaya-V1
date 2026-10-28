import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import type { LoreEntry } from "@brain/shared";

/**
 * CL-2 (Immersion Round 2) — Chronicle items IM-29 (loading skeleton),
 * IM-31 (loading ≠ empty ≠ failure), IM-35 (trigger + local date per chapter).
 */

const getLoreStrict = vi.fn();
const evolveLore = vi.fn();
vi.mock("../api/client.js", () => ({
  getLoreStrict: (...a: unknown[]) => getLoreStrict(...a),
  // The pre-IM-31 component called fail-soft getLore — alias it to the same
  // mock so falsification runs the OLD component against the same promises
  // and fails on its renders, not on a missing mock export.
  getLore: (...a: unknown[]) => getLoreStrict(...a),
  evolveLore: (...a: unknown[]) => evolveLore(...a),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { Chronicle, fmtLoreWhen, fmtLoreTrigger } from "./Chronicle.js";

function entry(over: Partial<LoreEntry>): LoreEntry {
  return {
    id: 1,
    subjectType: "memory",
    subjectId: "5",
    version: 1,
    text: "a chapter",
    trigger: "genesis",
    createdAt: "2026-01-01T10:00:00Z",
    ...over,
  } as LoreEntry;
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

describe("IM-31 — loading, failure and empty are three different states", () => {
  it("while loading it shows a skeleton, NOT the empty-story copy", async () => {
    getLoreStrict.mockReturnValue(new Promise(() => {})); // never resolves
    render(<Chronicle subjectType="memory" subjectId="5" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("Its story hasn't been written yet.")).toBeNull();
  });

  it("a failed load shows an error + Retry — never the empty-story copy — and retry recovers", async () => {
    getLoreStrict.mockRejectedValueOnce(new Error("boom"));
    render(<Chronicle subjectType="memory" subjectId="5" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn’t load its story");
    expect(screen.queryByText("Its story hasn't been written yet.")).toBeNull();

    getLoreStrict.mockResolvedValue([entry({ text: "recovered chapter" })]);
    await act(async () => {
      screen.getByText("Retry").click();
    });
    await screen.findByText("recovered chapter");
  });

  it("only a successful EMPTY load shows the empty-story copy", async () => {
    getLoreStrict.mockResolvedValue([]);
    render(<Chronicle subjectType="memory" subjectId="5" />);
    await screen.findByText("Its story hasn't been written yet.");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("IM-35 — chapters render their trigger and local date", () => {
  it("the current chapter and expanded history both carry trigger + date", async () => {
    getLoreStrict.mockResolvedValue([
      entry({ id: 1, version: 1, text: "genesis chapter", trigger: "genesis", createdAt: "2026-01-01T10:00:00Z" }),
      entry({ id: 2, version: 2, text: "latest chapter", trigger: "evolved", createdAt: "2026-02-02T10:00:00Z" }),
    ]);
    render(<Chronicle subjectType="memory" subjectId="5" />);
    await screen.findByText("latest chapter");
    // Current chapter: trigger + a formatted local date (year visible).
    // REG-109: triggers render as plain-language causes, never raw tokens.
    expect(screen.getByText(/grew from new memories · /)).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();

    await act(async () => {
      screen.getByText("Earlier chapters (1)").click();
    });
    expect(screen.getByText(/genesis chapter/)).toBeTruthy();
    expect(screen.getByText(/her first telling · /)).toBeTruthy();
  });

  it("fmtLoreWhen falls back to a human placeholder, never the raw stored value", () => {
    expect(fmtLoreWhen("garbage-value")).toBe("date unavailable");
  });
});

describe("REG-109 — every trigger renders as a plain-language cause", () => {
  it("maps every trigger the codebase writes, with a human fallback for unknown ones", async () => {
    expect(fmtLoreTrigger("genesis")).toBe("her first telling");
    expect(fmtLoreTrigger("manual")).toBe("you asked for a new chapter");
    expect(fmtLoreTrigger("revised")).toBe("revised as beliefs changed");
    expect(fmtLoreTrigger("merged")).toBe("merged from related chapters");
    expect(fmtLoreTrigger("linked")).toBe("linked to new memories");
    expect(fmtLoreTrigger("evolved")).toBe("grew from new memories");
    // Unknown future tokens never reach the UI raw — humanized, never verbatim.
    expect(fmtLoreTrigger("dream_cycle")).toBe("dream cycle");
    expect(fmtLoreTrigger("dreamCycle")).toBe("dream cycle");
    expect(fmtLoreTrigger("")).toBe("updated");
  });

  it("the rendered chapter meta shows the mapped cause, never the raw token", async () => {
    getLoreStrict.mockResolvedValue([
      entry({ id: 1, version: 1, text: "a manual chapter", trigger: "manual", createdAt: "2026-01-01T10:00:00Z" }),
    ]);
    render(<Chronicle subjectType="memory" subjectId="5" />);
    await screen.findByText("a manual chapter");
    expect(screen.getByText(/you asked for a new chapter · /)).toBeTruthy();
    expect(screen.queryByText(/manual · /)).toBeNull();
  });
});
