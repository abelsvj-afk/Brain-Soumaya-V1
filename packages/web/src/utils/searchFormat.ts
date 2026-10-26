import type { SearchHit } from "../api/client.js";

/**
 * What a search hit's row shows instead of a percentage (REG-185 / SP-02).
 * The list is ranked by RRF fusion, not by any number the row could print,
 * and keyword-only hits have no cosine at all — so no number is displayed as
 * a match score. What the row does say is which retrieval side(s) produced
 * the hit. Hits without a matchKind (older payloads, tests) show nothing.
 */
export function matchLabel(h: SearchHit): string {
  if (h.matchKind === "both") return "keyword · semantic";
  if (h.matchKind === "keyword") return "keyword match";
  if (h.matchKind === "vector") return "semantic match";
  return "";
}

/**
 * The "more matches exist" line for a top-k page (REG-186 / SP-03). When the
 * probe pool was exhausted `total` is a lower bound, so the line says "more
 * than N" rather than stating an exact count it doesn't have.
 */
export function moreMatchesText(shown: number, total: number, totalCapped: boolean): string {
  return totalCapped
    ? `Top ${shown} shown — more than ${total} matches exist`
    : `Top ${shown} of ${total} matches`;
}
