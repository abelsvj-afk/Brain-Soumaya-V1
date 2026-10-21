import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { LifeSeason } from "@brain/shared";
import { LifeSeasonsBand } from "./LifeSeasonsBand.js";

/**
 * Finding #4 (2026-10-21) render pins: overlapping season bands stack in
 * separate lanes (different `top`), and a too-narrow band's label appears
 * IN FULL in the legend row under the axis — never clipped inside the band.
 */

afterEach(cleanup);

function season(overrides: Partial<LifeSeason> = {}): LifeSeason {
  return {
    id: 1, chapterId: 1, label: "Recovery Era", theme: "recovery", trend: "growth",
    confidence: 0.6, periodStart: "2026-01-01T00:00:00Z", periodEnd: "2026-03-31T00:00:00Z",
    startDate: "2026-01-01", endDate: "2026-03-31", ...overrides,
  };
}

describe("LifeSeasonsBand render — lanes + legend (finding #4)", () => {
  it("overlapping bands render at different vertical offsets (separate lanes)", () => {
    const a = season({ id: 1, startDate: "2026-01-01", endDate: "2026-03-31" });
    const b = season({ id: 2, label: "Reinvention Era", startDate: "2026-02-01", endDate: "2026-04-30" });
    render(<LifeSeasonsBand seasons={[a, b]} spans={[]} />);
    const bands = screen.getAllByTestId("life-season-band");
    expect(bands).toHaveLength(2);
    expect(bands[0]!.style.top).not.toBe(bands[1]!.style.top);
    expect(new Set(bands.map((x) => x.getAttribute("data-lane"))).size).toBe(2);
  });

  it("non-overlapping bands share the top lane", () => {
    const a = season({ id: 1, startDate: "2026-01-01", endDate: "2026-03-31" });
    const b = season({ id: 2, label: "Reinvention Era", startDate: "2026-04-01", endDate: "2026-06-30" });
    render(<LifeSeasonsBand seasons={[a, b]} spans={[]} />);
    const bands = screen.getAllByTestId("life-season-band");
    expect(bands.every((x) => x.getAttribute("data-lane") === "0")).toBe(true);
    expect(bands.every((x) => x.style.top === "0px")).toBe(true);
  });

  it("a sliver band shows NO in-band label; the full label is in the legend row", () => {
    const long = season({ id: 1, label: "Recovery Era", startDate: "2026-01-01", endDate: "2026-12-31" });
    const sliver = season({ id: 2, label: "The Long Summer Rebuilding Season", startDate: "2026-06-10", endDate: "2026-06-12" });
    render(<LifeSeasonsBand seasons={[long, sliver]} spans={[]} />);
    const legend = screen.getByTestId("life-season-legend");
    expect(legend.textContent).toContain("The Long Summer Rebuilding Season");
    const bands = screen.getAllByTestId("life-season-band");
    const sliverBand = bands.find((x) => x.getAttribute("title")?.includes("Rebuilding"))!;
    expect(sliverBand.textContent).toBe(""); // nothing clipped inside the band
    const longBand = bands.find((x) => x.getAttribute("title")?.includes("Recovery"))!;
    expect(longBand.textContent).toContain("Recovery Era"); // wide band keeps its in-band label
    expect(legend.textContent).not.toContain("Recovery Era");
  });
});
