import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { GraphNode, AwayDigest } from "@brain/shared";

/**
 * IM-125 / IM-126 — Observatory fetched-but-unrendered fields + honesty fixes.
 *
 * IM-125: fields the server already sends must actually render — away
 * greeting/since, foresight inDays, constellation cohesion, insight
 * score/kind/tier/createdAt, finance upcoming bills (names/dates/amounts) +
 * weekEarnedCents + reserved lines, journey description/color/linkCount,
 * review strength/reviewCount.
 *
 * IM-126: timestamps exist (createdAt is no longer only a sort key); the
 * money card formats nextIncomeDate instead of interpolating the raw ISO
 * string; truncated labels carry their full text in a tooltip; the
 * discovery card no longer silently no-ops when nodeId is null.
 *
 * Falsification: every assertion below targets copy/structure absent from
 * the pre-change Observatory.
 */

const getDigestResult = vi.fn();
const getConstellationsResult = vi.fn();
const getDueReviewsResult = vi.fn();
const getDailyContact = vi.fn();
const getFinanceSummary = vi.fn();
const getJourneys = vi.fn();
const pushToast = vi.fn();

vi.mock("../api/client.js", () => ({
  getDigestResult: (...a: unknown[]) => getDigestResult(...a),
  getConstellationsResult: (...a: unknown[]) => getConstellationsResult(...a),
  getDueReviewsResult: (...a: unknown[]) => getDueReviewsResult(...a),
  getDailyContact: (...a: unknown[]) => getDailyContact(...a),
  answerDailyContact: vi.fn().mockResolvedValue(null),
}));
vi.mock("../api/finance.js", () => ({
  getFinanceSummary: (...a: unknown[]) => getFinanceSummary(...a),
}));
vi.mock("../api/journeys.js", () => ({
  getJourneys: (...a: unknown[]) => getJourneys(...a),
}));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("./SoumayaEye.js", () => ({ SoumayaEye: () => null }));

import { Observatory } from "./Observatory.js";

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  getDigestResult.mockResolvedValue({ ok: true, insights: [] });
  getConstellationsResult.mockResolvedValue({ ok: true, constellations: [] });
  getDueReviewsResult.mockResolvedValue({ ok: true, reviews: [] });
  getDailyContact.mockResolvedValue({
    date: "2026-10-20",
    question: null,
    discovery: null,
    foresight: null,
    answered: false,
  });
  getFinanceSummary.mockResolvedValue({
    budget: { balanceCents: 0, safeToSpendCents: 0, shortfallCents: 0, nextIncomeDate: "", weekEarnedCents: 0, reservedCents: 0, reserved: [] },
    account: {},
    upcoming: [],
  });
  getJourneys.mockResolvedValue([]);
});

function memory(over: Partial<GraphNode>): GraphNode {
  return { id: 1, label: "a memory", type: "memory", content: "", ...over } as GraphNode;
}

function renderObs(extra: Partial<React.ComponentProps<typeof Observatory>> = {}) {
  return render(
    <Observatory
      spaceName="You"
      memories={[memory({ id: 1, label: "a memory" })]}
      streak={0}
      fedToday={false}
      onCapture={vi.fn()}
      onFocus={vi.fn()}
      onOpenInsights={vi.fn()}
      onEnter={vi.fn()}
      {...extra}
    />,
  );
}

describe("IM-125 — fetched-but-unrendered fields now render", () => {
  it("away card: greeting + since", async () => {
    const away: AwayDigest = {
      since: "2026-10-19T08:00:00Z",
      awayMs: 30 * 3_600_000,
      greeting: "Welcome back — the galaxy kept turning.",
      agentActions: [],
      newContradictions: 0,
      expiredActions: 0,
      dueReminders: [],
      resurfaced: null,
      cooling: 0,
      isEmpty: false,
    };
    renderObs({ away });
    expect(await screen.findByText("Welcome back — the galaxy kept turning.")).toBeTruthy();
    expect(screen.getByText(/Away since Oct 19/)).toBeTruthy();
  });

  it("insights: kind, tier, score-as-strength and createdAt render", async () => {
    getDigestResult.mockResolvedValue({
      ok: true,
      insights: [
        {
          id: 5,
          text: "You say rest matters, but never rest.",
          score: 0.82,
          kind: "contradiction",
          tier: 1,
          createdAt: "2026-10-19 14:30:00",
          nodes: [],
        },
      ],
    });
    renderObs();
    expect(await screen.findByText("You say rest matters, but never rest.")).toBeTruthy();
    // The createdAt is LOCALISED (IM-126), so its calendar day depends on the
    // viewer's zone — assert the shape, not a zone-specific day (this suite
    // also runs under TZ=Pacific/Kiritimati via test:web:tz).
    const meta = screen.getByText(/contradiction · identity-level · strength 82% · Oct \d{1,2}, \d{1,2}:\d{2} [AP]M/);
    expect(meta).toBeTruthy();
  });

  it("constellations: cohesion renders on the chip", async () => {
    getConstellationsResult.mockResolvedValue({
      ok: true,
      constellations: [{ id: 1, name: "Deep Work", cohesion: 0.87, nodes: [{ id: 5, label: "x" }] }],
    });
    renderObs();
    const chip = await screen.findByText(/Deep Work/);
    expect(chip.textContent).toContain("87%");
    expect(chip.closest("button")!.getAttribute("title")).toContain("cohesion 87%");
  });

  it("review pick: strength + reviewCount render", async () => {
    getDueReviewsResult.mockResolvedValue({
      ok: true,
      reviews: [{ id: 42, label: "the studio lease", content: "…", strength: 0.1, reviewCount: 3 }],
    });
    renderObs();
    expect(await screen.findByText(/memory strength 10% · recalled 3 times before/)).toBeTruthy();
  });

  it("foresight: inDays renders as a human offset", async () => {
    getDailyContact.mockResolvedValue({
      date: "2026-10-20",
      question: null,
      discovery: null,
      foresight: { text: "Your writing streak usually breaks here.", inDays: 3 },
      answered: false,
    });
    renderObs();
    expect(await screen.findByText("expected in 3 days")).toBeTruthy();
  });

  it("finance: upcoming bills named with dates + amounts; week earned + reserved lines render", async () => {
    getFinanceSummary.mockResolvedValue({
      budget: {
        balanceCents: 50_000,
        safeToSpendCents: 12_300,
        shortfallCents: 0,
        nextIncomeDate: "2026-11-03",
        weekEarnedCents: 45_000,
        reservedCents: 18_000,
        reserved: [{ billId: 1, name: "Rent", amountCents: 18_000, dueDate: "2026-11-01" }],
      },
      account: {},
      upcoming: [
        { id: 11, billId: 2, name: "Electric Co", dueDate: "2026-10-28", amountCents: 8_650, status: "due" },
      ],
    });
    renderObs();
    expect(await screen.findByText("Electric Co")).toBeTruthy();
    expect(screen.getByText(/Oct 28, 2026 · \$86\.50/)).toBeTruthy();
    expect(screen.getByText("Earned this week $450")).toBeTruthy();
    expect(screen.getByText("Reserved for Rent")).toBeTruthy();
    expect(screen.getByText(/Nov 1, 2026 · \$180/)).toBeTruthy();
  });

  it("journeys: description, linkCount and colour dot render", async () => {
    getJourneys.mockResolvedValue([
      {
        id: 1,
        title: "Marathon",
        description: "Train for the spring race",
        color: "#ff8800",
        icon: "🏃",
        progress: 0.4,
        status: "active",
        linkCount: 7,
        createdAt: "2026-09-01",
        updatedAt: "2026-10-18",
      },
    ]);
    const { container } = renderObs();
    expect(await screen.findByText("Train for the spring race")).toBeTruthy();
    expect(screen.getByText(/7 linked/)).toBeTruthy();
    const dot = container.querySelector(".obs-jn-dot") as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.background).toBe("#ff8800");
  });
});

