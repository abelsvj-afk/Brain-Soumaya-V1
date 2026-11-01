import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CaptainState } from "@brain/shared";
import CaptainsPanel from "./CaptainsPanel.js";
import { getCaptains, getChronicle } from "../api/captains.js";

vi.mock("../api/captains.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/captains.js")>();
  return {
    ...orig,
    getCaptains: vi.fn(),
    getCaptain: vi.fn(),
    getChronicle: vi.fn(),
    askCaptain: vi.fn(),
    stopCaptain: vi.fn(),
    resumeCaptain: vi.fn(),
    wipeCaptainMeetings: vi.fn(),
    resetCaptain: vi.fn(),
  };
});

const mockGetCaptains = vi.mocked(getCaptains);
const mockGetChronicle = vi.mocked(getChronicle);

/**
 * P2 panel surface (B1.1/B1.7): a purpose captain's card shows her
 * stored plan — goal, version, and each step with its expected
 * outcome — and her gate progress in plain words, from the wire
 * state alone. Times render space-local; no UTC string appears.
 */
const veyra = (over: Partial<CaptainState> = {}): CaptainState => ({
  id: "veyra",
  name: "Veyra",
  role: "Seeker",
  pronouns: "she",
  ageBand: "early 30s",
  personality: "Restless, private, quietly intense.",
  traits: ["Restless", "Private", "Bold"],
  active: true,
  present: true,
  homeWorld: "scale",
  homeAnchor: "her ship",
  transitState: "none",
  legTo: null,
  legKind: null,
  currentWorld: "scale",
  sessionState: "visiting",
  doingLine: "At Scale, following her plan.",
  fuel: 20,
  credits: 132,
  stopped: false,
  actsToday: 5,
  speaksToday: 0,
  meetingsRemembered: 0,
  firstMetAt: null,
  recentLog: [],
  barks: [],
  relicsHeld: ["harbor-nail", "star-hanger"],
  gateView: {
    heldCount: 2,
    hasWitness: false,
    decision: "unmet",
    missing: "the Witness",
    line: "2 of the gate's shape held; the Witness is missing.",
  },
  plan: {
    goalId: "gate-worthy",
    goalText: "hold Witness + any two",
    version: 2,
    state: "active",
    steps: [
      { kind: "search", label: "Search the Scale stirring", expected: "a find at Scale", state: "completed", observed: "a find at Scale" },
      { kind: "gate-check", label: "Ask the gate question", expected: "a gate decision", state: "open", observed: null },
    ],
  },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCaptains.mockResolvedValue([veyra()]);
  mockGetChronicle.mockResolvedValue([]);
});

describe("CaptainsPanel — P2 purpose surface", () => {
  it("renders her plan: goal, version, steps with their expected outcomes", async () => {
    render(<CaptainsPanel world="great-station" />);
    expect(await screen.findByText(/hold Witness \+ any two/)).toBeTruthy();
    expect(screen.getByText(/Plan v2/)).toBeTruthy();
    expect(screen.getByText(/Search the Scale stirring/)).toBeTruthy();
    expect(screen.getByText(/a find at Scale/)).toBeTruthy();
    expect(screen.getByText(/Ask the gate question/)).toBeTruthy();
  });

  it("renders her gate progress in plain words, and her relic count", async () => {
    render(<CaptainsPanel world="great-station" />);
    expect(await screen.findByText(/2 of the gate's shape held; the Witness is missing\./)).toBeTruthy();
    expect(screen.getByText(/Relics held from her own pool: 2/)).toBeTruthy();
  });

  it("a captain with no plan shows no plan section (Bex stays exactly as she was)", async () => {
    mockGetCaptains.mockResolvedValue([
      veyra({ id: "bex", name: "Bex", role: "Regular", plan: null, gateView: null, relicsHeld: [] }),
    ]);
    render(<CaptainsPanel world="great-station" />);
    expect(await screen.findByText(/Bex — Regular/)).toBeTruthy();
    expect(screen.queryByText(/Plan v/)).toBeNull();
    expect(screen.queryByText(/gate's shape/)).toBeNull();
  });
});
