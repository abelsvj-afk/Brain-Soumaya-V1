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

  it("credits the Scale models as NASA public domain (no license to get wrong)", () => {
    render(<WorldCredits />);
    expect(screen.getByText(/International Space Station/)).toBeTruthy();
    expect(screen.getByText(/NASA 3D Resources, public domain/)).toBeTruthy();
  });

  it("credits the Low Poly Space Pack and the FlexUnit UFO (population increment)", () => {
    render(<WorldCredits />);
    expect(screen.getByText(/Low Poly Space Pack — reodesuxz/)).toBeTruthy();
    expect(screen.getByText(/no attribution required/)).toBeTruthy();
    expect(screen.getByText(/^FlexUnit UFO/)).toBeTruthy();
    expect(screen.getByText(/by FlexUnit, CC0/)).toBeTruthy();
  });
});
