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
import { ChatRequestError } from "../api/chatSend.js";

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

describe("Finding 2 — degraded replies are visibly honest", () => {
  it("renders a Limited-mode banner naming the quota reason, without the connect-a-key line or the drew-on dressing", async () => {
    askChat.mockResolvedValue({
      answer: "• Car fund: Saving for a car.",
      citations: [{ id: 7, label: "Car fund", type: "daily" }],
      contextIds: [7, 8, 9],
      degraded: { reason: "quota" },
    });
    const onRecall = vi.fn();
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} onRecall={onRecall} />);
    await sendMessage("what about my car?");
    await screen.findByText(/Car fund: Saving for a car/);

    const banner = container.querySelector(".chatdock-degraded");
    expect(banner).toBeTruthy();
    expect(banner!.textContent).toContain("Limited mode");
    expect(banner!.textContent).toContain("out of credit");
    // The key line belongs ONLY to the missing-key case.
    expect(banner!.textContent).not.toContain("Connect an OpenAI or Gemini key");
    // No full-answer dressing: no "drew on N memories" chip, no galaxy light-up.
    expect(container.textContent).not.toContain("drew on");
    expect(onRecall).not.toHaveBeenCalled();
    // The bubble itself carries the degraded styling hook.
    expect(container.querySelector(".chatdock-bubble.degraded")).toBeTruthy();
  });

  it("the missing-key (offline) banner is the one place the connect-a-key line appears", async () => {
    askChat.mockResolvedValue({
      answer: "Some offline answer.",
      citations: [],
      contextIds: [],
      degraded: { reason: "offline" },
    });
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("hello?");
    await screen.findByText("Some offline answer.");
    const banner = container.querySelector(".chatdock-degraded");
    expect(banner!.textContent).toContain("Connect an OpenAI or Gemini key");
  });

  it("a healthy reply has no Limited-mode banner and keeps its drew-on chip", async () => {
    askChat.mockResolvedValue({
      answer: "A full answer.",
      citations: [{ id: 7, label: "Car fund", type: "daily" }],
      contextIds: [7, 8],
    });
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("what about my car?");
    await screen.findByText("A full answer.");
    expect(container.querySelector(".chatdock-degraded")).toBeNull();
    expect(await screen.findByText(/drew on 2 memories/)).toBeTruthy();
  });

  it("a degraded reply persisted before a reload still renders its banner", async () => {
    localStorage.setItem(
      "brain.chat.space1",
      JSON.stringify([
        { role: "you", text: "what about my car?", at: Date.now() },
        { role: "soumaya", text: "Offline answer.", at: Date.now(), degraded: { reason: "timeout" } },
      ]),
    );
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await screen.findByText("Offline answer.");
    const banner = container.querySelector(".chatdock-degraded");
    expect(banner!.textContent).toContain("took too long");
  });
});

describe("Finding 1 — the banner never shows raw server/network text", () => {
  it("a raw contract string thrown by the transport collapses to generic plain copy", async () => {
    askChat.mockRejectedValueOnce(new Error("Body must be { question: string }"));
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("are you there?");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't reach Soumaya");
    expect(container.textContent).not.toContain("Body must be");
    expect(container.textContent).not.toContain("question: string");
  });

  it("a ChatRequestError's plain-language copy is shown verbatim (it is user-safe by construction)", async () => {
    askChat.mockRejectedValueOnce(new ChatRequestError("Soumaya's server hit a problem just now — try again in a moment.", 500));
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("are you there?");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("server hit a problem");
  });
});

describe("Finding 1 — question cap is visible and enforced at the input", () => {
  it("the textarea carries maxLength=2000 and a counter appears near the limit", async () => {
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.maxLength).toBe(2000);
    expect(document.querySelector(".chatdock-charcount")).toBeNull();
    fireEvent.change(box, { target: { value: "x".repeat(1900) } });
    const counter = await waitFor(() => document.querySelector(".chatdock-charcount"));
    expect(counter!.textContent).toContain("1,900/2,000");
  });
});

describe("Finding 1 — an empty-text attachment is blocked at pick time with honest copy", () => {
  it("toasts 'no readable text', stages nothing, and the next send carries no attachments", async () => {
    extractFileText.mockResolvedValue({ text: "", name: "scan" });
    askChat.mockResolvedValue({ answer: "ok", citations: [], contextIds: [] });
    const { container } = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [new File(["x"], "scan.pdf")] } });
    });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("no readable text"), "⚠️", expect.any(Number)),
    );
    expect(container.querySelector(".chatdock-pending-att")).toBeNull();

    await sendMessage("summarize it");
    expect(askChat.mock.calls[0]![4]).toBeUndefined();
  });
});

describe("Finding 8 — closing the chat mid-flight no longer strands the message", () => {
  it("a reply that lands after the dock closed is there when the chat reopens", async () => {
    let resolveAsk: (v: unknown) => void = () => {};
    askChat.mockImplementation(() => new Promise((res) => { resolveAsk = res; }));
    const first = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("think hard");
    first.unmount();
    await act(async () => {
      resolveAsk({ answer: "Finished while you were away.", citations: [], contextIds: [] });
    });
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    expect(await screen.findByText("Finished while you were away.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failure that lands after the dock closed greets the reopened chat as a retryable notice", async () => {
    let rejectAsk: (e: unknown) => void = () => {};
    askChat.mockImplementation(() => new Promise((_res, rej) => { rejectAsk = rej; }));
    const first = render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await sendMessage("think hard");
    first.unmount();
    await act(async () => {
      rejectAsk(new Error("socket exploded in a weird internal way"));
    });
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't reach Soumaya");
    expect(alert.textContent).not.toContain("socket exploded");
    expect(screen.getByText("Retry")).toBeTruthy();
    // The parked notice was consumed — it does not linger in storage.
    expect(localStorage.getItem("brain.chatNotice.space1")).toBeNull();
  });
});
