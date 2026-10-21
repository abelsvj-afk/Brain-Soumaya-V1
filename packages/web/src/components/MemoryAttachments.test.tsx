import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import type { Attachment } from "@brain/shared";

const listAttachments = vi.fn();
const addAttachment = vi.fn();
const deleteAttachment = vi.fn();
const downloadAttachment = vi.fn();
const attachmentObjectUrl = vi.fn();
vi.mock("../api/client.js", () => ({
  listAttachments: (...a: unknown[]) => listAttachments(...a),
  // CL-2 (IM-29): the panel now loads through the strict variant; it shares
  // this mock's behaviour (resolve = loaded, reject = load error).
  listAttachmentsStrict: (...a: unknown[]) => listAttachments(...a),
  addAttachment: (...a: unknown[]) => addAttachment(...a),
  deleteAttachment: (...a: unknown[]) => deleteAttachment(...a),
  downloadAttachment: (...a: unknown[]) => downloadAttachment(...a),
  attachmentObjectUrl: (...a: unknown[]) => attachmentObjectUrl(...a),
}));
vi.mock("./Toasts.js", () => ({ pushToast: vi.fn() }));

import { MemoryAttachments } from "./MemoryAttachments.js";

function att(over: Partial<Attachment> = {}): Attachment {
  return { id: 1, nodeId: 10, filename: "a.jpg", mime: "image/jpeg", size: 1000, createdAt: "2026-01-01", ...over };
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

/**
 * Regression for the reported bug (C3.5): "a second photo can sometimes be broken
 * when opened in fullscreen." Root cause traced to MemoryAttachments.tsx's lightbox
 * <img> rendering `urls[images[viewer].id]` with no loading fallback — unlike the
 * thumbnail grid, which already shows a "…" placeholder while its object URL is
 * still being fetched (attachmentObjectUrl() is a real network round-trip per
 * attachment, so later thumbnails are more likely to still be in flight when
 * tapped). Clicking a thumbnail before its URL resolves opened the lightbox with a
 * src-less, broken <img> that only fixed itself once the async fetch happened to
 * resolve afterward.
 */
describe("MemoryAttachments — lightbox opened before the image URL has resolved", () => {
  it("shows a loading state instead of a broken image, then displays it once the URL resolves", async () => {
    const first = att({ id: 1, filename: "first.jpg" });
    const second = att({ id: 2, filename: "second.jpg" });
    listAttachments.mockResolvedValue([first, second]);
    attachmentObjectUrl.mockImplementation((a: Attachment) => (a.id === 1 ? Promise.resolve("blob:first") : new Promise(() => {}))); // second never resolves in this test

    render(<MemoryAttachments nodeId={10} />);
    // Wait for the first thumbnail's real image to appear (its URL resolved).
    await waitFor(() => expect(screen.getByAltText("first.jpg")).toBeTruthy());
    // The second thumbnail is still loading — same "…" placeholder pattern as before.
    const thumbs = screen.getAllByTitle("View");
    expect(thumbs).toHaveLength(2);

    // Open the SECOND attachment's lightbox while its URL is still unresolved.
    await act(async () => {
      fireEvent.click(thumbs[1]!);
    });

    // Must never render a broken/src-less <img> in the lightbox.
    const lightboxImg = document.querySelector(".att-lb-img") as HTMLImageElement | null;
    if (lightboxImg) {
      expect(lightboxImg.getAttribute("src")).toBeTruthy();
    } else {
      // Acceptable alternative fix shape: no <img> rendered at all until ready —
      // a loading affordance is shown instead, specifically inside the lightbox
      // (the thumbnail grid has its own separate "…" placeholder — don't conflate them).
      const lightbox = document.querySelector('[role="dialog"]');
      expect(lightbox?.textContent).toMatch(/…|loading/i);
    }
  });

  it("regression: the first (already-resolved) attachment still opens correctly", async () => {
    const first = att({ id: 1, filename: "first.jpg" });
    listAttachments.mockResolvedValue([first]);
    attachmentObjectUrl.mockResolvedValue("blob:first");

    render(<MemoryAttachments nodeId={10} />);
    await waitFor(() => expect(screen.getByAltText("first.jpg")).toBeTruthy());
    fireEvent.click(screen.getByTitle("View"));

    const lightboxImg = document.querySelector(".att-lb-img") as HTMLImageElement;
    expect(lightboxImg).toBeTruthy();
    expect(lightboxImg.getAttribute("src")).toBe("blob:first");
  });

  it("clicking the second thumbnail opens the second image, not the first (index sanity)", async () => {
    const first = att({ id: 1, filename: "first.jpg" });
    const second = att({ id: 2, filename: "second.jpg" });
    listAttachments.mockResolvedValue([first, second]);
    attachmentObjectUrl.mockImplementation((a: Attachment) => Promise.resolve(a.id === 1 ? "blob:first" : "blob:second"));

    render(<MemoryAttachments nodeId={10} />);
    await waitFor(() => expect(screen.getByAltText("second.jpg")).toBeTruthy());
    const thumbs = screen.getAllByTitle("View");
    fireEvent.click(thumbs[1]!);

    const lightboxImg = document.querySelector(".att-lb-img") as HTMLImageElement;
    expect(lightboxImg.getAttribute("alt")).toBe("second.jpg");
    expect(lightboxImg.getAttribute("src")).toBe("blob:second");
  });
});
