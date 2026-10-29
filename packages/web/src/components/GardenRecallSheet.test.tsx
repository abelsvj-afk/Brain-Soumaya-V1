import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("../api/features.js", () => ({ gradeReviewDetailed: vi.fn() }));

import { gradeReviewDetailed } from "../api/features.js";
import { GardenRecallSheet, recallPrompt, RECALL_PROMPTS } from "./GardenRecallSheet.js";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const memory = { id: 7, label: "the lighthouse idea", content: "The keeper hears the sea speak." };

function mount(groveTitle: string | null = "Write the novel") {
  const props = { memory, groveTitle, onCaught: vi.fn(), onNotToday: vi.fn(), onClose: vi.fn() };
  render(<GardenRecallSheet {...props} />);
  return props;
}

describe("GardenRecallSheet — Seed Pods", () => {
  it("asks in her voice, the same way for the same memory", () => {
    mount();
    expect(screen.getByRole("dialog", { name: "A seed pod" }).textContent).toContain(recallPrompt(7, memory.label));
    expect(recallPrompt(7, "x")).toBe(recallPrompt(7, "x"));
    expect(new Set([0, 1, 2].map((i) => recallPrompt(i, "x"))).size).toBe(RECALL_PROMPTS.length);
  });

  it("“I remember” grades it remembered (one attempt key), blooms into its grove, and says when it returns", async () => {
    vi.mocked(gradeReviewDetailed).mockResolvedValue({ ok: true, nextIntervalDays: 6 });
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "I remember" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Seed pod caught" })).toBeTruthy());
    expect(gradeReviewDetailed).toHaveBeenCalledWith(7, true, expect.any(String));
    expect(p.onCaught).toHaveBeenCalledWith(true);
    expect(screen.getByText(/It blooms in Write the novel/)).toBeTruthy();
    expect(screen.getByText(/ripens again in about 6 days/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the garden" }));
    expect(p.onClose).toHaveBeenCalled();
  });

  it("“Show me” reveals the memory first; “Not quite” still blooms — nothing here can be failed", async () => {
    vi.mocked(gradeReviewDetailed).mockResolvedValue({ ok: true });
    const p = mount(null);
    expect(screen.queryByText(memory.content)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show me" }));
    expect(screen.getByText(memory.content)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not quite" }));
    await waitFor(() => expect(p.onCaught).toHaveBeenCalledWith(false));
    expect(gradeReviewDetailed).toHaveBeenCalledWith(7, false, expect.any(String));
    expect(screen.getByText(/It blooms in the meadow/)).toBeTruthy();
    expect(screen.getByText(/come back a little sooner/)).toBeTruthy();
  });

  it("“Not today” grades nothing", () => {
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "Not today" }));
    expect(p.onNotToday).toHaveBeenCalled();
    expect(gradeReviewDetailed).not.toHaveBeenCalled();
  });

  it("a failed grade says so, keeps the pod, and a retry reuses the same attempt key (never double-grades)", async () => {
    vi.mocked(gradeReviewDetailed).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "I remember" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(p.onCaught).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "I remember" }));
    await waitFor(() => expect(p.onCaught).toHaveBeenCalled());
    const keys = vi.mocked(gradeReviewDetailed).mock.calls.map((c) => c[2]);
    expect(keys[0]).toBe(keys[1]);
  });
});
