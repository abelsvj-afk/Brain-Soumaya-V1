import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";

// WordsPanel tests (design WORDS-PANEL-DESIGN-2026-10-31.md):
//   W-P1 home renders the overview + the disclosure line
//   W-P2 an empty archive is a calm state, not an error
//   W-P3 open flags are a door from Home into the Flagged section
//   W-P4 browse filters by channel chip and pages with the id cursor
//   W-P5 search shows the degraded note honestly; a result opens the
//        source view (reading, corrections, derived labels only)

const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

// The panel's dates come from TimelineView's space-zone formatter;
// pin the zone here so assertions don't depend on the runner's TZ.
vi.mock("./TimelineView.js", () => ({
  formatLocalDate: (raw: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(raw)),
}));

const getWordsOverview = vi.fn();
const listWordSources = vi.fn();
const getWordSource = vi.fn();
const searchWords = vi.fn();
const createSourceForgetRequest = vi.fn();
vi.mock("../api/words.js", () => ({
  getWordsOverview: (...a: unknown[]) => getWordsOverview(...a),
  listWordSources: (...a: unknown[]) => listWordSources(...a),
  getWordSource: (...a: unknown[]) => getWordSource(...a),
  searchWords: (...a: unknown[]) => searchWords(...a),
  createSourceForgetRequest: (...a: unknown[]) => createSourceForgetRequest(...a),
}));

const listUnresolvedFlags = vi.fn();
vi.mock("../api/forgetRequests.js", () => ({
  listUnresolvedFlags: (...a: unknown[]) => listUnresolvedFlags(...a),
  reviewUnresolvedFlag: vi.fn(),
  deleteUnresolvedFlagRow: vi.fn(),
  dismissUnresolvedFlag: vi.fn(),
}));

import { WordsPanel } from "./WordsPanel.js";
import type { WordSourceSummary, WordsOverview } from "../api/words.js";

function summary(id: number, over: Partial<WordSourceSummary> = {}): WordSourceSummary {
  return {
    id,
    kind: "note",
    channel: "typed",
    citationClass: "verbatim_typed",
    createdAt: "2026-10-31T14:00:00.000Z",
    preview: `capture number ${id}`,
    wordCount: 3,
    ...over,
  };
}

const OVERVIEW: WordsOverview = {
  total: 3,
  byChannel: { typed: 2, telegram: 1, chat: 0, imported: 0 },
  recent: [summary(11, { preview: "my exact words about the harbour" })],
  openFlags: 0,
};

beforeEach(() => {
  vi.resetAllMocks();
  getWordsOverview.mockResolvedValue(OVERVIEW);
  listWordSources.mockResolvedValue({ sources: [] });
  listUnresolvedFlags.mockResolvedValue({ open: [], reviewed: [], reviewedCount: 0 });
});

afterEach(() => cleanup());

