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

import { ChatDock } from "./ChatDock.js";

const CHAT_KEY = "brain.chat.space1";

beforeEach(() => {
  vi.resetAllMocks();
  getSpaceId.mockReturnValue("space1");
  localStorage.clear();
});

afterEach(() => cleanup());

describe("ChatDock — the quick-tools discovery row is reachable after the first message", () => {
  it("reveals the tools chips via the header toggle once a conversation exists", async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify([{ role: "you", text: "hi" }]));
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await screen.findByText("hi");
    // Vanished after the first message before this fix — no way back to it.
    expect(screen.queryByTitle("Open Mind")).toBeNull();

    const toggle = screen.getByTitle("Explore Soumaya's other tools");
    act(() => toggle.click());
    expect(screen.getByTitle("Open Mind")).toBeTruthy();

    act(() => toggle.click());
    expect(screen.queryByTitle("Open Mind")).toBeNull();
  });
});

describe("ChatDock — mood is never colour-alone", () => {
  it("pairs a mood-colored bubble with a visible icon, not just a border color", async () => {
    localStorage.setItem(
      CHAT_KEY,
      JSON.stringify([{ role: "soumaya", text: "That sounds heavy.", mood: "sad" }]),
    );
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const text = await screen.findByText("That sounds heavy.");
    const bubble = text.closest(".chatdock-bubble");
    expect(bubble?.className).toContain("mood-sad");
    expect(bubble?.textContent).toContain("💙");
  });
});

describe("ChatDock — close button must not get stuck", () => {
  it("still closes when the end-of-chat distill call fails", async () => {
    localStorage.setItem(
      CHAT_KEY,
      JSON.stringify([
        { role: "you", text: "first" },
        { role: "soumaya", text: "reply" },
        { role: "you", text: "second" },
      ]),
    );
    distillChat.mockRejectedValue(new Error("network down"));
    const onClose = vi.fn();
    render(<ChatDock onClose={onClose} onFocus={() => {}} />);
    const closeBtn = await screen.findByTitle("Close");
    await act(async () => { closeBtn.click(); });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(pushToast).toHaveBeenCalledWith(expect.any(String), "⚠️", expect.any(Number));
  });
});

describe("ChatDock — saved memories survive a reload", () => {
  it("keeps a message marked saved after the component remounts, instead of re-offering it for duplicate ingestion", async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify([{ role: "you", text: "Remember this" }]));
    ingestText.mockResolvedValue({ nodes: [{ id: 5 }] });

    const { unmount } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const saveBtn = await screen.findByLabelText("Save as memory");
    await act(async () => { saveBtn.click(); });
    await waitFor(() => expect(ingestText).toHaveBeenCalledTimes(1));

    unmount();
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const reloadedBtn = await screen.findByLabelText("Save as memory");
    expect(reloadedBtn.getAttribute("disabled")).not.toBeNull();

    // Clicking the already-saved button again must not re-ingest.
    act(() => reloadedBtn.click());
    expect(ingestText).toHaveBeenCalledTimes(1);
  });
});

describe("ChatDock — Maya Chat → Galaxy Navigation", () => {
  const NAV = {
    target: { domain: "journey" as const, kind: "journey", id: 42, label: "Owner-operator transition" },
    reason: "Active journey — 40% along, 2 linked items",
  };

  it("a response carrying navigation renders a click-to-navigate chip", async () => {
    askChat.mockResolvedValue({ answer: "Here's what I found.", citations: [], navigation: NAV });
    render(<ChatDock onClose={() => {}} onFocus={() => {}} onNavigate={() => {}} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "why am I not making progress?" } });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(askChat).toHaveBeenCalled());
    const chip = await screen.findByTitle(NAV.reason);
    expect(chip.textContent).toContain("Owner-operator transition");
  });

  it("clicking the navigation chip calls onNavigate with the exact NavigationIntent, and never fires on its own", async () => {
    localStorage.setItem(
      CHAT_KEY,
      JSON.stringify([{ role: "soumaya", text: "Here's what I found.", navigation: NAV }]),
    );
    const onNavigate = vi.fn();
    render(<ChatDock onClose={() => {}} onFocus={() => {}} onNavigate={onNavigate} />);
    const chip = await screen.findByTitle(NAV.reason);

    // Rendering alone must never trigger navigation — it's a one-shot, user-triggered action.
    expect(onNavigate).not.toHaveBeenCalled();

    act(() => chip.click());
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(NAV);
  });

  it("reloading persisted chat history containing navigation does NOT auto-fire it on mount", async () => {
    localStorage.setItem(
      CHAT_KEY,
      JSON.stringify([{ role: "soumaya", text: "Here's what I found.", navigation: NAV }]),
    );
    const onNavigate = vi.fn();
    const { unmount } = render(<ChatDock onClose={() => {}} onFocus={() => {}} onNavigate={onNavigate} />);
    await screen.findByTitle(NAV.reason);
    unmount();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("clicking the chip with no onNavigate provided does not throw", async () => {
    localStorage.setItem(
      CHAT_KEY,
      JSON.stringify([{ role: "soumaya", text: "Here's what I found.", navigation: NAV }]),
    );
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const chip = await screen.findByTitle(NAV.reason);
    expect(() => act(() => chip.click())).not.toThrow();
  });

  it("existing citation chips still work unaffected by the new navigation chip", async () => {
    localStorage.setItem(
      CHAT_KEY,
      JSON.stringify([
        {
          role: "soumaya",
          text: "Here's what I found.",
          citations: [{ id: 7, label: "A real memory", type: "daily" }],
          navigation: NAV,
        },
      ]),
    );
    const onFocus = vi.fn();
    render(<ChatDock onClose={() => {}} onFocus={onFocus} onNavigate={() => {}} />);
    const citeChip = await screen.findByText("A real memory");
    act(() => citeChip.click());
    expect(onFocus).toHaveBeenCalledWith(7);
  });
});

