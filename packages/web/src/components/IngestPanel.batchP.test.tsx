import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

/**
 * Batch P — REG-040: each capture surface makes its limit knowable BEFORE
 * submission (counter, cap, or pre-submit notice).
 */

const ingestText = vi.fn();
const getSpaceId = vi.fn((): string | null => "space1");
vi.mock("../api/client.js", () => ({
  ingestText: (...a: unknown[]) => ingestText(...a),
  getSpaceId: () => getSpaceId(),
}));
const extractFileText = vi.fn();
vi.mock("../lib/extractFileText.js", () => ({ extractFileText: (...a: unknown[]) => extractFileText(...a) }));
vi.mock("./JourneyChips.js", () => ({ JourneyChips: () => null }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { IngestPanel } from "./IngestPanel.js";

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getSpaceId.mockReturnValue("space1");
  ingestText.mockResolvedValue({ nodes: [], extractedEdges: [], associativeEdges: [], fuelEarned: 0 });
  extractFileText.mockResolvedValue({ text: "text from the file body", name: "notes" });
});
afterEach(() => cleanup());

const box = () => screen.getByPlaceholderText(/A business idea/) as HTMLTextAreaElement;

describe("REG-040 — the Add panel states its 20,000-character limit before submit", () => {
  it("shows a live character counter under the capture box", () => {
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/0 \/ 20,000/)).toBeTruthy();
    fireEvent.change(box(), { target: { value: "hello" } });
    expect(screen.getByText(/5 \/ 20,000/)).toBeTruthy();
  });

  it("warns before submission when the text is over the cap", () => {
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "x".repeat(20_001) } });
    expect(screen.getByText(/over the 20,000-character limit/i)).toBeTruthy();
  });

  it("an imported file that pushes the draft over the cap says so", async () => {
    extractFileText.mockResolvedValue({ text: "y".repeat(20_001), name: "big" });
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Import a file") as HTMLInputElement;
    const file = new File(["dummy"], "big.txt", { type: "text/plain" });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    expect(screen.getByText(/over the 20,000-character limit/i)).toBeTruthy();
  });
});
