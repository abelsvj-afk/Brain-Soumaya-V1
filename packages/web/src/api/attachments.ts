import type { Attachment } from "@brain/shared";
import { API, afetch } from "./http.js";

/**
 * Attachment client calls — files kept on a memory (list/add/delete/view/download).
 * Split out of client.ts in the Post-MVP D4 refactor; re-exported from client.ts.
 */

/** Files attached to a memory note (metadata only). */
export async function listAttachments(nodeId: number): Promise<Attachment[]> {
  try {
    const res = await afetch(`${API}/nodes/${nodeId}/attachments`);
    const d = await res.json().catch(() => []);
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

/**
 * Strict variant of listAttachments (IM-29/IM-31 pattern): THROWS on
 * network/HTTP failure so a surface can tell "load failed" apart from
 * "genuinely no attachments". listAttachments' fail-soft contract is
 * unchanged for its other callers (Timeline).
 */
export async function listAttachmentsStrict(nodeId: number): Promise<Attachment[]> {
  const res = await afetch(`${API}/nodes/${nodeId}/attachments`);
  if (!res.ok) throw new Error(`Attachments failed (${res.status})`);
  const d = await res.json().catch(() => []);
  return Array.isArray(d) ? (d as Attachment[]) : [];
}

/** Attach a file (read as base64) to a memory note. Returns the metadata or throws. */
export async function addAttachment(
  nodeId: number,
  file: { filename: string; mime: string; data: string },
): Promise<Attachment> {
  const res = await afetch(`${API}/nodes/${nodeId}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(file),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Upload failed (${res.status})`);
  }
  return res.json() as Promise<Attachment>;
}

export async function deleteAttachment(nodeId: number, attId: number): Promise<boolean> {
  try {
    const res = await afetch(`${API}/nodes/${nodeId}/attachments/${attId}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch an attachment's bytes as an object URL for INLINE viewing (an <img>/<video>
 *  can't send our auth header, so we fetch the blob ourselves and hand back a local URL).
 *  Caller must URL.revokeObjectURL it when done. */
export async function attachmentObjectUrl(att: Pick<Attachment, "id" | "nodeId">): Promise<string | null> {
  try {
    const res = await afetch(`${API}/nodes/${att.nodeId}/attachments/${att.id}/download`);
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

/** Download an attachment's bytes (sends the auth header, then triggers a save). */
export async function downloadAttachment(att: Attachment): Promise<void> {
  const res = await afetch(`${API}/nodes/${att.nodeId}/attachments/${att.id}/download`);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = att.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
