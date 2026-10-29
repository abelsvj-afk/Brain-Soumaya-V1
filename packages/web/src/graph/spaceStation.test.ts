import { describe, expect, it } from "vitest";
import {
  shouldHideStationModel,
  shouldStartStationLoad,
  STATION_LOD_FAR,
  STATION_LOD_HYST,
  STATION_LOAD_MIN_MS,
  STATION_LOAD_MAX_MS,
} from "./spaceStation.js";

/**
 * Distance-gated fidelity for the station's heavy glTF (perf experiment targeting the
 * largest single decorative asset in the app). Only the pure hysteresis gate is tested
 * here — same approach sun.test.ts already uses for neutralizeSunMaterial — so this
 * covers the threshold/band arithmetic without touching GLTFLoader or the DOM.
 */
describe("shouldHideStationModel", () => {
  it("stays visible (not hidden) well inside the far distance", () => {
    expect(shouldHideStationModel(0, false)).toBe(false);
    expect(shouldHideStationModel(STATION_LOD_FAR - STATION_LOD_HYST - 1, false)).toBe(false);
  });

  it("hides well beyond the far distance", () => {
    expect(shouldHideStationModel(STATION_LOD_FAR + STATION_LOD_HYST + 1, false)).toBe(true);
  });

  it("does not flip-flop inside the hysteresis band once hidden", () => {
    // Just inside the "stay hidden" side of the band — was hidden, still within
    // STATION_LOD_FAR - STATION_LOD_HYST of the far edge, so it should remain hidden.
    const dist = STATION_LOD_FAR - STATION_LOD_HYST + 1;
    expect(shouldHideStationModel(dist, true)).toBe(true);
  });

  it("does not flip-flop inside the hysteresis band once visible", () => {
    // Just inside the "stay visible" side of the band — was visible, still within
    // STATION_LOD_FAR + STATION_LOD_HYST, so it should remain visible.
    const dist = STATION_LOD_FAR + STATION_LOD_HYST - 1;
    expect(shouldHideStationModel(dist, false)).toBe(false);
  });

  it("transitions from visible to hidden only once clearing the far+hyst edge", () => {
    expect(shouldHideStationModel(STATION_LOD_FAR + STATION_LOD_HYST - 1, false)).toBe(false);
    expect(shouldHideStationModel(STATION_LOD_FAR + STATION_LOD_HYST + 1, false)).toBe(true);
  });

  it("transitions from hidden to visible only once crossing back inside the far-hyst edge", () => {
    expect(shouldHideStationModel(STATION_LOD_FAR - STATION_LOD_HYST + 1, true)).toBe(true);
    expect(shouldHideStationModel(STATION_LOD_FAR - STATION_LOD_HYST - 1, true)).toBe(false);
  });
});


/**
 * WHEN the 14 MB model starts downloading. It used to start the instant the galaxy was built,
 * competing with the models the first screen needs. The stand-in is already on screen, so
 * starting later costs nothing visible.
 */
describe("shouldStartStationLoad", () => {
  const NEAR = STATION_LOD_FAR - 100; // where the model would actually be shown
  const FAR = STATION_LOD_FAR * 3;

  it("never starts during the startup window — even with the camera right on top of it", () => {
    expect(shouldStartStationLoad(0, 0)).toBe(false);
    expect(shouldStartStationLoad(NEAR, STATION_LOAD_MIN_MS - 1)).toBe(false);
  });
  it("after the startup window, starts as soon as the camera is where the model would be shown", () => {
    expect(shouldStartStationLoad(NEAR, STATION_LOAD_MIN_MS)).toBe(true);
    expect(shouldStartStationLoad(STATION_LOD_FAR + STATION_LOD_HYST, STATION_LOAD_MIN_MS + 1)).toBe(true);
  });
  it("waits while the camera is far away and the idle deadline has not passed", () => {
    expect(shouldStartStationLoad(FAR, STATION_LOAD_MIN_MS)).toBe(false);
    expect(shouldStartStationLoad(FAR, STATION_LOAD_MAX_MS - 1)).toBe(false);
  });
  it("an idle galaxy still warms it by the deadline, wherever the camera is", () => {
    expect(shouldStartStationLoad(FAR, STATION_LOAD_MAX_MS)).toBe(true);
    expect(shouldStartStationLoad(null, STATION_LOAD_MAX_MS)).toBe(true);
  });
  it("with no camera info it waits for the deadline rather than guessing", () => {
    expect(shouldStartStationLoad(null, STATION_LOAD_MIN_MS)).toBe(false);
    expect(shouldStartStationLoad(null, STATION_LOAD_MAX_MS - 1)).toBe(false);
  });
  it("the deadline is later than the startup window (the gate can ever open)", () => {
    expect(STATION_LOAD_MAX_MS).toBeGreaterThan(STATION_LOAD_MIN_MS);
  });
});
