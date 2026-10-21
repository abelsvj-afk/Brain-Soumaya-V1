import { describe, it, expect } from "vitest";
import {
  taskSatelliteOrbitPos,
  taskSatellitePhase,
  taskSatelliteRadiusFactor,
  TASK_SATELLITE_ORBIT_SECONDS,
  TASK_SATELLITE_MERGE_SECONDS,
} from "./taskSatellites.js";

describe("task satellite orbit math (IM-140a)", () => {
  it("orbits the anchor at the given radius", () => {
    const a = { x: 10, y: 0, z: -5 };
    const p = taskSatelliteOrbitPos(a, 20, 0);
    expect(p.x).toBeCloseTo(30);
    expect(p.z).toBeCloseTo(-5);
    const q = taskSatelliteOrbitPos(a, 20, Math.PI);
    expect(q.x).toBeCloseTo(-10);
  });

  it("phases: orbit → merge → gone on the documented timeline", () => {
    expect(taskSatellitePhase(0)).toBe("orbit");
    expect(taskSatellitePhase(TASK_SATELLITE_ORBIT_SECONDS - 0.1)).toBe("orbit");
    expect(taskSatellitePhase(TASK_SATELLITE_ORBIT_SECONDS + 0.1)).toBe("merge");
    expect(taskSatellitePhase(TASK_SATELLITE_ORBIT_SECONDS + TASK_SATELLITE_MERGE_SECONDS + 0.1)).toBe("gone");
  });

  it("radius holds while orbiting and spirals to zero while merging", () => {
    expect(taskSatelliteRadiusFactor(1, 18)).toBe(18);
    const mid = taskSatelliteRadiusFactor(TASK_SATELLITE_ORBIT_SECONDS + TASK_SATELLITE_MERGE_SECONDS / 2, 18);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(18);
    expect(taskSatelliteRadiusFactor(TASK_SATELLITE_ORBIT_SECONDS + TASK_SATELLITE_MERGE_SECONDS + 1, 18)).toBe(0);
  });
});
