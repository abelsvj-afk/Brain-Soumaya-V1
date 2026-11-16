import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { STORY } from "@brain/shared";
import StoryBook from "./StoryBook.js";
import * as api from "../api/story.js";
import { NEW_ART_ENTRIES, readNewArtSeen } from "../lib/storyArt.js";

// Item 5, wired list (no mock): the six Sheets 6 & 10 single-pass settles.
// The mocked twin (StoryBookNewArt.test.tsx) proves the mechanism with
// stand-ins; this file proves the real list behaves the same way.
const SIX = [
  "sight.unmade-standing",
  "sight.unmade-frame",
  "obj.unmade-tally",
  "sight.unmade-no-mark",
  "sight.fold-letter",
  "sight.fold-reader",
];

const NOW = new Date().toISOString();
const find = (entryId: string) => ({ entryId, foundAt: NOW, source: "regard", lastRecalledAt: null, recallCount: 0 });

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(api, "getStoryRoads").mockResolvedValue([]);
});
afterEach(cleanup);

describe("the Book's new art, wired list (Item 5)", () => {
  it("lists exactly the six settled entries", () => {
    expect([...NEW_ART_ENTRIES].sort()).toEqual([...SIX].sort());
  });

  it("announces all six in words and badges them in the sky — never a digit", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: SIX.map(find), links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point").length).toBeGreaterThan(40));
    const notice = screen.getByText("Six entries are newly illustrated — find their lights in the sky.");
    expect(notice.textContent).not.toMatch(/\d/); // the Book shows no digits anywhere
    expect(container.querySelectorAll(".book-point.is-new-art").length).toBe(6);
    expect(container.querySelectorAll(".book-new-dot").length).toBe(6);
  });

  it("opening one shows its New art card badge and picture, counts the notice down, and clears its sky badge", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: SIX.map(find), links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point.is-new-art").length).toBe(6));
    fireEvent.click(screen.getByLabelText(/Still Folded/));
    await waitFor(() => expect(screen.getByText("Five entries are newly illustrated — find their lights in the sky.")).toBeTruthy());
    expect(container.querySelectorAll(".book-point.is-new-art").length).toBe(5);
    expect(container.querySelector(".book-new-badge")?.textContent).toBe("New art");
    expect(container.querySelector(".book-art")?.getAttribute("src")).toBe("/lore/sight.fold-letter.webp");
    expect(readNewArtSeen().has("sight.fold-letter")).toBe(true);
    // A second, already-seen entry still badges on its first viewing…
    fireEvent.click(screen.getByLabelText(/A Place for the Reader/));
    await waitFor(() => expect(screen.getByText("Four entries are newly illustrated — find their lights in the sky.")).toBeTruthy());
    expect(container.querySelector(".book-new-badge")?.textContent).toBe("New art");
    // …but coming back to the first one, seen, shows no badge any more.
    fireEvent.click(screen.getByLabelText(/Still Folded/));
    await waitFor(() => expect(screen.getByText("Four entries are newly illustrated — find their lights in the sky.")).toBeTruthy());
    expect(container.querySelector(".book-new-badge")).toBeNull();
  });

  it("an entry that is not new art wears no badge, on sky or card", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("obj.doorkeepers-nail")], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point").length).toBeGreaterThan(40));
    expect(container.querySelectorAll(".book-point.is-new-art").length).toBe(0);
    expect(screen.queryByText(/newly illustrated/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/The Doorkeeper's Nail/));
    await waitFor(() => expect(container.querySelector(".book-card")).toBeTruthy());
    expect(container.querySelector(".book-new-badge")).toBeNull();
  });

  it("tapping an unfound shape does not spend its pop-up: found later, it still badges", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("sight.fold-letter")], links: [], notes: [] });
    const { container, unmount } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point").length).toBeGreaterThan(40));
    expect(container.querySelectorAll(".book-point.is-new-art").length).toBe(1);
    // The reader's sky point, still a shape: tap it (no find row exists).
    const points = [...container.querySelectorAll(".book-point")];
    const readerIdx = STORY.entries.filter((e) => !e.retired).findIndex((e) => e.id === "sight.fold-reader");
    fireEvent.click(points[readerIdx]!);
    await waitFor(() => expect(container.querySelector(".book-card")).toBeTruthy());
    expect(container.querySelector(".book-card")!.textContent).toMatch(/A shape waits here/);
    expect(readNewArtSeen().has("sight.fold-reader")).toBe(false);
    unmount();
    // Found later, on a fresh open, it still pops.
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("sight.fold-letter"), find("sight.fold-reader")], links: [], notes: [] });
    const second = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(second.container.querySelectorAll(".book-point.is-new-art").length).toBe(2));
    expect(screen.getByText("Two entries are newly illustrated — find their lights in the sky.")).toBeTruthy();
  });
});
