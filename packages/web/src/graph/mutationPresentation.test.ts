import { describe, it, expect } from "vitest";
import {
  applyTransition,
  clampWarmth,
  formatWorldChangeTime,
  gardenPaletteAnchors,
  provisionalStyle,
  seasonLabelForDate,
  seasonName,
  tendTransition,
  undoTransition,
  warmthColors,
} from "./mutationPresentation.js";

/**
 * Mutation presentation helpers (Phase 4): seeded warmth colors (§10.1),
 * provisional style (P7 tier ii), apply/undo/tend transitions (A24/A25/A26
 * with the A6/A7/A9 space-specific forms), and space-local season + time
 * labels (never UTC).
 */

describe("warmthColors (A8, §10.1 seeded palette math)", () => {
  it("derives both hue anchors from GARDEN_SEED, deterministically", () => {
    const a = gardenPaletteAnchors();
    const b = gardenPaletteAnchors();
    expect(a).toEqual(b);
    expect(a.coolHue).toBeGreaterThanOrEqual(190);
    expect(a.coolHue).toBeLessThan(210);
    expect(a.warmHue).toBeGreaterThanOrEqual(38);
    expect(a.warmHue).toBeLessThan(46);
  });

  it("warmth 0 is the cool first-light anchor and warmth 1 the warm gold anchor", () => {
    const cool = warmthColors(0);
    const warm = warmthColors(1);
    expect(cool.keyLight).not.toBe(warm.keyLight);
    expect(cool.fog).not.toBe(warm.fog);
    // Same warmth always returns the same colors.
    expect(warmthColors(0.5)).toEqual(warmthColors(0.5));
  });

  it("warms monotonically: the key light's hue travels from the cool anchor toward warm gold", () => {
    const hueOf = (hex: number): number => {
      const r = ((hex >> 16) & 0xff) / 255;
      const g = ((hex >> 8) & 0xff) / 255;
      const b = (hex & 0xff) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      if (max === r) return ((g - b) / d + (g < b ? 6 : 0)) * 60;
      if (max === g) return ((b - r) / d + 2) * 60;
      return ((r - g) / d + 4) * 60;
    };
    const c0 = warmthColors(0);
    const c5 = warmthColors(0.5);
    const c1 = warmthColors(1);
    const anchors = gardenPaletteAnchors();
    // The hue lerps directly from the cool anchor to the warm anchor
    // (within RGB-rounding of the anchors).
    expect(hueOf(c0.keyLight)).toBeCloseTo(anchors.coolHue, -1);
    expect(hueOf(c1.keyLight)).toBeCloseTo(anchors.warmHue, -1);
    expect(hueOf(c0.keyLight)).toBeGreaterThan(hueOf(c5.keyLight));
    expect(hueOf(c5.keyLight)).toBeGreaterThan(hueOf(c1.keyLight));
    // Endpoints: warm gold carries more red and less blue than first light.
    const red = (hex: number) => (hex >> 16) & 0xff;
    const blue = (hex: number) => hex & 0xff;
    expect(red(c1.keyLight)).toBeGreaterThan(red(c0.keyLight));
    expect(blue(c1.keyLight)).toBeLessThan(blue(c0.keyLight));
    // And the fog warms too — never a jump: a quarter of the signal
    // moves no channel by more than half its range.
    const channelDelta = (a: number, b: number): number =>
      Math.max(
        Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff)),
        Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff)),
        Math.abs((a & 0xff) - (b & 0xff)),
      );
    const steps = [0, 0.25, 0.5, 0.75, 1].map((w) => warmthColors(w).fog);
    for (let i = 1; i < steps.length; i++) {
      expect(channelDelta(steps[i]!, steps[i - 1]!)).toBeLessThan(0x80);
    }
  });

  it("clamps out-of-range warmth instead of inventing a color", () => {
    expect(warmthColors(-2)).toEqual(warmthColors(0));
    expect(warmthColors(99)).toEqual(warmthColors(1));
    expect(warmthColors(NaN)).toEqual(warmthColors(0));
    expect(clampWarmth(0.5)).toBe(0.5);
    expect(clampWarmth(-1)).toBe(0);
    expect(clampWarmth(2)).toBe(1);
  });
});

