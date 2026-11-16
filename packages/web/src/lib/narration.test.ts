import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../voice.js", () => ({ speak: vi.fn((_t: string, _tone: unknown, o: { onEnd?: () => void }) => o.onEnd?.()), stopSpeaking: vi.fn(), isVoiceSupported: () => true }));
vi.mock("../api/http.js", () => ({ API: "/api", afetch: vi.fn() }));

import { speak } from "../voice.js";
import { afetch } from "../api/http.js";
import { getNarrationMode, playNarration, setNarrationMode, stopNarration } from "./narration.js";
import { NARRATION_EVENT, NARRATION_DUCK, onNarration } from "./narrationBus.js";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  stopNarration();
});

describe("reading the lore aloud", () => {
  it("defaults to 'when I ask', remembers a choice, and 'never' reads nothing", async () => {
    expect(getNarrationMode()).toBe("ask");
    setNarrationMode("off");
    expect(getNarrationMode()).toBe("off");
    expect(await playNarration({ entryId: "obj.kiths-drawing", register: "plain", text: "x" })).toBe("none");
    expect(afetch).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("asks the server for the entry (never sends the words), and falls back to the browser voice when there is no clip", async () => {
    (afetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(null, { status: 204 }));
    const events: boolean[] = [];
    const off = onNarration((p) => events.push(p));
    const how = await playNarration({ entryId: "obj.kiths-drawing", register: "grave", tide: "weight", text: "The words." });
    off();
    expect(how).toBe("voice");
    const url = (afetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toMatch(/^\/api\/story\/narration\/obj\.kiths-drawing\?register=grave&tide=weight&t=[0-9a-z]+$/);
    expect(url).not.toContain("words"); // a hash of the words, never the words
    expect(speak).toHaveBeenCalledWith("The words.", undefined, expect.any(Object));
    expect(events).toEqual([true, false]); // the bed ducks while it reads, and comes back
  });

  it("falls back to the browser voice when the request fails outright — and says the voice could not be reached, not that there is no clip", async () => {
    (afetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    const why: string[] = [];
    expect(await playNarration({ entryId: "obj.kiths-drawing", register: "plain", text: "Offline words.", onFallback: (w) => why.push(w) })).toBe("voice");
    expect(speak).toHaveBeenCalled();
    expect(why).toEqual(["the studio voice could not be reached just now"]);
  });

  it("says 'you have not found that yet' on a 403, and 'no studio clip' on a 204 — never the other way round", async () => {
    const afetchMock = afetch as ReturnType<typeof vi.fn>;
    afetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    const why403: string[] = [];
    expect(await playNarration({ entryId: "sight.secret", register: "plain", text: "Secret words.", onFallback: (w) => why403.push(w) })).toBe("voice");
    expect(why403).toEqual(["you have not found that yet, so the studio voice will not read it"]);

    afetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const why204: string[] = [];
    expect(await playNarration({ entryId: "obj.kiths-drawing", register: "plain", text: "The words.", onFallback: (w) => why204.push(w) })).toBe("voice");
    expect(why204).toEqual(["the server has no studio clip for this line"]);
  });
});

describe("the ambient bed steps back while it reads", () => {
  it("uses one event and a fifth of the level", () => {
    expect(NARRATION_EVENT).toBe("story:narration");
    expect(NARRATION_DUCK).toBeGreaterThan(0);
    expect(NARRATION_DUCK).toBeLessThan(0.5);
  });
});
