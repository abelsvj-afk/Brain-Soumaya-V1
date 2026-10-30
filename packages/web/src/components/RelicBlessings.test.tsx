import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { RelicsStateView } from "@brain/shared";

vi.mock("../api/relics.js", () => ({
  getRelicsState: vi.fn(),
  getRelicPreview: vi.fn(),
  holdRelic: vi.fn(),
  unholdRelic: vi.fn(),
  releaseRelic: vi.fn(),
  syncLegacyRelics: vi.fn(),
  setRelicScarcity: vi.fn(),
  findRelic: vi.fn(),
  getRelics: vi.fn(),
  postRelic: vi.fn(),
}));
import * as api from "../api/relics.js";
import { RelicBlessings } from "./RelicBlessings.js";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeState(over: Partial<RelicsStateView> = {}): RelicsStateView {
  const base: RelicsStateView = {
    found: ["harbor-nail", "dawn-leaf"],
    held: [],
    holdings: [
      { relicId: "harbor-nail", name: "The Harbor Nail", held: false, testOnly: false, anchorKey: "harbor-nail:resting-place-one", blessing: { status: "live", giftPlain: "Your fuel tank holds 225 instead of 200.", costPlain: "Review earnings are 1 less while you hold it." } },
      { relicId: "dawn-leaf", name: "The Dawn Leaf", held: false, testOnly: false, anchorKey: "dawn-leaf:resting-place-one", blessing: { status: "cut", giftPlain: "It lends no blessing yet.", costPlain: "No trade-off.", cutReason: "It lends no blessing yet — the app has no way for partial milestones to feed progress, so there is nothing for it to change." } },
    ],
    buffs: { fuelCap: 200, fuelRegenPerHour: 3.5, reviewEarn: 3, linkEarn: 2, discoveryEarn: 4, driftBonus: 3, driftDailyCap: 2, riseWindowDays: 30, riseWindowSetBy: null, riseWindowOverruled: [], growthMultiplier: 1, emotionalSwingMultiplier: 1, risenHold: false },
    gate: { open: false, openedBefore: false, missingPlain: "The gate is still closed. Still needed: the Witness Without a Name and any two other relics." },
    recentDepartures: [],
    isOwnerSpace: false,
    scarcityOff: false,
    currentAnchorByRelic: {},
  };
  return { ...base, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.holdRelic!.mockResolvedValue({ ok: true, state: makeState({ held: ["harbor-nail"] }) });
  mocked.unholdRelic!.mockResolvedValue({ ok: true, state: makeState() });
  mocked.releaseRelic!.mockResolvedValue({ ok: true, state: makeState({ found: ["dawn-leaf"], holdings: [makeState().holdings[1]!] }), comet: { relicId: "harbor-nail", name: "The Harbor Nail" } });
  mocked.setRelicScarcity!.mockResolvedValue({ ok: true, scarcityOff: true });
});

