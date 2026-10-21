import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

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

describe("HelpPanel — dialog semantics", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<HelpPanel onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("exposes a dialog role with a readable label", () => {
    render(<HelpPanel onClose={() => {}} />);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Galaxy Pilot Manual");
  });
});

describe("HelpPanel — a category's 'Try it' button is reachable, not just readable", () => {
  it("dispatches the mapped action for a category that has one", () => {
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    render(<HelpPanel onClose={() => {}} />);
    fireEvent.click(screen.getByText("💬"));
    // IM-131 remainder: the category jump AND the Chat card's own per-card
    // Try-it share this label (both dispatch {kind:"chat"}) — either proves it.
    const tryBtn = screen.getAllByText("💬 Open chat")[0]!;
    fireEvent.click(tryBtn);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "chat" } }));
    window.removeEventListener("brain-toast-action", onAction);
  });

  it("shows no 'Try it' button for a category with no clean single action", () => {
    render(<HelpPanel onClose={() => {}} />);
    // IM-131 remainder: the default tab is now "start" (Getting Started);
    // "navigation" is the category with no CATEGORY_TRY_IT entry — open it
    // explicitly. (Its cards DO carry some per-card Try-its, none of which
    // start with "Open " in this category.)
    fireEvent.click(screen.getByText("Controls & Flight"));
    expect(screen.queryByText(/^Open /)).toBeNull();
  });
});

describe("HelpPanel — zero search results is no longer a dead end", () => {
  it("offers an ask-Soumaya escape hatch", () => {
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    render(<HelpPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search pilot guide/), { target: { value: "zzzznomatch" } });
    const askBtn = screen.getByText("💬 Ask Soumaya instead");
    fireEvent.click(askBtn);
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "chat" } }));
    window.removeEventListener("brain-toast-action", onAction);
  });
});

describe("HelpPanel — IM-131 accuracy: cards must describe the UI that actually exists", () => {
  // Help is the trust surface; these pins keep the three documented false
  // cards (plus the Settings understatement) from creeping back. Each claim
  // was verified against the code cited in the IM-131 commit.
  const search = (q: string) => {
    fireEvent.change(screen.getByPlaceholderText(/Search pilot guide/), { target: { value: q } });
  };

  it("About Me is described as auto-derived, not hand-filled", () => {
    render(<HelpPanel onClose={() => {}} />);
    search("About Me");
    expect(screen.getByText(/derives it from your memories herself/)).toBeTruthy();
    expect(screen.getByText(/isn't edited by hand/)).toBeTruthy();
    expect(screen.queryByText(/Fill in 'About Me'/)).toBeNull();
  });

  it("Grounded Insight is located in the Companion panel inside Chat (🎭), not a 'Companion tab'", () => {
    render(<HelpPanel onClose={() => {}} />);
    search("Grounded insight");
    expect(screen.getByText(/Tap 🎭 inside the chat/)).toBeTruthy();
  });

  it("no card points at a 'Companion tab' or a 'List tab' — neither exists", () => {
    render(<HelpPanel onClose={() => {}} />);
    search("Companion tab");
    expect(screen.getByText(/No guides match/)).toBeTruthy();
    search("List tab");
    expect(screen.getByText(/No guides match/)).toBeTruthy();
  });

  it("Drifting orphans are filtered in Browse (📚), via the '🪐 drifting' chip", () => {
    render(<HelpPanel onClose={() => {}} />);
    search("drifting");
    expect(screen.getByText(/filter for them in the Browse tab \(📚\)/)).toBeTruthy();
    expect(screen.getByText(/'🪐 drifting' chip/)).toBeTruthy();
  });

  it("the Settings card names the panel's real sections, not just account/voice/sounds", () => {
    render(<HelpPanel onClose={() => {}} />);
    search("Settings & preferences");
    expect(screen.getByText(/Graphics & performance section and a Diagnostics area/)).toBeTruthy();
  });
});

describe("HelpPanel — reading the whole manual is finally rewarded", () => {
  it("celebrates only once every category has actually been visited", () => {
    render(<HelpPanel onClose={() => {}} />);
    const tabs = screen.getAllByRole("button", { name: /./ }).filter((b) => b.className.includes("help-tab-btn"));
    expect(tabs.length).toBeGreaterThan(1);
    for (const tab of tabs) {
      act(() => tab.click());
    }
    expect(playSfx).toHaveBeenCalledWith("achievement");
    expect(pushToast).toHaveBeenCalledWith(expect.stringContaining("Pilot Manual"), "📖", expect.any(Number));
  });

  it("does not celebrate again on a fresh mount after completion was already recorded", () => {
    localStorage.setItem(
      "brain.help.seen.space1",
      JSON.stringify(["start", "navigation", "rules", "structure", "talk", "explore", "fleet", "hangar", "money", "journeys"]),
    );
    render(<HelpPanel onClose={() => {}} />);
    expect(playSfx).not.toHaveBeenCalled();
  });
});

describe("HelpPanel — IM-131 remainder: Connections card, Getting Started landing, per-card Try-it", () => {
  it("lands on Getting Started by default", () => {
    render(<HelpPanel onClose={() => {}} />);
    // The Getting Started cards are visible without touching the sidebar.
    expect(screen.getByText("Your private brain")).toBeTruthy();
    expect(screen.getByText("Dump a thought")).toBeTruthy();
  });

  it("has a Help card for the Connections panel", () => {
    render(<HelpPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search pilot guide/), { target: { value: "Connections (suggested" } });
    expect(screen.getByText("Connections (suggested links)")).toBeTruthy();
    expect(screen.getByText(/held back/)).toBeTruthy();
    expect(screen.getByText(/Declutter weak links/)).toBeTruthy();
  });

  it("the Lenses card's own Try-it opens Lenses (not the category's Insights jump)", () => {
    const onOpen = vi.fn();
    window.addEventListener("brain-open-lenses", onOpen);
    render(<HelpPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search pilot guide/), { target: { value: "Smart Lenses" } });
    fireEvent.click(screen.getByText("⧉ Open Lenses"));
    expect(onOpen).toHaveBeenCalled();
    window.removeEventListener("brain-open-lenses", onOpen);
  });

  it("the Connections card's own Try-it opens Connections", () => {
    const onOpen = vi.fn();
    window.addEventListener("brain-open-connections", onOpen);
    render(<HelpPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search pilot guide/), { target: { value: "Connections (suggested" } });
    fireEvent.click(screen.getByText("🔗 Open Connections"));
    expect(onOpen).toHaveBeenCalled();
    window.removeEventListener("brain-open-connections", onOpen);
  });

  it("a card-level tab target rides brain-toast-action with that feature's tab", () => {
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    render(<HelpPanel onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Search pilot guide/), { target: { value: "Safe to Spend" } });
    fireEvent.click(screen.getByText("💵 Open Money"));
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ detail: { kind: "tab", value: "money" } }));
    window.removeEventListener("brain-toast-action", onAction);
  });
});
