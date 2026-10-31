import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import StoryBook from "./StoryBook.js";
import * as api from "../api/story.js";

const NOW = new Date().toISOString();
const find = (entryId: string) => ({ entryId, foundAt: NOW, source: "regard", lastRecalledAt: null, recallCount: 0 });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, "getStoryRoads").mockResolvedValue([]);
});
afterEach(cleanup);

describe("The Sixteenth's Book", () => {
  it("is only shapes at first: an invitation, no counts, nothing locked", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/This book keeps what you notice/)).toBeTruthy());
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\d/); // no number anywhere in the Book
    expect(text).not.toMatch(/locked|unlocked|complete|%|of \d/i);
    // every entry is a button, all of them silhouettes
    expect(container.querySelectorAll(".book-point").length).toBeGreaterThan(40);
    expect(container.querySelectorAll(".book-point.is-found").length).toBe(0);
  });

  it("the owner can preview everything (a view only); nobody else is offered it", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [], links: [], notes: [], owner: true });
    const put = vi.spyOn(api, "putStoryLink");
    const { container } = render(<StoryBook onClose={() => {}} />);
    const box = await screen.findByLabelText(/Preview everything/);
    expect(container.querySelectorAll(".book-point.is-found").length).toBe(0);
    fireEvent.click(box);
    expect(container.querySelectorAll(".book-point.is-found").length).toBeGreaterThan(40);
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(box);
    expect(container.querySelectorAll(".book-point.is-found").length).toBe(0);
  });

  it("a player who is not the owner is not offered the preview", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [], links: [], notes: [] });
    render(<StoryBook onClose={() => {}} />);
    await screen.findByText(/This book keeps what you notice/);
    expect(screen.queryByLabelText(/Preview everything/)).toBeNull();
  });

  it("lights what is found and shows its words; a partner adds the second reading", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("obj.doorkeepers-nail"), find("relic.harbor-nail")], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point.is-found").length).toBe(2));
    fireEvent.click(screen.getByLabelText(/The Doorkeeper's Nail/));
    const card = container.querySelector(".book-card")!.textContent ?? "";
    expect(card).toMatch(/It is warm\. It is always warm/);
    expect(card).toMatch(/another, given to a man who walked toward a seam/);
  });

  it("without the partner there is no second reading", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("obj.doorkeepers-nail")], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point.is-found").length).toBe(1));
    fireEvent.click(screen.getByLabelText(/The Doorkeeper's Nail/));
    expect(container.querySelector(".book-card")!.textContent).not.toMatch(/walked toward a seam/);
  });

  it("lays one light beside another; a lit pair says so, an unlit pair says nothing", async () => {
    const book = { finds: [find("obj.vesh-paper-boat"), find("sight.lullaby-hollow"), find("obj.follower-ribbon")], links: [], notes: [] };
    vi.spyOn(api, "getStoryBook").mockResolvedValue(book);
    const put = vi.spyOn(api, "putStoryLink");
    put.mockResolvedValueOnce({ a: "obj.vesh-paper-boat", b: "sight.lullaby-hollow", linkedAt: NOW, lit: true });
    put.mockResolvedValueOnce({ a: "obj.follower-ribbon", b: "obj.vesh-paper-boat", linkedAt: NOW, lit: false });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point.is-found").length).toBe(3));
    fireEvent.click(screen.getByLabelText(/Vesh's Paper Boat/));
    fireEvent.click(screen.getByText("Lay beside another"));
    fireEvent.click(screen.getByLabelText(/The Lullaby's Hollow/));
    await waitFor(() => expect(screen.getByText("A thread of light joins them.")).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/Vesh's Paper Boat/));
    fireEvent.click(screen.getByText("Lay beside another"));
    fireEvent.click(screen.getByLabelText(/The Follower's Ribbon/));
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("A thread of light joins them.")).toBeNull();
  });

  it("a silhouette tells you only what kind of thing it is, never where", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point").length).toBeGreaterThan(0));
    fireEvent.click(container.querySelector(".book-point")!);
    const card = container.querySelector(".book-card")!;
    expect(card.textContent).toMatch(/A shape waits here/);
    expect(card.textContent).not.toMatch(/Station|Deep Past|Growing|Quiet|Scale|People|Eternity/);
  });
});

describe("The Book's pictures", () => {
  it("shows a painting only once its entry is found, and only for entries that have an approved one", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("sight.blank-nameplate"), find("sight.siege-edges")], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point.is-found").length).toBe(2));
    fireEvent.click(screen.getByLabelText(/The Blank Nameplate/));
    expect(container.querySelector(".book-art")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Edges in Ranks/));
    expect(container.querySelector(".book-art")).toBeNull(); // no approved picture for it: just words
  });
  it("never shows a picture for an entry that has not been found", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(container.querySelectorAll(".book-point").length).toBeGreaterThan(40));
    fireEvent.click(container.querySelector(".book-point")!);
    expect(container.querySelector(".book-art")).toBeNull();
  });
});

describe("Roads in the Book", () => {
  it("shows only roads you took, in words, never a count; rest and resume are plain buttons", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("sight.open-alcove")], links: [], notes: [] });
    vi.spyOn(api, "getStoryRoads").mockResolvedValue([
      { roadId: "road.open-alcove", state: "taken", updatedAt: NOW },
      { roadId: "road.door-closed", state: "rested", updatedAt: NOW },
    ]);
    const put = vi.spyOn(api, "putStoryRoad").mockResolvedValue({ road: { roadId: "road.open-alcove", state: "rested", updatedAt: NOW } });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("The Open Alcove")).toBeTruthy());
    expect(screen.getByText(/Wait until the alcove has someone resting in it/)).toBeTruthy(); // the one line it waits at
    expect(screen.getByText(/It is resting. It will keep./)).toBeTruthy();
    expect(screen.queryByText("The Seventh Berth")).toBeNull(); // a road never taken is simply not there
    expect(container.querySelector(".book-roads")?.textContent ?? "").not.toMatch(/\d|%|locked/i);
    fireEvent.click(screen.getAllByText("Let it rest for now")[0]!);
    await waitFor(() => expect(put).toHaveBeenCalledWith("road.open-alcove", "rested"));
  });
});

describe("Lines in the Book", () => {
  it("names only the lit, joins two lit with a thread in words, and never counts", async () => {
    vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [find("relic.harbor-nail"), find("sight.gatepost-lamp"), find("obj.orus-bead")], links: [], notes: [] });
    const { container } = render(<StoryBook onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/The Line of the Door/)).toBeTruthy());
    expect(screen.getByText("Teru · Mara")).toBeTruthy();
    expect(screen.getByText("The story joins them.")).toBeTruthy();
    expect(screen.getByText("Oru")).toBeTruthy();
    expect(screen.queryByText(/Orsolya/)).toBeNull(); // not yet found: not named
    expect(container.querySelector(".book-lines")?.textContent ?? "").not.toMatch(/\d|%|locked|missing/i);
  });
});
