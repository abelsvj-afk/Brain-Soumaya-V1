import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import WorldsDock, { type DockGroup } from "./WorldsDock.js";

afterEach(cleanup);

const groups = (onClick = vi.fn()): DockGroup[] => [
  {
    id: "a",
    label: "His gestures",
    tiles: [
      { id: "joy", icon: "☀️", label: "Joy", name: "Joy", active: true, onClick },
      { id: "sorrow", icon: "💧", label: "Sorrow", name: "Sorrow", active: false, onClick },
    ],
  },
  { id: "b", tiles: [{ id: "g", icon: "🌳", label: "Groves", name: "Groves", expanded: false, onClick }] },
];

describe("WorldsDock", () => {
  it("every tile has an icon AND a visible word, and keeps its full accessible name", () => {
    render(<WorldsDock groups={groups()} label="Eternity controls" />);
    const joy = screen.getByRole("button", { name: "Joy" });
    expect(joy.textContent).toContain("Joy");
    expect(joy.querySelector('[aria-hidden="true"]')?.textContent).toBe("☀️");
    expect(screen.getByRole("navigation", { name: "Eternity controls" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "His gestures" })).toBeTruthy();
  });

  it("active is never colour alone: pressed state, a ✓ badge — and a ▾/▴ badge for tiles that open something", () => {
    const { rerender } = render(<WorldsDock groups={groups()} label="x" />);
    const joy = screen.getByRole("button", { name: "Joy" });
    expect(joy.getAttribute("aria-pressed")).toBe("true");
    expect(joy.textContent).toContain("✓");
    expect(screen.getByRole("button", { name: "Sorrow" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Sorrow" }).textContent).not.toContain("✓");
    const g = screen.getByRole("button", { name: "Groves" });
    expect(g.getAttribute("aria-expanded")).toBe("false");
    expect(g.getAttribute("aria-pressed")).toBeNull();
    expect(g.textContent).toContain("▾");
    const open = groups();
    open[1]!.tiles[0]!.expanded = true;
    rerender(<WorldsDock groups={open} label="x" />);
    expect(screen.getByRole("button", { name: "Groves" }).textContent).toContain("▴");
  });

  it("clicking a tile runs its action; disabled tiles don't", () => {
    const onClick = vi.fn();
    const g = groups(onClick);
    g[0]!.tiles[1]!.disabled = true;
    render(<WorldsDock groups={g} label="x" />);
    fireEvent.click(screen.getByRole("button", { name: "Joy" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Sorrow" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when a world has no controls", () => {
    const { container } = render(<WorldsDock groups={[{ id: "e", tiles: [] }]} label="x" />);
    expect(container.firstChild).toBeNull();
  });
});
