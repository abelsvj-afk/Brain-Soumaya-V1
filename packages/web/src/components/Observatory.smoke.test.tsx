import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { GraphNode } from "@brain/shared";

const getDueReviews = vi.fn().mockResolvedValue([]);
vi.mock("../api/client.js", () => ({
  getConstellations: vi.fn().mockResolvedValue([]),
  getDigest: vi.fn().mockResolvedValue([]),
  // IM-124 residual: Observatory consumes the strict Result variants.
  getConstellationsResult: vi.fn().mockResolvedValue({ ok: true, constellations: [] }),
  getDigestResult: vi.fn().mockResolvedValue({ ok: true, insights: [] }),
  getDailyContact: vi.fn().mockResolvedValue(null),
  answerDailyContact: vi.fn().mockResolvedValue(null),
  getDueReviews: (...a: unknown[]) => getDueReviews(...a),
  getDueReviewsResult: async (...a: unknown[]) => ({ ok: true, reviews: await getDueReviews(...a) }),
}));
vi.mock("../api/finance.js", () => ({
  getFinanceSummary: vi.fn().mockResolvedValue(null),
}));
vi.mock("../api/journeys.js", () => ({
  getJourneys: vi.fn().mockResolvedValue([]),
}));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));
vi.mock("./SoumayaEye.js", () => ({ SoumayaEye: () => null }));

import { Observatory } from "./Observatory.js";

afterEach(cleanup);

function memory(over: Partial<GraphNode>): GraphNode {
  return {
    id: 1,
    label: "a memory",
    type: "memory",
    content: "",
    ...over,
  } as GraphNode;
}

describe("Observatory — search entry point (OPTIMIZATION_ROADMAP.md Problem 4)", () => {
  it("offers a search button when onSearch is passed, and calls it on tap", async () => {
    const onSearch = vi.fn();
    render(
      <Observatory
        spaceName="You"
        memories={[memory({ id: 1, label: "a memory" })]}
        streak={0}
        fedToday={false}
        onCapture={vi.fn()}
        onFocus={vi.fn()}
        onOpenInsights={vi.fn()}
        onEnter={vi.fn()}
        onSearch={onSearch}
      />,
    );
    const btn = await screen.findByLabelText("Search your memories");
    btn.click();
    expect(onSearch).toHaveBeenCalled();
  });

  it("omits the search button when onSearch isn't passed", async () => {
    render(
      <Observatory
        spaceName="You"
        memories={[memory({ id: 1, label: "a memory" })]}
        streak={0}
        fedToday={false}
        onCapture={vi.fn()}
        onFocus={vi.fn()}
        onOpenInsights={vi.fn()}
        onEnter={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("a memory")).toBeTruthy());
    expect(screen.queryByLabelText("Search your memories")).toBeNull();
  });
});

describe("Observatory — Today's tending quest card (CL1)", () => {
  afterEach(() => localStorage.clear());

  it("shows an honest all-done state when every quest is complete", async () => {
    render(
      <Observatory
        spaceName="You"
        spaceId="space-all-done"
        memories={[memory({ id: 1, label: "a memory", degree: 1, entropy: 0 })]}
        streak={1}
        fedToday={true}
        onCapture={vi.fn()}
        onFocus={vi.fn()}
        onOpenInsights={vi.fn()}
        onEnter={vi.fn()}
      />,
    );
    expect(await screen.findByText("Today's tending")).toBeTruthy();
    expect(screen.getByText("1/1 done")).toBeTruthy();
    expect(screen.getByText("All tended for today ✓")).toBeTruthy();
    const logQuest = screen.getByText("Fed your brain today").closest("button")!;
    expect(logQuest.hasAttribute("disabled")).toBe(true);
  });

  it("shows a cooling-memory quest as not done, with no fake all-done line", async () => {
    render(
      <Observatory
        spaceName="You"
        spaceId="space-cooling"
        memories={[memory({ id: 2, label: "old note", degree: 2, entropy: 0.9 })]}
        streak={0}
        fedToday={false}
        onCapture={vi.fn()}
        onFocus={vi.fn()}
        onOpenInsights={vi.fn()}
        onEnter={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Warm a cooling memory · 1 drifting cold/)).toBeTruthy();
    expect(screen.getByText("0/2 done")).toBeTruthy();
    expect(screen.queryByText("All tended for today ✓")).toBeNull();
  });

  it("uses reconnect copy for a drifting memory", async () => {
    render(
      <Observatory
        spaceName="You"
        spaceId="space-drifting"
        memories={[memory({ id: 3, label: "loose note", degree: 0, entropy: 0 })]}
        streak={0}
        fedToday={false}
        onCapture={vi.fn()}
        onFocus={vi.fn()}
        onOpenInsights={vi.fn()}
        onEnter={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Reconnect a drifting memory · 1 unlinked/)).toBeTruthy();
  });
});

describe("Observatory — Today's agenda / Worth a moment cards", () => {
  it("shows nothing agenda-related when there are no due reminders and no open actions", async () => {
    render(
      <Observatory
        spaceName="You"
        memories={[memory({ id: 1, label: "a memory" })]}
        streak={0}
        fedToday={false}
        onCapture={vi.fn()}
        onFocus={vi.fn()}
        onOpenInsights={vi.fn()}
        onEnter={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("a memory")).toBeTruthy());
    expect(screen.queryByText("Today's agenda")).toBeNull();
    expect(screen.queryByText("Worth a moment")).toBeNull();
  });

  it("shows a due-reminders + open-action count and opens the Agenda tab on tap", async () => {
    const onOpenTab = vi.fn();
    const dueMemory = memory({
      id: 2,
      label: "call the vet",
      remindAt: new Date(Date.now() - 60_000).toISOString(),
    });
    render(
      <Observatory
        spaceName="You"
        memories={[dueMemory]}
        actionCount={3}
        streak={0}
        fedToday={false}
        onCapture={vi.fn()}
        onFocus={vi.fn()}
        onOpenInsights={vi.fn()}
        onEnter={vi.fn()}
        onOpenTab={onOpenTab}
      />,
    );
    const card = await screen.findByText("Today's agenda");
    expect(screen.getByText(/1 reminder due/)).toBeTruthy();
    expect(screen.getByText(/3 open actions/)).toBeTruthy();
    card.closest("button")!.click();
    expect(onOpenTab).toHaveBeenCalledWith("actions");
  });

  it("renders a 'Worth a moment' card from a due spaced-repetition item and flies to it on tap", async () => {
    getDueReviews.mockResolvedValueOnce([{ id: 42, label: "the studio lease", strength: 0.1, reviewCount: 0 }]);
    const onFocus = vi.fn();
    render(
      <Observatory
        spaceName="You"
        memories={[memory({ id: 1, label: "a memory" })]}
        streak={0}
        fedToday={false}
        onCapture={vi.fn()}
        onFocus={onFocus}
        onOpenInsights={vi.fn()}
        onEnter={vi.fn()}
      />,
    );
    const card = await screen.findByText("Worth a moment");
    expect(screen.getByText("the studio lease")).toBeTruthy();
    card.closest("button")!.click();
    expect(onFocus).toHaveBeenCalledWith(42);
  });
});
