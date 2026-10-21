import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { isBrainDeleteReady, isPasscodeChangeReady } from "./AccountSettings.helpers.js";

const changePasscode = vi.fn();
const deleteBrain = vi.fn();
vi.mock("../api/account.js", () => ({
  changePasscode: (...a: unknown[]) => changePasscode(...a),
  deleteBrain: (...a: unknown[]) => deleteBrain(...a),
}));
const logoutSpace = vi.fn();
vi.mock("../api/client.js", () => ({
  logoutSpace: (...a: unknown[]) => logoutSpace(...a),
}));

import { AccountSettings } from "./AccountSettings.js";

const TAG = "ownerAlpha";

beforeEach(() => {
  vi.resetAllMocks();
  changePasscode.mockResolvedValue(undefined);
  deleteBrain.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe("isBrainDeleteReady — the hard-confirm gate (pure helper)", () => {
  it("is false until BOTH the exact gamer tag and a passcode are present", () => {
    expect(isBrainDeleteReady("", TAG, "")).toBe(false);
    expect(isBrainDeleteReady(TAG, TAG, "")).toBe(false); // no passcode yet
    expect(isBrainDeleteReady("", TAG, "some-pass")).toBe(false); // no confirmation yet
  });

  it("requires the confirmation to match the gamer tag EXACTLY (case-sensitive, like the server)", () => {
    expect(isBrainDeleteReady(TAG.toLowerCase(), TAG, "some-pass")).toBe(false);
    expect(isBrainDeleteReady("DELETE", TAG, "some-pass")).toBe(false);
    expect(isBrainDeleteReady(`${TAG} `, TAG, "some-pass")).toBe(false);
  });

  it("can never be satisfied when the gamer tag is unknown/empty", () => {
    expect(isBrainDeleteReady("", "", "some-pass")).toBe(false);
  });

  it("is true only with the exact tag AND a re-entered passcode", () => {
    expect(isBrainDeleteReady(TAG, TAG, "some-pass")).toBe(true);
  });
});

describe("isPasscodeChangeReady — the passcode-change gate (pure helper)", () => {
  it("requires current + new (>= 8 chars) + matching confirmation", () => {
    expect(isPasscodeChangeReady("", "new-pass-123", "new-pass-123")).toBe(false);
    expect(isPasscodeChangeReady("old-pass", "short", "short")).toBe(false);
    expect(isPasscodeChangeReady("old-pass", "new-pass-123", "new-pass-999")).toBe(false);
    expect(isPasscodeChangeReady("old-pass", "new-pass-123", "new-pass-123")).toBe(true);
  });
});

describe("AccountSettings — passcode change form", () => {
  it("keeps Change disabled until the form is ready, then calls the API and reports success", async () => {
    render(<AccountSettings gamerTag={TAG} onBrainDeleted={() => {}} />);
    const btn = screen.getByText("Change passcode") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("Your current passcode"), { target: { value: "old-pass-123" } });
    fireEvent.change(screen.getByPlaceholderText("Your new passcode"), { target: { value: "new-pass-123" } });
    fireEvent.change(screen.getByPlaceholderText("Type the new passcode again"), { target: { value: "new-pass-123" } });
    expect(btn.disabled).toBe(false);

    await act(async () => { btn.click(); });
    expect(changePasscode).toHaveBeenCalledWith("old-pass-123", "new-pass-123");
    expect(await screen.findByText(/Passcode changed/)).toBeTruthy();
  });

  it("shows the server's error honestly when the change is refused", async () => {
    changePasscode.mockRejectedValue(new Error("Current passcode is incorrect."));
    render(<AccountSettings gamerTag={TAG} onBrainDeleted={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Your current passcode"), { target: { value: "wrong-pass" } });
    fireEvent.change(screen.getByPlaceholderText("Your new passcode"), { target: { value: "new-pass-123" } });
    fireEvent.change(screen.getByPlaceholderText("Type the new passcode again"), { target: { value: "new-pass-123" } });
    const btn = screen.getByText("Change passcode") as HTMLButtonElement;
    await act(async () => { btn.click(); });
    expect(await screen.findByText("Current passcode is incorrect.")).toBeTruthy();
  });
});

describe("AccountSettings — brain deletion danger zone", () => {
  it("has NO one-click path: the final delete action only appears after opening the hard-confirm step", async () => {
    render(<AccountSettings gamerTag={TAG} onBrainDeleted={() => {}} />);
    expect(screen.queryByText("Permanently delete this brain")).toBeNull();
    await act(async () => { screen.getByText("Delete this brain…").click(); });
    expect(screen.getByText(/IRREVERSIBLE/)).toBeTruthy();
    expect(screen.getByText("Permanently delete this brain")).toBeTruthy();
    expect(deleteBrain).not.toHaveBeenCalled();
  });

  it("keeps the final delete disabled until BOTH inputs are right, then deletes, logs out, and hands back", async () => {
    const onBrainDeleted = vi.fn();
    render(<AccountSettings gamerTag={TAG} onBrainDeleted={onBrainDeleted} />);
    await act(async () => { screen.getByText("Delete this brain…").click(); });
    const finalBtn = screen.getByText("Permanently delete this brain") as HTMLButtonElement;
    expect(finalBtn.disabled).toBe(true);

    // Passcode alone is not enough.
    fireEvent.change(screen.getByPlaceholderText("Your passcode"), { target: { value: "alpha-pass-123" } });
    expect(finalBtn.disabled).toBe(true);
    // A wrong/case-mismatched confirmation is not enough either.
    fireEvent.change(screen.getByPlaceholderText(TAG), { target: { value: TAG.toLowerCase() } });
    expect(finalBtn.disabled).toBe(true);
    // Exact tag + passcode unlocks it.
    fireEvent.change(screen.getByPlaceholderText(TAG), { target: { value: TAG } });
    expect(finalBtn.disabled).toBe(false);

    await act(async () => { finalBtn.click(); });
    expect(deleteBrain).toHaveBeenCalledWith("alpha-pass-123", TAG);
    expect(logoutSpace).toHaveBeenCalledTimes(1); // clears brain.spaceId
    expect(onBrainDeleted).toHaveBeenCalledTimes(1); // app returns to the login screen
  });

  it("on a server refusal, shows the error, states nothing was deleted, and does NOT log out", async () => {
    deleteBrain.mockRejectedValue(new Error("Passcode is incorrect."));
    const onBrainDeleted = vi.fn();
    render(<AccountSettings gamerTag={TAG} onBrainDeleted={onBrainDeleted} />);
    await act(async () => { screen.getByText("Delete this brain…").click(); });
    fireEvent.change(screen.getByPlaceholderText(TAG), { target: { value: TAG } });
    fireEvent.change(screen.getByPlaceholderText("Your passcode"), { target: { value: "wrong-pass" } });
    const finalBtn = screen.getByText("Permanently delete this brain") as HTMLButtonElement;
    await act(async () => { finalBtn.click(); });
    expect(await screen.findByText(/Nothing was deleted/)).toBeTruthy();
    expect(logoutSpace).not.toHaveBeenCalled();
    expect(onBrainDeleted).not.toHaveBeenCalled();
  });

  it("Cancel closes the hard-confirm step and clears both proofs", async () => {
    render(<AccountSettings gamerTag={TAG} onBrainDeleted={() => {}} />);
    await act(async () => { screen.getByText("Delete this brain…").click(); });
    fireEvent.change(screen.getByPlaceholderText(TAG), { target: { value: TAG } });
    fireEvent.change(screen.getByPlaceholderText("Your passcode"), { target: { value: "alpha-pass-123" } });
    await act(async () => { screen.getByText("Cancel").click(); });
    expect(screen.queryByText("Permanently delete this brain")).toBeNull();
    // Reopening starts from a clean, disabled gate — no leftover proofs.
    await act(async () => { screen.getByText("Delete this brain…").click(); });
    expect((screen.getByText("Permanently delete this brain") as HTMLButtonElement).disabled).toBe(true);
    expect(deleteBrain).not.toHaveBeenCalled();
  });
});
