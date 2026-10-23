import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

/**
 * Batch B — IngestPanel items:
 *  CAP-05 the capture draft is scoped per brain (brain.ingestDraft.<id>),
 *         with adopt-once handling of the legacy global key;
 *  CAP-06 a queued (offline) capture is presented as queued — never in the
 *         ⚠️ error surface — and clears text + draft like a success.
 */

const ingestText = vi.fn();
const getSpaceId = vi.fn((): string | null => "brainA");
vi.mock("../api/client.js", () => ({
  ingestText: (...a: unknown[]) => ingestText(...a),
  getSpaceId: () => getSpaceId(),
}));
vi.mock("../lib/extractFileText.js", () => ({ extractFileText: vi.fn() }));
vi.mock("./JourneyChips.js", () => ({ JourneyChips: () => null }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { IngestPanel } from "./IngestPanel.js";

/** The real OfflineQueuedError's contract surface: name + message. The panel
 *  detects it by name, so the mock module doesn't need the class itself. */
const offlineQueuedError = () =>
  Object.assign(new Error("You're offline — saved. I'll sync it the moment you're back online."), {
    name: "OfflineQueuedError",
  });

const LEGACY = "brain.ingestDraft";
const SCOPED_A = "brain.ingestDraft.brainA";
const SCOPED_B = "brain.ingestDraft.brainB";
const draftJson = (text: string) =>
  JSON.stringify({ text, details: "", tags: [], action: false, ttl: 24, occurred: "", remind: "" });

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  getSpaceId.mockReturnValue("brainA");
  ingestText.mockResolvedValue({
    nodes: [{ id: 1, label: "alpha thought" }],
    extractedEdges: [],
    associativeEdges: [],
    fuelEarned: 0,
  });
});
afterEach(() => cleanup());

const box = () => screen.getByPlaceholderText(/A business idea/) as HTMLTextAreaElement;

describe("CAP-05 — drafts are scoped per brain", () => {
  it("a draft written under brain A never renders in brain B's capture box", async () => {
    const a = render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "brain A words" } });
    expect(localStorage.getItem(SCOPED_A)).toContain("brain A words");
    expect(localStorage.getItem(LEGACY)).toBeNull();
    a.unmount();

    getSpaceId.mockReturnValue("brainB");
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    expect(box().value).toBe("");
  });

  it("brain A's own draft restores for brain A", () => {
    localStorage.setItem(SCOPED_A, draftJson("a long brain dump"));
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    expect(box().value).toBe("a long brain dump");
  });

  it("adopt-once: a legacy global draft moves into the first-opened brain's scoped key and the legacy key is removed", () => {
    localStorage.setItem(LEGACY, draftJson("words from before the upgrade"));
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    // The user's words are not lost…
    expect(box().value).toBe("words from before the upgrade");
    // …they now live under this brain's scoped key only.
    expect(localStorage.getItem(LEGACY)).toBeNull();
    expect(localStorage.getItem(SCOPED_A)).toContain("words from before the upgrade");
  });

  it("after adoption, the other brain does NOT inherit the adopted draft", async () => {
    localStorage.setItem(LEGACY, draftJson("words from before the upgrade"));
    const a = render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    expect(box().value).toBe("words from before the upgrade");
    a.unmount();
    getSpaceId.mockReturnValue("brainB");
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    expect(box().value).toBe("");
  });
});

describe("CAP-06 — a queued capture is presented as queued, never as an error", () => {
  it("OfflineQueuedError lands in the success/notice span, clears text + draft, and shows no ⚠️ alert", async () => {
    ingestText.mockRejectedValue(offlineQueuedError());
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "offline words" } });
    expect(localStorage.getItem(SCOPED_A)).toContain("offline words");
    await act(async () => { fireEvent.click(screen.getByText("Add to brain")); });
    // Not the error surface.
    expect(screen.queryByRole("alert")).toBeNull();
    // Presented as what it is: saved offline / queued.
    expect(screen.getByText(/offline.*saved|queued/i)).toBeTruthy();
    // Cleared exactly like the online success path — no live words inviting a duplicate re-submit.
    expect(box().value).toBe("");
    expect(localStorage.getItem(SCOPED_A)).toBeNull();
  });

  it("a genuine failure still uses the error surface and keeps the words", async () => {
    ingestText.mockRejectedValue(new Error("server exploded"));
    render(<IngestPanel onIngested={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(box(), { target: { value: "boom words" } });
    await act(async () => { fireEvent.click(screen.getByText("Add to brain")); });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("server exploded");
    expect(box().value).toBe("boom words");
  });
});
