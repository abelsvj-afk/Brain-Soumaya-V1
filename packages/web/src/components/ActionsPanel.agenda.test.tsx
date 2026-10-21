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

import { ActionsPanel, dayGroupFor } from "./ActionsPanel.js";

function node(over: Partial<GraphNode>): GraphNode {
  return { id: 1, label: "Item", type: "concept", content: "", createdAt: new Date(Date.now() - 86400_000).toISOString(), ...over } as GraphNode;
}
beforeEach(() => { vi.resetAllMocks(); ackReminder.mockResolvedValue(true); updateAgendaItem.mockResolvedValue({}); ingestText.mockResolvedValue({ nodes: [] }); deleteNode.mockResolvedValue(undefined); });
afterEach(() => cleanup());

describe("IM-52 absolute times", () => {
  it("due-now reminder shows full local time and overdue countdown, not just 'due now'", async () => {
    const past = new Date(Date.now() - 2 * 3600_000).toISOString();
    render(<ActionsPanel nodes={[node({ id: 1, label: "Call mum", remindAt: past })]} onFocus={() => {}} />);
    await screen.findByText("Call mum");
    expect(screen.getByText(/overdue 2h/)).toBeTruthy();
    const expected = new Date(past).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    expect(screen.getAllByText((_, el) => Boolean(el?.classList?.contains("agenda-due") && el?.textContent?.includes(expected))).length).toBeGreaterThan(0);
  });
  it("action shows full local due date alongside countdown", async () => {
    const future = new Date(Date.now() + 2 * 86400_000).toISOString();
    render(<ActionsPanel nodes={[node({ id: 1, label: "File taxes", kind: "action", expiresAt: future })]} onFocus={() => {}} />);
    await screen.findByText("File taxes");
    const expected = new Date(future).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    expect(screen.getAllByText((_, el) => Boolean(el?.classList?.contains("agenda-due") && el?.textContent?.includes(expected))).length).toBeGreaterThan(0);
  });
});

