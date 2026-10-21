import * as THREE from "three";

/**
 * Curved-link tube geometry, reused frame-to-frame instead of rebuilt.
 *
 * three-forcegraph's own per-frame link-position sync (three-forcegraph.mjs's
 * `layoutTick`) constructs a brand-new `THREE.TubeGeometry` -- with a brand-new
 * `QuadraticBezierCurve3` and several fresh `Vector3`s -- for every curved link,
 * on EVERY rendered frame, then disposes the previous geometry (see
 * docs/specs/soumaya-galaxy-*-audit.md, Round 4). This app's `linkWidth`/
 * `linkCurvature` accessors (Graph3D.tsx) are always nonzero, so every visible
 * link takes this path: an O(visible links) per-frame allocation + GPU-reupload
 * cost with zero caching, confirmed by direct source reads (both this repo and
 * the installed `three-forcegraph` package) as the dominant cause of the
 * catastrophic FPS collapse on a large/full Galaxy View.
 *
 * This module intercepts exactly that path via three-forcegraph's own
 * `linkPositionUpdate` extension point -- a documented, application-layer hook
 * (three-forcegraph.mjs's `layoutTick`: returning `true` from this callback
 * skips the library's own `calcLinkCurve()` + geometry-rebuild for that link
 * entirely). Each link's tube geometry -- matching THREE.TubeGeometry's exact
 * vertex/normal/uv/index layout, for zero visual difference -- is built ONCE
 * and cached (keyed by the link object itself, via a WeakMap so entries are
 * naturally collected once a link leaves `data.links`). Every subsequent
 * frame, only the position/normal attribute arrays are recomputed IN PLACE
 * (via the curve's own public `computeFrenetFrames()`/`getPointAt()` APIs) --
 * no new geometry, no `.dispose()`, no GPU buffer reallocation, just
 * `attribute.needsUpdate = true` (a partial upload onto the existing GPU
 * resource).
 *
 * Ownership/disposal: the geometry lives at `mesh.geometry`, the exact field
 * three-forcegraph itself reads/disposes when a link's Object3D is actually
 * removed (its own `_deallocate`/removal path disposes whatever is currently
 * assigned there) -- so no separate disposal path or cache-eviction logic is
 * needed here; three-forcegraph's existing disposal already covers it.
 *
 * CRITICAL, previously-undiscovered gap this file did NOT close (Galaxy recovery
 * pass, 2026-09-10): three-forcegraph's own object DIGEST (separate from the per-
 * frame position loop above -- this one runs inside `onUpdateObj`, driven by
 * React prop changes, not animation frames) independently gate-checks every
 * link's CURRENT `obj.geometry` on every digest pass:
 *
 *   if (!obj.geometry.type.match(/^Cylinder(Buffer)?Geometry$/) ||
 *       obj.geometry.parameters.radiusTop !== r ||
 *       obj.geometry.parameters.radialSegments !== numSegments) {
 *     obj.geometry.dispose();
 *     obj.geometry = cylinderGeometries[linkWidth];
 *   }
 *
 * This app's `linkColor` prop is a deliberately unmemoized inline closure (see
 * Graph3D.tsx's own comment on that prop) SPECIFICALLY so its identity changes on
 * every Graph3D render, re-triggering this digest to pick up live activity-driven
 * color/opacity -- but that digest has NO IDEA this module manages link geometry
 * itself. `entry.geometry` is a plain `THREE.BufferGeometry` (`.type ===
 * "BufferGeometry"`, no `.parameters`), so the FIRST check term is always true
 * (short-circuiting the `||` before `.parameters` is ever read, so no crash) --
 * meaning EVERY digest pass, for EVERY tube-rendered link, called `.dispose()` on
 * THIS EXACT geometry object (the one cached and reused above) and swapped
 * `mesh.geometry` to a shared flat cylinder. The self-healing reassignment above
 * (`mesh.geometry = entry.geometry`) then re-attaches the very geometry that was
 * JUST disposed a moment earlier -- restoring the correct REFERENCE, but three.js
 * had already removed it from `WebGLGeometries`' cache on dispose, so the next
 * render silently re-uploads the ENTIRE geometry (position + normal + uv + index
 * buffers) from scratch, every time -- exactly the "no `.dispose()`, no GPU buffer
 * reallocation, just a partial upload" guarantee this file's own header claims,
 * defeated by a code path this file never accounted for. Confirmed no core
 * three.js code branches on `Geometry.type` (it is a pure serialization/duck-
 * typing string), so `create()`/`update()` below deliberately spoof `.type` and
 * `.parameters` to make three-forcegraph's own check pass, permanently. This
 * does not touch how three-forcegraph applies COLOR/OPACITY/MATERIAL (a
 * completely separate branch in the same `onUpdateObj`, unaffected by this fix)
 * -- only the geometry-identity check this module's own reused geometry was
 * never being recognized by.
 *
 * Known, deliberately-accepted residual costs (not eliminated by this module,
 * and not new -- both already present in the current, unmodified per-frame
 * TubeGeometry construction this replaces):
 *  - `curve.computeFrenetFrames()` allocates ~3*(TUBULAR_SEGMENTS+1) fresh
 *    `Vector3`s internally every call (three.js's own implementation has no
 *    scratch-buffer parameter) -- unavoidable without hand-reimplementing
 *    Frenet-frame math, which risks subtly wrong tube twist/orientation.
 *  - `curve.getPointAt()`/`getTangentAt()` rely on an arc-length cache
 *    (`Curve.getLengths()`, default 200 divisions) that must be invalidated
 *    every frame the curve's control points change (`curve.needsUpdate =
 *    true`) -- each invalidation re-samples 200 points. THREE.TubeGeometry's
 *    own construction pays this exact same cost every time it's built, so
 *    this is not a regression, just an unremoved pre-existing cost.
 * Both are flagged in the implementation report rather than hidden.
 *
 * Deliberately NOT intercepted (falls back to three-forcegraph's own,
 * already-correct handling): zero width (a link `shouldRenderLink` has culled
 * -- rare, LOD-gated), zero curvature (never happens in this app today, but
 * safe to leave alone), and coincident endpoints (a self-loop link -- an edge
 * case this app's associative/journey/cognitive linking never produces).
 * Keeping the intercepted surface to exactly "curved, nonzero-width, distinct
 * endpoints" is what makes this a small, reviewable change instead of a
 * broader rewrite of link rendering.
 *
 * SECOND resource-lifecycle defect, confirmed by source (Galaxy render-stall
 * forensic pass, 2026-09-11) — distinct from the digest gap above, and NOT closed by
 * the `.type`/`.parameters` spoofing that fixed that one: a full `fg.refresh()` call
 * sets three-forcegraph's internal `_flushObjects` flag, which runs `data-bind-mapper`'s
 * `digest([])` against the link map — every currently-tracked link's Object3D is torn
 * down via the library's generic, UNCONDITIONAL removal path
 * (`scene.remove(obj); _deallocate(obj);`, where `_deallocate` calls
 * `obj.geometry.dispose()` regardless of `.type`/`.parameters` — that spoofing only
 * ever protected the narrower digest-gate check quoted above, not this removal path).
 * This disposes the EXACT SAME shared `entry.geometry` this cache hands out — and on
 * the very next `update()` call for that same link (same WeakMap key), the cache found
 * its entry and returned `entry.geometry` UNCHANGED, silently handing three.js a
 * geometry whose GPU resources were just freed. Three.js has no choice but to
 * transparently re-upload the entire buffer set (position/normal/uv/index) the next
 * time it's drawn — for every tracked link at once, synchronously, inside that
 * `renderer.render()` call. Population-scaling, intermittent (only when `_flushObjects`
 * fires — Soumaya's link-repair cadence, a new link, or any node selection via
 * `linkWidthCb`'s `activeId` dependency), and a strong match for the catastrophic,
 * population-correlated render stalls measured on the physical device (see
 * docs/specs/soumaya-galaxy-cache-disposal-audit.md for the identical class of bug,
 * previously confirmed and fixed for the analogous NODE cache).
 *
 * `BufferGeometry` has no `Object3D`-style parent/ownership signal to check (unlike the
 * node-cache fix's `.parent === null`), and confirmed directly against the installed
 * three.js source, `dispose()` sets no public flag on the geometry itself — it only
 * calls `this.dispatchEvent({type:'dispose'})` (`BufferGeometry extends EventDispatcher`).
 * That dispatched event IS the one reliable, three.js-driven signal available — the
 * same mechanism `WebGLRenderer`'s own internal `WebGLGeometries` uses to notice
 * disposal — so `create()` below attaches a listener that flips `entry.disposed` (a flag
 * THIS cache defines and owns, not a property invented on the geometry) the moment
 * disposal genuinely happens, from whichever caller triggered it. `update()` then checks
 * that flag before trusting a cache hit: a disposed entry is discarded and rebuilt fresh,
 * exactly mirroring the "cache miss" path that already runs correctly for a brand-new
 * link — no new code path, no behavior change for the (overwhelmingly common) case where
 * nothing was disposed.
 *
 * THIRD defect in this same seam — the digest-time radius race (Galaxy line-latch
 * H2 fix, 2026-10-21): the spoofed `parameters.radiusTop` is re-synced ONLY inside
 * `update()` below, from the width that call was handed. But `update()` is
 * deliberately NOT called every frame for every link — Graph3D's
 * `linkPositionUpdateCb` shard-skips far/still links for up to ~600 ms — while
 * three-forcegraph's digest (same `onUpdateObj` check quoted above) can run at
 * ANY React re-render, evaluating the width accessor FRESH. When a link's width
 * crosses a rounding bucket between its last `update()` and the next digest —
 * the ship's tending cycle does exactly this: `fireLink` jumps a link's
 * activity, and the pulse re-render it forces IS a digest — the digest finds
 * radiusTop ≠ the radius its own fresh width implies, disposes the tube, and
 * substitutes the shared straight cylinder, which for a tube-managed link sits
 * unpositioned at the world origin (invisible) until the link's next
 * position update re-assigns the tube. Bunches blink together because one
 * digest checks every link at once; each heals on its own shard schedule —
 * the owner's "lines vanish for ~1 s while the ship flies" report.
 *
 * The seam that closes it without touching the library: within `onUpdateObj`,
 * three-forcegraph evaluates `widthAccessor(link)` IMMEDIATELY BEFORE that
 * same link's radius comparison (verified in the installed source — the
 * accessor call and the `radiusTop !== r` check are consecutive statements in
 * one function). So if the width accessor itself re-syncs the cached radius
 * from the very width it is returning, the comparison that follows always
 * sees the current value. That is `syncDigestRadius()` below, called from
 * Graph3D's `linkWidthCb`. The digest's check is NOT disabled — it still runs
 * and would still swap for a width that never flowed through the accessor
 * (none exists) — and convergence is preserved: the tube's actual vertex
 * radius is recomputed from the current width on its next `update()`, in
 * place, on the same geometry object. Worst case after a width change is the
 * previous tube rendering until that update lands — never the origin
 * placeholder.
 */

