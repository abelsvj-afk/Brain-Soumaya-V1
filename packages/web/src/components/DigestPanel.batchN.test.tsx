import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";

// Batch N — Insights cluster (REG-149, REG-153, REG-154, REG-155, REG-156,
// REG-157, REG-158). The panel loads through the strict Result variants
// (REG-149 / IM-124), so this file mocks those; a { ok: false } mock is a
// dead server, { ok: true, … } is a real answer (possibly empty).

const getDigestResult = vi.fn();
const getDailyDigestResult = vi.fn();
const getConstellationsResult = vi.fn();
const getEmotionalTrajectoryResult = vi.fn();
const getDormantResult = vi.fn();
const getEvolutionLinksResult = vi.fn();
const getLifeAreasResult = vi.fn();
const getSelfReviewResult = vi.fn();
const getDailyLogResult = vi.fn();
const getBeliefsResult = vi.fn();
const promoteConstellation = vi.fn();
const resolveInsight = vi.fn();
const runDigest = vi.fn();
const runContradictions = vi.fn();
const ingestText = vi.fn();
const getSpaceId = vi.fn(() => "space1");
vi.mock("../api/client.js", () => ({
  getDigestResult: (...a: unknown[]) => getDigestResult(...a),
  getDailyDigestResult: (...a: unknown[]) => getDailyDigestResult(...a),
  getConstellationsResult: (...a: unknown[]) => getConstellationsResult(...a),
  getEmotionalTrajectoryResult: (...a: unknown[]) => getEmotionalTrajectoryResult(...a),
  getDormantResult: (...a: unknown[]) => getDormantResult(...a),
  getEvolutionLinksResult: (...a: unknown[]) => getEvolutionLinksResult(...a),
  getLifeAreasResult: (...a: unknown[]) => getLifeAreasResult(...a),
  getSelfReviewResult: (...a: unknown[]) => getSelfReviewResult(...a),
  getDailyLogResult: (...a: unknown[]) => getDailyLogResult(...a),
  getBeliefsResult: (...a: unknown[]) => getBeliefsResult(...a),
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

import { DigestPanel } from "./DigestPanel.js";

function insight(id: number, text: string) {
  return {
    id,
    text,
    score: 0.5,
    createdAt: "2026-10-20T12:00:00Z",
    kind: "synthesis",
    tier: 3,
    nodes: [{ id: 3, label: "Sleep log", type: "memory" }],
  };
}

function emptyDigest() {
  return {
    date: "2026-10-20",
    greeting: "",
    fresh: [],
    connections: [],
    expiredActions: [],
    cooling: [],
    reminders: [],
    closing: "",
  };
}

function emptyTrajectory() {
  return { points: [], trend: "steady", average: 0, volatility: 0, patterns: [], sampleSize: 0 };
}

beforeEach(() => {
  vi.resetAllMocks();
  getDigestResult.mockResolvedValue({ ok: true, insights: [] });
  getDailyDigestResult.mockResolvedValue({ ok: true, digest: emptyDigest() });
  getConstellationsResult.mockResolvedValue({ ok: true, constellations: [] });
  getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory: emptyTrajectory() });
  getDormantResult.mockResolvedValue({ ok: true, dormant: [] });
  getEvolutionLinksResult.mockResolvedValue({ ok: true, evolution: [] });
  getLifeAreasResult.mockResolvedValue({ ok: true, lifeAreas: [] });
  getSelfReviewResult.mockResolvedValue({ ok: true, selfReview: [] });
  getDailyLogResult.mockResolvedValue({ ok: true, log: null });
  getBeliefsResult.mockResolvedValue({ ok: true, beliefs: [] });
  getDigestResult.mockResolvedValue({ ok: true, insights: [] });
  getDailyDigestResult.mockResolvedValue({ ok: true, digest: emptyDigest() });
  getConstellationsResult.mockResolvedValue({ ok: true, constellations: [] });
  getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory: emptyTrajectory() });
  getDormantResult.mockResolvedValue({ ok: true, dormant: [] });
  getEvolutionLinksResult.mockResolvedValue({ ok: true, evolution: [] });
  getLifeAreasResult.mockResolvedValue({ ok: true, lifeAreas: [] });
  getSelfReviewResult.mockResolvedValue({ ok: true, selfReview: [] });
  getDailyLogResult.mockResolvedValue({ ok: true, log: null });
  getBeliefsResult.mockResolvedValue({ ok: true, beliefs: [] });
  getSpaceId.mockReturnValue("space1");
  resolveInsight.mockResolvedValue(true);
  localStorage.clear();
});

