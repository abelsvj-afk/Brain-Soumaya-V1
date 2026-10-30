import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WelcomeIntro } from "./WelcomeIntro.js";

afterEach(cleanup);

describe("WelcomeIntro reflects the app as it is now", () => {
  it("names the worlds, travel and the way home", () => {
    render(<WelcomeIntro companionName="Soumaya" onClose={() => {}} />);
    expect(screen.getByText("Worlds", { exact: false })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Tools → Travel/);
    expect(document.body.textContent).toMatch(/brings you home/);
  });
  it("says where you are when opened inside a world, and nothing at home", () => {
    const { unmount } = render(<WelcomeIntro companionName="S" onClose={() => {}} place={{ world: "growing-place", transit: false }} />);
    expect(document.body.textContent).toMatch(/You are in The Growing Place right now/);
    unmount();
    render(<WelcomeIntro companionName="S" onClose={() => {}} place={{ world: null, transit: false }} />);
    expect(document.body.textContent).not.toMatch(/You are in/);
  });
});
