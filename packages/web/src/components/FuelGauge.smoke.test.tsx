import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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
