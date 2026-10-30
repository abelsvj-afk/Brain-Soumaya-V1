import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import NpcTalk from "./NpcTalk.js";
import * as api from "../api/story.js";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.spyOn(api, "getStoryBook").mockResolvedValue({ finds: [], links: [], notes: [] });
});
afterEach(cleanup);

describe("Talking to a person", () => {
  it("opens with who they are, and offers the plain questions and nothing gated", () => {
    const { container } = render(<NpcTalk npc="wayfarer" world="great-station" meetings={1} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: /Talking with Calend/ })).toBeTruthy();
    expect(screen.getByText("Who are you?")).toBeTruthy();
    expect(screen.getByText("What is this place to you?")).toBeTruthy();
    expect(screen.getByText("Is there something I should look for?")).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(/\d/);
  });

  it("opens a thread one step at a time: you hear a step, then the next is offered (and it is remembered)", () => {
    render(<NpcTalk npc="wayfarer" world="great-station" meetings={4} onClose={() => {}} />);
    expect(screen.queryByText("What do you keep looking at?")).toBeNull(); // step two waits for step one
    fireEvent.click(screen.getByText("Where are you always going?"));
    expect(screen.getByText(/arrived somewhere before you had/)).toBeTruthy();
    expect(screen.getByText("What do you keep looking at?")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(`npc.heard.local.wayfarer`) ?? "[]")).toContain("calend.arrived");
  });

  it("a person met only once cannot yet be asked the deeper steps", () => {
    render(<NpcTalk npc="broker" world="great-station" meetings={1} onClose={() => {}} />);
    expect(screen.getByText("What is in the Book?")).toBeTruthy();
    expect(screen.queryByText("Is any debt strange?")).toBeNull();
  });

  it("'something to look for' points toward what is not yet found, in their words — and says so kindly when everything is found", async () => {
    render(<NpcTalk npc="surveyor" world="scale" meetings={1} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Is there something I should look for?"));
    expect(screen.getByText(/star there that does not belong to any chart/)).toBeTruthy();
    cleanup();
    vi.spyOn(api, "getStoryBook").mockResolvedValue({
      finds: ["sight.hung-star", "obj.measurers-cord"].map((entryId) => ({ entryId, foundAt: new Date().toISOString(), source: "regard", lastRecalledAt: null, recallCount: 0 })),
      links: [],
      notes: [],
    });
    render(<NpcTalk npc="surveyor" world="scale" meetings={1} onClose={() => {}} />);
    await waitFor(() => {
      fireEvent.click(screen.getByText("Is there something I should look for?"));
      expect(screen.getByText(/Then it is not only me/)).toBeTruthy();
    });
  });

  it("says goodbye in their own words, then closes; Escape closes at once", () => {
    const onClose = vi.fn();
    render(<NpcTalk npc="keeper" world="growing-place" meetings={2} onClose={onClose} />);
    fireEvent.click(screen.getByText("Goodbye"));
    expect(screen.getByText(/Go slowly/)).toBeTruthy();
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("nobody who cannot be talked to gets a panel (Eternity cannot be asked)", () => {
    const { container } = render(<NpcTalk npc="eternity" world="eternity" meetings={1} onClose={() => {}} />);
    expect(container.querySelector(".npc-talk")).toBeNull();
  });
});
