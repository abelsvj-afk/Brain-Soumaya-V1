import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ApprovalsInbox from "./ApprovalsInbox.js";
import {
  decideWorldChangeProposal,
  getWorldChangesState,
  listWorldChangeProposals,
  type WorldChangeProposal,
} from "../api/worldChanges.js";

vi.mock("../api/worldChanges.js", () => ({
  decideWorldChangeProposal: vi.fn(),
  getWorldChangesState: vi.fn(),
  listWorldChangeProposals: vi.fn(),
  worldChangeKindLabel: (kind: string) => kind,
}));
const mockDecide = vi.mocked(decideWorldChangeProposal);
const mockState = vi.mocked(getWorldChangesState);
const mockList = vi.mocked(listWorldChangeProposals);

afterEach(cleanup);

const proposal = (over: Partial<WorldChangeProposal> = {}): WorldChangeProposal => ({
  id: "wc-1",
  kind: "landmark",
  title: "A landmark for finishing the move",
  reason: "You marked the journey done, and the garden grows a landmark for real milestones.",
  evidence: "Journey “The move” marked done on Oct 24, 2026.",
  status: "pending",
  createdAt: "2026-10-26T12:00:00.000Z",
  target: "landmark:7",
  ...over,
});

beforeEach(() => {
  mockDecide.mockReset();
  mockState.mockReset();
  mockList.mockReset();
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  mockState.mockResolvedValue({ warmth: 0.6, season: "Late autumn", pendingCount: 1, appliedCount: 2 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApprovalsInbox — the calm batched review moment (M1/D-15)", () => {
  it("flag off renders nothing and fetches nothing", () => {
    const { container } = render(<ApprovalsInbox enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("shows the pending count calmly — no urgency, no countdown", async () => {
    mockList.mockResolvedValue([proposal()]);
    render(<ApprovalsInbox />);
    const toggle = await screen.findByRole("button", { name: /Review/ });
    expect(toggle.textContent).toMatch(/1 waiting — no rush/);
    expect(toggle.textContent).not.toMatch(/urgent|now|!/);
    expect(screen.queryByText(/countdown/i)).toBeNull();
  });

  it("expands to the proposal with title, reason, and evidence", async () => {
    mockList.mockResolvedValue([proposal()]);
    render(<ApprovalsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
    expect(await screen.findByText("A landmark for finishing the move")).toBeTruthy();
    expect(screen.getByText(/You marked the journey done/)).toBeTruthy();
    expect(screen.getByText(/Journey “The move” marked done/)).toBeTruthy();
    expect(screen.getByText(/Nothing here decides itself/)).toBeTruthy();
  });

  it("approve removes the proposal and says so plainly", async () => {
    mockList.mockResolvedValue([proposal()]);
    mockDecide.mockResolvedValue({ ...proposal(), status: "approved" });
    render(<ApprovalsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/Approved: A landmark for finishing the move/)).toBeTruthy();
    expect(screen.queryByText("A landmark for finishing the move", { selector: "strong" })).toBeNull();
    expect(mockDecide).toHaveBeenCalledWith("wc-1", "approve", undefined);
  });

  it("reject and defer are explicit choices, never silence", async () => {
    mockList.mockResolvedValue([proposal(), proposal({ id: "wc-2", title: "Second proposal" })]);
    mockDecide.mockImplementation(async (id: string) => ({
      ...proposal({ id }),
      status: id === "wc-1" ? "rejected" : "deferred",
    }));
    render(<ApprovalsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Reject" })[0]!);
    expect(await screen.findByText(/Rejected: A landmark for finishing the move/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Defer" })[0]!);
    expect(await screen.findByText(/Deferred: Second proposal/)).toBeTruthy();
  });

  it("an optional note travels with the decision", async () => {
    mockList.mockResolvedValue([proposal()]);
    mockDecide.mockResolvedValue({ ...proposal(), status: "approved" });
    render(<ApprovalsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
    const note = await screen.findByPlaceholderText(/Optional/);
    fireEvent.change(note, { target: { value: "Yes — this one matters." } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mockDecide).toHaveBeenCalledWith("wc-1", "approve", "Yes — this one matters.");
  });

  it("a failed decision says so and keeps the proposal waiting", async () => {
    mockList.mockResolvedValue([proposal()]);
    mockDecide.mockRejectedValue(new Error("That didn't go through — please try again."));
    render(<ApprovalsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("A landmark for finishing the move")).toBeTruthy();
  });

  it("an empty queue says nothing is waiting — never an invented proposal", async () => {
    mockList.mockResolvedValue([]);
    mockState.mockResolvedValue({ warmth: 0.2, season: "Early winter", pendingCount: 0, appliedCount: 0 });
    render(<ApprovalsInbox />);
    fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
    expect(await screen.findByText(/Nothing waiting for review/)).toBeTruthy();
  });
});
