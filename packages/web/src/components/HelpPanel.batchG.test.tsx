import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const getSpaceId = vi.fn(() => "space1");
vi.mock("../api/client.js", () => ({ getSpaceId: () => getSpaceId() }));
vi.mock("../graph/sfx.js", () => ({ playSfx: vi.fn() }));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { HelpPanel } from "./HelpPanel.js";

// Batch G, REG-203 (CN-04 / pass 21 C-04): the Help Connections card must stop
// asserting the opposite of what Declutter does — it permanently deletes anchor
// links; the manual must say so.
beforeEach(() => {
  vi.resetAllMocks();
  getSpaceId.mockReturnValue("space1");
  localStorage.clear();
});
afterEach(() => cleanup());

function openConnectionsCard() {
  render(<HelpPanel onClose={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText(/Search pilot guide/), { target: { value: "Connections (suggested" } });
  expect(screen.getByText("Connections (suggested links)")).toBeTruthy();
}

describe("HelpPanel — Connections card tells the truth about Declutter (REG-203)", () => {
  it("states that Declutter permanently removes anchor links", () => {
    openConnectionsCard();
    expect(screen.getByText(/permanently removes anchor links/)).toBeTruthy();
  });

  it("no longer claims Declutter moves weak links 'instead of silently deleting them'", () => {
    openConnectionsCard();
    expect(screen.queryByText(/instead of silently deleting them/)).toBeNull();
  });
});
