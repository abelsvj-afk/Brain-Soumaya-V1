import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";

const playSfx = vi.fn();
vi.mock("../graph/sfx.js", () => ({ playSfx: (...a: unknown[]) => playSfx(...a) }));

beforeEach(() => {
  vi.resetModules();
  playSfx.mockReset();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Toasts.tsx keeps module-level state (paused/quiet/buffer/nextId) — reimport it
 *  fresh per test so one test's pushToast calls can't leak into the next. */
async function freshToasts() {
  return import("./Toasts.js");
}

describe("pushToast — duplicate guard runs before display, not just before logging", () => {
  it("suppresses a rapid duplicate's display and sound, not only its log entry", async () => {
    const { Toasts, pushToast } = await freshToasts();
    render(<Toasts />);
    act(() => {
      pushToast("Same text", "✨", 8000);
      pushToast("Same text", "✨", 8000); // within the 1s window
    });
    expect(screen.getAllByText("Same text")).toHaveLength(1);
    expect(playSfx).toHaveBeenCalledTimes(1);
  });
});

describe("maybeFlush — unpausing must not bypass a still-active quiet mode", () => {
  it("keeps a quiet-gated toast hidden when pause lifts but quiet is still on", async () => {
    const { Toasts, pushToast, setToastsPaused, setToastsQuiet } = await freshToasts();
    render(<Toasts />);
    act(() => {
      setToastsPaused(true);
      setToastsQuiet(true);
      pushToast("Routine update", "🔈", 8000, "normal");
      pushToast("She's hailing you", "🚨", 8000, "high");
    });
    act(() => setToastsPaused(false)); // quiet is still on
    expect(screen.getByText("She's hailing you")).toBeTruthy();
    expect(screen.queryByText("Routine update")).toBeNull();

    act(() => setToastsQuiet(false));
    expect(screen.getByText("Routine update")).toBeTruthy();
  });

  it("plays a sound for a toast released from the buffer, not just an immediately-shown one", async () => {
    const { Toasts, pushToast, setToastsPaused } = await freshToasts();
    render(<Toasts />);
    act(() => {
      setToastsPaused(true);
      pushToast("Queued while paused", "✨", 8000);
    });
    expect(playSfx).not.toHaveBeenCalled();
    act(() => setToastsPaused(false));
    expect(playSfx).toHaveBeenCalledWith("notify");
  });
});

describe("Toasts — overflow beyond the 4 visible slots is surfaced, not silently dropped", () => {
  it("shows a '+N more' note when more than 4 toasts land at once", async () => {
    const { Toasts, pushToast } = await freshToasts();
    render(<Toasts />);
    act(() => {
      for (let i = 0; i < 6; i++) pushToast(`Toast ${i}`, "✨", 8000);
    });
    expect(screen.getByText("2 more notifications — see Inbox")).toBeTruthy();
  });

  it("clears the overflow note on its own after a few seconds", async () => {
    vi.useFakeTimers();
    const { Toasts, pushToast } = await freshToasts();
    render(<Toasts />);
    act(() => {
      for (let i = 0; i < 5; i++) pushToast(`Toast ${i}`, "✨", 8000);
    });
    expect(screen.getByText(/more notification/)).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText(/more notification/)).toBeNull();
  });
});

describe("Toasts — priority is a visible, non-colour-only distinction", () => {
  it("gives a high-priority toast a distinct class from a routine one", async () => {
    const { Toasts, pushToast } = await freshToasts();
    render(<Toasts />);
    act(() => pushToast("Big win", "🏆", 8000, "high"));
    const bubble = screen.getByText("Big win").closest(".toast");
    expect(bubble?.className).toContain("priority-high");
  });
});

describe("Toasts — hover must not reset the shared countdown", () => {
  it("does not recreate the countdown interval on every hover enter/leave", async () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const { Toasts, pushToast } = await freshToasts();
    render(<Toasts />);
    act(() => pushToast("Hover me", "✨", 4000));
    const callsAfterMount = setIntervalSpy.mock.calls.length;

    const toastEl = screen.getByText("Hover me").closest(".toast")!;
    fireEvent.mouseEnter(toastEl);
    fireEvent.mouseLeave(toastEl);
    fireEvent.mouseEnter(toastEl);

    expect(setIntervalSpy.mock.calls.length).toBe(callsAfterMount);
    setIntervalSpy.mockRestore();
  });
});

describe("Toasts — the overflow chip opens the Inbox (REG-072 / GH-21)", () => {
  it("clicking the overflow chip dispatches the Inbox tab action", async () => {
    const onAction = vi.fn();
    window.addEventListener("brain-toast-action", onAction);
    try {
      const { Toasts, pushToast } = await freshToasts();
      render(<Toasts />);
      act(() => {
        for (let i = 0; i < 6; i++) pushToast(`Toast ${i}`, "✨", 8000);
      });
      const chip = screen.getByText("2 more notifications — see Inbox");
      fireEvent.click(chip);
      expect(onAction).toHaveBeenCalledWith(
        expect.objectContaining({ detail: { kind: "tab", value: "inbox" } }),
      );
    } finally {
      window.removeEventListener("brain-toast-action", onAction);
    }
  });
});