describe("RelicBlessings (v2 §11, A10/A23 web halves)", () => {
  it("shows gift and trade-off in plain words, the cut relic's plain reason, and the gate line", async () => {
    mocked.getRelicsState!.mockResolvedValue(makeState());
    render(<RelicBlessings spaceId="s1" />);
    expect(await screen.findByText(/Your fuel tank holds 225/)).toBeTruthy();
    expect(screen.getByText(/Review earnings are 1 less/)).toBeTruthy();
    expect(screen.getByText(/lends no blessing yet — the app has no way for partial milestones/)).toBeTruthy();
    expect(screen.getByText(/Still needed: the Witness Without a Name/)).toBeTruthy();
  });

  it("hold shows a preview naming the overruled relic before confirming, and only then writes", async () => {
    mocked.getRelicsState!.mockResolvedValue(makeState({
      found: ["witness-seed", "thread-of-many"],
      held: ["witness-seed"],
      holdings: [
        { relicId: "witness-seed", name: "The Witness Seed", held: true, testOnly: false, anchorKey: "a", blessing: { status: "live", giftPlain: "Memories from the last 45 days can rise.", costPlain: "Progress grows more slowly." } },
        { relicId: "thread-of-many", name: "The Thread of Many", held: false, testOnly: false, anchorKey: "b", blessing: { status: "live", giftPlain: "Link earnings pay 4 per link.", costPlain: "Window narrows to 20 days." } },
      ],
    }));
    mocked.getRelicPreview!.mockResolvedValue({
      previewFor: "thread-of-many", previewName: "The Thread of Many", refused: null, wouldHold: ["witness-seed", "thread-of-many"],
      buffs: { fuelCap: 200, fuelRegenPerHour: 3.5, reviewEarn: 3, linkEarn: 4, discoveryEarn: 4, driftBonus: 3, driftDailyCap: 2, riseWindowDays: 20, riseWindowSetBy: "thread-of-many", riseWindowOverruled: ["witness-seed"], growthMultiplier: 0.75, emotionalSwingMultiplier: 1, risenHold: false },
    });
    render(<RelicBlessings spaceId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Hold the The Thread of Many" }));
    expect(await screen.findByText(/Witness Seed overruled/)).toBeTruthy();
    expect(mocked.holdRelic).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm hold" }));
    await waitFor(() => expect(mocked.holdRelic).toHaveBeenCalledWith("thread-of-many"));
  });

  it("shows the hold-cap message when three are already held", async () => {
    mocked.getRelicsState!.mockResolvedValue(makeState({ held: ["a", "b", "c"] }));
    render(<RelicBlessings spaceId="s1" />);
    expect(await screen.findByText(/You can hold 3 relics at once/)).toBeTruthy();
  });

  it("release is two-step and warns when the relic is part of the un-crossed gate set", async () => {
    mocked.getRelicsState!.mockResolvedValue(makeState({
      found: ["witness-without-a-name", "harbor-nail", "dawn-leaf"],
      holdings: [
        { relicId: "witness-without-a-name", name: "The Witness Without a Name", held: false, testOnly: false, anchorKey: "a", blessing: { status: "gate-key", giftPlain: "It is the key to Eternity's gate.", costPlain: "No trade-off." } },
        ...makeState().holdings,
      ],
      gate: { open: false, openedBefore: false, missingPlain: "The gate is still closed." },
    }));
    render(<RelicBlessings spaceId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Let the The Witness Without a Name fly" }));
    expect(await screen.findByText(/part of your gate set — the gate will ask for it again/)).toBeTruthy();
    expect(mocked.releaseRelic).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, let it fly" }));
    await waitFor(() => expect(mocked.releaseRelic).toHaveBeenCalledWith("witness-without-a-name"));
  });

  it("A10 web half: the scarcity switch renders only for an owner space", async () => {
    mocked.getRelicsState!.mockResolvedValue(makeState());
    const { unmount } = render(<RelicBlessings spaceId="s1" />);
    await screen.findByText(/Relic blessings/);
    expect(screen.queryByText(/Testing switch/)).toBeNull();
    unmount();
    mocked.getRelicsState!.mockResolvedValue(makeState({ isOwnerSpace: true }));
    render(<RelicBlessings spaceId="s1" />);
    expect(await screen.findByText(/Testing switch/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Turn scarcity off/ }));
    await waitFor(() => expect(mocked.setRelicScarcity).toHaveBeenCalledWith(true));
  });

  it("recent departures can be watched again (comet)", async () => {
    mocked.getRelicsState!.mockResolvedValue(makeState({ recentDepartures: [{ relicId: "harbor-nail", name: "The Harbor Nail", reason: "release", fromAnchor: "a", toAnchor: "b" }] }));
    render(<RelicBlessings spaceId="s1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Watch it fly again" }));
    expect(await screen.findByRole("dialog", { name: /Harbor Nail flying back/ })).toBeTruthy();
  });
});
