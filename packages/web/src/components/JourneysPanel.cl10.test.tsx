import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act, fireEvent } from "@testing-library/react";
import type { Journey } from "@brain/shared";

/**
 * CL-10 (Round 2 remainder) — IM-85 (description + colour create/edit),
 * IM-86 remainder (tasks/chats/achievements render as grouped items),
 * IM-88 (dates, search/filter/sort, next-step prompt, in-card link picker),
 * IM-89 (getJourney used by the detail view; grapheme-aware icon input).
 */

const getJourneys = vi.fn();
const getJourney = vi.fn();
const createJourney = vi.fn();
const patchJourney = vi.fn();
const deleteJourney = vi.fn();
const journeyLinks = vi.fn();
const linkToJourney = vi.fn();
vi.mock("../api/journeys.js", () => ({
  getJourneys: (...a: unknown[]) => getJourneys(...a),
  getJourney: (...a: unknown[]) => getJourney(...a),
  createJourney: (...a: unknown[]) => createJourney(...a),
  patchJourney: (...a: unknown[]) => patchJourney(...a),
  deleteJourney: (...a: unknown[]) => deleteJourney(...a),
  journeyLinks: (...a: unknown[]) => journeyLinks(...a),
  linkToJourney: (...a: unknown[]) => linkToJourney(...a),
  unlinkFromJourney: vi.fn(),
  journeysFor: vi.fn(),
  suggestJourneys: vi.fn(),
}));
const getGraph = vi.fn();
vi.mock("../api/client.js", () => ({ getGraph: (...a: unknown[]) => getGraph(...a) }));
const listIncome = vi.fn();
const listExpense = vi.fn();
const listBills = vi.fn();
const getWealthSummary = vi.fn();
vi.mock("../api/finance.js", () => ({
  listIncome: (...a: unknown[]) => listIncome(...a),
  listExpense: (...a: unknown[]) => listExpense(...a),
  listBills: (...a: unknown[]) => listBills(...a),
  getWealthSummary: (...a: unknown[]) => getWealthSummary(...a),
}));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));

import { JourneysPanel } from "./JourneysPanel.js";

const linksDetail = (links: unknown[], over: Record<string, unknown> = {}) => ({
  links, totalCount: links.length, earnedCents: 0, spentCents: 0, displayLimit: 20, unshownByKind: {}, ...over,
});

function journey(over: Partial<Journey>): Journey {
  return {
    id: 1, title: "Recover Financially", icon: "💵", description: "", status: "active",
    progress: 0.3, linkCount: 0,
    createdAt: "2026-01-02T12:00:00.000Z", updatedAt: "2026-03-04T12:00:00.000Z",
    ...over,
  } as Journey;
}

beforeEach(() => {
  vi.resetAllMocks();
  journeyLinks.mockResolvedValue(linksDetail([]));
  getJourney.mockImplementation(async (id: number) => {
    const all = (await getJourneys()) as Journey[] | null;
    const found = all?.find((x) => x.id === id);
    return found ? { ...found, links: [] } : null;
  });
  getGraph.mockRejectedValue(new Error("offline"));
  listIncome.mockResolvedValue(null);
  listExpense.mockResolvedValue(null);
  listBills.mockResolvedValue(null);
  getWealthSummary.mockResolvedValue(null);
  createJourney.mockResolvedValue(journey({ id: 99 }));
  patchJourney.mockResolvedValue(journey({}));
});

afterEach(() => cleanup());

async function openCard(title = "Recover Financially") {
  const head = await screen.findByText(title);
  act(() => head.click());
}

