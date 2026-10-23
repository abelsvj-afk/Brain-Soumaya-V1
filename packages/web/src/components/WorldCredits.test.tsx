import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import WorldCredits, { WORLD_CREDITS } from "./WorldCredits.js";

describe("WorldCredits", () => {
  it("carries the hard CC-BY attribution for the Station's base model (D-37)", () => {
    render(<WorldCredits />);
    expect(screen.getByText(/Profondo/)).toBeTruthy();
    expect(screen.getByText(/vostok/)).toBeTruthy();
    expect(screen.getByText(/Licensed CC BY\./)).toBeTruthy();
  });

  it("renders every registered credit", () => {
    render(<WorldCredits />);
    for (const c of WORLD_CREDITS) {
      expect(screen.getByText(new RegExp(c.asset.split("—")[0]!.trim().slice(0, 12)))).toBeTruthy();
    }
  });
});
