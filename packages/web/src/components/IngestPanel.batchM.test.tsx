import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, waitFor } from "@testing-library/react";

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
  ingestText.mockResolvedValue({
    nodes: [{ id: 1, label: "alpha thought" }, { id: 2, label: "beta thought" }],
    extractedEdges: [],
    associativeEdges: [],
    fuelEarned: 0,
  });
});
afterEach(() => cleanup());

const box = () => screen.getByPlaceholderText(/A business idea/) as HTMLTextAreaElement;
const local = (d: Date) => {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

describe("REG-144 (AG-05) — an action item cannot carry a reminder", () => {
  it("refuses the combination with a stated reason and never submits", async () => {
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "buy milk" } });
    act(() => screen.getByText("+ When / remind me (optional)").click());
    const remindInput = screen.getByLabelText("⏰ Remind me") as HTMLInputElement;
    fireEvent.change(remindInput, { target: { value: local(new Date(Date.now() + 3600_000)) } });
    fireEvent.click(screen.getByLabelText(/Action item/));
    await act(async () => { screen.getByText("Add action item").click(); });
    expect(ingestText).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("can't carry a separate reminder");
  });

  it("warns inline while both are set, before submit", () => {
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "buy milk" } });
    act(() => screen.getByText("+ When / remind me (optional)").click());
    fireEvent.change(screen.getByLabelText("⏰ Remind me"), { target: { value: local(new Date(Date.now() + 3600_000)) } });
    fireEvent.click(screen.getByLabelText(/Action item/));
    expect(screen.getByText(/action items can't carry one/)).toBeTruthy();
  });

  it("still saves a plain action (no reminder set) and a plain reminder (no action ticked)", async () => {
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "buy milk" } });
    fireEvent.click(screen.getByLabelText(/Action item/));
    await act(async () => { screen.getByText("Add action item").click(); });
    await waitFor(() => expect(ingestText).toHaveBeenCalledTimes(1));
    expect(ingestText.mock.calls[0]![1]).not.toHaveProperty("remindAt");
  });
});

describe("REG-143 (AG-04) — the capture success message names the reminder's carrier", () => {
  it("names the first node when a reminder was set", async () => {
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "call the dentist and buy oat milk" } });
    act(() => screen.getByText("+ When / remind me (optional)").click());
    fireEvent.change(screen.getByLabelText("⏰ Remind me"), { target: { value: local(new Date(Date.now() + 3600_000)) } });
    await act(async () => { screen.getByText("Add to brain").click(); });
    await waitFor(() => expect(ingestText).toHaveBeenCalled());
    expect(screen.getByText(/reminder on "alpha thought"/)).toBeTruthy();
  });
});
