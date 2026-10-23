import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent, within } from "@testing-library/react";
import type { WealthSummary } from "@brain/shared";
import type { CognitiveItem } from "../api/mind.js";

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
const patchGoal = vi.fn();
vi.mock("../api/finance.js", () => ({
  getWealthSummary: (...a: unknown[]) => getWealthSummary(...a),
  patchGoal: (...a: unknown[]) => patchGoal(...a),
}));

vi.mock("./MemoryAttachments.js", () => ({ MemoryAttachments: () => null }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));
vi.mock("./MindSpace.js", () => ({ mindSpaceEnabled: () => false, setMindSpaceEnabled: vi.fn() }));

import { MindPanel } from "./MindPanel.js";
import { pushToast } from "./Toasts.js";
const pushToastMock = pushToast as unknown as ReturnType<typeof vi.fn>;

function vision(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 1,
    kind: "life_vision",
    label: "Our first house",
    content: "A place with a garden",
    progress: 0,
    completedAt: null,
    degree: 0,
    aliases: [],
    createdAt: "2026-01-01 00:00:00",
    remindAt: null,
    ...over,
  };
}
function goalItem(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 2,
    kind: "goal",
    label: "Run a 5k",
    content: "",
    progress: 0.3,
    completedAt: null,
    degree: 0,
    aliases: [],
    createdAt: "2026-01-01 00:00:00",
    remindAt: null,
    ...over,
  };
}
function wealth(over: Partial<WealthSummary> = {}): WealthSummary {
  return { buckets: [], goals: [], allocatedCents: 0, deployableCents: 0, reconciliation: "ok", ...over };
}

beforeEach(() => {
  vi.resetAllMocks();
  getCognitive.mockResolvedValue([]);
  // MindPanel now loads via getCognitiveResult; by default it faithfully
  // wraps the getCognitive mock so existing tests keep their setup.
  getCognitiveResult.mockImplementation(async (...a: unknown[]) => ({
    ok: true as const,
    items: (await getCognitive(...a)) as CognitiveItem[],
  }));
  getUpcomingEvents.mockResolvedValue([]);
  getThoughts.mockResolvedValue([]);
  getPersonSuggestions.mockResolvedValue([]);
  // CL-4 (IM-45): the panel now loads thoughts/suggestions/events via the
  // truthful-state Result variants; by default they faithfully wrap the legacy
  // mocks so existing setups keep working. Failure tests override the Result
  // mock directly with { ok: false }.
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
});
afterEach(() => cleanup());

describe("MindPanel — Life Vision creation", () => {
  it("Life Vision is selectable as a kind, with correct locked terminology", async () => {
    render(<MindPanel onFocus={() => {}} />);
    fireEvent.click(await screen.findByText("+ Map something in your mind"));
    expect(screen.getByText(/🌅 Life Vision/)).toBeTruthy();
    // Locked vocabulary: never bare "Vision" or "Life Goal" on the kind button itself.
    expect(screen.queryByText(/^Vision$/)).toBeNull();
    expect(screen.queryByText(/Life Goal/)).toBeNull();
  });

  it("shows a 'Target date' field (not 'When?') once Life Vision is chosen, and creates with it", async () => {
    createCognitive.mockResolvedValue({ id: 42 });
    render(<MindPanel onFocus={() => {}} />);
    fireEvent.click(await screen.findByText("+ Map something in your mind"));
    fireEvent.click(screen.getByText(/🌅 Life Vision/));
    expect(screen.getByText("Target date (optional)")).toBeTruthy();
    expect(screen.queryByText("When?")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/Name this life vision/i), { target: { value: "Our first house" } });
    fireEvent.change(screen.getByLabelText("Target date for this Life Vision"), { target: { value: "2030-06-01" } });
    fireEvent.click(screen.getByText("Add Life Vision"));

    await waitFor(() => expect(createCognitive).toHaveBeenCalled());
    const args = createCognitive.mock.calls[0]!;
    expect(args[0]).toBe("life_vision");
    expect(args[1]).toBe("Our first house");
    expect(typeof args[3]).toBe("string"); // the ISO date was computed
  });

  it("a Life Vision with no title, no date, no content is still a valid, submittable draft", async () => {
    render(<MindPanel onFocus={() => {}} />);
    fireEvent.click(await screen.findByText("+ Map something in your mind"));
    fireEvent.click(screen.getByText(/🌅 Life Vision/));
    // No target date required — the Add button's only real gate is a non-empty title.
    expect(screen.getByText("Add Life Vision").hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Name this life vision/i), { target: { value: "x" } });
    expect(screen.getByText("Add Life Vision").hasAttribute("disabled")).toBe(false);
  });
});

