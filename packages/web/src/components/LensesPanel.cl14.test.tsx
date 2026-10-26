import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LensesPanel } from "./LensesPanel.js";
import * as api from "../api/lenses.js";

afterEach(cleanup);
beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(api, "previewLens").mockResolvedValue({ count: 3, capped: false, totalIsLowerBound: false, shown: 3 }); });

const LENS = { id: 1, name: "Heavy work", query: { emotion: "heavy" as const, kinds: ["project"], tags: ["Work"] }, pinned: false, count: 4 };

describe("IM-118 — loading state is truthful", () => {
  it("shows Loading, not 'No lenses yet', while the fetch is in flight", () => {
    vi.spyOn(api, "getLenses").mockReturnValue(new Promise(() => {}));
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText(/Loading lenses/)).toBeTruthy();
    expect(screen.queryByText(/No lenses yet/)).toBeNull();
  });
});

describe("IM-119 — a failed delete restores the lens + toasts", () => {
  it("honours deleteLens's false result", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([LENS]);
    vi.spyOn(api, "deleteLens").mockResolvedValue(false);
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/Heavy work/));
    fireEvent.click(screen.getByTitle("Delete lens"));
    // Row comes back instead of silently resurrecting on a later refresh.
    await waitFor(() => expect(screen.getByText(/Heavy work/)).toBeTruthy());
    expect(await screen.findByText(/Heavy work/)).toBeTruthy();
  });

  it("a successful delete removes the row for good", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([LENS]);
    vi.spyOn(api, "deleteLens").mockResolvedValue(true);
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/Heavy work/));
    fireEvent.click(screen.getByTitle("Delete lens"));
    await waitFor(() => expect(screen.queryByText(/Heavy work/)).toBeNull());
  });
});

describe("IM-118 — kinds/tags controls, edit flow, live preview", () => {
  it("builds a lens with kinds + tags in the query", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([]);
    const create = vi.spyOn(api, "createLens").mockResolvedValue({ id: 9, name: "Proj", query: {}, pinned: true, count: 1 });
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/New lens/));
    fireEvent.click(screen.getByText(/New lens/));
    fireEvent.change(screen.getByPlaceholderText(/Lens name/), { target: { value: "Proj" } });
    fireEvent.click(screen.getByText("Project"));
    fireEvent.click(screen.getByText("Work"));
    fireEvent.click(screen.getByText("Save lens"));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const q = create.mock.calls[0]![1];
    expect(q.kinds).toEqual(["project"]);
    expect(q.tags).toEqual(["Work"]);
  });

  it("shows a live preview count while building", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([]);
    vi.spyOn(api, "createLens").mockResolvedValue(null);
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/New lens/));
    fireEvent.click(screen.getByText(/New lens/));
    expect(await screen.findByText(/3 matches with these settings/)).toBeTruthy();
  });

  it("editing a lens patches name+query through updateLens", async () => {
    vi.spyOn(api, "getLenses").mockResolvedValue([LENS]);
    const update = vi.spyOn(api, "updateLens").mockResolvedValue({ ...LENS, name: "Renamed" });
    render(<LensesPanel onClose={vi.fn()} onOpen={vi.fn()} />);
    await waitFor(() => screen.getByText(/Heavy work/));
    fireEvent.click(screen.getByTitle("Edit lens"));
    const nameInput = screen.getByPlaceholderText(/Lens name/) as HTMLInputElement;
    expect(nameInput.value).toBe("Heavy work");
    fireEvent.change(nameInput, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]![0]).toBe(1);
    expect(update.mock.calls[0]![1].name).toBe("Renamed");
    expect(update.mock.calls[0]![1].query?.kinds).toEqual(["project"]);
    expect(update.mock.calls[0]![1].query?.tags).toEqual(["Work"]);
  });
});