describe("ChatDock — clearing a conversation is destructive and needs confirmation", () => {
  it("keeps the conversation on cancel, clears it once confirmed — via the app dialog, never window.confirm (IM-108)", async () => {
    localStorage.setItem(CHAT_KEY, JSON.stringify([{ role: "you", text: "Keep me" }]));
    const confirmSpy = vi.fn();
    (window as unknown as { confirm: typeof confirmSpy }).confirm = confirmSpy;
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await screen.findByText("Keep me");

    const clearBtn = screen.getByTitle("Clear conversation");
    act(() => clearBtn.click());
    // The shared ConfirmDialog appears; the conversation survives until confirmed.
    const dialog = await screen.findByRole("dialog", { name: "Clear this conversation?" });
    expect(dialog).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Keep me")).toBeTruthy();

    act(() => screen.getByText("Cancel").click());
    expect(screen.queryByRole("dialog", { name: "Clear this conversation?" })).toBeNull();
    expect(screen.getByText("Keep me")).toBeTruthy();

    act(() => clearBtn.click());
    await screen.findByRole("dialog", { name: "Clear this conversation?" });
    act(() => screen.getByText("Clear").click());
    expect(screen.queryByText("Keep me")).toBeNull();
  });
});

// Phase AC.1 (docs/specs/soumaya-connective-tissue-onboarding.md) — Journey-scoped Chat,
// mirroring the exact one-shot contract already proven for proactiveContext.
describe("ChatDock — Journey-scoped Chat handoff", () => {
  it("threads journeyId into askChat's 3rd argument and consumes it after exactly one send", async () => {
    askChat.mockResolvedValue({ answer: "Here's your journey.", citations: [] });
    const onConsumeJourneyContext = vi.fn();
    render(
      <ChatDock onClose={() => {}} onFocus={() => {}} journeyId={42} onConsumeJourneyContext={onConsumeJourneyContext} />,
    );
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "how's it going?" } });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(askChat).toHaveBeenCalledWith("how's it going?", expect.anything(), 42, undefined, undefined, expect.any(AbortSignal)));
    expect(onConsumeJourneyContext).toHaveBeenCalledTimes(1);
  });

  it("ordinary Chat with no journeyId sends undefined and never calls the consume callback", async () => {
    askChat.mockResolvedValue({ answer: "Got it.", citations: [] });
    const onConsumeJourneyContext = vi.fn();
    render(<ChatDock onClose={() => {}} onFocus={() => {}} onConsumeJourneyContext={onConsumeJourneyContext} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "just a normal question" } });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(askChat).toHaveBeenCalledWith("just a normal question", expect.anything(), undefined, undefined, undefined, expect.any(AbortSignal)));
    expect(onConsumeJourneyContext).not.toHaveBeenCalled();
  });
});

// Phase M (docs/specs/soumaya-product-audit.md, "mobile chat input/keyboard behavior").
describe("ChatDock — mobile input", () => {
  it("a multiline message still sends via the send button, and the input clears after", async () => {
    askChat.mockResolvedValue({ answer: "Got it.", citations: [] });
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const textarea = await screen.findByPlaceholderText(/Message/);
    fireEvent.change(textarea, { target: { value: "line one\nline two" } });
    expect((textarea as HTMLTextAreaElement).value).toBe("line one\nline two");
    const sendBtn = container.querySelector(".chatdock-send")! as HTMLButtonElement;
    await act(async () => { sendBtn.click(); });
    await waitFor(() => expect(askChat).toHaveBeenCalledWith("line one\nline two", expect.anything(), undefined, undefined, undefined, expect.any(AbortSignal)));
    expect((textarea as HTMLTextAreaElement).value).toBe("");
  });

  it("lifts itself above an on-screen keyboard via window.visualViewport, and settles back down when it closes", async () => {
    const listeners: Record<string, (() => void)[]> = { resize: [], scroll: [] };
    const vv = {
      height: 800,
      offsetTop: 0,
      addEventListener: (type: string, fn: () => void) => listeners[type]!.push(fn),
      removeEventListener: (type: string, fn: () => void) => {
        listeners[type] = listeners[type]!.filter((f) => f !== fn);
      },
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });

    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const dock = await waitFor(() => container.querySelector(".chatdock")! as HTMLElement);
    expect(dock.style.getPropertyValue("--keyboard-inset")).toBe("0px");

    // The keyboard opens: visualViewport shrinks by 300px, nothing else changes.
    vv.height = 500;
    act(() => { for (const fn of listeners.resize!) fn(); });
    expect(dock.style.getPropertyValue("--keyboard-inset")).toBe("300px");
    expect(dock.style.getPropertyValue("--vv-height")).toBe("500px");

    // The keyboard closes: back to 0.
    vv.height = 800;
    act(() => { for (const fn of listeners.resize!) fn(); });
    expect(dock.style.getPropertyValue("--keyboard-inset")).toBe("0px");
  });
});
