import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";

const getDigest = vi.fn();
const getDailyDigest = vi.fn();
const getConstellations = vi.fn();
const getEmotionalTrajectory = vi.fn();
const getDormant = vi.fn();
const getEvolutionLinks = vi.fn();
const getLifeAreas = vi.fn();
const getSelfReview = vi.fn();
const getDailyLog = vi.fn();
const getBeliefs = vi.fn();
const promoteConstellation = vi.fn();
const resolveInsight = vi.fn();
const runDigest = vi.fn();
const runContradictions = vi.fn();
const ingestText = vi.fn();
const getSpaceId = vi.fn(() => "space1");
vi.mock("../api/client.js", () => ({
  getDigest: (...a: unknown[]) => getDigest(...a),
  getDailyDigest: (...a: unknown[]) => getDailyDigest(...a),
  getConstellations: (...a: unknown[]) => getConstellations(...a),
  getEmotionalTrajectory: (...a: unknown[]) => getEmotionalTrajectory(...a),
  getDormant: (...a: unknown[]) => getDormant(...a),
  getEvolutionLinks: (...a: unknown[]) => getEvolutionLinks(...a),
  getLifeAreas: (...a: unknown[]) => getLifeAreas(...a),
  getSelfReview: (...a: unknown[]) => getSelfReview(...a),
  getDailyLog: (...a: unknown[]) => getDailyLog(...a),
  getBeliefs: (...a: unknown[]) => getBeliefs(...a),
  promoteConstellation: (...a: unknown[]) => promoteConstellation(...a),
  resolveInsight: (...a: unknown[]) => resolveInsight(...a),
  runDigest: (...a: unknown[]) => runDigest(...a),
  runContradictions: (...a: unknown[]) => runContradictions(...a),
  ingestText: (...a: unknown[]) => ingestText(...a),
  getSpaceId: () => getSpaceId(),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

import { DigestPanel, evolutionGapLabel } from "./DigestPanel.js";

function insight(over: Record<string, unknown>) {
  return {
    id: 1,
    text: "An insight.",
    score: 0.5,
    createdAt: "2026-10-20T12:00:00Z",
    kind: "synthesis",
    tier: 3,
    nodes: [{ id: 3, label: "Sleep log", type: "memory" }],
    ...over,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  getDigest.mockResolvedValue([]);
  getDailyDigest.mockResolvedValue(null);
  getConstellations.mockResolvedValue([]);
  getEmotionalTrajectory.mockResolvedValue(null);
  getDormant.mockResolvedValue([]);
  getEvolutionLinks.mockResolvedValue([]);
  getLifeAreas.mockResolvedValue([]);
  getSelfReview.mockResolvedValue([]);
  getDailyLog.mockResolvedValue(null);
  getBeliefs.mockResolvedValue([]);
  getSpaceId.mockReturnValue("space1");
  resolveInsight.mockResolvedValue(true);
  localStorage.clear();
});

afterEach(() => cleanup());

describe("DigestPanel — IM-58: any insight kind can be dismissed, not just contradictions", () => {
  it("a synthesis insight offers Dismiss, and dismissing resolves it and removes the row", async () => {
    getDigest.mockResolvedValue([insight({ id: 21, text: "Your running and your writing rise together." })]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/running and your writing rise together/);
    const btn = screen.getByText("Dismiss");
    await act(async () => { btn.click(); });
    await waitFor(() => expect(resolveInsight).toHaveBeenCalledWith(21));
    await waitFor(() => expect(screen.queryByText(/running and your writing rise together/)).toBeNull());
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("dismissed"), "✓", expect.any(Number));
  });

  it("a contradiction still offers ✓ Reconciled with the reconciled toast", async () => {
    getDigest.mockResolvedValue([insight({ id: 22, kind: "contradiction", text: "You say rest matters, but never rest." })]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/say rest matters/);
    const btn = screen.getByText("✓ Reconciled");
    await act(async () => { btn.click(); });
    await waitFor(() => expect(resolveInsight).toHaveBeenCalledWith(22));
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Reconciled"), "⚡", expect.any(Number));
  });

  it("a failed dismissal keeps the insight and toasts an error", async () => {
    resolveInsight.mockResolvedValue(false);
    getDigest.mockResolvedValue([insight({ id: 23, text: "A stubborn synthesis insight." })]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/stubborn synthesis insight/);
    const btn = screen.getByText("Dismiss");
    await act(async () => { btn.click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't dismiss"), "⚠️", expect.any(Number)),
    );
    expect(screen.getByText(/stubborn synthesis insight/)).toBeTruthy();
  });
});

describe("DigestPanel — IM-59: dormant prompt, belief date, evolution time-gap are rendered", () => {
  it("renders the dormant item's reactivation prompt, not just its hypothesis", async () => {
    getDormant.mockResolvedValue([
      {
        nodeId: 5,
        label: "Spanish practice",
        type: "skill",
        dormantDays: 64,
        hypothesis: "It faded when work got busy.",
        prompt: "Say one sentence in Spanish out loud today.",
      },
    ]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Spanish practice");
    expect(screen.getByText(/one sentence in Spanish out loud/)).toBeTruthy();
  });

  it("renders a belief's createdAt as a local date", async () => {
    const createdAt = "2026-09-14T15:00:00.000Z";
    getBeliefs.mockResolvedValue([
      { id: 9, content: "You protect your mornings fiercely.", createdAt, evidence: 4 },
    ]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/protect your mornings fiercely/);
    const expected = new Date(createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(screen.getByText(new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
    expect(screen.queryByText(createdAt)).toBeNull();
  });

  it("renders the evolution time gap as its own element ('3 months later')", async () => {
    getEvolutionLinks.mockResolvedValue([
      {
        fromId: 1,
        fromLabel: "Old take",
        toId: 2,
        toLabel: "New take",
        strength: "medium",
        temporalDistanceDays: 92,
        reason: "Same theme, revisited.",
      },
    ]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Old take");
    const gap = document.querySelector(".evolution-gap");
    expect(gap).toBeTruthy();
    expect(gap!.textContent).toContain("3 months later");
  });
});

describe("evolutionGapLabel", () => {
  it("humanizes day counts into later-phrases", () => {
    expect(evolutionGapLabel(0)).toBe("the same day");
    expect(evolutionGapLabel(1)).toBe("1 day later");
    expect(evolutionGapLabel(12)).toBe("12 days later");
    expect(evolutionGapLabel(92)).toBe("3 months later");
    expect(evolutionGapLabel(400)).toBe("1.1 years later");
    expect(evolutionGapLabel(730)).toBe("2 years later");
  });
});

describe("DigestPanel — IM-60: search, per-section collapse, sparkline axis dates", () => {
  it("search filters the insight list to matching text", async () => {
    getDigest.mockResolvedValue([
      insight({ id: 31, text: "Marathon training links to better sleep." }),
      insight({ id: 32, text: "Budget reviews calm your spending anxiety." }),
    ]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/Marathon training links/);
    const input = screen.getByPlaceholderText("Search Insights…");
    fireEvent.change(input, { target: { value: "marathon" } });
    await waitFor(() => expect(screen.queryByText(/Budget reviews calm/)).toBeNull());
    expect(screen.getByText(/Marathon training links/)).toBeTruthy();
  });

  it("search hides sections whose content doesn't match", async () => {
    getBeliefs.mockResolvedValue([
      { id: 9, content: "You protect your mornings fiercely.", createdAt: "2026-09-14T15:00:00.000Z", evidence: 4 },
    ]);
    getDigest.mockResolvedValue([insight({ id: 33, text: "Marathon training links to better sleep." })]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/protect your mornings fiercely/);
    const input = screen.getByPlaceholderText("Search Insights…");
    fireEvent.change(input, { target: { value: "marathon" } });
    await waitFor(() => expect(screen.queryByText(/protect your mornings fiercely/)).toBeNull());
    expect(screen.queryByText("🖤 What she believes about you")).toBeNull();
  });

  it("a section can be collapsed and re-expanded from its header", async () => {
    getConstellations.mockResolvedValue([
      { id: 1, name: "Work stress", cohesion: 0.8, nodes: [{ id: 1, label: "n1", type: "concept" }, { id: 2, label: "n2", type: "concept" }] },
    ]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Work stress");
    const toggle = screen.getByRole("button", { name: /Collapse Constellations/ });
    act(() => toggle.click());
    await waitFor(() => expect(screen.queryByText("Work stress")).toBeNull());
    expect(screen.getByText("🌌 Constellations")).toBeTruthy();
    const expand = screen.getByRole("button", { name: /Expand Constellations/ });
    act(() => expand.click());
    await screen.findByText("Work stress");
  });

  it("the emotional sparkline labels its first and last axis dates", async () => {
    getEmotionalTrajectory.mockResolvedValue({
      points: [
        { date: "2026-08-28", valence: 0.1, count: 1 },
        { date: "2026-08-29", valence: -0.2, count: 1 },
        { date: "2026-08-30", valence: -0.1, count: 1 },
      ],
      trend: "steady",
      average: -0.1,
      volatility: 0.2,
      sampleSize: 3,
      patterns: [],
    });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("🌡️ Emotional weather");
    const fmt = (iso: string) => {
      const [y = 0, m = 1, d = 1] = iso.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    };
    const texts = [...document.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(texts).toContain(fmt("2026-08-28"));
    expect(texts).toContain(fmt("2026-08-30"));
  });
});

describe("DigestPanel — IM-63: humanized tier + strength, localized Captain's Log date", () => {
  it("shows the tier as a human phrase, not the raw category word", async () => {
    getDigest.mockResolvedValue([insight({ id: 41, tier: 1, text: "Identity-level connection." })]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/Identity-level connection/);
    expect(screen.getByText("About your identity")).toBeTruthy();
    expect(screen.queryByText("identity")).toBeNull();
  });

  it("shows evolution strength as a human label with a bar, not the bare enum", async () => {
    getEvolutionLinks.mockResolvedValue([
      {
        fromId: 1,
        fromLabel: "Old take",
        toId: 2,
        toLabel: "New take",
        strength: "strong",
        temporalDistanceDays: 10,
        reason: "Same theme, revisited.",
      },
    ]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Old take");
    expect(screen.getByText("Strong thread")).toBeTruthy();
    expect(screen.queryByText("strong")).toBeNull();
    const bar = document.querySelector(".evolution-strength");
    expect(bar).toBeTruthy();
  });

  it("renders the Captain's Log date localized, not raw YYYY-MM-DD", async () => {
    getDailyLog.mockResolvedValue({ id: 1, date: "2026-08-30", content: "A quiet day.", createdAt: "2026-08-30T00:00:00Z" });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/A quiet day/);
    const expected = new Date(2026, 7, 30).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(screen.getByText(new RegExp(`Captain's Log \\(${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`))).toBeTruthy();
    expect(screen.queryByText(/Captain's Log \(2026-08-30\)/)).toBeNull();
  });
});
