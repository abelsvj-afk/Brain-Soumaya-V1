import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CaptainState, ChronicleLine } from "@brain/shared";
import CaptainsPanel from "./CaptainsPanel.js";
import {
  askCaptain,
  getCaptains,
  getChronicle,
  resumeCaptain,
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
  };
});

const mockGetCaptains = vi.mocked(getCaptains);
const mockGetChronicle = vi.mocked(getChronicle);
const mockAsk = vi.mocked(askCaptain);
const mockStop = vi.mocked(stopCaptain);
const mockWipe = vi.mocked(wipeCaptainMeetings);
const mockResume = vi.mocked(resumeCaptain);

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
  doingLine: "Warped to Scale — 10 fuel of her own, the fast way.",
  fuel: 50,
  credits: 120,
  stopped: false,
  actsToday: 3,
  speaksToday: 1,
  meetingsRemembered: 1,
  firstMetAt: "2026-10-22T12:00:00.000Z",
  recentLog: [
    {
      id: 7,
      npcId: "bex",
      kind: "travel",
      act: "Warped to Scale — 10 fuel of her own, the fast way.",
      cause: "curiosity pulled toward Scale.",
      createdAt: "2026-10-22T13:00:00.000Z",
    },
  ],
  barks: [],
  ...over,
});

const inactive = (id: "dain" | "veyra", name: string, role: string): CaptainState =>
  state({
    id,
    name,
    role,
    active: false,
    present: false,
    currentWorld: null,
    sessionState: "away",
    doingLine: "Not flying yet — runs begin in a later increment.",
    meetingsRemembered: 0,
    firstMetAt: null,
    recentLog: [],
  });

const chronicleLines: ChronicleLine[] = [
  {
    id: 9,
    npcId: "bex",
    npcName: "Bex — Regular",
    kind: "greet",
    line: "Well, look who drifted in.",
    cause: "sociability ran high.",
    createdAt: "2026-10-22T13:05:00.000Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCaptains.mockResolvedValue([
    inactive("dain", "Dain", "Hauler"),
    inactive("veyra", "Veyra", "Seeker"),
    state(),
  ]);
  mockGetChronicle.mockResolvedValue(chronicleLines);
  mockAsk.mockResolvedValue({ captain: state(), answer: "I'm at Scale just now." });
  mockStop.mockResolvedValue(state({ stopped: true, present: false }));
  mockResume.mockResolvedValue(state());
  mockWipe.mockResolvedValue(state({ meetingsRemembered: 0 }));
});

describe("CaptainsPanel", () => {
  it("shows Bex live — where, doing, her own ledgers, her why-log — and Dain/Veyra honestly not flying", async () => {
    render(<CaptainsPanel world="great-station" />);
    expect(await screen.findByRole("heading", { name: "Bex — Regular" })).toBeTruthy();
    expect(screen.getByText(/Here now — visiting/)).toBeTruthy();
    expect(screen.getByText(/50 fuel · 120 credits/)).toBeTruthy();
    expect(screen.getByText(/curiosity pulled toward Scale/)).toBeTruthy();
    expect(screen.getAllByText(/Not flying yet/)).toHaveLength(2);
    // The honesty line: what the captains are, in plain words.
    expect(screen.getByText(/not other players/)).toBeTruthy();
  });

  it("the three ask buttons ask the server; her answer renders", async () => {
    render(<CaptainsPanel world="great-station" />);
    await screen.findByRole("heading", { name: "Bex — Regular" });
    fireEvent.click(screen.getByRole("button", { name: "What are you doing?" }));
    await waitFor(() => expect(mockAsk).toHaveBeenCalledWith("bex", "doing"));
    expect(await screen.findByText(/I'm at Scale just now/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Have we met?" }));
    await waitFor(() => expect(mockAsk).toHaveBeenCalledWith("bex", "met"));
    fireEvent.click(screen.getByRole("button", { name: "Where are you headed?" }));
    await waitFor(() => expect(mockAsk).toHaveBeenCalledWith("bex", "headed"));
  });

  it("stop, resume, and forget-our-meetings are the owner's controls", async () => {
    render(<CaptainsPanel world="great-station" />);
    await screen.findByRole("heading", { name: "Bex — Regular" });
    fireEvent.click(screen.getByRole("button", { name: "Forget our meetings" }));
    await waitFor(() => expect(mockWipe).toHaveBeenCalledWith("bex"));
    fireEvent.click(screen.getByRole("button", { name: "Stop Bex" }));
    await waitFor(() => expect(mockStop).toHaveBeenCalledWith("bex"));
    // The stopped state offers resume instead. P1: the label is
    // pronoun-neutral panel copy ("Start again") — the old
    // hard-coded "Start her again" assumed every captain is a she.
    fireEvent.click(await screen.findByRole("button", { name: "Start again" }));
    await waitFor(() => expect(mockResume).toHaveBeenCalledWith("bex"));
  });

  it("at the Station the Chronicle rides in the panel", async () => {
    render(<CaptainsPanel world="great-station" />);
    expect(await screen.findByText(/The Chronicle/)).toBeTruthy();
    expect(screen.getByText(/Well, look who drifted in/)).toBeTruthy();
    expect(mockGetChronicle).toHaveBeenCalled();
  });

  it("at Scale there is no Chronicle section and no Chronicle fetch — presence is the panel", async () => {
    render(<CaptainsPanel world="scale" />);
    expect(await screen.findByRole("heading", { name: "Bex — Regular" })).toBeTruthy();
    expect(screen.queryByText(/The Chronicle/)).toBeNull();
    expect(mockGetChronicle).not.toHaveBeenCalled();
  });

  it("a failed load is an honest offline line with a retry, never an empty panel", async () => {
    mockGetCaptains.mockResolvedValue(null);
    render(<CaptainsPanel world="great-station" />);
    expect(await screen.findByText(/couldn't be reached/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("P1: an underway captain renders in transit with destination, kind, and home anchor named", async () => {
    mockGetCaptains.mockResolvedValue([
      state({
        present: false,
        currentWorld: null,
        sessionState: "away",
        transitState: "underway",
        legTo: "growing-place",
        legKind: "drift",
        doingLine: "Underway to the Growing Place — drift, due later today. Last seen at the Great Station.",
      }),
    ]);
    render(<CaptainsPanel world="great-station" />);
    expect(await screen.findByRole("heading", { name: "Bex — Regular" })).toBeTruthy();
    expect(screen.getByText(/In transit — bound for the Growing Place \(drift\)/)).toBeTruthy();
    expect(screen.getByText(/Home anchor: her Station quarter/)).toBeTruthy();
    expect(screen.getByText(/Underway to the Growing Place/)).toBeTruthy();
  });
});