describe("MindPanel — card aka line", () => {
  it("renders a well-formed aliases array as 'aka …' on the card", async () => {
    getCognitive.mockResolvedValue([goalItem({ aliases: ["5k", "race day"] })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    expect(screen.getByText(/aka 5k, race day/)).toBeTruthy();
  });
});

describe("MindPanel — Life Vision target date display (never a reminder)", () => {
  it("shows 'no target date' when unset", async () => {
    getCognitive.mockResolvedValue([vision({ remindAt: null })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText("no target date")).toBeTruthy();
  });

  it("an unparseable remindAt falls back to 'no target date', never the literal 'Invalid Date'", async () => {
    getCognitive.mockResolvedValue([vision({ remindAt: "not a date" })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText("no target date")).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it("shows a plain future date, never reminder/overdue language", async () => {
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    getCognitive.mockResolvedValue([vision({ remindAt: future })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText(/target:/)).toBeTruthy();
    expect(screen.queryByText(/overdue/)).toBeNull();
    expect(screen.queryByText(/[Rr]eminder/)).toBeNull();
  });

  it("shows a quiet 'target date passed' cue for a past date, never 'overdue'", async () => {
    const past = new Date(Date.now() - 365 * 86_400_000).toISOString();
    getCognitive.mockResolvedValue([vision({ remindAt: past })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText(/target date passed/)).toBeTruthy();
    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it("a naive SQLite-format remindAt is read as UTC (parseTolerantMs), not local time", async () => {
    // "2026-10-20 01:30:00" is the stored column-default shape. Read as UTC it
    // is Oct 19 evening in America/New_York; a direct new Date() reads it as
    // local wall time (Oct 20). The label must show the tolerant-parser date —
    // the same date every other panel shows for this instant.
    const { parseTolerantMs } = await import("../utils/dueReminders.js");
    const remindAt = "2026-10-20 01:30:00";
    const expectedDate = new Date(parseTolerantMs(remindAt)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    getCognitive.mockResolvedValue([vision({ remindAt })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText(new RegExp(expectedDate))).toBeTruthy();
  });

  it("existing future_event overdue/in-Nd labeling is unchanged (regression)", async () => {
    getCognitive.mockResolvedValue([vision({ id: 9, kind: "future_event", label: "Conference" })]);
    getUpcomingEvents.mockResolvedValue([{ id: 9, label: "Conference", date: "2026-01-01", inDays: -3 }]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Conference");
    // IM-48 supersedes the relative-only label: the relative wording is
    // unchanged, and the absolute local date now rides alongside it.
    expect(screen.getByText(/overdue 3d · /)).toBeTruthy();
  });
});

describe("MindPanel — Life Vision progress is manual and independent of financial funding", () => {
  it("bump buttons adjust progress via the existing setCognitiveProgress mechanism", async () => {
    getCognitive.mockResolvedValue([vision({ progress: 0.3 })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText("30%")).toBeTruthy();
    fireEvent.click(screen.getByTitle("More"));
    expect(setCognitiveProgress).toHaveBeenCalledWith(1, 0.4);
  });
});

describe("MindPanel — Life Vision Financial Goals section", () => {
  it("shows 'No Financial Goals linked' and the financial requirement is never shown as $0 when nothing is linked", async () => {
    getCognitive.mockResolvedValue([vision()]);
    getWealthSummary.mockResolvedValue(wealth({ goals: [] }));
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    fireEvent.click(screen.getByText(/Financial Goals/));
    await screen.findByText(/No Financial Goals linked/);
    expect(screen.queryByText(/\$0/)).toBeNull();
  });

  it("displays linked goals, their progress, and the derived financial requirement", async () => {
    getCognitive.mockResolvedValue([vision()]);
    getWealthSummary.mockResolvedValue(
      wealth({
        goals: [
          { id: 10, bucketId: 1, name: "Down Payment", targetCents: 50_000_00, archived: false, createdAt: "x", visionNodeId: 1, totalCents: 18_000_00, fillPct: 0.36, state: "goal_filling" },
          { id: 11, bucketId: 1, name: "Unrelated", targetCents: 1000, archived: false, createdAt: "x", visionNodeId: null, totalCents: 0, fillPct: 0, state: "goal_filling" },
        ],
      }),
    );
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    fireEvent.click(screen.getByText(/Financial Goals/));
    await screen.findByText(/Financial requirement/);
    expect(screen.getAllByText(/\$50,000\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Down Payment/)).toBeTruthy();
    // "Unrelated" is unlinked, so it correctly appears only as a pickable option —
    // never as one of THIS vision's linked chips.
    expect(screen.queryByText("Unrelated")).toBeNull();
    expect(within(screen.getByLabelText("Choose a Financial Goal to link")).getByText(/Unrelated/)).toBeTruthy();
  });

  it("shows an open-ended linked goal without fabricating a dollar value", async () => {
    getCognitive.mockResolvedValue([vision()]);
    getWealthSummary.mockResolvedValue(
      wealth({
        goals: [{ id: 12, bucketId: 1, name: "General fund", targetCents: null, archived: false, createdAt: "x", visionNodeId: 1, totalCents: 5000, fillPct: null, state: "goal_filling" }],
      }),
    );
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    fireEvent.click(screen.getByText(/Financial Goals/));
    await screen.findByText(/open-ended Financial Goal/);
  });

  it("links an unlinked Financial Goal via the picker", async () => {
    getCognitive.mockResolvedValue([vision()]);
    getWealthSummary.mockResolvedValue(
      wealth({ goals: [{ id: 20, bucketId: 1, name: "Closing Costs", targetCents: 10_000_00, archived: false, createdAt: "x", visionNodeId: null, totalCents: 0, fillPct: 0, state: "goal_filling" }] }),
    );
    patchGoal.mockResolvedValue({ id: 20 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    fireEvent.click(screen.getByText(/Financial Goals/));
    const select = await screen.findByLabelText("Choose a Financial Goal to link");
    fireEvent.change(select, { target: { value: "20" } });
    fireEvent.click(screen.getByText("+ Link"));
    await waitFor(() => expect(patchGoal).toHaveBeenCalledWith(20, { visionNodeId: 1 }));
  });

  it("unlinks a Financial Goal, which sends visionNodeId: null explicitly", async () => {
    getCognitive.mockResolvedValue([vision()]);
    getWealthSummary.mockResolvedValue(
      wealth({ goals: [{ id: 30, bucketId: 1, name: "Moving Costs", targetCents: 5000, archived: false, createdAt: "x", visionNodeId: 1, totalCents: 0, fillPct: 0, state: "goal_filling" }] }),
    );
    patchGoal.mockResolvedValue({ id: 30 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    fireEvent.click(screen.getByText(/Financial Goals/));
    const unlinkBtn = await screen.findByTitle(/Unlink "Moving Costs"/);
    fireEvent.click(unlinkBtn);
    await waitFor(() => expect(patchGoal).toHaveBeenCalledWith(30, { visionNodeId: null }));
  });
});

describe("MindPanel — regression: other cognitive kinds are unaffected", () => {
  it("a plain Goal still renders its normal progress UI with no Financial Goals section", async () => {
    getCognitive.mockResolvedValue([goalItem()]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.queryByText("Financial Goals")).toBeNull();
  });
});

// Phase M (docs/specs/soumaya-product-audit.md, "Life Vision discoverability") — a single,
// contextual entry point above the generic kind picker, using the SAME `kind`/`adding` state
// and the SAME rendered per-kind section further down (no second Life Vision system, no new
// route/tab).
describe("MindPanel — Life Vision entry point (Phase M)", () => {
  it("with no Life Vision yet, offers a direct way to create one without opening the flat picker", async () => {
    getCognitive.mockResolvedValue([]);
    render(<MindPanel onFocus={() => {}} />);
    const entry = await screen.findByText("Set a Life Vision");
    fireEvent.click(entry.closest("button")!);
    // The exact same add-flow the flat picker already drives — no second data path.
    expect(screen.getByText("Target date (optional)")).toBeTruthy();
    expect(screen.getByPlaceholderText(/Name this life vision/i)).toBeTruthy();
  });

  it("with a Life Vision already mapped, shows it instead of the 'create one' prompt", async () => {
    getCognitive.mockResolvedValue([vision({ label: "Own a small fleet" })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Own a small fleet");
    expect(screen.getByText("Your Life Vision")).toBeTruthy();
    expect(screen.queryByText("Set a Life Vision")).toBeNull();
  });

  it("clicking an existing Life Vision's entry card scrolls to the same section rendered below (no duplicate data)", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    getCognitive.mockResolvedValue([vision({ label: "Own a small fleet" })]);
    render(<MindPanel onFocus={() => {}} />);
    const entry = await screen.findByText("Your Life Vision");
    fireEvent.click(entry.closest("button")!);
    expect(scrollIntoView).toHaveBeenCalled();
    // The section it scrolled to is the ONE existing rendered list, not a second copy.
    expect(screen.getAllByText("Own a small fleet")).toHaveLength(1);
  });
});

function ideaItem(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 5,
    kind: "idea",
    label: "Boat project",
    content: "",
    progress: null,
    completedAt: null,
    degree: 0,
    aliases: [],
    createdAt: "2026-01-01 00:00:00",
    remindAt: null,
    ...over,
  };
}

describe("MindPanel — IM-45: the other refreshes are truthful too", () => {
  it("working-memory failure renders an error + Retry, never 'mind space is clear', and recovers", async () => {
    getThoughtsResult.mockResolvedValue({ ok: false });
    render(<MindPanel onFocus={() => {}} />);
    expect(await screen.findByText(/Couldn't load your working memory/)).toBeTruthy();
    expect(screen.queryByText(/mind space is clear/)).toBeNull();

    getThoughtsResult.mockResolvedValue({
      ok: true,
      thoughts: [{ id: 1, text: "call the marina", source: "manual", strength: 0.9, reinforceCount: 0, createdAt: "2026-01-01" }],
    });
    // Two Retry buttons may exist (cognitive succeeded, so only thoughts') — click the thoughts one.
    const retries = screen.getAllByRole("button", { name: "Retry" });
    fireEvent.click(retries[retries.length - 1]!);
    expect(await screen.findByText("call the marina")).toBeTruthy();
    expect(screen.queryByText(/Couldn't load your working memory/)).toBeNull();
  });

  it("people-suggestions failure is an error state, not a silent absence", async () => {
    getPersonSuggestionsResult.mockResolvedValue({ ok: false });
    render(<MindPanel onFocus={() => {}} />);
    expect(await screen.findByText(/Couldn't load people suggestions/)).toBeTruthy();
  });

  it("events failure is disclosed, and a future event still shows its stored absolute date", async () => {
    getUpcomingEventsResult.mockResolvedValue({ ok: false });
    getCognitive.mockResolvedValue([
      ideaItem({ id: 9, kind: "future_event", label: "Regatta", remindAt: "2027-06-15T15:00:00Z" }),
    ]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Regatta");
    expect(screen.getByText(/Couldn't load event dates/)).toBeTruthy();
    // The absolute local date comes from the item's own stored date — never nothing.
    const { parseTolerantMs } = await import("../utils/dueReminders.js");
    const abs = new Date(parseTolerantMs("2027-06-15T15:00:00Z")).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(screen.getByText(new RegExp(abs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
  });

  it("the first cognitive load shows a loading state, not the empty-mind copy", async () => {
    let resolveIt: (v: unknown) => void = () => {};
    getCognitiveResult.mockImplementation(() => new Promise((r) => { resolveIt = r as (v: unknown) => void; }));
    render(<MindPanel onFocus={() => {}} />);
    expect(await screen.findByText(/Loading your mind/)).toBeTruthy();
    expect(screen.queryByText(/Nothing mapped yet/)).toBeNull();
    await act(async () => { resolveIt({ ok: true, items: [] }); });
    expect(await screen.findByText(/Nothing mapped yet/)).toBeTruthy();
  });
});

describe("MindPanel — IM-46/47/48: card content, search/filter/sort, dates", () => {
  it("renders the item's own content as a snippet on the card", async () => {
    getCognitive.mockResolvedValue([goalItem({ content: "Train three mornings a week" })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    expect(screen.getByText("Train three mornings a week")).toBeTruthy();
  });

  it("does not duplicate the label when content just repeats it (server create fallback)", async () => {
    getCognitive.mockResolvedValue([goalItem({ content: "Run a 5k" })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    expect(screen.getAllByText("Run a 5k")).toHaveLength(1);
  });

  it("renders the mapped date (createdAt) in local human form on the card", async () => {
    getCognitive.mockResolvedValue([goalItem()]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    const { fmtBrowseDate } = await import("../utils/browseFormat.js");
    expect(screen.getByText(`Added ${fmtBrowseDate("2026-01-01 00:00:00")}`)).toBeTruthy();
  });

  it("a future event shows BOTH the relative countdown and the absolute local date", async () => {
    getCognitive.mockResolvedValue([ideaItem({ id: 9, kind: "future_event", label: "Regatta", remindAt: "2027-06-15T15:00:00Z" })]);
    getUpcomingEvents.mockResolvedValue([{ id: 9, label: "Regatta", date: "2027-06-15T15:00:00Z", inDays: 3 }]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Regatta");
    const { parseTolerantMs } = await import("../utils/dueReminders.js");
    const abs = new Date(parseTolerantMs("2027-06-15T15:00:00Z")).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(screen.getByText(new RegExp(`in 3d · ${abs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeTruthy();
  });

  it("search narrows the list and reports the count; clearing restores it", async () => {
    getCognitive.mockResolvedValue([
      goalItem(),
      goalItem({ id: 3, label: "Save for a boat", content: "" }),
    ]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    fireEvent.change(screen.getByLabelText("Search your mind"), { target: { value: "boat" } });
    expect(screen.queryByText("Run a 5k")).toBeNull();
    expect(screen.getByText("Save for a boat")).toBeTruthy();
    expect(screen.getByText("Showing 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByText("Clear"));
    expect(await screen.findByText("Run a 5k")).toBeTruthy();
  });

  it("the kind filter hides other kinds entirely", async () => {
    getCognitive.mockResolvedValue([
      goalItem(),
      ideaItem({ id: 6, label: "A wild idea" }),
    ]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    fireEvent.change(screen.getByLabelText("Filter by kind"), { target: { value: "idea" } });
    expect(screen.queryByText("Run a 5k")).toBeNull();
    expect(screen.getByText("A wild idea")).toBeTruthy();
  });

  it("sort by name orders cards A–Z within their section", async () => {
    getCognitive.mockResolvedValue([
      goalItem({ id: 10, label: "Zumba classes" }),
      goalItem({ id: 11, label: "Alpha project" }),
    ]);
    const { container } = render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Zumba classes");
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "name" } });
    const labels = [...container.querySelectorAll(".mind-card-label")].map((el) => el.textContent ?? "");
    expect(labels[0]).toContain("Alpha project");
    expect(labels[1]).toContain("Zumba classes");
  });

  it("identity evidence overflow is disclosed with '+N more' and expands", async () => {
    getCognitive.mockResolvedValue([ideaItem({ id: 7, kind: "identity", label: "A builder" })]);
    getCognitiveEvidence.mockResolvedValue({
      for: Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, label: `Proof ${i + 1}` })),
      against: [],
      confidence: 0.8,
    });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("A builder");
    fireEvent.click(screen.getByText(/Evidence/));
    expect(await screen.findByText("+2 more")).toBeTruthy();
    expect(screen.queryByText("Proof 10")).toBeNull();
    fireEvent.click(screen.getByText("+2 more"));
    expect(screen.getByText("Proof 10")).toBeTruthy();
  });
});

describe("MindPanel — IM-49: source legend + per-interaction details", () => {
  it("renders a legend naming every working-memory source colour", async () => {
    getThoughts.mockResolvedValue([
      { id: 1, text: "aim at the regatta", source: "goal", strength: 0.8, reinforceCount: 1, createdAt: "2026-01-01" },
    ]);
    render(<MindPanel onFocus={() => {}} />);
    expect(await screen.findByText("aim at the regatta")).toBeTruthy();
    expect(screen.getByText("goal-driven")).toBeTruthy();
    expect(screen.getByText("held by you")).toBeTruthy();
    expect(screen.getByText("a feeling")).toBeTruthy();
  });

  it("person interactions render their own date and emotional tone", async () => {
    getCognitive.mockResolvedValue([ideaItem({ id: 8, kind: "person_entity", label: "Mara" })]);
    getPersonProfile.mockResolvedValue({
      count: 1,
      lastAt: "2026-09-03 10:00:00",
      tone: "warm",
      interactions: [{ id: 42, label: "Dinner with Mara", createdAt: "2026-09-03 10:00:00", emotionalWeight: 0.9 }],
    });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Mara");
    fireEvent.click(screen.getByText(/Relationship/));
    expect(await screen.findByText("Dinner with Mara")).toBeTruthy();
    const { fmtBrowseDate } = await import("../utils/browseFormat.js");
    expect(screen.getByText(new RegExp(`${fmtBrowseDate("2026-09-03 10:00:00")} · warm`))).toBeTruthy();
  });
});

describe("MindPanel — IM-50: ConfirmDialog delete + honest progress saves", () => {
  it("delete asks via the app dialog (never window.confirm) and removes on confirm", async () => {
    // jsdom defines no window.confirm — install a stub so a native-confirm
    // call would be OBSERVED (and would fail this test), not silently absent.
    const confirmFn = vi.fn(() => true);
    window.confirm = confirmFn;
    getCognitive.mockResolvedValue([goalItem()]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    fireEvent.click(screen.getByTitle("Delete"));
    expect(await screen.findByText("Delete this from your mind?")).toBeTruthy();
    expect(confirmFn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteNode).toHaveBeenCalledWith(2));
    await waitFor(() => expect(screen.queryByText("Run a 5k")).toBeNull());
    delete (window as { confirm?: unknown }).confirm;
  });

  it("a failed delete restores the card and toasts the failure", async () => {
    deleteNode.mockRejectedValue(new Error("server down"));
    getCognitive.mockResolvedValue([goalItem()]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    fireEvent.click(screen.getByTitle("Delete"));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringContaining("Couldn't remove"), expect.anything(), expect.anything()),
    );
    expect(screen.getByText("Run a 5k")).toBeTruthy();
  });

  it("a failed progress save rolls the bar back and toasts", async () => {
    setCognitiveProgress.mockResolvedValue(false);
    getCognitive.mockResolvedValue([goalItem({ progress: 0.3 })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    expect(screen.getByText("30%")).toBeTruthy();
    fireEvent.click(screen.getByTitle("More"));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringContaining("Couldn't save that progress"), expect.anything(), expect.anything()),
    );
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.queryByText("40%")).toBeNull();
  });
});

describe("MindPanel — IM-136: idea split / merge", () => {
  it("split: naming a branch and confirming calls splitIdea and refreshes", async () => {
    getCognitive.mockResolvedValue([ideaItem()]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Boat project");
    fireEvent.click(screen.getByText("✂ Split"));
    fireEvent.change(screen.getByLabelText("Name the branch that splits off"), { target: { value: "Sailing half" } });
    fireEvent.click(screen.getByText("Split…"));
    expect(await screen.findByText("Split this idea?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await waitFor(() => expect(splitIdea).toHaveBeenCalledWith(5, "Sailing half", undefined));
  });

  it("merge: selecting two ideas offers the merge, first selected survives", async () => {
    getCognitive.mockResolvedValue([
      ideaItem(),
      ideaItem({ id: 6, label: "Sail the coast" }),
    ]);
    const { container } = render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Boat project");
    // Select per-card (DOM order is newest-first sort, not fixture order):
    // "Boat project" (id 5) first, so IT is the survivor.
    const cardOf = (label: string) =>
      [...container.querySelectorAll(".mind-card")].find((c) => c.textContent?.includes(label))!;
    fireEvent.click(within(cardOf("Boat project") as HTMLElement).getByText("⇄ Select for merge"));
    fireEvent.click(within(cardOf("Sail the coast") as HTMLElement).getByText("⇄ Select for merge"));
    expect(await screen.findByText(/first selected survives/)).toBeTruthy();
    fireEvent.click(screen.getByText("Merge…"));
    expect(await screen.findByText("Merge these ideas?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(mergeIdeas).toHaveBeenCalledWith(5, 6));
  });
});

describe("MindPanel — cognitive load failure is not an empty mind (Finding 2)", () => {
  it("shows 'Nothing mapped yet' only for a successful empty fetch", async () => {
    render(<MindPanel onFocus={() => {}} />);
    expect(await screen.findByText(/Nothing mapped yet/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't load your mind/)).toBeNull();
  });

  it("renders an explicit error state with Retry when the fetch fails, and recovers on retry", async () => {
    getCognitiveResult.mockResolvedValue({ ok: false });
    render(<MindPanel onFocus={() => {}} />);
    expect(await screen.findByText(/Couldn't load your mind/)).toBeTruthy();
    // Failure must NOT masquerade as an empty mind.
    expect(screen.queryByText(/Nothing mapped yet/)).toBeNull();

    getCognitiveResult.mockResolvedValue({ ok: true, items: [goalItem()] });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Run a 5k")).toBeTruthy();
    expect(screen.queryByText(/Couldn't load your mind/)).toBeNull();
  });

  it("keeps already-loaded items visible and flags a failed refresh as stale", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [goalItem()] });
    render(<MindPanel onFocus={() => {}} />);
    expect(await screen.findByText("Run a 5k")).toBeTruthy();

    // The next refresh fails (an edit-save re-fetches): items stay, and the
    // panel says it's showing a stale copy instead of going silently empty.
    getCognitiveResult.mockResolvedValue({ ok: false });
    updateCognitive.mockResolvedValue(true);
    fireEvent.click(screen.getByTitle("Edit"));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Couldn't refresh your mind/)).toBeTruthy();
    expect(screen.getByText("Run a 5k")).toBeTruthy();
  });
});

describe("CAP-09 (Batch B) — a failed thought capture never loses the words", () => {
  it("keeps the text in the input when addThought fails, and shows the failure", async () => {
    addThought.mockResolvedValue(null);
    render(<MindPanel onFocus={() => {}} />);
    const input = (await screen.findByPlaceholderText(/Hold a thought/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a thought I can't lose" } });
    fireEvent.click(screen.getByText("Hold"));
    await waitFor(() => expect(addThought).toHaveBeenCalledWith("a thought I can't lose"));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't hold/i), "⚠️", expect.any(Number)),
    );
    // The words survive the failure — still in the input, ready to retry.
    expect(input.value).toBe("a thought I can't lose");
  });

  it("clears the input only after a verified save", async () => {
    addThought.mockResolvedValue({ id: 42 });
    render(<MindPanel onFocus={() => {}} />);
    const input = (await screen.findByPlaceholderText(/Hold a thought/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a keeper" } });
    fireEvent.click(screen.getByText("Hold"));
    await waitFor(() => expect(addThought).toHaveBeenCalledWith("a keeper"));
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("an over-500-character thought gets length-specific copy, not a doomed 'try again'", async () => {
    addThought.mockResolvedValue(null);
    render(<MindPanel onFocus={() => {}} />);
    const input = (await screen.findByPlaceholderText(/Hold a thought/)) as HTMLInputElement;
    const long = "x".repeat(501);
    fireEvent.change(input, { target: { value: long } });
    fireEvent.click(screen.getByText("Hold"));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/too long/i), "⚠️", expect.any(Number)),
    );
    expect(input.value).toBe(long);
  });
});
