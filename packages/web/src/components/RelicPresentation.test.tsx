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
  storeRelic: vi.fn(),
  carryRelic: vi.fn(),
  exchangeRelic: vi.fn(),
  scanRelic: vi.fn(),
  sampleRelicClaimStart: vi.fn(),
}));
import * as api from "../api/relics.js";
import { RelicBlessings } from "./RelicBlessings.js";
import { RelicHuntControls } from "./RelicHuntControls.js";

const mocked = api as unknown as Record<string, ReturnType<typeof vi.fn>>;

function makeState(over: Partial<RelicsStateView> = {}): RelicsStateView {
  const base: RelicsStateView = {
    found: ["harbor-nail", "unnumbered-fragment"],
    held: ["unnumbered-fragment"],
    holdings: [
      {
        relicId: "unnumbered-fragment", name: "The Unnumbered Fragment", held: true, testOnly: false, anchorKey: "unnumbered-fragment:resting-place-one",
        blessing: { status: "cut", giftPlain: "It lends no blessing yet.", costPlain: "No trade-off.", cutReason: "It lends no blessing yet." },
        tierClass: "legacy", location: "carried",
        exchange: { eligible: true, loreThreadIds: [], creditsOffered: false, creditsValue: null },
        copyId: "rc_test_1", copyContext: "One of at most 3 copies in the shared pool.",
        provenance: [
          { kind: "genesis", world: "scale", anchorKey: "unnumbered-fragment:resting-place-one", placeName: "the scale's first pan", reason: null },
          { kind: "placed", world: "scale", anchorKey: "unnumbered-fragment:resting-place-one", placeName: "the scale's first pan", reason: null },
          { kind: "claimed", world: "scale", anchorKey: "unnumbered-fragment:resting-place-one", placeName: "the scale's first pan", reason: null },
        ],
      },
      {
        relicId: "harbor-nail", name: "The Harbor Nail", held: false, testOnly: false, anchorKey: "harbor-nail:lower-rim",
        blessing: { status: "live", giftPlain: "Your fuel tank holds 225 instead of 200.", costPlain: "Review earnings are 1 less while you hold it." },
        tierClass: null, location: "station",
        exchange: { eligible: false, loreThreadIds: [], creditsOffered: false, creditsValue: null },
        copyId: "rc_test_2", copyContext: "One of at most 7 copies in the shared pool.", provenance: [],
      },
    ],
    buffs: { fuelCap: 200, fuelRegenPerHour: 3.5, reviewEarn: 3, linkEarn: 2, discoveryEarn: 4, driftBonus: 3, driftDailyCap: 2, riseWindowDays: 30, riseWindowSetBy: null, riseWindowOverruled: [], growthMultiplier: 1, emotionalSwingMultiplier: 1, risenHold: false },
    gate: { open: false, openedBefore: false, missingPlain: "The gate is still closed." },
    recentDepartures: [],
    isOwnerSpace: false,
    scarcityOff: false,
    currentAnchorByRelic: {},
    chartTargets: ["thread-of-many"],
    currentWorld: "great-station",
    codex: [
      {
        relicId: "harbor-nail", name: "The Harbor Nail", world: "great-station", worldName: "The Great Station", discovered: true,
        layers: {
          stirring: { state: "unwritten" },
          place: { state: "locked" },
          description: { state: "unlocked", text: "NAIL DESCRIPTION TEXT" },
          threads: { state: "unwritten", entries: [] },
        },
        firstDiscovery: { discovererName: "You", byViewer: true, placeName: "the lower rim of the harbor" },
        stirrings: [],
      },
      {
        relicId: "mooring-ring", name: "The Mooring Ring", world: "great-station", worldName: "The Great Station", discovered: false,
        layers: {
          stirring: { state: "unwritten" },
          place: { state: "locked" },
          description: { state: "locked" },
          threads: { state: "unwritten", entries: [] },
        },
        firstDiscovery: { discovererName: "Sulay", byViewer: false, placeName: "where the harbor meets the road" },
        stirrings: [{ relicId: "mooring-ring", name: "The Mooring Ring", world: "great-station", worldName: "The Great Station", source: "ambient", state: "quiet", resolvedReason: "copy-claimed" }],
      },
    ],
    stirrings: [],
  };
  return { ...base, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.getRelicsState!.mockResolvedValue(makeState());
  mocked.storeRelic!.mockResolvedValue({ ok: true, state: makeState() });
  mocked.carryRelic!.mockResolvedValue({ ok: true, state: makeState() });
  mocked.exchangeRelic!.mockResolvedValue({ ok: true, state: makeState() });
  mocked.holdRelic!.mockResolvedValue({ ok: true, state: makeState() });
  mocked.unholdRelic!.mockResolvedValue({ ok: true, state: makeState() });
  mocked.releaseRelic!.mockResolvedValue({ ok: true, state: makeState() });
});

describe("Relics I-7 — layered Codex rendering", () => {
  it("renders unlocked layer text, honest closed/unwritten lines, both discovery records, and a quiet stirring as an ending — not an error", async () => {
    render(<RelicBlessings spaceId="s1" />);
    expect(await screen.findByText("NAIL DESCRIPTION TEXT")).toBeTruthy();
    expect(screen.getAllByText(/layer is still closed/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/No stirring words have been written/).length).toBeGreaterThan(0);
    expect(screen.getByText(/First found by You/)).toBeTruthy();
    expect(screen.getByText(/First found by Sulay/)).toBeTruthy();
    expect(screen.getByText(/You have not found this relic yet/)).toBeTruthy();
    expect(screen.getByText(/trail has gone quiet/)).toBeTruthy();
    expect(screen.queryByText(/error/i)).toBeNull();
  });
});

