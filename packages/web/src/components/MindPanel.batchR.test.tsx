import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WealthSummary } from "@brain/shared";
import type { CognitiveItem, Thought, PersonProfile } from "../api/mind.js";

/**
 * Batch R — REG-231: every MindPanel `.mini` control meets the 46px touch
 * standard or is an explicitly recorded surface exception, with visible
 * captions / accessible names. The audit enumerated the full rendered set
 * inside `.mind-panel` (31 instances):
 *
 *   MindPanel.tsx (26): "+N more"/"Show less", "Hold", Retry ×5 (thoughts,
 *   suggestions, events, load-empty, load-stale), mote Edit/Keep/Promote/
 *   Let go, add-form Cancel, "Clear" filters, edit-form Save/Cancel, card
 *   Edit/Delete, skill –/+, Split, Select for merge, Split…/Cancel,
 *   "+ Link", Merge…/Clear.
 *   MemoryAttachments.tsx (3, rendered inside the panel): "+ Add", Retry,
 *   and the per-file remove — the remove is the ONE recorded exception
 *   (32px, dense file-list row; visible "Remove" + accessible name).
 *   ConfirmDialog.tsx (2, rendered inside the panel): Cancel + confirm.
 *
 * Sizing is pinned by the CSS rule (jsdom has no layout); naming is pinned
 * on the rendered buttons. The two `.mind-ev-chip-x` unlink chips are NOT
 * `.mini` controls and stay with Batch L's MIN-08 scope.
 */

