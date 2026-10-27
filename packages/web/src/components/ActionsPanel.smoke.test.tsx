import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import type { GraphNode } from "@brain/shared";

const deleteNode = vi.fn();
const ackReminder = vi.fn();
const ingestText = vi.fn();
const updateAgendaItem = vi.fn();
vi.mock("../api/client.js", () => ({
  deleteNode: (...a: unknown[]) => deleteNode(...a),
  ackReminder: (...a: unknown[]) => ackReminder(...a),
  ingestText: (...a: unknown[]) => ingestText(...a),
  updateAgendaItem: (...a: unknown[]) => updateAgendaItem(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { ActionsPanel } from "./ActionsPanel.js";

function node(over: Partial<GraphNode>): GraphNode {
  return { id: 1, label: "A reminder", type: "concept", content: "", ...over } as GraphNode;
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

describe("ActionsPanel — acknowledging a due reminder tells the rest of the app", () => {
  it("calls onChanged() after a successful ack, so other stale views refresh", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const onChanged = vi.fn();
    ackReminder.mockResolvedValue(true);
    render(<ActionsPanel nodes={[node({ id: 1, label: "Due thing", remindAt: past })]} onFocus={() => {}} onChanged={onChanged} />);

    const ackBtn = await screen.findByTitle("Acknowledge — stop reminding");
    await act(async () => { ackBtn.click(); });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe("ActionsPanel — the acked mask clears once the server catches up", () => {
  it("stops masking an id once its remindAt is actually gone from a refreshed nodes prop", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    ackReminder.mockResolvedValue(true);
    const withReminder = [node({ id: 1, label: "Due thing", remindAt: past })];
    const { rerender } = render(<ActionsPanel nodes={withReminder} onFocus={() => {}} />);

    const ackBtn = await screen.findByTitle("Acknowledge — stop reminding");
    await act(async () => { ackBtn.click(); });
    await waitFor(() => expect(screen.queryByText("Due thing")).toBeNull());

    // Server hasn't actually cleared remind_at yet on this next render — still masked.
    rerender(<ActionsPanel nodes={withReminder} onFocus={() => {}} />);
    expect(screen.queryByText("Due thing")).toBeNull();

    // Now a real refresh lands with remind_at cleared — the same id must be able
    // to surface again as a fresh reminder later, not be masked forever.
    rerender(<ActionsPanel nodes={[node({ id: 1, label: "Due thing", remindAt: undefined })]} onFocus={() => {}} />);
    rerender(<ActionsPanel nodes={[node({ id: 1, label: "Due thing", remindAt: past })]} onFocus={() => {}} />);
    await screen.findByText("Due thing");
  });
});

describe("ActionsPanel — clearing a task is celebrated, not silent", () => {
  it("plays a sound and toasts on a successful clear", async () => {
    deleteNode.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    render(<ActionsPanel nodes={[node({ id: 1, label: "Ship it", kind: "action" })]} onFocus={() => {}} onChanged={onChanged} />);
    const doneBtn = await screen.findByTitle(/Mark done/);
    await act(async () => { doneBtn.click(); });
    const confirmBtn = await screen.findByText("Confirm done");
    await act(async () => { confirmBtn.click(); });
    expect(playSfx).toHaveBeenCalledWith("complete");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Ship it"), "✅", expect.any(Number));
    expect(onChanged).toHaveBeenCalled();
  });
});

describe("ActionsPanel — Agenda Zero is celebrated, not silent", () => {
  it("plays a milestone sound only when the user clears the final item, never on an empty mount or a bare count transition", async () => {
    deleteNode.mockResolvedValue({});
    const { rerender } = render(<ActionsPanel nodes={[]} onFocus={() => {}} />);
    expect(playSfx).not.toHaveBeenCalled();

    rerender(<ActionsPanel nodes={[node({ id: 1, label: "One task", kind: "action", expiresAt: new Date(Date.now() + 3600_000).toISOString() })]} onFocus={() => {}} />);
    await screen.findByText("One task");
    expect(playSfx).not.toHaveBeenCalled();

    // REG-147/AG-08: a bare >0 → 0 transition (e.g. a brain switch to an empty
    // brain) must NOT celebrate — only the user's own completion does.
    rerender(<ActionsPanel nodes={[]} onFocus={() => {}} />);
    expect(playSfx).not.toHaveBeenCalledWith("milestone");
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("Agenda Zero"), expect.anything(), expect.anything());

    // The celebration still fires when the user completes the final item.
    rerender(<ActionsPanel nodes={[node({ id: 1, label: "One task", kind: "action", expiresAt: new Date(Date.now() + 3600_000).toISOString() })]} onFocus={() => {}} />);
    await act(async () => { (await screen.findByTitle(/Mark done/)).click(); });
    await act(async () => { (await screen.findByText("Confirm done")).click(); });
    await waitFor(() => expect(deleteNode).toHaveBeenCalledWith(1));
    expect(playSfx).toHaveBeenCalledWith("milestone");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Agenda Zero"), "🎯", 4500);
  });
});

describe("ActionsPanel — a huge action list doesn't render unbounded", () => {
  it("caps the action items list and shows a '+N more' hint", async () => {
    const many = Array.from({ length: 60 }, (_, i) => node({ id: i + 1, label: `Action ${i + 1}`, kind: "action" }));
    render(<ActionsPanel nodes={many} onFocus={() => {}} />);
    await screen.findByText("Action 1");
    expect(screen.queryByText("Action 51")).toBeNull();
    expect(screen.getByText(/\+10 more/)).toBeTruthy();
  });
});

describe("ActionsPanel — upcoming reminders show real urgency, not just text", () => {
  it("marks a reminder due within the hour as urgent", async () => {
    const soon = new Date(Date.now() + 30 * 60_000).toISOString(); // in 30 min
    render(<ActionsPanel nodes={[node({ id: 1, label: "Soon thing", remindAt: soon })]} onFocus={() => {}} />);
    const label = await screen.findByText("Soon thing");
    const due = label.closest("button")?.querySelector(".agenda-due");
    expect(due?.className).toContain("urgent");
  });
});

describe("ActionsPanel — a fully empty agenda is no longer a dead end", () => {
  it("offers a way to capture a thought right from the empty state", async () => {
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    render(<ActionsPanel nodes={[]} onFocus={() => {}} />);
    const captureBtn = await screen.findByText("➕ Dump a thought");
    act(() => captureBtn.click());
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "panel", value: "ingest" } }));
    window.removeEventListener("brain-toast-action", onAction);
  });
});

describe("ActionsPanel — an upcoming reminder can be dismissed, not just flown to", () => {
  it("acknowledges the reminder when the dismiss button is clicked", async () => {
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    ackReminder.mockResolvedValue(true);
    render(<ActionsPanel nodes={[node({ id: 1, label: "Soon thing", remindAt: soon })]} onFocus={() => {}} />);
    const dismissBtn = await screen.findByTitle("Dismiss — cancel this reminder");
    await act(async () => { dismissBtn.click(); });
    expect(ackReminder).not.toHaveBeenCalled();
    const confirmBtn = await screen.findByText("Confirm dismiss");
    await act(async () => { confirmBtn.click(); });
    await waitFor(() => expect(ackReminder).toHaveBeenCalledWith(1));
  });
});

describe("ActionsPanel — an overdue action shows how overdue, not a flat label forever", () => {
  it("grows the overdue text with elapsed time instead of a static 'overdue'", async () => {
    const wayOverdue = new Date(Date.now() - 2 * 24 * 3600_000).toISOString(); // 2 days late
    render(<ActionsPanel nodes={[node({ id: 1, label: "Late task", kind: "action", expiresAt: wayOverdue })]} onFocus={() => {}} />);
    await screen.findByText(/overdue 2d/);
  });
});

// Life Vision (docs/specs/life-vision.md, C2.1/C3.2-locked): a Vision's target date is
// not a reminder and must never get ack/dismiss controls here.
describe("ActionsPanel — a Life Vision's target date is not a reminder", () => {
  it("never lists a life_vision node in the Agenda reminders, even with a past remindAt", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    render(<ActionsPanel nodes={[node({ id: 1, kind: "life_vision", label: "Our first house", remindAt: past })]} onFocus={() => {}} />);
    expect(screen.queryByText("Our first house")).toBeNull();
    expect(screen.queryByTitle("Acknowledge — stop reminding")).toBeNull();
  });
});
