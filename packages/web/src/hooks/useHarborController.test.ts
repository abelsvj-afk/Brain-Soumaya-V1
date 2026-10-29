import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { NpcState } from "@brain/shared";
import { useHarborController } from "./useHarborController.js";
import { askNpc, getNpc, resumeNpc, stopNpc } from "../api/npcs.js";

vi.mock("../api/npcs.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/npcs.js")>();
  return {
    ...orig,
    getNpc: vi.fn(),
    askNpc: vi.fn(),
    stopNpc: vi.fn(),
    resumeNpc: vi.fn(),
  };
});

const mockGetNpc = vi.mocked(getNpc);
const mockAsk = vi.mocked(askNpc);
const mockStop = vi.mocked(stopNpc);
const mockResume = vi.mocked(resumeNpc);

const state = (over: Partial<NpcState> = {}): NpcState => ({
  id: "harbor-controller",
  name: "Harbor controller",
  job: "Help you arrive — routes, arrivals, traffic.",
  world: "great-station",
  stopped: false,
  actsToday: 1,
  speaksToday: 0,
  gateOpen: false,
  relicsHeld: 0,
  recentLog: [
    {
      id: 1,
      npcId: "harbor-controller",
      kind: "explore",
      act: "Looked for a way onward in my own world — found no relic.",
      cause: "Its daily look for a way onward.",
      createdAt: new Date().toISOString(),
    },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetNpc.mockResolvedValue(state());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useHarborController", () => {
  it("does not fetch while disabled", () => {
    renderHook(() => useHarborController(false));
    expect(mockGetNpc).not.toHaveBeenCalled();
  });

  it("loads the state on mount and reports the log", async () => {
    const { result } = renderHook(() => useHarborController(true));
    await waitFor(() => expect(result.current.npc).not.toBeNull());
    expect(result.current.npc?.name).toBe("Harbor controller");
    expect(result.current.failed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("a failed load is an offline state with a retry", async () => {
    mockGetNpc.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useHarborController(true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.npc).toBeNull();
    mockGetNpc.mockResolvedValueOnce(state());
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(result.current.failed).toBe(false));
    expect(result.current.npc).not.toBeNull();
  });

  it("ask adopts the server's answer and state", async () => {
    mockAsk.mockResolvedValue({ npc: state({ speaksToday: 1 }), answer: "You hold 25 fuel." });
    const { result } = renderHook(() => useHarborController(true));
    await waitFor(() => expect(result.current.npc).not.toBeNull());
    await act(async () => {
      await result.current.ask("fuel");
    });
    expect(mockAsk).toHaveBeenCalledWith("harbor-controller", "fuel");
    expect(result.current.answer).toBe("You hold 25 fuel.");
    expect(result.current.npc?.speaksToday).toBe(1);
  });

  it("a failed ask surfaces the server's plain-language error", async () => {
    mockAsk.mockRejectedValue(new Error("has used today's allowance"));
    const { result } = renderHook(() => useHarborController(true));
    await waitFor(() => expect(result.current.npc).not.toBeNull());
    await act(async () => {
      await result.current.ask("fuel");
    });
    expect(result.current.error).toContain("didn't go through");
  });

  it("stop and resume adopt the server's state", async () => {
    mockStop.mockResolvedValue(state({ stopped: true }));
    mockResume.mockResolvedValue(state({ stopped: false }));
    const { result } = renderHook(() => useHarborController(true));
    await waitFor(() => expect(result.current.npc).not.toBeNull());
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.npc?.stopped).toBe(true);
    await act(async () => {
      await result.current.resume();
    });
    expect(result.current.npc?.stopped).toBe(false);
  });

  it("a fresh welcome speak surfaces as the answer; a stale one does not", async () => {
    const fresh = state({
      recentLog: [
        {
          id: 2,
          npcId: "harbor-controller",
          kind: "speak",
          act: "Welcome to the Great Station — you're here.",
          cause: "A journey arrived here just now.",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    mockGetNpc.mockResolvedValueOnce(fresh);
    const { result } = renderHook(() => useHarborController(true));
    await waitFor(() => expect(result.current.answer).toBe("Welcome to the Great Station — you're here."));

    const stale = state({
      recentLog: [
        {
          id: 3,
          npcId: "harbor-controller",
          kind: "speak",
          act: "You hold 25 fuel.",
          cause: "You asked about fuel.",
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        },
      ],
    });
    mockGetNpc.mockResolvedValueOnce(stale);
    const { result: result2 } = renderHook(() => useHarborController(true));
    await waitFor(() => expect(result2.current.npc).not.toBeNull());
    expect(result2.current.answer).toBeNull();
  });
});
