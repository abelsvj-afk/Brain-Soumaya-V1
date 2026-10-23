import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";

/**
 * Batch B — ChatDock items:
 *  CH-01 outbound chips dismiss the chat so the result is visible;
 *  CH-03 close → fast-reopen (BEFORE the send resolves) must not lose the reply;
 *  CH-05 mic permission denial speaks up;
 *  CH-11 empty-state copy is truthful for a zero-memory brain.
 */

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
const NAV = {
  target: { domain: "journey" as const, kind: "journey", id: 42, label: "Owner-operator transition" },
  reason: "Active journey — 40% along, 2 linked items",
};

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

describe("CH-01 — outbound doors dismiss the chat card", () => {
  function seedRichReply() {
    localStorage.setItem(
      CHAT_KEY,
      JSON.stringify([
        {
          role: "soumaya",
          text: "Here's what I found.",
          citations: [{ id: 7, label: "A real memory", type: "daily" }],
          contextIds: [7, 8],
          navigation: NAV,
        },
      ]),
    );
  }

  it("citation chip: flies AND closes the chat", async () => {
    seedRichReply();
    const onClose = vi.fn();
    const onFocus = vi.fn();
    render(<ChatDock onClose={onClose} onFocus={onFocus} />);
    const chip = await screen.findByText("A real memory");
    act(() => chip.click());
    expect(onFocus).toHaveBeenCalledWith(7);
    expect(onClose).toHaveBeenCalled();
  });

  it("'drew on N' chip: recalls AND closes the chat", async () => {
    seedRichReply();
    const onClose = vi.fn();
    const onRecall = vi.fn();
    render(<ChatDock onClose={onClose} onFocus={() => {}} onRecall={onRecall} />);
    const chip = await screen.findByText(/drew on 2 memories/);
    act(() => chip.click());
    expect(onRecall).toHaveBeenCalledWith([7, 8]);
    expect(onClose).toHaveBeenCalled();
  });

  it("navigation chip: navigates AND closes the chat", async () => {
    seedRichReply();
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(<ChatDock onClose={onClose} onFocus={() => {}} onNavigate={onNavigate} />);
    const chip = await screen.findByTitle(NAV.reason);
    act(() => chip.click());
    expect(onNavigate).toHaveBeenCalledWith(NAV);
    expect(onClose).toHaveBeenCalled();
  });

  it("quick-tool chip: dispatches the panel action AND closes the chat", async () => {
    const onClose = vi.fn();
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener("brain-toast-action", listener);
    try {
      render(<ChatDock onClose={onClose} onFocus={() => {}} />);
      const chip = await screen.findByTitle("Open Mind");
      act(() => chip.click());
      expect(seen).toEqual([{ kind: "tab", value: "mind" }]);
      expect(onClose).toHaveBeenCalled();
    } finally {
      window.removeEventListener("brain-toast-action", listener);
    }
  });
});

describe("CH-03 — reopen BEFORE the in-flight send resolves", () => {
  it("the reply lands exactly once in the reopened chat and survives its next persist", async () => {
    let resolveAsk: (v: unknown) => void = () => {};
    askChat.mockImplementation(() => new Promise((res) => { resolveAsk = res; }));
    const first = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("think hard");
    first.unmount();
    // Reopen BEFORE the old send resolves — the interleaving CH-03 traces.
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    expect(screen.queryByText("Finished while you were away.")).toBeNull();
    await act(async () => {
      resolveAsk({ answer: "Finished while you were away.", citations: [], contextIds: [] });
    });
    // The reopened instance picks the parked reply up and shows it.
    expect(await screen.findByText("Finished while you were away.")).toBeTruthy();
    // And it is durable: unmount + remount shows it exactly once (the new
    // instance's persist must not have overwritten it away, nor duplicated it).
    cleanup();
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const copies = await screen.findAllByText("Finished while you were away.");
    expect(copies).toHaveLength(1);
    const stored = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]") as { text: string }[];
    expect(stored.filter((m) => m.text === "Finished while you were away.")).toHaveLength(1);
  });

  it("a failure landing after a fast reopen surfaces as a notice in the reopened chat", async () => {
    let rejectAsk: (e: unknown) => void = () => {};
    askChat.mockImplementation(() => new Promise((_res, rej) => { rejectAsk = rej; }));
    const first = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("think hard");
    first.unmount();
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await act(async () => {
      rejectAsk(new Error("socket exploded in a weird internal way"));
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't reach Soumaya");
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});

describe("CH-05 — mic permission denial is not a dead button", () => {
  class FakeRecognition {
    static instances: FakeRecognition[] = [];
    lang = "";
    interimResults = false;
    continuous = false;
    onresult: unknown = null;
    onerror: ((e: { error: string }) => void) | null = null;
    onend: unknown = null;
    constructor() {
      FakeRecognition.instances.push(this);
    }
    start() {}
    stop() {}
  }

  it("a not-allowed error toasts the remedy in plain language", async () => {
    FakeRecognition.instances = [];
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
    try {
      render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
      const mic = screen.getByLabelText("Microphone");
      act(() => mic.click());
      const rec = FakeRecognition.instances[0]!;
      expect(rec.lang).toBe("en-US"); // locale untouched (scope guard)
      await act(async () => { rec.onerror?.({ error: "not-allowed" }); });
      expect(pushToast).toHaveBeenCalledWith(
        expect.stringMatching(/mic blocked.*allow microphone access/i),
        expect.any(String),
        expect.any(Number),
      );
    } finally {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    }
  });
});

describe("CH-11 — empty-state copy matches the brain's actual state", () => {
  it("a zero-memory brain is NOT told she 'has read your whole galaxy'", () => {
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} hasMemories={false} />);
    const empty = container.querySelector(".chatdock-empty");
    expect(empty).toBeTruthy();
    expect(empty!.textContent).not.toContain("has read your whole galaxy");
    expect(empty!.textContent).toMatch(/still empty|nothing.*yet|first/i);
  });

  it("an established brain keeps the existing line", () => {
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} hasMemories />);
    expect(container.querySelector(".chatdock-empty")!.textContent).toContain("has read your whole galaxy");
  });

  it("the copy uses the brain's dynamic name, never a hardcoded one", () => {
    const { container } = render(
      <ChatDock spaceName="Zephyr" onClose={() => {}} onFocus={() => {}} hasMemories={false} />,
    );
    const empty = container.querySelector(".chatdock-empty")!;
    expect(empty.textContent).toContain("Zephyr");
    expect(empty.textContent).not.toContain("Soumaya");
  });
});
