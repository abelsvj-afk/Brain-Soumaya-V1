import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WealthSummary } from "@brain/shared";
import type { CognitiveItem, Thought, PersonProfile } from "../api/mind.js";
import { spaceLocalDay } from "../utils/localDay.js";

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

const getCognitiveResult = vi.fn();
const createCognitive = vi.fn();
const updateCognitive = vi.fn();
const setCognitiveProgress = vi.fn();
const getUpcomingEventsResult = vi.fn();
const getThoughtsResult = vi.fn();
const addThought = vi.fn();
const reinforceThought = vi.fn();
const promoteThought = vi.fn();
const dismissThought = vi.fn();
const editThought = vi.fn();
const getPersonSuggestionsResult = vi.fn();
const getCognitiveEvidence = vi.fn();
const getPersonProfile = vi.fn();
const unlinkCognitive = vi.fn();
const pruneCognitive = vi.fn();
const dismissPersonSuggestion = vi.fn();
const promoteIdea = vi.fn();
const deleteNode = vi.fn();
const splitIdea = vi.fn();
const mergeIdeas = vi.fn();
vi.mock("../api/client.js", () => ({
  getCognitiveResult: (...a: unknown[]) => getCognitiveResult(...a),
  createCognitive: (...a: unknown[]) => createCognitive(...a),
  updateCognitive: (...a: unknown[]) => updateCognitive(...a),
  setCognitiveProgress: (...a: unknown[]) => setCognitiveProgress(...a),
  getUpcomingEventsResult: (...a: unknown[]) => getUpcomingEventsResult(...a),
  promoteIdea: (...a: unknown[]) => promoteIdea(...a),
  splitIdea: (...a: unknown[]) => splitIdea(...a),
  mergeIdeas: (...a: unknown[]) => mergeIdeas(...a),
  unlinkCognitive: (...a: unknown[]) => unlinkCognitive(...a),
  pruneCognitive: (...a: unknown[]) => pruneCognitive(...a),
  getCognitiveEvidence: (...a: unknown[]) => getCognitiveEvidence(...a),
  getPersonProfile: (...a: unknown[]) => getPersonProfile(...a),
  getPersonSuggestionsResult: (...a: unknown[]) => getPersonSuggestionsResult(...a),
  dismissPersonSuggestion: (...a: unknown[]) => dismissPersonSuggestion(...a),
  getThoughtsResult: (...a: unknown[]) => getThoughtsResult(...a),
  addThought: (...a: unknown[]) => addThought(...a),
  reinforceThought: (...a: unknown[]) => reinforceThought(...a),
  promoteThought: (...a: unknown[]) => promoteThought(...a),
  dismissThought: (...a: unknown[]) => dismissThought(...a),
  editThought: (...a: unknown[]) => editThought(...a),
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
function ideaItem(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 5,
    kind: "idea",
    label: "Boat project",
    content: "",
    progress: null,
    completedAt: null,
    degree: 0,
    supportCount: 0,
    aliases: [],
    createdAt: "2026-01-01 00:00:00",
    remindAt: null,
    ...over,
  };
}
function personItem(over: Partial<CognitiveItem> = {}): CognitiveItem {
  return {
    id: 8,
    kind: "person_entity",
    label: "Mara",
    content: "",
    progress: null,
    completedAt: null,
    degree: 1,
    aliases: [],
    createdAt: "2026-01-01 00:00:00",
    remindAt: null,
    ...over,
  };
}
function thought(over: Partial<Thought> = {}): Thought {
  return { id: 1, text: "old words", source: "manual", strength: 0.8, reinforceCount: 0, createdAt: "2026-01-01", ...over };
}
function profile(over: Partial<PersonProfile> = {}): PersonProfile {
  return {
    count: 1,
    lastAt: "2026-09-03 10:00:00",
    tone: "warm",
    interactions: [{ id: 42, label: "Dinner with Mara", createdAt: "2026-09-03 10:00:00", emotionalWeight: 0.9 }],
    ...over,
  };
}
function wealth(over: Partial<WealthSummary> = {}): WealthSummary {
  return { buckets: [], goals: [], allocatedCents: 0, deployableCents: 0, reconciliation: "ok", ...over };
}

beforeEach(() => {
  vi.resetAllMocks();
  getCognitiveResult.mockResolvedValue({ ok: true, items: [], total: 0 });
  getUpcomingEventsResult.mockResolvedValue({ ok: true, events: [] });
  getThoughtsResult.mockResolvedValue({ ok: true, thoughts: [] });
  getPersonSuggestionsResult.mockResolvedValue({ ok: true, suggestions: [] });
  getCognitiveEvidence.mockResolvedValue({ for: [], against: [], confidence: 0 });
  getPersonProfile.mockResolvedValue(null);
  getWealthSummary.mockResolvedValue(wealth());
  getWealthSummaryResult.mockImplementation(async (...a: unknown[]) => ({
    ok: true as const,
    summary: (await getWealthSummary(...a)) as WealthSummary,
  }));
  deleteNode.mockResolvedValue(undefined);
  setCognitiveProgress.mockResolvedValue(true);
  updateCognitive.mockResolvedValue(true);
  createCognitive.mockResolvedValue({ id: 42 });
  unlinkCognitive.mockResolvedValue(true);
  dismissPersonSuggestion.mockResolvedValue(true);
  reinforceThought.mockResolvedValue({ promotedNodeId: null });
  promoteThought.mockResolvedValue({ nodeId: 42 });
  dismissThought.mockResolvedValue(true);
  editThought.mockResolvedValue(true);
  promoteIdea.mockResolvedValue(true);
});
afterEach(() => cleanup());

describe("MIN-01 (REG-132) — Life Vision target date stays date-only", () => {
  it("create sends the picked date-only value, never a UTC-midnight instant", async () => {
    render(<MindPanel onFocus={() => {}} />);
    fireEvent.click(await screen.findByText("+ Map something in your mind"));
    fireEvent.click(screen.getByText(/🌅 Life Vision/));
    fireEvent.change(screen.getByPlaceholderText(/Name this life vision/i), { target: { value: "Our first house" } });
    fireEvent.change(screen.getByLabelText("Target date for this Life Vision"), { target: { value: "2030-06-01" } });
    fireEvent.click(screen.getByText("Add Life Vision"));
    await waitFor(() => expect(createCognitive).toHaveBeenCalled());
    expect(createCognitive.mock.calls[0]![3]).toBe("2030-06-01");
  });

  it("edit sends the picked date-only value, never a UTC-midnight instant", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [vision({ remindAt: "2030-06-01T00:00:00.000Z" })], total: 1 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    fireEvent.click(screen.getByTitle("Edit"));
    fireEvent.change(screen.getByLabelText("Target date for this Life Vision"), { target: { value: "2031-07-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateCognitive).toHaveBeenCalled());
    const patch = updateCognitive.mock.calls[0]![1] as { date?: string | null };
    expect(patch.date).toBe("2031-07-04");
  });

  it("a date-only stored value renders as its own calendar date in every zone (Jun 1, not May 31)", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [vision({ remindAt: "2030-06-01" })], total: 1 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText(/target: Jun 1, 2030/)).toBeTruthy();
    expect(screen.queryByText(/May 31, 2030/)).toBeNull();
  });

  it("a legacy UTC-midnight stored value renders the picked date, not the device-zone day before", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [vision({ remindAt: "2030-06-01T00:00:00.000Z" })], total: 1 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText(/target: Jun 1, 2030/)).toBeTruthy();
    expect(screen.queryByText(/May 31, 2030/)).toBeNull();
  });

  it("the editor seeds from the stored date, so card and editor agree", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [vision({ remindAt: "2030-06-01" })], total: 1 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText(/target: Jun 1, 2030/)).toBeTruthy();
    fireEvent.click(screen.getByTitle("Edit"));
    const input = screen.getByLabelText("Target date for this Life Vision") as HTMLInputElement;
    expect(input.value).toBe("2030-06-01");
  });

  it("the 'passed' cue turns only once the target calendar date has passed (space-local today)", async () => {
    const today = spaceLocalDay(new Date());
    const yesterday = spaceLocalDay(new Date(Date.now() - 86_400_000));
    getCognitiveResult.mockResolvedValue({ ok: true, items: [vision({ remindAt: today })], total: 1 });
    const { unmount } = render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText(/target:/)).toBeTruthy();
    expect(screen.queryByText(/target date passed/)).toBeNull();
    unmount();
    cleanup();
    getCognitiveResult.mockResolvedValue({ ok: true, items: [vision({ remindAt: yesterday })], total: 1 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    expect(screen.getByText(/target date passed/)).toBeTruthy();
  });
});

