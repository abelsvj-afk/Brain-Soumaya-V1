import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

const ingestText = vi.fn();
vi.mock("../api/client.js", () => ({ ingestText: (...a: unknown[]) => ingestText(...a) }));
const extractFileText = vi.fn();
vi.mock("../lib/extractFileText.js", () => ({ extractFileText: (...a: unknown[]) => extractFileText(...a) }));
vi.mock("./JourneyChips.js", () => ({ JourneyChips: () => null }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));
import { IngestPanel } from "./IngestPanel.js";

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  ingestText.mockResolvedValue({
    nodes: [{ id: 1, label: "alpha thought" }, { id: 2, label: "beta thought" }],
    extractedEdges: [{}], associativeEdges: [], fuelEarned: 0,
  });
  extractFileText.mockResolvedValue({ text: "text from the file body", name: "notes" });
});
afterEach(cleanup);

describe("IM-117 — draft persistence + discard confirm", () => {
  it("restores a saved draft on reopen instead of starting empty", () => {
    localStorage.setItem("brain.ingestDraft", JSON.stringify({ text: "a long brain dump", details: "", tags: [], action: false, ttl: 24, occurred: "", remind: "" }));
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    expect((screen.getByPlaceholderText(/A business idea/) as HTMLTextAreaElement).value).toBe("a long brain dump");
  });

  it("closing with a draft asks via ConfirmDialog; Keep writing preserves it", async () => {
    const onClose = vi.fn();
    render(<IngestPanel onIngested={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText(/A business idea/), { target: { value: "unsaved thoughts" } });
    fireEvent.click(screen.getByLabelText("Close"));
    expect(await screen.findByText("Discard this draft?")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Keep writing"));
    expect(onClose).not.toHaveBeenCalled();
    // Confirming the discard clears the draft and closes.
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(await screen.findByText("Discard"));
    expect(onClose).toHaveBeenCalled();
    expect(localStorage.getItem("brain.ingestDraft")).toBeNull();
  });
});

describe("IM-117 — created-nodes preview + separated error surface", () => {
  it("lists every created node's label after a save", async () => {
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/A business idea/), { target: { value: "two thoughts" } });
    await act(async () => { fireEvent.click(screen.getByText("Add to brain")); });
    expect(await screen.findByText("alpha thought")).toBeTruthy();
    expect(screen.getByText("beta thought")).toBeTruthy();
  });

  it("renders failures in the alert surface, not the success span", async () => {
    ingestText.mockRejectedValue(new Error("server exploded"));
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/A business idea/), { target: { value: "boom" } });
    await act(async () => { fireEvent.click(screen.getByText("Add to brain")); });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("server exploded");
  });
});

describe("IM-116 — file import via the extraction pipeline", () => {
  it("fills the capture box with the extracted text from a picked file", async () => {
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText("Import a file") as HTMLInputElement;
    const file = new File(["raw"], "notes.txt", { type: "text/plain" });
    await act(async () => { fireEvent.change(input, { target: { files: [file] } }); });
    expect(extractFileText).toHaveBeenCalledWith(file);
    expect((screen.getByPlaceholderText(/A business idea/) as HTMLTextAreaElement).value).toContain("text from the file body");
  });

  it("imports via drag-drop too", async () => {
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    const panel = screen.getByTestId("ingest-panel");
    const file = new File(["raw"], "drop.md", { type: "text/markdown" });
    await act(async () => { fireEvent.drop(panel, { dataTransfer: { files: [file] } }); });
    expect(extractFileText).toHaveBeenCalledWith(file);
  });
});
