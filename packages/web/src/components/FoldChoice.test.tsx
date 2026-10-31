import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import FoldChoice, { FOLD_LINES } from "./FoldChoice.js";
import * as api from "../api/story.js";

/** The room asks once and says nothing about what the letter reads or whether it is kind; opening asks twice and is final. */
beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("the Folded Letter's choice", () => {
  it("offers keep or open; keeping stores 'kept', thanks you from the seat, and leaves 'open it' for later", async () => {
    vi.spyOn(api, "getFoldChoice").mockResolvedValue(null);
    const put = vi.spyOn(api, "putFoldChoice").mockResolvedValue("kept");
    render(<FoldChoice />);
    await screen.findByText(FOLD_LINES.choose);
    fireEvent.click(screen.getByRole("button", { name: "Keep it folded" }));
    await screen.findByText(FOLD_LINES.kept);
    expect(put).toHaveBeenCalledWith("kept");
    expect(screen.getByText(FOLD_LINES.keeper.kept)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open it" })).toBeTruthy(); // keeping is not final
  });

  it("asks a second time before opening, lets you say 'not yet', and stores 'opened' only on the second yes", async () => {
    vi.spyOn(api, "getFoldChoice").mockResolvedValue(null);
    const put = vi.spyOn(api, "putFoldChoice").mockResolvedValue("opened");
    render(<FoldChoice />);
    fireEvent.click(await screen.findByRole("button", { name: "Open it" }));
    await screen.findByText(FOLD_LINES.confirm);
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Not yet" }));
    await screen.findByText(FOLD_LINES.choose);
    fireEvent.click(screen.getByRole("button", { name: "Open it" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open it" }));
    await screen.findByText(FOLD_LINES.opened);
    expect(put).toHaveBeenCalledWith("opened");
  });

  it("once opened, offers no more choices, never shows any words of the letter, and never says it was kind", async () => {
    vi.spyOn(api, "getFoldChoice").mockResolvedValue("opened");
    const { container } = render(<FoldChoice />);
    await screen.findByText(FOLD_LINES.opened);
    expect(screen.queryByRole("button")).toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain("will not say what it said, or whether it was kind");
    expect(/\d/.test(text)).toBe(false);
  });

  it("says plainly when the room cannot answer, and lets you go back", async () => {
    vi.spyOn(api, "getFoldChoice").mockResolvedValue(null);
    vi.spyOn(api, "putFoldChoice").mockResolvedValue(null);
    render(<FoldChoice />);
    fireEvent.click(await screen.findByRole("button", { name: "Keep it folded" }));
    await screen.findByText(FOLD_LINES.trouble);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText(FOLD_LINES.choose);
  });
});
