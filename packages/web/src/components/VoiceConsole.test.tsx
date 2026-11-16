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

  it("shows the account's voices and why the studio voice is off, and assigns one to the Narrator from that person's sheet", async () => {
    vi.spyOn(api, "getVoiceConsole").mockResolvedValue(data());
    const put = vi.spyOn(api, "putVoiceChoice").mockResolvedValue({ assigned: { narrator: "abcdefghij12" }, status: { on: true, issue: null } });
    render(<VoiceConsole />);
    await waitFor(() => expect(screen.getByText(/The Narrator \(everything not spoken by a person\)/)).toBeTruthy());
    expect(screen.getByText(/not on yet — no narrator voice is chosen/)).toBeTruthy();
    // Person-first: no per-row "Give to…" dropdown anywhere — the person is
    // known from the card the sheet opened from.
    expect(screen.queryByLabelText(/Give .* to…/)).toBeNull();
    fireEvent.click(screen.getAllByText("Change voice")[0]!);
    await waitFor(() => expect(screen.getByText("Old Marlowe")).toBeTruthy());
    fireEvent.click(screen.getByText("Use this voice"));
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

  it("shows all fifteen roles with their names and character cards, saying plainly where an age is not pinned", async () => {
    const roles = ["narrator", "eternity", "calend", "ysmerel", "dorrow", "dissenter", "surveyor", "archivist", "keeper", "hesk", "tamsin", "ossian", "ilsabet", "pell", "wim"];
    vi.spyOn(api, "getVoiceConsole").mockResolvedValue(data({ roles }));
    const { container } = render(<VoiceConsole />);
    await waitFor(() => expect(container.textContent).toMatch(/The Narrator \(everything not spoken by a person\)/));
    const labels = ["Eternity", "Calend, the Doorkeeper", "Ysmerel, the Choirmaster", "Dorrow Quint", "The Dissenter", "The Surveyor", "The Archivist", "The Keeper", "Hesk, the Warden-General", "Tamsin of the Open Hand", "Ossian Reed, the Last Honest Liar", "Ilsabet Marrow, the Cartographer", "Pell, the Follower", "Wim Ostler, Brannoch's clerk"];
    for (const label of labels) expect(container.textContent).toContain(label);
    const cards = ["reads every entry", "vast, calm, radiant", "wiry, travel-worn", "a voice caught mid-breath", "a smile that doesn't reach his eyes", "honest to the point of rudeness", "quietly delighted by numbers", "never rushes a thought", "Maren's heir", "guarding, not enforcing", "healer of the Open Hand", "a storyteller's grin", "ink-stained", "her face is never seen", "painfully neat"];
    for (const card of cards) expect(container.textContent).toContain(card);
    expect(container.textContent!.match(/(?<!Sex and )age not yet pinned in the Bible/g)).toHaveLength(7); // Ysmerel, Dorrow, Dissenter, Surveyor, Archivist, Keeper, Hesk: sex pinned, age not
    expect(container.textContent!.match(/Sex and age not yet pinned in the Bible/g) ?? []).toHaveLength(0); // the four corrected sexes are pinned in the drafts
    expect(container.textContent).toMatch(/The Dissenter[\s\S]*?He\/him · age not yet pinned/);
    expect(container.textContent).toMatch(/The Surveyor[\s\S]*?She\/her · age not yet pinned/);
    expect(container.textContent).toMatch(/The Archivist[\s\S]*?She\/her · age not yet pinned/);
    expect(container.textContent).toMatch(/The Keeper[\s\S]*?She\/her · age not yet pinned/);
  });

  it("shows a face thumbnail where one exists and a mark where it does not — never a guessed face", async () => {
    const roles = ["narrator", "eternity", "calend", "ysmerel", "dorrow", "dissenter", "surveyor", "archivist", "keeper", "hesk", "tamsin", "ossian", "ilsabet", "pell", "wim"];
    vi.spyOn(api, "getVoiceConsole").mockResolvedValue(data({ roles }));
    const { container } = render(<VoiceConsole />);
    await waitFor(() => expect(container.querySelectorAll(".voice-person").length).toBe(15));
    expect(container.querySelectorAll("img.voice-face").length).toBe(11); // every role with a depicting image
    expect(container.querySelectorAll(".voice-face-mark").length).toBe(4); // Narrator, Dissenter, Surveyor, Keeper
    expect(container.textContent).not.toMatch(/dawn-leaf/); // the Keeper is never labelled with the unconfirmed gardener image
  });

  it("the voice sheet searches by name and filters by the voice's own labels, and assigns to the card's person", async () => {
    const voices = [
      { id: "abcdefghij12", name: "Old Marlowe", category: "premade", labels: { gender: "male", age: "old", accent: "british" }, preview: "https://x/p.mp3" },
      { id: "klmnopqrst34", name: "Young Ada", category: "premade", labels: { gender: "female", age: "young", accent: "american" }, preview: "https://x/q.mp3" },
    ];
    vi.spyOn(api, "getVoiceConsole").mockResolvedValue(data({ available: voices }));
    const put = vi.spyOn(api, "putVoiceChoice").mockResolvedValue({ assigned: { narrator: "klmnopqrst34" }, status: { on: true, issue: null } });
    render(<VoiceConsole />);
    await waitFor(() => expect(screen.getByText(/The Narrator \(everything not spoken by a person\)/)).toBeTruthy());
    fireEvent.click(screen.getAllByText("Change voice")[0]!);
    expect(screen.getByText("Old Marlowe")).toBeTruthy();
    expect(screen.getByText("Young Ada")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search voices by name"), { target: { value: "ada" } });
    expect(screen.queryByText("Old Marlowe")).toBeNull();
    expect(screen.getByText("Young Ada")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search voices by name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by gender"), { target: { value: "female" } });
    expect(screen.queryByText("Old Marlowe")).toBeNull();
    expect(screen.getByText("Young Ada")).toBeTruthy();
    fireEvent.click(screen.getByText("Use this voice"));
    await waitFor(() => expect(put).toHaveBeenCalledWith("narrator", "klmnopqrst34", "Young Ada"));
  });
});
