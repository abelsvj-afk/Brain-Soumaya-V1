import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const getSpaceId = vi.fn(() => "space1");
vi.mock("../api/client.js", () => ({ getSpaceId: () => getSpaceId() }));
const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));
const pushToast = vi.fn();
vi.mock("./Toasts.js", () => ({ pushToast: (...a: unknown[]) => pushToast(...a) }));

import { HelpPanel } from "./HelpPanel.js";

beforeEach(() => {
  vi.resetAllMocks();
  getSpaceId.mockReturnValue("space1");
  localStorage.clear();
});
afterEach(() => cleanup());

function openPlayCategory() {
  render(<HelpPanel onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /Playing the game/ }));
}

describe("HelpPanel — 'Playing the game' category (Verb 1)", () => {
  it("lists the play category with the spec's title and description", () => {
    openPlayCategory();
    expect(screen.getByRole("heading", { level: 3, name: "🎮 Playing the game" })).toBeTruthy();
    expect(
      screen.getByText(
        "Soumaya is a second brain first and a game second. These are the four things you can actually do inside the worlds — and what each one does to your real memories.",
      ),
    ).toBeTruthy();
  });

  it("shows EXACTLY TWO cards: the overview and Tend — never the unbuilt verbs' cards", () => {
    openPlayCategory();
    expect(screen.getByText("The four verbs")).toBeTruthy();
    expect(screen.getByText("Tend a plot")).toBeTruthy();
    // The overview card's body names the other verbs in prose — but no
    // card of their own exists until their verbs are built.
    expect(screen.queryByText("Resurface a memory")).toBeNull();
    expect(screen.queryByText("Take a commission")).toBeNull();
    expect(screen.queryByText("Find a relic")).toBeNull();
  });

  it("the category Try-It opens the existing Journeys tab", () => {
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    openPlayCategory();
    fireEvent.click(screen.getByText("🧭 Open Journeys"));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { kind: "tab", value: "journeys" } }),
    );
    window.removeEventListener("brain-toast-action", onAction);
  });

  it("the Tend card's Try-It travels to the Growing Place", () => {
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    openPlayCategory();
    fireEvent.click(screen.getByText("🌱 Travel to Growing Place"));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { kind: "travel", value: "growing-place" } }),
    );
    window.removeEventListener("brain-toast-action", onAction);
  });
});
