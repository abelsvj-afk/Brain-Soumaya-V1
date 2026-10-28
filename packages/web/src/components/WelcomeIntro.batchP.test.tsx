import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * Batch P — REG-223: WelcomeIntro calls Life Vision what it is — a real
 * section at the top of the Mind tab, not a tab.
 */

import { WelcomeIntro } from "./WelcomeIntro.js";

afterEach(() => cleanup());

describe("REG-223 — the intro places Life Vision in the Mind tab", () => {
  it("says Life Vision is a real section at the top of the Mind tab", () => {
    render(<WelcomeIntro companionName="Soumaya" onClose={() => {}} />);
    expect(screen.getByText(/a real section at the top of the Mind tab/i)).toBeTruthy();
    // Money and Journeys stay real tabs; Life Vision is no longer called one.
    // (The bold lead is its own element, so match the two halves separately.)
    expect(screen.getByText("Money and Journeys")).toBeTruthy();
    expect(screen.getByText(/are real tabs, not just words/i)).toBeTruthy();
    expect(screen.queryByText(/Life Vision.*are real tabs/i)).toBeNull();
  });
});
