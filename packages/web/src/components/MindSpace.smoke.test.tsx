import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Thought } from "../api/client.js";

let mockThoughts: Thought[] = [];
vi.mock("../api/client.js", () => ({
  getThoughts: () => Promise.resolve(mockThoughts),
  // Batch L (MIN-04): MindSpace loads via the strict Result variant now.
  getThoughtsResult: () => Promise.resolve({ ok: true as const, thoughts: mockThoughts }),
}));

import { MindSpace, setMindSpaceEnabled } from "./MindSpace.js";

afterEach(() => {
  cleanup();
  mockThoughts = [];
});

function thought(over: Partial<Thought>): Thought {
  return { id: 1, text: "a thought", source: "manual", strength: 0.6, reinforceCount: 0, createdAt: "2026-01-01T00:00:00Z", ...over };
}

describe("MindSpace ambient overlay", () => {
  it("renders nothing when disabled", async () => {
    setMindSpaceEnabled(false);
    mockThoughts = [thought({ id: 1 })];
    render(<MindSpace />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("a thought")).toBeNull();
  });

  it("colors a mote by its source via the shared color map", async () => {
    setMindSpaceEnabled(true);
    mockThoughts = [thought({ id: 1, text: "a goal-driven thought", source: "goal" })];
    render(<MindSpace />);
    const text = await screen.findByText("a goal-driven thought");
    const mote = text.closest(".mindspace-mote") as HTMLElement;
    expect(mote.style.getPropertyValue("--mote-color")).toBe("255,157,60");
  });

  it("falls back to the manual color for an unrecognized source", async () => {
    setMindSpaceEnabled(true);
    mockThoughts = [thought({ id: 2, text: "a mystery thought", source: "something-new" })];
    render(<MindSpace />);
    const text = await screen.findByText("a mystery thought");
    const mote = text.closest(".mindspace-mote") as HTMLElement;
    expect(mote.style.getPropertyValue("--mote-color")).toBe("143,220,255");
  });
});
