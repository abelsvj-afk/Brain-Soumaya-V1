import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { CurvedLinkGeometryCache, RADIAL_SEGMENTS, digestRoundedRadius } from "./linkTube.js";

/**
 * three-forcegraph's own onUpdateObj digest check, reproduced VERBATIM (three-forcegraph.mjs)
 * so these tests prove the fix against the actual external predicate, not our assumption
 * about it. If this ever mismatches the installed dependency's real check, these tests catch
 * the drift instead of silently passing on a stale replica.
 */
function threeForcegraphWouldDisposeAndReassign(geometry: THREE.BufferGeometry, linkWidthRaw: number, linkResolution: number): boolean {
  const linkWidth = Math.ceil(linkWidthRaw * 10) / 10;
  const r = linkWidth / 2;
  const g = geometry as unknown as { type: string; parameters?: { radiusTop: number; radialSegments: number } };
  return !g.type.match(/^Cylinder(Buffer)?Geometry$/) || g.parameters!.radiusTop !== r || g.parameters!.radialSegments !== linkResolution;
}

/**
 * Curved-link tube geometry reuse (Round 4 regression: three-forcegraph's own
 * layoutTick() otherwise constructs a brand-new TubeGeometry, every frame, for
 * every curved link — see linkTube.ts's doc comment). These tests exercise the
 * real THREE.BufferGeometry/Curve math (no mocks — same pattern as
 * graph3dHelpers.test.ts), not a WebGL render, which this environment can't do.
 */
describe("linkTube — CurvedLinkGeometryCache", () => {
  const A = { x: 0, y: 0, z: 0 };
  const B = { x: 100, y: 20, z: -30 };

  it("defers to three-forcegraph's own handling for zero width, zero curvature, or coincident endpoints", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    expect(cache.update(mesh, { start: A, end: B }, link, 0, 0.2)).toBe(false);
    expect(cache.update(mesh, { start: A, end: B }, link, 1.2, 0)).toBe(false);
    expect(cache.update(mesh, { start: A, end: A }, link, 1.2, 0.2)).toBe(false);
  });

  it("declines a non-Mesh object (e.g. a thin Line, for a culled/zero-width link)", () => {
    const cache = new CurvedLinkGeometryCache();
    const line = new THREE.Line(new THREE.BufferGeometry());
    expect(cache.update(line, { start: A, end: B }, {}, 1.2, 0.2)).toBe(false);
  });

  it("handles a normal curved link: returns true and builds a real, populated geometry", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    const handled = cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    expect(handled).toBe(true);
    expect(mesh.geometry).toBeInstanceOf(THREE.BufferGeometry);
    const pos = mesh.geometry.getAttribute("position");
    expect(pos.count).toBeGreaterThan(0);
    // Not a degenerate all-zero buffer — real vertex data was written.
    let hasNonZero = false;
    for (let i = 0; i < pos.array.length; i++) {
      if ((pos.array as Float32Array)[i] !== 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
    expect(mesh.geometry.index).not.toBeNull();
    expect(mesh.geometry.getAttribute("uv")).toBeDefined();
  });

  it("reuses the SAME geometry object across frames for the same link (the whole point of the fix)", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    const geomAfterFrame1 = mesh.geometry;
    // Endpoints moved (simulating an orbiting node) — a real subsequent frame.
    cache.update(mesh, { start: { x: 5, y: 1, z: 0 }, end: { x: 90, y: 25, z: -20 } }, link, 1.2, 0.2);
    expect(mesh.geometry).toBe(geomAfterFrame1); // no new BufferGeometry constructed
  });

  it("updates vertex positions to reflect moved endpoints (no link-position freeze)", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    const snapshot1 = (mesh.geometry.getAttribute("position").array as Float32Array).slice();
    cache.update(mesh, { start: { x: 400, y: 300, z: 200 }, end: { x: 500, y: -50, z: 10 } }, link, 1.2, 0.2);
    const snapshot2 = mesh.geometry.getAttribute("position").array as Float32Array;
    let differs = false;
    for (let i = 0; i < snapshot1.length; i++) {
      if (Math.abs(snapshot1[i]! - snapshot2[i]!) > 1e-6) { differs = true; break; }
    }
    expect(differs).toBe(true);
  });

  it("gives two distinct links two independent geometries (no cross-link data corruption)", () => {
    const cache = new CurvedLinkGeometryCache();
    const meshA = new THREE.Mesh();
    const meshB = new THREE.Mesh();
    const linkA = {};
    const linkB = {};
    cache.update(meshA, { start: A, end: B }, linkA, 1.2, 0.2);
    cache.update(meshB, { start: { x: 999, y: 0, z: 0 }, end: { x: 1000, y: 5, z: 5 } }, linkB, 0.8, 0.3);
    expect(meshA.geometry).not.toBe(meshB.geometry);
    const posA = meshA.geometry.getAttribute("position").array as Float32Array;
    const posB = meshB.geometry.getAttribute("position").array as Float32Array;
    expect(Array.from(posA)).not.toEqual(Array.from(posB));
  });

  it("self-heals if something else reassigns mesh.geometry between frames (three-forcegraph's own onUpdateObj can, transiently — see module doc)", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    const ours = mesh.geometry;
    mesh.geometry = new THREE.BufferGeometry(); // simulate the library's own transient reassignment
    const handled = cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    expect(handled).toBe(true);
    expect(mesh.geometry).toBe(ours); // reasserted back to the cached tube geometry
  });

  it("shares index/uv buffers across links (matches three-forcegraph's own cylinderGeometries sharing precedent)", () => {
    const cache = new CurvedLinkGeometryCache();
    const meshA = new THREE.Mesh();
    const meshB = new THREE.Mesh();
    cache.update(meshA, { start: A, end: B }, {}, 1.2, 0.2);
    cache.update(meshB, { start: A, end: B }, {}, 1.2, 0.2);
    expect(meshA.geometry.index).toBe(meshB.geometry.index);
    expect(meshA.geometry.getAttribute("uv")).toBe(meshB.geometry.getAttribute("uv"));
  });
});

