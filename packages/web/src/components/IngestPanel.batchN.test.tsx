import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

/**
 * Batch N — REG-150 / INS-03: the Capture "Research Mode" claim must match
 * the picker's reality. The autonomous picker pools importance >= 0.45
 * (not 0.6 — that figure is the self-check's blind-spot count), and the
 * "stored, no research needed" branch is false for the 0.45–0.59 band and
 * for every user-requested tend (which researches at any importance).
 */

const ingestText = vi.fn();
const getSpaceId = vi.fn((): string | null => "brainA");
vi.mock("../api/client.js", () => ({
  ingestText: (...a: unknown[]) => ingestText(...a),
  getSpaceId: () => getSpaceId(),
}));
vi.mock("../lib/extractFileText.js", () => ({ extractFileText: vi.fn() }));
vi.mock("./JourneyChips.js", () => ({ JourneyChips: () => null }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { IngestPanel } from "./IngestPanel.js";

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getSpaceId.mockReturnValue("brainA");
});
afterEach(() => cleanup());

const box = () => screen.getByPlaceholderText(/A business idea/) as HTMLTextAreaElement;

async function submitWithImportance(importance: number) {
  ingestText.mockResolvedValue({
    nodes: [{ id: 1, label: "a thought", importance }],
    extractedEdges: [],
    associativeEdges: [],
    fuelEarned: 0,
  });
  render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
  fireEvent.change(box(), { target: { value: "some words" } });
  await act(async () => {
    fireEvent.click(screen.getByText("Add to brain"));
  });
  return document.querySelector(".msg")?.textContent ?? "";
}

describe("REG-150 / INS-03 — the Research Mode claim matches the picker", () => {
  it("a 0.5-importance capture (in the real 0.45+ pool) may be researched — never 'no research needed'", async () => {
    const msg = await submitWithImportance(0.5);
    expect(msg).toMatch(/may be researched in Research Mode/);
    expect(msg).not.toMatch(/no research needed/i);
    expect(msg).not.toMatch(/0\.6/);
  });

  it("a 0.9-importance capture may be researched in Research Mode", async () => {
    const msg = await submitWithImportance(0.9);
    expect(msg).toMatch(/may be researched in Research Mode/);
    expect(msg).not.toMatch(/no research needed/i);
  });

  it("a light 0.3-importance capture is simply stored — no research claim either way", async () => {
    const msg = await submitWithImportance(0.3);
    expect(msg).toMatch(/stored/i);
    expect(msg).not.toMatch(/no research needed/i);
    expect(msg).not.toMatch(/may be researched/i);
  });
});
