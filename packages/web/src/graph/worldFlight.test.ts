import { describe, it, expect } from "vitest";
import {
  ALIGN_MS,
  angleDelta,
  BURN_MAX_MS,
  BURN_MIN_MS,
  chasePose,
  CHASE_DISTANCE,
  IDLE_ENGINE,
  initialFlight,
  noseDirection,
  scaleNote,
  SPOOL_MS,
  standoffPoint,
  startFlight,
  stepFlight,
  STANDOFF_MIN,
  type FlightState,
  type V3,
} from "./worldFlight.js";

const run = (s: FlightState, ms: number, step = 50, opts = {}) => {
  let st = s;
  let arrived = false;
  for (let t = 0; t < ms; t += step) {
    const r = stepFlight(st, step, opts);
    st = r.state;
    arrived = arrived || r.arrived;
  }
  return { st, arrived };
};
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("worldFlight — stand-off", () => {
  it("stops short of the place, on the line to it, by ~1.35× its radius (never closer than the minimum)", () => {
    const to = standoffPoint([0, 0, 0], { center: [1000, 0, 0], radius: 210 });
    expect(to[0]).toBeCloseTo(1000 - 210 * 1.35, 6);
    expect(to[1]).toBeCloseTo(0, 6);
    const small = standoffPoint([0, 0, 0], { center: [500, 0, 0], radius: 2 });
    expect(dist(small, [500, 0, 0])).toBeCloseTo(STANDOFF_MIN, 6);
  });
  it("already there: no move", () => {
    expect(standoffPoint([10, 0, 0], { center: [20, 0, 0], radius: 30 })).toEqual([10, 0, 0]);
    const s = startFlight(initialFlight([10, 0, 0]), { center: [20, 0, 0], radius: 30 });
    expect(s.phase).toBe("idle");
  });
});

describe("worldFlight — the EVE sequence", () => {
  const target = { center: [0, 0, 1500] as V3, radius: 200 };

  it("ALIGN eases the ship round to face the place, never snapping, and engines start warming", () => {
    let s = startFlight(initialFlight([0, 0, 0], Math.PI * 0.9, 0), { center: [1200, 0, 0], radius: 100 });
    expect(s.phase).toBe("align");
    let prev = s.yaw;
    for (let t = 0; t < ALIGN_MS; t += 100) {
      s = stepFlight(s, 100).state;
      expect(Math.abs(angleDelta(prev, s.yaw))).toBeLessThan(0.5); // smooth per step
      prev = s.yaw;
    }
    expect(s.phase).toBe("spool");
    expect(s.yaw).toBeCloseTo(Math.PI / 2, 6); // facing +x
    expect(s.engine).toBeGreaterThan(IDLE_ENGINE);
  });

  it("turns the SHORT way round (350° → 10° is a 20° turn, not 340°)", () => {
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 6);
  });

  it("SPOOL takes the engines to full; BURN covers the distance and ends at the stand-off, then it is idle", () => {
    let s = startFlight(initialFlight([0, 0, 0]), target);
    const r = run(s, ALIGN_MS + SPOOL_MS + 200);
    expect(r.st.phase).toBe("burn");
    expect(r.st.engine).toBe(1);
    const end = run(r.st, BURN_MAX_MS + 500);
    expect(end.arrived).toBe(true);
    expect(end.st.phase).toBe("idle");
    expect(end.st.pos[2]).toBeCloseTo(1500 - 200 * 1.35, 5);
    expect(end.st.yaw).toBeCloseTo(0, 6); // still facing it
  });

  it("burn time scales with distance within its bounds", () => {
    const near = startFlight(initialFlight([0, 0, 0]), { center: [0, 0, 300], radius: 50 });
    const mid = startFlight(initialFlight([0, 0, 0]), { center: [0, 0, 1500], radius: 50 });
    const far = startFlight(initialFlight([0, 0, 0]), { center: [0, 0, 20_000], radius: 50 });
    expect(near.burnMs).toBeGreaterThanOrEqual(BURN_MIN_MS);
    expect(near.burnMs).toBeLessThan(mid.burnMs);
    expect(mid.burnMs).toBeLessThan(far.burnMs);
    expect(far.burnMs).toBe(BURN_MAX_MS); // capped: a long trip is never a long wait
  });

  it("the burn takes off hard and settles gently: speed peaks mid-burn and is ~0 at both ends; position only moves forward", () => {
    let s = startFlight(initialFlight([0, 0, 0]), target);
    s = run(s, ALIGN_MS + SPOOL_MS + 1).st;
    let peak = 0;
    let prevZ = s.pos[2];
    let early = 0;
    let late = 0;
    for (let t = 0; t < s.burnMs; t += 50) {
      s = stepFlight(s, 50).state;
      peak = Math.max(peak, s.speed);
      expect(s.pos[2]).toBeGreaterThanOrEqual(prevZ - 1e-9);
      prevZ = s.pos[2];
      if (t < 150) early = Math.max(early, s.speed);
      if (t > s.burnMs - 150) late = Math.max(late, s.speed);
    }
    expect(peak).toBeGreaterThan(0.8);
    expect(early).toBeLessThan(0.2);
    expect(late).toBeLessThan(0.3);
  });

  it("the engines cool back to idle after arriving", () => {
    // Stop the run on the step the burn completes, so the engines are still hot.
    let st = startFlight(initialFlight([0, 0, 0]), target);
    let arrivedNow = false;
    while (!arrivedNow) {
      const r = stepFlight(st, 50);
      st = r.state;
      arrivedNow = r.arrived;
    }
    const arrived = st;
    expect(arrived.phase).toBe("idle");
    const hot = arrived.engine;
    const later = run(arrived, 2000).st;
    expect(later.engine).toBeCloseTo(IDLE_ENGINE, 6);
    expect(hot).toBeGreaterThan(later.engine);
  });

  it("reduced motion: the same steps, no sweep and no glide — faces the place and is placed at the stand-off at once", () => {
    const s = startFlight(initialFlight([0, 0, 0], 2, 0), { center: [0, 300, 1500], radius: 200 });
    const r = stepFlight(s, 16, { reducedMotion: true });
    expect(r.arrived).toBe(true);
    expect(r.state.phase).toBe("idle");
    expect(r.state.pos).toEqual(s.to);
    expect(r.state.yaw).toBeCloseTo(s.aimYaw, 6);
    expect(r.state.pitch).toBeCloseTo(s.aimPitch, 6);
  });

  it("pitch: a place above the ship tilts the nose up", () => {
    const s = startFlight(initialFlight([0, 0, 0]), { center: [0, 800, 800], radius: 50 });
    expect(s.aimPitch).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe("worldFlight — camera and scale", () => {
  it("the chase camera sits behind and above the ship, looking ahead of her", () => {
    const pose = chasePose({ pos: [100, 0, 0], yaw: Math.PI / 2, pitch: 0 }); // facing +x
    expect(pose.position[0]).toBeCloseTo(100 - CHASE_DISTANCE, 6);
    expect(pose.position[1]).toBeGreaterThan(0);
    expect(pose.target[0]).toBeGreaterThan(100);
    const n = noseDirection(Math.PI / 2, 0);
    expect(n[0]).toBeCloseTo(1, 6);
    expect(Math.hypot(...noseDirection(1.2, 0.4))).toBeCloseTo(1, 6);
  });
  it("states the scale in words (not colour): 'N across · M× your ship'", () => {
    expect(scaleNote(210)).toBe("420 across · 35× your ship");
    expect(scaleNote(6)).toBe("12 across · 1× your ship");
    expect(scaleNote(9)).toBe("18 across · 1.5× your ship");
  });
});
