import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

vi.mock("../api/account.js", () => ({ getOwnerStatus: vi.fn() }));
vi.mock("../api/client.js", () => ({ getSpaceId: () => "key-123" }));
import { getOwnerStatus } from "../api/account.js";
import OwnerAccess from "./OwnerAccess.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OwnerAccess (Settings → Account)", () => {
  it("shows ON, and offers no key to copy, when the server says owner", async () => {
    vi.mocked(getOwnerStatus).mockResolvedValue(true);
    render(<OwnerAccess />);
    await waitFor(() => expect(screen.getByText(/On — the worlds/)).toBeTruthy());
    expect(screen.queryByText("Copy my brain key")).toBeNull();
  });

  it("shows OFF with a copy button, and copies the key without ever rendering it", async () => {
    vi.mocked(getOwnerStatus).mockResolvedValue(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = render(<OwnerAccess />);
    fireEvent.click(await screen.findByText("Copy my brain key"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("key-123"));
    expect(container.textContent).not.toContain("key-123");
  });

  it("says it couldn't check — never 'off' — when the status read fails", async () => {
    vi.mocked(getOwnerStatus).mockResolvedValue(null);
    render(<OwnerAccess />);
    await waitFor(() => expect(screen.getByText(/Couldn't check owner access/)).toBeTruthy());
    expect(screen.queryByText(/Off —/)).toBeNull();
  });
});