describe("IM-85 — description + colour in the create form", () => {
  it("sends description and colour to createJourney", async () => {
    getJourneys.mockResolvedValue([]);
    render(<JourneysPanel />);
    const newBtn = await screen.findByText("＋ New Journey");
    act(() => newBtn.click());
    fireEvent.change(screen.getByLabelText("Journey title"), { target: { value: "Become an RN" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Nursing school chapter" } });
    act(() => screen.getByLabelText("Colour Leaf").click());
    await act(async () => { screen.getByText("Create").click(); });
    expect(createJourney).toHaveBeenCalledWith({
      title: "Become an RN",
      icon: "🧭",
      description: "Nursing school chapter",
      color: "#5ee6a0",
    });
  });

  it("renders the stored colour as the card accent and in the bar", async () => {
    getJourneys.mockResolvedValue([journey({ color: "#5ee6a0" })]);
    const { container } = render(<JourneysPanel />);
    await screen.findByText("Recover Financially");
    const card = container.querySelector(".jn-card") as HTMLElement;
    expect(card.style.borderLeft).toContain("#5ee6a0");
  });
});

describe("IM-85 — edit flow", () => {
  it("edits title, description and colour through patchJourney and shows the new description", async () => {
    getJourneys.mockResolvedValue([journey({ description: "Old desc" })]);
    patchJourney.mockResolvedValue(journey({ title: "Recover Faster", description: "New desc", color: "#ffcd46" }));
    render(<JourneysPanel />);
    await openCard();
    await screen.findByText("Old desc");
    act(() => screen.getByText("✏️ Edit").click());
    fireEvent.change(screen.getByLabelText("Journey title"), { target: { value: "Recover Faster" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "New desc" } });
    act(() => screen.getByLabelText("Colour Sun").click());
    await act(async () => { screen.getByText("Save changes").click(); });
    expect(patchJourney).toHaveBeenCalledWith(1, {
      title: "Recover Faster",
      icon: "💵",
      description: "New desc",
      color: "#ffcd46",
      // REG-161/JN-04: the edit form always carries the span dates now —
      // blank here, so null (clear) rides the same save.
      startedAt: null,
      endedAt: null,
    });
    await screen.findByText("New desc");
  });

  it("toasts and stays in the edit form when the save fails", async () => {
    getJourneys.mockResolvedValue([journey({})]);
    patchJourney.mockResolvedValue(null);
    render(<JourneysPanel />);
    await openCard();
    act(() => screen.getByText("✏️ Edit").click());
    await act(async () => { screen.getByText("Save changes").click(); });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't save"), "⚠️", expect.any(Number));
    expect(screen.getByText("Save changes")).toBeTruthy();
  });
});

describe("IM-89 — detail view uses getJourney; icon input is grapheme-aware", () => {
  it("loads the journey's own record when the card opens", async () => {
    getJourneys.mockResolvedValue([journey({})]);
    render(<JourneysPanel />);
    await openCard();
    await waitFor(() => expect(getJourney).toHaveBeenCalledWith(1));
  });

  it("keeps a ZWJ emoji whole in the create icon input", async () => {
    getJourneys.mockResolvedValue([]);
    render(<JourneysPanel />);
    const newBtn = await screen.findByText("＋ New Journey");
    act(() => newBtn.click());
    const iconIn = screen.getByLabelText("Icon") as HTMLInputElement;
    fireEvent.change(iconIn, { target: { value: "🧭👨‍👩‍👧" } });
    expect(iconIn.value).toBe("👨‍👩‍👧");
  });
});

describe("IM-88 — dates", () => {
  it("shows the journey's created/updated dates in local time in the detail", async () => {
    getJourneys.mockResolvedValue([journey({})]);
    render(<JourneysPanel />);
    await openCard();
    // Zone-derived expectations (Round 2 coordinator): the dates render in
    // LOCAL time by design (IM-88) — noon-UTC fixtures shift a day at UTC+14.
    const started = new Date("2026-01-02T12:00:00.000Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const moved = new Date("2026-03-04T12:00:00.000Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    // REG-161/JN-04: with no explicit span the creation date is labeled
    // "Created", never "Started" (the old copy called the record's creation
    // date the journey's start).
    await screen.findByText(new RegExp(`Created ${started} · Last moved ${moved}`));
  });

  it("shows a linked transaction's occurredAt date (the server always sent it)", async () => {
    getJourneys.mockResolvedValue([journey({ linkCount: 1 })]);
    journeyLinks.mockResolvedValue(linksDetail([
      { kind: "expense", refId: 5, label: "Costco", amount: 2500, occurredAt: "2026-02-03" },
    ], { spentCents: 2500 }));
    render(<JourneysPanel />);
    await openCard();
    await screen.findByText("Feb 3, 2026");
  });
});

describe("IM-88 — search / filter / sort", () => {
  it("filters the list by the search box and by status", async () => {
    getJourneys.mockResolvedValue([
      journey({ id: 1, title: "Recover Financially" }),
      journey({ id: 2, title: "Get Healthy", status: "paused" }),
    ]);
    render(<JourneysPanel />);
    await screen.findByText("Get Healthy");
    fireEvent.change(screen.getByLabelText("Search journeys"), { target: { value: "healthy" } });
    expect(screen.queryByText("Recover Financially")).toBeNull();
    expect(screen.getByText("Get Healthy")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search journeys"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by status"), { target: { value: "active" } });
    expect(screen.queryByText("Get Healthy")).toBeNull();
    expect(screen.getByText("Recover Financially")).toBeTruthy();
  });

  it("sorts by title A–Z", async () => {
    getJourneys.mockResolvedValue([
      journey({ id: 1, title: "Zebra Years" }),
      journey({ id: 2, title: "Alpha Start" }),
    ]);
    const { container } = render(<JourneysPanel />);
    await screen.findByText("Zebra Years");
    fireEvent.change(screen.getByLabelText("Sort journeys"), { target: { value: "title" } });
    const names = [...container.querySelectorAll(".jn-name")].map((n) => n.textContent);
    expect(names).toEqual(["Alpha Start", "Zebra Years"]);
  });
});

describe("IM-88 — next-step prompt + in-card link picker", () => {
  it("shows a next-step prompt derived from what's linked", async () => {
    getJourneys.mockResolvedValue([journey({ linkCount: 0 })]);
    journeyLinks.mockResolvedValue(linksDetail([]));
    render(<JourneysPanel />);
    await openCard();
    await screen.findByText(/Next step: link a memory, task, or transaction/);
  });

  it("links a memory from the in-card picker via the existing link API", async () => {
    getJourneys.mockResolvedValue([journey({})]);
    journeyLinks.mockResolvedValue(linksDetail([]));
    getGraph.mockResolvedValue({ nodes: [{ id: 42, label: "First day of school", kind: "memory" }], links: [] });
    linkToJourney.mockResolvedValue({ id: 1, journeyId: 1, kind: "node", refId: 42, createdAt: "" });
    render(<JourneysPanel />);
    await openCard();
    const linkBtn = await screen.findByText("＋ Link something");
    act(() => linkBtn.click());
    const candidate = await screen.findByText("First day of school");
    await act(async () => { candidate.click(); });
    expect(linkToJourney).toHaveBeenCalledWith(1, "node", 42);
  });

  it("toasts when linking from the picker fails", async () => {
    getJourneys.mockResolvedValue([journey({})]);
    journeyLinks.mockResolvedValue(linksDetail([]));
    getGraph.mockResolvedValue({ nodes: [{ id: 42, label: "First day of school", kind: "memory" }], links: [] });
    linkToJourney.mockResolvedValue(null);
    render(<JourneysPanel />);
    await openCard();
    const linkBtn = await screen.findByText("＋ Link something");
    act(() => linkBtn.click());
    const candidate = await screen.findByText("First day of school");
    await act(async () => { candidate.click(); });
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Couldn't link"), "⚠️", expect.any(Number));
  });
});

describe("IM-86 remainder — tasks/chats/achievements render as grouped items", () => {
  it("renders each kind as its own group with its date, not a counted line", async () => {
    getJourneys.mockResolvedValue([journey({ linkCount: 3 })]);
    journeyLinks.mockResolvedValue(linksDetail([
      { kind: "task", refId: 7, label: "Call the school", nodeRefId: 7, occurredAt: "2026-02-01T12:00:00.000Z", linkedAt: "2026-02-01T12:00:00.000Z" },
      { kind: "chat", refId: 11, label: "Linked chat", linkedAt: "2026-02-02T12:00:00.000Z" },
      { kind: "achievement", refId: 12, label: "Linked achievement", linkedAt: "2026-02-03T12:00:00.000Z" },
    ]));
    const onFocus = vi.fn();
    render(<JourneysPanel onFocus={onFocus} />);
    await openCard();
    await screen.findByText("✅ Tasks");
    expect(screen.getByText("Call the school")).toBeTruthy();
    expect(screen.getByText("💬 Chats")).toBeTruthy();
    expect(screen.getByText("Linked chat")).toBeTruthy();
    expect(screen.getByText("🏆 Achievements")).toBeTruthy();
    expect(screen.getByText("Linked achievement")).toBeTruthy();
    const linked = new Date("2026-02-02T12:00:00.000Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    expect(screen.getByText(new RegExp(`linked ${linked}`))).toBeTruthy();
    expect(screen.queryByText(/Also linked but not shown/)).toBeNull();
    // A task that resolved to its node flies to it.
    act(() => screen.getByText("Call the school").click());
    expect(onFocus).toHaveBeenCalledWith(7);
  });
});
