import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

vi.mock("../graph/sfx.js", () => ({ playSfx: () => {} }));

function mockPhone(matches: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Toasts — reviewer r2 (#171)", () => {
  it("Enter on the nested +N / × doesn't fire the toast's own action", async () => {
    mockPhone(true);
    const { Toasts, pushToast } = await import("./Toasts.js");
    const actions: unknown[] = [];
    const on = (e: Event) => actions.push((e as CustomEvent).detail);
    window.addEventListener("brain-toast-action", on);
    render(<Toasts />);
    act(() => {
      pushToast("Older", "✨", 8000);
      pushToast("Newest with action", "✨", 8000, "normal", { kind: "tab", value: "insights" } as never);
    });
    const more = screen.getByRole("button", { name: /more notification/ });
    fireEvent.keyDown(more, { key: "Enter" });
    const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
    fireEvent.keyDown(dismiss, { key: "Enter" });
    expect(actions).toEqual([]);
    // Enter on the toast itself still runs its action.
    const toast = screen.getByText("Newest with action").closest(".toast") as HTMLElement;
    fireEvent.keyDown(toast, { key: "Enter" });
    expect(actions).toEqual([{ kind: "tab", value: "insights" }]);
    window.removeEventListener("brain-toast-action", on);
  });

  it("phone with no live toast but overflow waiting shows a compact Inbox chip", async () => {
    mockPhone(true);
    const { Toasts, pushToast } = await import("./Toasts.js");
    render(<Toasts />);
    act(() => {
      for (let i = 0; i < 6; i++) pushToast(`Toast ${i}`, "✨", 8000);
    });
    // dismiss every visible toast; the overflow (beyond the 3-slot cap) remains
    for (let i = 0; i < 6; i++) {
      const d = screen.queryAllByRole("button", { name: "Dismiss notification" })[0];
      if (!d) break;
      act(() => { fireEvent.click(d); });
    }
    const chip = screen.getByRole("button", { name: /in your Inbox — open Inbox/ });
    expect(chip.textContent).toMatch(/3 in Inbox/);
  });
});
