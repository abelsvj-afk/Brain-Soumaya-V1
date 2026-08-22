import { useEffect, useRef, useState } from "react";
import type { Attachment } from "@brain/shared";
import { listAttachments, addAttachment, deleteAttachment, downloadAttachment, attachmentObjectUrl } from "../api/client.js";
import { prepareUpload, isImageMime } from "../lib/image.js";
import { pushToast } from "./Toasts.js";

/**
 * Attachments on any node (memory OR a Mind object like a person). Images are shown as
 * inline thumbnails you can tap to VIEW full-screen and swipe through — not just a
 * download link. Picked photos are downscaled + re-encoded before upload so full-res
 * phone pictures fit. Non-image files keep a download pill.
 */
const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1e6 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1e6).toFixed(1)} MB`);

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
  const [urls, setUrls] = useState<Record<number, string>>({}); // attId → objectURL (images)
  const [viewer, setViewer] = useState<number | null>(null); // index into images being viewed
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    listAttachments(nodeId).then((a) => alive && setItems(a)).catch(() => {});
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
    if (!(await deleteAttachment(nodeId, att.id))) return;
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

      {images.length > 0 && (
        <div className="att-gallery">
          {images.map((a, i) => (
            <button key={a.id} className="att-thumb" onClick={() => setViewer(i)} title="View">
              {urls[a.id] ? <img src={urls[a.id]} alt={a.filename} /> : <span className="att-thumb-load">…</span>}
            </button>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0.4rem 0 0", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
          {files.map((a) => (
            <li key={a.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem" }}>
              <button className="pill" style={{ flex: 1, textAlign: "left" }} onClick={() => downloadAttachment(a).catch(() => pushToast("Download failed", "⚠️", 3500))} title="Download">
                ⬇ {a.filename}
              </button>
              <span style={{ opacity: 0.5, fontSize: "0.68rem" }}>{fmtSize(a.size)}</span>
              <button className="mini" style={{ padding: "0.1rem 0.4rem" }} onClick={() => void onRemove(a)} title="Remove">✕</button>
            </li>
          ))}
        </ul>
      )}

      {items.length === 0 && (
        <p style={{ fontSize: "0.74rem", opacity: 0.6, margin: 0 }}>No photos or files yet — add one and it lives right here.</p>
      )}

      {viewer != null && images[viewer] && (
        <div className="att-lightbox" role="dialog" aria-label="Photo viewer" onClick={() => setViewer(null)}>
          <button className="att-lb-close" onClick={() => setViewer(null)} aria-label="Close">×</button>
          {images.length > 1 && (
            <button className="att-lb-nav prev" onClick={(e) => { e.stopPropagation(); setViewer((v) => (v! - 1 + images.length) % images.length); }} aria-label="Previous">‹</button>
          )}
          <img className="att-lb-img" src={urls[images[viewer]!.id]} alt={images[viewer]!.filename} onClick={(e) => e.stopPropagation()} />
          {images.length > 1 && (
            <button className="att-lb-nav next" onClick={(e) => { e.stopPropagation(); setViewer((v) => (v! + 1) % images.length); }} aria-label="Next">›</button>
          )}
          <div className="att-lb-actions" onClick={(e) => e.stopPropagation()}>
            <span>{viewer + 1} / {images.length}</span>
            <button className="mini" onClick={() => downloadAttachment(images[viewer]!).catch(() => {})}>⬇ Download</button>
            <button className="mini ghost" onClick={() => void onRemove(images[viewer]!)}>✕ Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}
