import { describe, it, expect } from "vitest";
import { CODEX_STATIC_KEYS } from "@brain/shared";
import { buildCodex, fieldNoteEntries } from "./codex.js";

/**
 * IM-93 sync guard: the client's Codex catalog and the server's reward
 * allow-list are the SAME set because both come from @brain/shared
 * (CODEX_STATIC_KEYS). This test fails the moment either side gains or loses
 * an entry the other doesn't have — the drift that silently cost mind-*,
 * five phenomena, and every field note their fuel can never recur.
 */
describe("Codex catalog ↔ server allow-list sync (IM-93)", () => {
  it("the client's static entry ids are exactly the shared rewardable set", () => {
    const entries = buildCodex({ memories: [], constellations: [], links: 0 });
    // `constellation-none` is the undiscovered placeholder (never claimed);
    // real constellation entries are dynamic (`constellation-<hubId>`) and are
    // verified server-side against the space's MOC hubs, not the static set.
    const ids = entries.map((e) => e.id).filter((id) => id !== "constellation-none");
    expect(ids.length).toBe(new Set(ids).size); // no duplicate ids
    expect(new Set(ids)).toEqual(CODEX_STATIC_KEYS);
  });

  it("field notes produce fieldnote-* ids from the server-charted key", () => {
    const [entry] = fieldNoteEntries([
      { key: "sector:daily:25", title: "A Sector Comes of Age", lore: "…", icon: "✦", focusId: null, createdAt: "2026-05-01T00:00:00.000Z" },
    ]);
    expect(entry?.id).toBe("fieldnote-sector:daily:25");
  });
});
