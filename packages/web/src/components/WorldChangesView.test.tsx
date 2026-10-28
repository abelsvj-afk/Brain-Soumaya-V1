import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import WorldChangesView from "./WorldChangesView.js";
import {
  getWorldChangeProposal,
  getWorldChangesLog,
  getWorldChangesState,
  undoWorldChangeProposal,
  type WorldChangeLogEntry,
  type WorldChangeProposal,
} from "../api/worldChanges.js";

vi.mock("../api/worldChanges.js", () => ({
  getWorldChangeProposal: vi.fn(),
  getWorldChangesLog: vi.fn(),
  getWorldChangesState: vi.fn(),
  undoWorldChangeProposal: vi.fn(),
  worldChangeKindLabel: (kind: string) => kind,
}));
const mockGetProposal = vi.mocked(getWorldChangeProposal);
const mockLog = vi.mocked(getWorldChangesLog);
const mockState = vi.mocked(getWorldChangesState);
const mockUndo = vi.mocked(undoWorldChangeProposal);

afterEach(cleanup);

const entry = (over: Partial<WorldChangeLogEntry> = {}): WorldChangeLogEntry => ({
  id: "log-1",
  kind: "landmark",
  summary: "Added a landmark for finishing the move.",
  reason: "You marked the journey done.",
  appliedAt: "2026-10-26T12:00:00.000Z",
  proposalId: "wc-1",
  ...over,
});

const proposal = (over: Partial<WorldChangeProposal> = {}): WorldChangeProposal => ({
  id: "wc-1",
  kind: "landmark",
  title: "A landmark for finishing the move",
  reason: "You marked the journey done, and the garden grows a landmark for real milestones.",
  evidence: "Journey “The move” marked done on Oct 24, 2026.",
  status: "applied",
  createdAt: "2026-10-26T12:00:00.000Z",
  target: "landmark:7",
  ...over,
});

beforeEach(() => {
  mockGetProposal.mockReset();
  mockLog.mockReset();
  mockState.mockReset();
  mockUndo.mockReset();
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  mockState.mockResolvedValue({ warmth: 0.6, season: "Late autumn", pendingCount: 0, appliedCount: 1 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorldChangesView — the browsable log (M6 door two)", () => {
  it("flag off renders nothing and fetches nothing", () => {
    const { container } = render(<WorldChangesView enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it("lists the log chronologically with plain-language summaries", async () => {
    mockLog.mockResolvedValue([entry(), entry({ id: "log-2", summary: "Undid the landmark.", proposalId: "wc-1" })]);
    render(<WorldChangesView />);
    fireEvent.click(await screen.findByRole("button", { name: /World changes/ }));
    expect(await screen.findByText("Added a landmark for finishing the move.")).toBeTruthy();
    expect(screen.getByText("Undid the landmark.")).toBeTruthy();
    expect(screen.getByText(/This is the world's own memory/)).toBeTruthy();
  });

  it("an empty log says nothing has changed yet — never an invented entry", async () => {
    mockLog.mockResolvedValue([]);
    render(<WorldChangesView />);
    fireEvent.click(await screen.findByRole("button", { name: /World changes/ }));
    expect(await screen.findByText(/Nothing has changed yet/)).toBeTruthy();
  });

  it("door one: “Why is this here?” fetches the same proposal the inbox decided", async () => {
    mockLog.mockResolvedValue([entry()]);
    mockGetProposal.mockResolvedValue(proposal());
    render(<WorldChangesView />);
    fireEvent.click(await screen.findByRole("button", { name: /World changes/ }));
    fireEvent.click(await screen.findByText("Why is this here?"));
    expect(await screen.findByText("A landmark for finishing the move")).toBeTruthy();
    expect(screen.getByText(/Journey “The move” marked done/)).toBeTruthy();
    expect(screen.getByText("Status: applied")).toBeTruthy();
    expect(mockGetProposal).toHaveBeenCalledWith("wc-1");
  });

  it("an applied change can be undone from its own entry — a compensating entry, not a rewrite", async () => {
    mockLog.mockResolvedValue([entry()]);
    mockGetProposal.mockResolvedValue(proposal());
    mockUndo.mockResolvedValue({
      proposal: proposal({ status: "undone" }),
      logEntry: entry({ id: "log-2", summary: "Undid the landmark." }),
    });
    render(<WorldChangesView />);
    fireEvent.click(await screen.findByRole("button", { name: /World changes/ }));
    fireEvent.click(await screen.findByText("Why is this here?"));
    fireEvent.click(await screen.findByRole("button", { name: "Undo this change" }));
    expect(await screen.findByText(/The undo landed/)).toBeTruthy();
    expect(mockUndo).toHaveBeenCalledWith("wc-1");
  });

  it("a decided-but-not-applied proposal offers no undo", async () => {
    mockLog.mockResolvedValue([entry()]);
    mockGetProposal.mockResolvedValue(proposal({ status: "approved" }));
    render(<WorldChangesView />);
    fireEvent.click(await screen.findByRole("button", { name: /World changes/ }));
    fireEvent.click(await screen.findByText("Why is this here?"));
    await screen.findByText("Status: approved");
    expect(screen.queryByRole("button", { name: "Undo this change" })).toBeNull();
  });

  it("an entry without a proposal has no “why” door — the entry itself is the explanation", async () => {
    mockLog.mockResolvedValue([entry({ proposalId: null })]);
    render(<WorldChangesView />);
    fireEvent.click(await screen.findByRole("button", { name: /World changes/ }));
    await screen.findByText("Added a landmark for finishing the move.");
    expect(screen.queryByText("Why is this here?")).toBeNull();
  });
});
