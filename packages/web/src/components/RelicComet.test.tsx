import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RelicComet } from "./RelicComet.js";

/**
 * The comet departure (Worlds — design note §4, B-03 return as a comet):
 * the copy flies off like a comet and disappears from the brain galaxy,
 * in an animation the player can pause and watch.
 */
describe("RelicComet", () => {
  it("names the relic and says where it is going", () => {
    render(<RelicComet relicName="Thread of Many" onDismiss={() => {}} />);
    expect(screen.getByRole("dialog", { name: /Thread of Many flying back/ })).toBeTruthy();
    expect(screen.getByText(/Thread of Many is flying on/)).toBeTruthy();
    expect(screen.getByText(/never the same place twice/)).toBeTruthy();
  });

  it("pause freezes the flight mid-sky and resume restarts it", () => {
    render(<RelicComet relicName="Thread of Many" onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Pause/ }));
    expect(screen.getByRole("button", { name: /Resume/ })).toBeTruthy();
    expect(screen.getByText(/Paused — take as long as you like/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    expect(screen.getByRole("button", { name: /Pause/ })).toBeTruthy();
  });

  it("dismiss lets it go; watch again replays the flight", () => {
    const onDismiss = vi.fn();
    render(<RelicComet relicName="Thread of Many" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /Watch again/ }));
    expect(screen.getByText(/Thread of Many is flying on/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Let it go/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