// Matches three-forcegraph.mjs's hardcoded `curveResolution` (tubular segments
// along the curve) -- not exposed as a prop, so this must track that constant.
const TUBULAR_SEGMENTS = 30;
// Matches three-forcegraph's `linkResolution` prop DEFAULT (radial segments
// around the tube's cross-section). This app never sets `linkResolution` on
// <ForceGraph3D>, so the library default applies -- if that ever changes,
// this constant must change with it for visual parity.
export const RADIAL_SEGMENTS = 6;
const VERTS_PER_RING = RADIAL_SEGMENTS + 1;
const VERTEX_COUNT = (TUBULAR_SEGMENTS + 1) * VERTS_PER_RING;

/**
 * three-forcegraph's digest rounds `linkWidth` before computing the radius it compares
 * against (`Math.ceil(widthAccessor(link) * 10) / 10`, three-forcegraph.mjs's onUpdateObj).
 * Replicated here so the spoofed `geometry.parameters.radiusTop` set below matches EXACTLY
 * what that digest will compute from the same raw width — see the module doc's "CRITICAL"
 * section for why this match has to be exact.
 */
export function digestRoundedRadius(width: number): number {
  return Math.ceil(width * 10) / 10 / 2;
}

// This app never sets `linkCurveRotation`, so it's always three-forcegraph's
// default (0). A rotation of exactly 0 is the identity transform (cos 0 = 1,
// sin 0 = 0 exactly, in floating point too), so the control-point math below
// safely omits the (otherwise required) `applyAxisAngle` step three-forcegraph
// itself does -- not a visual approximation, an exact simplification for the
// fixed rotation value this app actually uses.
const UNIT_Z = new THREE.Vector3(0, 0, 1);
const UNIT_Y = new THREE.Vector3(0, 1, 0);

