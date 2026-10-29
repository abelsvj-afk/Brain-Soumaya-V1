import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ToolsMenu } from "./ToolsMenu.js";

afterEach(cleanup);

const BASE = {
  onSearch: vi.fn(),
  onLenses: vi.fn(),
  onConnections: vi.fn(),
  onReview: vi.fn(),
  onTimeline: vi.fn(),
  onLegend: vi.fn(),
  onWorldMap: vi.fn(),
  onFlashback: vi.fn(),
  onFocusMode: vi.fn(),
  focusMode: false,
  onHelp: vi.fn(),
};

describe("REG-201 — an unknown count never presents as 0 (CN-02)", () => {
  it("renders '?' on the Connections item when its count is unknown (null)", () => {
    render(<ToolsMenu {...BASE} candCount={null} dueCount={3} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const item = screen.getByRole("menuitem", { name: /Connections/ });
    expect(item.textContent).toContain("?");
    expect(item.textContent).not.toContain("0");
  });

  it("renders '?' on the Recall item when its count is unknown (null)", () => {
    render(<ToolsMenu {...BASE} candCount={2} dueCount={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const item = screen.getByRole("menuitem", { name: /Recall/ });
    expect(item.textContent).toContain("?");
  });

  it("still renders real counts and the 9+ cap", () => {
    render(<ToolsMenu {...BASE} candCount={12} dueCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    expect(screen.getByRole("menuitem", { name: /Connections/ }).textContent).toContain("9+");
  });
});

describe("REG-201 F1 — the closed FAB never reads as a total while a count is unknown (G review)", () => {
  it("both counts unknown: the closed FAB shows '?' instead of no badge", () => {
    const { container } = render(<ToolsMenu {...BASE} candCount={null} dueCount={null} />);
    const badge = container.querySelector(".fab-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("?");
  });

  it("one count unknown: the closed FAB shows '?' instead of the known partial", () => {
    const { container } = render(<ToolsMenu {...BASE} candCount={null} dueCount={3} />);
    const badge = container.querySelector(".fab-badge");
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toBe("?");
    expect(badge!.textContent).not.toBe("3");
  });

  it("both counts known: the closed FAB still shows the true total", () => {
    const { container } = render(<ToolsMenu {...BASE} candCount={2} dueCount={3} />);
    expect(container.querySelector(".fab-badge")!.textContent).toBe("5");
  });

  it("both counts known and zero: the closed FAB still shows no badge", () => {
    const { container } = render(<ToolsMenu {...BASE} candCount={0} dueCount={0} />);
    expect(container.querySelector(".fab-badge")).toBeNull();
  });
});
