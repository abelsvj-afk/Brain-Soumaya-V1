import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AwayDigest, GraphNode } from "@brain/shared";

/** Same cwd-relative reader Observatory.batchB.test.tsx uses. */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}
/** Strip CSS comments, then return the body of the FIRST rule matching the selector. */
function ruleBody(css: string, selector: string): string | null {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const m = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(clean);
  return m ? m[1]! : null;
}
/** A rule whose selector LIST contains the given selector (e.g. ".a, .b { ... }"). */
function ruleBodyContaining(css: string, selector: string): string | null {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const selectors = m[1]!.split(",").map((s) => s.trim());
    if (selectors.includes(selector)) return m[2]!;
  }
  return null;
}

/**
 * Batch J — Observatory items:
 *  REG-074 (OB-02) header escape controls are 46px and stay on screen (sticky header);
 *  REG-076 (OB-07) non-interactive cards wear no interactive affordance;
 *  REG-077 (OB-08) a stalled source fails within the ~12s boot-read precedent;
 *  REG-078 (OB-09) Escape / backdrop click dismiss the dialog;
 *  REG-080 (OB-11) the cooling number is worded as the standing state it is.
 */

const getDigestResult = vi.fn();
const getConstellationsResult = vi.fn();
const getDueReviewsResult = vi.fn();
const getDailyContact = vi.fn();
const answerDailyContact = vi.fn();
const getFinanceSummary = vi.fn();
const getJourneys = vi.fn();
const onEnter = vi.fn();

vi.mock("../api/client.js", () => ({
  getDigestResult: (...a: unknown[]) => getDigestResult(...a),
  getConstellationsResult: (...a: unknown[]) => getConstellationsResult(...a),
  getDueReviewsResult: (...a: unknown[]) => getDueReviewsResult(...a),
  getDailyContact: (...a: unknown[]) => getDailyContact(...a),
  answerDailyContact: (...a: unknown[]) => answerDailyContact(...a),
}));
vi.mock("../api/finance.js", () => ({
  getFinanceSummary: (...a: unknown[]) => getFinanceSummary(...a),
}));
vi.mock("../api/journeys.js", () => ({
  getJourneys: (...a: unknown[]) => getJourneys(...a),
}));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));
vi.mock("./SoumayaEye.js", () => ({ SoumayaEye: () => null }));

import { Observatory } from "./Observatory.js";

function memory(over: Partial<GraphNode>): GraphNode {
  return { id: 1, label: "a memory", type: "memory", content: "", ...over } as GraphNode;
}

function awayFixture(over: Partial<AwayDigest> = {}): AwayDigest {
  return {
    since: "2026-10-20T10:00:00.000Z",
    awayMs: 5 * 3_600_000,
    greeting: "Welcome back.",
    agentActions: [],
    newContradictions: 0,
    expiredActions: 0,
    dueReminders: [],
    resurfaced: null,
    cooling: 3,
    isEmpty: false,
    ...over,
  };
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
      onEnter={onEnter}
      onSearch={vi.fn()}
      {...extra}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getDigestResult.mockResolvedValue({ ok: true, insights: [] });
  getConstellationsResult.mockResolvedValue({ ok: true, constellations: [] });
  getDueReviewsResult.mockResolvedValue({ ok: true, reviews: [] });
  getDailyContact.mockResolvedValue(null);
  getFinanceSummary.mockResolvedValue(null);
  getJourneys.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe("REG-074 — the header escape controls stay on screen at the 46px standard", () => {
  it("the header is sticky (it cannot scroll away with the stack)", () => {
    const css = readRepoFile("src/index.css");
    const body = ruleBody(css, ".obs-head");
    expect(body, ".obs-head rule exists").toBeTruthy();
    expect(body).toMatch(/position:\s*sticky/);
    expect(body).toMatch(/top:\s*0/);
  });

  it("the close and search controls are 46px, not 32px", () => {
    const css = readRepoFile("src/index.css");
    for (const sel of [".obs-close", ".obs-search"]) {
      const body = ruleBody(css, sel);
      expect(body, `${sel} rule exists`).toBeTruthy();
      expect(body).toMatch(/width:\s*46px/);
      expect(body).toMatch(/height:\s*46px/);
      expect(body).not.toMatch(/width:\s*32px/);
    }
  });

  it("renders the close control (the guaranteed exit is in the header)", async () => {
    renderObs();
    expect(await screen.findByRole("button", { name: /close and enter the galaxy/i })).toBeTruthy();
  });
});

describe("REG-076 — non-interactive cards wear no interactive affordance", () => {
  it("the away, contact, foresight and observations cards opt out of pointer + lift", () => {
    const css = readRepoFile("src/index.css");
    for (const sel of [".obs-away", ".obs-contact", ".obs-foresight", ".obs-observations"]) {
      const body = ruleBodyContaining(css, sel);
      expect(body, `${sel} appears in a cursor rule`).toBeTruthy();
      expect(body).toMatch(/cursor:\s*default/);
      const hover = ruleBodyContaining(css, `${sel}:hover`);
      expect(hover, `${sel}:hover override exists`).toBeTruthy();
      expect(hover).toMatch(/transform:\s*none/);
    }
  });
});

describe("REG-077 — a stalled source fails within the boot-read precedent", () => {
  it("every Observatory fetch passes the 12s boot timeout", async () => {
    renderObs();
    // All six loaders run on mount; each must carry BOOT_TIMEOUT_MS (12_000),
    // not the 60s default, so a blackholed endpoint names its failure + Retry
    // within ~12s instead of holding the skeleton for a minute.
    await screen.findByRole("button", { name: /close and enter the galaxy/i });
    expect(getDigestResult).toHaveBeenCalledWith(12000);
    expect(getConstellationsResult).toHaveBeenCalledWith(12000);
    expect(getDailyContact).toHaveBeenCalledWith(12000);
    expect(getFinanceSummary).toHaveBeenCalledWith(12000);
    expect(getJourneys).toHaveBeenCalledWith(12000);
    expect(getDueReviewsResult).toHaveBeenCalledWith(12000);
  });
});

describe("REG-078 — Escape and backdrop click dismiss the Observatory", () => {
  it("Escape dismisses from any focus state inside it", async () => {
    renderObs();
    await screen.findByRole("button", { name: /close and enter the galaxy/i });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("clicking the backdrop (the overlay itself, not a card) dismisses", async () => {
    const { container } = renderObs();
    const root = container.querySelector(".observatory") as HTMLElement;
    expect(root).toBeTruthy();
    fireEvent.click(root);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("clicking a card does NOT dismiss", async () => {
    const { container } = renderObs({ away: awayFixture() });
    const card = container.querySelector(".obs-away") as HTMLElement;
    expect(card).toBeTruthy();
    fireEvent.click(card);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("Escape dismisses the empty-brain hero too", async () => {
    render(
      <Observatory
        spaceName="You"
        memories={[]}
        streak={0}
        fedToday={false}
        onCapture={vi.fn()}
        onFocus={vi.fn()}
        onOpenInsights={vi.fn()}
        onEnter={onEnter}
      />,
    );
    await screen.findByText(/Your galaxy is empty/);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});

describe("REG-080 — the cooling number is worded as a standing state", () => {
  it("the away card says the cooling count is a total, not an away delta", async () => {
    renderObs({ away: awayFixture({ cooling: 3 }) });
    expect(await screen.findByText(/3 cooling in total/)).toBeTruthy();
    expect(screen.queryByText(/❄️ 3 cooling$/)).toBeNull();
  });
});