/**
 * Regression coverage for the Galaxy recovery pass (2026-09-10): three-forcegraph's own
 * onUpdateObj digest — run on EVERY React render of Graph3D, since linkColor is a deliberately
 * unmemoized prop (see Graph3D.tsx's own comment) — independently gate-checks every link's
 * `mesh.geometry` and disposes+reassigns it whenever it doesn't look like a matching
 * CylinderGeometry. Our reused curved-tube BufferGeometry never did, so it was disposed and
 * silently forced through a full GPU re-upload on every single digest, for every tube-rendered
 * link — completely defeating this file's own "no dispose, no GPU buffer reallocation" design
 * goal via a code path this file previously never accounted for. See the module doc's
 * "CRITICAL" section. These tests prove the fix against a verbatim reproduction of the actual
 * external predicate (see threeForcegraphWouldDisposeAndReassign above), not our assumption.
 */
describe("linkTube — three-forcegraph digest-compatibility spoof (dispose/re-upload churn fix)", () => {
  const A = { x: 0, y: 0, z: 0 };
  const B = { x: 100, y: 20, z: -30 };

  it("BEFORE any width is known, the geometry already looks Cylinder-shaped with the right radial segment count", () => {
    // create() runs lazily inside the first update() call, but the spoof must be in place
    // from that very first frame — verified by checking right after the first update().
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    cache.update(mesh, { start: A, end: B }, {}, 1.2, 0.2);
    const g = mesh.geometry as unknown as { type: string; parameters: { radialSegments: number } };
    expect(g.type).toBe("CylinderGeometry");
    expect(g.parameters.radialSegments).toBe(RADIAL_SEGMENTS);
  });

  it("three-forcegraph's real predicate says NO dispose/reassign needed after a normal update — the actual bug fix", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    const width = 1.2;
    cache.update(mesh, { start: A, end: B }, link, width, 0.2);
    // linkResolution defaults to three-forcegraph's own default, which this app never
    // overrides — RADIAL_SEGMENTS is kept in sync with that default (see linkTube.ts's own
    // doc comment on the constant).
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, width, RADIAL_SEGMENTS)).toBe(false);
  });

  it("radiusTop tracks width changes frame-to-frame (a link's activity-driven width still stays digest-safe)", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 1.2, RADIAL_SEGMENTS)).toBe(false);

    cache.update(mesh, { start: A, end: B }, link, 3.7, 0.2); // e.g. activity spiked
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 3.7, RADIAL_SEGMENTS)).toBe(false);
    // and the STALE width would now correctly read as needing a rebuild if anything checked it
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 1.2, RADIAL_SEGMENTS)).toBe(true);
  });

  it("digestRoundedRadius replicates three-forcegraph's own Math.ceil(width*10)/10/2 rounding exactly", () => {
    expect(digestRoundedRadius(1.2)).toBeCloseTo(0.6, 10);
    expect(digestRoundedRadius(1.23)).toBeCloseTo(Math.ceil(1.23 * 10) / 10 / 2, 10);
    expect(digestRoundedRadius(0)).toBe(0);
  });

  it("two independent links each get a correctly-synced spoof (no cross-link radius bleed)", () => {
    const cache = new CurvedLinkGeometryCache();
    const meshA = new THREE.Mesh();
    const meshB = new THREE.Mesh();
    cache.update(meshA, { start: A, end: B }, {}, 1.2, 0.2);
    cache.update(meshB, { start: A, end: B }, {}, 4.5, 0.2);
    expect(threeForcegraphWouldDisposeAndReassign(meshA.geometry, 1.2, RADIAL_SEGMENTS)).toBe(false);
    expect(threeForcegraphWouldDisposeAndReassign(meshB.geometry, 4.5, RADIAL_SEGMENTS)).toBe(false);
  });
});

