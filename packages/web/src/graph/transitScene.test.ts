import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  ALIGN_FRACTION,
  ALIGN_START_YAW,
  BASE_FOV,
  createTransitScene,
  flightDistance,
  flightSpeed,
  TRANSIT_BUDGET,
  TRANSIT_STREAK_COUNT,
  transitTimeline,
  WARP_FOV_KICK,
} from "./transitScene.js";

function find(group: THREE.Group, name: string): THREE.Object3D | undefined {
  let found: THREE.Object3D | undefined;
  group.traverse((o) => {
    if (o.name === name) found = o;
  });
  return found;
}

function countMeshes(group: THREE.Group): number {
  let n = 0;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.InstancedMesh).isInstancedMesh) n++;
  });
  return n;
}

describe("createTransitScene", () => {
  it("warp renders ship + two gates + HYG sky + streaks, inside budget", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    expect(find(scene.group, "transit-ship")).toBeTruthy();
    expect(find(scene.group, "gate-home")).toBeTruthy();
    expect(find(scene.group, "gate-great-station")).toBeTruthy();
    expect(find(scene.group, "transit-streaks")).toBeTruthy();
    expect((find(scene.group, "transit-streaks") as THREE.InstancedMesh).count).toBe(
      TRANSIT_STREAK_COUNT,
    );
    // Sky 1 · ship 10 (her GLB) · gates 6 · streaks 1 = 18 draw
    // calls, ceiling 40. The procedural fallback is 4 meshes, so
    // the synchronous count is 12 — the sketch budgets the hero.
    expect(countMeshes(scene.group)).toBeLessThanOrEqual(TRANSIT_BUDGET.maxDrawCalls);
    scene.dispose();
  });

  it("the transit-ship holder carries the procedural fallback until her ship lands", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    const holder = find(scene.group, "transit-ship") as THREE.Group;
    expect(holder).toBeTruthy();
    expect(find(holder, "transit-ship-procedural")).toBeTruthy();
    scene.dispose();
  });

  it("drift has no visible streaks and a steady ship", () => {
    const scene = createTransitScene({
      kind: "drift",
      totalMs: 45_000,
      origin: "great-station",
      destination: "growing-place",
    });
    const streaks = find(scene.group, "transit-streaks") as THREE.InstancedMesh;
    expect(streaks.visible).toBe(false);
    const ship = find(scene.group, "transit-ship") as THREE.Group;
    scene.update(20_000);
    expect(ship.position.y).toBe(0);
    scene.dispose();
  });

  it("the arrival gate approaches and the departure gate recedes as the trip progresses", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    const arrival = find(scene.group, "gate-great-station") as THREE.Group;
    const departure = find(scene.group, "gate-home") as THREE.Group;
    scene.update(0);
    const arrivalStart = arrival.position.z;
    const departureStart = departure.position.z;
    scene.update(11_500);
    expect(arrival.position.z).toBeGreaterThan(arrivalStart);
    expect(departure.position.z).toBeGreaterThan(departureStart);
    // At the end the arrival gate is just ahead, not passed.
    expect(arrival.position.z).toBeLessThan(0);
    expect(arrival.position.z).toBeGreaterThan(-100);
    scene.dispose();
  });

  it("reduced motion: no streaks, no bobbing, but the gates still travel", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    const ship = find(scene.group, "transit-ship") as THREE.Group;
    const arrival = find(scene.group, "gate-great-station") as THREE.Group;
    scene.update(6_000, { reducedMotion: true });
    expect(ship.position.y).toBe(0);
    expect(ship.rotation.z).toBe(0);
    expect(arrival.position.z).toBeGreaterThan(-1100);
    scene.dispose();
  });

  it("progress clamps at arrival — the scene never overshoots the gate", () => {
    const scene = createTransitScene({
      kind: "warp",
      totalMs: 12_000,
      origin: "home",
      destination: "great-station",
    });
    const arrival = find(scene.group, "gate-great-station") as THREE.Group;
    scene.update(60_000);
    expect(arrival.position.z).toBeCloseTo(-20, 5);
    scene.dispose();
  });

  it("update after dispose is a no-op and dispose is safe twice", () => {
    const scene = createTransitScene({
      kind: "drift",
      totalMs: 45_000,
      origin: "home",
      destination: "growing-place",
    });
    expect(() => {
      scene.dispose();
      scene.dispose();
      scene.update(1_000);
    }).not.toThrow();
  });
});

