import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Fuel, GraphNode } from "@brain/shared";
import { FuelGauge } from "./FuelGauge.js";
import { NotificationsBar } from "./NotificationsBar.js";

/**
 * REG-048 (PG-05): "low fuel" had two definitions — the gauge glowed at
 * <20% (<40 of 200) while the Notifications-bar alert fired at <15. One
 * definition (LOW_FUEL_THRESHOLD = 15, alert semantics win) now drives both.
 *
 * Fail-before: at 30/200 the gauge glowed low while no alert fired.
 */
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

function fuel(amount: number): Fuel {
  return { fuel: amount, capacity: 200, jobCost: 2, warpCost: 10 } as Fuel;
}

describe("REG-048 — one low-fuel definition drives gauge and alert", () => {
  it("at 30/200 neither the gauge nor the alert calls it low (the old gauge did)", () => {
    const { container } = render(<FuelGauge fuel={fuel(30)} pops={[]} />);
    expect(container.querySelector(".fuel-gauge.low")).toBeNull();
    render(
      <NotificationsBar fuel={fuel(30)} nodes={[] as GraphNode[]} health={null} onFocusNode={vi.fn()} onOpenTab={vi.fn()} />,
    );
    expect(screen.queryByText(/Low fuel/)).toBeNull();
  });

  it("at 14/200 both the gauge and the alert call it low", () => {
    const { container } = render(<FuelGauge fuel={fuel(14)} pops={[]} />);
    expect(container.querySelector(".fuel-gauge.low")).not.toBeNull();
    cleanup();
    render(
      <NotificationsBar fuel={fuel(14)} nodes={[] as GraphNode[]} health={null} onFocusNode={vi.fn()} onOpenTab={vi.fn()} />,
    );
    expect(screen.getByText(/Low fuel \(14\/200\)/)).toBeTruthy();
  });

  it("at exactly 15/200 neither calls it low (the threshold is 'under 15')", () => {
    const { container } = render(<FuelGauge fuel={fuel(15)} pops={[]} />);
    expect(container.querySelector(".fuel-gauge.low")).toBeNull();
  });
});