describe("provisionalStyle (A23, P7 tier ii)", () => {
  it("is ghost/shimmer, never monumental", () => {
    const s = provisionalStyle(false);
    expect(s.kind).toBe("provisional");
    expect(s.monumental).toBe(false);
    expect(s.dashed).toBe(true);
    expect(s.shimmer).toBe(true);
    expect(s.tag).toBe("Proposed — tap to review");
    expect(s.opacity).toBeGreaterThan(0);
    expect(s.opacity).toBeLessThan(1);
  });

  it("reduced motion stops the pulse but keeps the tag and the outline", () => {
    const s = provisionalStyle(true);
    expect(s.shimmer).toBe(false);
    expect(s.dashed).toBe(true);
    expect(s.tag).toBe("Proposed — tap to review");
  });
});

describe("transition descriptors (A24/A25/A26 + A6/A7/A9 forms)", () => {
  it("apply: one landing per kind — landmark rises, path draws, other firms", () => {
    expect(applyTransition("landmark")).toMatchObject({ animationId: "A6", durationMs: 8000 });
    expect(applyTransition("path")).toMatchObject({ animationId: "A7", durationMs: 4000 });
    expect(applyTransition("cluster")).toMatchObject({ animationId: "A9", durationMs: 8000 });
    expect(applyTransition("anchor")).toMatchObject({ animationId: "A24", durationMs: 2000 });
    expect(applyTransition("other")).toMatchObject({ animationId: "A24", durationMs: 2000 });
    // The generic firming never also plays for a space-specific landing.
    expect(applyTransition("landmark").animationId).not.toBe("A24");
    expect(applyTransition("path").animationId).not.toBe("A24");
  });

  it("apply descriptors carry a reduced-motion variant, not a removal", () => {
    for (const kind of ["landmark", "path", "cluster", "anchor", "other"] as const) {
      const d = applyTransition(kind);
      expect(d.reducedMotion.kind.length).toBeGreaterThan(0);
      expect(d.reducedMotion.durationMs).toBeLessThanOrEqual(d.durationMs);
    }
  });

  it("undo is the compensating path (A25), never a snap-delete", () => {
    expect(undoTransition("landmark")).toMatchObject({ animationId: "A25", durationMs: 8000 });
    expect(undoTransition("path")).toMatchObject({ animationId: "A25", durationMs: 6000 });
    expect(undoTransition("path").reducedMotion.kind).toMatch(/fade-out/);
  });

  it("tend is a moment (A26)", () => {
    const t = tendTransition();
    expect(t.animationId).toBe("A26");
    expect(t.durationMs).toBeLessThan(2000);
    expect(t.reducedMotion.kind).toMatch(/no flight/);
  });
});

describe("seasonLabelForDate (space-local, never UTC)", () => {
  it("names the meteorological season with an early/late half", () => {
    expect(seasonName(1)).toBe("winter");
    expect(seasonName(4)).toBe("spring");
    expect(seasonName(7)).toBe("summer");
    expect(seasonName(10)).toBe("autumn");
    expect(seasonName(12)).toBe("winter");
  });

  it("reads the date in the given timezone — the same instant can be a different season-day", () => {
    // 2026-03-01 02:00 UTC is still Feb 28 in New York (late winter),
    // but already Mar 1 in Kiritimati (early spring).
    const d = new Date("2026-03-01T02:00:00.000Z");
    expect(seasonLabelForDate(d, "America/New_York")).toBe("Late winter");
    expect(seasonLabelForDate(d, "Pacific/Kiritimati")).toBe("Early spring");
  });

  it("returns null for an unparseable date instead of guessing", () => {
    expect(seasonLabelForDate(new Date(NaN), "America/New_York")).toBeNull();
    expect(seasonLabelForDate(new Date("2026-06-01T12:00:00Z"), "Not/AZone")).toBeNull();
  });
});

describe("formatWorldChangeTime (space-local, never UTC)", () => {
  it("renders a timestamp in the space's local time", () => {
    // 2026-10-26 18:30 UTC = 2:30 PM in New York, 06:30 Oct 27 in Kiritimati.
    expect(formatWorldChangeTime("2026-10-26T18:30:00.000Z", "America/New_York")).toMatch(
      /Oct 26, 2026.*2:30 PM/,
    );
    expect(formatWorldChangeTime("2026-10-26T18:30:00.000Z", "Pacific/Kiritimati")).toMatch(
      /Oct 27, 2026/,
    );
  });

  it("a bare calendar date is its own date, never re-zoned", () => {
    expect(formatWorldChangeTime("2026-10-26", "Pacific/Kiritimati")).toMatch(/Oct 26, 2026/);
  });

  it("returns null for missing/unparseable input", () => {
    expect(formatWorldChangeTime(null)).toBeNull();
    expect(formatWorldChangeTime("")).toBeNull();
    expect(formatWorldChangeTime("not a date")).toBeNull();
  });
});
