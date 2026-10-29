import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { WealthSummary } from "@brain/shared";
import type { CognitiveItem } from "../api/mind.js";

/**
 * Batch P — Mind working memory:
 *  REG-040: the thought input states its 500-character limit before submit.
 *  REG-042: the 30-mote cap (weakest trimmed on add) is disclosed where
 *           thoughts are captured, in the surface's own terms.
 */

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

function wealth(): WealthSummary {
  return {
    totalNetWorthCents: 0, totalAllocatedCents: 0, totalDeployableCents: 0,
    buckets: [], goals: [], unallocatedCents: 0,
  } as unknown as WealthSummary;
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
});
afterEach(() => cleanup());

describe("REG-040 — the thought input states its 500-character limit", () => {
  it("shows a live counter under the thought input", async () => {
    render(<MindPanel onFocus={() => {}} />);
    const input = (await screen.findByPlaceholderText(/Hold a thought/)) as HTMLInputElement;
    expect(screen.getByText(/0\/500/)).toBeTruthy();
    fireEvent.change(input, { target: { value: "hello" } });
    expect(screen.getByText(/5\/500/)).toBeTruthy();
  });

  it("warns before submission when the thought is over the cap", async () => {
    render(<MindPanel onFocus={() => {}} />);
    const input = (await screen.findByPlaceholderText(/Hold a thought/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x".repeat(501) } });
    expect(screen.getByText(/over the 500-character limit/i)).toBeTruthy();
  });
});

describe("REG-042 — the 30-mote cap is disclosed where thoughts are captured", () => {
  it("says the mind holds up to 30 thoughts and the faintest fades first", async () => {
    render(<MindPanel onFocus={() => {}} />);
    await screen.findByPlaceholderText(/Hold a thought/);
    expect(screen.getByText(/holds up to 30 thoughts/i)).toBeTruthy();
    expect(screen.getByText(/faintest/i)).toBeTruthy();
  });
});
