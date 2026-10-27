import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same cwd-relative reader Observatory.batchB.test.tsx uses. */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

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
  isVoiceSupported: () => true,
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

function seedTurns(n = 2) {
  const turns = [];
  for (let i = 0; i < n; i++) {
    turns.push({ role: "you", text: `question ${i + 1}`, at: Date.now() - 1000 * (n - i) });
    turns.push({ role: "soumaya", text: `answer ${i + 1}`, at: Date.now() - 900 * (n - i) });
  }
  localStorage.setItem(CHAT_KEY, JSON.stringify(turns));
}

async function sendMessage(text: string) {
  const box = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
  await waitFor(() => expect(askChat).toHaveBeenCalled());
}

/** The scrollable message list, with jsdom geometry mocked to a scrolled-away state. */
function mockScrolledAway() {
  const list = document.querySelector(".chatdock-msgs") as HTMLElement;
  expect(list).toBeTruthy();
  Object.defineProperty(list, "scrollHeight", { value: 2000, configurable: true });
  Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
  list.scrollTop = 0;
  const spy = vi.spyOn(list, "scrollTo");
  return { list, spy };
}

describe("REG-084 — every chat header control carries its name visibly at the 44px standard", () => {
  it("each tool shows a visible caption (no hover needed) and an accessible name", async () => {
    seedTurns(2);
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await screen.findByText("question 1");
    for (const name of ["Persona", "Voice", "Wrap up", "Tools", "Clear", "Close"]) {
      const btn = screen.getByRole("button", { name: new RegExp(name, "i") });
      expect(btn.textContent).toContain(name);
    }
  });

  it("the CSS sizes header tools at the 44px input-row standard", () => {
    const css = readRepoFile("src/index.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = /\.chatdock-tool\s*\{([^}]*)\}/.exec(css);
    expect(rule, ".chatdock-tool rule exists").toBeTruthy();
    expect(rule![1]).toMatch(/min-height:\s*44px/);
    expect(rule![1]).toMatch(/min-width:\s*44px/);
  });
});

describe("REG-086 — a reply never yanks a reader of history", () => {
  it("a reply landing while scrolled away does not move the list; a pill offers one tap down", async () => {
    seedTurns(1);
    let resolveChat!: (v: unknown) => void;
    askChat.mockImplementationOnce(() => new Promise((r) => { resolveChat = r; }));
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await screen.findByText("question 1");
    const { list, spy } = mockScrolledAway();
    // The reader scrolls away from the bottom first.
    fireEvent.scroll(list);
    await sendMessage("one more question");
    // The user's own message scrolls into view (they just sent it).
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    // Her reply lands while the reader is scrolled away: no yank, pill appears.
    await act(async () => { resolveChat({ answer: "here it is", citations: [], contextIds: [] }); });
    await screen.findByText("here it is");
    expect(spy).not.toHaveBeenCalled();
    const pill = await screen.findByRole("button", { name: /new reply/i });
    expect(pill).toBeTruthy();
    // One tap reaches the reply.
    fireEvent.click(pill);
    expect(spy).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /new reply/i })).toBeNull();
  });

  it("a reply landing while already near the bottom still scrolls (no pill needed)", async () => {
    seedTurns(1);
    askChat.mockResolvedValue({ answer: "right here", citations: [], contextIds: [] });
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await screen.findByText("question 1");
    const list = document.querySelector(".chatdock-msgs") as HTMLElement;
    Object.defineProperty(list, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(list, "clientHeight", { value: 400, configurable: true });
    list.scrollTop = 0;
    const spy = vi.spyOn(list, "scrollTo");
    await sendMessage("hello again");
    await screen.findByText("right here");
    expect(spy).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /new reply/i })).toBeNull();
  });
});

describe("REG-089 — a failed distill approval keeps its one-tap retry", () => {
  it("the proposal stays approvable after a failed capture, and leaves only on success", async () => {
    seedTurns(2);
    distillChat.mockResolvedValue(["Keep this note"]);
    ingestText.mockRejectedValueOnce(new Error("ingest failed"));
    render(<ChatDock onClose={() => {}} onFocus={() => {}} />);
    await screen.findByText("question 1");
    // Offer the wrap-up (✨ appears once the conversation has substance).
    // The button is title-named on the base tree (no visible caption yet),
    // so reach it by title here — the REG-084 caption is what makes it
    // findable by role+name afterwards.
    fireEvent.click(screen.getByTitle("Wrap up — let Soumaya pick out anything worth saving"));
    const proposal = await screen.findByText("Keep this note");
    expect(proposal).toBeTruthy();
    const add = screen.getByTitle("Save as a memory");
    fireEvent.click(add);
    await waitFor(() => expect(pushToast).toHaveBeenCalled());
    // Failed: the proposal is still there to retry.
    expect(screen.getByText("Keep this note")).toBeTruthy();
    // Retry with a working capture: it leaves only on success.
    ingestText.mockResolvedValue({ nodes: [{ id: 7 }] });
    fireEvent.click(screen.getByTitle("Save as a memory"));
    await waitFor(() => expect(screen.queryByText("Keep this note")).toBeNull());
  });
});
