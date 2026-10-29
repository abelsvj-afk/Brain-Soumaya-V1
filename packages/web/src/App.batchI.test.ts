import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Batch I — textual pins for the App.tsx wiring. App.tsx is never mounted
 * by any harness in this repo, so (like App.batchB.test.ts) the wiring is
 * pinned by asserting on the source text: the call sites, the condition
 * shapes, and the helper names that carry the behaviour. A renamed or
 * dropped call site fails here; the behaviour itself is unit-tested in
 * App.helpers.test.ts / the component suites.
 */
const appSrc = fs.readFileSync(
  path.resolve(__dirname, "App.tsx"),
  "utf8",
);
const graphSrc = fs.readFileSync(
  path.resolve(__dirname, "graph", "Graph3D.tsx"),
  "utf8",
);
const cssSrc = fs.readFileSync(
  path.resolve(__dirname, "index.css"),
  "utf8",
);
const galaxyErrorCardSrc = fs.readFileSync(
  path.resolve(__dirname, "components", "GalaxyErrorCard.tsx"),
  "utf8",
);

describe("Batch I — App wiring pins (REG-060…REG-072, REG-110, REG-111)", () => {
  it("REG-060: the galaxy error fallback offers the Lite escape, not only Reload", () => {
    expect(appSrc).toMatch(/GalaxyErrorCard/);
    // The Lite wording lives in the card itself; App's job is to use it.
    expect(galaxyErrorCardSrc).toMatch(/open without the 3D galaxy/i);
    expect(galaxyErrorCardSrc).toMatch(/enterLiteMode\(\)/);
  });

  it("REG-061: the sector-title block applies the same clamp as the planet labels", () => {
    expect(graphSrc).toMatch(/titleBasePos/);
    expect(graphSrc).toMatch(/clampLabelCenter/);
    // The clamp must run in the sector-title block, not only in the
    // planet-label block — the title's centre is what gets clamped.
    const titleBlock = graphSrc.slice(graphSrc.indexOf("titleBasePos"));
    expect(titleBlock).toMatch(/clampLabelCenter/);
  });

  it("REG-062: the figurine fan folds DOWN when there is no room to fold up", () => {
    expect(appSrc).toMatch(/fanDownBottomPx/);
    expect(appSrc).toMatch(/direction/);
  });

  it("REG-064: figurine fan captions carry the equipped figurine type", () => {
    expect(appSrc).toMatch(/fanTargetCaption\([^)]*equippedFig1/);
    expect(appSrc).toMatch(/fanTargetCaption\([^)]*equippedFig2/);
  });

  it("REG-065: the song dots gate on trackLocked, not on isTrackUnlocked alone", () => {
    expect(appSrc).toMatch(/trackLocked\(/);
  });

  it("REG-065: playSong fails closed while unlock stats are in flight", () => {
    expect(appSrc).toMatch(/Still checking what's unlocked/);
  });

  it("REG-066: the now-playing pill says Skip in visible text, not only an icon", () => {
    expect(appSrc).toMatch(/Skip/);
    expect(appSrc).toMatch(/Tap play\/pause/);
  });

  it("REG-066: locked tracks explain their requirement in the song menu", () => {
    expect(appSrc).toMatch(/lockedTrackNotes/);
  });

  it("REG-067: the fuel gauge receives its load state and a retry from App", () => {
    expect(appSrc).toMatch(/fuelError/);
    expect(appSrc).toMatch(/loadState=\{/);
  });

  it("REG-068: the Fuel/Streak block, the HUD stack and the empty-galaxy cue share one hide rule", () => {
    const uses = appSrc.match(/hudChromeHidden\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3);
  });

  it("REG-069: the notifications bar is scoped to the current space", () => {
    // Pin the prop on the NotificationsBar element itself — spaceId={space?.id}
    // appears on other components, so a whole-file match would prove nothing.
    const bar = appSrc.slice(appSrc.indexOf("<NotificationsBar"));
    expect(bar.slice(0, 600)).toMatch(/spaceId=\{space\?\.id\}/);
  });

  it("REG-070: the shield-save toast explains what a shield forgives", () => {
    expect(appSrc).toMatch(/shieldSavedToastText\(\)/);
  });

  it("REG-072: the toast overflow chip is actionable and routes to the Inbox", () => {
    // The chip itself lives in Toasts.tsx; the App side must already
    // route kind:"tab" to the dock — pinned here so a refactor cannot
    // silently drop the route the chip depends on.
    expect(appSrc).toMatch(/brain-toast-action/);
  });

  it("REG-111: the galaxy-entity click toasts through the flown/missed helper", () => {
    expect(appSrc).toMatch(/galaxyEntityToastText\(/);
  });

  it("REG-063 (H-1 restore, verified not rebuilt): the Calm rename is still intact", () => {
    expect(appSrc).toMatch(/Calm mode on/);
    // Calm is a Tools-menu entry now (persistent-HUD spec) — its label is pinned in batchQFollowups.test.tsx.
    expect(appSrc).not.toContain("fab-focus-toggle");
  });

  it("REG-066: the song-menu hint and locked-notes lines have styles", () => {
    expect(cssSrc).toMatch(/\.song-menu-hint/);
    expect(cssSrc).toMatch(/\.song-lock-notes/);
  });
});