/** Same cwd-relative reader Observatory.batchB.test.tsx uses. */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}
function ruleBody(css: string, selector: string): string | null {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`);
  return re.exec(css)?.[1] ?? null;
}

const getCognitive = vi.fn();
const getCognitiveResult = vi.fn();
const createCognitive = vi.fn();
const updateCognitive = vi.fn();
const setCognitiveProgress = vi.fn();
const getUpcomingEvents = vi.fn();
const getUpcomingEventsResult = vi.fn();
const getThoughts = vi.fn();
const getThoughtsResult = vi.fn();
const addThought = vi.fn();
const getPersonSuggestions = vi.fn();
const getPersonSuggestionsResult = vi.fn();
const getCognitiveEvidence = vi.fn();
const getPersonProfile = vi.fn();
const deleteNode = vi.fn();
const splitIdea = vi.fn();
const mergeIdeas = vi.fn();
vi.mock("../api/client.js", () => ({
  getCognitive: (...a: unknown[]) => getCognitive(...a),
  getCognitiveResult: (...a: unknown[]) => getCognitiveResult(...a),
  createCognitive: (...a: unknown[]) => createCognitive(...a),
  updateCognitive: (...a: unknown[]) => updateCognitive(...a),
  setCognitiveProgress: (...a: unknown[]) => setCognitiveProgress(...a),
  getUpcomingEvents: (...a: unknown[]) => getUpcomingEvents(...a),
  getUpcomingEventsResult: (...a: unknown[]) => getUpcomingEventsResult(...a),
  promoteIdea: vi.fn(),
  splitIdea: (...a: unknown[]) => splitIdea(...a),
  mergeIdeas: (...a: unknown[]) => mergeIdeas(...a),
  unlinkCognitive: vi.fn(),
  pruneCognitive: vi.fn(),
  getCognitiveEvidence: (...a: unknown[]) => getCognitiveEvidence(...a),
  getPersonProfile: (...a: unknown[]) => getPersonProfile(...a),
  getPersonSuggestions: (...a: unknown[]) => getPersonSuggestions(...a),
  getPersonSuggestionsResult: (...a: unknown[]) => getPersonSuggestionsResult(...a),
  dismissPersonSuggestion: vi.fn(),
  getThoughts: (...a: unknown[]) => getThoughts(...a),
  getThoughtsResult: (...a: unknown[]) => getThoughtsResult(...a),
  addThought: (...a: unknown[]) => addThought(...a),
  reinforceThought: vi.fn(),
  promoteThought: vi.fn(),
  dismissThought: vi.fn(),
  editThought: vi.fn(),
  deleteNode: (...a: unknown[]) => deleteNode(...a),
}));

const getWealthSummary = vi.fn();
const getWealthSummaryResult = vi.fn();
const patchGoal = vi.fn();
vi.mock("../api/finance.js", () => ({
  getWealthSummary: (...a: unknown[]) => getWealthSummary(...a),
  getWealthSummaryResult: (...a: unknown[]) => getWealthSummaryResult(...a),
  patchGoal: (...a: unknown[]) => patchGoal(...a),
}));

vi.mock("./MemoryAttachments.js", () => ({ MemoryAttachments: () => null }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));
vi.mock("./MindSpace.js", () => ({ mindSpaceEnabled: () => false, setMindSpaceEnabled: vi.fn() }));

import { MindPanel } from "./MindPanel.js";

function vision(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 1, kind: "life_vision", label: "Our first house", content: "A place with a garden",
    progress: 0, completedAt: null, degree: 0, aliases: [],
    createdAt: "2026-01-01 00:00:00", remindAt: null, ...over,
  };
}
function goalItem(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 2, kind: "goal", label: "Run a 5k", content: "", progress: 0.3,
    completedAt: null, degree: 0, aliases: [],
    createdAt: "2026-01-01 00:00:00", remindAt: null, ...over,
  };
}
function skillItem(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 3, kind: "skill", label: "Korean", content: "", progress: 0.4,
    completedAt: null, degree: 0, aliases: [],
    createdAt: "2026-01-01 00:00:00", remindAt: null, ...over,
  };
}
function ideaItem(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 5, kind: "idea", label: "Boat project", content: "", progress: null,
    completedAt: null, degree: 0, aliases: [],
    createdAt: "2026-01-01 00:00:00", remindAt: null, ...over,
  };
}
function personItem(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 8, kind: "person_entity", label: "Mara", content: "", progress: null,
    completedAt: null, degree: 1, aliases: [],
    createdAt: "2026-01-01 00:00:00", remindAt: null, ...over,
  };
}
function thought(over: Partial<Thought> = {}): Thought {
  return { id: 1, text: "old words", source: "manual", strength: 0.8, reinforceCount: 0, createdAt: "2026-01-01", ...over };
}
function profile(over: Partial<PersonProfile> = {}): PersonProfile {
  return {
    count: 1, lastAt: "2026-09-03 10:00:00", tone: "warm",
    interactions: [{ id: 42, label: "Dinner with Mara", createdAt: "2026-09-03 10:00:00", emotionalWeight: 0.9 }],
    ...over,
  };
}
function wealth(over: Partial<WealthSummary> = {}): WealthSummary {
  return { buckets: [], goals: [], allocatedCents: 0, deployableCents: 0, reconciliation: "ok", ...over };
}

beforeEach(() => {
  vi.resetAllMocks();
  getCognitive.mockResolvedValue([]);
  getCognitiveResult.mockImplementation(async (...a: unknown[]) => ({
    ok: true as const,
    items: (await getCognitive(...a)) as CognitiveItem[],
  }));
  getUpcomingEvents.mockResolvedValue([]);
  getThoughts.mockResolvedValue([]);
  getPersonSuggestions.mockResolvedValue([]);
  getThoughtsResult.mockImplementation(async (...a: unknown[]) => ({
    ok: true as const,
    thoughts: (await getThoughts(...a)) as never[],
  }));
  getPersonSuggestionsResult.mockImplementation(async (...a: unknown[]) => ({
    ok: true as const,
    suggestions: (await getPersonSuggestions(...a)) as never[],
  }));
  getUpcomingEventsResult.mockImplementation(async (...a: unknown[]) => ({
    ok: true as const,
    events: (await getUpcomingEvents(...a)) as never[],
  }));
  getCognitiveEvidence.mockResolvedValue({ for: [], against: [], confidence: 0 });
  getPersonProfile.mockResolvedValue(null);
  deleteNode.mockResolvedValue(undefined);
  splitIdea.mockResolvedValue({ newId: 99, moved: 0 });
  mergeIdeas.mockResolvedValue(true);
  setCognitiveProgress.mockResolvedValue(true);
  getWealthSummary.mockResolvedValue(wealth());
  // Rebase consequence (Batch L MIN-07): the Financial Goals expansion now
  // loads through the strict getWealthSummaryResult, not the fail-soft
  // getWealthSummary — mirror the real wrapper so the Result mock follows
  // whatever the base mock resolves to.
  getWealthSummaryResult.mockImplementation(async (...a: unknown[]) => {
    const s = await getWealthSummary(...a);
    return s ? { ok: true as const, summary: s } : { ok: false as const };
  });
});
afterEach(() => cleanup());

/** Every `.mini` button in the render has a visible caption and an accessible name. */
function expectMinisNamed(container: HTMLElement) {
  const minis = Array.from(container.querySelectorAll("button.mini")) as HTMLButtonElement[];
  expect(minis.length, "this render has .mini controls to pin").toBeGreaterThan(0);
  for (const b of minis) {
    const visible = (b.textContent ?? "").trim();
    expect(visible, `mini button has a visible caption (aria-label=${b.getAttribute("aria-label")})`).toBeTruthy();
    const name = b.getAttribute("aria-label") ?? b.getAttribute("title") ?? visible;
    expect((name ?? "").trim(), `mini "${visible}" has an accessible name`).toBeTruthy();
  }
  return minis;
}

describe("REG-231 — every MindPanel .mini control meets the 46px standard", () => {
  it("the CSS sizes every .mini in the panel at 46px, with one recorded 32px exception", () => {
    const css = readRepoFile("src/index.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const blanket = ruleBody(css, ".mind-panel .mini");
    expect(blanket, ".mind-panel .mini rule exists").toBeTruthy();
    expect(blanket).toMatch(/min-height:\s*46px/);
    // The mote row wraps so the captioned 46px targets can drop below the
    // thought text on narrow screens instead of squeezing it.
    const moteActions = ruleBody(css, ".mind-mote-actions");
    expect(moteActions, ".mind-mote-actions rule exists").toBeTruthy();
    expect(moteActions).toMatch(/flex-wrap:\s*wrap/);
    const gap = /gap:\s*(\d+)px/.exec(moteActions!);
    expect(gap, "mote actions have a px gap").toBeTruthy();
    expect(Number(gap![1])).toBeGreaterThanOrEqual(6);
    // The one exception: the per-file attachment remove (dense file-list
    // row) is 32px, visibly named — and the source says so next to it.
    const attRemove = ruleBody(css, ".mind-panel .att-remove");
    expect(attRemove, ".mind-panel .att-remove exception rule exists").toBeTruthy();
    expect(attRemove).toMatch(/min-height:\s*32px/);
    const attachments = readRepoFile("src/components/MemoryAttachments.tsx");
    expect(attachments).toMatch(/className="mini att-remove"/);
    expect(attachments).toMatch(/aria-label=\{`Remove \$\{a\.filename\}`\}/);
    expect(attachments).toMatch(/✕ Remove/);
  });

  it("working memory: Hold + mote actions carry visible captions and names", async () => {
    getThoughts.mockResolvedValue([thought()]);
    const { container } = render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("old words");
    expect(screen.getByRole("button", { name: "Hold" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /edit thought/i }).textContent).toMatch(/Edit/);
    expect(screen.getByRole("button", { name: /keep thought/i }).textContent).toMatch(/Keep/);
    expect(screen.getByRole("button", { name: /make .* memory/i }).textContent).toMatch(/Promote/);
    expect(screen.getByRole("button", { name: /let go/i }).textContent).toMatch(/Let go/);
    expectMinisNamed(container);
  });

  it("every Retry door is a named .mini (thoughts, suggestions, events, mind load)", async () => {
    getThoughtsResult.mockResolvedValue({ ok: false });
    getPersonSuggestionsResult.mockResolvedValue({ ok: false });
    getUpcomingEventsResult.mockResolvedValue({ ok: false });
    getCognitiveResult.mockResolvedValue({ ok: false });
    const { container } = render(<MindPanel onFocus={() => {}} />);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Retry" }).length).toBeGreaterThanOrEqual(4));
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBe(4);
    expectMinisNamed(container);
  });

  it("cards, skill steppers, edit form, split/merge and filters are all named .minis", async () => {
    getCognitive.mockResolvedValue([
      goalItem(),
      skillItem(),
      ideaItem(),
      ideaItem({ id: 6, label: "Sail the coast" }),
    ]);
    const { container } = render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    // Card Edit/Delete carry visible captions.
    expect(screen.getByRole("button", { name: /edit run a 5k/i }).textContent).toMatch(/Edit/);
    expect(screen.getByRole("button", { name: /delete run a 5k/i }).textContent).toMatch(/Delete/);
    // Skill –/+ are named steppers (the glyph is the visible caption).
    expect(screen.getByRole("button", { name: /decrease progress for korean/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /increase progress for korean/i })).toBeTruthy();
    // Split + merge toggles (one per idea).
    expect(screen.getAllByRole("button", { name: /^✂ split$/i })[0]!.textContent).toMatch(/Split/);
    // Edit form: Save/Cancel appear after Edit.
    fireEvent.click(screen.getByRole("button", { name: /edit run a 5k/i }));
    expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Split form: Split…/Cancel appear after Split.
    fireEvent.click(screen.getAllByRole("button", { name: /split/i })[0]!);
    expect(await screen.findByRole("button", { name: /split…/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Merge bar: select two ideas, Merge…/Clear appear.
    const selects = screen.getAllByRole("button", { name: /select for merge/i });
    fireEvent.click(selects[0]!);
    fireEvent.click(selects[1]!);
    expect(await screen.findByRole("button", { name: /merge…/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    // "Clear" filters appears once a search is active (alongside the
    // merge bar's own Clear — both are named .minis).
    fireEvent.change(screen.getByLabelText("Search your mind"), { target: { value: "boat" } });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Clear" }).length).toBe(2));
    expectMinisNamed(container);
  });

  it("add-form Cancel and the delete confirm dialog are named .minis", async () => {
    getCognitive.mockResolvedValue([goalItem()]);
    const { container } = render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    fireEvent.click(screen.getByText("+ Map something in your mind"));
    expect(await screen.findByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /delete run a 5k/i }));
    expect(await screen.findByText(/Delete this from your mind\?/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expectMinisNamed(container);
  });

  it("vision goal linking (+ Link) and the person +N more toggle are named .minis", async () => {
    getCognitive.mockResolvedValue([vision(), personItem()]);
    getWealthSummary.mockResolvedValue(
      wealth({
        goals: [
          { id: 11, bucketId: 1, name: "Unrelated", targetCents: 1000, archived: false, createdAt: "x", visionNodeId: null, totalCents: 0, fillPct: 0, state: "goal_filling" },
        ],
      }),
    );
    getPersonProfile.mockResolvedValue(
      profile({
        count: 13,
        interactions: Array.from({ length: 13 }, (_, i) => ({
          id: 100 + i, label: `Chat ${i + 1}`, createdAt: "2026-09-03 10:00:00", emotionalWeight: 0.5,
        })),
      }),
    );
    const { container } = render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    fireEvent.click(screen.getByText(/Financial Goals/));
    expect(await screen.findByRole("button", { name: "+ Link" })).toBeTruthy();
    fireEvent.click(screen.getByText(/Relationship/));
    expect(await screen.findByRole("button", { name: "+1 more" })).toBeTruthy();
    expectMinisNamed(container);
  });
});
