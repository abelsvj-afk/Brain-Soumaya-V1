import type { CSSProperties } from "react";
import type { GraphData, GraphEdge, GraphNode } from "@brain/shared";
import { isPhonePortraitViewport } from "./graph/labelFrame.js";
import { localDateOfStored, spaceLocalDay } from "./utils/localDay.js";
import { parseTolerantMs } from "./utils/dueReminders.js";
import { getSpaceTimeZone } from "./utils/spaceTimezone.js";

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

/**
 * A link endpoint is a raw node id on a fresh payload, but d3-force resolves
 * it into the node OBJECT in place once the link has been rendered — accept
 * both shapes when reading an endpoint's id.
 */
function endpointId(endpoint: GraphEdge["source"]): number {
  return typeof endpoint === "number" ? endpoint : (endpoint as unknown as GraphNode).id;
}

/**
 * Applies {@link mergeGraphNodes} and {@link mergeGraphLinks} to a full refresh
 * payload, then enforces the payload invariant the renderer depends on: every
 * link's endpoints must be in the merged node set. A dangling link makes
 * d3-force throw `node not found: <id>` and takes down the whole galaxy, so
 * links pointing outside the shipped nodes are dropped here — the final
 * choke point before graph state (the server also prunes at the source).
 */
export function mergeGraphData(prev: GraphData, fresh: GraphData): GraphData {
  const nodes = mergeGraphNodes(prev.nodes, fresh.nodes);
  const ids = new Set(nodes.map((n) => n.id));
  const links = mergeGraphLinks(prev.links, fresh.links).filter(
    (l) => ids.has(endpointId(l.source)) && ids.has(endpointId(l.target)),
  );
  return { nodes, links };
}

/**
 * Focus-fan geometry (Mobile HUD layout pass, screenshot round 2 S3).
 *
 * The fan opens UPWARD from the 🎯 cluster (bottom slot
 * --hud-cam-focus-bottom = 298, asserted against the stylesheet in
 * HudDock.geometry.test.tsx). With all 7 target slots filled at the
 * desktop 54px step, the top item's top edge lands at 298 + 7×54 + 46 =
 * 722px from the bottom — on the owner's phone that is INSIDE the brand
 * header (shot 1: a fan item sits directly behind the "Soumaya ⏏"
 * switcher pill). Package B's geometry gate only asserted the fan stays
 * ON screen; nothing compared it against the header band.
 *
 * Phone portrait (the pass's one breakpoint): the step compresses to
 * 46px (items touch, never overlap), and if the targets still can't
 * fit between the 🎯 and the header band, the fan FOLDS — the last
 * visible slot becomes a "more" item that pages through the remaining
 * targets. Nothing is removed: every target stays reachable, and off
 * phones the layout is exactly today's (54px step, no fold at any
 * realistic window height).
 */
export const FAN_STEP_DESKTOP = 54;
export const FAN_STEP_PHONE = 46;
export const FAN_ITEM_PX = 46; // .fab circle
export const FAN_CLUSTER_BOTTOM_PX = 298; // --hud-cam-focus-bottom (asserted in the geometry gate)
export const FAN_HEADER_BAND_PX = 110; // brand header zone at the top that must stay clear

export interface FanLayout {
  /** Vertical step between fan items at this viewport. */
  step: number;
  /** How many fan slots (targets + the fold's "more" item) fit under the header band. */
  capacity: number;
  /** True when the targets overflow the capacity and the fan must page. */
  folded: boolean;
  /** Targets per page when folded (capacity minus the "more" slot); all targets when not. */
  pageSize: number;
  pageCount: number;
}

export function fanLayout(viewW: number, viewH: number, total: number): FanLayout {
  if (!isPhonePortraitViewport(viewW, viewH) || total <= 0) {
    return { step: FAN_STEP_DESKTOP, capacity: Math.max(total, 1), folded: false, pageSize: Math.max(total, 1), pageCount: 1 };
  }
  const capacity = Math.max(
    2, // a folded fan always shows at least one target beside its "more" item
    Math.floor((viewH - FAN_HEADER_BAND_PX - FAN_CLUSTER_BOTTOM_PX - FAN_ITEM_PX) / FAN_STEP_PHONE),
  );
  const folded = total > capacity;
  const pageSize = folded ? capacity - 1 : total;
  return {
    step: FAN_STEP_PHONE,
    capacity,
    folded,
    pageSize,
    pageCount: folded ? Math.ceil(total / pageSize) : 1,
  };
}

/** The window of target indices shown on `page` (clamped into range). */
export function fanWindow(
  total: number,
  layout: FanLayout,
  page: number,
): { start: number; count: number; page: number } {
  const p = Math.min(Math.max(0, page), layout.pageCount - 1);
  const start = p * layout.pageSize;
  return { start, count: Math.min(layout.pageSize, total - start), page: p };
}

/** Top edge (px from the bottom) of the highest fan slot a layout can show. */
export function fanTopEdge(layout: FanLayout): number {
  const slots = layout.folded ? layout.capacity : layout.pageSize;
  return FAN_CLUSTER_BOTTOM_PX + slots * layout.step + FAN_ITEM_PX;
}

/** Pop-up offset for an item in the focus cluster (stacks upward when open). */
export function focusItemStyle(index: number, open: boolean, stepPx: number = FAN_STEP_DESKTOP): CSSProperties {
  return open
    ? { transform: `translateY(${-(index + 1) * stepPx}px)`, opacity: 1, pointerEvents: "auto" }
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

/**
 * Space-timezone day derivations for App.tsx (audit-2 item 2), extracted
 * from their inline call sites so the day they use is testable. Both
 * default to the SPACE's configured timezone (utils/spaceTimezone.ts —
 * device zone only as that accessor's pre-load fallback), never the raw
 * device zone.
 */

/** The once-per-day localStorage key for a bill-urgency notification. */
export function billNotificationKey(
  billId: string | number,
  now: Date = new Date(),
  timeZone: string = getSpaceTimeZone(),
): string {
  return `notif.bill.${billId}.${spaceLocalDay(now, timeZone)}`;
}

/** Streak "logged today": some non-action memory was created on the
 *  space-local day containing `now`. A memory's createdAt is a stored
 *  instant, so membership is derived from the instant in the space's
 *  timezone — never its raw UTC string prefix. */
export function hasLoggedToday(
  nodes: Pick<GraphNode, "kind" | "createdAt">[],
  now: Date = new Date(),
  timeZone: string = getSpaceTimeZone(),
): boolean {
  const today = spaceLocalDay(now, timeZone);
  return nodes.some(
    (n) => n.kind !== "action" && localDateOfStored(n.createdAt, parseTolerantMs, timeZone) === today,
  );
}
