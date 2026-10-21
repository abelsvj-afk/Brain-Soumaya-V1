import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";
import type { Constellation } from "@brain/shared";

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

import { DigestPanel } from "./DigestPanel.js";

function constellation(over: Partial<Constellation>): Constellation {
  return { id: 1, name: "Work stress", cohesion: 0.8, nodes: [{ id: 1, label: "n1", type: "concept" }, { id: 2, label: "n2", type: "concept" }] as never, ...over } as Constellation;
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
  ingestText.mockResolvedValue({ nodes: [{ id: 1 }] });
  localStorage.clear();
});

afterEach(() => cleanup());

async function openPromotionForm() {
  getConstellations.mockResolvedValue([constellation({})]);
  render(<DigestPanel onFocus={() => {}} />);
  const makeBtn = await screen.findByText("✦ Save as constellation");
  act(() => makeBtn.click());
  return screen.getByPlaceholderText("Name this constellation…");
}

describe("DigestPanel — promoteConstellation error threading", () => {
  it("surfaces the server's real error message instead of a generic fallback", async () => {
    await openPromotionForm();
    promoteConstellation.mockResolvedValue({ hub: null, error: "at least 2 memories required" });
    const saveBtn = screen.getByText("✦ Save");
    await act(async () => { saveBtn.click(); });
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith("at least 2 memories required", "⚠️", expect.any(Number)));
  });

  it("falls back to a generic message when the server gave no reason (e.g. a network failure)", async () => {
    await openPromotionForm();
    promoteConstellation.mockResolvedValue({ hub: null });
    const saveBtn = screen.getByText("✦ Save");
    await act(async () => { saveBtn.click(); });
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't chart"), "⚠️", expect.any(Number)));
  });

  it("celebrates and closes the form on success, without touching the error toast", async () => {
    await openPromotionForm();
    promoteConstellation.mockResolvedValue({ hub: { id: 42 } });
    const saveBtn = screen.getByText("✦ Save");
    await act(async () => { saveBtn.click(); });
    await waitFor(() => expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("charted"), "🌌", expect.any(Number)));
    expect(screen.queryByPlaceholderText("Name this constellation…")).toBeNull();
  });
});

describe("DigestPanel — Captain's Log is no longer a dead end", () => {
  it("saves the log as a memory and disables the button so it can't be duplicated", async () => {
    getDailyLog.mockResolvedValue({ id: 1, date: "2026-08-30", content: "A quiet day.", createdAt: "2026-08-30T00:00:00Z" });
    render(<DigestPanel onFocus={() => {}} />);
    const saveBtn = await screen.findByText("★ Save as memory");
    await act(async () => { saveBtn.click(); });
    await waitFor(() => expect(ingestText).toHaveBeenCalledTimes(1));
    expect(ingestText).toHaveBeenCalledWith(expect.stringContaining("A quiet day."));
    await screen.findByText("✓ Saved");
    const savedBtn = screen.getByText("✓ Saved");
    expect(savedBtn.getAttribute("disabled")).not.toBeNull();
  });

  it("opens chat via the shared toast-action event when 'Ask about this' is tapped", async () => {
    getDailyLog.mockResolvedValue({ id: 1, date: "2026-08-30", content: "A quiet day.", createdAt: "2026-08-30T00:00:00Z" });
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    render(<DigestPanel onFocus={() => {}} />);
    const askBtn = await screen.findByText("💬 Ask about this");
    act(() => askBtn.click());
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "chat" } }));
    window.removeEventListener("brain-toast-action", onAction);
  });
});

describe("DigestPanel — 'Going cold' no longer hides the most urgent item", () => {
  it("shows the cold percentage as visible text instead of relying on opacity alone", async () => {
    getDailyDigest.mockResolvedValue({
      date: "2026-08-30",
      greeting: "",
      fresh: [],
      connections: [],
      expiredActions: [],
      cooling: [{ node: { id: 9, label: "Old idea", type: "concept" }, entropy: 0.91 }],
      reminders: [],
      closing: "",
    });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/Old idea.*91% cold/);
  });
});

describe("DigestPanel — IM-61: a failed scan never toasts a successful empty result", () => {
  it("contradiction scan failure toasts an error, NOT 'No contradictions found'", async () => {
    runContradictions.mockRejectedValue(new Error("network down"));
    render(<DigestPanel onFocus={() => {}} />);
    const btn = await screen.findByText("⚡ Find contradictions");
    await act(async () => { btn.click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't run the contradiction scan"), "⚠️", expect.any(Number)),
    );
    const messages = pushToast.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("No contradictions found"))).toBe(false);
    expect(messages.some((m) => m.includes("consistent"))).toBe(false);
  });

  it("contradiction scan that succeeds with nothing found still toasts the true-empty copy", async () => {
    runContradictions.mockResolvedValue([]);
    render(<DigestPanel onFocus={() => {}} />);
    const btn = await screen.findByText("⚡ Find contradictions");
    await act(async () => { btn.click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("No contradictions found"), "✓", expect.any(Number)),
    );
  });

  it("connection scan failure toasts an error, NOT 'No new connections yet'", async () => {
    runDigest.mockRejectedValue(new Error("network down"));
    render(<DigestPanel onFocus={() => {}} />);
    const btn = await screen.findByText("🔍 Find new links");
    await act(async () => { btn.click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't run the connection scan"), "⚠️", expect.any(Number)),
    );
    const messages = pushToast.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes("No new connections yet"))).toBe(false);
  });

  it("connection scan that succeeds with nothing found still toasts the true-empty copy", async () => {
    runDigest.mockResolvedValue([]);
    render(<DigestPanel onFocus={() => {}} />);
    const btn = await screen.findByText("🔍 Find new links");
    await act(async () => { btn.click(); });
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("No new connections yet"), "🔍", expect.any(Number)),
    );
  });
});

