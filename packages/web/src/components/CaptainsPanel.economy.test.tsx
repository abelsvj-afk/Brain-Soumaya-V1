import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CaptainState, ChronicleLine } from "@brain/shared";
import CaptainsPanel from "./CaptainsPanel.js";
import {
  askCaptain,
  getCaptains,
  getChronicle,
  resumeCaptain,
  setDirectorEnabled,
  stopCaptain,
  wipeCaptainMeetings,
} from "../api/captains.js";

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
    setDirectorEnabled: vi.fn(),
  };
});

const mockGetCaptains = vi.mocked(getCaptains);
const mockGetChronicle = vi.mocked(getChronicle);
const mockAsk = vi.mocked(askCaptain);
const mockDirector = vi.mocked(setDirectorEnabled);

const state = (over: Partial<CaptainState> = {}): CaptainState => ({
  id: "bex",
  name: "Bex",
  role: "Regular",
  pronouns: "she",
  ageBand: "late 20s",
  personality: "Warm, sociable, always at the Station.",
  traits: ["Sociable", "Generous", "Cautious"],
  active: true,
  present: true,
  homeWorld: "great-station",
  homeAnchor: "her Station quarter",
  transitState: "none",
  legTo: null,
  legKind: null,
  currentWorld: "great-station",
  sessionState: "visiting",
  doingLine: "Sold 5 Ore to Station Foundry at 6 Credits each.",
  fuel: 50,
  credits: 175,
  stopped: false,
  actsToday: 4,
  speaksToday: 1,
  meetingsRemembered: 1,
  firstMetAt: "2026-10-22T12:00:00.000Z",
  recentLog: [
    {
      id: 9,
      npcId: "bex",
      kind: "sell",
      act: "Sold 5 Ore to Station Foundry at 6 Credits each.",
      cause: "Ambition — the stored plan's next step.",
      createdAt: "2026-10-22T13:00:00.000Z",
    },
  ],
  barks: [],
  cargo: [
    { good: "component", qty: 1 },
    { good: "ore", qty: 3 },
  ],
  holdUsed: 4,
  holdCapacity: 20,
  savingsGoal: { label: "a cargo of Circuits, bought honest", target: 300, distance: 125 },
  affinities: [{ captainId: "veyra", value: -1 }],
  directorEnabled: true,
  ...over,
});

const veyra = state({
  id: "veyra",
  name: "Veyra",
  role: "Seeker",
  homeWorld: "scale",
  homeAnchor: "her ship",
  cargo: undefined,
  holdUsed: undefined,
  savingsGoal: undefined,
  affinities: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCaptains.mockResolvedValue([state(), veyra]);
  mockGetChronicle.mockResolvedValue([] as ChronicleLine[]);
  mockDirector.mockResolvedValue(false);
});

describe("CaptainsPanel — P3 economy surfaces (T9)", () => {
  it("S-1 visible cargo: the laden hold renders exactly as the wire reports it, with her savings distance", async () => {
    render(<CaptainsPanel world="great-station" />);
    expect(await screen.findByText(/Hold:/)).toBeTruthy();
    expect(screen.getByText(/1 Component · 3 Ore/)).toBeTruthy();
    expect(screen.getByText(/4 of 20 units/)).toBeTruthy();
    expect(screen.getByText(/125 Credits to the 300 mark/)).toBeTruthy();
    expect(screen.getByText(/a cargo of Circuits, bought honest/)).toBeTruthy();
  });

  it("her affinities render as her regard, and 'Tell me about Veyra' asks the about question with the target", async () => {
    mockAsk.mockResolvedValue({ captain: state(), answer: "My honest read on Veyra? A captain who's cost me a little, market-wise." });
    render(<CaptainsPanel world="great-station" />);
    expect(await screen.findByText(/Her regard/)).toBeTruthy();
    expect(screen.getByText(/Veyra -1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tell me about Veyra" }));
    await waitFor(() => expect(mockAsk).toHaveBeenCalledWith("bex", "about", "veyra"));
    expect(await screen.findByText(/cost me a little/)).toBeTruthy();
  });

  it("the Director switch renders at the Station and toggles through the api", async () => {
    render(<CaptainsPanel world="great-station" />);
    const toggle = await screen.findByRole("button", { name: "Turn the Director off" });
    fireEvent.click(toggle);
    await waitFor(() => expect(mockDirector).toHaveBeenCalledWith(false));
  });

  it("no UTC-formatted timestamp appears in the rendered economy surfaces", async () => {
    render(<CaptainsPanel world="great-station" />);
    await screen.findByText(/Hold:/);
    expect(document.body.textContent ?? "").not.toMatch(/\d{2}:\d{2} UTC|Z\b.*GMT/);
  });
});
