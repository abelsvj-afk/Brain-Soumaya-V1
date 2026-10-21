import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent, within } from "@testing-library/react";
import type { WealthSummary } from "@brain/shared";
import type { CognitiveItem } from "../api/mind.js";

const getCognitive = vi.fn();
const createCognitive = vi.fn();
const updateCognitive = vi.fn();
const setCognitiveProgress = vi.fn();
const getUpcomingEvents = vi.fn();
const getThoughts = vi.fn();
const getPersonSuggestions = vi.fn();
vi.mock("../api/client.js", () => ({
  getCognitive: (...a: unknown[]) => getCognitive(...a),
  createCognitive: (...a: unknown[]) => createCognitive(...a),
  updateCognitive: (...a: unknown[]) => updateCognitive(...a),
  setCognitiveProgress: (...a: unknown[]) => setCognitiveProgress(...a),
  getUpcomingEvents: (...a: unknown[]) => getUpcomingEvents(...a),
  promoteIdea: vi.fn(),
  unlinkCognitive: vi.fn(),
  pruneCognitive: vi.fn(),
  getCognitiveEvidence: vi.fn(),
  getPersonProfile: vi.fn(),
  getPersonSuggestions: (...a: unknown[]) => getPersonSuggestions(...a),
  dismissPersonSuggestion: vi.fn(),
  getThoughts: (...a: unknown[]) => getThoughts(...a),
  addThought: vi.fn(),
  reinforceThought: vi.fn(),
  promoteThought: vi.fn(),
  dismissThought: vi.fn(),
  editThought: vi.fn(),
  deleteNode: vi.fn(),
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
  getUpcomingEvents.mockResolvedValue([]);
  getThoughts.mockResolvedValue([]);
  getPersonSuggestions.mockResolvedValue([]);
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

describe("MindPanel — Life Vision target date display (never a reminder)", () => {
  it("shows 'no target date' when unset", async () => {
    getCognitive.mockResolvedValue([vision({ remindAt: null })]);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText("no target date")).toBeTruthy();
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
    expect(screen.getByText("overdue 3d")).toBeTruthy();
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
