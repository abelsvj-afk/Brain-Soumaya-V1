import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import StoryBook from "./StoryBook.js";
import * as api from "../api/story.js";

// The studio voice answers "you have not found that yet" (a 403) — the
// Book's status line must carry those exact words, not the collapsed
// "no studio clip" line. The 403 → wording mapping itself is covered in
// narration.test.ts; this test covers the wiring into the status line.
vi.mock("../lib/narration.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/narration.js")>();
  return {
    ...actual,
    playNarration: vi.fn(async (o: { onFallback?: (why: string) => void }) => {
      o.onFallback?.("you have not found that yet, so the studio voice will not read it");
      return "voice" as const;
    }),
  };
});

const NOW = new Date().toISOString();
const find = (entryId: string) => ({ entryId, foundAt: NOW, source: "regard", lastRecalledAt: null, recallCount: 0 });

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(api, "getStoryRoads").mockResolvedValue([]);
  vi.spyOn(api, "getNarrationStatus").mockResolvedValue({ on: true, issue: null });
});
afterEach(cleanup);

describe("the Book's Listen status line (Item 6)", () => {
  it("carries the not-found wording when the studio voice refuses an entry", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("obj.doorkeepers-nail")], links: [], notes: [] });
    render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Narrator: the studio voice\./)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/The Doorkeeper's Nail/));
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    await waitFor(() =>
      expect(screen.getByText(/Narrator: this device’s voice just now — you have not found that yet, so the studio voice will not read it\./)).toBeTruthy(),
    );
  });
});
