import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NEUTRAL_CURRENTS, societyDay } from "@brain/shared";

const setReflect = vi.fn(async () => ({ reflect: false, society: societyDay(null, "2026-10-30") }));
const reading = { reflect: true, society: societyDay({ ...NEUTRAL_CURRENTS, reverence: 0.9, giving: 0.8 }, "2026-10-30") };
vi.mock("../api/society.js", () => ({
  getSociety: vi.fn(async () => reading),
  setSocietyReflect: (...a: unknown[]) => (setReflect as unknown as (...x: unknown[]) => unknown)(...a),
}));

import SocietyPanel from "./SocietyPanel.js";

afterEach(cleanup);

describe("SocietyPanel", () => {
  it("shows the currents in words, the factions with their callings, ordinances and who is doing what — and says it is a mirror", async () => {
    render(<SocietyPanel onClose={() => {}} />);
    expect(screen.getByText(/mirror, not a verdict/i)).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("strong").length).toBeGreaterThan(0));
    for (const name of ["Reverence", "Giving", "Ambition", "Appetite", "Friction", "Weight", "Peace"]) expect(screen.getByText(name)).toBeTruthy();
    for (const f of ["The Choir", "The Open Hand", "The Ledger", "The Undertow", "The Wardens"]) expect(screen.getByText(f)).toBeTruthy();
    expect(screen.getByLabelText("Ordinances")).toBeTruthy();
    expect(screen.getByLabelText("Who is doing what")).toBeTruthy();
    // Meaning is in words, never colour alone: every current has a spoken strength.
    expect(screen.getAllByText(/^(strong|present|faint|quiet)$/).length).toBe(7);
  });
  it("closes, and the switch turns the reflection off through the server", async () => {
    const onClose = vi.fn();
    render(<SocietyPanel onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("checkbox"));
    await waitFor(() => expect(setReflect).toHaveBeenCalledWith(false));
  });
  it("never labels the person: no good/bad scoring anywhere", async () => {
    render(<SocietyPanel onClose={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("strong").length).toBeGreaterThan(0));
    expect(document.body.textContent).not.toMatch(/good person|bad person|your score|morality|sinner/i);
  });
});