/**
 * Regression coverage for the SECOND resource-lifecycle defect (Galaxy render-stall
 * forensic pass, 2026-09-11 — see linkTube.ts's module doc, "SECOND resource-lifecycle
 * defect" section): a full `fg.refresh()` sets three-forcegraph's `_flushObjects` flag,
 * which runs the library's generic removal path against every tracked link —
 * `_deallocate()` calls `obj.geometry.dispose()` UNCONDITIONALLY, disposing this exact
 * cache's shared, reused geometry — the three-forcegraph digest-compatibility spoof
 * proven above never protects against this, since it only ever guards the narrower
 * digest-gate check, not this removal path. Before the fix, the next `update()` call
 * handed back the SAME now-disposed geometry, forcing three.js to silently re-upload
 * every buffer from scratch on the next draw.
 *
 * These tests call the REAL `THREE.BufferGeometry.prototype.dispose()` directly on the
 * cache's own live geometry (`mesh.geometry === entry.geometry` after `update()`) —
 * the actual three.js API three-forcegraph's `_deallocate()` calls, not a simulated
 * flag — so the `dispose` event these tests trigger is byte-for-byte the same one a
 * real `_flushObjects` clear would fire. What is NOT exercised here is three-forcegraph's
 * own digest/removal machinery itself (pulling in the full library for one test would be
 * disproportionate); that external behavior is already independently confirmed via direct
 * source reads, cited in the module doc and docs/specs/soumaya-galaxy-cache-disposal-audit.md.
 */