describe("IM-53 search, grouping, row details", () => {
  it("search filters by label, content and tags", async () => {
    render(<ActionsPanel nodes={[
      node({ id: 1, label: "Alpha", kind: "action", content: "contains zebra detail" }),
      node({ id: 2, label: "Beta", kind: "action", content: "plain", tags: ["Work"] }),
    ]} onFocus={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search agenda"), { target: { value: "zebra" } });
    expect(screen.queryByText("Beta")).toBeNull();
    expect(screen.getByText("Alpha")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search agenda"), { target: { value: "work" } });
    expect(screen.getByText("Beta")).toBeTruthy();
  });
  it("rows show content snippet, tags and created date", async () => {
    render(<ActionsPanel nodes={[node({ id: 1, label: "Alpha", kind: "action", content: "A useful snippet here", tags: ["Work"] })]} onFocus={() => {}} />);
    await screen.findByText(/A useful snippet here/);
    expect(screen.getByText(/#Work/)).toBeTruthy();
    expect(screen.getByText(/Added /)).toBeTruthy();
  });
  it("dayGroupFor buckets overdue/today/tomorrow/week/later", () => {
    const now = new Date(); now.setHours(12, 0, 0, 0);
    const at = (days: number) => new Date(now.getTime() + days * 86400_000).getTime();
    expect(dayGroupFor(at(-1), now.getTime()).label).toBe("Overdue");
    expect(dayGroupFor(at(0), now.getTime()).label).toBe("Today");
    expect(dayGroupFor(at(1), now.getTime()).label).toBe("Tomorrow");
    expect(dayGroupFor(at(3), now.getTime()).label).toBe("This week");
    expect(dayGroupFor(at(20), now.getTime()).label).toBe("Later");
  });
  it("renders day-group headings for actions", async () => {
    const tomorrow = new Date(Date.now() + 86400_000).toISOString();
    render(<ActionsPanel nodes={[node({ id: 1, label: "Tomorrow task", kind: "action", expiresAt: tomorrow })]} onFocus={() => {}} />);
    await screen.findByText("Tomorrow");
  });
});

describe("IM-54 overflow reachable", () => {
  it("'+N more' is a button that expands to reveal overflow items", async () => {
    const many = Array.from({ length: 60 }, (_, i) => node({ id: i + 1, label: `Action ${i + 1}`, kind: "action" }));
    render(<ActionsPanel nodes={many} onFocus={() => {}} />);
    await screen.findByText("Action 1");
    expect(screen.queryByText("Action 51")).toBeNull();
    const more = screen.getByText(/\+10 more/);
    expect(more.tagName).toBe("BUTTON");
    await act(async () => { (more as HTMLElement).click(); });
    await screen.findByText("Action 51");
    expect(screen.getByText("Action 60")).toBeTruthy();
  });
});

describe("IM-51 create / edit / snooze", () => {
  it("creates an action via ingestText with kind action", async () => {
    render(<ActionsPanel nodes={[node({ id: 9, label: "Existing", kind: "action" })]} onFocus={() => {}} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("New agenda item"), { target: { value: "Buy milk today" } });
    await act(async () => { screen.getByText("Add").click(); });
    await waitFor(() => expect(ingestText).toHaveBeenCalledWith("Buy milk today", expect.objectContaining({ kind: "action" })));
  });
  it("creates a reminder via ingestText with remindAt when a time is picked", async () => {
    render(<ActionsPanel nodes={[node({ id: 9, label: "Existing", kind: "action" })]} onFocus={() => {}} />);
    fireEvent.change(screen.getByLabelText("New agenda item"), { target: { value: "Call dentist" } });
    fireEvent.change(screen.getByLabelText("New item type"), { target: { value: "reminder" } });
    fireEvent.change(screen.getByLabelText("New item date and time"), { target: { value: "2030-01-02T09:30" } });
    await act(async () => { screen.getByText("Add").click(); });
    await waitFor(() => expect(ingestText).toHaveBeenCalledWith("Call dentist", expect.objectContaining({ remindAt: expect.any(String) })));
  });
  it("snoozes a due reminder by 1 hour via updateAgendaItem", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const before = Date.now();
    render(<ActionsPanel nodes={[node({ id: 3, label: "Due thing", remindAt: past })]} onFocus={() => {}} />);
    const btn = await screen.findByTitle("Snooze 1 hour");
    await act(async () => { btn.click(); });
    await waitFor(() => expect(updateAgendaItem).toHaveBeenCalled());
    const patch = updateAgendaItem.mock.calls[0]![1] as { remindAt: string };
    const delta = Date.parse(patch.remindAt) - before;
    expect(delta).toBeGreaterThan(50 * 60_000); expect(delta).toBeLessThan(70 * 60_000);
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Snoozed"), "💤", expect.any(Number));
  });
  it("edits label/content/date via updateAgendaItem", async () => {
    const future = new Date(Date.now() + 86400_000).toISOString();
    render(<ActionsPanel nodes={[node({ id: 4, label: "Old label", kind: "action", content: "old", expiresAt: future })]} onFocus={() => {}} />);
    const editBtns = await screen.findAllByText("Edit");
    await act(async () => { editBtns[0]!.click(); });
    fireEvent.change(screen.getByLabelText("Edit label"), { target: { value: "New label" } });
    await act(async () => { screen.getByText("Save changes").click(); });
    await waitFor(() => expect(updateAgendaItem).toHaveBeenCalledWith(4, expect.objectContaining({ label: "New label" })));
  });
});

describe("IM-55 confirmations + success feedback", () => {
  it("Done does not delete until confirmed, and cancelling keeps the item", async () => {
    render(<ActionsPanel nodes={[node({ id: 1, label: "Ship it", kind: "action" })]} onFocus={() => {}} />);
    await act(async () => { (await screen.findByTitle(/Mark done/)).click(); });
    expect(deleteNode).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await act(async () => { screen.getByText("Keep it").click(); });
    expect(deleteNode).not.toHaveBeenCalled();
    await act(async () => { (await screen.findByTitle(/Mark done/)).click(); });
    await act(async () => { screen.getByText("Confirm done").click(); });
    await waitFor(() => expect(deleteNode).toHaveBeenCalledWith(1));
  });
  it("successful Ack gives success feedback (toast), not silence", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    render(<ActionsPanel nodes={[node({ id: 1, label: "Due thing", remindAt: past })]} onFocus={() => {}} />);
    await act(async () => { (await screen.findByTitle("Acknowledge — stop reminding")).click(); });
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("acknowledged"), "🔔", expect.any(Number)));
  });
  it("a failed Ack (boolean false) is not reported as success", async () => {
    ackReminder.mockResolvedValue(false);
    const past = new Date(Date.now() - 60_000).toISOString();
    render(<ActionsPanel nodes={[node({ id: 1, label: "Due thing", remindAt: past })]} onFocus={() => {}} />);
    await act(async () => { (await screen.findByTitle("Acknowledge — stop reminding")).click(); });
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't acknowledge"), "⚠️", expect.any(Number)));
  });
});
