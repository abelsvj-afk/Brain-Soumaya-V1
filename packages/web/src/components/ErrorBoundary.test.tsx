import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary.js";

/**
 * The dock (and galaxy/overlays) rely on ErrorBoundary's contained-fallback
 * contract: a render throw inside the boundary degrades that subtree to its
 * fallback while the rest of the app keeps rendering — it must never propagate
 * and unmount the whole tree (the Mind-tab crash's blast radius before App.tsx
 * wrapped RightDock in one).
 */
function Boom(): never {
  throw new Error("kaboom");
}

afterEach(() => cleanup());

describe("ErrorBoundary — contained fallback", () => {
  it("renders the fallback (not a white screen) when a child throws, and siblings survive", () => {
    // React + the boundary both log the caught error; keep the test output clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(
        <div>
          <span>sibling still alive</span>
          <ErrorBoundary label="test-dock" fallback={<div>panel degraded</div>}>
            <Boom />
          </ErrorBoundary>
        </div>,
      );
      expect(screen.getByText("panel degraded")).toBeTruthy();
      expect(screen.getByText("sibling still alive")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("renders children untouched when nothing throws", () => {
    render(
      <ErrorBoundary label="test-ok" fallback={<div>panel degraded</div>}>
        <span>healthy child</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy child")).toBeTruthy();
    expect(screen.queryByText("panel degraded")).toBeNull();
  });
});
