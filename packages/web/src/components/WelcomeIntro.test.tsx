import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { WelcomeIntro } from "./WelcomeIntro.js";

afterEach(() => cleanup());

// Phase M (docs/specs/soumaya-product-audit.md, "first-launch framing"). The one-time-per-space
// gating itself (`brain.introSeen.${space.id}` in App.tsx) mirrors the existing, already-shipped
// `brain.legendSeen` mechanism verbatim — untested at the App.tsx level there too, since App.tsx
// has no existing test harness and pulling one in just for this would be disproportionate to a
// small, precedented localStorage check. This file covers the component itself: what it says,
// and that dismissal actually fires.
describe("WelcomeIntro", () => {
  it("names Soumaya as the product, the given companion name as who you talk to, and the Galaxy as the map — without overclaiming", () => {
    render(<WelcomeIntro companionName="Luna" onClose={() => {}} />);
    expect(screen.getByText("Soumaya", { exact: false })).toBeTruthy();
    expect(screen.getByText("Luna", { exact: false })).toBeTruthy();
    expect(screen.getByText("The Galaxy", { exact: false })).toBeTruthy();
    // Never claims omniscience or that the Galaxy holds literally everything.
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/knows everything|omniscient|all of your/i);
  });

  it("dismisses on the primary button", () => {
    const onClose = vi.fn();
    render(<WelcomeIntro companionName="Soumaya" onClose={onClose} />);
    fireEvent.click(screen.getByText("Let's go →"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on clicking the backdrop, but not the card itself (same pattern as Legend)", () => {
    const onClose = vi.fn();
    const { container } = render(<WelcomeIntro companionName="Soumaya" onClose={onClose} />);
    fireEvent.click(container.querySelector(".welcome-card")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector(".welcome-overlay")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is an accessible dialog", () => {
    render(<WelcomeIntro companionName="Soumaya" onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Welcome to Soumaya" })).toBeTruthy();
  });

  // Phase AC.1 (docs/specs/soumaya-connective-tissue-onboarding.md): the audit found this
  // screen never named Money/Wealth, Life Vision, or Journeys as real, separate places to go.
  // Batch P REG-223: Life Vision is not a tab — it is a real section at the top of the Mind
  // tab — so the old "Money, Life Vision, and Journeys are real tabs" wording is retired.
  it("names Money and Journeys as real tabs and Life Vision as a real section at the top of the Mind tab", () => {
    render(<WelcomeIntro companionName="Soumaya" onClose={() => {}} />);
    expect(screen.getByText("Money and Journeys")).toBeTruthy();
    expect(screen.getByText(/are real tabs, not just words/i)).toBeTruthy();
    expect(screen.getByText(/a real section at the top of the Mind tab/i)).toBeTruthy();
  });

  it("omits the Help link entirely when onSeeHelp isn't provided", () => {
    render(<WelcomeIntro companionName="Soumaya" onClose={() => {}} />);
    expect(screen.queryByText(/Show me the full map/)).toBeNull();
  });

  it("the Help link, when provided, is reachable in one tap and fires onSeeHelp without closing via onClose", () => {
    const onClose = vi.fn();
    const onSeeHelp = vi.fn();
    render(<WelcomeIntro companionName="Soumaya" onClose={onClose} onSeeHelp={onSeeHelp} />);
    fireEvent.click(screen.getByText(/Show me the full map/));
    expect(onSeeHelp).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
