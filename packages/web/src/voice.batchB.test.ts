import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Batch B / CH-09 — voice readback must not speak raw Markdown. speak() is
 * the single speech entry (only caller: ChatDock's performSend), so the
 * strip lives centrally in voice.ts and is proven both as a pure function
 * and through speak() itself with a stubbed synthesis engine.
 */

import { stripMarkdownForSpeech, speak } from "./voice.js";

describe("CH-09 — stripMarkdownForSpeech", () => {
  it("strips bold/italic/strike markers, keeping the words", () => {
    expect(stripMarkdownForSpeech("This is **very** important and *really* _true_ ~~not false~~.")).toBe(
      "This is very important and really true not false.",
    );
  });

  it("unwraps inline code and code fences", () => {
    expect(stripMarkdownForSpeech("Run `npm test` now.")).toBe("Run npm test now.");
    expect(stripMarkdownForSpeech("```\nconst x = 1;\n```").trim()).toBe("const x = 1;");
  });

  it("drops heading hashes and blockquote markers", () => {
    expect(stripMarkdownForSpeech("## Your week\n> worth noting")).toBe("Your week\nworth noting");
  });

  it("turns links and images into their text", () => {
    expect(stripMarkdownForSpeech("See [your plan](https://x.test/p) and ![chart](https://x.test/i.png).")).toBe(
      "See your plan and chart.",
    );
  });

  it("strips list bullets and numbered markers at line starts", () => {
    expect(stripMarkdownForSpeech("- first\n* second\n+ third\n1. fourth\n2) fifth")).toBe(
      "first\nsecond\nthird\nfourth\nfifth",
    );
  });

  it("leaves plain prose untouched", () => {
    expect(stripMarkdownForSpeech("A calm, ordinary sentence.")).toBe("A calm, ordinary sentence.");
  });
});

describe("CH-09 — speak() hands stripped text to the synthesis engine", () => {
  const spoken: string[] = [];
  class FakeUtterance {
    text: string;
    voice: unknown = null;
    lang = "";
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart: unknown = null;
    onend: unknown = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  beforeEach(() => {
    spoken.length = 0;
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [],
        cancel: () => {},
        speak: (u: FakeUtterance) => { spoken.push(u.text); },
        onvoiceschanged: null,
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // @ts-expect-error cleanup of the stubbed engine
    delete window.speechSynthesis;
  });

  it("the engine never receives markdown markers", () => {
    speak("**Bold** claim with a [link](https://x.test) inside.");
    expect(spoken.length).toBeGreaterThan(0);
    const heard = spoken.join(" ");
    expect(heard).toContain("Bold claim with a link inside.");
    expect(heard).not.toContain("**");
    expect(heard).not.toContain("](");
  });
});
