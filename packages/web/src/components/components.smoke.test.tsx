import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StreakEmber } from "./StreakEmber.js";
import { FuelEarnSheet } from "./FuelEarnSheet.js";
import { NodeList } from "./NodeList.js";
import { DigestPanel } from "./DigestPanel.js";
import * as clientApi from "../api/client.js";

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());

/**
 * Leaf-component render smoke tests — the first web component tests. They prove the
 * harness renders React in happy-dom and give a real safety net for refactoring these
 * (and, by pattern, other) components. WebGL-bound components (Graph3D) are out of
 * scope here and are mocked when their parents are tested.
 */

describe("StreakEmber", () => {
  it("shows the streak count + banked shields, and is hidden at zero", () => {
    const { container } = render(<StreakEmber streak={5} atRisk={false} shields={2} />);
    expect(screen.getByText("5")).toBeTruthy();
    expect(container.querySelector(".se-shields")).toBeTruthy();
  });

  it("renders nothing when there is no streak", () => {
    const { container } = render(<StreakEmber streak={0} atRisk={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("flags 'at risk' when unfed today", () => {
    const { container } = render(<StreakEmber streak={3} atRisk={true} />);
    expect(container.querySelector(".streak-ember.at-risk")).toBeTruthy();
  });
});

describe("FuelEarnSheet", () => {
  const fuel = { fuel: 40, capacity: 200, jobCost: 2 };

  it("lists the ways to earn (with the current amounts) and closes", () => {
    const onClose = vi.fn();
    render(<FuelEarnSheet fuel={fuel} onAction={vi.fn()} onClose={onClose} />);
    expect(screen.getByText("Ways to earn Fuel")).toBeTruthy();
    expect(screen.getByText("Log a memory")).toBeTruthy();
    expect(screen.getByText("+15")).toBeTruthy(); // the bumped memory reward
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("routes a 'Go' button to the right earn action", () => {
    const onAction = vi.fn();
    render(<FuelEarnSheet fuel={fuel} onAction={onAction} onClose={vi.fn()} />);
    // The first actionable row is "Log a memory" → kind "memory".
    fireEvent.click(screen.getAllByText("Go")[0]!);
    expect(onAction).toHaveBeenCalledWith("memory");
  });
});

describe("NodeList", () => {
  const mockNodes: any[] = [
    {
      id: 1,
      label: "A beautiful memory",
      content: "This is some test memory content",
      kind: "memory",
      type: "knowledge",
      occurredAt: "2026-08-05 12:00:00",
      createdAt: "2026-08-05 12:00:00",
      celestial: "asteroid",
      emotionalWeight: 0.5,
      entropy: 0.2,
      degree: 2,
      tags: ["brain", "space"],
    },
    {
      id: 2,
      label: "A chilly decision",
      content: "Decided to implement offline fallback",
      kind: "memory",
      type: "decision",
      occurredAt: "2026-08-01 10:00:00",
      createdAt: "2026-08-01 10:00:00",
      celestial: "planet",
      emotionalWeight: -0.5,
      entropy: 0.8,
      degree: 0,
      tags: ["offline"],
    },
  ];

  it("renders and groups by timeline by default, showing exact dates", async () => {
    vi.spyOn(clientApi, "getConstellations").mockResolvedValue([]);
    vi.spyOn(clientApi, "getVisitorActivity").mockResolvedValue([]);

    const onFocus = vi.fn();
    render(<NodeList nodes={mockNodes} onFocus={onFocus} />);

    // Timeline grouping displays buckets (like "Earlier this week" or "August 2026")
    // Let's assert the labels render
    expect(screen.getByText("A beautiful memory")).toBeTruthy();
    expect(screen.getByText("A chilly decision")).toBeTruthy();

    // Verify sort selector has 'most recent' selected (since sort defaults to recent)
    const select = screen.getByTitle("Sort by") as HTMLSelectElement;
    expect(select.value).toBe("recent");

    // Verify timeline button is 'on'
    const timelineBtn = screen.getByTitle("Group by when each memory happened");
    expect(timelineBtn.className).toContain("on");

    // Verify dates show exact format in title tooltip or text (showExactDate is true)
    // The element for the date is an <abbr>
    const abbrs = screen.getAllByTitle(/2026/);
    expect(abbrs.length).toBeGreaterThan(0);
  });

  it("filters by tag and triggers parent callback on tag click", async () => {
    vi.spyOn(clientApi, "getConstellations").mockResolvedValue([]);
    vi.spyOn(clientApi, "getVisitorActivity").mockResolvedValue([]);

    const onTagChange = vi.fn();
    render(<NodeList nodes={mockNodes} onFocus={vi.fn()} initialTag="space" onTagChange={onTagChange} />);

    // Only "A beautiful memory" has the tag "space", so "A chilly decision" shouldn't be rendered
    expect(screen.getByText("A beautiful memory")).toBeTruthy();
    expect(screen.queryByText("A chilly decision")).toBeNull();

    // Click the "space" tag filter to toggle it off
    const spaceBtn = screen.getByTitle(/Filter by tag #space/);
    fireEvent.click(spaceBtn);

    expect(onTagChange).toHaveBeenCalledWith(null);
  });
});

describe("DigestPanel", () => {
  it("renders with a loading shimmer skeleton, then loads data concurrently", async () => {
    vi.spyOn(clientApi, "getDigest").mockResolvedValue([]);
    vi.spyOn(clientApi, "getDailyDigest").mockResolvedValue({
      date: "2026-08-11",
      greeting: "Hello!",
      fresh: [],
      connections: [],
      expiredActions: [],
      cooling: [],
      reminders: [],
      closing: "Bye!",
    });
    vi.spyOn(clientApi, "getConstellations").mockResolvedValue([]);
    vi.spyOn(clientApi, "getEmotionalTrajectory").mockResolvedValue({
      points: [],
      trend: "steady",
      average: 0,
      volatility: 0,
      patterns: [],
      sampleSize: 0,
    });
    vi.spyOn(clientApi, "getDormant").mockResolvedValue([]);
    vi.spyOn(clientApi, "getEvolutionLinks").mockResolvedValue([]);
    vi.spyOn(clientApi, "getLifeAreas").mockResolvedValue([]);
    vi.spyOn(clientApi, "getSelfReview").mockResolvedValue([]);
    vi.spyOn(clientApi, "getDailyLog").mockResolvedValue(null);
    vi.spyOn(clientApi, "getBeliefs").mockResolvedValue([
      { id: 101, content: "You value deep connections", evidence: 5 } as any,
    ]);

    const { container } = render(<DigestPanel onFocus={vi.fn()} />);

    // Initially, it shows the loading-shimmer elements
    expect(container.querySelector(".loading-shimmer")).toBeTruthy();

    // After resolving promises, loading state disappears and content displays
    const beliefText = await screen.findByText("You value deep connections");
    expect(beliefText).toBeTruthy();
    expect(container.querySelector(".loading-shimmer")).toBeNull();
  });
});