describe("MIN-02 (REG-133) — thought mutations honour their results", () => {
  it("a failed edit keeps the editor open with the attempted text and toasts", async () => {
    editThought.mockResolvedValue(false);
    getThoughtsResult.mockResolvedValue({ ok: true, thoughts: [thought()] });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("old words");
    fireEvent.click(screen.getByRole("button", { name: /edit thought/i }));
    const input = screen.getByDisplayValue("old words") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new words" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(editThought).toHaveBeenCalledWith(1, "new words"));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't save/i), expect.anything(), expect.anything()),
    );
    // The editor is still open with the attempted text; the list never showed it as saved.
    expect((screen.getByDisplayValue("new words") as HTMLInputElement).value).toBe("new words");
  });

  it("a failed dismiss restores the thought and toasts", async () => {
    dismissThought.mockResolvedValue(false);
    getThoughtsResult.mockResolvedValue({ ok: true, thoughts: [thought()] });
    const onChanged = vi.fn();
    render(<MindPanel onFocus={() => {}} onChanged={onChanged} />);
    await screen.findByText("old words");
    fireEvent.click(screen.getByRole("button", { name: /let go/i }));
    await waitFor(() => expect(dismissThought).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't let go/i), expect.anything(), expect.anything()),
    );
    expect(screen.getByText("old words")).toBeTruthy();
  });

  it("a failed Keep toasts instead of silently refreshing", async () => {
    reinforceThought.mockResolvedValue(null);
    getThoughtsResult.mockResolvedValue({ ok: true, thoughts: [thought()] });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("old words");
    fireEvent.click(screen.getByRole("button", { name: /keep thought/i }));
    await waitFor(() => expect(reinforceThought).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't keep/i), expect.anything(), expect.anything()),
    );
  });

  it("a failed promote toasts instead of silently refreshing", async () => {
    promoteThought.mockResolvedValue(null);
    getThoughtsResult.mockResolvedValue({ ok: true, thoughts: [thought()] });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("old words");
    fireEvent.click(screen.getByRole("button", { name: /make .* memory/i }));
    await waitFor(() => expect(promoteThought).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't make that a memory/i), expect.anything(), expect.anything()),
    );
  });
});

