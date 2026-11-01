import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { CaptainState } from "@brain/shared";
import { useCaptains } from "./useCaptains.js";
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
const mockResume = vi.mocked(resumeCaptain);
const mockWipe = vi.mocked(wipeCaptainMeetings);

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
  doingLine: "Visiting the Great Station.",
  fuel: 60,
  credits: 120,
  stopped: false,
  actsToday: 1,
  speaksToday: 0,
  meetingsRemembered: 0,
  firstMetAt: null,
  recentLog: [],
  barks: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCaptains.mockResolvedValue([state()]);
  mockGetChronicle.mockResolvedValue([]);
});

describe("useCaptains", () => {
  it("loads the roster (and the Chronicle when asked for it)", async () => {
    const { result } = renderHook(() => useCaptains(true, true));
    await waitFor(() => expect(result.current.captains).not.toBeNull());
    expect(result.current.captains?.map((c) => c.id)).toEqual(["bex"]);
    expect(result.current.chronicle).toEqual([]);
    expect(mockGetChronicle).toHaveBeenCalled();
    expect(result.current.failed).toBe(false);
  });

  it("does not fetch the Chronicle when it is not shown (Scale)", async () => {
    const { result } = renderHook(() => useCaptains(true, false));
    await waitFor(() => expect(result.current.captains).not.toBeNull());
    expect(mockGetChronicle).not.toHaveBeenCalled();
    expect(result.current.chronicle).toBeNull();
  });

  it("a failed load is an honest offline state, never an empty roster", async () => {
    mockGetCaptains.mockResolvedValue(null);
    const { result } = renderHook(() => useCaptains(true, true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.captains).toBeNull();
  });

  it("ask adopts the server's state and records her answer", async () => {
    mockAsk.mockResolvedValue({
      captain: state({ meetingsRemembered: 1 }),
      answer: "We have — once.",
    });
    const { result } = renderHook(() => useCaptains(true, true));
    await waitFor(() => expect(result.current.captains).not.toBeNull());
    await act(async () => {
      await result.current.ask("bex", "met");
    });
    expect(result.current.answers.get("bex")).toBe("We have — once.");
    expect(result.current.captains?.[0]?.meetingsRemembered).toBe(1);
  });

  it("stop / resume / wipe adopt the returned state; a refusal surfaces its message", async () => {
    mockStop.mockResolvedValue(state({ stopped: true }));
    mockResume.mockResolvedValue(state({ stopped: false }));
    mockWipe.mockResolvedValue(state({ meetingsRemembered: 0 }));
    const { result } = renderHook(() => useCaptains(true, false));
    await waitFor(() => expect(result.current.captains).not.toBeNull());
    await act(async () => {
      await result.current.stop("bex");
    });
    expect(result.current.captains?.[0]?.stopped).toBe(true);
    await act(async () => {
      await result.current.resume("bex");
    });
    expect(result.current.captains?.[0]?.stopped).toBe(false);
    await act(async () => {
      await result.current.wipeMeetings("bex");
    });
    expect(result.current.error).toBeNull();
  });
});
