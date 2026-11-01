import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChronicleLine } from "@brain/shared";
import ChronicleFeed from "./ChronicleFeed.js";

/**
 * The Chronicle feed: a pure render of the server's read model —
 * names, plain lines, causes, local times. Nothing computed here.
 */
const line = (over: Partial<ChronicleLine> = {}): ChronicleLine => ({
  id: 1,
  npcId: "bex",
  npcName: "Bex — Regular",
  kind: "arrive",
  line: "Came into the Great Station — visit 1 of 3 today.",
  cause: "Her day's rhythm.",
  createdAt: "2026-10-22T12:00:00.000Z",
  ...over,
});

describe("ChronicleFeed", () => {
  it("renders lines with names, verbs, causes, and a local time", () => {
    render(<ChronicleFeed lines={[line(), line({ id: 2, npcId: "harbor-controller", npcName: "Harbor controller", kind: "wait", line: "Waited." })]} />);
    expect(screen.getByText(/Bex — Regular/)).toBeTruthy();
    expect(screen.getByText(/Came into the Great Station/)).toBeTruthy();
    expect(screen.getByText(/Harbor controller/)).toBeTruthy();
    // The time element carries the ISO instant; its text is the
    // viewer's local rendering (never a raw UTC string).
    const times = document.querySelectorAll("time");
    expect(times.length).toBe(2);
    expect(times[0]?.getAttribute("dateTime")).toBe("2026-10-22T12:00:00.000Z");
    expect(times[0]?.textContent).not.toContain("UTC");
  });

  it("an empty feed says so plainly; an unreachable one says that instead", () => {
    const { rerender } = render(<ChronicleFeed lines={[]} />);
    expect(screen.getByText(/Nothing on the radio yet/)).toBeTruthy();
    rerender(<ChronicleFeed lines={null} />);
    expect(screen.getByText(/couldn't be reached/)).toBeTruthy();
  });
});
