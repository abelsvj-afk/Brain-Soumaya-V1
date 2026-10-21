import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import type { Attachment } from "@brain/shared";

/**
 * CL-2 (Immersion Round 2) — Attachments items IM-29 (loading skeleton /
 * truthful load error), IM-34 (delete confirms via the app dialog),
 * IM-36 (filename / size / createdAt rendered in grid + lightbox).
 */

const listAttachmentsStrict = vi.fn();
const deleteAttachment = vi.fn();
const attachmentObjectUrl = vi.fn();
vi.mock("../api/client.js", () => ({
  listAttachmentsStrict: (...a: unknown[]) => listAttachmentsStrict(...a),
  // Alias for the pre-CL-2 component (falsification): it called listAttachments.
  listAttachments: (...a: unknown[]) => listAttachmentsStrict(...a),
  addAttachment: vi.fn(),
  deleteAttachment: (...a: unknown[]) => deleteAttachment(...a),
  downloadAttachment: vi.fn(),
  attachmentObjectUrl: (...a: unknown[]) => attachmentObjectUrl(...a),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { MemoryAttachments, fmtAttWhen } from "./MemoryAttachments.js";

function att(over: Partial<Attachment> = {}): Attachment {
  return { id: 1, nodeId: 10, filename: "photo.jpg", mime: "image/jpeg", size: 2048, createdAt: "2026-03-04T12:00:00Z", ...over };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

describe("IM-29 — loading and failure are not the empty state", () => {
  it("shows a skeleton while loading, not 'No photos or files yet'", async () => {
    listAttachmentsStrict.mockReturnValue(new Promise(() => {}));
    render(<MemoryAttachments nodeId={10} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText(/No photos or files yet/)).toBeNull();
  });

  it("a failed load shows an error + Retry, not the empty copy", async () => {
    listAttachmentsStrict.mockRejectedValue(new Error("boom"));
    render(<MemoryAttachments nodeId={10} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn’t load attachments");
    expect(screen.queryByText(/No photos or files yet/)).toBeNull();
  });
});

describe("IM-36 — attachment metadata renders in the grid and the lightbox", () => {
  it("the grid caption shows filename, size and date for an image", async () => {
    listAttachmentsStrict.mockResolvedValue([att()]);
    attachmentObjectUrl.mockResolvedValue("blob:photo");
    render(<MemoryAttachments nodeId={10} />);
    await waitFor(() => expect(screen.getByAltText("photo.jpg")).toBeTruthy());
    const caption = document.querySelector(".att-meta");
    expect(caption?.textContent).toContain("photo.jpg");
    expect(caption?.textContent).toContain("2 KB");
    expect(caption?.textContent).toMatch(/2026/);
  });

  it("the lightbox shows filename, size and date too", async () => {
    listAttachmentsStrict.mockResolvedValue([att()]);
    attachmentObjectUrl.mockResolvedValue("blob:photo");
    render(<MemoryAttachments nodeId={10} />);
    await waitFor(() => expect(screen.getByAltText("photo.jpg")).toBeTruthy());
    fireEvent.click(screen.getByTitle("View"));
    const meta = document.querySelector(".att-lb-meta");
    expect(meta?.textContent).toContain("photo.jpg");
    expect(meta?.textContent).toContain("2 KB");
    expect(meta?.textContent).toMatch(/2026/);
  });

  it("fmtAttWhen never leaks a raw unparseable stored value", () => {
    expect(fmtAttWhen("garbage")).toBe("date unavailable");
  });
});

describe("IM-34 — attachment delete confirms through the app dialog", () => {
  it("clicking ✕ on a file opens the dialog; only confirming deletes", async () => {
    const file = att({ id: 9, filename: "notes.pdf", mime: "application/pdf" });
    listAttachmentsStrict.mockResolvedValue([file]);
    deleteAttachment.mockResolvedValue(true);
    render(<MemoryAttachments nodeId={10} />);
    await screen.findByText(/notes\.pdf/);
    await act(async () => {
      screen.getByTitle("Remove").click();
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(deleteAttachment).not.toHaveBeenCalled();
    await act(async () => {
      screen.getByText("Remove").click();
    });
    await waitFor(() => expect(deleteAttachment).toHaveBeenCalledWith(10, 9));
    await waitFor(() => expect(screen.queryByText(/notes\.pdf/)).toBeNull());
  });

  it("cancelling the dialog deletes nothing", async () => {
    const file = att({ id: 9, filename: "notes.pdf", mime: "application/pdf" });
    listAttachmentsStrict.mockResolvedValue([file]);
    render(<MemoryAttachments nodeId={10} />);
    await screen.findByText(/notes\.pdf/);
    await act(async () => {
      screen.getByTitle("Remove").click();
    });
    await act(async () => {
      screen.getByText("Cancel").click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteAttachment).not.toHaveBeenCalled();
    expect(screen.getByText(/notes\.pdf/)).toBeTruthy();
  });
});
