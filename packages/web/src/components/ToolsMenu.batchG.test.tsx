import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ToolsMenu, type ToolsMenuProps } from "./ToolsMenu.js";

// Batch G, REG-196 (RC-03): an unknown due count (server unreachable) must
// never render as 0 — the Recall row shows "?" and says the count is unknown.
const props = (over: Partial<ToolsMenuProps> = {}): ToolsMenuProps => ({
  onSearch: vi.fn(),
  onLenses: vi.fn(),
  onConnections: vi.fn(),
  candCount: 0,
  onReview: vi.fn(),
  dueCount: 0,
  onTimeline: vi.fn(),
  onLegend: vi.fn(),
  onWorldMap: vi.fn(),
  onFlashback: vi.fn(),
  onFocusMode: vi.fn(),
  focusMode: false,
  onHelp: vi.fn(),
  ...over,
});

function openMenu(p: ToolsMenuProps) {
  const r = render(<ToolsMenu {...p} />);
  fireEvent.click(screen.getByLabelText("Tools"));
  return r;
}

describe("ToolsMenu — unknown counts (REG-196)", () => {
  it("an unknown due count shows '?' on the Recall row, not 0 and not a bare row", () => {
    openMenu(props({ dueCount: null }));
    expect(screen.getByText("Recall")).toBeTruthy();
    expect(screen.getByText("?")).toBeTruthy();
    cleanup();
  });

  it("the Tools button title says the recall count is unknown instead of claiming 0 due", () => {
    render(<ToolsMenu {...props({ dueCount: null, candCount: 2 })} />);
    const btn = screen.getByLabelText("Tools");
    expect(btn.getAttribute("title")).toContain("unknown");
    expect(btn.getAttribute("title")).not.toContain("0 recalls due");
    cleanup();
  });

  it("a known due count still renders its number", () => {
    openMenu(props({ dueCount: 3 }));
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByText("?")).toBeNull();
    cleanup();
  });

  it("both counts unknown shows '?' on the FAB badge (Batch H F1 — never a false zero-alert)", () => {
    render(<ToolsMenu {...props({ dueCount: null, candCount: null })} />);
    const badge = document.querySelector(".fab-badge");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe("?");
    cleanup();
  });
});