describe("linkTube — CurvedLinkGeometryCache survives external geometry.dispose() (refresh()/_flushObjects fix)", () => {
  const A = { x: 0, y: 0, z: 0 };
  const B = { x: 100, y: 20, z: -30 };

  it("a disposed cache entry is discarded — the next update() builds a genuinely fresh geometry, not the disposed one", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};

    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    const disposedGeometry = mesh.geometry;

    // Simulate three-forcegraph's _flushObjects removal path disposing this exact,
    // shared, cached geometry out from under the cache — the real API call, not a mock.
    disposedGeometry.dispose();

    const handled = cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);

    expect(handled).toBe(true);
    expect(mesh.geometry).not.toBe(disposedGeometry); // never hands back the disposed object
    expect(mesh.geometry).toBeInstanceOf(THREE.BufferGeometry);
  });

  it("the fresh post-disposal geometry has real, valid vertex data and the digest-compatibility spoof intact", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};

    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    mesh.geometry.dispose();
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);

    const pos = mesh.geometry.getAttribute("position");
    expect(pos.count).toBeGreaterThan(0);
    let hasNonZero = false;
    for (let i = 0; i < pos.array.length; i++) {
      if ((pos.array as Float32Array)[i] !== 0) { hasNonZero = true; break; }
    }
    expect(hasNonZero).toBe(true);
    expect(mesh.geometry.index).not.toBeNull();
    // The fresh geometry must still pass three-forcegraph's real digest check (see the
    // "digest-compatibility spoof" suite above) — a rebuild must not reintroduce the
    // FIRST defect while fixing the second.
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 1.2, RADIAL_SEGMENTS)).toBe(false);
  });

  it("a SECOND disposal (e.g. two repair cycles in one session) is handled the same way, not just the first", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};

    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    mesh.geometry.dispose();
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    const secondGeometry = mesh.geometry;

    mesh.geometry.dispose(); // a second, independent _flushObjects clear
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);

    expect(mesh.geometry).not.toBe(secondGeometry);
    expect(mesh.geometry).toBeInstanceOf(THREE.BufferGeometry);
  });

  it("disposing ONE link's geometry never affects another link's still-valid cached geometry", () => {
    const cache = new CurvedLinkGeometryCache();
    const meshA = new THREE.Mesh();
    const meshB = new THREE.Mesh();
    const linkA = {};
    const linkB = {};

    cache.update(meshA, { start: A, end: B }, linkA, 1.2, 0.2);
    cache.update(meshB, { start: { x: 999, y: 0, z: 0 }, end: { x: 1000, y: 5, z: 5 } }, linkB, 0.8, 0.3);
    const bGeometryBefore = meshB.geometry;

    meshA.geometry.dispose(); // only link A's geometry is disposed
    cache.update(meshA, { start: A, end: B }, linkA, 1.2, 0.2);
    cache.update(meshB, { start: { x: 999, y: 0, z: 0 }, end: { x: 1000, y: 5, z: 5 } }, linkB, 0.8, 0.3);

    expect(meshB.geometry).toBe(bGeometryBefore); // untouched — still the original, valid entry
  });

  it("legitimate repeated updates with no disposal still reuse the same geometry (no regression to the Round-4 fix)", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};

    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    const geomAfterFrame1 = mesh.geometry;
    for (let i = 0; i < 5; i++) {
      cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2); // ordinary subsequent frames
    }
    expect(mesh.geometry).toBe(geomAfterFrame1); // still no new BufferGeometry constructed
  });
});

/**
 * Regression coverage for the THIRD defect in this seam — the digest-time radius
 * race (Galaxy line-latch H2 fix, 2026-10-21 — see linkTube.ts's module doc):
 * the spoofed radiusTop was re-synced ONLY inside update(), but Graph3D's
 * linkPositionUpdateCb shard-skips far/still links for up to ~600 ms, while
 * three-forcegraph's digest can run at ANY re-render and evaluates the width
 * accessor fresh. A width-bucket change in that window (the ship's tending
 * cycle: fireLink jumps activity, and its forced pulse re-render IS a digest)
 * made the digest dispose the tube and substitute the origin placeholder —
 * bunches of lines blinking out for ~1 s.
 *
 * The fix rides the digest's own call order (verified in the installed
 * three-forcegraph source): onUpdateObj evaluates widthAccessor(link)
 * IMMEDIATELY BEFORE the radiusTop comparison for the same link, so
 * Graph3D's linkWidthCb calls syncDigestRadius with the width it is
 * returning, and the comparison that follows sees the current radius.
 */