describe("IM-126 — timestamps, honest money copy, tooltips, discovery fallback", () => {
  it("money card formats nextIncomeDate instead of interpolating the raw string", async () => {
    getFinanceSummary.mockResolvedValue({
      budget: {
        balanceCents: 10_000,
        safeToSpendCents: 0,
        shortfallCents: 2_500,
        nextIncomeDate: "2026-11-03",
        weekEarnedCents: 0,
        reservedCents: 0,
        reserved: [],
      },
      account: {},
      upcoming: [],
    });
    renderObs();
    const line = await screen.findByText(/short \$25 before Nov 3, 2026/);
    expect(line).toBeTruthy();
    expect(screen.queryByText(/2026-11-03/)).toBeNull();
  });

  it("recent chips: full label in the tooltip + a visible date", async () => {
    const longLabel = "A very long memory label that will definitely be truncated";
    renderObs({
      memories: [memory({ id: 3, label: longLabel, createdAt: "2026-10-20T10:00:00Z" })],
    });
    const btn = (await screen.findByTitle(new RegExp(longLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).closest("button")!;
    expect(btn.getAttribute("title")).toContain(longLabel);
    expect(btn.textContent).toContain("A very long memory label tha…");
    // Visible date = the memory's instant localised (zone-dependent day).
    const expectedDate = new Date("2026-10-20T10:00:00Z").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(btn.textContent).toContain(expectedDate);
  });

  it("away reminder chips carry the full label in the tooltip", async () => {
    const longLabel = "Renew the studio lease before it lapses";
    const away: AwayDigest = {
      since: "2026-10-19T08:00:00Z",
      awayMs: 3_600_000,
      greeting: "",
      agentActions: [],
      newContradictions: 0,
      expiredActions: 0,
      dueReminders: [{ id: 9, label: longLabel }],
      resurfaced: null,
      cooling: 0,
      isEmpty: false,
    };
    renderObs({ away });
    const chip = await screen.findByTitle(new RegExp(longLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect(chip.closest("button")!.getAttribute("title")).toContain(longLabel);
    expect(chip.textContent).toContain("Renew the studio lease b…");
  });

  it("discovery with nodeId: null toasts + falls back instead of silently no-opping", async () => {
    const onOpenInsights = vi.fn();
    const onFocus = vi.fn();
    getDailyContact.mockResolvedValue({
      date: "2026-10-20",
      question: null,
      discovery: { text: "A pattern across your notes", nodeId: null },
      foresight: null,
      answered: false,
    });
    renderObs({ onOpenInsights, onFocus });
    const card = await screen.findByText("A pattern across your notes");
    fireEvent.click(card.closest("button")!);
    expect(onFocus).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalled();
    expect(onOpenInsights).toHaveBeenCalled();
  });

  it("discovery with a nodeId still flies to it (no toast)", async () => {
    const onFocus = vi.fn();
    getDailyContact.mockResolvedValue({
      date: "2026-10-20",
      question: null,
      discovery: { text: "A find with a home", nodeId: 77 },
      foresight: null,
      answered: false,
    });
    renderObs({ onFocus });
    const card = await screen.findByText("A find with a home");
    fireEvent.click(card.closest("button")!);
    expect(onFocus).toHaveBeenCalledWith(77);
    expect(pushToast).not.toHaveBeenCalled();
  });
});
