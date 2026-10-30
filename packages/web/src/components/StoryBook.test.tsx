import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import StoryBook from "./StoryBook.js";
import * as api from "../api/story.js";

const NOW = new Date().toISOString();
const find = (entryId: string) => ({ entryId, foundAt: NOW, source: "regard", lastRecalledAt: null, recallCount: 0 });

beforeEach(() => {
  vi.restoreAllMocks();
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