// Index and UV buffers depend only on (TUBULAR_SEGMENTS, RADIAL_SEGMENTS),
// which never vary in this app -- built once and shared (read-only) by every
// link's geometry, the same sharing precedent three-forcegraph's own
// `cylinderGeometries` cache already uses for straight-link geometries.
let sharedIndex: THREE.BufferAttribute | null = null;
let sharedUv: THREE.BufferAttribute | null = null;

function getSharedIndexAndUv(): { index: THREE.BufferAttribute; uv: THREE.BufferAttribute } {
  if (!sharedIndex || !sharedUv) {
    const indices: number[] = [];
    for (let j = 1; j <= TUBULAR_SEGMENTS; j++) {
      for (let i = 1; i <= RADIAL_SEGMENTS; i++) {
        const a = VERTS_PER_RING * (j - 1) + (i - 1);
        const b = VERTS_PER_RING * j + (i - 1);
        const c = VERTS_PER_RING * j + i;
        const d = VERTS_PER_RING * (j - 1) + i;
        indices.push(a, b, d, b, c, d);
      }
    }
    sharedIndex = new THREE.BufferAttribute(new Uint16Array(indices), 1);

    const uvs: number[] = [];
    for (let i = 0; i <= TUBULAR_SEGMENTS; i++) {
      for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
        uvs.push(i / TUBULAR_SEGMENTS, j / RADIAL_SEGMENTS);
      }
    }
    sharedUv = new THREE.BufferAttribute(new Float32Array(uvs), 2);
  }
  return { index: sharedIndex, uv: sharedUv };
}

