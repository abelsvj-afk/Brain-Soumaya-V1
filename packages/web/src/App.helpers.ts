import type { CSSProperties } from "react";
import type { GraphData, GraphEdge, GraphNode } from "@brain/shared";

/**
 * Pure presentational helpers extracted from the large App.tsx (Post-MVP D4 refactor):
 * focus-cluster + song-dot inline styles and figurine icon/label lookups. No state.
 */

/**
 * Merge freshly-fetched node data into the graph state BY ID, preserving each existing
 * node's OBJECT REFERENCE for any id that still exists (Galaxy render-stall root-cause
 * fix, 2026-09-10 — see docs/specs/soumaya-galaxy-graphdata-refresh-audit.md and
 * docs/specs/soumaya-galaxy-cache-disposal-audit.md for the full confirmed mechanism).
 *
 * **Confirmed mechanism**: `three-forcegraph`'s own node object cache (`ThreeDigest`,
 * built on `data-bind-mapper`'s `DataBindMapper`) keys nodes by RAW OBJECT IDENTITY, not
 * `.id` — verified directly against the installed package: `new ThreeDigest(threeObj, {
 * objBindAttr: '__threeObj' })` is constructed with no `.id(fn)` override anywhere in the
 * bundle, so it falls back to `DataBindMapper`'s default identity function (`d => d`).
 * `getGraph()` (`api/client.ts`) is a plain `fetch().json()` with no identity-preserving
 * cache of its own, so every `refresh()` produced a BRAND-NEW node object for every node,
 * every time — meaning `digest()` never found an existing entry by reference, disposed
 * the PREVIOUS Object3D for literally every node (walking into shared, reference-counted
 * `geometryCache`/`labelTexCache`/`glowTexCache`/`cachedMoonTexture` entries in
 * `nodeObject.ts`, none of which the library's disposal path has any concept of being
 * shared), and rebuilt from scratch — a real, synchronous GPU-buffer-and-texture
 * re-upload burst for the entire currently-tracked galaxy, paid for inside the very next
 * `renderer.render()` call. This is a routine, everyday trigger (any ingest/task/chat
 * action that calls `refresh()`), not an edge case — and it fully explains why the
 * render-time cost tracked the size of the currently-tracked galaxy (not just what was
 * visible) and why isolating to a small View/Lens made the SAME galaxy instantly fast
 * again (far fewer nodes need reconstructing on the next refresh).
 *
 * **The fix**: reuse the SAME node object for an id that already exists — merging the
 * freshly-fetched SERVER fields onto it in place — so the digest recognizes it as
 * unchanged by reference and never disposes/rebuilds its Object3D at all. Only a
 * genuinely new id gets a fresh object (correctly triggering a real, one-time build).
 *
 * Deliberately NODES ONLY — links are NOT merged this way. `GraphEdge.source`/`target`
 * are typed as raw numeric ids server-side, but d3-force's link force resolves them into
 * direct NODE OBJECT REFERENCES in place once processed (the exact mechanism `4d10f8c`
 * depends on) — merging fresh link data over an already-resolved link object risks
 * clobbering that resolution back to a raw id, which this fix must never do. Node objects
 * carry no equivalent risk: the client-only position/velocity fields
 * (`x`/`y`/`z`/`fx`/`fy`/`fz`/`vx`/`vy`/`vz`) `orbits.ts` maintains are never present on a
 * freshly-fetched `GraphNode` (confirmed: not part of the shared `GraphNode` type), so
 * merging server fields onto an existing node object can never clobber them.
 *
 * --- Populate-path repair, D1/D5 (docs/repairs/galaxy-populate-render-stall.md) ---
 * Links ARE now merged too — but by edge DATABASE ID, never by endpoint pair, and with
 * scalar fields only. Rationale: the client's `linkKey` helper is UNDIRECTED
 * (`a<b ? "a-b" : "b-a"`) while `EdgesRepo.exists()` is DIRECTED, so reversed pairs
 * (A→B and B→A) can legally coexist; endpoint-pair keying would merge two distinct
 * relationships. Id-keying kills the parallel/reversed question entirely.
 *
 * Criterion 5 (state correctness) governs both merges: only objects included in the
 * returned (new) state may be mutated, and only with fields from the shared server
 * contract types (`GraphNode`/`GraphEdge`) via the explicit allowlists below. Client-only
 * fields (d3-resolved `source`/`target`, position/velocity/simulation fields) are never
 * written; unknown/extra fields on a fresh payload are never copied; objects dropped
 * from the new state are never touched.
 */

