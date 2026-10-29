import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NavRail } from "./NavRail.js";

afterEach(cleanup);

describe("NavRail (frequent nav controls)", () => {
  it("routes each control to its callback", () => {
    const p = { onSearch: vi.fn(), onDock: vi.fn(), onRecenter: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn() };
    render(<NavRail {...p} />);
    fireEvent.click(screen.getByLabelText("Search your memories"));
    expect(p.onSearch).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Panels"));
    fireEvent.click(screen.getByLabelText("Recenter galaxy"));
    fireEvent.click(screen.getByLabelText("Zoom in"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(p.onDock).toHaveBeenCalled();
    expect(p.onRecenter).toHaveBeenCalled();
    expect(p.onZoomIn).toHaveBeenCalled();
    expect(p.onZoomOut).toHaveBeenCalled();
  });
});
