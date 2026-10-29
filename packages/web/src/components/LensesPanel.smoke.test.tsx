import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LensesPanel } from "./LensesPanel.js";
import * as api from "../api/lenses.js";

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());

describe("LensesPanel", () => {
  it("lists saved lenses with their live counts and opens one (isolate)", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([
      { id: 1, name: "Heavy work", query: { emotion: "heavy" }, pinned: true, count: 4 },
    ]);
    vi.spyOn(api, "lensNodes").mockResolvedValue({ ids: [11, 22, 33], total: 3, capped: false, totalIsLowerBound: false, shown: 3 });
    const onOpen = vi.fn();
    const onClose = vi.fn();

    render(<LensesPanel onClose={onClose} onOpen={onOpen} />);
    await waitFor(() => screen.getByText(/Heavy work/));
    expect(screen.getByText("4")).toBeTruthy(); // live count

    fireEvent.click(screen.getByText(/Heavy work/));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith([11, 22, 33], "Heavy work", 3));
    expect(onClose).toHaveBeenCalled();
  });

  it("builds and saves a lens from the dropdowns", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([]);
    const create = vi.spyOn(api, "createLens").mockResolvedValue({ id: 9, name: "Fresh sparks", query: { withinDays: 7 }, pinned: true, count: 2 });

    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/New lens/));
    fireEvent.click(screen.getByText(/New lens/));
    fireEvent.change(screen.getByPlaceholderText(/Lens name/), { target: { value: "Fresh sparks" } });
    fireEvent.click(screen.getByText("Save lens"));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![0]).toBe("Fresh sparks");
  });

  it("confirms before a backdrop click discards unsaved builder input", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([]);
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/New lens/));
    fireEvent.click(screen.getByText(/New lens/));
    fireEvent.change(screen.getByPlaceholderText(/Lens name/), { target: { value: "In progress" } });

    let asked = false;
    (window as unknown as { confirm: () => boolean }).confirm = () => { asked = true; return false; };
    fireEvent.click(screen.getByRole("dialog"));
    expect(asked).toBe(true);
    // Declining the confirm must keep the panel open with the input intact.
    expect(screen.getByPlaceholderText(/Lens name/)).toBeTruthy();
  });

  it("does not ask when the builder has no unsaved input", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([]);
    const onClose = vi.fn();
    render(<LensesPanel onClose={onClose} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/New lens/));
    let asked = false;
    (window as unknown as { confirm: () => boolean }).confirm = () => { asked = true; return true; };
    fireEvent.click(screen.getByRole("dialog"));
    expect(asked).toBe(false);
    expect(onClose).toHaveBeenCalled();
  });

  it("guards pin/unpin against a rapid double-click on the same row", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([
      { id: 1, name: "Heavy work", query: { emotion: "heavy" }, pinned: false, count: 4 },
    ]);
    let resolvePin!: () => void;
    const update = vi.spyOn(api, "updateLens").mockReturnValue(new Promise((r) => { resolvePin = () => r({ id: 1, name: "Heavy work", query: {}, pinned: true, count: 4 }); }));
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/Heavy work/));

    const pinBtn = screen.getByTitle("Pin");
    fireEvent.click(pinBtn);
    fireEvent.click(pinBtn); // second tap while the first request is still in flight
    resolvePin();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });
});
