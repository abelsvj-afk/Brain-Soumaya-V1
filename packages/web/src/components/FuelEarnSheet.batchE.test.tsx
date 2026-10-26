import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Fuel } from "@brain/shared";
import { FuelEarnSheet } from "./FuelEarnSheet.js";

/**
 * REG-053 (PG-10): the earn sheet's account of the economy was incomplete —
 * no link-income row; the Codex row misattributed discoveries to Soumaya;
 * none of the three user-directed spends (commission 25, warp 10, fast-flight
 * burn) was mentioned. Every earn/spend path in the economy code is now a
 * sheet row with its true amount and condition.
 *
 * The memory row's wording is deliberately untouched — it rides after REG-039
 * settles (design-only right now).
 */
afterEach(cleanup);

describe("REG-053 — earn sheet covers every earn/spend path", () => {
  const fuel = { fuel: 50, capacity: 200, jobCost: 2, warpCost: 10 } as Fuel;
  it("names link income, the true Codex attribution, and all three user-directed spends", () => {
    render(<FuelEarnSheet fuel={fuel} onAction={vi.fn()} onClose={vi.fn()} />);
    // Earn side.
    expect(screen.getByText("Links you forge")).toBeTruthy();
    expect(screen.getByText("+2 each")).toBeTruthy();
    expect(screen.getByText(/Every associative link on a logged memory pays \+2/)).toBeTruthy();
    expect(screen.getByText(/claimed the moment they're found/)).toBeTruthy();
    expect(screen.queryByText(/Soumaya finds lore as she explores/)).toBeNull();
    // The recall row names the first-touch bonus (RC-07's omission).
    expect(screen.getByText(/\+2 more the first time you tend your brain each day/)).toBeTruthy();
    // Spend side.
    expect(screen.getByText("Ways to spend Fuel")).toBeTruthy();
    expect(screen.getByText("Commission a warming")).toBeTruthy();
    expect(screen.getByText("−25")).toBeTruthy();
    expect(screen.getByText("Warp between worlds")).toBeTruthy();
    expect(screen.getByText("−10")).toBeTruthy();
    expect(screen.getByText("Fast-flight burn")).toBeTruthy();
    expect(screen.getByText("up to −5")).toBeTruthy();
    expect(screen.getByText("Deep jobs (her research)")).toBeTruthy();
    expect(screen.getByText("−2 each")).toBeTruthy();
    // Memory row wording untouched (REG-039 rides after).
    expect(screen.getByText("Log a memory")).toBeTruthy();
    expect(screen.getByText("+15")).toBeTruthy();
  });
});
