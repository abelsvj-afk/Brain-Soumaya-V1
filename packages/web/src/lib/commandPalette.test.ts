import { describe, it, expect } from "vitest";
import { PALETTE_COMMANDS, filterPaletteCommands } from "./commandPalette.js";

describe("PALETTE_COMMANDS — IM-142", () => {
  it("has unique ids", () => {
    const ids = PALETTE_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers capture, chat, search and the Observatory as actions", () => {
    const ids = PALETTE_COMMANDS.map((c) => c.id);
    expect(ids).toContain("capture");
    expect(ids).toContain("chat");
    expect(ids).toContain("search");
    expect(ids).toContain("observatory");
  });

  it("offers a jump command for every dock tab", () => {
    const ids = PALETTE_COMMANDS.map((c) => c.id);
    for (const tab of ["details", "list", "mind", "actions", "insights", "soumaya", "inbox", "awards", "journeys", "money", "hangar"]) {
      expect(ids).toContain(`tab:${tab}`);
    }
  });

  it("every command has an icon, a title and keywords", () => {
    for (const c of PALETTE_COMMANDS) {
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("filterPaletteCommands", () => {
  it("returns everything for an empty query", () => {
    expect(filterPaletteCommands("")).toEqual(PALETTE_COMMANDS);
    expect(filterPaletteCommands("   ")).toEqual(PALETTE_COMMANDS);
  });

  it("matches on title and on keywords, case-insensitively", () => {
    expect(filterPaletteCommands("MONEY").map((c) => c.id)).toContain("tab:money");
    expect(filterPaletteCommands("dump").map((c) => c.id)).toContain("capture");
  });

  it("requires every query token to match", () => {
    expect(filterPaletteCommands("open money").map((c) => c.id)).toEqual(["tab:money"]);
    expect(filterPaletteCommands("zzz-nope")).toEqual([]);
  });
});
