import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

/**
 * Batch O — Fleet panel (REG-169 SF-04, REG-170 SF-05).
 *
 * Falsification notes: on the pre-change panel `status` starts `{}` and
 * every absent unit renders "💤 Standing by" under "0 of 6 units active"
 * even when the scene never mounted (getStatus() === undefined), so "no
 * status source" is indistinguishable from "all units idle"; and target
 * chips slice at four with no count. Both tests below fail against that
 * code.
 */
import { FleetPanel } from "./FleetPanel.js";
import type { FleetStatus } from "../graph/Graph3D.js";

afterEach(cleanup);

function statusWithBeacon(targetCount: number): FleetStatus {
  return {
    ship: { active: false, detail: "Docked at the Waystation — between tasks" },
    station: { active: true, detail: "Holding orbit — home base, always on" },
    beacon: {
      active: targetCount > 0,
      detail: targetCount > 0 ? `${targetCount} warming memories` : "None deployed",
      targets: Array.from({ length: targetCount }, (_, i) => ({ id: i + 1, label: `Memory ${i + 1}` })),
      pending: 0,
    },
  };
}

describe("REG-169 (SF-04) — 'no status source' is distinct from 'all units idle'", () => {
  it("renders an unavailable note — not 'Standing by' — when the scene never reports", () => {
    render(<FleetPanel getStatus={() => undefined} onFocus={vi.fn()} />);
    expect(screen.getByText(/Fleet status unavailable/)).toBeTruthy();
    expect(screen.queryByText(/Standing by/)).toBeNull();
    expect(screen.queryByText(/units active/)).toBeNull();
    // Every roster row's status line is the unavailable note, not "Standing by".
    expect(screen.getAllByText("Status unavailable")).toHaveLength(6);
  });

  it("once a source reports, the idle fleet honestly reads as idle", () => {
    render(<FleetPanel getStatus={() => ({})} onFocus={vi.fn()} />);
    expect(screen.queryByText(/Fleet status unavailable/)).toBeNull();
    expect(screen.getByText(/0 of 6 units active/)).toBeTruthy();
    expect(screen.getAllByText(/Standing by/).length).toBeGreaterThan(0);
  });

  it("a live status still renders real activity once it arrives", () => {
    const { rerender } = render(<FleetPanel getStatus={() => undefined} onFocus={vi.fn()} />);
    expect(screen.getByText(/Fleet status unavailable/)).toBeTruthy();
    rerender(<FleetPanel getStatus={() => statusWithBeacon(1)} onFocus={vi.fn()} />);
    expect(screen.queryByText(/Fleet status unavailable/)).toBeNull();
    // Beacon warming one memory + the always-on station = 2 active.
    expect(screen.getByText(/2 of 6 units active/)).toBeTruthy();
  });
});

describe("REG-170 (SF-05) — a truncated target list states its full count", () => {
  it("six targets show four chips plus the full count", () => {
    render(<FleetPanel getStatus={() => statusWithBeacon(6)} onFocus={vi.fn()} />);
    expect(screen.getByText(/Showing 4 of 6 targets/)).toBeTruthy();
    expect(screen.getByText("Memory 1")).toBeTruthy();
    expect(screen.getByText("Memory 4")).toBeTruthy();
    expect(screen.queryByText("Memory 5")).toBeNull();
    expect(screen.queryByText("Memory 6")).toBeNull();
  });

  it("four or fewer targets need no disclosure", () => {
    render(<FleetPanel getStatus={() => statusWithBeacon(3)} onFocus={vi.fn()} />);
    expect(screen.queryByText(/Showing \d+ of \d+ targets/)).toBeNull();
    expect(screen.getByText("Memory 3")).toBeTruthy();
  });

  it("the visible chips still fly to their memories", () => {
    const onFocus = vi.fn();
    render(<FleetPanel getStatus={() => statusWithBeacon(6)} onFocus={onFocus} />);
    fireEvent.click(screen.getByText("Memory 2"));
    expect(onFocus).toHaveBeenCalledWith(2);
  });
});