afterEach(() => cleanup());

function succeedAllSources(extraInsight?: ReturnType<typeof insight>) {
  const insights = extraInsight ? [extraInsight] : [];
  getDigestResult.mockResolvedValue({ ok: true, insights: insights });
  getDailyDigestResult.mockResolvedValue({ ok: true, digest: emptyDigest() });
  getConstellationsResult.mockResolvedValue({ ok: true, constellations: [] });
  getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory: emptyTrajectory() });
  getDormantResult.mockResolvedValue({ ok: true, dormant: [] });
  getEvolutionLinksResult.mockResolvedValue({ ok: true, evolution: [] });
  getLifeAreasResult.mockResolvedValue({ ok: true, lifeAreas: [] });
  getSelfReviewResult.mockResolvedValue({ ok: true, selfReview: [] });
  getDailyLogResult.mockResolvedValue({ ok: true, log: null });
  getBeliefsResult.mockResolvedValue({ ok: true, beliefs: [] });
  getDigestResult.mockResolvedValue({ ok: true, insights });
  getDailyDigestResult.mockResolvedValue({ ok: true, digest: emptyDigest() });
  getConstellationsResult.mockResolvedValue({ ok: true, constellations: [] });
  getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory: emptyTrajectory() });
  getDormantResult.mockResolvedValue({ ok: true, dormant: [] });
  getEvolutionLinksResult.mockResolvedValue({ ok: true, evolution: [] });
  getLifeAreasResult.mockResolvedValue({ ok: true, lifeAreas: [] });
  getSelfReviewResult.mockResolvedValue({ ok: true, selfReview: [] });
  getDailyLogResult.mockResolvedValue({ ok: true, log: null });
  getBeliefsResult.mockResolvedValue({ ok: true, beliefs: [] });
}

function failAllSources() {
  getDigestResult.mockResolvedValue({ ok: false });
  getDailyDigestResult.mockResolvedValue({ ok: false });
  getConstellationsResult.mockResolvedValue({ ok: false });
  getEmotionalTrajectoryResult.mockResolvedValue({ ok: false });
  getDormantResult.mockResolvedValue({ ok: false });
  getEvolutionLinksResult.mockResolvedValue({ ok: false });
  getLifeAreasResult.mockResolvedValue({ ok: false });
  getSelfReviewResult.mockResolvedValue({ ok: false });
  getDailyLogResult.mockResolvedValue({ ok: false });
  getBeliefsResult.mockResolvedValue({ ok: false });
}

