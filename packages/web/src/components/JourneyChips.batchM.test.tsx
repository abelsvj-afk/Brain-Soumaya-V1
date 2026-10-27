import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import type { Journey } from "@brain/shared";
import { JourneyChips } from "./JourneyChips.js";
import * as api from "../api/journeys.js";
import * as toasts from "./Toasts.js";

afterEach(cleanup);
beforeEach(() => vi.restoreAllMocks());

function journey(overrides: { id: number; title: string }): Journey {
  return { description: "", status: "active", progress: 0, createdAt: "", updatedAt: "", ...overrides };
}

const baseMocks = (mine: Journey[], all: Journey[], suggested: Journey[]) => {
  vi.spyOn(api, "journeysFor").mockResolvedValue(mine);
  vi.spyOn(api, "getJourneys").mockResolvedValue(all);
  vi.spyOn(api, "suggestJourneys").mockResolvedValue({
    autoLink: [],
    suggested: suggested.map((journey) => ({ journey, score: 0.55, tier: "suggested" as const })),
  });
};

describe("REG-164 (JN-07) — failed chip link/unlink toasts instead of failing silently", () => {
  it("a failed suggested-chip link toasts 'Couldn't link that'", async () => {
    const suggested = journey({ id: 2, title: "Get Healthy" });
    baseMocks([], [suggested], [suggested]);
    vi.spyOn(api, "linkToJourney").mockResolvedValue(null);
    const toast = vi.spyOn(toasts, "pushToast").mockImplementation(() => {});

    render(<JourneyChips kind="node" refId={42} />);
    const chip = await screen.findByText(/Get Healthy/);
    await act(async () => { chip.click(); });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't link that — try again.", "⚠️", 3500));
  });

  it("a failed addable-chip link toasts instead of closing the add menu silently", async () => {
    const addable = journey({ id: 3, title: "Learn Something New" });
    baseMocks([], [addable], []);
    vi.spyOn(api, "linkToJourney").mockResolvedValue(null);
    const toast = vi.spyOn(toasts, "pushToast").mockImplementation(() => {});

    render(<JourneyChips kind="node" refId={42} />);
    await waitFor(() => screen.getByText("＋ Add"));
    await act(async () => { screen.getByText("＋ Add").click(); });
    const chip = await screen.findByText(/Learn Something New/);
    await act(async () => { chip.click(); });
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Couldn't link that — try again.", "⚠️", 3500));
  });

  it("a failed unlink toasts 'Couldn't remove that' and keeps the chip", async () => {
    const mine = journey({ id: 1, title: "Become an RN" });
    baseMocks([mine], [mine], []);
    vi.spyOn(api, "unlinkFromJourney").mockResolvedValue(null);
    const toast = vi.spyOn(toasts, "pushToast").mockImplementation(() => {});

    render(<JourneyChips kind="node" refId={42} />);
    const remove = await screen.findByLabelText("Remove from Become an RN");
    await act(async () => { remove.click(); });
    await waitFor(() => expect(toast).toHaveBeenCalledWith(
      "Couldn't remove that from the Journey — try again.", "⚠️", 3500,
    ));
  });
});
