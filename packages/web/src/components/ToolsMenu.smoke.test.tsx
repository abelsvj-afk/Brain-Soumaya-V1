import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ToolsMenu } from "./ToolsMenu.js";

afterEach(cleanup);

function props(over = {}) {
  return {
    onSearch: vi.fn(), onLenses: vi.fn(), onConnections: vi.fn(), candCount: 0,
    onReview: vi.fn(), dueCount: 0, onTimeline: vi.fn(), onLegend: vi.fn(),
    onWorldMap: vi.fn(),
    onFlashback: vi.fn(), onFocusMode: vi.fn(), focusMode: false, onHelp: vi.fn(),
    ...over,
  };
}

describe("ToolsMenu (mobile-first tool consolidation)", () => {
  it("opens on tap and routes an item (Lenses) — the button was unreachable before", () => {
    const p = props();
    render(<ToolsMenu {...p} />);
    // Menu closed → items hidden.
    expect(screen.queryByText("Lenses")).toBeNull();
    fireEvent.click(screen.getByLabelText("Tools"));
    fireEvent.click(screen.getByText("Lenses"));
    expect(p.onLenses).toHaveBeenCalled();
    // Selecting an item closes the menu.
    expect(screen.queryByText("Lenses")).toBeNull();
  });

  it("routes the World map item — the map opens from the Tools popup menu (Q1)", () => {
    const p = props();
    render(<ToolsMenu {...p} />);
    fireEvent.click(screen.getByLabelText("Tools"));
    fireEvent.click(screen.getByText("World map"));
    expect(p.onWorldMap).toHaveBeenCalled();
    expect(screen.queryByText("World map")).toBeNull();
  });

  it("shows a combined alert badge for pending connections + due recalls", () => {
    const { container } = render(<ToolsMenu {...props({ candCount: 2, dueCount: 3 })} />);
    expect(container.querySelector(".fab-badge")?.textContent).toBe("5");
  });

  it("uses the same cap for the aggregate FAB badge and a per-item badge", () => {
    const { container } = render(<ToolsMenu {...props({ candCount: 20, dueCount: 0 })} />);
    // Aggregate (20) and the Connections item badge (20) must read identically —
    // they used to cap at 9+ and 99+ respectively.
    expect(container.querySelector(".fab-badge")?.textContent).toBe("9+");
    fireEvent.click(screen.getByLabelText("Tools"));
    const connectionsBadge = screen.getByText("Connections").parentElement?.querySelector(".tools-badge");
    expect(connectionsBadge?.textContent).toBe("9+");
  });

  it("breaks down the alert count in the FAB's title instead of a bare label", () => {
    render(<ToolsMenu {...props({ candCount: 2, dueCount: 3 })} />);
    const title = screen.getByLabelText("Tools").getAttribute("title") ?? "";
    expect(title).toContain("2 connection suggestion");
    expect(title).toContain("3 recall");
  });
});