interface LinkTubeEntry {
  geometry: THREE.BufferGeometry;
  positionAttr: THREE.BufferAttribute;
  normalAttr: THREE.BufferAttribute;
  curve: THREE.QuadraticBezierCurve3;
  vStart: THREE.Vector3;
  vEnd: THREE.Vector3;
  vLine: THREE.Vector3;
  mid: THREE.Vector3;
  cp: THREE.Vector3;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /**
   * Set true the moment `geometry.dispose()` actually fires (see `create()`'s listener
   * below) — the ONLY reliable, three.js-driven signal this cache has for "my GPU
   * resources are gone," since `BufferGeometry` (unlike `Object3D`) has no parent/
   * ownership concept to check and `.dispose()` itself sets no public flag on the
   * geometry (confirmed against the installed three.js source: `dispose()` only calls
   * `dispatchEvent({type:'dispose'})` — see the module doc's "Resource-lifecycle defect"
   * section). This is a flag WE maintain ourselves, driven by a REAL event dispatched by
   * three.js's own `EventDispatcher` base class (the same mechanism `WebGLRenderer`'s own
   * internal `WebGLGeometries` uses to notice disposal) — not an invented/guessed
   * property on the geometry itself.
   */
  disposed: boolean;
}

export interface LinkPositions {
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
}

/**
 * Per-Graph3D-instance cache. Construct one via `new CurvedLinkGeometryCache()`
 * (held in a `useRef`, matching this file's sibling caches' lifetime
 * convention) and pass `.update` as the `linkPositionUpdate` prop.
 */
export class CurvedLinkGeometryCache {
  private readonly cache = new WeakMap<object, LinkTubeEntry>();