describe("DigestPanel — IM-56: the daily digest renders its surfaced connections", () => {
  it("shows the connection text and fly-to pills, even on a connections-only day", async () => {
    const onFocus = vi.fn();
    getDailyDigest.mockResolvedValue({
      date: "2026-10-20",
      greeting: "",
      fresh: [],
      connections: [
        {
          id: 5,
          text: "Your marathon training and your night shifts are pulling the same thread.",
          score: 0.7,
          createdAt: "2026-10-20T12:00:00Z",
          nodes: [
            { id: 7, label: "Marathon plan", type: "goal" },
            { id: 8, label: "Night shifts", type: "memory" },
          ],
        },
      ],
      expiredActions: [],
      cooling: [],
      reminders: [],
      closing: "",
    });
    render(<DigestPanel onFocus={onFocus} />);
    await screen.findByText("🔗 Connections she surfaced today");
    expect(screen.getByText(/marathon training and your night shifts/)).toBeTruthy();
    const pill = screen.getByText("Marathon plan");
    act(() => pill.click());
    expect(onFocus).toHaveBeenCalledWith(7);
    const pill2 = screen.getByText("Night shifts");
    act(() => pill2.click());
    expect(onFocus).toHaveBeenCalledWith(8);
  });

  it("does not render the connections block when the digest has none", async () => {
    getDailyDigest.mockResolvedValue({
      date: "2026-10-20",
      greeting: "Morning.",
      fresh: [],
      connections: [],
      expiredActions: [],
      cooling: [],
      reminders: [],
      closing: "",
    });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Morning.");
    expect(screen.queryByText("🔗 Connections she surfaced today")).toBeNull();
  });
});

describe("DigestPanel — IM-57: insight rows show strength and local creation date", () => {
  it("renders the score as a percentage strength indicator and createdAt as a local date", async () => {
    const createdAt = "2026-10-20T02:30:00.000Z";
    getDigest.mockResolvedValue([
      {
        id: 11,
        text: "Sleep and spending move together in your notes.",
        score: 0.82,
        createdAt,
        kind: "synthesis",
        tier: 2,
        nodes: [{ id: 3, label: "Sleep log", type: "memory" }],
      },
    ]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText(/Sleep and spending move together/);
    // Strength: percentage text + a bar filled to the same proportion.
    expect(screen.getByText("82%")).toBeTruthy();
    const strength = document.querySelector(".insight-strength");
    expect(strength).toBeTruthy();
    expect(strength!.textContent).toContain("82%");
    // Local date: computed the same way the panel must (viewer-local), so
    // this holds in any timezone the suite runs under.
    const expectedDate = new Date(createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(screen.getByText(expectedDate)).toBeTruthy();
    // The raw stored timestamp must never leak as the visible date.
    expect(screen.queryByText(createdAt)).toBeNull();
  });

  it("omits the strength/date elements gracefully when the fields are absent", async () => {
    getDigest.mockResolvedValue([
      { id: 12, text: "A bare insight.", nodes: [] },
    ]);
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("A bare insight.");
    expect(document.querySelector(".insight-strength")).toBeNull();
    expect(document.querySelector(".insight-date")).toBeNull();
  });
});

describe("DigestPanel — an emotional-weather pattern can be dismissed", () => {
  it("hides a pattern after 'Got it' and persists the dismissal", async () => {
    getEmotionalTrajectory.mockResolvedValue({
      points: [{ date: "2026-08-28", valence: 0.1, count: 1 }, { date: "2026-08-29", valence: -0.2, count: 1 }, { date: "2026-08-30", valence: -0.1, count: 1 }],
      trend: "steady",
      average: -0.1,
      volatility: 0.2,
      sampleSize: 3,
      patterns: [{ type: "Stress cycle", trigger: "work", repeats: 2, intervention: "Take a short walk." }],
    });
    render(<DigestPanel onFocus={() => {}} />);
    await screen.findByText("Stress cycle");
    const dismissBtn = screen.getByText("✓ Got it");
    act(() => dismissBtn.click());
    expect(screen.queryByText("Stress cycle")).toBeNull();
    expect(pushToast).toHaveBeenCalledWith("Got it — noted.", "✓", expect.any(Number));
  });
});