describe("EVE-style departure timeline (docs/specs/eve-travel-2026-10-29.md)", () => {
  const warp = { kind: "warp" as const, totalMs: 12_000, armMs: 10_000 };
  const drift = { kind: "drift" as const, totalMs: 45_000, armMs: 10_000 };

  it("ALIGN: the ship starts turned away and eases round to face the destination, never jumping", () => {
    expect(transitTimeline(0, warp).yaw).toBeCloseTo(ALIGN_START_YAW, 6);
    expect(transitTimeline(0, warp).phase).toBe("align");
    let prev = transitTimeline(0, warp).yaw;
    for (let t = 250; t <= 6000; t += 250) {
      const y = transitTimeline(t, warp).yaw;
      expect(y).toBeLessThanOrEqual(prev + 1e-9); // monotonic
      expect(prev - y).toBeLessThan(0.3); // smooth, no snap
      prev = y;
    }
    expect(transitTimeline(10_000 * ALIGN_FRACTION, warp).yaw).toBeCloseTo(0, 6);
  });

  it("SPOOL: a countdown, engines heat from idle to full, the camera gathers", () => {
    const align = transitTimeline(3000, warp);
    expect(align.engine).toBeCloseTo(0.12, 6);
    const early = transitTimeline(6500, warp);
    const late = transitTimeline(9900, warp);
    expect(early.phase).toBe("spool");
    expect(late.engine).toBeGreaterThan(early.engine);
    expect(late.engine).toBeGreaterThan(0.95);
    expect(late.fov).toBeLessThan(early.fov);
    expect(late.fov).toBeLessThan(BASE_FOV);
    expect(late.shake).toBeGreaterThan(early.shake);
    // Whole seconds left in the window, counting down to 1 — never 0 while arming.
    expect(transitTimeline(0, warp).countdown).toBe(10);
    expect(transitTimeline(9001, warp).countdown).toBe(1);
    expect(transitTimeline(10_000, warp).countdown).toBeNull();
  });

  it("JUMP: a white flash, speed ramps up from standstill, the FOV kicks, engines at full", () => {
    const at = (f: number) => transitTimeline(10_000 + f, warp);
    expect(at(0).flash).toBe(1);
    expect(at(0).speed).toBe(0);
    expect(at(0).phase).toBe("jump");
    expect(at(300).flash).toBeLessThan(at(0).flash);
    expect(at(600).flash).toBe(0);
    expect(at(600).speed).toBeGreaterThan(at(100).speed);
    expect(at(6000).speed).toBe(1);
    expect(at(6000).phase).toBe("cruise");
    expect(at(6000).fov).toBeCloseTo(BASE_FOV + WARP_FOV_KICK, 6);
    expect(at(6000).blur).toBeGreaterThan(0.8);
    expect(at(6000).engine).toBe(1);
  });

  it("ARRIVE: speed, FOV and blur settle back to calm before the world appears", () => {
    const at = (f: number) => transitTimeline(10_000 + f, warp);
    expect(at(11_000).phase).toBe("arrive");
    expect(at(11_900).speed).toBeLessThan(at(10_600).speed);
    expect(at(12_000).speed).toBe(0);
    expect(at(12_000).fov).toBeCloseTo(BASE_FOV, 6);
    expect(at(12_000).blur).toBe(0);
    // The engines cool as the ship slows: red at cruise, idle again by arrival.
    expect(at(6000).engine).toBe(1);
    expect(at(11_900).engine).toBeLessThan(at(11_000).engine);
    expect(at(12_000).engine).toBeCloseTo(0.12, 6);
  });

  it("drift keeps the align/spool but stays calm: no flash, no blur, no FOV kick, engines only warm", () => {
    for (const f of [0, 2000, 20_000, 44_000]) {
      const v = transitTimeline(10_000 + f, drift);
      expect(v.flash).toBe(0);
      expect(v.blur).toBe(0);
      expect(v.fov).toBe(BASE_FOV);
      expect(v.engine).toBeLessThan(1);
    }
    expect(transitTimeline(8000, drift).engine).toBeGreaterThan(0.5); // the spool is still there
  });

  it("reduced motion: the same sequence in the same time with the motion removed — no sweep, shake, FOV change, flash or blur; the engine ramp (information) stays", () => {
    for (const t of [0, 5000, 9900, 10_000, 14_000, 21_500]) {
      const v = transitTimeline(t, { ...warp, reducedMotion: true });
      expect(v.yaw).toBe(0);
      expect(v.shake).toBe(0);
      expect(v.fov).toBe(BASE_FOV);
      expect(v.flash).toBe(0);
      expect(v.blur).toBe(0);
    }
    expect(transitTimeline(9900, { ...warp, reducedMotion: true }).engine).toBeGreaterThan(0.95);
    expect(transitTimeline(9900, { ...warp, reducedMotion: true }).countdown).toBe(1);
  });

  it("flight speed and distance are pure, bounded, and monotonic", () => {
    expect(flightSpeed(-5, "warp", 12_000)).toBe(0);
    expect(flightSpeed(12_000, "warp", 12_000)).toBe(0);
    let prev = -1;
    for (let f = 0; f <= 12_000; f += 500) {
      const d = flightDistance(f, "warp", 12_000);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    expect(flightDistance(99_999, "warp", 12_000)).toBeCloseTo(flightDistance(12_000, "warp", 12_000), 6);
  });

  it("the scene applies it: the ship turns, the engine glow heats toward red, streaks only appear after the jump", () => {
    const scene = createTransitScene({ kind: "warp", totalMs: 12_000, origin: "home", destination: "great-station", armMs: 10_000 });
    const ship = find(scene.group, "transit-ship") as THREE.Group;
    const glow = find(scene.group, "engine-glow") as THREE.Sprite;
    const streaks = find(scene.group, "transit-streaks") as THREE.InstancedMesh;
    const backdrop = find(scene.group, "transit-backdrop") as THREE.Group;
    scene.update(0);
    expect(backdrop.rotation.y).toBeCloseTo(-ALIGN_START_YAW, 6); // the sky starts turned: home gate ahead
    expect(ship.rotation.y).toBe(0); // the ship holds its heading
    expect(streaks.visible).toBe(false);
    const coolRed = (glow.material as THREE.SpriteMaterial).color.r;
    const coolBlue = (glow.material as THREE.SpriteMaterial).color.b;
    scene.update(9900);
    const c = (glow.material as THREE.SpriteMaterial).color;
    expect(c.r).toBeGreaterThan(c.b + 0.5); // red, not blue
    expect(coolBlue).toBeGreaterThan(coolRed); // it started cool
    expect(backdrop.rotation.y).toBeCloseTo(0, 6); // aligned: the destination beacon is dead ahead
    expect(streaks.visible).toBe(false); // still spooling
    scene.update(10_000 + 3000);
    expect(streaks.visible).toBe(true);
    expect(scene.view.phase).toBe("cruise");
    expect(find(scene.group, "destination-beacon")).toBeTruthy();
    scene.dispose();
  });

  it("the origin gate starts dead ahead (you see it) and the aligned sky leaves it behind the ship", () => {
    const scene = createTransitScene({ kind: "warp", totalMs: 12_000, origin: "home", destination: "great-station", armMs: 10_000 });
    const gate = find(scene.group, "gate-home") as THREE.Group;
    const world = new THREE.Vector3();
    scene.update(0);
    gate.getWorldPosition(world);
    scene.group.updateMatrixWorld(true);
    gate.getWorldPosition(world);
    expect(Math.abs(world.x)).toBeLessThan(1); // centred
    expect(world.z).toBeLessThan(-200); // ahead, in view
    scene.update(6000); // aligned
    scene.group.updateMatrixWorld(true);
    gate.getWorldPosition(world);
    expect(world.z).toBeGreaterThan(-100 * Math.cos(Math.PI / 2) - 1); // swung out of the forward view
    expect(Math.abs(world.x)).toBeGreaterThan(200); // well off to the side / behind, not ahead
    scene.dispose();
  });

  it("the ship leans into the turn and rolls back level; reduced motion never banks", () => {
    const scene = createTransitScene({ kind: "warp", totalMs: 12_000, origin: "home", destination: "great-station", armMs: 10_000 });
    const ship = find(scene.group, "transit-ship") as THREE.Group;
    scene.update(1500);
    expect(Math.abs(ship.rotation.z)).toBeGreaterThan(0.1);
    scene.update(6000);
    expect(Math.abs(ship.rotation.z)).toBeLessThan(0.03);
    scene.update(1500, { reducedMotion: true });
    expect(ship.rotation.z).toBe(0);
    scene.dispose();
  });
});

describe("arrival through the gate (armed flights)", () => {
  it("the destination gate slows with the ship and ends past her, over the chase camera — never stuck half across the view", () => {
    const scene = createTransitScene({ kind: "warp", totalMs: 12_000, origin: "home", destination: "great-station", armMs: 10_000 });
    const gate = find(scene.group, "gate-great-station") as THREE.Group;
    const z = (f: number) => {
      scene.update(10_000 + f);
      return gate.position.z;
    };
    expect(z(0)).toBeCloseTo(-1100, 5);
    let prev = z(0);
    let maxStep = 0;
    for (let f = 250; f <= 12_000; f += 250) {
      const cur = z(f);
      expect(cur).toBeGreaterThanOrEqual(prev); // only ever closes
      maxStep = Math.max(maxStep, cur - prev);
      prev = cur;
    }
    expect(z(12_000)).toBeGreaterThan(26); // past the chase camera (z = 26)
    // It decelerates: the closing speed in the last second is far below the cruise speed.
    const cruiseStep = z(7000) - z(6750);
    const lastStep = z(12_000) - z(11_750);
    expect(lastStep).toBeLessThan(cruiseStep * 0.5);
    scene.dispose();
  });
});
