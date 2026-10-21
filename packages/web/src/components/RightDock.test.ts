import { describe, it, expect } from "vitest";
import { visibleTabIds, dockAmbientDetail, dockAmbientGreeting, type DockTab } from "./RightDock.js";

const ALL: { id: DockTab }[] = [
  { id: "details" },
  { id: "list" },
  { id: "mind" },
  { id: "actions" },
  { id: "insights" },
  { id: "soumaya" },
  { id: "inbox" },
  { id: "awards" },
  { id: "journeys" },
  { id: "money" },
  { id: "hangar" },
];

describe("visibleTabIds (Progressive Discovery gating)", () => {
  it("hides insights/awards/hangar for a brand-new, empty brain", () => {
    const shown = visibleTabIds(ALL, "details", { hasInsights: false, hasRealMemory: false });
    expect(shown).not.toContain("insights");
    expect(shown).not.toContain("awards");
    expect(shown).not.toContain("hangar");
  });

  it("never hides journeys, even with no data at all — no other UI can create the first one", () => {
    const shown = visibleTabIds(ALL, "details", { hasInsights: false, hasRealMemory: false });
    expect(shown).toContain("journeys");
  });

  it("keeps the always-core tabs regardless of readiness signals", () => {
    const shown = visibleTabIds(ALL, "details", { hasInsights: false, hasRealMemory: false });
    for (const id of ["details", "list", "mind", "actions", "soumaya", "inbox", "money"] as const) {
      expect(shown).toContain(id);
    }
  });

  it("reveals awards and hangar once there's a real (non-action) memory", () => {
    const shown = visibleTabIds(ALL, "details", { hasInsights: false, hasRealMemory: true });
    expect(shown).toContain("awards");
    expect(shown).toContain("hangar");
    expect(shown).not.toContain("insights");
  });

  it("reveals insights once at least one has been synthesized", () => {
    const shown = visibleTabIds(ALL, "details", { hasInsights: true, hasRealMemory: false });
    expect(shown).toContain("insights");
  });

  it("never hides the currently active tab, even if its gate isn't earned yet", () => {
    const shown = visibleTabIds(ALL, "insights", { hasInsights: false, hasRealMemory: false });
    expect(shown).toContain("insights");
  });

  it("shows every tab once all signals are true", () => {
    const shown = visibleTabIds(ALL, "details", { hasInsights: true, hasRealMemory: true });
    expect(shown).toHaveLength(ALL.length);
  });
});

// IM-02: the ambient strip must derive from provided state — never from the
// clock. The old strip invented a "sector" via Math.sin(Date.now()/10000)
// plus a hard-coded orbit-name list; these tests falsify any return of that:
// the state-derived segment must be byte-identical across wildly different
// times, must change when (and only when) the provided state changes, and
// must never contain fabricated place/sector names.
describe("dockAmbientDetail (IM-02 — no fabricated telemetry)", () => {
  const FABRICATED = [/sector/i, /spaceport/i, /Delta-V/, /Lagrange/, /Orion Outpost/, /Alpha Quadrant/, /E-45/];

  it("renders the real memory/link counts from the provided state", () => {
    const d = dockAmbientDetail({ memoryCount: 3, linkCount: 2 }, new Date(2026, 9, 20, 9, 30));
    expect(d).toContain("3 memories · 2 links");
  });

  it("changes when the provided state changes (not hard-coded)", () => {
    const now = new Date(2026, 9, 20, 9, 30);
    const a = dockAmbientDetail({ memoryCount: 3, linkCount: 2 }, now);
    const b = dockAmbientDetail({ memoryCount: 7, linkCount: 5 }, now);
    expect(b).toContain("7 memories · 5 links");
    expect(a).not.toBe(b);
  });

  it("state segment is identical across different times — no time-based fabrication", () => {
    const state = { memoryCount: 3, linkCount: 2, selectedLabel: null };
    // Sweep times where the old sine sector would have taken every value.
    for (const t of [0, 5_000, 10_000, 15_700, 31_400, 47_100, 62_800, 3_600_000, 86_400_000]) {
      const d = dockAmbientDetail(state, new Date(t));
      expect(d).toContain("3 memories · 2 links");
      for (const pattern of FABRICATED) expect(d).not.toMatch(pattern);
    }
  });

  it("shows the focused memory's real label when one is selected", () => {
    const d = dockAmbientDetail(
      { memoryCount: 4, linkCount: 1, selectedLabel: "Trip to Lisbon" },
      new Date(2026, 9, 20, 9, 30),
    );
    expect(d).toContain("Viewing “Trip to Lisbon”");
    expect(d).toContain("1 link");
  });

  it("is honestly absent for an empty brain — no invented location or counts", () => {
    const d = dockAmbientDetail({ memoryCount: 0, linkCount: 0 }, new Date(2026, 9, 20, 9, 30));
    expect(d).toContain("No memories yet");
    expect(d).not.toContain("memories ·");
    for (const pattern of FABRICATED) expect(d).not.toMatch(pattern);
  });

  it("singularizes 1 memory / 1 link", () => {
    const d = dockAmbientDetail({ memoryCount: 1, linkCount: 1 }, new Date(2026, 9, 20, 9, 30));
    expect(d).toContain("1 memory · 1 link");
  });
});

describe("dockAmbientGreeting (IM-02)", () => {
  it("derives from the real local hour", () => {
    expect(dockAmbientGreeting(new Date(2026, 9, 20, 9, 0))).toBe("Good morning, traveller");
    expect(dockAmbientGreeting(new Date(2026, 9, 20, 13, 0))).toBe("Good afternoon, traveller");
    expect(dockAmbientGreeting(new Date(2026, 9, 20, 19, 0))).toBe("Good evening, traveller");
    expect(dockAmbientGreeting(new Date(2026, 9, 20, 23, 30))).toBe("Good night, traveller");
  });
});
