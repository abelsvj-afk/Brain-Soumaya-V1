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
    expect(url).toBe("/api/story/narration/obj.kiths-drawing?register=grave&tide=weight");
    expect(url).not.toContain("words");
    expect(speak).toHaveBeenCalledWith("The words.", undefined, expect.any(Object));
    expect(events).toEqual([true, false]); // the bed ducks while it reads, and comes back
  });

  it("falls back to the browser voice when the request fails outright", async () => {
    (afetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    expect(await playNarration({ entryId: "obj.kiths-drawing", register: "plain", text: "Offline words." })).toBe("voice");
    expect(speak).toHaveBeenCalled();
  });
});

describe("the ambient bed steps back while it reads", () => {
  it("uses one event and a fifth of the level", () => {
    expect(NARRATION_EVENT).toBe("story:narration");
    expect(NARRATION_DUCK).toBeGreaterThan(0);
    expect(NARRATION_DUCK).toBeLessThan(0.5);
  });
});
