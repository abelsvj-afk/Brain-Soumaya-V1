import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { InboxNotification } from "./Toasts.js";

const cleanupNotifications = vi.fn();
const readNotifications = vi.fn();
const writeNotifications = vi.fn();
vi.mock("./Toasts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Toasts.js")>();
  return {
    ...actual,
    cleanupNotifications: (...a: unknown[]) => cleanupNotifications(...a),
    readNotifications: (...a: unknown[]) => readNotifications(...a),
    writeNotifications: (...a: unknown[]) => writeNotifications(...a),
  };
});
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));
// IM-74: the panel also reads the server inbox — empty + healthy by default here.
vi.mock("../api/notifications.js", () => ({
  SERVER_INBOX_CAP: 500,
  listServerNotifications: vi.fn(async () => []),
  markServerNotificationSeen: vi.fn(async () => ({ ok: true })),
  markAllServerNotificationsSeen: vi.fn(async () => ({ ok: true, marked: 0 })),
  clearSeenServerNotifications: vi.fn(async () => ({ ok: true, cleared: 0 })),
  deleteServerNotification: vi.fn(async () => ({ ok: true })),
  snoozeServerNotification: vi.fn(async () => ({ ok: true })),
}));

import { InboxPanel } from "./InboxPanel.js";

function note(over: Partial<InboxNotification>): InboxNotification {
  return { id: "1", text: "a note", icon: "🛰️", timestamp: Date.now(), seen: false, seenAt: null, priority: "normal", ...over };
}

beforeEach(() => {
  vi.resetAllMocks();
  cleanupNotifications.mockImplementation(() => {});
});

afterEach(() => cleanup());

describe("InboxPanel — reaching inbox-zero is celebrated, not silently mounted into", () => {
  it("does not play a sound just from mounting on an already-empty inbox", async () => {
    readNotifications.mockReturnValue([]);
    render(<InboxPanel spaceId="s1" />);
    await screen.findByText(/completely clear/);
    expect(playSfx).not.toHaveBeenCalled();
  });

  it("plays a chime the moment the last unseen item is marked read", async () => {
    const single = [note({ id: "1", text: "Only one" })];
    readNotifications.mockReturnValue(single);
    writeNotifications.mockImplementation((list: InboxNotification[]) => {
      readNotifications.mockReturnValue(list);
    });
    render(<InboxPanel spaceId="s1" />);
    await screen.findByText("Only one");

    const markAllBtn = screen.getByText("Mark All Read");
    await act(async () => { markAllBtn.click(); });

    expect(playSfx).toHaveBeenCalledWith("chime");
  });
});

describe("InboxPanel — a notification with an action is clickable, not permanently inert", () => {
  it("dispatches brain-toast-action with the notification's action on click", async () => {
    readNotifications.mockReturnValue([
      note({ id: "1", text: "Reminder due", action: { kind: "focus", value: 42 } }),
    ]);
    render(<InboxPanel spaceId="s1" />);
    const row = await screen.findByText("Reminder due");

    let received: unknown = null;
    const onAction = (e: Event) => { received = (e as CustomEvent).detail; };
    window.addEventListener("brain-toast-action", onAction);
    try {
      await act(async () => { row.closest('[role="button"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    } finally {
      window.removeEventListener("brain-toast-action", onAction);
    }
    expect(received).toEqual({ kind: "focus", value: 42 });
  });

  it("does not make an action-less notification clickable", async () => {
    readNotifications.mockReturnValue([note({ id: "1", text: "Just info" })]);
    render(<InboxPanel spaceId="s1" />);
    const row = await screen.findByText("Just info");
    expect(row.closest('[role="button"]')).toBeNull();
  });
});
