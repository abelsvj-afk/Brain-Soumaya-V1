import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";

const askChat = vi.fn();
const getSpaceId = vi.fn(() => "space1");
const ingestText = vi.fn();
const distillChat = vi.fn();
vi.mock("../api/client.js", () => ({
  askChat: (...a: unknown[]) => askChat(...a),
  getSpaceId: () => getSpaceId(),
  ingestText: (...a: unknown[]) => ingestText(...a),
  distillChat: (...a: unknown[]) => distillChat(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("../voice.js", () => ({
  isVoiceSupported: () => false,
  isVoiceEnabled: () => false,
  setVoiceEnabled: () => {},
  speak: () => {},
  stopSpeaking: () => {},
}));
const extractFileText = vi.fn();
vi.mock("../lib/extractFileText.js", () => ({
  extractFileText: (...a: unknown[]) => extractFileText(...a),
}));

import { ChatDock } from "./ChatDock.js";

const CHAT_KEY = "brain.chat.space1";

beforeEach(() => {
  vi.resetAllMocks();
  getSpaceId.mockReturnValue("space1");
  localStorage.clear();
});
afterEach(() => cleanup());

async function sendMessage(text: string) {
  const box = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(askChat).toHaveBeenCalled());
}

describe("ChatDock Round 2 — IM-104: replies render as Markdown", () => {
  it("renders bold/list markup as real elements, not literal ** characters", async () => {
    askChat.mockResolvedValue({
      answer: "Here is **the plan**:\n- first step\n- second step",
      citations: [],
      contextIds: [],
    });
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("what's the plan?");
    const strong = await waitFor(() => container.querySelector(".chatdock-bubble strong"));
    expect(strong?.textContent).toBe("the plan");
    const bubble = strong!.closest(".chatdock-bubble")!;
    expect(bubble.textContent).not.toContain("**");
    expect(bubble.textContent).toContain("first step");
  });
});

describe("ChatDock Round 2 — IM-105: message timestamps", () => {
  it("renders the local time for a message sent today, and a date for an older one", async () => {
    const todayAt = new Date();
    todayAt.setHours(9, 41, 0, 0);
    const oldAt = new Date("2026-01-15T20:05:00");
    localStorage.setItem(
      CHAT_KEY,
      JSON.stringify([
        { role: "you", text: "morning note", at: todayAt.getTime() },
        { role: "soumaya", text: "an old reply", at: oldAt.getTime() },
      ]),
    );
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await screen.findByText("morning note");
    const times = [...container.querySelectorAll("time.chatdock-time")];
    expect(times).toHaveLength(2);
    expect(times[0]!.textContent).toBe(todayAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    expect(times[1]!.textContent).toContain("Jan 15");
    expect(times[1]!.textContent).toContain(oldAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  });

  it("messages persisted before timestamps existed render without an invented time", async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify([{ role: "you", text: "legacy line" }]));
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await screen.findByText("legacy line");
    expect(container.querySelectorAll("time.chatdock-time")).toHaveLength(0);
  });
});

describe("ChatDock Round 2 — IM-108: errors live outside her voice, with retry", () => {
  it("a failed send shows an alert bar (not a Soumaya bubble) and Retry re-sends the same turn", async () => {
    askChat.mockRejectedValueOnce(new Error("Chat failed (500)"));
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("are you there?");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't reach Soumaya");
    // The raw error never appears inside one of her bubbles.
    for (const b of container.querySelectorAll(".chatdock-bubble")) {
      expect(b.textContent).not.toContain("Chat failed (500)");
    }

    askChat.mockResolvedValue({ answer: "I'm here.", citations: [], contextIds: [] });
    act(() => screen.getByText("Retry").click());
    await waitFor(() => expect(askChat).toHaveBeenCalledTimes(2));
    // Retry re-sends the SAME question without duplicating the user's bubble.
    expect(askChat.mock.calls[1]![0]).toBe("are you there?");
    await screen.findByText("I'm here.");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.querySelectorAll(".chatdock-msg.you")).toHaveLength(1);
  });

  it("an empty answer renders human copy, never the literal '(no answer)'", async () => {
    askChat.mockResolvedValue({ answer: "", citations: [], contextIds: [] });
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("say nothing");
    const bubble = await screen.findByText(/I don't have an answer for that one yet/);
    expect(bubble).toBeTruthy();
    expect(document.body.textContent).not.toContain("(no answer)");
  });
});

describe("ChatDock Round 2 — IM-103: staged presence, elapsed cue, working cancel", () => {
  it("shows a stage label + Stop while waiting; Stop aborts the request and offers Retry", async () => {
    let seenSignal: AbortSignal | undefined;
    askChat.mockImplementation((...a: unknown[]) => {
      seenSignal = a[5] as AbortSignal;
      return new Promise((_resolve, reject) => {
        seenSignal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted", "AbortError")),
        );
      });
    });
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("think hard about this");

    // Presence: staged label + animated presence, not a bare static bubble.
    expect(await screen.findByText("Reading your galaxy…")).toBeTruthy();
    const stop = screen.getByTitle("Stop this reply");
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal!.aborted).toBe(false);

    act(() => stop.click());
    expect(seenSignal!.aborted).toBe(true);
    // The stop is reported out-of-voice with a way back, and the busy bubble clears.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Stopped");
    expect(screen.queryByText("Reading your galaxy…")).toBeNull();
  });

  it("the elapsed cue appears once the wait passes a second", async () => {
    askChat.mockImplementation(() => new Promise(() => {}));
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("slow question");
    await screen.findByText("Reading your galaxy…");
    await waitFor(() => expect(screen.getByText("1s")).toBeTruthy(), { timeout: 4000 });
  });
});

describe("ChatDock Round 2 — IM-107: contextIds light up the consulted subgraph", () => {
  it("fires onRecall with the full contextIds (not just citations) and offers a re-light chip", async () => {
    askChat.mockResolvedValue({
      answer: "Based on your notes…",
      citations: [{ id: 7, label: "Coffee budget", type: "daily" }],
      contextIds: [7, 8, 9],
    });
    const onRecall = vi.fn();
    render(<ChatDock onClose={() => {}} onFocus={() => {}} onRecall={onRecall} />);
    await sendMessage("what did I decide?");
    await screen.findByText("Based on your notes…");
    await waitFor(() => expect(onRecall).toHaveBeenCalledWith([7, 8, 9]));

    const chip = await screen.findByText(/drew on 3 memories/);
    onRecall.mockClear();
    act(() => chip.click());
    expect(onRecall).toHaveBeenCalledWith([7, 8, 9]);
  });
});

describe("ChatDock Round 2 — IM-106: in-chat attachments", () => {
  it("extracts a picked file, stages it as a chip, and sends its text as askChat's attachments arg", async () => {
    extractFileText.mockResolvedValue({ text: "the attached body text", name: "notes" });
    askChat.mockResolvedValue({ answer: "Read it.", citations: [], contextIds: [] });
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const file = new File(["ignored"], "notes.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });
    // Staged chip appears before sending.
    expect(await screen.findByText(/notes\.txt/)).toBeTruthy();

    await sendMessage("summarize the attached");
    expect(askChat).toHaveBeenCalledWith(
      "summarize the attached",
      expect.anything(),
      undefined,
      undefined,
      [{ name: "notes.txt", text: "the attached body text" }],
      expect.any(AbortSignal),
    );
    // The sent user message keeps the attachment's name; the staged chip clears.
    await screen.findByText("Read it.");
    const userMsg = container.querySelector(".chatdock-msg.you")!;
    expect(userMsg.textContent).toContain("notes.txt");
    expect(container.querySelector(".chatdock-pending-att")).toBeNull();
  });

  it("a file that can't be read toasts instead of staging a phantom attachment", async () => {
    extractFileText.mockRejectedValue(new Error("That file appears to be empty."));
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [new File([""], "empty.txt")] } });
    });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith("That file appears to be empty.", "⚠️", expect.any(Number)),
    );
    expect(container.querySelector(".chatdock-pending-att")).toBeNull();
  });
});
