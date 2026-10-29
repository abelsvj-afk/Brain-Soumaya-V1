import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { GraphNode } from "@brain/shared";

vi.mock("../api/client.js", () => ({
  askChat: vi.fn(),
  deleteNode: vi.fn(),
  ingestText: vi.fn(),
}));
vi.mock("../api/journeys.js", () => ({ linkToJourney: vi.fn() }));

import { askChat, deleteNode, ingestText } from "../api/client.js";
import { linkToJourney } from "../api/journeys.js";
import { GardenGroveSheet, PLANTED_STEP_TTL_HOURS } from "./GardenGroveSheet.js";
import type { GardenGrove } from "../graph/gardenLayout.js";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const grove: GardenGrove = {
  journeyId: 5,
  title: "Run a 10k",
  icon: "🏃",
  status: "active",
  terrace: 2,
  x: 0,
  y: 36,
  z: 0,
  radius: 52,
  missionsCompleted: 2,
  unshown: 0,
};
const node = (id: number, label: string, kind?: GraphNode["kind"]) =>
  ({ id, label, kind, type: "memory", content: "", createdAt: "2026-10-01T00:00:00.000Z" }) as GraphNode;

function mount(over: Partial<Parameters<typeof GardenGroveSheet>[0]> = {}) {
  const props = {
    grove,
    missions: [node(1, "Sign up for the race", "action")],
    memories: [node(2, "Ran 3 miles")],
    carrying: null,
    onClose: vi.fn(),
    onChanged: vi.fn(),
    onPlaced: vi.fn(),
    ...over,
  };
  render(<GardenGroveSheet {...props} />);
  return props;
}

describe("GardenGroveSheet", () => {
  it("names the grove, its state in words, and what rests in it", () => {
    mount({ grove: { ...grove, status: "paused" } });
    expect(screen.getByRole("dialog", { name: "Run a 10k grove" })).toBeTruthy();
    expect(screen.getByText(/Resting under mist · 2 missions done/)).toBeTruthy();
    expect(screen.getByText("Sign up for the race")).toBeTruthy();
    expect(screen.getByText("Ran 3 miles")).toBeTruthy();
  });

  it("✓ Done completes the mission through the app's own delete, says the tree grew, and re-reads the brain", async () => {
    vi.mocked(deleteNode).mockResolvedValue({ journeyProgress: [{ journeyId: 5, title: "Run a 10k", progress: 0.3, missionsCompleted: 3 }] });
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "✓ Done" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/tree grows \(3 done\)/));
    expect(deleteNode).toHaveBeenCalledWith(1);
    expect(p.onChanged).toHaveBeenCalled();
    expect(screen.queryByText("Sign up for the race")).toBeNull();
  });

  it("Plant creates a 30-day action item and links it to this Journey as a task", async () => {
    vi.mocked(ingestText).mockResolvedValue({ nodes: [node(9, "Buy a race bib", "action")], extractedEdges: [], associativeEdges: [] });
    vi.mocked(linkToJourney).mockResolvedValue({} as never);
    const p = mount();
    fireEvent.change(screen.getByLabelText("Next step"), { target: { value: "Buy a race bib" } });
    fireEvent.click(screen.getByRole("button", { name: "Plant" }));
    await waitFor(() => expect(linkToJourney).toHaveBeenCalledWith(5, "task", 9));
    expect(ingestText).toHaveBeenCalledWith("Buy a race bib", { kind: "action", ttlHours: PLANTED_STEP_TTL_HOURS });
    expect(PLANTED_STEP_TTL_HOURS).toBe(720);
    expect(p.onChanged).toHaveBeenCalledWith([9]);
  });

  it("a carried memory can be placed here — it links to this Journey", async () => {
    vi.mocked(linkToJourney).mockResolvedValue({} as never);
    const p = mount({ carrying: node(4, "Coffee with Maya") });
    fireEvent.click(screen.getByRole("button", { name: "Place it in Run a 10k" }));
    await waitFor(() => expect(p.onPlaced).toHaveBeenCalled());
    expect(linkToJourney).toHaveBeenCalledWith(5, "node", 4);
  });

  it("Ask sends the question scoped to this Journey and shows her answer", async () => {
    vi.mocked(askChat).mockResolvedValue({ answer: "Sign up first.", citations: [], contextIds: [] });
    mount();
    fireEvent.change(screen.getByLabelText("Ask Soumaya about Run a 10k"), { target: { value: "What next?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(screen.getByText("Sign up first.")).toBeTruthy());
    expect(askChat).toHaveBeenCalledWith("What next?", [], 5);
  });

  it("a failed save says so and keeps the words — nothing is lost", async () => {
    vi.mocked(ingestText).mockRejectedValue(new Error("offline"));
    mount();
    fireEvent.change(screen.getByLabelText("Next step"), { target: { value: "Stretch" } });
    fireEvent.click(screen.getByRole("button", { name: "Plant" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("offline"));
    expect((screen.getByLabelText("Next step") as HTMLInputElement).value).toBe("Stretch");
  });
});
