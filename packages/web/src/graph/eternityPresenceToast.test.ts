import { describe, expect, it } from "vitest";
import type { EternityPresence } from "@brain/shared";
import { presenceIntensity, presenceToast } from "./eternityPresenceToast.js";

const base: EternityPresence = {
  dayKey: "2026-10-29",
  stopped: false,
  broadcast: { gesture: "blessing", line: "For every ship in this sky: go back lighter than you came." },
  actedToday: false,
  veil: null,
  crown: null,
};

describe("presenceToast", () => {
  it("carries the broadcast line", () => {
    expect(presenceToast(base)!.text).toMatch(/^Eternity — For every ship/);
  });
  it("the veil becomes a tap that flies you to the memory", () => {
    const t = presenceToast({ ...base, veil: { nodeId: 7, label: "Old promise" } })!;
    expect(t.text).toMatch(/parted the veil on “Old promise”/);
    expect(t.action).toEqual({ kind: "focus", value: 7 });
  });
  it("names a crowned Journey", () => {
    expect(presenceToast({ ...base, crown: { journeyId: 1, title: "Marathon" } })!.text).toMatch(/crowned your finished Journey “Marathon”/);
  });
  it("silent when stopped; brighter on a day he acted", () => {
    expect(presenceToast({ ...base, stopped: true, broadcast: null })).toBeNull();
    expect(presenceIntensity({ ...base, actedToday: true })).toBeGreaterThan(presenceIntensity(base));
  });
});
