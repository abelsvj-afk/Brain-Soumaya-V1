import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { Thought } from "../api/mind.js";

/**
 * Batch L — MindSpace (MIN-02 MindSpace half, MIN-04):
 *  - a failed load never renders the empty-mind claim;
 *  - a failed poll keeps the last good motes with a stale indication;
 *  - Keep / Let go failures toast and keep the card open.
 */

let mockResult: { ok: true; thoughts: Thought[] } | { ok: false } = { ok: true, thoughts: [] };
const getThoughtsResult = vi.fn(async (..._a: unknown[]) => mockResult);
const getThoughts = vi.fn(async (..._a: unknown[]) => (mockResult.ok ? mockResult.thoughts : []));
const reinforceThought = vi.fn(
  async (_id: number): Promise<{ promotedNodeId: number | null } | null> => ({ promotedNodeId: null as number | null }),
);
const promoteThought = vi.fn(async (_id: number) => ({ nodeId: 42 }));
const dismissThought = vi.fn(async (_id: number) => true);

vi.mock("../api/client.js", () => ({
  getThoughtsResult: (...a: unknown[]) => getThoughtsResult(...a),
  getThoughts: (...a: unknown[]) => getThoughts(...a),
  reinforceThought: (id: number) => reinforceThought(id),
  promoteThought: (id: number) => promoteThought(id),
  dismissThought: (id: number) => dismissThought(id),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { MindSpace, setMindSpaceEnabled } from "./MindSpace.js";
import { pushToast } from "./Toasts.js";
const pushToastMock = pushToast as unknown as ReturnType<typeof vi.fn>;

function thought(over: Partial<Thought>): Thought {
  return {
    id: 1,
    text: "a thought",
    source: "manual",
    strength: 0.6,
    reinforceCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResult = { ok: true, thoughts: [] };
  // Real timers by default: findByText polls on timers, which fake timers
  // would freeze. The poll test below switches to fake timers itself.
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MIN-04 (REG-135) — MindSpace never claims an empty mind it could not confirm", () => {
  it("a failed first load shows an error, never 'no live thoughts right now'", async () => {
    setMindSpaceEnabled(true);
    mockResult = { ok: false };
    render(<MindSpace />);
    expect(await screen.findByText(/couldn't load/i)).toBeTruthy();
    expect(screen.queryByText(/no live thoughts right now/)).toBeNull();
  });

  it("a failed poll keeps the last good motes and says the refresh failed", async () => {
    // Fake timers must be installed BEFORE mount: the 15s interval is
    // created in the mount effect, and a real interval ignores later faking.
    // findByText polling needs real timers, so this test flushes the initial
    // load with fake-timer microtask advances instead.
    setMindSpaceEnabled(true);
    mockResult = { ok: true, thoughts: [thought({ id: 1, text: "hold me" })] };
    vi.useFakeTimers();
    try {
      render(<MindSpace />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText("hold me")).toBeTruthy();
      // The next 15s poll fails.
      mockResult = { ok: false };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      expect(screen.getByText("hold me")).toBeTruthy();
      expect(screen.queryByText(/no live thoughts right now/)).toBeNull();
      expect(screen.getByText(/couldn't refresh/i)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a confirmed empty load still says the mind is clear", async () => {
    setMindSpaceEnabled(true);
    mockResult = { ok: true, thoughts: [] };
    render(<MindSpace />);
    expect(await screen.findByText(/MindSpace is on — no live thoughts right now/)).toBeTruthy();
  });
});

describe("MIN-02 (REG-133) — MindSpace Keep / Let go honour their results", () => {
  it("a failed Keep toasts and keeps the card open", async () => {
    setMindSpaceEnabled(true);
    reinforceThought.mockResolvedValue(null);
    mockResult = { ok: true, thoughts: [thought({ id: 9, text: "hold me" })] };
    render(<MindSpace />);
    fireEvent.click(await screen.findByRole("button", { name: /hold me/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Keep/ }));
    await waitFor(() => expect(reinforceThought).toHaveBeenCalledWith(9));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't keep/i), expect.anything(), expect.anything()),
    );
    // The card is still open — the thought was not kept. (The text appears
    // twice while the card is open: the mote and the card body.)
    expect(screen.getAllByText("hold me").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Keep/ })).toBeTruthy();
  });

  it("a failed Let go toasts and keeps the card open", async () => {
    setMindSpaceEnabled(true);
    dismissThought.mockResolvedValue(false);
    mockResult = { ok: true, thoughts: [thought({ id: 9, text: "hold me" })] };
    render(<MindSpace />);
    fireEvent.click(await screen.findByRole("button", { name: /hold me/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Let go/ }));
    await waitFor(() => expect(dismissThought).toHaveBeenCalledWith(9));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't let go/i), expect.anything(), expect.anything()),
    );
    expect(screen.getByRole("button", { name: /Let go/ })).toBeTruthy();
  });
});