describe("MIN-03 (REG-134) — person maintenance honours its results", () => {
  it("a failed unlink restores the interaction, toasts, and does not fire onChanged", async () => {
    unlinkCognitive.mockResolvedValue(false);
    getCognitiveResult.mockResolvedValue({ ok: true, items: [personItem()], total: 1 });
    getPersonProfile.mockResolvedValue(profile());
    const onChanged = vi.fn();
    render(<MindPanel onFocus={() => {}} onChanged={onChanged} />);
    await screen.findByText("Mara");
    fireEvent.click(screen.getByText(/Relationship/));
    await screen.findByText("Dinner with Mara");
    fireEvent.click(screen.getByTitle("Not related — unlink"));
    await waitFor(() => expect(unlinkCognitive).toHaveBeenCalledWith(8, 42));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't unlink/i), expect.anything(), expect.anything()),
    );
    expect(screen.getByText("Dinner with Mara")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a failed 'not a person' keeps the suggestion and never promises permanence", async () => {
    dismissPersonSuggestion.mockResolvedValue(false);
    getPersonSuggestionsResult.mockResolvedValue({ ok: true, suggestions: [{ name: "Marina", count: 3 }] });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText(/Marina/);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Marina" }));
    await waitFor(() => expect(dismissPersonSuggestion).toHaveBeenCalledWith("Marina"));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't dismiss/i), expect.anything(), expect.anything()),
    );
    expect(screen.getByText(/Marina/)).toBeTruthy();
    expect(pushToastMock).not.toHaveBeenCalledWith(expect.stringContaining("won't suggest it again"), expect.anything(), expect.anything());
  });

  it("a failed prune toasts failure, never the 'nothing to clean' certification", async () => {
    pruneCognitive.mockResolvedValue({ ok: false });
    getCognitiveResult.mockResolvedValue({ ok: true, items: [personItem()], total: 1 });
    getPersonProfile.mockResolvedValue(profile());
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Mara");
    fireEvent.click(screen.getByText(/Relationship/));
    await screen.findByText("Dinner with Mara");
    fireEvent.click(screen.getByText(/Clean up links/));
    await waitFor(() => expect(pruneCognitive).toHaveBeenCalledWith(8));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't check/i), expect.anything(), expect.anything()),
    );
    expect(pushToastMock).not.toHaveBeenCalledWith(expect.stringContaining("Nothing to clean"), expect.anything(), expect.anything());
  });

  it("a verified-zero prune still says 'nothing to clean', and a real prune reports its count", async () => {
    pruneCognitive.mockResolvedValue({ ok: true, pruned: 0 });
    getCognitiveResult.mockResolvedValue({ ok: true, items: [personItem()], total: 1 });
    getPersonProfile.mockResolvedValue(profile());
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Mara");
    fireEvent.click(screen.getByText(/Relationship/));
    await screen.findByText("Dinner with Mara");
    fireEvent.click(screen.getByText(/Clean up links/));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringContaining("Nothing to clean"), expect.anything(), expect.anything()),
    );
    cleanup();
    vi.resetAllMocks();
    getCognitiveResult.mockResolvedValue({ ok: true, items: [personItem()], total: 1 });
    getPersonProfile.mockResolvedValue(profile());
    getThoughtsResult.mockResolvedValue({ ok: true, thoughts: [] });
    getUpcomingEventsResult.mockResolvedValue({ ok: true, events: [] });
    getPersonSuggestionsResult.mockResolvedValue({ ok: true, suggestions: [] });
    getCognitiveEvidence.mockResolvedValue({ for: [], against: [], confidence: 0 });
    pruneCognitive.mockResolvedValue({ ok: true, pruned: 2 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Mara");
    fireEvent.click(screen.getByText(/Relationship/));
    await screen.findByText("Dinner with Mara");
    fireEvent.click(screen.getByText(/Clean up links/));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringContaining("Cleaned up 2 links"), expect.anything(), expect.anything()),
    );
  });

  it("a failed add-person toasts instead of staying silent", async () => {
    createCognitive.mockResolvedValue(null);
    getPersonSuggestionsResult.mockResolvedValue({ ok: true, suggestions: [{ name: "Mara", count: 2 }] });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText(/Mara/);
    fireEvent.click(screen.getByText(/Mara/));
    await waitFor(() => expect(createCognitive).toHaveBeenCalledWith("person_entity", "Mara"));
    await waitFor(() =>
      expect(pushToastMock).toHaveBeenCalledWith(expect.stringMatching(/couldn't add/i), expect.anything(), expect.anything()),
    );
  });
});