describe("REG-149 / INS-02 — a dead server must never render as an empty brain", () => {
  it("a failed load shows an error state with Retry, never 'No insights yet'", async () => {
    failAllSources();
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/Couldn't load/i);
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.queryByText(/No insights yet/)).toBeNull();
  });

  it("Retry reloads and recovers once the server answers", async () => {
    failAllSources();
    render(<DigestPanel onFocus={() => {}} />);
    const retry = await screen.findByText("Retry");
    succeedAllSources(insight(1, "Sleep and spending move together."));
    await act(async () => {
      retry.click();
    });
    await screen.findByText(/Sleep and spending move together/);
    expect(screen.queryByText(/Couldn't load/i)).toBeNull();
  });

  it("last-good data survives a failed reload — Retry keeps what already loaded", async () => {
    // First load: insights succeed, one secondary source (beliefs) fails, so
    // the error card + Retry are present while the insight is on screen.
    getDigestResult.mockResolvedValue({ ok: true, insights: [insight(1, "A kept connection.")] });
    getDigestResult.mockResolvedValue({ ok: true, insights: [insight(1, "A kept connection.")] });
    getBeliefsResult.mockResolvedValue({ ok: false });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/A kept connection/);
    const retry = await screen.findByText("Retry");
    // The next load fails everywhere: the kept insight must stay visible.
    failAllSources();
    await act(async () => {
      retry.click();
    });
    await waitFor(() => expect(screen.queryByText(/Couldn't load/i)).not.toBeNull());
    expect(screen.getByText(/A kept connection/)).toBeTruthy();
  });

  it("a genuinely empty brain renders exactly as today — no error state", async () => {
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/No insights yet/);
    expect(screen.queryByText(/Couldn't load/i)).toBeNull();
    expect(screen.queryByText("Retry")).toBeNull();
  });
});

describe("REG-153 / INS-06 — patterns show their basis and the hedge", () => {
  it("renders the per-pattern basis and a heuristic framing", async () => {
    const trajectory = {
      points: [
        { date: "2026-03-01", valence: 0.3, count: 1 },
        { date: "2026-03-02", valence: -0.6, count: 1 },
        { date: "2026-03-03", valence: 0.2, count: 1 },
        { date: "2026-03-04", valence: -0.7, count: 1 },
        { date: "2026-03-05", valence: -0.5, count: 1 },
      ],
      trend: "steady",
      average: -0.1,
      volatility: 0.2,
      sampleSize: 5,
      patterns: [
        {
          type: "Stress cycle",
          trigger: "work",
          repeats: 3,
          intervention: "Take a short walk.",
          basis: "3 heavy days among the last 5 day-buckets (2026-03-01–2026-03-05).",
        },
      ],
    };
    getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory: trajectory });
    getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Stress cycle");
    expect(screen.getByText(/3 heavy days among the last 5 day-buckets/)).toBeTruthy();
    expect(screen.getByText(/never a settled fact/i)).toBeTruthy();
  });
});

describe("REG-154 / INS-07 — the headline names which window each number describes", () => {
  it("labels the all-time average/sample and the recent-bucket trend window separately", async () => {
    const trajectory = {
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
    };
    getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory: trajectory });
    getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("🌡️ Emotional weather");
    expect(screen.getByText(/across all 3 memories/i)).toBeTruthy();
    expect(screen.getByText(/last 3 day-buckets/i)).toBeTruthy();
  });
});

describe("REG-155 / INS-08 — the lens is framed as an automatic heuristic, not attention", () => {
  it("says the bars are automatically classified counts, not where attention goes", async () => {
    const areas = [
      { area: "Money", count: 2 },
      { area: "Health", count: 1 },
    ];
    getLifeAreasResult.mockResolvedValue({ ok: true, lifeAreas: areas });
    getLifeAreasResult.mockResolvedValue({ ok: true, lifeAreas: areas });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Money");
    expect(screen.queryByText(/where your attention goes/i)).toBeNull();
    expect(screen.getByText(/automatically sorted by keywords/i)).toBeTruthy();
    expect(screen.getByText(/Automatic keyword sort of your memory counts/i)).toBeTruthy();
    expect(screen.getByText(/not measured attention/i)).toBeTruthy();
  });
});

describe("REG-156 / INS-10 — a singleton is never presented as a constellation", () => {
  it("a 1-member cluster renders without a cohesion figure and without a Save button", async () => {
    const single = {
      id: 1,
      name: "Lonely cluster",
      cohesion: 1,
      nodes: [{ id: 1, label: "only one", type: "concept" }],
    };
    getConstellationsResult.mockResolvedValue({ ok: true, constellations: [single] });
    getConstellationsResult.mockResolvedValue({ ok: true, constellations: [single] });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Lonely cluster");
    expect(screen.queryByText(/100% tight/)).toBeNull();
    expect(screen.queryByText("✦ Save as constellation")).toBeNull();
  });

  it("the section copy survives the hash-embeddings case — grouped by similarity, not by meaning", async () => {
    const cluster = {
      id: 1,
      name: "Work stress",
      cohesion: 0.8,
      nodes: [
        { id: 1, label: "n1", type: "concept" },
        { id: 2, label: "n2", type: "concept" },
      ],
    };
    getConstellationsResult.mockResolvedValue({ ok: true, constellations: [cluster] });
    getConstellationsResult.mockResolvedValue({ ok: true, constellations: [cluster] });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Work stress");
    expect(screen.queryByText(/grouped by meaning/i)).toBeNull();
    expect(screen.getByText(/grouped by similarity/i)).toBeTruthy();
  });
});

