import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor, fireEvent } from "@testing-library/react";

const getPersonaStrict = vi.fn();
const refreshPersonaStrict = vi.fn();
const getInstructionsStrict = vi.fn();
const createInstruction = vi.fn();
const updateInstruction = vi.fn();
const deleteInstruction = vi.fn();
const getDocumentsStrict = vi.fn();
const uploadDocument = vi.fn();
const renameDocument = vi.fn();
const deleteDocument = vi.fn();
const getSoulStrict = vi.fn();
const setSoul = vi.fn();
const getGroundedInsightStrict = vi.fn();
const setGroundedInsight = vi.fn();
vi.mock("../api/client.js", () => ({
  getPersonaStrict: (...a: unknown[]) => getPersonaStrict(...a),
  refreshPersonaStrict: (...a: unknown[]) => refreshPersonaStrict(...a),
  getInstructionsStrict: (...a: unknown[]) => getInstructionsStrict(...a),
  createInstruction: (...a: unknown[]) => createInstruction(...a),
  updateInstruction: (...a: unknown[]) => updateInstruction(...a),
  deleteInstruction: (...a: unknown[]) => deleteInstruction(...a),
  getDocumentsStrict: (...a: unknown[]) => getDocumentsStrict(...a),
  uploadDocument: (...a: unknown[]) => uploadDocument(...a),
  renameDocument: (...a: unknown[]) => renameDocument(...a),
  deleteDocument: (...a: unknown[]) => deleteDocument(...a),
  getSoulStrict: (...a: unknown[]) => getSoulStrict(...a),
  setSoul: (...a: unknown[]) => setSoul(...a),
  getGroundedInsightStrict: (...a: unknown[]) => getGroundedInsightStrict(...a),
  setGroundedInsight: (...a: unknown[]) => setGroundedInsight(...a),
}));
vi.mock("../lib/extractFileText.js", () => ({ extractFileText: vi.fn() }));

import { AboutMe, Soul, GroundedInsight, Instructions, Knowledge } from "./CompanionSections.js";

beforeEach(() => {
  vi.resetAllMocks();
  getPersonaStrict.mockResolvedValue("");
  refreshPersonaStrict.mockResolvedValue("");
  getInstructionsStrict.mockResolvedValue([]);
  getDocumentsStrict.mockResolvedValue([]);
  getSoulStrict.mockResolvedValue("");
  getGroundedInsightStrict.mockResolvedValue(true);
});
afterEach(() => cleanup());

describe("Companion Round 2 — IM-109: fetched-but-hidden fields are shown", () => {
  it("Knowledge shows a doc's charCount, mime and createdAt alongside its chunks", async () => {
    getDocumentsStrict.mockResolvedValue([
      {
        id: 1,
        name: "Resume",
        mime: "application/pdf",
        charCount: 12345,
        chunks: 7,
        createdAt: "2026-10-01T12:00:00.000Z",
      },
    ]);
    render(<Knowledge />);
    const meta = await screen.findByText(/7 chunks/);
    expect(meta.textContent).toContain("12,345 chars");
    expect(meta.textContent).toContain("application/pdf");
    const expectedDate = new Date("2026-10-01T12:00:00.000Z").toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    expect(meta.textContent).toContain(`added ${expectedDate}`);
  });

  it("Instructions displays a profile's priority", async () => {
    getInstructionsStrict.mockResolvedValue([
      { id: 1, name: "Coach", body: "Be direct.", enabled: true, mode: "always", priority: 42, createdAt: "2026-09-01T00:00:00.000Z" },
    ]);
    render(<Instructions />);
    await screen.findByText(/● Coach/);
    expect(screen.getByText(/⇡ 42/)).toBeTruthy();
  });

  it("the new-role form sends the chosen priority to createInstruction", async () => {
    createInstruction.mockResolvedValue({});
    render(<Instructions />);
    await screen.findByText("No profiles yet — add one below.");
    act(() => screen.getByText("+ New role").click());

    const nameInput = screen.getByPlaceholderText(/Role name/);
    fireEvent.change(nameInput, { target: { value: "Examiner" } });
    const bodyInput = screen.getByPlaceholderText(/How should she behave/);
    fireEvent.change(bodyInput, { target: { value: "Quiz me hard." } });
    const priorityInput = document.querySelector('.companion-new input[type="number"]') as HTMLInputElement;
    expect(priorityInput).toBeTruthy();
    fireEvent.change(priorityInput, { target: { value: "77" } });

    await act(async () => {
      screen.getByText("Save profile").click();
    });
    await waitFor(() => expect(createInstruction).toHaveBeenCalled());
    expect(createInstruction.mock.calls[0]![0]).toMatchObject({ name: "Examiner", priority: 77 });
  });
});

describe("Companion Round 2 — IM-110: failed loads never pose as empty sections", () => {
  it("About Me: a failed load shows an error + Retry, not 'still getting to know you'", async () => {
    getPersonaStrict.mockRejectedValueOnce(new Error("About Me failed (500)"));
    render(<AboutMe />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load");
    expect(screen.queryByText(/still getting to know you/)).toBeNull();

    getPersonaStrict.mockResolvedValue("She knows he is rebuilding, deliberately.");
    act(() => screen.getByText("Retry").click());
    await screen.findByText("She knows he is rebuilding, deliberately.");
  });

  it("Instructions: a failed load shows an error, not 'No profiles yet'", async () => {
    getInstructionsStrict.mockRejectedValue(new Error("Instructions failed (500)"));
    render(<Instructions />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load your roles");
    expect(screen.queryByText(/No profiles yet/)).toBeNull();
  });

  it("Knowledge: a failed load shows an error, not 'No documents yet'", async () => {
    getDocumentsStrict.mockRejectedValue(new Error("Knowledge failed (500)"));
    render(<Knowledge />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load your documents");
    expect(screen.queryByText(/No documents yet/)).toBeNull();
  });

  it("Soul: a failed load blocks editing (a phantom-empty editor can't wipe the real soul)", async () => {
    getSoulStrict.mockRejectedValue(new Error("Soul failed (500)"));
    const { container } = render(<Soul />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load her current soul");
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it("GroundedInsight: a failed load shows an error and keeps the switch disabled", async () => {
    getGroundedInsightStrict.mockRejectedValue(new Error("Grounded insight failed (500)"));
    render(<GroundedInsight />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't check this setting");
    const sw = screen.getByLabelText("Grounded insight") as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
  });

  it("successful empty loads still render the honest empty copy", async () => {
    render(<Knowledge />);
    await screen.findByText("No documents yet.");
    cleanup();
    render(<Instructions />);
    await screen.findByText("No profiles yet — add one below.");
  });
});