describe("MIN-05 (REG-136) — 'Ripe' follows incoming supports, not total degree", () => {
  it("≥4 total links with <4 supports is NOT ripe", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [ideaItem({ degree: 5, supportCount: 1 })], total: 1 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Boat project");
    expect(screen.queryByText(/✨ Ripe/)).toBeNull();
    expect(screen.getByText(/1 supporting · 5 linked/)).toBeTruthy();
  });

  it("4 incoming supports IS ripe", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [ideaItem({ degree: 4, supportCount: 4 })], total: 1 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Boat project");
    expect(screen.getByText(/✨ Ripe — promote to Goal/)).toBeTruthy();
  });
});

describe("MIN-06 (REG-137) — capped reads state shown-vs-total honestly", () => {
  it("the search placeholder uses the true total, and a truncated list says so", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [goalItem(), goalItem({ id: 3, label: "Save for a boat" })], total: 137 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    expect(screen.getByPlaceholderText("Search 137 mapped items…")).toBeTruthy();
    expect(screen.getByText(/Showing 2 of 137 mapped items/)).toBeTruthy();
    expect(screen.getByText(/oldest are beyond this view/)).toBeTruthy();
  });

  it("the person profile's count is the true total, and a truncated page says so", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [personItem()], total: 1 });
    getPersonProfile.mockResolvedValue(
      profile({
        count: 137,
        interactions: [
          { id: 42, label: "Dinner with Mara", createdAt: "2026-09-03 10:00:00", emotionalWeight: 0.9 },
          { id: 43, label: "Call with Mara", createdAt: "2026-09-02 10:00:00", emotionalWeight: 0.2 },
        ],
      }),
    );
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Mara");
    fireEvent.click(screen.getByText(/Relationship/));
    await screen.findByText("Dinner with Mara");
    // The headline count is the true total (137), not the 2-row page —
    // matched on the headline's own wording ("137 interactions · last …")
    // so the truncation line below can't collide with it.
    expect(screen.getByText(/137 interactions · last/)).toBeTruthy();
    expect(screen.getByText(/Showing 2 of 137 interactions/)).toBeTruthy();
  });
});

