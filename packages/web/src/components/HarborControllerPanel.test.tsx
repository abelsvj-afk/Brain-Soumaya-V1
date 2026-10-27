import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { NpcState } from "@brain/shared";
import HarborControllerPanel from "./HarborControllerPanel.js";
import { askNpc, getNpc, resumeNpc, stopNpc } from "../api/npcs.js";

vi.mock("../api/npcs.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../api/npcs.js")>();
  return {
    ...orig,
    getNpc: vi.fn(),
    askNpc: vi.fn(),
    stopNpc: vi.fn(),
    resumeNpc: vi.fn(),
  };
});

const mockGetNpc = vi.mocked(getNpc);
const mockAsk = vi.mocked(askNpc);
const mockStop = vi.mocked(stopNpc);
const mockResume = vi.mocked(resumeNpc);

const state = (over: Partial<NpcState> = {}): NpcState => ({
  id: "harbor-controller",
  name: "Harbor controller",
  job: "Help you arrive — routes, arrivals, traffic.",
  world: "great-station",
  stopped: false,
  actsToday: 2,
  speaksToday: 1,
  gateOpen: false,
  relicsHeld: 0,
  recentLog: [
    {
      id: 2,
      npcId: "harbor-controller",
      kind: "speak",
      act: "You hold 25 fuel of 200 — enough for a warp.",
      cause: "You asked about fuel.",
      // Stale on purpose: the hook only adopts a FRESH speak as the
      // answer, so the panel's answer area starts empty here and the
      // log is the only surface showing this speak.
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: 1,
      npcId: "harbor-controller",
      kind: "explore",
      act: "Looked for a way onward in my own world — found no relic.",
      cause: "Its daily look for a way onward.",
      createdAt: new Date().toISOString(),
    },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetNpc.mockResolvedValue(state());
});

describe("HarborControllerPanel", () => {
  it("shows the controller's job, its ship, and its honest gate line", async () => {
    render(<HarborControllerPanel />);
    await waitFor(() => expect(screen.getByText("Harbor controller")).toBeTruthy());
    expect(screen.getByText(/Help you arrive/)).toBeTruthy();
    expect(screen.getByText(/the dispatcher — is moored at the berth between arms 1 and 2/)).toBeTruthy();
    expect(screen.getByText(/it holds no relics/)).toBeTruthy();
    expect(screen.getByText(/2 acts today, 1 spoken/)).toBeTruthy();
  });

  it("asks a question and shows the server's answer", async () => {
    mockAsk.mockResolvedValue({ npc: state({ speaksToday: 2 }), answer: "From Home, these routes are open." });
    render(<HarborControllerPanel />);
    await waitFor(() => expect(screen.getByText("Harbor controller")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Routes from here" }));
    await waitFor(() => expect(screen.getByText("From Home, these routes are open.")).toBeTruthy());
    expect(mockAsk).toHaveBeenCalledWith("harbor-controller", "routes");
  });

  it("shows the log with causes — why it did that", async () => {
    render(<HarborControllerPanel />);
    await waitFor(() => expect(screen.getByText("Why did it do that?")).toBeTruthy());
    expect(screen.getByText(/You hold 25 fuel of 200/)).toBeTruthy();
    expect(screen.getByText(/You asked about fuel/)).toBeTruthy();
    expect(screen.getByText(/found no relic/)).toBeTruthy();
    expect(screen.getByText(/Its daily look for a way onward/)).toBeTruthy();
  });

  it("stop silences the panel's questions and resume brings them back", async () => {
    mockStop.mockResolvedValue(state({ stopped: true }));
    mockResume.mockResolvedValue(state({ stopped: false }));
    render(<HarborControllerPanel />);
    await waitFor(() => expect(screen.getByText("Harbor controller")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Stop the controller" }));
    await waitFor(() => expect(screen.getByText(/Stopped — it does nothing while stopped/)).toBeTruthy());
    expect((screen.getByRole("button", { name: "Routes from here" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Start it again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop the controller" })).toBeTruthy());
  });

  it("a failed load is an honest offline state with a retry", async () => {
    mockGetNpc.mockResolvedValueOnce(null);
    render(<HarborControllerPanel />);
    await waitFor(() =>
      expect(screen.getByText(/The controller couldn't be reached/)).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Harbor controller")).toBeTruthy());
  });
});