describe("Relics I-7 — Hold relic cards", () => {
  it("shows class honestly (Legacy / Unclassed yet), resting state, copy context, and the provenance chain in plain words", async () => {
    render(<RelicBlessings spaceId="s1" />);
    expect(await screen.findByText(/Class: Legacy/)).toBeTruthy();
    expect(screen.getByText(/Unclassed yet/)).toBeTruthy();
    expect(screen.getByText(/Carried with you/)).toBeTruthy();
    expect(screen.getByText(/Stored at the Great Station/)).toBeTruthy();
    expect(screen.getByText(/One of at most 3 copies/)).toBeTruthy();
    expect(screen.getByText(/Came into the worlds/)).toBeTruthy();
    expect(screen.getByText(/Claimed by a traveller/)).toBeTruthy();
  });

  it("the exchange menu renders from the server's state view: lore honestly unavailable, Credits not offered, chart offered with the server's targets", async () => {
    render(<RelicBlessings spaceId="s1" />);
    expect(await screen.findByText(/no thread can be revealed/)).toBeTruthy();
    expect(screen.getByText(/Credits are not offered/)).toBeTruthy();
    const select = screen.getByLabelText(/Chart a course to/) as HTMLSelectElement;
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: "thread-of-many" } });
    fireEvent.click(screen.getByRole("button", { name: /Exchange for a chart/ }));
    await waitFor(() => expect(mocked.exchangeRelic).toHaveBeenCalled());
    const args = mocked.exchangeRelic!.mock.calls[0]!;
    expect(args[0]).toBe("unnumbered-fragment");
    expect(args[1]).toBe("chart");
    expect(args[2]).toBe("thread-of-many");
    expect(typeof args[3]).toBe("string");
  });

  it("off-Station, the controls tell the truth: a Station note shows and change buttons are disabled — release is not one of them", async () => {
    mocked.getRelicsState!.mockResolvedValue(makeState({ currentWorld: "deep-past" }));
    render(<RelicBlessings spaceId="s1" />);
    expect(await screen.findByText(/changes happen at the Great Station/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Exchange for a chart/ }) as HTMLButtonElement).disabled).toBe(true);
    const storeCarry = screen.getAllByRole("button", { name: /Store it at the Station|Carry it with you/ }) as HTMLButtonElement[];
    expect(storeCarry.length).toBeGreaterThan(0);
    expect(storeCarry.every((b) => b.disabled)).toBe(true);
    expect((screen.getByRole("button", { name: "Let the The Unnumbered Fragment fly" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("an exchange departure is labeled an exchange in the departures list", async () => {
    mocked.getRelicsState!.mockResolvedValue(makeState({
      recentDepartures: [{ relicId: "unnumbered-fragment", name: "The Unnumbered Fragment", reason: "exchange", fromAnchor: "a", toAnchor: "b" }],
    }));
    render(<RelicBlessings spaceId="s1" />);
    expect(await screen.findByText(/was exchanged — its copy flew back/)).toBeTruthy();
  });
});

describe("Relics I-7 — hunt controls (scan surface)", () => {
  it("a scan reads back band + bearing only, and a quiet trail reads as gone quiet", async () => {
    mocked.scanRelic!.mockResolvedValue({ ok: true, band: "Near", bearing: "the lower rim of the harbor", quiet: false });
    const { rerender } = render(<RelicHuntControls relicId="harbor-nail" relicName="The Harbor Nail" glimmer="by the harbor's lower rim" settling={false} onLookCloser={() => {}} scanPosition={[1, 2, 3]} stirring={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Feel for it/ }));
    expect(await screen.findByText(/Near — toward the lower rim of the harbor/)).toBeTruthy();
    expect(screen.queryByText(/\[1, 2, 3\]|coordinates/)).toBeNull();

    mocked.scanRelic!.mockResolvedValue({ ok: true, band: null, bearing: null, quiet: true });
    rerender(<RelicHuntControls relicId="harbor-nail" relicName="The Harbor Nail" glimmer="by the harbor's lower rim" settling={false} onLookCloser={() => {}} scanPosition={[1, 2, 3]} stirring={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Feel for it/ }));
    expect(await screen.findByText(/trail has gone quiet/)).toBeTruthy();
  });

  it("an open stirring shows as a live trail; a wrong-anchor refusal keeps it visibly open", async () => {
    render(<RelicHuntControls relicId="mooring-ring" relicName="The Mooring Ring" glimmer="where the harbor meets the road" settling={false} onLookCloser={() => {}} scanPosition={[0, 0, 0]} stirring={{ relicId: "mooring-ring", name: "The Mooring Ring", world: "great-station", worldName: "The Great Station", source: "ambient", state: "open", resolvedReason: null }} notice="Your stirring does not rest here — the copy it promised waits at its own place, and no other copy will be given in its stead." />);
    expect(screen.getByText(/A stirring is open/)).toBeTruthy();
    expect(screen.getByText(/does not rest here/)).toBeTruthy();
    expect(screen.getByText(/trail is live/)).toBeTruthy();
  });
});

describe("Relics I-7 — review round 1 rider (P2-2)", () => {
  it("a refused exchange shows the server's plain reason — never swallowed by the panel", async () => {
    mocked.exchangeRelic!.mockResolvedValue({ ok: false, error: "Legendary relics change hands only at the Great Station." });
    render(<RelicBlessings spaceId="s1" />);
    const select = await screen.findByLabelText(/Chart a course to/);
    fireEvent.change(select, { target: { value: "thread-of-many" } });
    fireEvent.click(screen.getByRole("button", { name: /Exchange for a chart/ }));
    expect(await screen.findByText(/change hands only at the Great Station/)).toBeTruthy();
  });
});
