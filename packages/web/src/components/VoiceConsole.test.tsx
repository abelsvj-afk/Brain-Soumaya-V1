import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import VoiceConsole from "./VoiceConsole.js";
import * as api from "../api/story.js";

const data = (over: Partial<api.VoiceConsoleData> = {}): api.VoiceConsoleData => ({
  available: [{ id: "abcdefghij12", name: "Old Marlowe", category: "premade", labels: { gender: "male", age: "old" }, preview: "https://x/p.mp3" }],
  assigned: {},
  roles: ["narrator", "calend"],
  status: { on: false, issue: "no narrator voice is chosen" },
  ...over,
});
beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe("the owner's Voices console", () => {
  it("is simply absent for anyone who is not the owner", async () => {
    vi.spyOn(api, "getVoiceConsole").mockResolvedValue(null);
    const { container } = render(<VoiceConsole />);
    await waitFor(() => expect(container.textContent).not.toMatch(/Looking at the voices/));
    expect(container.querySelector(".voice-console")).toBeNull();
  });

  it("shows the account's voices and why the studio voice is off, and assigns one to the Narrator", async () => {
    vi.spyOn(api, "getVoiceConsole").mockResolvedValue(data());
    const put = vi.spyOn(api, "putVoiceChoice").mockResolvedValue({ assigned: { narrator: "abcdefghij12" }, status: { on: true, issue: null } });
    render(<VoiceConsole />);
    await waitFor(() => expect(screen.getByText("Old Marlowe")).toBeTruthy());
    expect(screen.getByText(/not on yet — no narrator voice is chosen/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Give Old Marlowe to…"), { target: { value: "narrator" } });
    fireEvent.click(screen.getByText("Use"));
    await waitFor(() => expect(put).toHaveBeenCalledWith("narrator", "abcdefghij12", "Old Marlowe"));
  });

  it("tells the owner plainly when the voice list cannot be read (no key yet)", async () => {
    vi.spyOn(api, "getVoiceConsole").mockResolvedValue(data({ available: null, status: { on: false, issue: "no ElevenLabs API key is set — add LORE_TTS_API_KEY" } }));
    const { container } = render(<VoiceConsole />);
    await waitFor(() => expect(container.textContent).toMatch(/voice list could not be read/));
    expect(container.textContent).toMatch(/LORE_TTS_API_KEY/);
  });

  it("a failed test shows the server's reason, not silence", async () => {
    vi.spyOn(api, "getVoiceConsole").mockResolvedValue(data({ assigned: { narrator: "abcdefghij12" } }));
    vi.spyOn(api, "testVoice").mockResolvedValue({ error: "ElevenLabs refused the request (HTTP 401 — check the API key)" });
    const { container } = render(<VoiceConsole />);
    await waitFor(() => expect(screen.getAllByText("Test").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("Test")[0]!);
    await waitFor(() => expect(container.textContent).toMatch(/HTTP 401/));
  });
});
