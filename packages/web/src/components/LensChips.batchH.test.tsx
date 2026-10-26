import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LensChips } from "./LensChips.js";
import * as api from "../api/lenses.js";

const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
  pushToast.mockClear();
});

const PINNED = { id: 1, name: "Heavy work", query: { emotion: "heavy" as const }, pinned: true, count: 4 };

describe("REG-205 — pinned chips fail honestly, not silently (CN-06)", () => {
  it("a failed pinned-list fetch renders an error row with retry, not nothing", async () => {
    vi.spyOn(api, "getLenses").mockRejectedValue(new Error("server down"));
    render(<LensChips activeLens={null} onOpen={vi.fn()} onExit={vi.fn()} hidden={false} />);
    expect(await screen.findByText(/Couldn't load pinned lenses/i)).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("retry re-fetches and renders the chips on success", async () => {
    const get = vi.spyOn(api, "getLenses");
    get.mockRejectedValueOnce(new Error("server down"));
    get.mockResolvedValueOnce([PINNED]);
    render(<LensChips activeLens={null} onOpen={vi.fn()} onExit={vi.fn()} hidden={false} />);
    await screen.findByText(/Couldn't load pinned lenses/i);
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => screen.getByText(/Heavy work/));
    expect(get).toHaveBeenCalledTimes(2);
  });
});

describe("REG-206 — a failed node load from a chip reports the failure (CN-07)", () => {
  it("tapping a pinned lens whose nodes fail to load toasts the failure", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([PINNED]);
    vi.spyOn(api, "lensNodes").mockRejectedValue(new Error("server down"));
    const onOpen = vi.fn();
    render(<LensChips activeLens={null} onOpen={onOpen} onExit={vi.fn()} hidden={false} />);
    await waitFor(() => screen.getByText(/Heavy work/));
    fireEvent.click(screen.getByText(/Heavy work/));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/Couldn't load/i), "⚠️", expect.any(Number)),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a capped lens tapped from a chip toasts the subset before isolating", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([
      { id: 2, name: "Big", query: {}, pinned: true, count: 2400, capped: true, totalIsLowerBound: false, shown: 2000 },
    ]);
    vi.spyOn(api, "lensNodes").mockResolvedValue({
      ids: [11, 22], total: 2400, capped: true, totalIsLowerBound: false, shown: 2000,
    });
    const onOpen = vi.fn();
    render(<LensChips activeLens={null} onOpen={onOpen} onExit={vi.fn()} hidden={false} />);
    await waitFor(() => screen.getByText(/Big/));
    fireEvent.click(screen.getByText(/Big/));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/first 2,000 of 2,400/), expect.anything(), expect.any(Number)),
    );
    expect(onOpen).toHaveBeenCalledWith([11, 22], "Big", 2400);
  });
});
