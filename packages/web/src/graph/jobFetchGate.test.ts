import { describe, it, expect } from "vitest";
import { createJobFetchGate, NEXT_JOB_MIN_INTERVAL_MS } from "./jobFetchGate.js";

describe("createJobFetchGate", () => {
  it("allows the first fetch, then at most one per interval", () => {
    const g = createJobFetchGate(1000);
    expect(g.tryAcquire(0)).toBe(true);
    expect(g.tryAcquire(10)).toBe(false);
    expect(g.tryAcquire(999)).toBe(false);
    expect(g.tryAcquire(1000)).toBe(true);
    expect(g.tryAcquire(1500)).toBe(false);
  });

  it("caps a once-per-second planner at ~4 server fetches/min with the default interval", () => {
    const g = createJobFetchGate();
    let n = 0;
    // planner tick each second, up to 3 attempts per tick (the old worst case)
    for (let t = 0; t < 60_000; t += 1000) for (let k = 0; k < 3; k++) if (g.tryAcquire(t)) n++;
    expect(n).toBe(Math.ceil(60_000 / NEXT_JOB_MIN_INTERVAL_MS));
  });
});
