import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

/**
 * Batch R — REG-226: the confirm/answer feedback matches what the action
 * pays. The achievement jingle sounds only for hub formation (a constellation
 * forms) or lens creation; plain anchor/bridge connects and inquiry answers
 * pay nothing, so they get the neutral confirmation ("complete") — the exact
 * shape REG-212 fixed in the panel/ManualLink doors.
 */

const getInquiries = vi.fn();
const answerInquiry = vi.fn();
const dismissInquiry = vi.fn();
const rejectInquiry = vi.fn();
const confirmInquiry = vi.fn();
vi.mock("../api/client.js", () => ({
  getInquiries: (...a: unknown[]) => getInquiries(...a),
  answerInquiry: (...a: unknown[]) => answerInquiry(...a),
  dismissInquiry: (...a: unknown[]) => dismissInquiry(...a),
  rejectInquiry: (...a: unknown[]) => rejectInquiry(...a),
  confirmInquiry: (...a: unknown[]) => confirmInquiry(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { NoticingCard } from "./NoticingCard.js";

const inquiry = (over: Record<string, unknown> = {}) => ({
  id: 7,
  kind: "bridge",
  question: "Are these two memories connected?",
  nodes: [{ id: 1, label: "alpha" }],
  createdAt: "2026-10-22T00:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  answerInquiry.mockResolvedValue({ ok: true });
  dismissInquiry.mockResolvedValue(true);
  rejectInquiry.mockResolvedValue(true);
  confirmInquiry.mockResolvedValue({ ok: true, hubId: null });
});
afterEach(() => cleanup());

async function openCard(kind: string) {
  getInquiries.mockResolvedValue([inquiry({ kind })]);
  render(<NoticingCard onFocus={() => {}} spaceId="space1" />);
  const fab = await screen.findByLabelText(/Soumaya noticed/);
  await act(async () => { fab.click(); });
  expect(await screen.findByText("Are these two memories connected?")).toBeTruthy();
}

async function confirm() {
  await act(async () => { screen.getByText("✦ Yes, connect").click(); });
}

describe("REG-226 — NoticingCard sounds match what the action pays", () => {
  it("an anchor confirm plays a neutral confirmation, never the achievement jingle", async () => {
    await openCard("anchor");
    await confirm();
    expect(playSfx).toHaveBeenCalledWith("complete");
    expect(playSfx).not.toHaveBeenCalledWith("achievement");
  });

  it("a bridge confirm plays a neutral confirmation, never the achievement jingle", async () => {
    await openCard("bridge");
    await confirm();
    expect(playSfx).toHaveBeenCalledWith("complete");
    expect(playSfx).not.toHaveBeenCalledWith("achievement");
  });

  it("a hub confirm still plays the achievement jingle (a constellation forms)", async () => {
    confirmInquiry.mockResolvedValue({ ok: true, hubId: 42 });
    await openCard("hub_suggestion");
    await confirm();
    expect(playSfx).toHaveBeenCalledWith("achievement");
    expect(playSfx).not.toHaveBeenCalledWith("complete");
  });

  it("a lens confirm still plays the achievement jingle (a lens is created)", async () => {
    await openCard("lens_suggestion");
    await confirm();
    expect(playSfx).toHaveBeenCalledWith("achievement");
    expect(playSfx).not.toHaveBeenCalledWith("complete");
  });

  it("answering an inquiry plays a neutral confirmation, never the achievement jingle", async () => {
    await openCard("bridge");
    const box = screen.getByPlaceholderText(/Tell her/) as HTMLTextAreaElement;
    await act(async () => {
      // React's onChange needs the native setter so the value sticks.
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(box, "they are about the same trip");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { screen.getByText("Answer").click(); });
    expect(playSfx).toHaveBeenCalledWith("complete");
    expect(playSfx).not.toHaveBeenCalledWith("achievement");
  });
});
