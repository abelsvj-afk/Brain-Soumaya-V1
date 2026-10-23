import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../api/client.js", () => ({ ingestText: vi.fn(), getSpaceId: () => "space1" }));
vi.mock("../api/journeys.js", () => ({
  getJourneys: vi.fn(async () => []),
  journeysFor: vi.fn(async () => []),
  suggestJourneys: vi.fn(async () => []),
  linkToJourney: vi.fn(),
  unlinkFromJourney: vi.fn(),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { IngestPanel } from "./IngestPanel.js";

afterEach(() => cleanup());
// IM-117 composition (Round 2 coordinator): IngestPanel now persists drafts
// to localStorage, so the share-prefill test above leaves a saved draft
// behind. "Starts empty" is only a valid premise with clean storage —
// isolate it explicitly instead of leaking state between tests.
beforeEach(() => localStorage.clear());

describe("IngestPanel — IM-141 shared-text prefill", () => {
  it("seeds the capture box with the shared text (share-target landing)", () => {
    render(<IngestPanel onIngested={() => {}} initialText={"A shared idea\nhttps://x.test/a"} />);
    const box = screen.getByPlaceholderText(/A business idea/) as HTMLTextAreaElement;
    expect(box.value).toBe("A shared idea\nhttps://x.test/a");
  });

  it("starts empty for an ordinary capture open", () => {
    render(<IngestPanel onIngested={() => {}} />);
    const box = screen.getByPlaceholderText(/A business idea/) as HTMLTextAreaElement;
    expect(box.value).toBe("");
  });
});