  /**
   * Digest-time radius sync — the H2 blink fix (see the module doc's "THIRD
   * defect" section). Called from Graph3D's `linkWidthCb` with the exact
   * width that accessor is returning, so when three-forcegraph's `onUpdateObj`
   * digest — which evaluates the width accessor immediately before comparing
   * `geometry.parameters.radiusTop` against that same width's radius, in the
   * same call, for the same link — performs its check, the spoofed radius is
   * already current and the tube is never disposed/swapped for a width-bucket
   * change. No-ops by design where the digest's own paths own the outcome: an
   * uncached link (never tube-rendered — the digest's creation path assigns
   * its first geometry) and a disposed entry (`update()`'s rebuild path owns
   * resurrection; syncing a dead geometry's spoof would change nothing the
   * digest can observe on the live object).
   */
  syncDigestRadius(link: object, width: number): void {
    const entry = this.cache.get(link);
    if (!entry || entry.disposed) return;
    (entry.geometry as unknown as { parameters: { radiusTop: number } }).parameters.radiusTop =
      digestRoundedRadius(width);
  }

  private create(): LinkTubeEntry {
    const { index, uv } = getSharedIndexAndUv();
    const geometry = new THREE.BufferGeometry();
    const positionAttr = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT * 3), 3);
    const normalAttr = new THREE.BufferAttribute(new Float32Array(VERTEX_COUNT * 3), 3);
    geometry.setIndex(index);
    geometry.setAttribute("position", positionAttr);
    geometry.setAttribute("normal", normalAttr);
    geometry.setAttribute("uv", uv);
    // Spoof three-forcegraph's own digest-time compatibility check (see the module doc's
    // "CRITICAL" section) so it never disposes/reassigns this geometry. `radiusTop` is a
    // placeholder here — `update()` below keeps it in sync with the link's real width on
    // every frame, well before any digest can observe a stale value (see module doc).
    (geometry as { type: string }).type = "CylinderGeometry";
    (geometry as unknown as { parameters: { radiusTop: number; radialSegments: number } }).parameters = {
      radiusTop: 0,
      radialSegments: RADIAL_SEGMENTS,
    };
    const entry: LinkTubeEntry = {
      geometry,
      positionAttr,
      normalAttr,
      curve: new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()),
      vStart: new THREE.Vector3(),
      vEnd: new THREE.Vector3(),
      vLine: new THREE.Vector3(),
      mid: new THREE.Vector3(),
      cp: new THREE.Vector3(),
      point: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      disposed: false,
    };
    // The one reliable signal that this geometry's GPU resources are gone, wherever the
    // `.dispose()` call actually came from (our own code never disposes it, but
    // three-forcegraph's generic `_flushObjects` removal path does — see the module
    // doc's "SECOND resource-lifecycle defect" section). A real three.js event, not a
    // guess: `BufferGeometry.dispose()` unconditionally dispatches exactly this.
    geometry.addEventListener("dispose", () => {
      entry.disposed = true;
    });
    return entry;
  }

  /**
   * Mirrors three-forcegraph's `linkPositionUpdate(obj, {start,end}, link)` signature.
   * Returns `true` when it fully handled this link's position + geometry (three-
   * forcegraph then skips its own `calcLinkCurve()` + geometry-rebuild for it
   * entirely); returns `false` to fall back to the library's own handling for the
   * cases this cache deliberately doesn't specialize (see module doc).
   */
  update(obj: THREE.Object3D, pos: LinkPositions, link: object, width: number, curvature: number): boolean {
    if (!width || !curvature) return false; // let three-forcegraph handle these itself
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return false; // not tube-rendered (e.g. a thin Line for a culled/zero-width link)

    let entry = this.cache.get(link);
    // A cache hit whose geometry has actually been disposed (see the module doc's
    // "SECOND resource-lifecycle defect" section — three-forcegraph's own _flushObjects
    // removal path can dispose this exact shared geometry without this cache's
    // knowledge) must NOT be reused: discard the stale entry and build a genuinely
    // fresh one, exactly as if this were a brand-new link. Every scratch object (curve,
    // vectors, attribute arrays) is rebuilt too — cheap, and simpler/safer than trying
    // to partially resurrect a mix of valid and invalid state.
    if (entry?.disposed) {
      this.cache.delete(link);
      entry = undefined;
    }
    if (!entry) {
      entry = this.create();
      this.cache.set(link, entry);
    }
    // Idempotent, cheap reference reassignment: self-heals if three-forcegraph's
    // own separate object digest (onUpdateObj, keyed off linkColor/linkWidth prop
    // IDENTITY changing -- not this per-frame position loop) reassigned
    // mesh.geometry to a cached straight CylinderGeometry between frames (see
    // module doc). That digest and this loop always run in the same order within
    // one 3d-force-graph animation-cycle call (object digest during the React
    // commit that precedes the frame; this loop, then the actual render, inside
    // the next requestAnimationFrame) -- so a stray reassignment is corrected
    // here before anything is actually drawn, never visible on screen.
    mesh.geometry = entry.geometry;

    const { vStart, vEnd, vLine, mid, cp, curve, point, normal, positionAttr, normalAttr } = entry;
    vStart.set(pos.start.x, pos.start.y || 0, pos.start.z || 0);
    vEnd.set(pos.end.x, pos.end.y || 0, pos.end.z || 0);
    if (vStart.distanceTo(vEnd) === 0) return false; // coincident endpoints (self-loop) -- defer to the library

    // Exactly mirrors three-forcegraph's calcLinkCurve() control-point math
    // (linkCurveRotation is always 0 here -- see the UNIT_Z/UNIT_Y comment above
    // for why the rotation step is safely omitted).
    vLine.subVectors(vEnd, vStart);
    const dx = pos.end.x - pos.start.x;
    const dy = (pos.end.y || 0) - (pos.start.y || 0);
    mid.copy(vStart).add(vEnd).multiplyScalar(0.5);
    cp.copy(vLine)
      .multiplyScalar(curvature)
      .cross(dx !== 0 || dy !== 0 ? UNIT_Z : UNIT_Y)
      .add(mid);

    curve.v0.copy(vStart);
    curve.v1.copy(cp);
    curve.v2.copy(vEnd);
    // Required: the curve's arc-length cache (used by getPointAt/getTangentAt,
    // hence by computeFrenetFrames) is keyed only on division count, not on the
    // control points -- reusing the same curve object across frames means a
    // stale cache from the PREVIOUS frame's (different) curve shape would
    // silently persist without this, sampling the wrong distances along the
    // new curve. THREE.Curve's own docs require calling this after any control-
    // point change.
    curve.updateArcLengths();

    const radius = width / 2;
    // Keep the spoofed digest-compatibility check (see create()) in sync with the link's
    // CURRENT width every frame, using three-forcegraph's own rounding formula — this runs
    // far more often than the digest itself (an animation frame vs. a React render), so by
    // the time any digest checks it, the value is always current. See module doc.
    (entry.geometry as unknown as { parameters: { radiusTop: number } }).parameters.radiusTop =
      digestRoundedRadius(width);
    // Same call three-forcegraph's own TubeGeometry constructor makes (see
    // module doc for its unavoidable internal allocation cost).
    const frames = curve.computeFrenetFrames(TUBULAR_SEGMENTS, false);

    const posArr = positionAttr.array as Float32Array;
    const normArr = normalAttr.array as Float32Array;
    let vi = 0;
    for (let i = 0; i <= TUBULAR_SEGMENTS; i++) {
      curve.getPointAt(i / TUBULAR_SEGMENTS, point); // writes into `point`, no allocation
      const N = frames.normals[i]!;
      const B = frames.binormals[i]!;
      for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
        const v = (j / RADIAL_SEGMENTS) * Math.PI * 2;
        const sin = Math.sin(v);
        const cos = -Math.cos(v);
        normal.set(cos * N.x + sin * B.x, cos * N.y + sin * B.y, cos * N.z + sin * B.z).normalize();
        normArr[vi] = normal.x;
        normArr[vi + 1] = normal.y;
        normArr[vi + 2] = normal.z;
        posArr[vi] = point.x + radius * normal.x;
        posArr[vi + 1] = point.y + radius * normal.y;
        posArr[vi + 2] = point.z + radius * normal.z;
        vi += 3;
      }
    }
    positionAttr.needsUpdate = true;
    normalAttr.needsUpdate = true;
    // Required because this geometry is now REUSED (not replaced) across frames:
    // a cached boundingSphere computed once would go stale as vertices move,
    // risking incorrect frustum culling (a link silently vanishing). The
    // original per-frame-rebuild code never needed this -- a brand new geometry
    // starts with no cached sphere, so the renderer always computed it fresh.
    entry.geometry.computeBoundingSphere();

    return true;
  }
}
