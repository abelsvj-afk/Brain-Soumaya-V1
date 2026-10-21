import { describe, it, expect } from "vitest";
import {
  composeSharedText,
  parseShareLanding,
  isPaletteShortcut,
  isCaptureShortcut,
  isTextEntryTarget,
} from "./quickCapture.js";

describe("parseShareLanding — IM-141 share-target route", () => {
  it("detects the /share path the manifest share_target points at", () => {
    expect(parseShareLanding("/share", "?title=Hello&text=World")).toEqual({ text: "Hello\nWorld" });
  });

  it("detects share params even on the root path (some browsers drop the path)", () => {
    expect(parseShareLanding("/", "?text=just+text")).toEqual({ text: "just text" });
  });

  it("treats the manifest shortcut launch (/share?capture=1) as an empty capture landing", () => {
    expect(parseShareLanding("/share", "?capture=1")).toEqual({ text: "" });
  });

  it("ignores ordinary app URLs (lite mode, boot-reset, plain load)", () => {
    expect(parseShareLanding("/", "")).toBeNull();
    expect(parseShareLanding("/", "?lite=1")).toBeNull();
    expect(parseShareLanding("/", "?fresh=123456")).toBeNull();
  });
});

describe("composeSharedText", () => {
  it("joins title, text and url on separate lines", () => {
    const p = new URLSearchParams({ title: "T", text: "body", url: "https://x.test/a" });
    expect(composeSharedText(p)).toBe("T\nbody\nhttps://x.test/a");
  });

  it("does not duplicate the url when the share text already contains it (typical Android share)", () => {
    const p = new URLSearchParams({ text: "look https://x.test/a", url: "https://x.test/a" });
    expect(composeSharedText(p)).toBe("look https://x.test/a");
  });

  it("does not duplicate the title when it equals the text", () => {
    const p = new URLSearchParams({ title: "same", text: "same" });
    expect(composeSharedText(p)).toBe("same");
  });

  it("is empty when nothing was shared", () => {
    expect(composeSharedText(new URLSearchParams())).toBe("");
  });
});

const key = (partial: Partial<KeyboardEvent>): Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"> => ({
  key: "k",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...partial,
});

describe("global shortcut predicates — IM-141/IM-142", () => {
  it("⌘K and Ctrl+K open the palette; plain K does not", () => {
    expect(isPaletteShortcut(key({ metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(key({}))).toBe(false);
    expect(isPaletteShortcut(key({ metaKey: true, key: "j" }))).toBe(false);
  });

  it("bare C (no modifiers) is the capture shortcut; modified C is not", () => {
    expect(isCaptureShortcut(key({ key: "c" }))).toBe(true);
    expect(isCaptureShortcut(key({ key: "C" }))).toBe(false); // Shift+C types a capital — not bare
    expect(isCaptureShortcut(key({ key: "c", ctrlKey: true }))).toBe(false); // Ctrl+C = copy
    expect(isCaptureShortcut(key({ key: "c", metaKey: true }))).toBe(false);
  });

  it("text-entry targets are recognised so typing never triggers capture", () => {
    const input = document.createElement("input");
    const area = document.createElement("textarea");
    const div = document.createElement("div");
    expect(isTextEntryTarget(input)).toBe(true);
    expect(isTextEntryTarget(area)).toBe(true);
    expect(isTextEntryTarget(div)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
