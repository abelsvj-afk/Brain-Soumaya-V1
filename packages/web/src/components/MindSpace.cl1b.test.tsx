import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { Thought } from "../api/client.js";

/**
 * IM-25 (CL-1b) — MindSpace motes must be interactive, honest about the
 * 12-mote cut, carry a source legend, use reinforceCount/createdAt, and
 * distinguish enabled-with-zero-thoughts from disabled.
 * Written against the pre-change component first: every test here FAILS on
 * the old pointer-events:none / aria-hidden wallpaper implementation.
 */

let mockThoughts: Thought[] = [];
const reinforceThought = vi.fn(async (_id: number) => ({ promotedNodeId: null as number | null }));
const promoteThought = vi.fn(async (_id: number) => ({ nodeId: 42 }));
const dismissThought = vi.fn(async (_id: number) => true);

vi.mock("../api/client.js", () => ({
  getThoughts: () => Promise.resolve(mockThoughts),
  // Batch L (MIN-04): MindSpace loads via the strict Result variant now.
  getThoughtsResult: () => Promise.resolve({ ok: true as const, thoughts: mockThoughts }),
  reinforceThought: (id: number) => reinforceThought(id),
  promoteThought: (id: number) => promoteThought(id),
  dismissThought: (id: number) => dismissThought(id),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { MindSpace, setMindSpaceEnabled } from "./MindSpace.js";

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
  mockThoughts = [];
});
afterEach(() => cleanup());

describe("IM-25 MindSpace interactivity", () => {
  it("a mote is a real button (not aria-hidden wallpaper) and tapping it opens its actions", async () => {
    setMindSpaceEnabled(true);
    mockThoughts = [thought({ id: 7, text: "call the clinic", source: "goal", reinforceCount: 3 })];
    render(<MindSpace />);
    const mote = await screen.findByRole("button", { name: /call the clinic/ });
    fireEvent.click(mote);
    // The card uses the fetched fields the old overlay discarded.
    expect(await screen.findByText(/Kept 3×/)).toBeTruthy();
    expect(screen.getByText(/Held since/)).toBeTruthy();
    expect(screen.getByText(/Strength 60%/)).toBeTruthy();
  });

  it("shows a source legend naming what the mote colours mean", async () => {
    setMindSpaceEnabled(true);
    mockThoughts = [
      thought({ id: 1, text: "goal thought", source: "goal" }),
      thought({ id: 2, text: "chat thought", source: "chat" }),
    ];
    render(<MindSpace />);
    await screen.findByText("goal thought");
    expect(screen.getByText("Goal pull")).toBeTruthy();
    expect(screen.getByText("From chat")).toBeTruthy();
  });

  it("reinforce / promote / dismiss call the existing working-memory APIs", async () => {
    setMindSpaceEnabled(true);
    mockThoughts = [thought({ id: 9, text: "hold me" })];
    render(<MindSpace />);
    fireEvent.click(await screen.findByRole("button", { name: /hold me/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Keep/ }));
    await waitFor(() => expect(reinforceThought).toHaveBeenCalledWith(9));

    // The card stays open after a Keep — promote straight from it (promoting
    // closes the card), then re-open the mote for the dismiss.
    fireEvent.click(await screen.findByRole("button", { name: /Make memory/ }));
    await waitFor(() => expect(promoteThought).toHaveBeenCalledWith(9));

    mockThoughts = [thought({ id: 9, text: "hold me" })];
    fireEvent.click(await screen.findByRole("button", { name: /hold me/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Let go/ }));
    await waitFor(() => expect(dismissThought).toHaveBeenCalledWith(9));
  });

  it("honestly reports thoughts past the 12-mote cut instead of silently dropping them", async () => {
    setMindSpaceEnabled(true);
    mockThoughts = Array.from({ length: 15 }, (_, i) => thought({ id: i + 1, text: `thought ${i + 1}` }));
    render(<MindSpace />);
    await screen.findByText("thought 1");
    expect(screen.getByText(/\+3 more/)).toBeTruthy();
  });

  it("enabled with zero thoughts shows an explicit on-but-empty state (disabled shows nothing)", async () => {
    setMindSpaceEnabled(true);
    mockThoughts = [];
    render(<MindSpace />);
    expect(await screen.findByText(/MindSpace is on/)).toBeTruthy();
    cleanup();
    setMindSpaceEnabled(false);
    mockThoughts = [];
    render(<MindSpace />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText(/MindSpace is on/)).toBeNull();
  });
});
