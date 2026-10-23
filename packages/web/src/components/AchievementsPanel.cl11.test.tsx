import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import type { GraphData } from "@brain/shared";
import { AchievementsPanel } from "./AchievementsPanel.js";

/**
 * CL-11 panel behaviour: IM-94 (Pathfinder earnable in-panel), IM-92
 * (earned dates with the legacy honesty rule, filter, closest-first sort,
 * drill-in), IM-95 (fuel economy visible in Progress).
 */
const node = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  label: `m${id}`,
  kind: "memory",
  type: "daily",
  content: "x",
  importance: 0.5,
  celestial: "asteroid",
  degree: 0,
  entropy: 0,
  emotionalWeight: 0,
  createdAt: "2026-10-01T12:00:00.000Z",
  ...extra,
});

const graphOf = (nodes: unknown[], links: unknown[]): GraphData =>
  ({ nodes, links }) as unknown as GraphData;

/** A chain 1-2-3-4-5: a simple path of five connected memories. */
const chainGraph = () =>
  graphOf(
    [1, 2, 3, 4, 5].map((i) => node(i)),
    [1, 2, 3, 4].map((i) => ({ id: i, source: i, target: i + 1, relationship: "related", weight: 0.5, createdAt: "2026-10-01T12:00:00.000Z" })),
  );

const cardFor = (root: HTMLElement, name: string): HTMLElement => {
  const btn = [...root.querySelectorAll(".award-name")].find((el) => el.textContent?.includes(name));
  if (!btn) throw new Error(`no award card named ${name}`);
  return btn.closest("li") as HTMLElement;
};

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe("IM-94 — Pathfinder Quest can satisfy inside the panel", () => {
  it("shows Pathfinder Quest as earned for a 5-memory chain", () => {
    const { container } = render(
      <AchievementsPanel graph={chainGraph()} fuel={null} streak={null} spaceId="s1" />,
    );
    expect(cardFor(container, "Pathfinder Quest").className).toContain("got");
  });

  it("stays locked when the chain is only 4 long", () => {
    const g = graphOf(
      [1, 2, 3, 4].map((i) => node(i)),
      [1, 2, 3].map((i) => ({ id: i, source: i, target: i + 1, relationship: "related", weight: 0.5, createdAt: "2026-10-01T12:00:00.000Z" })),
    );
    const { container } = render(<AchievementsPanel graph={g} fuel={null} streak={null} spaceId="s1" />);
    expect(cardFor(container, "Pathfinder Quest").className).toContain("locked");
  });
});

describe("IM-92 — earned dates, honestly", () => {
  it("a legacy earned entry drills in with NO date (never an invented one)", () => {
    localStorage.setItem("brain.achv.s1", JSON.stringify(["connector"]));
    const { container } = render(
      <AchievementsPanel graph={graphOf([], [])} fuel={null} streak={null} spaceId="s1" />,
    );
    const card = cardFor(container, "Connector");
    expect(card.className).toContain("got");
    fireEvent.click(card.querySelector(".award-name")!);
    expect(card.textContent).toMatch(/date wasn.t recorded/i);
    expect(card.textContent).not.toMatch(/Earned on/);
  });

  it("a timestamped earned entry shows its real earned-on date", () => {
    localStorage.setItem("brain.achv.s1", JSON.stringify({ connector: "2026-10-03T12:00:00.000Z" }));
    const { container } = render(
      <AchievementsPanel graph={graphOf([], [])} fuel={null} streak={null} spaceId="s1" />,
    );
    const card = cardFor(container, "Connector");
    fireEvent.click(card.querySelector(".award-name")!);
    // Zone-derived expectation: earned-on renders the viewer-local calendar
    // date of the stored UTC instant (noon UTC = Oct 3 in New York, Oct 4 in
    // Kiritimati) — derive it the same way formatEarnedDate does.
    const earned = new Date("2026-10-03T12:00:00.000Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    expect(card.textContent).toContain(`Earned on ${earned}`);
  });

  it("a locked card's drill-in states the distance left", () => {
    const g = graphOf([node(1)], [{ id: 1, source: 1, target: 1, relationship: "related", weight: 0.5, createdAt: "2026-10-01T12:00:00.000Z" }]);
    // 1 link of the 25 Connector needs.
    const { container } = render(<AchievementsPanel graph={g} fuel={null} streak={null} spaceId="s1" />);
    const card = cardFor(container, "Connector");
    fireEvent.click(card.querySelector(".award-name")!);
    expect(card.textContent).toMatch(/1 of 25 — 24 to go/);
  });
});

describe("IM-92 — filter + closest-to-unlocking sort", () => {
  it("Closest first puts the nearest locked award ahead of a distant one", () => {
    // 24 links: Connector is 24/25 (96%); Nexus needs a degree-8 memory (0/8).
    const links = Array.from({ length: 24 }, (_, i) => ({
      id: i, source: 1, target: 2, relationship: "related", weight: 0.5, createdAt: "2026-10-01T12:00:00.000Z",
    }));
    const { container, getByText } = render(
      <AchievementsPanel graph={graphOf([node(1), node(2)], links)} fuel={null} streak={null} spaceId="s1" />,
    );
    fireEvent.click(getByText(/Closest first/));
    const names = [...container.querySelectorAll(".award-name")].map((el) => el.textContent ?? "");
    const ci = names.findIndex((t) => t.includes("Connector"));
    const ni = names.findIndex((t) => t.includes("Nexus"));
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(ni).toBeGreaterThan(ci);
  });

  it("the Earned filter hides locked cards", () => {
    localStorage.setItem("brain.achv.s1", JSON.stringify(["connector"]));
    const { container, getByText } = render(
      <AchievementsPanel graph={graphOf([], [])} fuel={null} streak={null} spaceId="s1" />,
    );
    fireEvent.click(getByText("Earned", { selector: "button" }));
    const names = [...container.querySelectorAll(".award-name")].map((el) => el.textContent ?? "");
    expect(names.some((t) => t.includes("Connector"))).toBe(true);
    expect(names.some((t) => t.includes("Nexus"))).toBe(false);
  });
});

describe("IM-95 — fuel economy is visible in Progress", () => {
  it("renders the fuel balance and per-job cost", () => {
    const { container } = render(
      <AchievementsPanel
        graph={graphOf([], [])}
        fuel={{ fuel: 42, capacity: 100, jobCost: 3, warpCost: 10 }}
        streak={null}
        spaceId="s1"
      />,
    );
    const banner = container.querySelector(".fuel-banner");
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/42/);
    expect(banner!.textContent).toMatch(/100 fuel/);
    expect(banner!.textContent).toMatch(/costs 3/);
  });
});