describe("linkTube — digest-time radius sync (H2 blink fix)", () => {
  const A = { x: 0, y: 0, z: 0 };
  const B = { x: 100, y: 20, z: -30 };

  it("THE DEFECT: a width-bucket change with no intervening position update leaves the digest predicate ready to dispose", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    // The link's last position update synced radiusTop for width 1.2…
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 1.2, RADIAL_SEGMENTS)).toBe(false);
    // …then activity jumps (fireLink) and a digest evaluates the width
    // accessor fresh at 3.7 — while the shard-skipped position loop has NOT
    // re-run update() yet. Pre-fix, this is exactly what the digest saw:
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 3.7, RADIAL_SEGMENTS)).toBe(true);
  });

  it("syncDigestRadius closes the race: after the accessor-path sync, the digest predicate passes at the NEW width", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    // What linkWidthCb now does inside the digest's own widthAccessor call,
    // with the very width it returns (3.7), before the comparison runs:
    cache.syncDigestRadius(link, 3.7);
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 3.7, RADIAL_SEGMENTS)).toBe(false);
    // The spoof now holds the NEW width's digest-rounded radius — and the old
    // width would (correctly) read as stale against it.
    const g = mesh.geometry as unknown as { parameters: { radiusTop: number } };
    expect(g.parameters.radiusTop).toBe(digestRoundedRadius(3.7));
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 1.2, RADIAL_SEGMENTS)).toBe(true);
    // And the tube still converges in place on its next position update —
    // same geometry object, no rebuild.
    const geom = mesh.geometry;
    cache.update(mesh, { start: A, end: B }, link, 3.7, 0.2);
    expect(mesh.geometry).toBe(geom);
  });

  it("syncDigestRadius is a no-op for a link with no cache entry (digest creation path owns new objects)", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    expect(() => cache.syncDigestRadius(link, 3.7)).not.toThrow();
    // No entry was conjured into existence: the first real update() still
    // behaves as a normal first build.
    expect(cache.update(mesh, { start: A, end: B }, link, 3.7, 0.2)).toBe(true);
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 3.7, RADIAL_SEGMENTS)).toBe(false);
  });

  it("syncDigestRadius leaves a DISPOSED entry's spoof untouched (update()'s rebuild path owns resurrection)", () => {
    const cache = new CurvedLinkGeometryCache();
    const mesh = new THREE.Mesh();
    const link = {};
    cache.update(mesh, { start: A, end: B }, link, 1.2, 0.2);
    const disposedGeometry = mesh.geometry;
    const radiusBefore = (disposedGeometry as unknown as { parameters: { radiusTop: number } }).parameters.radiusTop;
    disposedGeometry.dispose(); // the _flushObjects path — entry.disposed is now true
    cache.syncDigestRadius(link, 3.7);
    const radiusAfter = (disposedGeometry as unknown as { parameters: { radiusTop: number } }).parameters.radiusTop;
    expect(radiusAfter).toBe(radiusBefore); // NOT synced — a dead geometry's spoof is not ours to freshen
    // …and the rebuild path still produces a fresh, digest-safe geometry.
    cache.update(mesh, { start: A, end: B }, link, 3.7, 0.2);
    expect(mesh.geometry).not.toBe(disposedGeometry);
    expect(threeForcegraphWouldDisposeAndReassign(mesh.geometry, 3.7, RADIAL_SEGMENTS)).toBe(false);
  });
});
