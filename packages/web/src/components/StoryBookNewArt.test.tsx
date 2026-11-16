import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import StoryBook from "./StoryBook.js";
import * as api from "../api/story.js";
import { countWords, markNewArtSeen, readNewArtSeen } from "../lib/storyArt.js";

// Item 5 with picks standing in: the real NEW_ART_ENTRIES is empty (no
// owner picks exist yet), so the tests stand in two found entries to prove
// the badge + notice + seen-set behaviour the empty list will grow into.
vi.mock("../lib/storyArt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/storyArt.js")>();
  return { ...actual, NEW_ART_ENTRIES: ["obj.doorkeepers-nail", "relic.harbor-nail"] };
});

const NOW = new Date().toISOString();
const find = (entryId: string) => ({ entryId, foundAt: NOW, source: "regard", lastRecalledAt: null, recallCount: 0 });

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(api, "getStoryRoads").mockResolvedValue([]);
});
afterEach(cleanup);

describe("the Book's new-art surfacing (Item 5)", () => {
  it("announces newly illustrated entries in words, and badges them in the sky — never a digit", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("obj.doorkeepers-nail"), find("relic.harbor-nail")], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point").length).toBeGreaterThan(40));
    const notice = screen.getByText("Two entries are newly illustrated — find their lights in the sky.");
    expect(notice.textContent).not.toMatch(/\d/); // the Book shows no digits anywhere
    expect(container.querySelectorAll(".book-point.is-new-art").length).toBe(2);
    expect(container.querySelectorAll(".book-new-dot").length).toBe(2);
  });

  it("opening an entry clears it from the unseen set — the notice counts down and its badge goes away", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("obj.doorkeepers-nail"), find("relic.harbor-nail")], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point.is-new-art").length).toBe(2));
    fireEvent.click(screen.getByLabelText(/The Doorkeeper's Nail/));
    await waitFor(() => expect(screen.getByText("One entry is newly illustrated — find its light in the sky.")).toBeTruthy());
    expect(container.querySelectorAll(".book-point.is-new-art").length).toBe(1);
    expect(readNewArtSeen().has("obj.doorkeepers-nail")).toBe(true);
    expect(readNewArtSeen().has("relic.harbor-nail")).toBe(false);
  });

  it("an entry not yet found wears no badge and is not counted — the badge is found-gated like the picture", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("obj.doorkeepers-nail")], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point").length).toBeGreaterThan(40));
    expect(screen.getByText("One entry is newly illustrated — find its light in the sky.")).toBeTruthy();
    expect(container.querySelectorAll(".book-point.is-new-art").length).toBe(1);
  });
});

describe("the new-art seen-set and word counts", () => {
  it("counts in words, never digits", () => {
    expect(countWords(0)).toBe("no");
    expect(countWords(1)).toBe("one");
    expect(countWords(2)).toBe("two");
    expect(countWords(20)).toBe("twenty");
    expect(countWords(21)).toBe("many");
  });

  it("remembers what this device has opened, and survives a bad stored value", () => {
    expect(readNewArtSeen().size).toBe(0);
    markNewArtSeen("obj.doorkeepers-nail");
    expect(readNewArtSeen().has("obj.doorkeepers-nail")).toBe(true);
    localStorage.setItem("book.newArtSeen", "not json at all");
    expect(readNewArtSeen().size).toBe(0);
  });
});
