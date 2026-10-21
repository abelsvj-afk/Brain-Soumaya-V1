import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { getUnlockable } from "@brain/shared";
import { UnlockCelebration } from "./UnlockCelebration.js";

afterEach(() => cleanup());

/** IM-133: the reusable "🔓 Unlocked!" celebration moment. */
describe("UnlockCelebration (IM-133)", () => {
  it("renders the 🔓 Unlocked! moment with the item's label", () => {
    const item = getUnlockable("music-slow-tide")!;
    render(<UnlockCelebration item={item} onDismiss={() => {}} />);
    expect(screen.getByText(/🔓 Unlocked!/)).toBeTruthy();
    expect(screen.getByText("Slow Tide")).toBeTruthy();
    expect(screen.getByText(/Music/)).toBeTruthy();
  });

  it("dismisses on click, and renders nothing without an item", () => {
    const onDismiss = vi.fn();
    const { container } = render(<UnlockCelebration item={null} onDismiss={onDismiss} />);
    expect(container.firstChild).toBeNull();
    cleanup();
    render(<UnlockCelebration item={getUnlockable("ship-organic")!} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("alert"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
