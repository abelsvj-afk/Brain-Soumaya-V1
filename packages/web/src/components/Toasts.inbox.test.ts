import { describe, it, expect, beforeEach } from "vitest";
import {
  type InboxNotification,
  notificationsKey,
  readNotifications,
  writeNotifications,
  cleanupNotifications,
  INBOX_CAP,
} from "./Toasts.js";

const SPACE = "s1";

function note(over: Partial<InboxNotification>): InboxNotification {
  return {
    id: Math.random().toString(36).slice(2),
    text: "a note",
    icon: "🛰️",
    timestamp: Date.now(),
    seen: false,
    seenAt: null,
    priority: "normal",
    ...over,
  };
}

beforeEach(() => localStorage.clear());

describe("inbox storage helpers", () => {
  it("uses one key definition, and falls back to the canonical brain.spaceId", () => {
    expect(notificationsKey(SPACE)).toBe(`brain.notifications.${SPACE}`);
    localStorage.setItem("brain.spaceId", "canonical");
    expect(notificationsKey()).toBe("brain.notifications.canonical");
    localStorage.removeItem("brain.spaceId");
    expect(notificationsKey()).toBe("brain.notifications.default");
  });

  it("reads back an empty list for a missing or corrupt bucket instead of throwing", () => {
    expect(readNotifications(SPACE)).toEqual([]);
    localStorage.setItem(notificationsKey(SPACE), "{not json");
    expect(readNotifications(SPACE)).toEqual([]);
    localStorage.setItem(notificationsKey(SPACE), '{"a":1}'); // valid JSON, wrong shape
    expect(readNotifications(SPACE)).toEqual([]);
  });

  it("caps the stored log at INBOX_CAP, keeping the newest", () => {
    const many = Array.from({ length: INBOX_CAP + 20 }, (_, i) => note({ text: `n${i}` }));
    writeNotifications(many, SPACE);
    const back = readNotifications(SPACE);
    expect(back).toHaveLength(INBOX_CAP);
    expect(back[back.length - 1]!.text).toBe(`n${INBOX_CAP + 19}`);
  });
});

describe("cleanupNotifications — IM-73 honest retention", () => {
  it("never deletes by age: seen items persist, unseen items persist", () => {
    const longAgo = Date.now() - 30 * 24 * 3600 * 1000; // 30 days
    writeNotifications(
      [
        note({ text: "seen-long-ago", seen: true, seenAt: longAgo, timestamp: longAgo }),
        note({ text: "unseen-long-ago", timestamp: longAgo }),
        note({ text: "important-old", timestamp: longAgo, priority: "high" }),
      ],
      SPACE,
    );
    cleanupNotifications(SPACE);
    const texts = readNotifications(SPACE).map((n) => n.text);
    expect(texts).toEqual(["seen-long-ago", "unseen-long-ago", "important-old"]);
  });

  it("trims only an over-cap log (keeping the newest) and announces the trim", () => {
    // Seed storage directly, bypassing writeNotifications' own cap enforcement.
    const many = Array.from({ length: INBOX_CAP + 20 }, (_, i) => note({ text: `n${i}` }));
    localStorage.setItem(notificationsKey(SPACE), JSON.stringify(many));

    let fired = 0;
    const onUpdate = () => { fired++; };
    window.addEventListener("brain-notifications-updated", onUpdate);
    try {
      cleanupNotifications(SPACE);
      expect(fired).toBe(1);
      const back = readNotifications(SPACE);
      expect(back).toHaveLength(INBOX_CAP);
      expect(back[back.length - 1]!.text).toBe(`n${INBOX_CAP + 19}`);

      // A within-cap cleanup is a no-op and must NOT announce (that would loop
      // readers pointlessly).
      fired = 0;
      cleanupNotifications(SPACE);
      expect(fired).toBe(0);
    } finally {
      window.removeEventListener("brain-notifications-updated", onUpdate);
    }
  });

  it("REGRESSION: a stale in-memory snapshot must not resurrect trimmed rows", () => {
    // The panel's mutations re-read storage instead of trusting state: a stale
    // snapshot written back wholesale would resurrect rows cleanup trimmed.
    const many = Array.from({ length: INBOX_CAP + 5 }, (_, i) => note({ text: `n${i}` }));
    localStorage.setItem(notificationsKey(SPACE), JSON.stringify(many));
    const staleSnapshot = readNotifications(SPACE); // what a mounted panel would hold
    expect(staleSnapshot).toHaveLength(INBOX_CAP + 5);

    cleanupNotifications(SPACE);
    expect(readNotifications(SPACE)).toHaveLength(INBOX_CAP);

    // mutate() re-reads rather than writing `staleSnapshot` back.
    const fresh = readNotifications(SPACE).map((n) => ({ ...n, seen: true, seenAt: Date.now() }));
    writeNotifications(fresh, SPACE);

    const finalTexts = readNotifications(SPACE).map((n) => n.text);
    expect(finalTexts).toHaveLength(INBOX_CAP);
    expect(finalTexts).not.toContain("n0"); // trimmed rows stay trimmed
  });
});
