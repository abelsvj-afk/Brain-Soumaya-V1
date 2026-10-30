import { describe, expect, it } from "vitest";
import { HOUR_TINTS, tintRigForHour } from "./hourTint.js";
import type { WorldLightRig } from "./worldLighting.js";

const RIG: WorldLightRig = { env: 0.8, hemi: { sky: 0x9fb0ff, ground: 0x2a2036, intensity: 1 }, key: { color: 0xffffff, intensity: 2, from: [1, 2, 3] } };

describe("the Hours tint", () => {
  it("is neutral at Measure and leans subtly elsewhere — never more than a quarter dimmer", () => {
    expect(tintRigForHour(RIG, "measure")).toEqual(RIG);
    for (const band of Object.keys(HOUR_TINTS) as (keyof typeof HOUR_TINTS)[]) {
      const r = tintRigForHour(RIG, band);
      expect(r.env).toBe(RIG.env);
      expect(r.key!.intensity).toBeGreaterThanOrEqual(RIG.key!.intensity * 0.75);
      expect(r.key!.from).toEqual(RIG.key!.from);
    }
  });
  it("leans blue at Rest and warm at the Hearths", () => {
    const rest = tintRigForHour(RIG, "rest").key!.color;
    const hearth = tintRigForHour(RIG, "hearths").key!.color;
    expect(rest & 0xff).toBeGreaterThan((rest >> 16) & 0xff - 1); // blue holds while red drops
    expect((hearth >> 16) & 0xff).toBeGreaterThan(hearth & 0xff); // red over blue
  });
  it("keeps a rig with only an environment map as it is", () => {
    expect(tintRigForHour({ env: 0.5 }, "rest")).toEqual({ env: 0.5 });
  });
});
