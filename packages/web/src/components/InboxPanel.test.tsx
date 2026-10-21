import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, within } from "@testing-library/react";
import type { ServerNotification } from "@brain/shared";
import { type InboxNotification, notificationsKey, writeNotifications } from "./Toasts.js";

/**
 * IM-74/75/76/77 — the merged Inbox: server notifications + the device toast
 * log, deduped; search / grouping / priority filter; absolute + relative
 * timestamps; per-item delete + snooze; honest retention copy and empty
 * states; dock design system (dock-head/<h3>, no "(Dismissed)"); Clear
 * History via the app ConfirmDialog, never native confirm().
 */

const listServerNotifications = vi.fn(async (): Promise<ServerNotification[] | null> => []);
const markServerNotificationSeen = vi.fn(async (_id: number) => ({ ok: true }));
const markAllServerNotificationsSeen = vi.fn(async () => ({ ok: true, marked: 0 }));
const clearSeenServerNotifications = vi.fn(async () => ({ ok: true, cleared: 0 }));
const deleteServerNotification = vi.fn(async (_id: number) => ({ ok: true }));
const snoozeServerNotification = vi.fn(async (_id: number, _until: string) => ({ ok: true }));
vi.mock("../api/notifications.js", () => ({
  SERVER_INBOX_CAP: 500,
  listServerNotifications: () => listServerNotifications(),
  markServerNotificationSeen: (id: number) => markServerNotificationSeen(id),
  markAllServerNotificationsSeen: () => markAllServerNotificationsSeen(),
  clearSeenServerNotifications: () => clearSeenServerNotifications(),
  deleteServerNotification: (id: number) => deleteServerNotification(id),
  snoozeServerNotification: (id: number, until: string) => snoozeServerNotification(id, until),
}));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));

import { InboxPanel, mergeInboxItems } from "./InboxPanel.js";

const SPACE = "s1";

function localNote(over: Partial<InboxNotification>): InboxNotification {
  return {
    id: Math.random().toString(36).slice(2),
    text: "a local note",
    icon: "🛰️",
    timestamp: Date.now(),
    seen: false,
    seenAt: null,
    priority: "normal",
    ...over,
  };
}

