import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GalaxyErrorCard } from "./GalaxyErrorCard.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/**
 * Batch I — GH-01 (REG-060): the galaxy error card must offer the Lite
 * escape that exists for exactly this failure — a device that can't
 * render WebGL loops on Reload otherwise. Fail-before: the component
 * does not exist on the base tip.
 */
describe("GalaxyErrorCard — the galaxy error card offers the Lite escape", () => {
  it("offers Reload and a working path into the app without WebGL", () => {
    const onReload = vi.fn();
    render(<GalaxyErrorCard onReload={onReload} />);
    expect(screen.getByText(/3D galaxy hit an error/i)).toBeTruthy();
    screen.getByText("Reload").click();
    expect(onReload).toHaveBeenCalledTimes(1);
    screen.getByText(/open without the 3D galaxy/i).click();
    expect(localStorage.getItem("brain.lite")).toBe("1");
  });
});
