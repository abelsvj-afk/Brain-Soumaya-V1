import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  RELIC_ANCHORS,
  RELIC_DISPLAY_SIZE,
  fitRelicToAnchor,
  relicGlowTexture,
} from "./relicAssets.js";
import { RELICS, RELIC_ANCHOR_POINTS, discoverableRelics } from "@brain/shared";
import { DEEP_PAST_BASIN_Y } from "./deepPastLayout.js";
import { GARDEN_TERRACE_HEIGHT, GARDEN_TERRACE_COUNT } from "./gardenLayout.js";
import { PEOPLE_FIELD_RADIUS } from "./peopleLayout.js";
import { STATION_WHEEL_RADIUS } from "./stationLayout.js";

describe("relic anchors", () => {
  it("every discoverable relic has an anchor at the display size", () => {
    const found = discoverableRelics();
    expect(found).toHaveLength(10);
    for (const r of found) {
      const anchor = RELIC_ANCHORS[r.id];
      expect(anchor, r.id).toBeDefined();
      expect(anchor!.size).toBe(RELIC_DISPLAY_SIZE);
      for (const v of anchor!.position) {
        expect(Number.isFinite(v), `${r.id} position`).toBe(true);
      }
    }
  });

  it("Station relics sit on the harbor, clear of the hero's mooring", () => {
    const nail = RELIC_ANCHORS["harbor-nail"]!;
    // On the wheel rim (radius 210), above its top (≈ 26).
    expect(Math.hypot(nail.position[0], nail.position[2])).toBeCloseTo(
      STATION_WHEEL_RADIUS,
      0,
    );
    expect(nail.position[1]).toBeGreaterThan(26);
    const ring = RELIC_ANCHORS["mooring-ring"]!;
    const ringR = Math.hypot(ring.position[0], ring.position[2]);
    expect(ringR).toBeGreaterThanOrEqual(220);
    expect(ringR).toBeLessThanOrEqual(250);
    // Clear of the hero ship moored at (228, 0, 0).
    expect(Math.hypot(ring.position[0] - 228, ring.position[2])).toBeGreaterThan(40);
  });

  it("garden relics sit on the crown disc, clear of the trunk", () => {
    const topY = GARDEN_TERRACE_HEIGHT[GARDEN_TERRACE_COUNT - 1]!;
    for (const id of ["dawn-leaf", "witness-seed"]) {
      const a = RELIC_ANCHORS[id]!;
      expect(Math.hypot(a.position[0], a.position[2])).toBeLessThan(60);
      expect(a.position[1]).toBeGreaterThan(topY);
    }
    // The seed rests just outside the trunk base (radius 22).
    const seed = RELIC_ANCHORS["witness-seed"]!;
    expect(Math.hypot(seed.position[0], seed.position[2])).toBeGreaterThan(22);
  });

  it("Deep Past relics sit on the basin floor or the lowest alcoves", () => {
    for (const id of ["first-light-shard", "basin-stone", "witness-without-a-name"]) {
      const a = RELIC_ANCHORS[id]!;
      expect(Math.hypot(a.position[0], a.position[2])).toBeLessThan(320);
      expect(a.position[1]).toBeGreaterThan(DEEP_PAST_BASIN_Y);
    }
    // The Witness rests at the basin's center, in the First Light.
    const witness = RELIC_ANCHORS["witness-without-a-name"]!;
    expect(witness.position[0]).toBe(0);
    expect(witness.position[2]).toBe(0);
    // The Lantern rests in the lowest stratum's alcove band (radius 250–285, y −712).
    const lantern = RELIC_ANCHORS["lantern-of-keeping"]!;
    const r = Math.hypot(lantern.position[0], lantern.position[2]);
    expect(r).toBeGreaterThanOrEqual(250);
    expect(r).toBeLessThanOrEqual(285);
    expect(lantern.position[1]).toBe(-712);
  });

  it("People relics sit at the field's heart and edge, clear of every hearth", () => {
    // Clusters rest at radius 90–510 with lights orbiting to 30, so the
    // farthest a cluster's light ever reaches is 540 from the field's
    // heart; the dressing ships circle at 620+. The Ember at the heart
    // and the Thread at the edge (570) are clear of both, and neither is
    // tied to any one person's cluster.
    const ember = RELIC_ANCHORS["hearth-ember"]!;
    expect(ember.position[0]).toBe(0);
    expect(ember.position[2]).toBe(0);
    expect(ember.position[1]).toBeGreaterThan(0);
    const thread = RELIC_ANCHORS["thread-of-many"]!;
    const threadR = Math.hypot(thread.position[0], thread.position[2]);
    expect(threadR).toBe(PEOPLE_FIELD_RADIUS + 10);
    // Clear of the farthest cluster light (540 + the relic's own glow
    // half-width 22) and inside the dressing ships' innermost lane (620).
    expect(threadR - 22).toBeGreaterThan(540);
    expect(threadR + 22).toBeLessThan(620);
    expect(thread.position[1]).toBeGreaterThan(0);
  });
});

describe("shared anchor points parity (I-1)", () => {
  it("the server's anchor points agree with the scene anchors, per anchor", () => {
    // One truth, two readers (implementation design §3.2): the scene
    // derives placement from the world layout constants; the shared
    // registry carries the evaluated facts for the server. If either
    // side changes alone, this test fails — the two cannot drift.
    for (const def of RELICS) {
      const shared = RELIC_ANCHOR_POINTS[def.id];
      expect(shared, def.id).toBeDefined();
      const scene = RELIC_ANCHORS[def.id];
      if (!scene) {
        // Unplaced on the scene side = empty set on the server side.
        expect(shared, def.id).toEqual([]);
        continue;
      }
      expect(shared, def.id).toHaveLength(1);
      expect([...shared![0]!.position]).toEqual([...scene.position]);
      expect(shared![0]!.world).toBe(def.world);
    }
    // And no scene anchor exists for a relic the registry doesn't know.
    for (const id of Object.keys(RELIC_ANCHORS)) {
      expect(RELIC_ANCHOR_POINTS[id]?.length, id).toBe(1);
    }
  });
});

describe("fitRelicToAnchor", () => {
  it("scales the longest side to the display size and centers the model", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 2));
    const scale = fitRelicToAnchor(mesh, 22);
    expect(scale).toBeCloseTo(2.2, 6);
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(22, 6);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 6);
    expect(center.y).toBeCloseTo(0, 6);
    expect(center.z).toBeCloseTo(0, 6);
  });

  it("scales on the longest axis, whichever it is", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 9));
    const scale = fitRelicToAnchor(mesh, 18);
    expect(scale).toBeCloseTo(2, 6);
  });

  it("leaves an unmeasurable model alone instead of dropping it", () => {
    const empty = new THREE.Group();
    expect(fitRelicToAnchor(empty, 22)).toBe(1);
  });
});

describe("relic glow texture", () => {
  it("builds a warm radial glow without a canvas", () => {
    const tex = relicGlowTexture();
    const data = tex.image.data;
    expect(data).not.toBeNull();
    expect(data!.length).toBe(64 * 64 * 4);
    // Center pixel is warm and opaque; corner pixel is transparent.
    const center = 32 * 64 * 4 + 32 * 4;
    expect(data![center]).toBe(255);
    expect(data![center + 3]).toBeGreaterThan(200);
    expect(data![3]).toBe(0);
    expect(relicGlowTexture()).toBe(tex);
  });
});
