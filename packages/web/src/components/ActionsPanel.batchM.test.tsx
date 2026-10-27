import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
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
  return { id: 1, label: "Item", type: "concept", content: "", createdAt: new Date(Date.now() - 86400_000).toISOString(), ...over } as GraphNode;
}
beforeEach(() => {
  vi.resetAllMocks();
  ackReminder.mockResolvedValue(true);
  updateAgendaItem.mockResolvedValue({});
  ingestText.mockResolvedValue({ nodes: [{ id: 9, label: "Call the dentist" }] });
  deleteNode.mockResolvedValue({});
});
afterEach(() => cleanup());

describe("REG-145 (AG-06) — done/dismiss controls carry visible captions", () => {
  it("the action done button reads 'Done', not a bare glyph", async () => {
    render(<ActionsPanel nodes={[node({ id: 1, label: "File taxes", kind: "action", expiresAt: new Date(Date.now() + 3600_000).toISOString() })]} onFocus={() => {}} />);
    const btn = await screen.findByRole("button", { name: "Mark done" });
    expect(btn.textContent).toContain("Done");
  });
  it("the due-reminder ack button reads 'Acknowledge' and the upcoming dismiss button reads 'Dismiss'", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    render(<ActionsPanel nodes={[
      node({ id: 1, label: "Call mum", remindAt: past }),
      node({ id: 2, label: "Water plants", remindAt: future }),
    ]} onFocus={() => {}} />);
    expect((await screen.findByRole("button", { name: "Acknowledge reminder" })).textContent).toContain("Acknowledge");
    expect((await screen.findByRole("button", { name: "Dismiss reminder" })).textContent).toContain("Dismiss");
  });
});

describe("REG-147 (AG-08) — Agenda Zero fires only on the user's own last clear", () => {
  it("does NOT celebrate when the list empties without a completion (brain switch to an empty brain)", async () => {
    const { rerender } = render(<ActionsPanel nodes={[node({ id: 1, label: "Only task", kind: "action" })]} onFocus={() => {}} />);
    await screen.findByText("Only task");
    rerender(<ActionsPanel nodes={[]} onFocus={() => {}} />);
    await waitFor(() => expect(screen.getByText(/No action items or reminders/)).toBeTruthy());
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("Agenda Zero"), expect.anything(), expect.anything());
    expect(playSfx).not.toHaveBeenCalledWith("milestone");
  });

  it("DOES celebrate when the user completes the final action item", async () => {
    render(<ActionsPanel nodes={[node({ id: 1, label: "Only task", kind: "action", expiresAt: new Date(Date.now() + 3600_000).toISOString() })]} onFocus={() => {}} />);
    await act(async () => { (await screen.findByTitle(/Mark done/)).click(); });
    await act(async () => { (await screen.findByText("Confirm done")).click(); });
    await waitFor(() => expect(deleteNode).toHaveBeenCalledWith(1));
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Agenda Zero"), "🎯", 4500));
    expect(playSfx).toHaveBeenCalledWith("milestone");
  });

  it("does NOT celebrate when the user completes one of several action items", async () => {
    render(<ActionsPanel nodes={[
      node({ id: 1, label: "Task one", kind: "action", expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      node({ id: 2, label: "Task two", kind: "action", expiresAt: new Date(Date.now() + 7200_000).toISOString() }),
    ]} onFocus={() => {}} />);
    await act(async () => { (await screen.findAllByTitle(/Mark done/))[0]!.click(); });
    await act(async () => { (await screen.findByText("Confirm done")).click(); });
    await waitFor(() => expect(deleteNode).toHaveBeenCalled());
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("Agenda Zero"), expect.anything(), expect.anything());
  });
});

describe("REG-160 (JN-03) — completing a linked mission surfaces the journey's new progress", () => {
  it("toasts the journey name, missions completed, and new progress at the moment of completion", async () => {
    deleteNode.mockResolvedValue({
      journeyProgress: [{ journeyId: 7, title: "Become an RN", progress: 0.6, missionsCompleted: 3 }],
    });
    render(<ActionsPanel nodes={[node({ id: 1, label: "Finish module", kind: "action", expiresAt: new Date(Date.now() + 3600_000).toISOString() })]} onFocus={() => {}} />);
    await act(async () => { (await screen.findByTitle(/Mark done/)).click(); });
    await act(async () => { (await screen.findByText("Confirm done")).click(); });
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(
      expect.stringContaining("Become an RN"),
      "🧭",
      4500,
    ));
    const call = pushToast.mock.calls.find((c) => String(c[0]).includes("Become an RN"));
    expect(String(call?.[0])).toContain("3 missions done");
    expect(String(call?.[0])).toContain("60%");
  });

  it("creates no journey toast when nothing was linked", async () => {
    deleteNode.mockResolvedValue({});
    render(<ActionsPanel nodes={[node({ id: 1, label: "Unlinked task", kind: "action", expiresAt: new Date(Date.now() + 3600_000).toISOString() })]} onFocus={() => {}} />);
    await act(async () => { (await screen.findByTitle(/Mark done/)).click(); });
    await act(async () => { (await screen.findByText("Confirm done")).click(); });
    await waitFor(() => expect(deleteNode).toHaveBeenCalled());
    expect(pushToast.mock.calls.some((c) => c[1] === "🧭")).toBe(false);
  });
});

describe("REG-143 (AG-04) — the create toast names the one node carrying the reminder", () => {
  it("names the carrier node returned by ingest", async () => {
    ingestText.mockResolvedValue({ nodes: [{ id: 9, label: "Call the dentist" }, { id: 10, label: "Buy oat milk" }] });
    render(<ActionsPanel nodes={[]} onFocus={() => {}} />);
    fireEvent.change(screen.getByLabelText("New agenda item"), { target: { value: "Call the dentist and buy oat milk" } });
    fireEvent.change(screen.getByLabelText("New item type"), { target: { value: "reminder" } });
    const when = new Date(Date.now() + 3600_000);
    const pad = (v: number) => String(v).padStart(2, "0");
    const local = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
    fireEvent.change(screen.getByLabelText("New item date and time"), { target: { value: local } });
    await act(async () => { screen.getByText("Add").click(); });
    await waitFor(() => expect(ingestText).toHaveBeenCalled());
    const call = pushToast.mock.calls.find((c) => String(c[0]).includes("Reminder added"));
    expect(call).toBeTruthy();
    expect(String(call?.[0])).toContain("Call the dentist");
  });
});
