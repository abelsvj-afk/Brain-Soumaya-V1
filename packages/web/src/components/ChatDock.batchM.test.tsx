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

describe("REG-159 (JN-01) — the armed journey context is visible and dismissible", () => {
  it("names the armed journey in a banner while the context is armed", () => {
    render(<ChatDock onClose={() => {}} onFocus={() => {}} journeyId={7} journeyTitle="Become an RN" />);
    expect(screen.getByText(/Become an RN/)).toBeTruthy();
    expect(screen.getByText(/answers stay inside it/)).toBeTruthy();
  });

  it("shows no banner when no journey context is armed", () => {
    render(<ChatDock onClose={() => {}} onFocus={() => {}} journeyId={null} />);
    expect(screen.queryByText(/answers stay inside it/)).toBeNull();
  });

  it("dismissing the banner disarms the context without sending", async () => {
    const onConsume = vi.fn();
    render(<ChatDock onClose={() => {}} onFocus={() => {}} journeyId={7} journeyTitle="Become an RN" onConsumeJourneyContext={onConsume} />);
    await act(async () => { screen.getByRole("button", { name: "Remove journey scope" }).click(); });
    expect(onConsume).toHaveBeenCalledTimes(1);
  });

  it("a brain switch that clears the pending journey leaves no banner on the next mount", async () => {
    // Arm, then simulate the post-switch state: the fixed App handler clears
    // the pending id/title, so the dock remounts with no journey context.
    const { rerender, unmount } = render(
      <ChatDock onClose={() => {}} onFocus={() => {}} journeyId={7} journeyTitle="Become an RN" />,
    );
    expect(screen.getByText(/Become an RN/)).toBeTruthy();
    expect(screen.getByText(/answers stay inside it/)).toBeTruthy();
    rerender(<ChatDock onClose={() => {}} onFocus={() => {}} journeyId={null} journeyTitle={null} />);
    expect(screen.queryByText(/answers stay inside it/)).toBeNull();
    expect(screen.queryByText(/Become an RN/)).toBeNull();
    unmount();
    render(<ChatDock onClose={() => {}} onFocus={() => {}} journeyId={null} journeyTitle={null} />);
    expect(screen.queryByText(/answers stay inside it/)).toBeNull();
  });

  it("sending consumes the journey context exactly once, and a later send carries no scope", async () => {
    const onConsume = vi.fn();
    askChat.mockResolvedValue({ answer: "scoped answer", citations: [] });
    const { rerender } = render(
      <ChatDock onClose={() => {}} onFocus={() => {}} journeyId={7} journeyTitle="Become an RN" onConsumeJourneyContext={onConsume} />,
    );
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "what's next?" } });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(askChat).toHaveBeenCalledWith("what's next?", expect.anything(), 7, undefined, undefined, expect.any(AbortSignal)));
    expect(onConsume).toHaveBeenCalledTimes(1);
    // After consumption the parent clears the id; the banner must be gone.
    rerender(<ChatDock onClose={() => {}} onFocus={() => {}} journeyId={null} onConsumeJourneyContext={onConsume} />);
    expect(screen.queryByText(/answers stay inside it/)).toBeNull();
    expect(onConsume).toHaveBeenCalledTimes(1);
  });
});