function serverNote(over: Partial<ServerNotification>): ServerNotification {
  return {
    id: 1,
    source: "insight",
    text: "a server note",
    icon: "💡",
    priority: "normal",
    dedupeKey: null,
    seen: false,
    seenAt: null,
    snoozedUntil: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("brain.spaceId", SPACE);
  listServerNotifications.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("mergeInboxItems — the local toast echo is deduped against the server store", () => {
  it("drops a local echo of a server event (same text, lands after it)", () => {
    const t = Date.now();
    const server = [serverNote({ id: 7, text: "💸 Heads up — Rent is coming up.", createdAt: new Date(t - 60_000).toISOString() })];
    const local = [localNote({ text: "💸 Heads up — Rent is coming up.", timestamp: t })];
    const merged = mergeInboxItems(local, server);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.origin).toBe("server");
  });

  it("keeps a same-text local note from a different day — it is a different event", () => {
    const t = Date.now();
    const server = [serverNote({ id: 7, text: "digest ready", createdAt: new Date(t - 3 * 24 * 3600 * 1000).toISOString() })];
    const local = [localNote({ text: "digest ready", timestamp: t })];
    expect(mergeInboxItems(local, server)).toHaveLength(2);
  });

  it("sorts the merged list newest-first across both origins", () => {
    const t = Date.now();
    const merged = mergeInboxItems(
      [localNote({ text: "old local", timestamp: t - 5000 })],
      [serverNote({ id: 3, text: "new server", createdAt: new Date(t).toISOString() })],
    );
    expect(merged.map((m) => m.text)).toEqual(["new server", "old local"]);
  });
});

describe("InboxPanel — merged rendering, honest copy, dock chrome (IM-74/76)", () => {
  it("renders server notifications alongside local ones, with the retention policy disclosed", async () => {
    writeNotifications([localNote({ text: "local toast echo" })], SPACE);
    listServerNotifications.mockResolvedValue([serverNote({ id: 5, text: "server insight" })]);
    render(<InboxPanel spaceId={SPACE} />);

    expect(await screen.findByText("server insight")).toBeTruthy();
    expect(await screen.findByText("local toast echo")).toBeTruthy();
    // Retention disclosed: nothing auto-deleted, both caps named.
    const copy = document.body.textContent ?? "";
    expect(copy).toMatch(/stay\s+until you clear them/);
    expect(copy).toContain("100 most recent");
    expect(copy).toContain("500 most recent");
  });

  it("uses dock-head with an <h3>, and 'Seen' — never '(Dismissed)'", async () => {
    writeNotifications([localNote({ text: "already read", seen: true, seenAt: Date.now() })], SPACE);
    render(<InboxPanel spaceId={SPACE} />);
    fireEvent.click(await screen.findByRole("button", { name: /History/ }));
    expect(await screen.findByText("already read")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: /Inbox/ })).toBeTruthy();
    expect(document.querySelector(".dock-head")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Dismissed");
    expect(screen.getByText("Seen")).toBeTruthy();
  });

  it("shows relative AND absolute timestamps", async () => {
    const ts = Date.now() - 2 * 3600 * 1000;
    writeNotifications([localNote({ text: "timed note", timestamp: ts })], SPACE);
    render(<InboxPanel spaceId={SPACE} />);
    expect(await screen.findByText("timed note")).toBeTruthy();
    const abs = new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    expect(document.body.textContent).toContain(`2h ago · ${abs}`);
  });

  it("gives the empty inbox 'what lands here' guidance", async () => {
    render(<InboxPanel spaceId={SPACE} />);
    expect(await screen.findByText(/completely clear/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/bill risk while you're away/);
  });

  it("says the server inbox is unreachable instead of pretending it's empty", async () => {
    listServerNotifications.mockResolvedValue(null);
    render(<InboxPanel spaceId={SPACE} />);
    expect(await screen.findByText(/Couldn't reach the server inbox/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("InboxPanel — search, grouping, priority filter (IM-75)", () => {
  it("search narrows the list; the Important filter keeps only high priority", async () => {
    const t = Date.now();
    writeNotifications(
      [
        localNote({ text: "rent warning", priority: "high", timestamp: t }),
        localNote({ text: "gentle nudge", priority: "normal", timestamp: t - 1000 }),
      ],
      SPACE,
    );
    render(<InboxPanel spaceId={SPACE} />);
    expect(await screen.findByText("rent warning")).toBeTruthy();
    expect(screen.getByText("gentle nudge")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search notifications"), { target: { value: "gentle" } });
    expect(screen.queryByText("rent warning")).toBeNull();
    expect(screen.getByText("gentle nudge")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search notifications"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Priority filter"), { target: { value: "high" } });
    expect(screen.getByText("rent warning")).toBeTruthy();
    expect(screen.queryByText("gentle nudge")).toBeNull();
  });

  it("groups by day by default and by source on request", async () => {
    const t = Date.now();
    writeNotifications([localNote({ text: "today note", timestamp: t })], SPACE);
    listServerNotifications.mockResolvedValue([
      serverNote({ id: 9, text: "old insight", createdAt: new Date(t - 3 * 24 * 3600 * 1000).toISOString() }),
    ]);
    render(<InboxPanel spaceId={SPACE} />);
    fireEvent.click(await screen.findByRole("button", { name: /^All/ }));
    expect(await screen.findByText("old insight")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Group by"), { target: { value: "source" } });
    const heads = [...document.querySelectorAll(".inbox-group-head")].map((h) => h.textContent);
    expect(heads).toContain("💡 Insights");
    expect(heads).toContain("📱 This device");
  });
});

describe("InboxPanel — per-item delete + snooze (IM-75)", () => {
  it("deletes a local item and snoozes a server item out of Unseen (still in All)", async () => {
    writeNotifications([localNote({ id: "loc1", text: "delete me" })], SPACE);
    listServerNotifications.mockResolvedValue([serverNote({ id: 42, text: "snooze me" })]);
    render(<InboxPanel spaceId={SPACE} />);
    expect(await screen.findByText("delete me")).toBeTruthy();
    expect(screen.getByText("snooze me")).toBeTruthy();

    const rowOf = (text: string) => screen.getByText(text).closest(".inbox-row")!;
    await act(async () => {
      fireEvent.click(rowOf("delete me").querySelector('[aria-label="Delete notification"]')!);
    });
    expect(screen.queryByText("delete me")).toBeNull();

    await act(async () => {
      fireEvent.click(rowOf("snooze me").querySelector('[aria-label="Snooze for a day"]')!);
    });
    expect(snoozeServerNotification).toHaveBeenCalledWith(42, expect.any(String));
    // Gone from Unseen…
    expect(screen.queryByText("snooze me")).toBeNull();
    // …but still present under All, tagged as snoozed.
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(await screen.findByText("snooze me")).toBeTruthy();
    expect(document.body.textContent).toMatch(/Snoozed until/);
  });

  it("marks a server item seen through the API", async () => {
    listServerNotifications.mockResolvedValue([serverNote({ id: 11, text: "mark me" })]);
    render(<InboxPanel spaceId={SPACE} />);
    expect(await screen.findByText("mark me")).toBeTruthy();
    const row = screen.getByText("mark me").closest(".inbox-row")!;
    await act(async () => {
      fireEvent.click(row.querySelector('[aria-label="Mark as seen"]')!);
    });
    expect(markServerNotificationSeen).toHaveBeenCalledWith(11);
  });
});

describe("InboxPanel — Clear History uses the app dialog, never native confirm() (IM-77)", () => {
  it("opens ConfirmDialog and clears only on confirm; window.confirm is never called", async () => {
    // jsdom defines no window.confirm here — install a spy directly. If the
    // panel ever called the native dialog, this records it.
    const confirmSpy = vi.fn(() => true);
    (window as { confirm?: unknown }).confirm = confirmSpy;
    writeNotifications(
      [localNote({ text: "seen one", seen: true, seenAt: Date.now() }), localNote({ text: "unseen one" })],
      SPACE,
    );
    render(<InboxPanel spaceId={SPACE} />);
    fireEvent.click(await screen.findByRole("button", { name: /History/ }));
    expect(await screen.findByText("seen one")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear History" }));
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/Clear 1 seen notification/);

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Clear History" }));
    });
    expect(screen.queryByText("seen one")).toBeNull();
    const stored = JSON.parse(localStorage.getItem(notificationsKey(SPACE)) ?? "[]") as InboxNotification[];
    expect(stored.map((n) => n.text)).toEqual(["unseen one"]);
    expect(confirmSpy).not.toHaveBeenCalled();
    delete (window as { confirm?: unknown }).confirm;
  });
});
