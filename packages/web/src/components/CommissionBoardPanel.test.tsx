import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CommissionBoardPanel from "./CommissionBoardPanel.js";

// The board routes to shipped surfaces; this test proves the board's
// own routing, not the surfaces' internals — those have their own tests.
vi.mock("./ReviewPanel.js", () => ({
  ReviewPanel: ({ onClose }: { onClose: () => void }) => (
    <div aria-label="Review surface">
      <button type="button" onClick={onClose}>
        Close review
      </button>
    </div>
  ),
}));
vi.mock("./JourneysPanel.js", () => ({
  JourneysPanel: () => <div aria-label="Journeys surface" />,
}));
vi.mock("./InboxPanel.js", () => ({
  InboxPanel: ({ spaceId }: { spaceId: string }) => <div aria-label={`Inbox surface ${spaceId}`} />,
}));

describe("CommissionBoardPanel", () => {
  it("lists the four settled kinds, nothing else, nothing 'coming soon'", () => {
    render(<CommissionBoardPanel spaceId="space-1" />);
    expect(screen.getByRole("button", { name: /Link —/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review —/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Journey step —/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Inbox item —/ })).toBeTruthy();
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  it("Review opens the review surface, and Back to the board returns", () => {
    render(<CommissionBoardPanel spaceId="space-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Review —/ }));
    expect(screen.getByLabelText("Review surface")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to the board" }));
    expect(screen.getByRole("button", { name: /Review —/ })).toBeTruthy();
    expect(screen.queryByLabelText("Review surface")).toBeNull();
  });

  it("Journey step opens the journeys surface", () => {
    render(<CommissionBoardPanel spaceId="space-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Journey step —/ }));
    expect(screen.getByLabelText("Journeys surface")).toBeTruthy();
  });

  it("Inbox item opens the inbox for this space", () => {
    render(<CommissionBoardPanel spaceId="space-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Inbox item —/ }));
    expect(screen.getByLabelText("Inbox surface space-1")).toBeTruthy();
  });

  it("Link opens the journeys surface and says plainly that linking lives on journey cards", () => {
    render(<CommissionBoardPanel spaceId="space-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Link —/ }));
    expect(screen.getByLabelText("Journeys surface")).toBeTruthy();
    expect(screen.getByText(/linking happens on a journey's card/i)).toBeTruthy();
  });
});
