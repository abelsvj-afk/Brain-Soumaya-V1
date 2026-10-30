import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GardenObjective, type GardenObjectiveProps } from "./GardenObjective.js";
import { EMPTY_GUIDE } from "../graph/gardenGuide.js";

const props = (over: Partial<GardenObjectiveProps> = {}): GardenObjectiveProps => ({
  objective: { kind: "plots", text: "Tap a plot to tend it." },
  carrying: false,
  onDrop: vi.fn(),
  walkingTo: null,
  onStop: vi.fn(),
  result: null,
  guide: EMPTY_GUIDE,
  onDismissGuide: vi.fn(),
  day: { tends: 0, places: 0, recalls: 0 },
  ...over,
});

describe("GardenObjective", () => {
  it("states the next step, the guide and the day", () => {
    render(<GardenObjective {...props()} />);
    expect(screen.getByText(/Tap a plot to tend it/)).toBeTruthy();
    expect(screen.getByLabelText("First visit")).toBeTruthy();
    expect(screen.getByText(/Today 0\/3/)).toBeTruthy();
  });
  it("shows Drop only while carrying, and Drop works", () => {
    const p = props({ carrying: true, objective: { kind: "carrying", text: "Carrying “x”." } });
    render(<GardenObjective {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Drop" }));
    expect(p.onDrop).toHaveBeenCalled();
  });
  it("walking shows the destination and Stop", () => {
    const p = props({ walkingTo: "Run a 10k" });
    render(<GardenObjective {...p} />);
    expect(screen.getByText(/Walking to Run a 10k/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(p.onStop).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Drop" })).toBeNull();
  });
  it("shows the last result, and hides a dismissed guide", () => {
    render(<GardenObjective {...props({ result: "Tended “a”.", guide: { ...EMPTY_GUIDE, dismissed: true } })} />);
    expect(screen.getByText(/Tended “a”/)).toBeTruthy();
    expect(screen.queryByLabelText("First visit")).toBeNull();
  });
  it("marks finished beats in words, not colour alone", () => {
    render(<GardenObjective {...props({ day: { tends: 3, places: 1, recalls: 1 } })} />);
    expect(screen.getByText(/Today 3\/3/)).toBeTruthy();
    expect(screen.getAllByText(/✓ (Tend|Place|Recall)/).length).toBeGreaterThan(0);
  });
});