describe("WordsPanel", () => {
  // W-P1
  it("home renders totals, channel counts, recents — and the disclosure line", async () => {
    render(<WordsPanel />);
    expect(
      screen.getByText("Your exact words, stored as you said them. Nothing here is used to train anything."),
    ).toBeTruthy();
    await screen.findByText(/3 captures preserved/);
    expect(screen.getByText("Typed: 2")).toBeTruthy();
    expect(screen.getByText("Telegram: 1")).toBeTruthy();
    expect(screen.getByText("my exact words about the harbour")).toBeTruthy();
    expect(screen.getByText(/Oct 31, 2026/)).toBeTruthy();
    expect(screen.getByText(/your typed words/)).toBeTruthy();
  });

  // W-P2
  it("an empty archive is calm, not an error", async () => {
    getWordsOverview.mockResolvedValue({
      total: 0,
      byChannel: { typed: 0, telegram: 0, chat: 0, imported: 0 },
      recent: [],
      openFlags: 0,
    });
    render(<WordsPanel />);
    expect(await screen.findByText(/Your words will gather here/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't reach the server/)).toBeNull();
  });

  // W-P3
  it("open flags appear as a door on Home and open the Flagged section", async () => {
    getWordsOverview.mockResolvedValue({ ...OVERVIEW, openFlags: 2 });
    listUnresolvedFlags.mockResolvedValue({
      open: [
        {
          flagId: 1,
          requestId: 10,
          sourceId: 5,
          table: "user_model",
          rowId: 7,
          policyReason: "stated_user_model",
          status: "open",
          createdAt: "2026-10-26T00:00:00.000Z",
          reviewedAt: null,
          targetMissing: false,
          slot: "belief",
          origin: "stated",
          topicLabels: ["home"],
          confidence: 0.9,
          validAt: null,
        },
      ],
      reviewed: [],
      reviewedCount: 0,
    });
    render(<WordsPanel />);
    const door = await screen.findByText(/2 flagged for review/);
    fireEvent.click(door);
    expect(await screen.findByText(/Forgotten words — flagged for review/)).toBeTruthy();
    expect(await screen.findByText("Your stated words")).toBeTruthy();
  });

  // W-P4
  it("browse filters by channel chip and pages with the last id as cursor", async () => {
    const page1 = Array.from({ length: 25 }, (_, i) => summary(100 - i));
    listWordSources.mockResolvedValueOnce({ sources: page1 }).mockResolvedValue({ sources: [summary(75)] });
    render(<WordsPanel />);
    await screen.findByText(/3 captures preserved/);
    fireEvent.click(screen.getByText(/Browse/));
    await screen.findByText("capture number 100");
    expect(listWordSources).toHaveBeenCalledWith({ channel: undefined, limit: 25 });

    fireEvent.click(screen.getByText("Load more"));
    await screen.findByText("capture number 75");
    expect(listWordSources).toHaveBeenLastCalledWith({ channel: undefined, limit: 25, before: 76 });

    fireEvent.click(screen.getByText("Telegram"));
    await vi.waitFor(() =>
      expect(listWordSources).toHaveBeenLastCalledWith({ channel: "telegram", limit: 25 }),
    );
  });

  // W-P5
  it("search reports exact-match mode honestly, and a hit opens the source view", async () => {
    searchWords.mockResolvedValue({
      mode: "fts_only",
      degraded: true,
      vecLag: false,
      results: [
        {
          chunkId: 5,
          sourceId: 11,
          excerpt: "…the harbour lights at noon…",
          citationClass: "verbatim_typed",
          channel: "typed",
          createdAt: "2026-10-31T14:00:00.000Z",
        },
      ],
    });
    getWordSource.mockResolvedValue({
      source: { ...summary(11), citationClass: "transcript_corrected", capturedVia: "typed" },
      reading: "the machine heard me right at noon",
      corrections: [
        { startOffset: 21, endOffset: 26, correctedText: "right", createdAt: "2026-10-31T15:00:00.000Z" },
      ],
      derivedNodes: [{ nodeId: 42, label: "Harbour plan" }],
    });
    const { container } = render(<WordsPanel />);
    await screen.findByText(/3 captures preserved/);
    fireEvent.click(screen.getByText(/Search/));
    fireEvent.change(screen.getByLabelText("Search your words"), { target: { value: "harbour" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(await screen.findByText(/Search is in exact-match mode right now/)).toBeTruthy();
    expect(searchWords).toHaveBeenCalledWith({ q: "harbour", from: undefined, to: undefined });

    fireEvent.click(await screen.findByText(/the harbour lights at noon/));
    await vi.waitFor(() => expect(container.querySelector(".words-reading")).toBeTruthy());
    // The reading renders whole; the corrected span is visually marked.
    expect(container.querySelector(".words-reading")?.textContent).toContain(
      "the machine heard me right at noon",
    );
    expect(container.querySelector(".words-reading mark")?.textContent).toBe("right");
    expect(getWordSource).toHaveBeenCalledWith(11);
    // Corrections are listed as stored; derived memories are labels only.
    expect(screen.getByText(/now read “right”/)).toBeTruthy();
    expect(screen.getByText("Harbour plan")).toBeTruthy();
    expect(screen.getByText(/Captured via Typed/)).toBeTruthy();
  });
});
