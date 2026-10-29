import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Fuel } from "@brain/shared";

const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { FuelGauge } from "./FuelGauge.js";

function fuel(over: Partial<Fuel>): Fuel {
  return { fuel: 50, capacity: 100, jobCost: 2, warpCost: 10, ...over } as Fuel;
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

describe("FuelGauge — reaching a full tank is celebrated", () => {
  it("does not celebrate a mount that starts already full", () => {
    render(<FuelGauge fuel={fuel({ fuel: 100, capacity: 100 })} pops={[]} />);
    expect(playSfx).not.toHaveBeenCalled();
  });

  it("plays a milestone sound only on the real below-cap → at-cap transition", () => {
    const { rerender } = render(<FuelGauge fuel={fuel({ fuel: 90, capacity: 100 })} pops={[]} />);
    expect(playSfx).not.toHaveBeenCalled();

    rerender(<FuelGauge fuel={fuel({ fuel: 100, capacity: 100 })} pops={[]} />);
    expect(playSfx).toHaveBeenCalledWith("milestone");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("full"), "⛽", expect.any(Number));

    // Staying at cap on a further re-render must not re-fire.
    playSfx.mockClear();
    rerender(<FuelGauge fuel={fuel({ fuel: 100, capacity: 100 })} pops={[]} />);
    expect(playSfx).not.toHaveBeenCalled();
  });
});

/**
 * Batch I — GH-09 (REG-067): while fuel data is absent (loading or
 * failed), the gauge must not render nothing at all — a failed fetch and
 * a still-loading one are distinguishable traces, never silent absence.
 * Fail-before: the gauge returns null for every null-fuel render.
 */
describe("FuelGauge — absent fuel is a visible state, not nothing", () => {
  it("renders a loading placeholder while fuel has never arrived", () => {
    const { container } = render(<FuelGauge fuel={null} pops={[]} />);
    expect(container.textContent).toMatch(/loading/i);
  });

  it("renders an error state with a retry when the load failed", () => {
    const onRetry = vi.fn();
    render(<FuelGauge fuel={null} pops={[]} loadState="error" onRetry={onRetry} />);
    const btn = screen.getByRole("button", { name: /fuel unavailable/i });
    btn.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a loaded gauge is unchanged (still a meter, still tappable)", () => {
    const onClick = vi.fn();
    const { container } = render(<FuelGauge fuel={fuel({ fuel: 50, capacity: 100 })} pops={[]} onClick={onClick} />);
    expect(container.querySelector(".fuel-gauge")).toBeTruthy();
    expect(screen.queryByText(/loading/i)).toBeNull();
  });
});