// Server-contract fields a refresh may merge onto an existing node. `id` is the merge
// key and never changes. Deliberately excludes every client-only field
// (`x`/`y`/`z`/`fx`/`fy`/`fz`/`vx`/`vy`/`vz`, `__threeObj`, d3 internals, …).
const GRAPH_NODE_SERVER_FIELDS: (keyof GraphNode)[] = [
  "label", "celestialTitle", "type", "content", "emotionalWeight", "color",
  "origin", "agent", "importance", "degree", "mass", "celestial", "val",
  "kind", "status", "progress", "aliases", "memberCount", "reviewStrength",
  "expiresAt", "lastTendedAt", "entropy", "occurredAt", "remindAt", "tags",
  "researchQuestions", "researchAnswers", "createdAt",
];

// GraphEdge scalar fields safe to merge. NEVER `source`/`target` (d3-force resolves
// those into node object references in place). NEVER `id` (it is the merge key).
const GRAPH_EDGE_SCALAR_FIELDS: (keyof GraphEdge)[] = [
  "relationship", "weight", "createdAt",
];

/**
 * Copy allowlisted own-fields from source onto target — explicit field assignment,
 * never `Object.assign` (which would also copy client-only and unknown fields).
 * A field absent from the fresh payload keeps its existing value.
 */
function copyAllowlistedFields<T extends object>(
  target: T,
  source: Partial<T>,
  fields: readonly (keyof T)[],
): void {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      (target as Record<keyof T, unknown>)[field] = source[field];
    }
  }
}

export function mergeGraphNodes(prevNodes: GraphNode[], freshNodes: GraphNode[]): GraphNode[] {
  const prevById = new Map(prevNodes.map((n) => [n.id, n]));
  return freshNodes.map((fresh) => {
    const existing = prevById.get(fresh.id);
    if (!existing) return fresh; // genuinely new node — a fresh object is correct
    copyAllowlistedFields(existing, fresh, GRAPH_NODE_SERVER_FIELDS);
    return existing;
  });
}

/**
 * Merge freshly-fetched link data BY EDGE ID, preserving each existing link's OBJECT
 * REFERENCE for any id that still exists — the link half of the render-stall fix
 * (three-forcegraph's digest keys links by raw object identity, exactly like nodes).
 * Scalar fields (`relationship`, `weight`, `createdAt`) merge onto the existing object;
 * `source`/`target` are never touched so d3-force's in-place node-object resolution
 * survives every refresh. A genuinely new id gets its fresh object (correct one-time
 * build); a vanished id is dropped (the digest removes its mesh).
 */
export function mergeGraphLinks(prevLinks: GraphEdge[], freshLinks: GraphEdge[]): GraphEdge[] {
  const prevById = new Map(prevLinks.map((l) => [l.id, l]));
  return freshLinks.map((fresh) => {
    const existing = prevById.get(fresh.id);
    if (!existing) return fresh; // genuinely new link — a fresh object is correct
    copyAllowlistedFields(existing, fresh, GRAPH_EDGE_SCALAR_FIELDS);
    return existing;
  });
}

/** Applies {@link mergeGraphNodes} and {@link mergeGraphLinks} to a full refresh payload. */
export function mergeGraphData(prev: GraphData, fresh: GraphData): GraphData {
  return {
    nodes: mergeGraphNodes(prev.nodes, fresh.nodes),
    links: mergeGraphLinks(prev.links, fresh.links),
  };
}

/** Pop-up offset for an item in the focus cluster (stacks upward when open). */
export function focusItemStyle(index: number, open: boolean): CSSProperties {
  return open
    ? { transform: `translateY(${-(index + 1) * 54}px)`, opacity: 1, pointerEvents: "auto" }
    : { transform: "translateY(0) scale(0.4)", opacity: 0, pointerEvents: "none" };
}

/** Position a song dot on an arc fanning up-and-right from the music FAB (bottom-left). */
export function songDotStyle(i: number, total: number): CSSProperties {
  const start = 16, end = 100; // degrees
  const t = total <= 1 ? 0.5 : i / (total - 1);
  const rad = ((start + (end - start) * t) * Math.PI) / 180;
  const R = 78;
  return {
    position: "fixed",
    left: `${36 + Math.cos(rad) * R}px`,
    bottom: `${152 + Math.sin(rad) * R}px`,
    transform: "translate(-50%, 50%)",
  };
}

export function getFigurineIcon(type: string): string {
  switch (type) {
    case "station": return "🌐";
    case "satellite": return "🛰️";
    case "star_center": return "🌟";
    case "dyson_sphere": return "🪐";
    case "quantum_core": return "🌌";
    case "hyper_array": return "📡";
    case "shield_spire": return "🛡️";
    case "blackhole": return "🕳️";
    default: return "🗿";
  }
}

export function getFigurineLabel(type: string): string {
  switch (type) {
    case "station": return "Waystation Figurine";
    case "satellite": return "Aura Beacon Figurine";
    case "star_center": return "Solar Monument";
    case "dyson_sphere": return "Dyson Megastructure";
    case "quantum_core": return "Quantum Singularity Core";
    case "hyper_array": return "Synapse Hyper-Array";
    case "shield_spire": return "Aegis Shield Spire";
    case "blackhole": return "The Singularity";
    default: return type;
  }
}
