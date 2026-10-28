import { useCallback, useEffect, useRef, useState } from "react";
import type { Attachment } from "@brain/shared";
import { listAttachmentsStrict, addAttachment, deleteAttachment, downloadAttachment, attachmentObjectUrl } from "../api/client.js";
import { prepareUpload, isImageMime } from "../lib/image.js";
import { pushToast } from "./Toasts.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { parseTolerantMs } from "../utils/dueReminders.js";

/**
 * Attachments on any node (memory OR a Mind object like a person). Images are shown as
 * inline thumbnails you can tap to VIEW full-screen and swipe through — not just a
 * download link. Picked photos are downscaled + re-encoded before upload so full-res
 * phone pictures fit. Non-image files keep a download pill.
 */
const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1e6 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1e6).toFixed(1)} MB`);

/** Local date an attachment was added; unparseable stored values become a
 *  human placeholder, never the raw storage string (IM-33/IM-36). */
export const fmtAttWhen = (raw: string): string => {
  const t = parseTolerantMs(raw);
  if (Number.isNaN(t)) return "date unavailable";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export function MemoryAttachments({
  nodeId,
  label = "📎 Attachments",
}: {
  nodeId: number;
  /** Section heading — e.g. "📷 Photos" on a person. */
  label?: string;
}) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  // Loading / failure are their own states (IM-29): a slow or failed load must
  // not render as "no photos or files yet".
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Attachment delete is irreversible — it confirms through the same app
  // dialog as node delete (IM-34) instead of firing instantly.
  const [confirming, setConfirming] = useState<Attachment | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({}); // attId → objectURL (images)
  const [viewer, setViewer] = useState<number | null>(null); // index into images being viewed
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    return listAttachmentsStrict(nodeId)
      .then((a) => setItems(a))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [nodeId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    listAttachmentsStrict(nodeId)
      .then((a) => alive && setItems(a))
      .catch(() => alive && setLoadError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [nodeId]);

  // Fetch object URLs for image attachments (once each); revoke on unmount.
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    for (const a of items) {
      if (isImageMime(a.mime) && !urls[a.id]) {
        void attachmentObjectUrl(a).then((u) => {
          if (u && alive) {
            made.push(u);
            setUrls((prev) => (prev[a.id] ? prev : { ...prev, [a.id]: u }));
          } else if (u) {
            URL.revokeObjectURL(u);
          }
        });
      }
    }
    return () => {
      alive = false;
      for (const u of made) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const images = items.filter((a) => isImageMime(a.mime));
  const files = items.filter((a) => !isImageMime(a.mime));

  const onPick = async (file: File) => {
    setBusy(true);
    try {
      const payload = await prepareUpload(file);
      const meta = await addAttachment(nodeId, { filename: payload.filename, mime: payload.mime, data: payload.data });
      setItems((prev) => [meta, ...prev]);
      pushToast(`Added "${meta.filename}" ${payload.compressed ? "📷" : "📎"}`, "📎", 3000);
    } catch (err) {
      pushToast((err as Error).message || "Attach failed", "⚠️", 4500);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onRemove = async (att: Attachment) => {
    setConfirming(null);
    if (!(await deleteAttachment(nodeId, att.id))) {
      pushToast("Couldn't remove that — try again.", "⚠️", 3500);
      return;
    }
    setViewer(null);
    setItems((prev) => prev.filter((a) => a.id !== att.id));
    if (urls[att.id]) {
      URL.revokeObjectURL(urls[att.id]!);
      setUrls((prev) => {
        const c = { ...prev };
        delete c[att.id];
        return c;
      });
    }
  };

  return (
    <div style={{ marginTop: "0.85rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
        <h4 style={{ margin: 0, fontSize: "0.82rem" }}>{label}</h4>
        <button className="mini" disabled={busy} onClick={() => inputRef.current?.click()} title="Add a photo or file">
          {busy ? "Adding…" : "+ Add"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf,.doc,.docx,.txt"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPick(f);
          }}
        />
      </div>

      {loading && (
        <div className="att-skeleton" role="status" aria-label="Loading attachments">
          <span className="skeleton-line" />
          <span className="skeleton-line short" />
        </div>
      )}

      {!loading && loadError && (
        <div className="att-error" role="alert">
          <p style={{ fontSize: "0.74rem", margin: "0 0 0.35rem" }}>Couldn’t load attachments — they may still be there.</p>
          <button className="mini" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {!loading && !loadError && images.length > 0 && (
        <div className="att-gallery">
          {images.map((a, i) => (
            <figure key={a.id} className="att-cell">
              <button className="att-thumb" onClick={() => setViewer(i)} title="View">
                {urls[a.id] ? <img src={urls[a.id]} alt={a.filename} /> : <span className="att-thumb-load">…</span>}
              </button>
              <figcaption className="att-meta">
                <span className="att-name" title={a.filename}>{a.filename}</span>
                <span className="att-sub">
                  {fmtSize(a.size)} · {fmtAttWhen(a.createdAt)}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {!loading && !loadError && files.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {files.map((a) => (
            <li key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem" }}>
              <button className="pill" style={{ flex: 1, textAlign: "left" }} onClick={() => downloadAttachment(a).catch(() => pushToast("Download failed", "⚠️", 3500))} title="Download">
                ⬇ {a.filename}
              </button>
              <span style={{ opacity: 0.5, fontSize: "0.68rem" }}>
                {fmtSize(a.size)} · {fmtAttWhen(a.createdAt)}
              </span>
              <button className="mini att-remove" style={{ padding: "0.1rem 0.4rem" }} onClick={() => setConfirming(a)} aria-label={`Remove ${a.filename}`} title="Remove">✕ Remove</button>
            </li>
          ))}
        </ul>
      )}

      {!loading && !loadError && items.length === 0 && (
        <p style={{ fontSize: "0.74rem", opacity: 0.6, margin: 0 }}>No photos or files yet — add one and it lives right here.</p>
      )}

      {viewer != null && images[viewer] && (
        <div className="att-lightbox" role="dialog" aria-label="Photo viewer" onClick={() => setViewer(null)}>
          <button className="att-lb-close" onClick={() => setViewer(null)} aria-label="Close">×</button>
          {images.length > 1 && (
            <button className="att-lb-nav prev" onClick={(e) => { e.stopPropagation(); setViewer((v) => (v! - 1 + images.length) % images.length); }} aria-label="Previous">‹</button>
          )}
          {urls[images[viewer]!.id] ? (
            <img className="att-lb-img" src={urls[images[viewer]!.id]} alt={images[viewer]!.filename} onClick={(e) => e.stopPropagation()} />
          ) : (
            // The object URL is a real per-attachment network fetch (attachmentObjectUrl) —
            // opening the viewer before it resolves used to render a src-less, broken <img>.
            // Same loading affordance the thumbnail grid already shows while waiting.
            <span className="att-lb-loading" onClick={(e) => e.stopPropagation()}>
              …
            </span>
          )}
          {images.length > 1 && (
            <button className="att-lb-nav next" onClick={(e) => { e.stopPropagation(); setViewer((v) => (v! + 1) % images.length); }} aria-label="Next">›</button>
          )}
          <div className="att-lb-actions" onClick={(e) => e.stopPropagation()}>
            <span>{viewer + 1} / {images.length}</span>
            <span className="att-lb-meta">
              {images[viewer]!.filename} · {fmtSize(images[viewer]!.size)} · {fmtAttWhen(images[viewer]!.createdAt)}
            </span>
            <button className="mini" onClick={() => downloadAttachment(images[viewer]!).catch(() => pushToast("Download failed", "⚠️", 3500))}>⬇ Download</button>
            <button className="mini ghost" onClick={() => setConfirming(images[viewer]!)}>✕ Remove</button>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title="Remove this attachment?"
          message={`"${confirming.filename}" will be permanently removed. This can't be undone.`}
          confirmLabel="Remove"
          onConfirm={() => void onRemove(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
