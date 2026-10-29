import { API, afetch } from "./http.js";
import type { RelicsStateView, EffectiveRelicBuffs } from "@brain/shared";

/** Relic Buffs v2 client — thin transport; the server owns every number. No timestamps are in these payloads. */
export type RelicsState = RelicsStateView;
export interface RelicPreview { previewFor: string; previewName: string; refused: string | null; wouldHold: string[]; buffs: EffectiveRelicBuffs & { riseWindowSetByName?: string | null; riseWindowOverruledNames?: string[] }; }
export interface FoundResult { ok: boolean; alreadyFound?: boolean; awarded?: boolean; error?: string; state?: RelicsStateView; }

export async function getRelics(preview?: string): Promise<RelicsStateView | RelicPreview | null> {
  try {
    const res = await afetch(`${API}/relics${preview ? `?preview=${encodeURIComponent(preview)}` : ""}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
export async function getRelicsState(): Promise<RelicsStateView | null> {
  const out = await getRelics();
  return out && "found" in out ? out : null;
}
export async function getRelicPreview(relicId: string): Promise<RelicPreview | null> {
  const out = await getRelics(relicId);
  return out && "previewFor" in out ? out : null;
}
export async function postRelic(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; state?: RelicsStateView; comet?: { relicId: string; name: string }; [k: string]: unknown }> {
  try {
    const res = await afetch(`${API}/relics/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, ...data };
  } catch { return { ok: false, error: "That didn't go through — please try again." }; }
}
export async function findRelic(relicId: string): Promise<FoundResult> {
  const out = await postRelic("found", { relicId });
  return out as FoundResult;
}
export async function holdRelic(relicId: string) { return postRelic("hold", { relicId }); }
export async function unholdRelic(relicId: string) { return postRelic("unhold", { relicId }); }
export async function releaseRelic(relicId: string) { return postRelic("release", { relicId }); }
export async function syncLegacyRelics(relicIds: string[]) { return postRelic("legacy-sync", { relicIds }); }
export async function setRelicScarcity(off: boolean): Promise<{ ok: boolean; scarcityOff?: boolean; error?: string }> {
  try {
    const res = await afetch(`${API}/relics/scarcity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ off }) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, ...data };
  } catch { return { ok: false, error: "That didn't go through — please try again." }; }
}