describe("REG-157 / INS-11 — the 30-insight working-set cap is stated where it truncates", () => {
  it("shows the cap note when the list sits at the server's 30-insight ceiling", async () => {
    const thirty = Array.from({ length: 30 }, (_, i) => insight(100 + i, `Insight number ${i + 1}.`));
    getDigestResult.mockResolvedValue({ ok: true, insights: thirty });
    getDigestResult.mockResolvedValue({ ok: true, insights: thirty });
    render(<DigestPanel onFocus={() => {}} />);
    // Ranked newest-first, the list shows the first 6 until "Show all" —
    // wait for the newest one, then the cap note below the list.
    await screen.findByText(/Insight number 30\./);
    expect(screen.getByText(/30 most recent/i)).toBeTruthy();
  });

  it("shows no cap note for a small list", async () => {
    getDigestResult.mockResolvedValue({ ok: true, insights: [insight(1, "Just one insight.")] });
    getDigestResult.mockResolvedValue({ ok: true, insights: [insight(1, "Just one insight.")] });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/Just one insight/);
    expect(screen.queryByText(/most recent/i)).toBeNull();
  });
});

describe("REG-158 / INS-12 — toggles carry a visible name; per-item actions meet the panel's norm", () => {
  it("every section toggle shows its Collapse/Expand caption visibly", async () => {
    const areas = [{ area: "Money", count: 2 }];
    getLifeAreasResult.mockResolvedValue({ ok: true, lifeAreas: areas });
    getLifeAreasResult.mockResolvedValue({ ok: true, lifeAreas: areas });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Money");
    const toggle = screen.getByRole("button", { name: /Collapse Life-area lens/ });
    expect(toggle.textContent).toMatch(/Collapse/);
    act(() => toggle.click());
    const expand = screen.getByRole("button", { name: /Expand Life-area lens/ });
    expect(expand.textContent).toMatch(/Expand/);
  });

  it("Dismiss and 'Got it' are no longer shrunk below the panel's mini-button norm", async () => {
    getDigestResult.mockResolvedValue({ ok: true, insights: [insight(1, "A dismissible insight.")] });
    getDigestResult.mockResolvedValue({ ok: true, insights: [insight(1, "A dismissible insight.")] });
    const trajectory = {
      points: [
        { date: "2026-08-28", valence: 0.1, count: 1 },
        { date: "2026-08-29", valence: -0.2, count: 1 },
        { date: "2026-08-30", valence: -0.1, count: 1 },
      ],
      trend: "steady",
      average: -0.1,
      volatility: 0.2,
      sampleSize: 3,
      patterns: [{ type: "Stress cycle", trigger: "work", repeats: 2, intervention: "Take a walk.", basis: "2 heavy days." }],
    };
    getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory: trajectory });
    getEmotionalTrajectoryResult.mockResolvedValue({ ok: true, trajectory });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/A dismissible insight/);
    const dismiss = screen.getByText("Dismiss");
    expect(dismiss.getAttribute("style") ?? "").not.toContain("0.66rem");
    expect(dismiss.getAttribute("style") ?? "").not.toContain("1px 8px");
    const gotIt = screen.getByText("✓ Got it");
    expect(gotIt.getAttribute("style") ?? "").not.toContain("0.66rem");
    expect(gotIt.getAttribute("style") ?? "").not.toContain("1px 8px");
  });
});
