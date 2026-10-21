import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { GraphData } from "@brain/shared";

/**
 * IM-91 / IM-95 (Codex half): atlas search, recently-discovered view,
 * field-note chronology, a VISIBLE field-note fetch failure with retry,
 * and go-there buttons on locked entries whose unlock lives in another tab.
 */
const claimCodexReward = vi.fn();
const getCodexDiscoveries = vi.fn();
vi.mock("../api/client.js", () => ({
  claimCodexReward: (...a: unknown[]) => claimCodexReward(...a),
  getCodexDiscoveries: (...a: unknown[]) => getCodexDiscoveries(...a),
}));

const pushToast = vi.fn();
vi.mock("./Toasts.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./Toasts.js")>();
  return { ...actual, pushToast: (...a: unknown[]) => pushToast(...a) };
});

vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));

import { CodexPanel } from "./CodexPanel.js";

// One daily goal memory → discovered: sector-daily ("The Drift"),
// mind-goal ("The Ambition"), fleet entries.
const graph = {
  nodes: [
    {
      id: 1,
      label: "Launch the studio",
      type: "daily",
      kind: "goal",
      content: "x",
      importance: 0.5,
      celestial: "asteroid",
      degree: 0,
      entropy: 0,
      emotionalWeight: 0,
      createdAt: "2026-10-01T12:00:00.000Z",
    },
  ],
  links: [],
} as unknown as GraphData;

const emptyGraph = { nodes: [], links: [] } as unknown as GraphData;

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  claimCodexReward.mockResolvedValue({ awarded: true, fuel: 10 });
  getCodexDiscoveries.mockResolvedValue([]);
});

afterEach(() => cleanup());

describe("IM-91 — search across the atlas", () => {
  it("finds an entry from another category by title", () => {
    const { container, getByLabelText } = render(
      <CodexPanel graph={graph} onFocus={() => {}} spaceId="s1" />,
    );
    // Default tab is Sectors: "The Ambition" (Mind) is not shown yet.
    expect(container.textContent).not.toContain("The Ambition");
    fireEvent.change(getByLabelText(/Search the Codex/), { target: { value: "Ambition" } });
    expect(container.textContent).toContain("The Ambition");
    expect(container.textContent).toMatch(/1 entry matching/);
  });

  it("an unmatched search says so instead of showing an empty category", () => {
    const { container, getByLabelText } = render(
      <CodexPanel graph={graph} onFocus={() => {}} spaceId="s1" />,
    );
    fireEvent.change(getByLabelText(/Search the Codex/), { target: { value: "zzzznope" } });
    expect(container.textContent).toContain("Nothing in the atlas matches that yet.");
  });
});

describe("IM-91 — recently discovered view", () => {
  it("orders discovered entries by recorded discovery time, newest first", () => {
    localStorage.setItem("codex.seen.s1", JSON.stringify(["sector-daily", "mind-goal"]));
    localStorage.setItem(
      "codex.seenAt.s1",
      JSON.stringify({ "sector-daily": "2026-10-01T12:00:00.000Z", "mind-goal": "2026-10-15T12:00:00.000Z" }),
    );
    const { container, getByText } = render(<CodexPanel graph={graph} onFocus={() => {}} spaceId="s1" />);
    fireEvent.click(getByText(/🕒 Recent/));
    const text = container.textContent ?? "";
    const ambition = text.indexOf("The Ambition");
    const drift = text.indexOf("The Drift");
    expect(ambition).toBeGreaterThanOrEqual(0);
    expect(drift).toBeGreaterThan(ambition); // Oct 15 discovery before Oct 1
  });
});

describe("IM-91 — field notes: chronology + honest failure", () => {
  it("renders a field note's charted date", async () => {
    getCodexDiscoveries.mockResolvedValue([
      { key: "k1", title: "A recurring theme", lore: "She noticed…", icon: "✒️", focusId: null, createdAt: "2026-09-14T12:00:00.000Z" },
    ]);
    const { container, getByText } = render(<CodexPanel graph={graph} onFocus={() => {}} spaceId="s1" />);
    fireEvent.click(getByText(/Field Notes/));
    await waitFor(() => expect(container.textContent).toContain("A recurring theme"));
    // Zone-derived expectation: the panel renders the viewer-local calendar
    // date of the stored UTC instant (noon UTC = Sep 14 in New York, Sep 15
    // in Kiritimati) — derive it the same way formatDay does.
    const charted = new Date("2026-09-14T12:00:00.000Z").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    expect(container.textContent).toContain(`Charted ${charted}`);
  });

  it("a failed field-note fetch is visible with retry — not a fake zero", async () => {
    getCodexDiscoveries.mockRejectedValueOnce(new Error("offline"));
    getCodexDiscoveries.mockResolvedValue([]);
    const { container, getByText } = render(<CodexPanel graph={graph} onFocus={() => {}} spaceId="s1" />);
    await waitFor(() => expect(container.querySelector(".codex-notes-error")).not.toBeNull());
    expect(container.textContent).toMatch(/field notes couldn.t be loaded/i);
    fireEvent.click(getByText("Retry"));
    await waitFor(() => expect(container.querySelector(".codex-notes-error")).toBeNull());
    expect(getCodexDiscoveries.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("IM-95 — locked entries carry a go-there action", () => {
  it("the locked constellation entry offers a button to Insights", () => {
    const onNavigate = vi.fn();
    const { getByText } = render(
      <CodexPanel graph={emptyGraph} onFocus={() => {}} spaceId="s1" onNavigate={onNavigate} />,
    );
    fireEvent.click(getByText(/Constellations/));
    fireEvent.click(getByText("Open Insights →"));
    expect(onNavigate).toHaveBeenCalledWith("insights");
  });

  it("a locked Mind entry offers a button to the Mind tab", () => {
    const onNavigate = vi.fn();
    const { getByText } = render(
      <CodexPanel graph={emptyGraph} onFocus={() => {}} spaceId="s1" onNavigate={onNavigate} />,
    );
    fireEvent.click(getByText(/The Mind Layer/));
    // Every locked Mind entry carries the go-there button — click the first.
    fireEvent.click(document.querySelectorAll(".codex-goto")[0]!);
    expect(onNavigate).toHaveBeenCalledWith("mind");
  });

  it("locked rows use the shared locked-state class (one dialect per tab)", () => {
    const { container, getByText } = render(
      <CodexPanel graph={emptyGraph} onFocus={() => {}} spaceId="s1" />,
    );
    fireEvent.click(getByText(/Constellations/));
    const row = container.querySelector(".codex-row.locked");
    expect(row).not.toBeNull();
  });
});