describe("MIN-07 (REG-138) — lazy expansions have truthful failure states", () => {
  it("a failed Evidence fetch shows an error + Retry, and retry recovers", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [ideaItem({ id: 7, kind: "identity", label: "A builder" })], total: 1 });
    getCognitiveEvidence.mockResolvedValue(null);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("A builder");
    fireEvent.click(screen.getByText(/Evidence/));
    expect(await screen.findByText(/Couldn't load the evidence/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    getCognitiveEvidence.mockResolvedValue({ for: [{ id: 100, label: "Proof 1" }], against: [], confidence: 0.8 });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Proof 1")).toBeTruthy();
    expect(screen.queryByText(/Couldn't load the evidence/)).toBeNull();
  });

  it("a failed Relationship fetch shows an error + Retry, and retry recovers", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [personItem()], total: 1 });
    getPersonProfile.mockResolvedValue(null);
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Mara");
    fireEvent.click(screen.getByText(/Relationship/));
    expect(await screen.findByText(/Couldn't load this profile/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    getPersonProfile.mockResolvedValue(profile());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Dinner with Mara")).toBeTruthy();
  });

  it("a failed Financial Goals fetch shows an error + Retry, never 'Loading…' forever", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [vision()], total: 1 });
    getWealthSummaryResult.mockResolvedValue({ ok: false });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Our first house");
    fireEvent.click(screen.getByText(/Financial Goals/));
    expect(await screen.findByText(/Couldn't load your Financial Goals/)).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
    getWealthSummaryResult.mockResolvedValue({ ok: true, summary: wealth() });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No Financial Goals linked/)).toBeTruthy();
  });
});

describe("MIN-08 (REG-139) — Mind lifecycle controls are named and sized", () => {
  it("thought actions carry visible captions (Edit / Keep / Promote / Let go)", async () => {
    getThoughtsResult.mockResolvedValue({ ok: true, thoughts: [thought()] });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("old words");
    expect(screen.getByRole("button", { name: /edit thought/i }).textContent).toMatch(/Edit/);
    expect(screen.getByRole("button", { name: /keep thought/i }).textContent).toMatch(/Keep/);
    expect(screen.getByRole("button", { name: /make .* memory/i }).textContent).toMatch(/Promote|Make memory/);
    expect(screen.getByRole("button", { name: /let go/i }).textContent).toMatch(/Let go/);
  });

  it("cognitive card Edit/Delete carry visible captions", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [goalItem()], total: 1 });
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Run a 5k");
    expect(screen.getByRole("button", { name: /edit run a 5k/i }).textContent).toMatch(/Edit/);
    expect(screen.getByRole("button", { name: /delete run a 5k/i }).textContent).toMatch(/Delete/);
  });

  it("the person unlink control is visibly named 'Unlink'", async () => {
    getCognitiveResult.mockResolvedValue({ ok: true, items: [personItem()], total: 1 });
    getPersonProfile.mockResolvedValue(profile());
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByText("Mara");
    fireEvent.click(screen.getByText(/Relationship/));
    await screen.findByText("Dinner with Mara");
    expect(screen.getByRole("button", { name: /unlink dinner with mara/i }).textContent).toMatch(/Unlink/);
  });

  it("the CSS sizes the repeated lifecycle targets at the 46px standard", () => {
    const css = readRepoFile("src/index.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const mote = ruleBody(css, ".mind-mote-actions .mini");
    expect(mote, ".mind-mote-actions .mini rule exists").toBeTruthy();
    expect(mote).toMatch(/min-height:\s*46px/);
    const card = ruleBody(css, ".mind-card-row > .mini");
    expect(card, ".mind-card-row > .mini rule exists").toBeTruthy();
    expect(card).toMatch(/min-height:\s*46px/);
    const space = ruleBody(css, ".mindspace-card-actions .mini");
    expect(space, ".mindspace-card-actions .mini rule exists").toBeTruthy();
    expect(space).toMatch(/min-height:\s*46px/);
    const actions = ruleBody(css, ".mind-mote-actions");
    expect(actions, ".mind-mote-actions rule exists").toBeTruthy();
    const gap = /gap:\s*(\d+)px/.exec(actions!);
    expect(gap, "mote actions have a px gap").toBeTruthy();
    expect(Number(gap![1])).toBeGreaterThanOrEqual(6);
  });
});
