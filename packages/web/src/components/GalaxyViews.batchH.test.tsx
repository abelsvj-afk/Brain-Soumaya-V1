import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { GalaxyViews } from "./GalaxyViews.js";
import * as viewsApi from "../api/views.js";
import * as lensesApi from "../api/lenses.js";
import type { GraphNode } from "@brain/shared";

vi.mock("../api/finance.js", () => ({ getMoneySky: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/journeys.js", () => ({ getJourneys: vi.fn().mockResolvedValue([]) }));
vi.mock("../api/client.js", () => ({ getSpaceId: () => "test-space" }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

afterEach(cleanup);
beforeEach(() => {
  vi.restoreAllMocks();
  pushToast.mockClear();
  localStorage.clear();
  vi.spyOn(viewsApi, "getCategoryCounts").mockResolvedValue({
    people: 0, projects: 0, goals: 0, ideas: 0, beliefs: 0, knowledge: 0, meetings: 0, notes: 0,
  });
  vi.spyOn(viewsApi, "getCategoryIds").mockResolvedValue([]);
  vi.spyOn(lensesApi, "getLenses").mockResolvedValue([]);
  vi.spyOn(lensesApi, "lensNodes").mockResolvedValue({ ids: [], total: 0, capped: false, totalIsLowerBound: false, shown: 0 });
});

const personNode = (id: number): GraphNode =>
  ({ id, label: `Person ${id}`, type: "person", kind: null, content: "", createdAt: "2026-10-20T00:00:00Z" }) as unknown as GraphNode;

const EMPTY_COUNTS = { people: 0, projects: 0, goals: 0, ideas: 0, beliefs: 0, knowledge: 0, meetings: 0, notes: 0 };

describe("REG-207 — a category with members never disappears from Views (CN-08)", () => {
  it("renders a category whose members all sit off-payload, with its true count", async () => {
    vi.spyOn(viewsApi, "getCategoryCounts").mockResolvedValue({ ...EMPTY_COUNTS, people: 3 });
    render(<GalaxyViews nodes={[]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} hidden={false} />);
    // The People chip is there with the full-set count, even though the
    // loaded payload holds no people at all.
    await waitFor(() => screen.getByText(/People/));
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("shows the true count (not the payload count) when only some members are loaded", async () => {
    vi.spyOn(viewsApi, "getCategoryCounts").mockResolvedValue({ ...EMPTY_COUNTS, people: 3 });
    render(<GalaxyViews nodes={[personNode(7)]} activeView={null} onOpen={vi.fn()} onExit={vi.fn()} hidden={false} />);
    await waitFor(() => screen.getByText(/People/));
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByText("1")).toBeNull();
  });

  it("tapping an off-payload category fetches its full id list, then isolates", async () => {
    vi.spyOn(viewsApi, "getCategoryCounts").mockResolvedValue({ ...EMPTY_COUNTS, people: 3 });
    const getIds = vi.spyOn(viewsApi, "getCategoryIds").mockResolvedValue([7, 8, 9]);
    const onOpen = vi.fn();
    render(<GalaxyViews nodes={[]} activeView={null} onOpen={onOpen} onExit={vi.fn()} hidden={false} />);
    await waitFor(() => screen.getByText(/People/));
    fireEvent.click(screen.getByText(/People/));
    await waitFor(() => expect(getIds).toHaveBeenCalledWith("people"));
    expect(onOpen).toHaveBeenCalledWith([7, 8, 9], "👤 People", 3);
  });

  it("tapping a fully-loaded category isolates without an extra fetch", async () => {
    vi.spyOn(viewsApi, "getCategoryCounts").mockResolvedValue({ ...EMPTY_COUNTS, people: 1 });
    const getIds = vi.spyOn(viewsApi, "getCategoryIds");
    const onOpen = vi.fn();
    render(<GalaxyViews nodes={[personNode(7)]} activeView={null} onOpen={onOpen} onExit={vi.fn()} hidden={false} />);
    await waitFor(() => screen.getByText(/People/));
    fireEvent.click(screen.getByText(/People/));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith([7], "👤 People", 1));
    expect(getIds).not.toHaveBeenCalled();
  });
});

describe("REG-209 — 'Save as Lens' from Views is a creation door (CN-10)", () => {
  it("saves the active category as an unpinned lens via createLens", async () => {
    vi.spyOn(viewsApi, "getCategoryCounts").mockResolvedValue({ ...EMPTY_COUNTS, people: 1 });
    const create = vi.spyOn(lensesApi, "createLens").mockResolvedValue({
      id: 9, name: "People", query: { kinds: ["person"] }, pinned: false, count: 1,
    });
    render(<GalaxyViews nodes={[personNode(7)]} activeView={"👤 People"} onOpen={vi.fn()} onExit={vi.fn()} hidden={false} />);
    await waitFor(() => screen.getByText(/Save as Lens/));
    fireEvent.click(screen.getByText(/Save as Lens/));
    await waitFor(() => expect(create).toHaveBeenCalledWith("People", { kinds: ["person"] }, false));
  });
});
