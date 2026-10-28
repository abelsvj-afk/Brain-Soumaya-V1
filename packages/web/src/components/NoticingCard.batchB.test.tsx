import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";

/**
 * Batch B / GH-19 — "Yes, connect" must not celebrate a connection that was
 * never made, and a failed dismiss must not silently resurrect the card.
 * confirmInquiry resolves { ok:false } on failure (api/mind.ts contract);
 * dismissInquiry resolves false. Both used to be ignored.
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

const INQUIRY = {
  id: 7,
  kind: "bridge",
  question: "Are these two memories connected?",
  nodes: [{ id: 1, label: "alpha" }],
  createdAt: "2026-10-22T00:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getInquiries.mockResolvedValue([INQUIRY]);
  answerInquiry.mockResolvedValue(null);
  dismissInquiry.mockResolvedValue(true);
  rejectInquiry.mockResolvedValue(true);
  confirmInquiry.mockResolvedValue({ ok: true, hubId: null });
});
afterEach(() => cleanup());

async function openCard() {
  render(<NoticingCard onFocus={() => {}} spaceId="space1" />);
  const fab = await screen.findByLabelText(/Soumaya noticed/);
  await act(async () => { fab.click(); });
  expect(await screen.findByText("Are these two memories connected?")).toBeTruthy();
}

describe("GH-19 — confirm honesty", () => {
  it("a FAILED confirm shows a failure toast, plays no success sound, and keeps the inquiry", async () => {
    confirmInquiry.mockResolvedValue({ ok: false });
    await openCard();
    await act(async () => { screen.getByText("✦ Yes, connect").click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/couldn't connect/i), "⚠️", expect.any(Number)),
    );
    expect(playSfx).not.toHaveBeenCalledWith("achievement");
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("Connected ✦"), expect.anything(), expect.anything());
    // The inquiry is still here — not removed on a promise.
    expect(screen.getByText("Are these two memories connected?")).toBeTruthy();
  });

  it("a VERIFIED confirm celebrates and removes the inquiry", async () => {
    confirmInquiry.mockResolvedValue({ ok: true, hubId: null });
    await openCard();
    await act(async () => { screen.getByText("✦ Yes, connect").click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Connected ✦"), "🧠", expect.any(Number)),
    );
    // REG-226: this inquiry is a plain bridge link (no hub forms, no lens
    // is created), so the verified celebration is the neutral confirmation,
    // not the achievement jingle — the jingle is reserved for hub/lens
    // confirms (pinned in NoticingCard.batchR.test.tsx).
    expect(playSfx).toHaveBeenCalledWith("complete");
    await waitFor(() => expect(screen.queryByText("Are these two memories connected?")).toBeNull());
  });
});

describe("GH-19 — dismiss honesty", () => {
  it("a FAILED dismiss keeps the inquiry and explains, instead of a silent resurrection at the next poll", async () => {
    dismissInquiry.mockResolvedValue(false);
    await openCard();
    await act(async () => { screen.getByText("Not now").click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/couldn't wave/i), "⚠️", expect.any(Number)),
    );
    expect(screen.getByText("Are these two memories connected?")).toBeTruthy();
  });

  it("a successful dismiss removes the inquiry without a failure toast", async () => {
    dismissInquiry.mockResolvedValue(true);
    await openCard();
    await act(async () => { screen.getByText("Not now").click(); });
    await waitFor(() => expect(screen.queryByText("Are these two memories connected?")).toBeNull());
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringMatching(/couldn't wave/i), expect.anything(), expect.anything());
  });
});

describe("REG-110 — reject honesty (the GH-19 defect class on reject)", () => {
  it("a FAILED reject keeps the inquiry and explains, instead of a false success", async () => {
    rejectInquiry.mockResolvedValue(false);
    await openCard();
    await act(async () => { screen.getByText("Not related").click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/couldn't/i), "⚠️", expect.any(Number)),
    );
    expect(screen.getByText("Are these two memories connected?")).toBeTruthy();
    expect(pushToast).not.toHaveBeenCalledWith(
      expect.stringContaining("won't tie those together"),
      expect.anything(),
      expect.anything(),
    );
  });

  it("a VERIFIED reject removes the inquiry with the success note", async () => {
    rejectInquiry.mockResolvedValue(true);
    await openCard();
    await act(async () => { screen.getByText("Not related").click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("won't tie those together"), "🧠", expect.any(Number)),
    );
    await waitFor(() => expect(screen.queryByText("Are these two memories connected?")).toBeNull());
  });
});
