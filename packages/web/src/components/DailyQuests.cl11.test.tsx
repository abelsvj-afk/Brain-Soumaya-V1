import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { GraphData } from "@brain/shared";
import { DailyQuests } from "./DailyQuests.js";

/**
 * IM-90: the daily tending quests surface in Progress with their actions
 * wired — capture opens ingest, a focus quest flies to its memory.
 */
const graph = {
  nodes: [
    {
      id: 7,
      label: "An old note",
      kind: "memory",
      type: "daily",
      content: "x",
      importance: 0.5,
      celestial: "asteroid",
      degree: 0, // drifting (unlinked)
      entropy: 0.9, // cooling
      emotionalWeight: 0,
      createdAt: "2026-10-01T12:00:00.000Z",
    },
  ],
  links: [],
} as unknown as GraphData;

afterEach(() => cleanup());

describe("IM-90 — DailyQuests in Progress", () => {
  it("renders the log / warm / revisit quests", () => {
    const { getByText } = render(
      <DailyQuests graph={graph} fedToday={false} onFocus={() => {}} onCapture={() => {}} />,
    );
    expect(getByText(/Log a memory today/)).toBeTruthy();
    expect(getByText(/Warm a cooling memory/)).toBeTruthy();
    expect(getByText(/Revisit a drifting memory/)).toBeTruthy();
  });

  it("wires the actions: capture opens ingest, warm flies to the memory", () => {
    const onCapture = vi.fn();
    const onFocus = vi.fn();
    const { getByText } = render(
      <DailyQuests graph={graph} fedToday={false} onFocus={onFocus} onCapture={onCapture} />,
    );
    fireEvent.click(getByText(/Log a memory today/));
    expect(onCapture).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText(/Warm a cooling memory/));
    expect(onFocus).toHaveBeenCalledWith(7);
  });

  it("the fed-today quest reads done and its capture action is disabled", () => {
    const { getByText } = render(
      <DailyQuests graph={graph} fedToday={true} onFocus={() => {}} onCapture={() => {}} />,
    );
    const btn = getByText(/Fed your brain today/).closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
