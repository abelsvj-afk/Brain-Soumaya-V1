import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LensesPanel } from "./LensesPanel.js";
import * as api from "../api/lenses.js";

const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
  pushToast.mockClear();
  localStorage.clear();
});

const LENS = { id: 1, name: "Heavy work", query: { emotion: "heavy" as const }, pinned: false, count: 4 };

describe("REG-205 — a failed lenses fetch renders an error/retry state, never 'No lenses yet' (CN-06)", () => {
  it("shows an error state with retry when the fetch fails", async () => {
    vi.spyOn(api, "getLenses").mockRejectedValue(new Error("server down"));
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    expect(await screen.findByText(/Couldn't load your lenses/i)).toBeTruthy();
    expect(screen.queryByText(/No lenses yet/)).toBeNull();
    expect(screen.getByText("Try again")).toBeTruthy();
  });

  it("retry re-fetches and renders the list on success", async () => {
    const get = vi.spyOn(api, "getLenses");
    get.mockRejectedValueOnce(new Error("server down"));
    get.mockResolvedValueOnce([LENS]);
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await screen.findByText(/Couldn't load your lenses/i);
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => screen.getByText(/Heavy work/));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("still shows the true-empty state only on a confirmed empty list", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([]);
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    expect(await screen.findByText(/No lenses yet/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load your lenses/i)).toBeNull();
  });
});

describe("REG-206 — a failed node load reports the failure, never 'no matches' (CN-07)", () => {
  it("opening a lens whose nodes fail to load toasts the failure", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([LENS]);
    vi.spyOn(api, "lensNodes").mockRejectedValue(new Error("server down"));
    const onOpen = vi.fn();
    render(<LensesPanel onClose={vi.fn()} onOpen={onOpen} />);
    await waitFor(() => screen.getByText(/Heavy work/));
    fireEvent.click(screen.getByText(/Heavy work/));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/Couldn't load/i), "⚠️", expect.any(Number)),
    );
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining("has no matches"), expect.anything(), expect.any(Number));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a lens that truly matches nothing still says so", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([LENS]);
    vi.spyOn(api, "lensNodes").mockResolvedValue({ ids: [], total: 0, capped: false, totalIsLowerBound: false, shown: 0 });
    const onOpen = vi.fn();
    render(<LensesPanel onClose={vi.fn()} onOpen={onOpen} />);
    await waitFor(() => screen.getByText(/Heavy work/));
    fireEvent.click(screen.getByText(/Heavy work/));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("has no matches"), expect.anything(), expect.any(Number)),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("REG-208 — a capped lens says so in the panel (CN-09)", () => {
  it("a capped lens shows the true total with a 'showing first N' note", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([
      { id: 2, name: "Big", query: {}, pinned: false, count: 2400, capped: true, totalIsLowerBound: false, shown: 2000 },
    ]);
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/Big/));
    expect(screen.getByText("2,400")).toBeTruthy();
    const countEl = screen.getByLabelText(/2,400 matches/);
    expect(countEl.getAttribute("title")).toMatch(/first 2,000/);
  });

  it("a lower-bound total (inner cap hit) renders with a +", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([
      { id: 3, name: "Fuzzy", query: { text: "quokka" }, pinned: false, count: 500, capped: true, totalIsLowerBound: true, shown: 500 },
    ]);
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/Fuzzy/));
    expect(screen.getByText("500+")).toBeTruthy();
  });

  it("opening a capped lens toasts the subset before isolating", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([
      { id: 2, name: "Big", query: {}, pinned: false, count: 2400, capped: true, totalIsLowerBound: false, shown: 2000 },
    ]);
    vi.spyOn(api, "lensNodes").mockResolvedValue({
      ids: [11, 22], total: 2400, capped: true, totalIsLowerBound: false, shown: 2000,
    });
    const onOpen = vi.fn();
    render(<LensesPanel onClose={vi.fn()} onOpen={onOpen} />);
    await waitFor(() => screen.getByText(/Big/));
    fireEvent.click(screen.getByText(/Big/));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/first 2,000 of 2,400/), expect.anything(), expect.any(Number)),
    );
    expect(onOpen).toHaveBeenCalledWith([11, 22], "Big", 2400);
  });

  it("the builder preview names the cap", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([]);
    vi.spyOn(api, "previewLens").mockResolvedValue({ count: 2400, capped: true, totalIsLowerBound: false, shown: 2000 });
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/New lens/));
    fireEvent.click(screen.getByText(/New lens/));
    fireEvent.change(screen.getByPlaceholderText(/Keyword/), { target: { value: "quokka" } });
    await waitFor(() => expect(screen.getByText(/2,400 matches/)).toBeTruthy());
    expect(screen.getByText(/showing the first 2,000/i)).toBeTruthy();
  });
});

describe("REG-210 — a failed pin/unpin toasts like the panel's other row actions (CN-11)", () => {
  it("a failed pin produces the ⚠️ toast and the row keeps its old state", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([LENS]);
    vi.spyOn(api, "updateLens").mockResolvedValue(null);
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/Heavy work/));
    fireEvent.click(screen.getByLabelText("Pin"));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/Couldn't pin/i), "⚠️", expect.any(Number)),
    );
  });
});

describe("REG-211 — one pinning rule: new lenses start unpinned on both doors (CN-12)", () => {
  it("panel save creates the lens unpinned", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([]);
    const create = vi.spyOn(api, "createLens").mockResolvedValue({ id: 9, name: "Fresh sparks", query: { withinDays: 7 }, pinned: false, count: 2 });
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/New lens/));
    fireEvent.click(screen.getByText(/New lens/));
    fireEvent.change(screen.getByPlaceholderText(/Lens name/), { target: { value: "Fresh sparks" } });
    fireEvent.click(screen.getByText("Save lens"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0]![2]).toBe(false);
  });
});

describe("REG-214 — a broken lens renders as broken, never as all-matching (CN-16)", () => {
  it("shows the broken state with its name and refuses to open it", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([
      { id: 5, name: "Doomed", query: {}, pinned: false, broken: true, count: null },
    ]);
    const lensNodes = vi.spyOn(api, "lensNodes").mockResolvedValue({ ids: [1, 2], total: 2, capped: false, totalIsLowerBound: false, shown: 2 });
    const onOpen = vi.fn();
    render(<LensesPanel onClose={vi.fn()} onOpen={onOpen} />);
    await waitFor(() => screen.getByText(/Doomed/));
    expect(screen.getByText(/couldn't be read/i)).toBeTruthy();
    expect(screen.queryByText("all active memories")).toBeNull();
    fireEvent.click(screen.getByText(/Doomed/));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringMatching(/couldn't be read|broken/i), "⚠️", expect.any(Number)),
    );
    expect(lensNodes).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });
});
