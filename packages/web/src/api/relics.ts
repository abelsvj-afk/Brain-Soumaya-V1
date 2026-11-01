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
/**
 * Relics I-4: the claim is sampled. The client reports the settling
 * moment (the glimmer's anchor position — where the scene rests the
 * relic), dwells, then claims with a unique claimId. The server stamps
 * every sample on receipt and measures the dwell from its own stamps;
 * there is deliberately NO anchorKey and NO duration in any of these
 * bodies — the server derives the anchor and the dwell itself.
 */
export async function sampleRelicClaimStart(position: readonly number[]): Promise<{ ok: boolean; error?: string; state?: RelicsStateView }> {
  const out = await postRelic("sample", { position: [...position], kind: "claim-start" });
  return out as { ok: boolean; error?: string; state?: RelicsStateView };
}
export interface ScanPulse { ok: boolean; band?: string | null; bearing?: string | null; widened?: boolean; quiet?: boolean; error?: string; state?: RelicsStateView }
export async function scanRelic(relicId: string, position: readonly number[], widened = false): Promise<ScanPulse> {
  const out = await postRelic("scan", { relicId, position: [...position], widened });
  return out as ScanPulse;
}
export async function findRelic(relicId: string, claimId: string, position: readonly number[]): Promise<FoundResult> {
  const out = await postRelic("found", { relicId, claimId, position: [...position] });
  return out as FoundResult;
}
export async function holdRelic(relicId: string) { return postRelic("hold", { relicId }); }
export async function unholdRelic(relicId: string) { return postRelic("unhold", { relicId }); }
export async function releaseRelic(relicId: string) { return postRelic("release", { relicId }); }
/**
 * Relics I-7: the Hold's remaining changes, wired to the I-6 routes.
 * Store/carry flip the holding's location state; the exchange posts
 * the menu choice the SERVER's state view offered (the client never
 * decides eligibility) under a fresh attempt key, so a replay answers
 * with the recorded outcome. All three are Station-gated server-side;
 * off-Station the server refuses with its plain reason.
 */
export async function storeRelic(relicId: string) { return postRelic("store", { relicId }); }
export async function carryRelic(relicId: string) { return postRelic("carry", { relicId }); }
export type RelicExchangeOption = "lore" | "credits" | "chart";
export async function exchangeRelic(relicId: string, option: RelicExchangeOption, chartTargetRelicId: string | null, attemptKey: string) {
  return postRelic("exchange", { relicId, option, chartTargetRelicId, attemptKey });
}
export async function syncLegacyRelics(relicIds: string[]) { return postRelic("legacy-sync", { relicIds }); }
export async function setRelicScarcity(off: boolean): Promise<{ ok: boolean; scarcityOff?: boolean; error?: string }> {
  try {
    const res = await afetch(`${API}/relics/scarcity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ off }) });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, ...data };
  } catch { return { ok: false, error: "That didn't go through — please try again." }; }
}
