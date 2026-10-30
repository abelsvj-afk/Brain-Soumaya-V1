import { describe, expect, it } from "vitest";
import { ROAD, ROAD_CHALK_END_Z, ROAD_HOLDERS, ROAD_ORBIT_HEIGHT, ROAD_ORBIT_RADIUS, ROAD_VIEW_Z, roadChalk, roadLamps, roadNails } from "./roadLayout.js";

describe("the Road to the Seam layout", () => {
  it("hangs even lamps and sets one nail a stride, all inside the walls", () => {
    const lamps = roadLamps();
    expect(lamps.length).toBeGreaterThan(30);
    for (const l of lamps) expect(Math.abs(l.x)).toBeLessThan(ROAD.wallHalfWidth);
    expect(new Set(lamps.map((l) => l.y)).size).toBe(1); // every lamp at one height
    expect(roadNails().length).toBeGreaterThan(80);
  });
  it("sets chalk low on the wall, the same every time, and it stops before the road does", () => {
    const c = roadChalk();
    expect(roadChalk()).toEqual(c);
    for (const m of c) {
      expect(m.y).toBeLessThan(25);
      expect(m.z).toBeLessThan(ROAD_CHALK_END_Z + 5);
    }
    expect(ROAD_CHALK_END_Z).toBeLessThan(ROAD.zEnd - 500);
  });
  it("keeps the orbit camera inside the walls and below the top even at the widest portrait back-off", () => {
    expect(ROAD_ORBIT_RADIUS * 2.2).toBeLessThan(ROAD.halfWidth - 2);
    expect(ROAD_ORBIT_HEIGHT * 2.2 + 10).toBeLessThan(ROAD.wallHeight);
    expect(ROAD_VIEW_Z).toBeGreaterThan(0);
    expect(new Set(ROAD_HOLDERS).size).toBe(ROAD_HOLDERS.length);
  });
});
