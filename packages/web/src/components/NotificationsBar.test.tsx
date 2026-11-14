import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Fuel } from "@brain/shared";
import { NotificationsBar } from "./NotificationsBar.js";

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
});
afterEach(() => cleanup());

function lowFuel(): Fuel {
  return { fuel: 10, capacity: 200, jobCost: 2, warpCost: 10 } as Fuel;
}

/**
 * Batch I — GH-16 (REG-069): alert dismissals are scoped per space, not
 * per browser session. Dismissing an alert in one brain must never hide
 * it in another. Fail-before: the component takes no spaceId and keys
 * dismissals under one shared sessionStorage key.
 */
describe("NotificationsBar — dismissals are scoped per space", () => {
  it("dismissing low-fuel in one brain leaves it visible in another, and remembered in the first", () => {
    const props = {
      fuel: lowFuel(),
      nodes: [],
      health: null,
      onFocusNode: vi.fn(),
      onOpenTab: vi.fn(),
    };
    const { rerender } = render(<NotificationsBar {...props} spaceId="brain-a" />);
    expect(screen.getByText(/Low fuel/)).toBeTruthy();
    // fireEvent wraps in act(); a native .click() leaves the state
    // update unflushed and the assertion reads the stale render.
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText(/Low fuel/)).toBeNull();

    // Another brain: the alert is back — the dismissal never crossed spaces.
    rerender(<NotificationsBar {...props} spaceId="brain-b" />);
    expect(screen.getByText(/Low fuel/)).toBeTruthy();

    // Back to the first brain: still dismissed.
    rerender(<NotificationsBar {...props} spaceId="brain-a" />);
    expect(screen.queryByText(/Low fuel/)).toBeNull();
  });
});

describe("NotificationsBar — no-key notice waits for the user's own content (UX review #3)", () => {
  const noKey = { ok: true, embeddings: { model: "hash", dim: 8 }, llm: { model: "heuristic", available: false }, nodes: 1 };
  const base = { fuel: null, onFocusNode: vi.fn(), onOpenTab: vi.fn(), spaceId: "s1" };
  const seed = { id: 1, label: "The first light", type: "daily", content: "", origin: "agent" } as any;

  it("holds the notice while only Soumaya's welcome star exists", () => {
    render(<NotificationsBar {...base} health={noKey as any} nodes={[seed]} />);
    expect(screen.queryByText(/Offline mode/)).toBeNull();
  });
  it("shows the calm offline line once the user adds a to-do (action items count)", () => {
    const todo = { id: 2, label: "Call mum", type: "daily", content: "", kind: "action" } as any;
    render(<NotificationsBar {...base} health={noKey as any} nodes={[seed, todo]} />);
    expect(screen.getByText(/Offline mode — Soumaya works without a cloud AI key/)).toBeTruthy();
  });
  it("a degraded provider still alerts immediately with its specific reason", () => {
    const degraded = { ...noKey, llm: { model: "gemini-2", available: true, degraded: true, degradedReason: null } };
    render(<NotificationsBar {...base} health={degraded as any} nodes={[seed]} />);
    expect(screen.getByText(/Running in offline fallback/)).toBeTruthy();
  });
});
