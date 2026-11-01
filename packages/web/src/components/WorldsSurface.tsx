import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TRAVEL_CANCEL_WINDOW_SECONDS, WORLDS_TRAVEL_ENABLED, RELIC_ANCHOR_POINTS, RELIC_DWELL_MS, relicCodexKey, relicsForWorld } from "@brain/shared";
import { useTravel } from "../hooks/useTravel.js";
import { recallHome } from "../api/travel.js";
import { getJourneys, journeyLinks } from "../api/journeys.js";
import { getDueReviews, type DueReview } from "../api/features.js";
import { getArchivedNodesStrict, getIncidentEdges, getSpaceId } from "../api/client.js";
import type { GraphData, GraphEdge, GraphNode, Journey, JourneyLinkSummary, RelicDef, RelicWorld } from "@brain/shared";
import {
  getGardenSuggestions,
  getRecentGardenTends,
  readIgnoredSuggestionIds,
  writeIgnoredSuggestionIds,
  type GardenSuggestion,
  type GardenTend,
  type TendResult,
} from "../api/garden.js";
import { warmPlotNodeIds, litPathEdgeIds } from "../graph/gardenTend.js";
import { GardenTendSheet } from "./GardenTendSheet.js";
import { GardenGroveSheet } from "./GardenGroveSheet.js";
import { GardenRecallSheet } from "./GardenRecallSheet.js";
import { GardenObjective } from "./GardenObjective.js";
import NpcTalk from "./NpcTalk.js";
import {
  EMPTY_DAY,
  EMPTY_GUIDE,
  dayComplete,
  gardenObjective,
  readDay,
  readGuide,
  writeDay,
  writeGuide,
  type DayState,
  type GuideProgress,
} from "../graph/gardenGuide.js";
import WorldsDock, { type DockGroup } from "./WorldsDock.js";
import { createStationScene } from "../graph/stationScene.js";
import {
  INTERIOR_ORBIT_RATE_RAD_PER_MS,
  buildStationInteriorLayout,
  interiorSpaceCamera,
  type InteriorRoomId,
} from "../graph/stationInteriorLayout.js";
import { createStationInteriorScene } from "../graph/stationInteriorScene.js";
import type { FleetStatus } from "../graph/Graph3D.js";
import StationInteriorRoomPanel from "./StationInteriorRooms.js";
import {
  STATION_ARRIVAL_MS,
  STATION_ORBIT_HEIGHT,
  STATION_ORBIT_RADIUS,
  STATION_PALETTE,
  approachPose,
} from "../graph/stationLayout.js";
import { ensureKtx2Support } from "../graph/gltf.js";
import { buildGardenLayout, clampToGardenFloor, GARDEN_POD_MAX, GARDEN_CAMERA_FLOOR_Y, landmarkPositionFor, type GardenLayout } from "../graph/gardenLayout.js";
import { createGardenScene, EMPTY_GARDEN_MUTATION, type GardenMutationInput, type GardenMutationLanding, type GardenMutationPreview, type GardenMutationUndo, type GardenScene } from "../graph/gardenScene.js";
import {
  getWorldChangesState,
  listWorldChangeProposals,
  resolveWorldChangeTarget,
  type WorldChangeProposal,
} from "../api/worldChanges.js";
import {
  buildDeepPastLayout,
  buildDeepPastWalkPoints,
  DEEP_PAST_BASIN_RADIUS,
  DEEP_PAST_BASIN_Y,
  DEEP_PAST_SHIP_BERTH,
  deepPastFloorY,
  type DeepPastLayout,
} from "../graph/deepPastLayout.js";
import {
  createDeepPastScene,
  EMPTY_DEEP_PAST_LAYOUT,
  type DeepPastScene,
} from "../graph/deepPastScene.js";
import {
  buildPeopleLayout,
  type PeopleLayout,
} from "../graph/peopleLayout.js";
import {
  createPeopleScene,
  EMPTY_PEOPLE_LAYOUT,
} from "../graph/peopleScene.js";
import {
  buildQuietArchiveLayout,
  type QuietArchiveLayout,
} from "../graph/quietArchiveLayout.js";
import { createWardScene } from "../graph/wardScene.js";
import { createRoadScene } from "../graph/roadScene.js";
import { createVillageScene } from "../graph/villageScene.js";
import FoldChoice from "./FoldChoice.js";
import { createFoldScene } from "../graph/foldScene.js";
import { FOLD_ORBIT_HEIGHT, FOLD_ORBIT_RADIUS } from "../graph/foldLayout.js";
import { createLongScene, LONG_SKY } from "../graph/longScene.js";
import { LONG_ORBIT_HEIGHT, LONG_ORBIT_RADIUS } from "../graph/longLayout.js";
import { createYardScene } from "../graph/yardScene.js";
import { YARD_ORBIT_HEIGHT, YARD_ORBIT_RADIUS } from "../graph/yardLayout.js";
import { createSiegeScene } from "../graph/siegeScene.js";
import { SIEGE_ORBIT_HEIGHT, SIEGE_ORBIT_RADIUS } from "../graph/siegeLayout.js";
import { createUnmadeScene } from "../graph/unmadeScene.js";
import { UNMADE_ORBIT_HEIGHT, UNMADE_ORBIT_RADIUS } from "../graph/unmadeLayout.js";
import { VILLAGE_ORBIT_HEIGHT, VILLAGE_ORBIT_RADIUS } from "../graph/villageLayout.js";
import { ROAD_ORBIT_HEIGHT, ROAD_ORBIT_RADIUS } from "../graph/roadLayout.js";
import { WARD_ORBIT_HEIGHT, WARD_ORBIT_RADIUS } from "../graph/wardLayout.js";
import { attachWorldProps } from "../graph/worldProps.js";
import { tintRigForHour } from "../graph/hourTint.js";
import {
  createQuietArchiveScene,
  EMPTY_QUIET_ARCHIVE_LAYOUT,
} from "../graph/quietArchiveScene.js";
import {
  buildScaleLayout,
  type ScaleLayout,
} from "../graph/scaleLayout.js";
import {
  createScaleScene,
  EMPTY_SCALE_LAYOUT,
} from "../graph/scaleScene.js";
import HarborControllerPanel from "./HarborControllerPanel.js";
import { pushToast } from "./Toasts.js";
import { useStoryNotice } from "../hooks/useStoryNotice.js";
import { inspectablesHere, locateLandmarks, makeReach } from "../graph/storySpots.js";
import { STORY_TRIGGERS, hourBand } from "@brain/shared";
import { markRelicFound, replaceFoundRelics, useFoundRelics } from "./relicsFound.js";
import { findRelic, sampleRelicClaimStart, type RelicsState } from "../api/relics.js";
import { RelicHuntControls } from "./RelicHuntControls.js";
import { useRelicBuffs } from "../hooks/useRelicBuffs.js";
import { createTransitScene } from "../graph/transitScene.js";
import { TRANSIT_MS } from "./TravelPanel.js";
import { renderIcon } from "./icons/Icon.js";
import { getNpcScript } from "../api/npcs.js";
import type { NpcDayScript } from "@brain/shared";
import { GO_HOME_EVENT, HOME_PLACE, announcePlace } from "../lib/worldPlace.js";
import { encounterLine, encounterStep, npcIcon, readMet, recordMeeting, type NpcKey } from "../graph/npcPresence.js";
import { anchorFromBounds, createNpcBodies, type NpcBodies } from "../graph/npcBodies.js";
import type { PlaceLore } from "@brain/shared";
import { canTalkTo, castIn, castMember, faithLabel, hash01, worldLife, type SocietyDay } from "@brain/shared";
import { useSociety } from "../hooks/useSociety.js";
import { patrolLabel } from "../graph/npcPresence.js";
import { HARBOR_CONTROLLER_BERTH } from "../graph/stationLayout.js";
import { ENTER_WORLD_EVENT, TRAVEL_CHANGED_EVENT, announceTravelChanged, type TravelChangedDetail } from "../lib/travelEvents.js";
import {
  approachPoint,
  easeAngle,
  followPose,
  groundHeightAt,
  initialWalk,
  stepWalk,
  walkRoute,
  WALK_HOVER,
  type WalkPoint,
  type WalkState,
} from "../graph/gardenWalk.js";
import { portraitFit } from "../graph/worldCamera.js";
import type { TransitScene } from "../graph/transitScene.js";
import { createShipAvatar, type ShipAvatar } from "../graph/shipAvatar.js";
import { createEnginePlume } from "../graph/enginePlume.js";
import { findPlaces, PLACE_RULES, type Place } from "../graph/worldPlaces.js";
import { pushOutOfShells, type Shell } from "../graph/bodyShell.js";
import { chasePose, initialFlight, scaleNote, startFlight, stepFlight, type FlightState, type V3 } from "../graph/worldFlight.js";
import { applyWorldLighting, TRANSIT_LIGHT_RIG, type WorldLightRig } from "../graph/worldLighting.js";
import { NO_LOOK, applyLook, dragLook, isLooked, pinchDistance, zoomLook, type LookState } from "../graph/worldLook.js";
import { makeEngineAudio } from "../graph/engineAudio.js";
import { useEternityAutonomy } from "../hooks/useEternityAutonomy.js";
import { purposeSeenKey, worldPurpose } from "../graph/worldPurpose.js";
import { installHomeSky, releaseHomeSky } from "../graph/homeSky.js";
import { loadSoumayaShip } from "../graph/soumayaShip.js";
import { loadWarpGate } from "../graph/gateScene.js";
import { WORLD_CHART } from "../lib/routeBoard.js";
import { createEternityScene } from "../graph/eternityScene.js";
import {
  ETERNITY_GESTURE_NAMES,
  ETERNITY_ORBIT_HEIGHT,
  ETERNITY_ORBIT_LOOK_AT_Y,
  ETERNITY_ORBIT_RADIUS,
  ETERNITY_PALETTE,
  ETERNITY_TOOL_NAMES,
} from "../graph/eternityLayout.js";

/**
 * The worlds surface view — the mount the P2-3 audit's F-01 reconciled as
 * deliberately deferred to here (P2-4), generalized in P3-1 to a scene
 * registry keyed by the current world. A GalaxyViews sibling in the
 * overlay layer: when the travel flag is on AND the server's travel state
 * places the brain in a world with a scene, that scene mounts full-screen.
 *
 * Worlds (P3-2): the Great Station (P2-4), the Growing Place (the garden —
 * plots = real memories, paths = real connections, landmarks = completed
 * Journeys, all derived per-visit from the graph the app already holds),
 * the Deep Past (the helix — members = old memories by the D-7 rule,
 * anchors = links to their other appearances, the Chronicle thread = the
 * earliest done Journey with two member stops), the People (P3-3 —
 * the warm field: one cluster per person with linked memories, lights =
 * their memories, bridges = memories shared between two people),
 * Quiet/Archive (Wave 2 — the still field: one lamp per archived person,
 * lights = their archived memories, lone lights = archived memories with
 * no person, bridges = archived memories shared between two archived
 * people; the archived input is fetched on entry, never from the graph
 * prop), and Scale (the actual station, actual size — the real ISS at its
 * real size beside your ship, real probes as small true things at real
 * distances, the survey frame as its gate). Each world renders the graph
 * data the app already holds — the same window the home galaxy sees — via
 * the `graph` prop from App; none fetches its own copy of the brain (the
 * Archive's exception is its own archived input, which the graph window
 * cannot carry; Scale renders no graph data at all: it surfaces no
 * memories of its own).
 * Journeys are fetched on garden/deep-past entry (landmarks / routes); if a
 * fetch fails, the world renders without that layer and says so honestly.
 * The Archive fetches its own input on entry — the archived nodes plus
 * their incident edges — because the graph prop never carries archived
 * rows. If that fetch fails, the Archive renders the error and a retry,
 * never an empty field (C6): an empty archive and a failed load are
 * different truths, and this world must never confuse them.
 *
 * Dark contract, same as the panel's: while the flag is off this renders
 * nothing, fetches nothing, and never touches three.js or any scene. The
 * host owns the renderer, camera, and fog; each scene module owns its
 * group and its per-frame motion. The camera is presentation — a slow,
 * monumental orbit, frozen under reduced motion. The garden's camera is
 * floored above its lowest terrace (GARDEN_CAMERA_FLOOR_Y), so no view
 * can ever sink under the garden — and the garden itself is a finished
 * solid with a skirt and bottom cap, not flat rings over void. Closing the surface is
 * view-only: the brain stays where the server says it is, and the travel
 * panel is how it journeys on.
 *
 * Transit (P2-5): while a journey is in_transit or returning, the surface
 * shows the transit scene instead of a destination scene — her ship flying
 * from the departure gate to the arrival gate, warp rich / drift plain.
 * The ship is her own `soumaya-ship.glb` (P2-6 hero; the procedural hull
 * is the load-failure fallback). Engine audio rides along, gated by the
 * interface-sounds setting. Arming still shows nothing — the user is
 * still at the origin world and the panel owns the countdown.
 *
 * Station arrival (P2-6, A13): on a Station stay the camera flies the
 * approach (far → handoff → arrival, 12 s) and settles into the 600-unit
 * resting orbit; any pointer press skips straight to the orbit, and
 * reduced motion never plays the glide — the orbit holds from the start.
 *
 * Deep Past rework (2026-10-29 design note §7–§8 + functions addendum):
 * four modes, all with a FREE camera (the look layer applies on top of
 * every mode; nothing in Deep Past ever sets the scripted flag). Overview
 * is the rim orbit (idle ≈9°/s until the traveller's first interaction,
 * then the slow parked rate). Walk rides the generated walk curve down
 * the stair, waiting at every stratum landing. Perch is a slow orbit
 * anchored to a landing (or to a focused member). The Chronicle ride is
 * ship-led: her ship travels the thread stop to stop, dwells at each
 * stop, and leaving parks the stop — re-entering resumes there. Reduced
 * motion: no walk auto-advance (landing-to-landing jumps), the ride's
 * Continue jumps between stops, perches hold still.
 *
 * Station interior (Wave 2, settled design 2026-10-28): the interior
 * is the Station's inside, not a new world — a mode of the Station
 * stay. "Step inside the Station" swaps the exterior scene for the
 * interior hall, free and reversible; "Step back outside" returns to
 * the orbit. Inside, a room list jumps instantly between four rooms
 * — hangar bay (arrival room and ship room: your ship floats in the
 * center, the Batch O ship picker lives here), commission board,
 * fleet deck, observation deck (quiet: no task, no counter, nothing
 * to earn). No walking, no glide, no fuel spent inside. The prior
 * build's "bay is not the hangar" boundary is superseded — the bay
 * IS the hangar now. The interior resets per stay, always opening
 * on the hangar bay.
 */

interface WorldSceneHandle {
  group: THREE.Group;
  update: (ms: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
  /** Eternity only: his gestures, his tools, and the heavens-shake.
   *  The host owns the camera, so the shake arrives as a number the
   *  host applies after lookAt — the scene never moves a camera it
   *  does not own. */
  eternity?: {
    setGesture: (name: string) => void;
    useTool: (name: string) => void;
    shakeAt: (ms: number) => number;
    currentGesture: () => string;
  };  /**
   * Garden only (Phase 4): push mutation state (warmth, previews,
   * landings, undos). Absent on every other scene.
   */
  setMutation?: (input: GardenMutationInput) => void;
  /** Garden only (Phase 4): jump in-progress landings/undos to final. */
  skipAnimations?: () => void;
  /** Garden only (Phase 4): the fog tint for the warmth now rendered. */
  getWarmthFogColor?: () => number | null;
}

/** Deep Past rework: the four in-world modes (design note §7). */
type DpMode = "overview" | "walk" | "perch" | "ride";
type DpVec = [number, number, number];

/** The walk's runtime state (refs — the frame loop moves it every frame). */
interface DpWalkRt {
  /** Arc-length parameter along the walk curve, 0 (rim) … 1 (basin). */
  s: number;
  moving: boolean;
  dir: 1 | -1;
  /** Stratum of the landing the walk is waiting at (9 = basin), or null mid-flight. */
  atLanding: number | null;
}

/** The Chronicle ride's runtime state. Waypoint keys: −1 = the rim berth,
 *  0…n−1 = thread stops, n = the basin rest. */
interface DpRideRt {
  phase: "atBerth" | "dwelling" | "traveling" | "complete";
  /** The stop the ride is dwelling at / parked at. */
  stop: number;
  /** Thread kindle fraction (0…1) — kept while the ride is parked. */
  kindle: number;
  pendingLeg: { from: number; to: number } | null;
  leg: { from: number; to: number; tMs: number; durMs: number; fromKindle: number; toKindle: number } | null;
}

/** Where her ship berths at the rim — the layout's polar convention
 *  (cos → x, sin → z), exactly as the scene berths her, so the ride's
 *  first leg starts where she already rests. */
const DP_BERTH_POS: DpVec = [
  Math.cos(DEEP_PAST_SHIP_BERTH.angle) * DEEP_PAST_SHIP_BERTH.radius,
  DEEP_PAST_SHIP_BERTH.y,
  Math.sin(DEEP_PAST_SHIP_BERTH.angle) * DEEP_PAST_SHIP_BERTH.radius,
];
/** Where the ship rests when the Chronicle ride completes. */
const DP_BASIN_REST: DpVec = [0, DEEP_PAST_BASIN_Y + 16, DEEP_PAST_BASIN_RADIUS * 0.4];
/** The basin orb the walk's final segment settles facing. */
const DP_ORB_POS: DpVec = [0, DEEP_PAST_BASIN_Y + 11, 0];

const lerpVec = (a: DpVec, b: DpVec, t: number): DpVec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * The garden's mutation input from the world-changes feed (Phase 4).
 * Previews render only for pending proposals whose target resolves to
 * a position in this layout — a landmark at its seeded crown position,
 * a path between its two plots. Cluster/anchor/tone/brain kinds have
 * no garden geometry and are never invented a position for. A failed
 * fetch leaves the previous input untouched: the garden holds its
 * warmth rather than cooling on a network error.
 */
interface GardenWorldChanges {
  warmth: number;
  proposals: WorldChangeProposal[];
}

/**
 * Seed Pods harvest: how many pods were caught today, per brain, kept in
 * this browser (a per-viewer convenience — the real record is the review
 * log). Every access is guarded: private mode just starts from zero.
 */
/** How long the departure's align → spool plays: the server's cancel window for THIS journey (3 s homebound, 10 s otherwise —
 *  read from the journey itself, never a client constant), none for a turn-back. */
function armMsOf(j: { state: string; createdAt: string; cancelDeadline: string } | null | undefined): number {
  if (!j || j.state === "returning") return 0;
  const ms = Date.parse(j.cancelDeadline) - Date.parse(j.createdAt);
  return Number.isFinite(ms) && ms > 0 ? ms : TRAVEL_CANCEL_WINDOW_SECONDS * 1000;
}

function harvestKey(spaceId: string | null): string {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `garden.harvest.${spaceId ?? "local"}.${day}`;
}
export function readHarvest(spaceId: string | null): number {
  try {
    return Math.max(0, Number(localStorage.getItem(harvestKey(spaceId))) || 0);
  } catch {
    return 0;
  }
}
export function bumpHarvest(spaceId: string | null): number {
  const next = readHarvest(spaceId) + 1;
  try {
    localStorage.setItem(harvestKey(spaceId), String(next));
  } catch {
    /* private mode: the count lives for this stay only */
  }
  return next;
}

/** The most a world waits for its Journeys / links / reviews / tends before building (see sceneLayout). */
export const WORLD_DATA_GRACE_MS = 8000;

/** What the garden opens when her ship arrives (garden v2 walk). */
type GardenArrival = { kind: "plot" | "pod"; nodeId: number } | { kind: "grove"; journeyId: number };

function gardenMutationFrom(
  wc: GardenWorldChanges | null,
  layout: GardenLayout | undefined,
  events: { landings: GardenMutationLanding[]; undos: GardenMutationUndo[] },
): GardenMutationInput {
  const previews: GardenMutationPreview[] = [];
  if (wc && layout) {
    const byId = new Map(layout.plots.map((p) => [p.nodeId, p]));
    for (const p of wc.proposals) {
      if (p.status !== "pending") continue;
      const target = resolveWorldChangeTarget(p.target);
      if (target.kind === "landmark") {
        previews.push({
          proposalId: p.id,
          kind: "landmark",
          title: p.title,
          ...landmarkPositionFor(target.journeyId),
        });
      } else if (target.kind === "path") {
        const a = byId.get(target.fromNodeId);
        const b = byId.get(target.toNodeId);
        if (!a || !b) continue; // unresolvable: never invented
        previews.push({
          proposalId: p.id,
          kind: "path",
          title: p.title,
          from: { x: a.x, y: a.y, z: a.z },
          to: { x: b.x, y: b.y, z: b.z },
          fromNodeId: target.fromNodeId,
          toNodeId: target.toNodeId,
        });
      }
    }
  }
  return { warmth: wc?.warmth ?? 0, previews, landings: events.landings, undos: events.undos };
}

/** A decided proposal as a scene landing/undo — null when it has no garden form. */
function proposalToGardenMotion<T extends GardenMutationLanding | GardenMutationUndo>(
  proposal: WorldChangeProposal,
  layout: GardenLayout | undefined,
): T | null {
  const target = resolveWorldChangeTarget(proposal.target);
  if (target.kind === "landmark") {
    return {
      proposalId: proposal.id,
      kind: "landmark",
      title: proposal.title,
      journeyId: target.journeyId,
      ...landmarkPositionFor(target.journeyId),
    } as T;
  }
  if (target.kind === "path" && layout) {
    const byId = new Map(layout.plots.map((p) => [p.nodeId, p]));
    const a = byId.get(target.fromNodeId);
    const b = byId.get(target.toNodeId);
    if (!a || !b) return null;
    return {
      proposalId: proposal.id,
      kind: "path",
      title: proposal.title,
      from: { x: a.x, y: a.y, z: a.z },
      to: { x: b.x, y: b.y, z: b.z },
      fromNodeId: target.fromNodeId,
      toNodeId: target.toNodeId,
    } as T;
  }
  return null;
}

function isGardenLayout(
  layout: GardenLayout | DeepPastLayout | PeopleLayout | QuietArchiveLayout | ScaleLayout | undefined,
): layout is GardenLayout {
  return !!layout && "plots" in layout;
}

function isDeepPastLayout(
  layout: GardenLayout | DeepPastLayout | PeopleLayout | QuietArchiveLayout | ScaleLayout | undefined,
): layout is DeepPastLayout {
  return !!layout && "members" in layout;
}

function isPeopleLayout(
  layout: GardenLayout | DeepPastLayout | PeopleLayout | QuietArchiveLayout | ScaleLayout | undefined,
): layout is PeopleLayout {
  return !!layout && "clusters" in layout && "eligibleCount" in layout;
}

function isQuietArchiveLayout(
  layout: GardenLayout | DeepPastLayout | PeopleLayout | QuietArchiveLayout | ScaleLayout | undefined,
): layout is QuietArchiveLayout {
  return !!layout && "loneLights" in layout;
}

function isScaleLayout(
  layout: GardenLayout | DeepPastLayout | PeopleLayout | QuietArchiveLayout | ScaleLayout | undefined,
): layout is ScaleLayout {
  return !!layout && "iss" in layout;
}

interface WorldSceneEntry {
  title: string;
  /** Shared lighting (graph/worldLighting.ts): the environment map + fill the glTF models need to read as lit. */
  light?: WorldLightRig;
  background: number;
  fogDensity: number;
  orbitRadius: number;
  orbitHeight: number;
  lookAtY: number;
  fallback: string;
  /**
   * Lowest camera height allowed in this world. Set only where the scene
   * has a floor to respect — the garden's camera never drops below its
   * lowest terrace, so no view can ever sink under the garden.
   */
  cameraFloorY?: number;
  build: (
    layout?: GardenLayout | DeepPastLayout | PeopleLayout | QuietArchiveLayout | ScaleLayout,
    /**
     * Relic visibility (relics increment): the scene calls this per relic
     * whose real GLB has actually loaded; the host records it so the
     * "something glimmers" find is offered only for a landed relic.
     */
    onRelicVisible?: (slug: string) => void,
  ) => WorldSceneHandle;
}

const EMPTY_GARDEN_LAYOUT: GardenLayout = {
  plots: [],
  paths: [],
  landmarks: [],
  groves: [],
  grovePaths: [],
  pods: [],
  meadowUnshown: 0,
  eligibleCount: 0,
  excludedCount: 0,
  omittedEdgeCount: 0,
};

const WORLD_SCENES: Record<string, WorldSceneEntry> = {
  "great-station": {
    title: "The Great Station",
    light: { env: 1.1, hemi: { sky: 0x9fb0ff, ground: 0x2a2036, intensity: 0.8 }, key: { color: 0xfff1dc, intensity: 3.0, from: [-500, 450, 350] } },
    background: STATION_PALETTE.indigo,
    fogDensity: 0.00016,
    orbitRadius: STATION_ORBIT_RADIUS,
    orbitHeight: STATION_ORBIT_HEIGHT,
    lookAtY: 0,
    fallback: "The Station view needs graphics support on this device — your journeys are unaffected.",
    build: (_layout, onRelicVisible) => createStationScene({ onRelicVisible }),
  },
  "growing-place": {
    title: "The Growing Place",
    light: { env: 0.5 },
    background: 0x0a2420,
    fogDensity: 0.00016,
    orbitRadius: 1150,
    orbitHeight: 300,
    lookAtY: 60,
    cameraFloorY: GARDEN_CAMERA_FLOOR_Y,
    fallback: "The garden view needs graphics support on this device — your memories are unaffected.",
    build: (layout, onRelicVisible) =>
      createGardenScene(
        isGardenLayout(layout) ? layout : EMPTY_GARDEN_LAYOUT,
        undefined,
        undefined,
        { onRelicVisible },
      ),
  },
  "deep-past": {
    title: "The Deep Past",
    light: { env: 0.6, hemi: { sky: 0xa890e8, ground: 0x2e1a48, intensity: 1.2 }, key: { color: 0xb8a8ff, intensity: 1.0, from: [300, 900, 200] } },
    background: 0x140d24,
    fogDensity: 0.00016,
    orbitRadius: 205,
    orbitHeight: 42,
    lookAtY: -80,
    fallback: "The Deep Past view needs graphics support on this device — your memories are unaffected.",
    build: (layout, onRelicVisible) =>
      createDeepPastScene(isDeepPastLayout(layout) ? layout : EMPTY_DEEP_PAST_LAYOUT, { onRelicVisible }),
  },
  people: {
    title: "The People",
    light: { env: 0.6, hemi: { sky: 0xffdcb0, ground: 0x3a2a20, intensity: 1.0 } },
    background: 0x1a120c,
    fogDensity: 0.00016,
    orbitRadius: 700,
    orbitHeight: 140,
    lookAtY: 0,
    fallback: "The People view needs graphics support on this device — your people are unaffected.",
    build: (layout, onRelicVisible) =>
      createPeopleScene(isPeopleLayout(layout) ? layout : EMPTY_PEOPLE_LAYOUT, {
        onRelicVisible,
      }),
  },
  "quiet-archive": {
    title: "Quiet/Archive",
    light: { env: 0.6, hemi: { sky: 0xa8c0d8, ground: 0x1a2028, intensity: 1.0 } },
    background: 0x0d1117,
    fogDensity: 0.00016,
    orbitRadius: 700,
    orbitHeight: 140,
    lookAtY: 0,
    fallback: "The Archive view needs graphics support on this device — your memories are unaffected.",
    build: (layout) =>
      createQuietArchiveScene(isQuietArchiveLayout(layout) ? layout : EMPTY_QUIET_ARCHIVE_LAYOUT),
  },
  // The Faded Ward (a door in the story, opened by finding Tamsin's Ward): one long hall of cots, pale green and ember gold, the far end lost in fog.
  "faded-ward": {
    title: "The Faded Ward",
    // Measured in a real browser: env 0.6 + a bright fill washed the hall to flat grey. Dimmer fill, a warm key, thinner fog — the lanterns carry the light.
    light: { env: 0.3, hemi: { sky: 0x9fb8a8, ground: 0x0e1612, intensity: 0.55 }, key: { color: 0xffd9a0, intensity: 0.8, from: [120, 400, 300] } },
    background: 0x0a100e,
    fogDensity: 0.00035,
    orbitRadius: WARD_ORBIT_RADIUS,
    orbitHeight: WARD_ORBIT_HEIGHT,
    lookAtY: 42, // eye level, looking along the rows rather than down at the floor
    fallback: "The ward view needs graphics support on this device — your memories are unaffected.",
    build: () => createWardScene(),
  },
  // The Road to the Seam (a door in the story, opened by finding Teru's Harbor Nail): one long road under the Station, lamps and nails and chalk, going on into fog.
  "road-to-the-seam": {
    title: "The Road to the Seam",
    light: { env: 0.5, hemi: { sky: 0x9aaac8, ground: 0x2a2e38, intensity: 1.0 }, key: { color: 0xffd9a0, intensity: 1.0, from: [-100, 380, 260] } },
    background: 0x0a0c10,
    fogDensity: 0.00045,
    orbitRadius: ROAD_ORBIT_RADIUS,
    orbitHeight: ROAD_ORBIT_HEIGHT,
    lookAtY: 38, // eye level along the road, as measured in the Ward
    fallback: "The road view needs graphics support on this device — your memories are unaffected.",
    build: () => createRoadScene(),
  },
  // The Village (a door in the story, opened by finding the Thread of Many): a hillside village at night, every window lit, a path of gold hooks climbing to a luminous doorway.
  // The Unmade Hour (a door in the story, opened by finding the Lullaby's Hollow): the first Sixth Hour — a wide pale floor that remembers nothing.
  // The Siege of the First Light (a door in the story, opened by finding Oru's Bead): a broad pale field of crescent edges leaning toward a small bead of light.
  // The Unlit Hulls (a door in the story, opened by finding the Blank Nameplate): a vast, dim shipyard of unlit hulls and a seventh slip of ribs.
  // The Long Morning (a door in the story, opened by finding the Unnumbered Fragment): warm light with no horizon, a ring of ruled leaves, faceless columns of light.
  // The Folded Letter (the last room, a door in the story opened by holding the Unopened Fold; reached only by choice): a small bare room with a letter on the floor, still folded.
  "the-folded-letter": {
    title: "The Folded Letter",
    light: { env: 0.4, hemi: { sky: 0x8890a8, ground: 0x4a3f34, intensity: 0.7 }, key: { color: 0xffd9a0, intensity: 0.8, from: [-60, 300, 120] } },
    background: 0x0a0a10,
    fogDensity: 0.0003,
    orbitRadius: FOLD_ORBIT_RADIUS,
    orbitHeight: FOLD_ORBIT_HEIGHT,
    lookAtY: 14,
    fallback: "The room needs graphics support on this device — your memories are unaffected.",
    build: () => createFoldScene(),
  },
  "the-long-morning": {
    title: "The Long Morning",
    light: { env: 1.0, hemi: { sky: 0xfff4d8, ground: 0xe8cc90, intensity: 1.0 }, key: { color: 0xfff6e0, intensity: 0.8, from: [-200, 400, 220] } },
    background: LONG_SKY,
    fogDensity: 0.0011,
    orbitRadius: LONG_ORBIT_RADIUS,
    orbitHeight: LONG_ORBIT_HEIGHT,
    lookAtY: 40,
    fallback: "The light needs graphics support on this device — your memories are unaffected.",
    build: () => createLongScene(),
  },
  "the-yard": {
    title: "The Unlit Hulls",
    light: { env: 0.8, hemi: { sky: 0xb8c0d8, ground: 0x4a4238, intensity: 1.0 }, key: { color: 0xffe8c8, intensity: 1.1, from: [-220, 400, 200] } },
    background: 0x12141c,
    fogDensity: 0.0004,
    orbitRadius: YARD_ORBIT_RADIUS,
    orbitHeight: YARD_ORBIT_HEIGHT,
    lookAtY: 26,
    fallback: "The yard needs graphics support on this device — your memories are unaffected.",
    build: () => createYardScene(),
  },
  "the-siege": {
    title: "The Siege of the First Light",
    light: { env: 0.8, hemi: { sky: 0xd8d4e8, ground: 0x4a4638, intensity: 1.0 }, key: { color: 0xfff0d0, intensity: 1.1, from: [-200, 420, 260] } },
    background: 0x1a1620,
    fogDensity: 0.0004,
    orbitRadius: SIEGE_ORBIT_RADIUS,
    orbitHeight: SIEGE_ORBIT_HEIGHT,
    lookAtY: 24,
    fallback: "The field needs graphics support on this device — your memories are unaffected.",
    build: () => createSiegeScene(),
  },
  "the-unmade-hour": {
    title: "The Unmade Hour",
    light: { env: 0.7, hemi: { sky: 0xb8b4d8, ground: 0x3a3648, intensity: 1.0 }, key: { color: 0xf0e8ff, intensity: 1.0, from: [-150, 400, 200] } },
    background: 0x14121e,
    fogDensity: 0.0004,
    orbitRadius: UNMADE_ORBIT_RADIUS,
    orbitHeight: UNMADE_ORBIT_HEIGHT,
    lookAtY: 30,
    fallback: "The pale floor needs graphics support on this device — your memories are unaffected.",
    build: () => createUnmadeScene(),
  },
  "the-village": {
    title: "The Village",
    light: { env: 0.5, hemi: { sky: 0x9aaac8, ground: 0x1c2420, intensity: 0.9 }, key: { color: 0xffd9a0, intensity: 0.9, from: [-200, 420, 300] } },
    background: 0x0a0e14,
    fogDensity: 0.0003,
    orbitRadius: VILLAGE_ORBIT_RADIUS,
    orbitHeight: VILLAGE_ORBIT_HEIGHT,
    lookAtY: 40,
    fallback: "The village view needs graphics support on this device — your memories are unaffected.",
    build: () => createVillageScene(),
  },
  scale: {
    title: "Scale",
    light: { env: 0.9, hemi: { sky: 0x9fb0ff, ground: 0x2a2036, intensity: 0.5 } },
    background: 0x000000,
    fogDensity: 0,
    orbitRadius: 320,
    orbitHeight: 60,
    lookAtY: 0,
    fallback: "The Scale view needs graphics support on this device — your journeys are unaffected.",
    build: (layout, onRelicVisible) =>
      createScaleScene(isScaleLayout(layout) ? layout : EMPTY_SCALE_LAYOUT, { onRelicVisible }),
  },
  // Eternity's world (B-01 gated — the server admits the journey, the
  // board offers it only when the gate stands open): the white void
  // where Eternity himself stands. The host's orbit frames the whole
  // figure; his gestures and tools ride the header buttons below, and
  // his words appear in the world, near his mouth — never as a panel
  // over the view.
  eternity: {
    title: "Eternity's World",
    background: ETERNITY_PALETTE.voidWhite,
    fogDensity: ETERNITY_PALETTE.fogDensity,
    orbitRadius: ETERNITY_ORBIT_RADIUS,
    orbitHeight: ETERNITY_ORBIT_HEIGHT,
    lookAtY: ETERNITY_ORBIT_LOOK_AT_Y,
    fallback: "Eternity's world needs graphics support on this device — your journeys are unaffected.",
    build: () => {
      const s = createEternityScene();
      return {
        group: s.group,
        update: s.update,
        dispose: s.dispose,
        eternity: {
          setGesture: s.setGesture,
          useTool: s.useTool,
          shakeAt: s.shakeAt,
          currentGesture: s.currentGesture,
        },
      };
    },
  },
};

/** The worlds with scenes — the only worlds a relic find can happen in. */
function isSceneRelicWorld(key: string): key is RelicWorld {
  return (
    key === "great-station" ||
    key === "growing-place" ||
    key === "deep-past" ||
    key === "people"
  );
}

/** One person in the world you are in, with what they are doing right now (shared/societyLife.ts — the same answer the server would give). */
interface PresentNpc {
  id: string;
  activity: string;
  /** True when what they are doing is their own (not a trade/debate with someone), so the Station controller's patrol phase may name it instead. */
  solo: boolean;
  faction: string | null;
  faith: string;
  calling: string | null;
  topic: string | null;
}

function buildPresent(world: string | null, society: SocietyDay, nowMs: number): PresentNpc[] {
  if (!world) return [];
  return worldLife(world, nowMs, society).map((l) => ({
    id: l.member.id,
    activity: l.doing.caption,
    solo: !l.doing.partnerId,
    faction: l.factionName,
    faith: faithLabel(l.faith),
    calling: l.calling,
    topic: l.doing.topic,
  }));
}

export default function WorldsSurface({
  enabled = WORLDS_TRAVEL_ENABLED,
  graph = null,
  onChanged,
  getFleetStatus,
  onFocus,
  onHangarEquipChanged,
  onGardenChanged,
  equippedTrail = "blue",
  spaceId = "",
}: {
  enabled?: boolean;
  graph?: GraphData | null;
  /**
   * Verb 1 (Tend a plot): fired after a tend changes the graph, so the
   * host re-reads the brain and the garden re-renders warm. The result
   * carries the new node id (line tends), so the host can complete the
   * graph with it.
   */
  onChanged?: (result: TendResult) => void;
  /** Live fleet status from the galaxy scene, for the interior's fleet rooms (same getter RightDock uses). */
  getFleetStatus?: () => FleetStatus | undefined;
  /** Focus a memory in the galaxy, for the interior's fleet fly-to chips (same callback RightDock uses). */
  onFocus?: (id: number) => void;
  /** Fired when the interior's hangar pick changes, so the host refreshes its own hangar copies. */
  onHangarEquipChanged?: () => void;
  /** Garden v2: a grove action changed the brain (mission done, step planted, memory placed). */
  onGardenChanged?: (newNodeIds?: number[]) => void;
  /** The brain the viewer is in; the relic find is recorded per space. */
  spaceId?: string;
  /** The trail colour she wears (blue / neon / gold / purple): the flame and trail come off her ship in it, everywhere. */
  equippedTrail?: string;
}) {
  const travel = useTravel(enabled);
  const { state: relicBuffs } = useRelicBuffs(enabled);
  const stickyRisenRef = useRef<Set<number>>(new Set());
  const [stickyRisenTick, setStickyRisenTick] = useState(0);
  const [findError, setFindError] = useState<string | null>(null);
  // Relics I-4: the relic whose dwell-and-claim moment is in progress.
  const [settlingRelic, setSettlingRelic] = useState<string | null>(null);
  // Relics I-7: the hunt's visible state — the latest relics state view
  // (the buffs hook's, refreshed by every claim answer, which carries a
  // fresh state on success AND refusal) and the per-relic claim notices
  // (the server's plain refusal sentences, shown beside their glimmer).
  const [relicState, setRelicState] = useState<RelicsState | null>(null);
  // Adopt the hook's view only as the FIRST load (review P2-3): a late
  // hook fetch must never overwrite a fresher claim answer's state.
  useEffect(() => { if (relicBuffs) setRelicState((prev) => prev ?? relicBuffs); }, [relicBuffs]);
  const [claimNotices, setClaimNotices] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState(false);
  // The scene layer never takes over the screen just because the SERVER remembers where you
  // were (a saved world, or a journey the last session never finished — the old build never
  // arrived anyone, so those are common). Opening the app lands in the home galaxy; the layer
  // wakes only when the traveller does something in THIS session: departs (the travel panel,
  // a tour leg), or asks to look around the world they are in. A departure is the signal, not
  // an arrival — so a stale journey resolving in the background stays silent.
  const [engaged, setEngaged] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const onChanged = (e: Event) => {
      if ((e as CustomEvent<TravelChangedDetail>).detail?.action === "depart") setEngaged(true);
    };
    const onEnter = () => {
      setEngaged(true);
      setDismissed(false);
    };
    window.addEventListener(TRAVEL_CHANGED_EVENT, onChanged);
    window.addEventListener(ENTER_WORLD_EVENT, onEnter);
    return () => {
      window.removeEventListener(TRAVEL_CHANGED_EVENT, onChanged);
      window.removeEventListener(ENTER_WORLD_EVENT, onEnter);
    };
  }, [enabled]);
  // The travel panel and the map name the place the SERVER holds. The app opens in the home galaxy, so
  // if the server still has the traveller out in a world (the app was closed out there, or an old
  // instant return), settle it ONCE as soon as the state first loads — otherwise they would say "you
  // are in the Station" over a view of the galaxy. A journey in progress is the truth and is left alone.
  const reconciledRef = useRef(false);
  const engagedRef = useRef(false);
  engagedRef.current = engaged;
  useEffect(() => {
    const st = travel.state;
    if (!enabled || !st || reconciledRef.current) return;
    reconciledRef.current = true;
    if (engagedRef.current || st.activeJourney || st.currentWorld === "home") return;
    void recallHome().then((changed) => {
      if (changed) void travel.refresh().then(() => announceTravelChanged("arrive"));
    });
  }, [enabled, travel.state, travel.refresh]);
  const [graphicsFailed, setGraphicsFailed] = useState(false);
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [journeysFailed, setJourneysFailed] = useState(false);
  const [dueReviews, setDueReviews] = useState<DueReview[] | null>(null);
  const [tendsLoaded, setTendsLoaded] = useState(false);
  // Longest a world waits for its data before building with what it has.
  const [dataGraceOver, setDataGraceOver] = useState(false);
  const [journeyLinksMap, setJourneyLinksMap] = useState<Map<number, JourneyLinkSummary[]> | null>(null);
  const [archivedGraph, setArchivedGraph] = useState<GraphData | null>(null);
  const [archivedFailed, setArchivedFailed] = useState(false);
  const [archivedRetry, setArchivedRetry] = useState(0);
  const [showController, setShowController] = useState(false);
  // Deep Past rework: mode machine (refs are what the frame loop reads;
  // the state mirrors exist only where the dock / labels need them).
  const dpModeRef = useRef<DpMode>("overview");
  const [dpMode, setDpMode] = useState<DpMode>("overview");
  const walkRefDp = useRef<DpWalkRt>({ s: 0, moving: false, dir: 1, atLanding: null });
  const [dpWalkMoving, setDpWalkMoving] = useState(false);
  const [dpAtLanding, setDpAtLanding] = useState<number | null>(null);
  const dpPerchRef = useRef<number>(0);
  const [dpPerchStratum, setDpPerchStratum] = useState<number>(0);
  /** Perch focus override: a member (approach) or an anchor line's top end. */
  const dpFocusRef = useRef<{ point: DpVec; nodeId?: number; stratum?: number } | null>(null);
  const rideRef = useRef<DpRideRt>({ phase: "atBerth", stop: 0, kindle: 0, pendingLeg: null, leg: null });
  const [dpRidePhase, setDpRidePhase] = useState<DpRideRt["phase"]>("atBerth");
  const [dpRideStop, setDpRideStop] = useState(0);
  /** The typed Deep Past scene handle (garden pattern: kept out of the
   *  WorldSceneHandle union so pickMember / setFrameState stay typed). */
  const deepPastSceneRef = useRef<DeepPastScene | null>(null);
  const dpCameraRef = useRef<THREE.Camera | null>(null);
  /** The previous layout this visit, for rise-glide / carry-in diffs on rebuild. */
  const dpPrevLayoutRef = useRef<DeepPastLayout | null>(null);
  /** Landing arc-length positions, computed per scene build from the walk curve. */
  const dpLandingsRef = useRef<{ stratum: number; s: number; point: DpVec }[]>([]);
  /** Per-frame scene frame state (kindle / stop / ship pose), applied after look. */
  const dpFrameRef = useRef<{
    kindle: number;
    currentStop: number;
    shipPose: { position: DpVec; target: DpVec } | null;
  }>({ kindle: 0, currentStop: -1, shipPose: null });
  const dpChaseRef = useRef<{ pos: DpVec } | null>(null);
  /** True after the traveller's first interaction this Deep Past visit
   *  (drives the AN9 idle-orbit rate and dismisses the arrival line). */
  const dpInteractedRef = useRef(false);
  const [dpArrivalDismissed, setDpArrivalDismissed] = useState(false);
  /** Set by the frame-loop effect's input handlers (they live outside React). */
  const dpInteractRef = useRef<() => void>(() => {});
  const lastLookInputRef = useRef(0);
  /** A glimmer find waiting for the flight to the basin to arrive. */
  const glimmerFindRef = useRef<RelicDef | null>(null);
  const findRelicRef = useRef<(relic: RelicDef) => void>(() => {});
  /** The member whose card is open (Deep Past approach, F9). */
  const [dpCardNode, setDpCardNode] = useState<number | null>(null);
  // NPC presence (docs/specs/npcs-alive-2026-10-30.md): the Station controller's patrol, her on-screen tag, and who you have met.
  const npcBodiesRef = useRef<NpcBodies | null>(null);
  const npcTagEls = useRef(new Map<string, HTMLButtonElement>());
  const npcPosRef = useRef(new Map<string, V3>());
  const npcNearRef = useRef(new Map<string, boolean>());
  const npcPhasesRef = useRef(new Map<string, string>());
  // Who is in this world right now (cast locations are clock-driven and shared with the server: shared/npcs.ts npcLocation).
  const [presentNpcs, setPresentNpcs] = useState<PresentNpc[]>([]);
  // Today's society (graph of factions, callings, ordinances): from the server, neutral until it lands or if reflection is off.
  const { society } = useSociety(enabled);
  const societyRef = useRef<SocietyDay>(society);
  societyRef.current = society;
  const metThisVisitRef = useRef<Set<NpcKey>>(new Set());
  // Today's batched NPC lines (one model call per brain per day, cached server-side) — fetched when you enter a world that has NPCs.
  const npcScriptRef = useRef<NpcDayScript | null>(null);
  // A tapped NPC's card (job, what they are doing, what is known of them).
  const [npcCard, setNpcCard] = useState<string | null>(null);
  // Talking to a person (S3 of docs/specs/living-worlds-dialogue-2026-10-31.md): they stop and face you while it is open. The ref feeds the frame loop.
  const [talkNpc, setTalkNpc] = useState<string | null>(null);
  const talkNpcRef = useRef<string | null>(null);
  talkNpcRef.current = talkNpc;
  // If they go (the clock moves them out of this world) the conversation ends with them.
  useEffect(() => {
    if (talkNpc && !presentNpcs.some((n) => n.id === talkNpc)) setTalkNpc(null);
  }, [talkNpc, presentNpcs]);
  const [npcNote, setNpcNote] = useState<string | null>(null);
  // Station interior (Wave 2, settled design): a mode of the Station
  // stay, not a world. `inside` swaps the exterior scene for the hall;
  // `interiorRoom` jumps instantly between the four rooms (no walking,
  // no glide — the room ref is what the frame loop reads). The stay
  // always opens on the hangar bay, the arrival room. `bayShipNonce`
  // rebuilds the hall when the hangar pick changes, so the docked ship
  // follows the newly picked skin.
  const [inside, setInside] = useState(false);
  const [interiorRoom, setInteriorRoom] = useState<InteriorRoomId>("hangar-bay");
  const interiorRoomRef = useRef<InteriorRoomId>("hangar-bay");
  const [bayShipNonce, setBayShipNonce] = useState(0);

  // Station arrival glide (A13): any pointer press skips it. Reset per stay.
  const arrivalSkippedRef = useRef(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Free look: the traveller's own drag / pinch / scroll, layered on the world's camera pose
  // (graph/worldLook.ts). A ref, not state — it changes every pointer move and must not re-render.
  const lookRef = useRef<LookState>(NO_LOOK);
  // Whether the camera is currently free (not in a scripted move). The frame loop sets it; input
  // is ignored while it is false so a drag can't build up an offset that then jumps in.
  const lookAllowedRef = useRef(false);
  // A drag that ends on the canvas is followed by a click; it must not count as a tap on the garden.
  const suppressClickRef = useRef(false);
  const [lookHint, setLookHint] = useState(false);
  // EVE-style travel HUD: the latest journey (read by the frame loop), the readout it shows, and the
  // overlays the frame loop drives directly (no re-render per frame).
  const journeyRef = useRef<typeof journey>(null);
  const [travelHud, setTravelHud] = useState<{ phase: string; countdown: number | null; eta: number; speed: number } | null>(null);
  const travelFlashRef = useRef<HTMLDivElement | null>(null);
  const travelBlurRef = useRef<HTMLDivElement | null>(null);
  const prevModeRef = useRef<string | null>(null);
  const [arrivalFadeKey, setArrivalFadeKey] = useState(0);
  // Arriving HOME (owner: Soumaya warps back, no hard cut): the worlds layer is gone but the arrival still fades in over the galaxy.
  const [homeArrivalKey, setHomeArrivalKey] = useState(0);
  // Flight inside a world (docs/specs/worlds-flight-2026-10-29.md): null = the overview orbit camera.
  const flightRef = useRef<FlightState | null>(null);
  // The big bodies you can approach but never reach (graph/bodyShell.ts): refreshed once a second from the scene's own planet holders.
  const shellsRef = useRef<Shell[]>([]);
  const flightTargetRef = useRef<Place | null>(null);
  const overviewCamRef = useRef<{ pos: V3; look: V3 }>({ pos: [0, 100, 600], look: [0, 0, 0] });
  const chaseCamRef = useRef<{ pos: V3; target: V3 } | null>(null);
  const placesSigRef = useRef("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [flightTargetId, setFlightTargetId] = useState<string | null>(null);
  const [flightCaption, setFlightCaption] = useState<string | null>(null);
  const placesRef = useRef<Place[]>([]);
  const lookedRef = useRef<() => void>(() => {});
  // Garden v2 walk (graph/gardenWalk.ts): where her ship is and where it's
  // going, the follow camera's own (smoothed) pose, and what to open when
  // she arrives. Refs — the frame loop moves them every frame — so a scene
  // rebuild (new layout, a tend) never loses her place.
  const walkRef = useRef<WalkState>(initialWalk());
  const followRef = useRef<{ yaw: number; y: number; cam: [number, number, number] | null }>({ yaw: 0, y: 0, cam: null });
  const arrivalRef = useRef<GardenArrival | null>(null);
  const onArriveRef = useRef<(a: GardenArrival) => void>(() => {});
  const [grovesOpen, setGrovesOpen] = useState(false);
  // Garden v2 step 3: the grove whose sheet is open, the memory her ship is
  // carrying, and a counter that re-reads Journeys + links after a change.
  const [groveSheet, setGroveSheet] = useState<number | null>(null);
  const [carrying, setCarrying] = useState<number | null>(null);
  const [gardenVersion, setGardenVersion] = useState(0);
  // Growing Place guidance (graph/gardenGuide.ts): where she is walking, the last
  // result line, the first-visit steps (per brain) and the garden day's beats.
  const [walkingTo, setWalkingTo] = useState<string | null>(null);
  const [gardenResult, setGardenResult] = useState<string | null>(null);
  const [guide, setGuide] = useState<GuideProgress>(EMPTY_GUIDE);
  const [gardenDay, setGardenDay] = useState<DayState>({ ...EMPTY_DAY, bloomed: false });
  // Garden v2 step 4 (Seed Pods): the pod being recalled, pods set aside
  // ("Not today") or caught this stay, and today's harvest count.
  const [recallPod, setRecallPod] = useState<number | null>(null);
  const [podsAside, setPodsAside] = useState<Set<number>>(new Set());
  const [harvest, setHarvest] = useState(0);
  // A pod caught but whose sheet is still open: already counted, no longer waiting.
  const [justCaught, setJustCaught] = useState<number | null>(null);
  const carryingRef = useRef<number | null>(null);
  carryingRef.current = carrying;
  // The mounted scene handle — the Eternity gesture/tool buttons below
  // call into it. Set in the mount effect, cleared in its cleanup.
  const sceneHandleRef = useRef<WorldSceneHandle | null>(null);
  const trailRef = useRef(equippedTrail);
  trailRef.current = equippedTrail;
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  useEffect(
    () => () => {
      const r = rendererRef.current;
      if (!r) return;
      releaseHomeSky(r);
      r.dispose();
      rendererRef.current = null;
    },
    [],
  );
  const [eternityGesture, setEternityGesture] = useState<string | null>(null);  // Verb 1 (Tend a plot): the garden's suggestions, recent tends (the warm
  // glow and lit paths), and the plot the tend sheet is open for.
  const [suggestions, setSuggestions] = useState<GardenSuggestion[] | null>(null);
  const [suggestionsHidden, setSuggestionsHidden] = useState(false);
  const [recentTends, setRecentTends] = useState<GardenTend[]>([]);
  const [tendNode, setTendNode] = useState<GraphNode | null>(null);
  const gardenSceneRef = useRef<GardenScene | null>(null);
  const gardenCameraRef = useRef<THREE.Camera | null>(null);
  const shownSuggestionsRef = useRef<number[]>([]);
  const pickedSuggestionRef = useRef<number | null>(null);
  const suggestionsFetchedRef = useRef(false);
  // Garden mutation feed (Phase 4): the world-changes state + pending
  // proposals the garden renders from, and the transient landings/undos
  // the inbox's decisions announce. The scene never fetches; this host
  // pushes what it is given, and a failed fetch leaves the previous
  // input untouched.
  const [worldChanges, setWorldChanges] = useState<GardenWorldChanges | null>(null);
  const [worldChangesRetry, setWorldChangesRetry] = useState(0);
  const [mutationVersion, setMutationVersion] = useState(0);
  const pendingMutationRef = useRef<{ landings: GardenMutationLanding[]; undos: GardenMutationUndo[] }>({
    landings: [],
    undos: [],
  });
  const layoutRef = useRef<GardenLayout | undefined>(undefined);
  const atGardenRef = useRef(false);

  // Relics (relics increment): slugs whose GLB has actually landed in the
  // current world's scene, and the per-space found record. A find is
  // offered only for a visible relic that has not been found yet.
  const [visibleRelics, setVisibleRelics] = useState<string[]>([]);
  const foundRelics = useFoundRelics(spaceId || null);
  const handleRelicVisible = useCallback((slug: string) => {
    setVisibleRelics((v) => (v.includes(slug) ? v : [...v, slug]));
  }, []);

  const currentWorld = travel.state?.currentWorld;
  /** True once this world's purpose line has been shown (read when the hint renders; it flips only after the hint ends). */
  const purposeShown = (() => {
    try {
      return !worldPurpose(currentWorld) || localStorage.getItem(purposeSeenKey(currentWorld ?? "")) === "1";
    } catch {
      return false;
    }
  })();
  const journey = travel.state?.activeJourney ?? null;
  const atWorld =
    enabled && !!currentWorld && currentWorld in WORLD_SCENES && !journey;
  const inTransit =
    enabled &&
    !!journey &&
    (journey.state === "in_transit" || journey.state === "returning");
  // The departure cinematic (align → spool) plays through the server's cancel window, so the
  // flight scene is up from the moment the traveller departs (docs/specs/eve-travel-2026-10-29.md).
  const arming = enabled && !!journey && journey.state === "arming";
  const inFlightScene = inTransit || arming;
  const transitKind = inFlightScene ? journey.kind : null;
  const transitTotalMs = transitKind ? TRANSIT_MS[transitKind] : 0;
  const mode = inFlightScene ? "transit" : atWorld ? "world" : null;
  const visible = !!mode && !dismissed && engaged;
  // Noticing things: stay still to regard or listen; met people and found relics are reported to the Book (the server validates every find).
  const story = useStoryNotice({
    active: !!mode && mode === "world" && !dismissed && engaged,
    world: currentWorld,
    notify: (t) => pushToast(t, "✦", 6500, "normal"),
    // The viewer for the lore's physical spots: her ship once she is out and parked (the flight worlds), or her walking in the garden. Null = no one is out there to be still.
    reach: () => {
      if (!currentWorld) return null;
      if (currentWorld === "growing-place") {
        const w = walkRef.current;
        return w.route.length === 0 ? makeReach(currentWorld, null, [w.pos.x, 0, w.pos.z]) : null;
      }
      if (currentWorld === "eternity") return makeReach(currentWorld, null, overviewCamRef.current.pos);
      const fl = flightRef.current;
      const root = sceneHandleRef.current?.group;
      if (!fl || !root || fl.phase !== "idle") return null;
      root.updateMatrixWorld(true);
      return makeReach(currentWorld, root, fl.pos);
    },
  });
  const storyRef = useRef(story);
  storyRef.current = story;
  // Places with a past (S4, shared/placeLore.ts): when she is parked beside a landmark that has something to say, offer to look closely. Scenery only — nothing is found or scored here.
  const [inspect, setInspect] = useState<PlaceLore | null>(null);
  const [reading, setReading] = useState<PlaceLore | null>(null);
  useEffect(() => {
    if (!visible || mode !== "world" || !currentWorld) {
      setInspect(null);
      setReading(null);
      return;
    }
    const tick = () => {
      let here: PlaceLore | null = null;
      if (currentWorld === "growing-place") {
        const w = walkRef.current;
        if (w.route.length === 0) here = inspectablesHere(currentWorld, null, [w.pos.x, 0, w.pos.z])[0] ?? null;
      } else {
        const fl = flightRef.current;
        const root = sceneHandleRef.current?.group;
        if (fl && root && fl.phase === "idle") {
          root.updateMatrixWorld(true);
          here = inspectablesHere(currentWorld, root, fl.pos)[0] ?? null;
        }
      }
      setInspect((cur) => (cur?.id === here?.id ? cur : here));
    };
    tick();
    const id = window.setInterval(tick, 800);
    return () => window.clearInterval(id);
  }, [visible, mode, currentWorld]);
  // Walk or fly away and the passage closes with the place.
  useEffect(() => {
    if (reading && inspect?.id !== reading.id) setReading(null);
  }, [inspect, reading]);
  // Eternity acts on his own (the server decides and logs; this only plays a fresh act once, while you are there).
  useEternityAutonomy(visible && mode === "world" && currentWorld === "eternity", (p) => {
    const e = sceneHandleRef.current?.eternity;
    if (!e) return;
    if (p.kind === "gesture") e.setGesture(p.gesture);
    else e.useTool(p.tool);
  });
  // The HUD stays on screen in every scene (docs/specs/persistent-hud-2026-10-30.md): the body class lets the stylesheet
  // keep the core buttons above the world, hide the galaxy-camera controls, and calm the HUD during the warp.
  useEffect(() => {
    const b = document.body;
    b.classList.toggle("in-world", visible);
    b.classList.toggle("in-transit", visible && mode === "transit");
    return () => b.classList.remove("in-world", "in-transit");
  }, [visible, mode]);
  // Tell the home galaxy it is covered, so it stops rendering (Graph3D listens).
  useEffect(() => {
    announcePlace(visible, { world: visible && mode === "world" ? (currentWorld ?? null) : null, transit: visible && mode === "transit" });
    return () => announcePlace(false, HOME_PLACE);
  }, [visible, mode, currentWorld]);
  // "Take me home" from elsewhere (the Observatory's place card): the same warp as the ← Galaxy button.
  // A new stay is a new visit: encounters can happen again (the 20-minute cooldown still applies). Who is here is recomputed every half minute from the
  // clock (people come and go between worlds); Eternity — cosmic, with no ship — is "met" a few seconds after you arrive in his world.
  useEffect(() => {
    metThisVisitRef.current = new Set();
    npcNearRef.current = new Map();
    npcPosRef.current = new Map();
    npcPhasesRef.current = new Map();
    setNpcNote(null);
    setNpcCard(null);
    setTalkNpc(null);
    const active = visible && mode === "world" && !!currentWorld;
    const compute = () => castIn(active ? currentWorld : null, Date.now());
    let before = new Set<string>(compute().map((m) => m.id));
    const toList = () => buildPresent(active ? currentWorld : null, societyRef.current, Date.now());
    setPresentNpcs(toList());
    // The day's script is one cached read (the first of the day makes the single model call); offline lines if it never arrives.
    let scriptReady: Promise<unknown> = Promise.resolve();
    if (active && before.size > 0) {
      scriptReady = getNpcScript().then((sc) => {
        npcScriptRef.current = sc;
      });
    }
    let cancelled = false;
    const tick = window.setInterval(() => {
      if (!active) return;
      const now = compute();
      const ids = new Set(now.map((m) => m.id));
      for (const m of now) if (!before.has(m.id)) setNpcNote(`${m.name} has arrived.`);
      for (const id of before) if (!ids.has(id)) setNpcNote(`${castMember(id)?.name ?? "Someone"} has gone elsewhere.`);
      before = ids;
      setPresentNpcs(toList());
    }, 30_000);
    let t = 0;
    if (active && currentWorld === "eternity") {
      const e = castMember("eternity")!;
      t = window.setTimeout(async () => {
        // Give the day's script (its first read of the day is the one model call) a few seconds; the offline line covers a slow one.
        await Promise.race([scriptReady, new Promise((r) => window.setTimeout(r, 6000))]);
        if (cancelled) return;
        metThisVisitRef.current.add(e.id);
        const m = recordMeeting(getSpaceId(), e.id);
        if (m.recorded) {
          pushToast(encounterLine(e, "eternity", null, m.first, npcScriptRef.current, m.count), "✦", 7000, "normal");
          void storyRef.current.onMeeting(e.id, m.count);
        }
      }, 4000);
    }
    return () => {
      cancelled = true;
      window.clearInterval(tick);
      window.clearTimeout(t);
    };
  }, [visible, mode, currentWorld]);
  // The society changed (it loaded, or reflection was toggled): re-read what everyone is doing.
  useEffect(() => {
    if (!(visible && mode === "world" && currentWorld)) return;
    setPresentNpcs(buildPresent(currentWorld, society, Date.now()));
  }, [society, visible, mode, currentWorld]);
  const goHomeRef = useRef<() => void>(() => {});
  useEffect(() => {
    const on = () => goHomeRef.current();
    window.addEventListener(GO_HOME_EVENT, on);
    return () => window.removeEventListener(GO_HOME_EVENT, on);
  }, []);
  journeyRef.current = journey;
  // The instant return only hides the layer; tell the server too, so the panel/map agree with the view.
  const leaveInstantly = () => {
    setDismissed(true);
    void recallHome().then((changed) => {
      if (changed) void travel.refresh();
    });
  };
  const goHome = async () => {
    if (mode !== "world" || currentWorld === "home" || !travel.state) {
      setDismissed(true);
      return;
    }
    try {
      const j = await travel.depart("warp", "home");
      if (!j) leaveInstantly(); // couldn't arm the trip — the instant return still works
    } catch {
      leaveInstantly();
    }
  };
  goHomeRef.current = () => void goHome();
  const refreshTravelRef = useRef<() => Promise<void>>(async () => {});
  refreshTravelRef.current = travel.refresh;
  const lastDepartPollRef = useRef(0);
  // Arriving: the flight hands over to the world with a fade, not a cut (the world's models were prefetched).
  useEffect(() => {
    if (prevModeRef.current === "transit" && mode === "world") setArrivalFadeKey((k) => k + 1);
    if (prevModeRef.current === "transit" && mode === null && currentWorld === "home") setHomeArrivalKey((k) => k + 1);
    prevModeRef.current = mode;
  }, [mode, currentWorld]);
  // A different world (or leaving) starts over from the overview, with no places until its models are in.
  useEffect(() => {
    flightRef.current = null;
    flightTargetRef.current = null;
    chaseCamRef.current = null;
    placesSigRef.current = "";
    placesRef.current = [];
    setPlaces([]);
    setFlightTargetId(null);
    setFlightCaption(null);
  }, [currentWorld, mode]);

  // Fly to a place: the ship (true size) aligns, spools, burns and stops at a stand-off. The first flight starts
  // from just ahead of the overview camera, so the view carries on from where you were looking.
  const flyTo = (place: Place) => {
    let fs = flightRef.current;
    if (!fs) {
      const { pos, look } = overviewCamRef.current;
      const start: V3 = [pos[0] + (look[0] - pos[0]) * 0.3, pos[1] + (look[1] - pos[1]) * 0.3, pos[2] + (look[2] - pos[2]) * 0.3];
      const dir = [look[0] - start[0], look[1] - start[1], look[2] - start[2]];
      const h = Math.hypot(dir[0]!, dir[2]!);
      fs = initialFlight(start, Math.atan2(dir[0]!, dir[2]!), Math.atan2(dir[1]!, Math.max(h, 1e-6)));
      chaseCamRef.current = { pos, target: look };
    }
    const started = startFlight(fs, { center: place.center, radius: place.radius });
    // A planet is approached, never reached: the stop point is pushed out to the body's shell (EVE-style).
    const stop = pushOutOfShells(started.to, shellsRef.current);
    flightRef.current = stop === started.to ? started : { ...started, to: stop };
    flightTargetRef.current = place;
    setFlightTargetId(place.id);
    setFlightCaption(`Aligning to ${place.label}`);
  };
  // Tap to fly (docs/specs/lore-physical-spots-2026-10-31.md): a tap on the scene sends the ship to that point — the way to traverse a world and reach the places the lore lives.
  const flyToPointRef = useRef<(p: V3) => void>(() => {});
  flyToPointRef.current = (p: V3) => flyTo({ id: "tap", label: "that spot", icon: "i:rocket", center: p, radius: 14 });
  const backToOverview = () => {
    flightRef.current = null;
    flightTargetRef.current = null;
    chaseCamRef.current = null;
    glimmerFindRef.current = null; // leaving the flight cancels a pending glimmer find
    setFlightTargetId(null);
    setFlightCaption(null);
  };

  // First time in a world: say that it can be moved. Shown once per browser, gone on the first
  // gesture or after a few seconds — a world that silently ignored touch was the complaint.
  useEffect(() => {
    // Start when the world is actually ON SCREEN — not when the app loads at a saved world, whose
    // layer stays hidden until the traveller acts (the timer would run out before they ever got there).
    if (!enabled || !visible || mode !== "world") return;
    let seen = false;
    let purposeSeen = true;
    try {
      seen = localStorage.getItem("worlds.lookHintSeen") === "1";
      // Audit X4: the first time in each world it says what the world is for (before the look-around hint).
      purposeSeen = !worldPurpose(currentWorld) || localStorage.getItem(purposeSeenKey(currentWorld ?? "")) === "1";
    } catch {
      /* storage unavailable — show it; it just won't be remembered */
    }
    if (seen && purposeSeen) return;
    setLookHint(true);
    const done = () => {
      setLookHint(false);
      try {
        localStorage.setItem("worlds.lookHintSeen", "1");
        if (currentWorld && worldPurpose(currentWorld)) localStorage.setItem(purposeSeenKey(currentWorld), "1");
      } catch {
        /* ignore */
      }
    };
    lookedRef.current = done;
    const t = window.setTimeout(done, purposeSeen ? 9000 : 12000);
    return () => {
      window.clearTimeout(t);
      lookedRef.current = () => {};
    };
  }, [enabled, visible, mode, currentWorld]);
  const entry = atWorld && currentWorld ? WORLD_SCENES[currentWorld] : undefined;
  const atGarden = atWorld && currentWorld === "growing-place";
  const atStation = atWorld && currentWorld === "great-station";
  const atDeepPast = atWorld && currentWorld === "deep-past";
  const atPeople = atWorld && currentWorld === "people";
  const atQuietArchive = atWorld && currentWorld === "quiet-archive";
  const atScale = atWorld && currentWorld === "scale";
  const atEternity = atWorld && currentWorld === "eternity";
  // Worlds whose ground and sky are pale light (Eternity's white void, the Long Morning) take dark captions: the light-on-dark ones vanish into them.
  const atPaleWorld = atEternity || (atWorld && currentWorld === "the-long-morning");
  const worldName = (key: string) =>
    WORLD_CHART.find((w) => w.key === key)?.name ?? key;
  const transitTitle = inFlightScene ? `${arming ? "Departing for" : "Travelling to"} ${worldName(journey.destination)}` : "";
  const transitFallback =
    "The journey view needs graphics support on this device — your journey is unaffected.";

  // A new stay — a new world, or a new journey — reopens the view and
  // resets the Deep Past mode machine to overview. (A transit dismissed
  // mid-flight reopens at arrival: the destination scene is a new stay,
  // not the dismissed transit.)
  const journeyId = journey?.id ?? null;
  useEffect(() => {
    setDismissed(false);
    setGraphicsFailed(false);
    setVisibleRelics([]);
    setShowController(false);
    setInside(false);
    setInteriorRoom("hangar-bay");
    interiorRoomRef.current = "hangar-bay";
    // Deep Past: a new stay starts in overview with the arrival line
    // fresh; the walk's place and the ride's parked stop persist in
    // their refs across the visit's rebuilds (and across leaving and
    // returning within the session, as the old descent parking did).
    dpModeRef.current = "overview";
    setDpMode("overview");
    dpFocusRef.current = null;
    setDpCardNode(null);
    dpInteractedRef.current = false;
    setDpArrivalDismissed(false);
    arrivalSkippedRef.current = false;
    setEternityGesture(null);
  }, [mode, currentWorld, journeyId]);

  // Arrival. The transit flight is the journey: when its time is up the ship
  // arrives and the destination scene takes over — the scene layer does this
  // itself rather than waiting for a text button in the travel sheet. The
  // server accepts arrival whenever asked; this only decides WHEN to ask. The
  // clock runs from the server's departedAt, so a reload mid-flight resumes
  // rather than restarting, and reduced-motion travellers are never held.
  const departedAtMs = journey?.departedAt ? Date.parse(journey.departedAt) : NaN;
  useEffect(() => {
    if (!enabled || !inTransit || !journeyId) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = Number.isFinite(departedAtMs) ? departedAtMs : Date.now();
    const left = reduced ? 0 : Math.max(0, start + transitTotalMs - Date.now());
    const timer = window.setTimeout(() => void travel.arrive(), left);
    return () => window.clearTimeout(timer);
  }, [enabled, inTransit, journeyId, departedAtMs, transitTotalMs, travel.arrive]);

  // Entering the garden or the Deep Past starts a fresh wait for its data:
  // the previous stay's links / due reviews / tends must not count as ready.
  useEffect(() => {
    setDataGraceOver(false);
    if (!atGarden && !atDeepPast) return;
    setJourneys(null);
    setJourneysFailed(false);
    setJourneyLinksMap(null);
    setDueReviews(null);
    setTendsLoaded(false);
    const t = window.setTimeout(() => setDataGraceOver(true), WORLD_DATA_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [atGarden, atDeepPast]);

  // Landmarks (garden) and Chronicle routes (Deep Past) need the user's
  // Journeys; the graph prop already carries the memories. A failed fetch
  // omits that layer and says so — it never blocks the world, and it never
  // invents a landmark or a route.
  useEffect(() => {
    if (!atGarden && !atDeepPast) return;
    let cancelled = false;
    getJourneys()
      .then((js) => {
        if (!cancelled && js) setJourneys(js);
        else if (!cancelled) setJourneysFailed(true);
      })
      .catch(() => {
        if (!cancelled) setJourneysFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [atGarden, atDeepPast, gardenVersion]);

  // Verb 1 (Tend a plot): on garden arrival Soumaya suggests 3 plots, and
  // the garden reads its recent tends for the warm glow and lit paths.
  // Suggestions live in-world only — this fetch is the only place they
  // exist; nothing here notifies or digests. A failed fetch hides the
  // panel and says nothing — the garden is still there to wander. On
  // exit, the shown-but-not-picked suggestions are recorded (per space)
  // so an ignored one is never suggested twice in a row.
  useEffect(() => {
    if (!atGarden) return;
    let cancelled = false;
    // Each stay starts on the meadow, facing the tree.
    walkRef.current = initialWalk();
    followRef.current = { yaw: 0, y: 0, cam: null };
    arrivalRef.current = null;
    setGrovesOpen(false);
    setGroveSheet(null);
    setCarrying(null);
    setWalkingTo(null);
    setGardenResult(null);
    setGuide(readGuide(getSpaceId()));
    setGardenDay(readDay(getSpaceId()));
    setRecallPod(null);
    setPodsAside(new Set());
    setHarvest(readHarvest(getSpaceId()));
    setSuggestions(null);
    setSuggestionsHidden(false);
    setTendNode(null);
    shownSuggestionsRef.current = [];
    pickedSuggestionRef.current = null;
    suggestionsFetchedRef.current = false;
    const spaceId = getSpaceId();
    const ignored = spaceId ? readIgnoredSuggestionIds(spaceId) : [];
    getGardenSuggestions(ignored)
      .then((list) => {
        if (cancelled) return;
        suggestionsFetchedRef.current = true;
        shownSuggestionsRef.current = list.map((s) => s.nodeId);
        setSuggestions(list);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    getRecentGardenTends()
      .then((tends) => {
        if (cancelled) return;
        setRecentTends(tends);
        setTendsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setRecentTends([]);
        setTendsLoaded(true);
      });
    return () => {
      cancelled = true;
      // Record this stay's ignored suggestions for the next visit — but
      // only if the fetch actually resolved; a failed fetch knows nothing
      // about what was shown.
      if (suggestionsFetchedRef.current && spaceId) {
        writeIgnoredSuggestionIds(
          spaceId,
          shownSuggestionsRef.current.filter((id) => id !== pickedSuggestionRef.current),
        );
      }
    };
  }, [atGarden]);

  // Chronicle routes (Deep Past: done Journeys) and garden groves (every
  // Journey): each Journey's linked items, fetched per Journey on entry. A
  // single Journey's links failing omits only that Journey's route/grove
  // contents — the world still renders, honestly, without them.
  useEffect(() => {
    if ((!atDeepPast && !atGarden) || !journeys) return;
    let cancelled = false;
    const wanted = atGarden ? journeys : journeys.filter((j) => j.status === "done");
    void Promise.all(
      wanted.map(async (j): Promise<[number, JourneyLinkSummary[]]> => {
        try {
          const detail = await journeyLinks(j.id);
          return [j.id, detail?.links ?? []];
        } catch {
          return [j.id, []];
        }
      }),
    ).then((entries) => {
      if (!cancelled) setJourneyLinksMap(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [atDeepPast, atGarden, journeys]);

  // Seed pods (garden v2): memories due for recall ripen in the garden. A
  // failed fetch simply grows no pods — the garden never waits on it.
  useEffect(() => {
    if (!atGarden) return;
    let cancelled = false;
    getDueReviews()
      .then((due) => {
        if (!cancelled) setDueReviews(due);
      })
      .catch(() => {
        if (!cancelled) setDueReviews([]);
      });
    return () => {
      cancelled = true;
    };
  }, [atGarden]);

  // The Archive's own input (Wave 2): the graph prop never carries
  // archived rows, so the archived nodes plus their incident edges are
  // fetched on entry. A failed fetch is an error state with a retry —
  // never an empty field, which would lie about what rests here. The
  // layout prunes incident edges to archived endpoints (a live memory
  // linked to an archived person stays in the galaxy).
  useEffect(() => {
    if (!atQuietArchive) return;
    let cancelled = false;
    setArchivedGraph(null);
    setArchivedFailed(false);
    void (async () => {
      try {
        const nodes = await getArchivedNodesStrict();
        const links: GraphEdge[] = [];
        const ids = nodes.map((n) => n.id);
        if (ids.length > 0) {
          let cursor: number | null = null;
          do {
            const page = await getIncidentEdges(ids, cursor);
            links.push(...page.edges);
            cursor = page.nextCursor;
          } while (cursor != null);
        }
        if (!cancelled) setArchivedGraph({ nodes, links });
      } catch {
        if (!cancelled) setArchivedFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [atQuietArchive, archivedRetry]);

  // Garden mutation feed (Phase 4): warmth + pending proposals on
  // garden entry. A failed fetch leaves the previous input untouched —
  // the garden holds its warmth rather than cooling on a network error.
  useEffect(() => {
    if (!atGarden) return;
    let cancelled = false;
    void (async () => {
      const [st, list] = await Promise.all([
        getWorldChangesState(),
        listWorldChangeProposals({ status: "pending" }),
      ]);
      if (cancelled) return;
      if (st === null && list === null) return;
      setWorldChanges({ warmth: st?.warmth ?? 0, proposals: list ?? [] });
    })();
    return () => {
      cancelled = true;
    };
  }, [atGarden, worldChangesRetry]);

  // The inbox announces decisions on window (world-changes-applied /
  // world-changes-undone, detail = the proposal) so the garden — which
  // never fetches — can play the landing or the compensation. An event
  // for a proposal with no garden form, or while the user is not in the
  // garden, plays nothing: the log still records it, and the next visit
  // shows the settled state through the layout.
  useEffect(() => {
    atGardenRef.current = atGarden;
  }, [atGarden]);
  useEffect(() => {
    const onApplied = (ev: Event) => {
      if (!atGardenRef.current) return;
      const proposal = (ev as CustomEvent<WorldChangeProposal>).detail;
      if (!proposal) return;
      const landing = proposalToGardenMotion<GardenMutationLanding>(proposal, layoutRef.current);
      if (landing) pendingMutationRef.current.landings.push(landing);
      setWorldChangesRetry((r) => r + 1);
      if (landing) setMutationVersion((v) => v + 1);
    };
    const onUndone = (ev: Event) => {
      if (!atGardenRef.current) return;
      const proposal = (ev as CustomEvent<WorldChangeProposal>).detail;
      if (!proposal) return;
      const undo = proposalToGardenMotion<GardenMutationUndo>(proposal, layoutRef.current);
      if (undo) pendingMutationRef.current.undos.push(undo);
      setWorldChangesRetry((r) => r + 1);
      if (undo) setMutationVersion((v) => v + 1);
    };
    window.addEventListener("world-changes-applied", onApplied);
    window.addEventListener("world-changes-undone", onUndone);
    return () => {
      window.removeEventListener("world-changes-applied", onApplied);
      window.removeEventListener("world-changes-undone", onUndone);
    };
  }, []);

  // The garden layout derives from the app's graph on every data change —
  // the world re-reads the brain; it stores nothing of its own.
  const layout = useMemo<GardenLayout | undefined>(() => {
    if (!atGarden || !graph) return undefined;
    return buildGardenLayout(graph, journeys ?? [], new Date(), {
      links: journeyLinksMap ?? undefined,
      due: dueReviews?.filter((d) => !podsAside.has(d.id)),
    });
  }, [atGarden, graph, journeys, journeyLinksMap, dueReviews, podsAside]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // A result line ("Placed … ✓") is news, not furniture: it clears itself.
  useEffect(() => {
    if (!gardenResult) return;
    const t = window.setTimeout(() => setGardenResult(null), 9000);
    return () => window.clearTimeout(t);
  }, [gardenResult]);

  // The garden day closes with a bloom: all three beats done, once per local day (a reload never replays it).
  useEffect(() => {
    if (!atGarden || gardenDay.bloomed || !dayComplete(gardenDay)) return;
    const scene = gardenSceneRef.current;
    scene?.celebrate("bloom", { x: 0, y: 40, z: 0 });
    scene?.celebrate("harvest");
    setGardenResult("A full garden day — something bloomed. Nothing to claim; it is simply done.");
    setGardenDay((d) => {
      const next = { ...d, bloomed: true };
      writeDay(getSpaceId(), next);
      return next;
    });
  }, [atGarden, gardenDay]);

  // Push the garden's mutation input into the live scene (previews
  // reconcile by proposal id; landings/undos are drained once, so a
  // landing never replays because the warmth moved).
  useEffect(() => {
    if (!atGarden) return;
    const scene = gardenSceneRef.current;
    if (!scene?.setMutation) return;
    const events = pendingMutationRef.current;
    pendingMutationRef.current = { landings: [], undos: [] };
    scene.setMutation(gardenMutationFrom(worldChanges, layout, events));
  }, [atGarden, worldChanges, layout, mutationVersion]);

  // The Deep Past layout derives the same way, plus the fetched Journey
  // links that make the Chronicle thread. No links yet → no thread yet;
  // the helix still renders, honestly, without it.
  const deepPastLayout = useMemo<DeepPastLayout | undefined>(() => {
    if (!atDeepPast || !graph) return undefined;
    return buildDeepPastLayout(graph, journeys ?? [], journeyLinksMap ?? new Map(), new Date(), {
      warmDays: relicBuffs?.buffs.riseWindowDays ?? 30,
      stickyRisenIds: relicBuffs?.buffs.risenHold ? stickyRisenRef.current : undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atDeepPast, graph, journeys, journeyLinksMap, relicBuffs, stickyRisenTick]);

  // Lantern of Keeping: risen members stay risen for the visit; leaving clears the set.
  useEffect(() => {
    if (!atDeepPast) { stickyRisenRef.current.clear(); return; }
    if (!relicBuffs?.buffs.risenHold || !deepPastLayout) return;
    let grew = false;
    for (const mm of deepPastLayout.members) if (mm.risen && !stickyRisenRef.current.has(mm.nodeId)) { stickyRisenRef.current.add(mm.nodeId); grew = true; }
    if (grew) setStickyRisenTick((n) => n + 1);
  }, [atDeepPast, deepPastLayout, relicBuffs?.buffs.risenHold]);

  const deepPastLayoutRef = useRef<DeepPastLayout | undefined>(undefined);
  deepPastLayoutRef.current = deepPastLayout;

  // The People layout derives the same way, from the graph alone — one
  // warm cluster per person with linked memories, bridges where memories
  // are shared. The world re-reads the brain on every visit.
  const peopleLayout = useMemo<PeopleLayout | undefined>(() => {
    if (!atPeople || !graph) return undefined;
    return buildPeopleLayout(graph);
  }, [atPeople, graph]);

  // The Quiet/Archive layout derives from the fetched archived input —
  // never from the graph prop, which cannot carry archived rows. The
  // world re-reads the archive on every visit; restoring in the brain
  // removes the cluster quietly on the next visit.
  const quietArchiveLayout = useMemo<QuietArchiveLayout | undefined>(() => {
    if (!atQuietArchive || !archivedGraph) return undefined;
    return buildQuietArchiveLayout(archivedGraph);
  }, [atQuietArchive, archivedGraph]);

  // Scale carries no memories, so its layout needs no graph: the same
  // real station, the same real probes, every visit, every device.
  const scaleLayout = useMemo<ScaleLayout | undefined>(() => {
    if (!atScale) return undefined;
    return buildScaleLayout();
  }, [atScale]);

  // Station interior: the hall is the same for every traveler, every
  // visit — it surfaces no memories of its own, so it needs no graph.
  // The docked ship's skin is the HangarPanel pick (the same
  // `brain.hangar.ship.*` key the panel writes); the nonce re-reads
  // it after an equip, so the bay follows the new pick.
  const interiorLayout = useMemo(() => {
    if (!atStation) return undefined;
    return buildStationInteriorLayout();
  }, [atStation]);
  const interiorShipSkin = useMemo(() => {
    if (!atStation) return "default";
    const spaceId = getSpaceId();
    if (!spaceId) return "default";
    try {
      return localStorage.getItem(`brain.hangar.ship.${spaceId}`) || "default";
    } catch {
      return "default";
    }
  }, [atStation, bayShipNonce]);
  const goToInteriorRoom = (id: InteriorRoomId) => {
    interiorRoomRef.current = id;
    setInteriorRoom(id);
  };

  // The garden and the Deep Past build from several things that arrive one
  // after another (Journeys, their links, due reviews, recent tends). Each
  // late arrival changes the layout, and a changed layout rebuilds the whole
  // 3D view and re-requests its models — measured: 3 mounts and every model
  // loaded twice. Wait for them (bounded, so a slow request can't hold the
  // world back) and build once.
  const journeysSettled = journeys !== null || journeysFailed;
  const linksSettled = journeysFailed || (journeys !== null && journeyLinksMap !== null);
  const gardenDataReady =
    dataGraceOver || (journeysSettled && linksSettled && dueReviews !== null && tendsLoaded);
  const deepPastDataReady = dataGraceOver || (journeysSettled && linksSettled);

  const sceneLayout =
    currentWorld === "growing-place"
      ? gardenDataReady
        ? layout
        : undefined
      : currentWorld === "deep-past"
        ? deepPastDataReady
          ? deepPastLayout
          : undefined
        : currentWorld === "people"
          ? peopleLayout
          : currentWorld === "quiet-archive"
            ? quietArchiveLayout
            : currentWorld === "scale"
              ? scaleLayout
              : undefined;

  // Verb 1: the garden's warm glow and lit paths, from the graph's own
  // lastTendedAt values and the recent tend records. Recomputed when the
  // graph or the tends change — the scene rebuilds and re-renders warm.
  const gardenGlow = useMemo(() => {
    if (!atGarden || !graph) return { warmNodeIds: new Set<number>(), litEdgeIds: new Set<number>() };
    return {
      warmNodeIds: warmPlotNodeIds(graph.nodes),
      litEdgeIds: litPathEdgeIds(recentTends),
    };
  }, [atGarden, graph, recentTends]);

  // Verb 1: opening the tend sheet for a plot. From a suggestion, the
  // pick is recorded so that suggestion is never counted as ignored.
  const openTendFor = (node: GraphNode, fromSuggestion = false) => {
    if (fromSuggestion) pickedSuggestionRef.current = node.id;
    setTendNode(node);
  };

  // Verb 1: after a tend lands, its path lights now; the graph refresh
  // (onChanged) warms the plot itself on the next scene build.
  const handleTended = (result: TendResult) => {
    bumpGuide({ tended: true });
    bumpDay("tends");
    setGardenResult(tendNode?.label ? `Tended “${tendNode.label}”.` : "Tended.");
    setRecentTends((prev) => [result.tend, ...prev]);
    onChanged?.(result);
  };

  // Verb 1: a tap on the garden canvas. The raycast runs against the
  // live camera (it orbits every frame); a tap that lands on no plot
  // does nothing — the garden stays a place to look, not a minefield.
  const handleCanvasClick = (e: { clientX: number; clientY: number }) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false; // the end of a drag, not a tap
      return;
    }
    if (atDeepPast && mode === "world") {
      // Deep Past (F9): a tap on a member's alcove approaches it — the
      // same tap-vs-drag discrimination as the garden (a drag's click
      // was suppressed above). A tap on sky / architecture does nothing.
      const scene = deepPastSceneRef.current;
      const camera = dpCameraRef.current;
      const host = hostRef.current;
      if (!scene || !camera || !host) return;
      const rect = host.getBoundingClientRect();
      const nodeId = scene.pickMember(
        {
          x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
          y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
        },
        camera,
      );
      if (nodeId !== null) openDpMember(nodeId);
      return;
    }
    if (!atGarden || mode !== "world") return;
    const scene = gardenSceneRef.current;
    const camera = gardenCameraRef.current;
    const host = hostRef.current;
    if (!scene || !camera || !host || !graph) return;
    const rect = host.getBoundingClientRect();
    const ndc = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
    // Garden v2: a tap is a place to go. Ground → she skims there; a plot
    // or a pod → she goes to stand beside it and its sheet opens when she
    // arrives. Sky → nothing (the garden stays a place to look).
    const pick = scene.pickTarget(ndc, camera);
    if (!pick) return;
    setSuggestionsHidden(true); // once you're walking, the arrival panel steps aside
    // Ground inside a grove's lawn is "go to that grove": its sheet opens on arrival.
    const grove =
      pick.kind === "ground"
        ? layoutRef.current?.groves.find((g) => Math.hypot(g.x - pick.x, g.z - pick.z) <= g.radius)
        : undefined;
    if (grove) walkTo(approachPoint(walkRef.current.pos, grove, grove.radius * 0.6), { kind: "grove", journeyId: grove.journeyId }, grove.title);
    else if (pick.kind === "ground") walkTo({ x: pick.x, z: pick.z }, null);
    else {
      const label = graph?.nodes.find((n) => n.id === pick.nodeId)?.label;
      walkTo(
        approachPoint(walkRef.current.pos, pick, pick.kind === "pod" ? 22 : 28),
        { kind: pick.kind, nodeId: pick.nodeId },
        label ? `“${label}”` : pick.kind === "pod" ? "a seed pod" : "a plot",
      );
    }
  };

  // Send her ship somewhere; `arrival` is what opens when she gets there.
  const walkTo = (target: WalkPoint, arrival: GardenArrival | null, label = "there") => {
    const w = walkRef.current;
    walkRef.current = { ...w, route: walkRoute(w.pos, target) };
    arrivalRef.current = arrival;
    setWalkingTo(label);
    setGardenResult(null);
    bumpGuide({ walked: true });
  };
  const stopWalking = () => {
    walkRef.current = { ...walkRef.current, route: [] };
    arrivalRef.current = null;
    setWalkingTo(null);
  };

  // Guidance bookkeeping: first-visit steps stick per brain; the day's beats count per local day.
  const bumpGuide = (patch: Partial<GuideProgress>) => {
    setGuide((g) => {
      const next = { ...g, ...patch };
      if (next.walked === g.walked && next.tended === g.tended && next.carried === g.carried && next.dismissed === g.dismissed) return g;
      writeGuide(getSpaceId(), next);
      return next;
    });
  };
  const bumpDay = (beat: "tends" | "places" | "recalls") => {
    setGardenDay((d) => {
      const next = { ...d, [beat]: d[beat] + 1 };
      writeDay(getSpaceId(), next);
      return next;
    });
  };

  // Arrival: the frame loop calls this through a ref (it is set every render).
  onArriveRef.current = (a) => {
    if (a.kind === "pod") {
      setTendNode(null);
      setGroveSheet(null);
      setRecallPod(a.nodeId);
    } else if (a.kind === "plot") {
      const node = graph?.nodes.find((n) => n.id === a.nodeId);
      if (node) setTendNode(node);
    } else if (a.kind === "grove") {
      setTendNode(null);
      setGroveSheet(a.journeyId);
    }
  };

  const gardenChanged = (newNodeIds?: number[]) => {
    setGardenVersion((v) => v + 1);
    onGardenChanged?.(newNodeIds);
  };

  // Relics (relics increment): the world's relics that are actually
  // visible right now and not yet found — each one gets a plain-language
  // "something glimmers" line with a "Look closer" button. A relic whose
  // GLB has not landed is not visible, so its find is never offered.
  const glimmers = useMemo(() => {
    if (!atWorld || !currentWorld || !isSceneRelicWorld(currentWorld)) return [];
    return relicsForWorld(currentWorld).filter(
      (r) => r.discoverable && visibleRelics.includes(r.id) && !foundRelics.has(relicCodexKey(r.id)),
    );
  }, [atWorld, currentWorld, visibleRelics, foundRelics]);

  // A5: a find is recorded locally ONLY on server success. A failure leaves
  // the glimmer in place with a plain retry line and no celebration.
  // Relics I-4: the glimmer button is now the dwell-and-claim moment.
  // The scene rests the relic at its first anchor (the parity-held
  // scene position), so "Look closer" reports the settling sample at
  // that anchor, dwells while the server measures the dwell from its
  // own receipt stamps, then claims under a fresh claimId. The full
  // hunt surface (scan pulse readout, free movement) is I-7.
  const onFindRelic = async (relic: RelicDef) => {
    if (!spaceId || settlingRelic) return;
    const anchor = RELIC_ANCHOR_POINTS[relic.id]?.[0];
    if (!anchor) {
      setFindError("That glimmer has no resting place yet — it cannot be claimed.");
      return;
    }
    const position = [...anchor.position];
    const sampled = await sampleRelicClaimStart(position);
    if (!sampled.ok) {
      setFindError(sampled.error ?? "That find didn't go through — the glimmer is still here. Try again when you're ready.");
      return;
    }
    setSettlingRelic(relic.id);
    setFindError(null);
    // A breath of margin over the dwell the server measures.
    await new Promise((r) => setTimeout(r, RELIC_DWELL_MS + 250));
    const claimId = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `claim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const out = await findRelic(relic.id, claimId, position);
    setSettlingRelic(null);
    // I-7: every claim answer carries a fresh state — refusals included —
    // so a stirring that resolved (claimed / gone quiet) shows its new
    // state beside the glimmer at once, in the server's own vocabulary.
    if (out.state) setRelicState(out.state);
    if (!out.ok) {
      setClaimNotices((m) => ({ ...m, [relic.id]: out.error ?? "That find didn't go through — the glimmer is still here. Try again when you're ready." }));
      if (out.state) replaceFoundRelics(spaceId, out.state.found.map((id) => relicCodexKey(id)));
      return;
    }
    setClaimNotices((m) => { const next = { ...m }; delete next[relic.id]; return next; });
    if (out.state) replaceFoundRelics(spaceId, out.state.found.map((id) => relicCodexKey(id)));
    else markRelicFound(spaceId, relicCodexKey(relic.id));
    void storyRef.current.onRelic(relic.id);
    // The claim celebration carries the L2 fragment the server just
    // unlocked for this viewer — text it sent, never text invented here.
    const frag = out.state?.codex?.find((c) => c.relicId === relic.id)?.layers.description;
    const fragText = frag?.state === "unlocked" ? frag.text : undefined;
    pushToast(fragText ? `You found ${relic.name}. ${fragText}` : `You found ${relic.name} — it's in your Codex now.`, "🏺", 6000, "high");
  };
  findRelicRef.current = onFindRelic;

  // --- Deep Past rework: mode handlers (dock + card + taps) ---
  /** Reduced-motion for UI decisions (the frame loop reads its own copy). */
  const reducedMotionUi =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dismissDpArrival = () => {
    dpInteractedRef.current = true;
    setDpArrivalDismissed(true);
  };
  dpInteractRef.current = dismissDpArrival;
  const setDpModeBoth = (m: DpMode) => {
    dpModeRef.current = m;
    setDpMode(m);
  };
  /** Park the ride: a mid-leg leave keeps the leg's destination stop. */
  const parkRide = () => {
    const R = rideRef.current;
    if (R.phase === "traveling") {
      const to = R.leg?.to ?? R.pendingLeg?.to ?? R.stop;
      const n = deepPastLayoutRef.current?.thread?.stops.length ?? 0;
      R.leg = null;
      R.pendingLeg = null;
      if (n > 0 && to >= n) {
        R.phase = "complete";
        R.kindle = 1;
      } else if (to >= 0) {
        R.phase = "dwelling";
        R.stop = to;
      }
    }
    setDpRidePhase(R.phase);
    setDpRideStop(R.stop);
  };
  const startWalk = () => {
    dismissDpArrival();
    parkRide();
    backToOverview();
    const w = walkRefDp.current;
    if (w.s >= 1) w.s = 0; // a finished walk starts over; a parked one resumes
    w.dir = 1;
    w.atLanding = null;
    setDpAtLanding(null);
    w.moving = !reducedMotionUi;
    setDpWalkMoving(w.moving);
    setDpModeBoth("walk");
  };
  const toggleWalkMoving = () => {
    dismissDpArrival();
    const w = walkRefDp.current;
    w.moving = !w.moving;
    setDpWalkMoving(w.moving);
  };
  /** Resume the walk — under reduced motion, jump to the next landing instead. */
  const keepWalking = () => {
    dismissDpArrival();
    const w = walkRefDp.current;
    if (reducedMotionUi) {
      const next = dpLandingsRef.current
        .filter((l) => (w.dir > 0 ? l.s > w.s + 1e-4 : l.s < w.s - 1e-4))
        .sort((a, b) => (w.dir > 0 ? a.s - b.s : b.s - a.s))[0];
      if (!next) return;
      w.s = next.s;
      if (next.stratum === 9) {
        dpFocusRef.current = null;
        dpPerchRef.current = 9;
        setDpPerchStratum(9);
        setDpModeBoth("perch");
      } else {
        w.atLanding = next.stratum;
        setDpAtLanding(next.stratum);
      }
      return;
    }
    w.moving = true;
    setDpWalkMoving(true);
  };
  const stepOff = () => {
    dismissDpArrival();
    const at = walkRefDp.current.atLanding;
    if (at === null) return;
    dpFocusRef.current = null;
    dpPerchRef.current = at;
    setDpPerchStratum(at);
    setDpModeBoth("perch");
  };
  /** Rejoin the walk curve from a perch, one flight in `dir`. */
  const perchFlight = (dir: 1 | -1) => {
    dismissDpArrival();
    const stratum = dpFocusRef.current?.stratum ?? dpPerchRef.current;
    const landing = dpLandingsRef.current.find((l) => l.stratum === stratum);
    const w = walkRefDp.current;
    if (landing) w.s = landing.s;
    w.dir = dir;
    w.atLanding = null;
    setDpAtLanding(null);
    dpFocusRef.current = null;
    w.moving = !reducedMotionUi;
    setDpWalkMoving(w.moving);
    setDpModeBoth("walk");
  };
  const backToRim = () => {
    dismissDpArrival();
    parkRide();
    backToOverview();
    walkRefDp.current.moving = false;
    setDpWalkMoving(false);
    dpFocusRef.current = null;
    setDpCardNode(null);
    setDpModeBoth("overview");
  };
  const enterRide = () => {
    dismissDpArrival();
    backToOverview();
    const R = rideRef.current;
    if (R.phase === "traveling") parkRide();
    if (R.phase === "atBerth") {
      // F4/AN14: the ride's first leg is the ship leaving its berth.
      R.pendingLeg = { from: -1, to: R.stop };
      R.phase = "traveling";
      setDpRidePhase("traveling");
    }
    setDpModeBoth("ride");
  };
  const continueRide = () => {
    dismissDpArrival();
    const R = rideRef.current;
    if (R.phase !== "dwelling") return;
    R.pendingLeg = { from: R.stop, to: R.stop + 1 };
    R.phase = "traveling";
    setDpRidePhase("traveling");
  };
  const leaveRide = () => {
    dismissDpArrival();
    parkRide();
    backToOverview();
    setDpModeBoth("overview");
  };
  /** F9: approach a member — perch focused on it, its card open, its alcove answering (AN4). */
  const openDpMember = (nodeId: number) => {
    const member = deepPastLayoutRef.current?.members.find((m) => m.nodeId === nodeId);
    if (!member) return;
    dismissDpArrival();
    parkRide();
    deepPastSceneRef.current?.pulseAlcove(nodeId);
    dpFocusRef.current = { point: [member.x, member.y, member.z], nodeId, stratum: member.stratum };
    dpPerchRef.current = member.stratum;
    setDpPerchStratum(member.stratum);
    setDpCardNode(nodeId);
    setDpModeBoth("perch");
  };
  const closeDpCard = () => {
    setDpCardNode(null);
    dpFocusRef.current = null; // focus returns to the stratum landing
  };
  /** Glimmer "Look closer": in Deep Past, basin relics are traveled to
   *  first (fly to First Light; the find completes on arrival). */
  const onGlimmerLookCloser = (relic: RelicDef) => {
    if (atDeepPast) {
      const basin = places.find((p) => p.id === "glb-basin");
      if (basin) {
        glimmerFindRef.current = relic;
        flyTo(basin);
        return;
      }
    }
    onFindRelic(relic);
  };

  useEffect(() => {
    if (!visible || !mode) return;
    // A memory-bearing world needs the graph before it can build; until
    // then the dialog shows its loading line (see the render below) and
    // builds nothing. The Archive needs its fetched archived input the
    // same way — and when that fetch fails, nothing is built at all (the
    // error line below owns the state, with a retry).
    if (mode === "world" && (atGarden || atDeepPast || atPeople || atQuietArchive) && !sceneLayout) return;
    const host = hostRef.current;
    if (!host) return;
    // One renderer for the worlds layer's lifetime (speed audit S6): creating a WebGL context per world / per warp cost
    // 50–200 ms on a phone and can fail under memory pressure. Each world gets a fresh scene; the canvas is re-attached.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = rendererRef.current ?? new THREE.WebGLRenderer({ antialias: true });
      rendererRef.current = renderer;
    } catch (err) {
      // Never swallow silently: which world failed, and why, is the only
      // way anyone can tell a broken world from a device without WebGL.
      console.error(`[worlds] renderer failed for ${mode === "transit" ? "transit" : currentWorld}`, err);
      setGraphicsFailed(true);
      return;
    }
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Her ship's textures are KTX2 — the loader must know the renderer
    // before any KTX2 model loads (see graph/gltf.ts).
    ensureKtx2Support(renderer);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);

    const background = mode === "transit" ? 0x05070f : (entry?.background ?? 0x05070f);
    const fogDensity = mode === "transit" ? 0 : (entry?.fogDensity ?? 0);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background);
    scene.fog = new THREE.FogExp2(background, fogDensity);
    const camera = new THREE.PerspectiveCamera(
      55,
      host.clientWidth / Math.max(1, host.clientHeight),
      1,
      9000,
    );
    // The world build stays typed (WorldSceneHandle) before it joins
    // the transit union — Eternity's controls come from here, so the
    // frame loop never has to narrow the union.
    // Verb 1: the garden alone takes the warm glow — the registry's build
    // knows nothing about tends, so the glow is passed here, and the built
    // garden scene is kept in a typed local for tap-to-tend raycasting.
    // (The branch is the proof it is a garden scene — no cast, no `in`.)
    let built: WorldSceneHandle | null = null;
    let gardenScene: GardenScene | null = null;
    if (mode === "transit") {
      // Transit builds its own scene in 'world' below; nothing to build here.
    } else if (entry) {
      if (currentWorld === "growing-place") {
        gardenScene = createGardenScene(
          isGardenLayout(sceneLayout) ? sceneLayout : EMPTY_GARDEN_LAYOUT,
          gardenGlow,
          undefined,
          { onRelicVisible: handleRelicVisible },
        );
        built = gardenScene;
      } else if (currentWorld === "deep-past") {
        // Deep Past rework: built directly (garden pattern) so the typed
        // handle stays in a ref for pickMember / setFrameState. On every
        // REbuild after the first, diff against the previous layout:
        // members newly risen get a rise glide; members newly present
        // get a ship carry-in (the scene owns both motions).
        const dpLayout = isDeepPastLayout(sceneLayout) ? sceneLayout : EMPTY_DEEP_PAST_LAYOUT;
        const prev = dpPrevLayoutRef.current;
        let riseGlides: number[] | undefined;
        let carryIn: number[] | undefined;
        if (prev) {
          const prevRisen = new Set(prev.members.filter((m) => m.risen).map((m) => m.nodeId));
          riseGlides = dpLayout.members.filter((m) => m.risen && !prevRisen.has(m.nodeId)).map((m) => m.nodeId);
          const prevIds = new Set(prev.members.map((m) => m.nodeId));
          carryIn = dpLayout.members.filter((m) => !prevIds.has(m.nodeId)).map((m) => m.nodeId);
        }
        dpPrevLayoutRef.current = dpLayout;
        const dpScene = createDeepPastScene(dpLayout, {
          onRelicVisible: handleRelicVisible,
          riseGlides,
          carryIn,
        });
        deepPastSceneRef.current = dpScene;
        dpCameraRef.current = camera;
        built = dpScene;
      } else if (currentWorld === "great-station" && inside) {
        // Station interior: the hall replaces the exterior scene while
        // inside. The docked ship follows the hangar pick (skin).
        built = createStationInteriorScene(
          interiorLayout ?? buildStationInteriorLayout(),
          { shipSkin: interiorShipSkin },
        );
      } else {
        built = entry.build(sceneLayout, handleRelicVisible);
      }
    }
    const world =
      mode === "transit"
        ? createTransitScene({
            kind: transitKind ?? "warp",
            totalMs: transitTotalMs,
            origin: journey?.origin ?? "home",
            destination: journey?.destination ?? "home",
            // A turn-back has no departure to draw; every other flight begins with the cancel window.
            armMs: armMsOf(journey),
            trail: trailRef.current,
          })
        : built;
    if (!world) return;
    scene.add(world.group);
    // Story props (Draft 9 §5): small wordless things beside the holders, placed once each holder's model has loaded.
    const props = mode === "world" && !inside ? attachWorldProps(currentWorld, world.group) : null;
    let propsDone = props?.place() ?? true;
    let propsTriedAt = 0;
    // Her hull is shown only once it is ready (never a placeholder), so warm it before anything needs it.
    void loadSoumayaShip();
    void loadWarpGate(); // null (and the generated ring stays) until public/warp-gate.glb exists
    // One universe: every world and the warp draw the same home sky. The garden keeps its own backdrop,
    // Eternity is a white void by design, and the Long Morning is warm light with no horizon (a starfield
    // would give it a black sky and a hard horizon, so it keeps its own background colour and matching fog).
    const sky =
      mode === "transit" || (currentWorld !== "growing-place" && currentWorld !== "eternity" && currentWorld !== "the-long-morning")
        ? installHomeSky(renderer, scene)
        : null;
    if (sky) scene.add(sky.group);
    // Shared lighting for this world (the corridor only takes the environment map — it lights itself otherwise).
    const lighting =
      mode === "transit"
        ? applyWorldLighting(scene, renderer, TRANSIT_LIGHT_RIG)
        : mode === "world" && entry?.light
          ? applyWorldLighting(scene, renderer, tintRigForHour(entry.light, hourBand(new Date())))
          : null;
    sceneHandleRef.current = world;
    // A measuring probe for scripts/spots-check.mjs ONLY: it exists when the page was opened with localStorage "soumaya.probe" = "1". It reports where each of this world's lore spots
    // resolves in the built scene, so spot placement can be MEASURED rather than assumed. Read-only; nothing in the product uses it.
    try {
      if (currentWorld && localStorage.getItem("soumaya.probe") === "1") {
        (window as unknown as { __loreProbe?: unknown }).__loreProbe = {
          world: currentWorld,
          // The names of the scene's holders (two levels deep), so a spot that does not resolve can be debugged against what IS there.
          names: () => {
            const out: string[] = [];
            world.group.traverse((o) => {
              if (o.name && out.length < 400 && (o.parent === world.group || o.parent?.parent === world.group)) out.push(o.name);
            });
            return out;
          },
          // Where each person in the scene is right now (a read-only probe for the talk-holds-still check).
          npcs: () => [...npcPosRef.current.entries()].map(([id, pos]) => ({ id, pos })),
          // Where her ship is and what it is doing (null until she is out), so a script can check a tap really flew her somewhere.
          flight: () => (flightRef.current ? { phase: flightRef.current.phase, pos: [flightRef.current.pos[0], flightRef.current.pos[1], flightRef.current.pos[2]] } : null),
          report: () => {
            world.group.updateMatrixWorld(true);
            return STORY_TRIGGERS.filter((t) => t.world === currentWorld && t.spot).map((t) => ({
              entryId: t.entryId,
              spot: t.spot,
              marks: t.spot!.place ? locateLandmarks(world.group, t.spot!.place) : [{ name: "origin", center: [0, 0, 0], radius: 1 }],
            }));
          },
        };
      }
    } catch {
      /* no storage: no probe */
    }
    // The traveller's ship inside a world that has places to fly to (hidden until the first flight).
    const avatar: ShipAvatar | null = mode === "world" && currentWorld && PLACE_RULES[currentWorld] && !inside ? createShipAvatar(trailRef.current) : null;
    if (avatar) {
      avatar.group.visible = false;
      scene.add(avatar.group);
    }
    // Her exhaust trail in world space — flying her ship through a world leaves the same trail she leaves at home (graph/enginePlume.ts).
    const plume = avatar || currentWorld === "growing-place" ? createEnginePlume(trailRef.current, { scale: currentWorld === "growing-place" ? 1.8 : 1 }) : null;
    if (plume) scene.add(plume.group);
    // The cast's ships for this world (graph/npcBodies.ts): created as people arrive, removed as they leave.
    const npcBodies = mode === "world" && currentWorld && !inside ? createNpcBodies(scene) : null;
    npcBodiesRef.current = npcBodies;
    let plumeTrail = trailRef.current;
    let plumeFed = false;
    const exhaustV = new THREE.Vector3();
    const eternityCtl = currentWorld === "eternity" ? built?.eternity : undefined;
    if (gardenScene) {
      gardenSceneRef.current = gardenScene;
      gardenCameraRef.current = camera;
    }
    // Garden only (Phase 4): keep the live scene handle so mutation
    // state can be pushed into it without rebuilding the renderer.
    // (In this branch world IS gardenScene — assigned just above — so
    // the handle stored is the same object; it is stored as the garden
    // scene so tap-to-tend keeps its pickPlot type.)
    if (mode === "world" && currentWorld === "growing-place") {
      gardenSceneRef.current = gardenScene;
    }
    // Engine audio rides the transit only; it is gated internally by the
    // interface-sounds setting, and it stops when the surface unmounts.
    const engine = mode === "transit" ? makeEngineAudio() : null;
    const orbit = mode === "world" ? entry : null;

    // Deep Past walk curve (rework §7.2): the generated route over the
    // disc arcs and stair flights, arc-length parameterised. Landing
    // positions along it are precomputed by nearest sample (400 samples)
    // so the walk can wait at every landing. Rebuilt with the scene.
    let dpCurve: THREE.CatmullRomCurve3 | null = null;
    let dpCurveLen = 0;
    let dpLandingS: { stratum: number; s: number; point: DpVec }[] = [];
    if (mode === "world" && currentWorld === "deep-past") {
      const walkData = buildDeepPastWalkPoints();
      dpCurve = new THREE.CatmullRomCurve3(
        walkData.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
        false,
      );
      dpCurveLen = dpCurve.getLength();
      const samples = dpCurve.getSpacedPoints(400);
      dpLandingS = walkData.landings.map((l) => {
        const target = new THREE.Vector3(l.point[0], l.point[1], l.point[2]);
        let best = 0;
        let bestDist = Infinity;
        samples.forEach((sp, i) => {
          const d = sp.distanceToSquared(target);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });
        return { stratum: l.stratum, s: best / 400, point: [l.point[0], l.point[1], l.point[2]] as DpVec };
      });
      dpLandingsRef.current = dpLandingS;
    }

    const onResize = () => {
      const w = host.clientWidth;
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);
    // Any pointer press skips the Station arrival glide (A13) and drops
    // straight into the resting orbit — and skips a garden landing/undo
    // in progress (A6/A7/A25: tap to finish instantly at the final state).
    const skipArrival = () => {
      arrivalSkippedRef.current = true;
      gardenSceneRef.current?.skipAnimations?.();
      // A pointer press on the canvas host is a Deep Past interaction
      // (AN9: it ends the idle orbit; §8: it dismisses the arrival line).
      if (currentWorld === "deep-past") dpInteractRef.current();
    };
    host.addEventListener("pointerdown", skipArrival);

    // --- Free look (graph/worldLook.ts): one finger / mouse drag turns the view around the world,
    // two fingers pinch to zoom, the wheel zooms, a double tap resets. Ignored while the world is
    // running a scripted camera move.
    lookRef.current = NO_LOOK;
    const pointers = new Map<number, { x: number; y: number }>();
    let lastPinch = 0;
    let travelled = 0; // total pixels this gesture has moved — separates a tap from a drag
    let lastTapAt = 0;
    const DRAG_PX = 8;
    const markLooked = () => {
      lookedRef.current();
      lastLookInputRef.current = performance.now();
      // Any look input (drag / pinch / wheel) is also a Deep Past
      // interaction: it ends the idle orbit and dismisses the arrival line.
      if (currentWorld === "deep-past") dpInteractRef.current();
    };
    const onLookDown = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) travelled = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        lastPinch = pinchDistance(a!, b!);
      }
    };
    const onLookMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const next = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, next);
      if (!lookAllowedRef.current) return;
      if (pointers.size === 1) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        travelled += Math.hypot(dx, dy);
        if (travelled > DRAG_PX) {
          lookRef.current = dragLook(lookRef.current, dx, dy);
          markLooked();
        }
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = pinchDistance(a!, b!);
        if (lastPinch > 0 && d > 0) lookRef.current = zoomLook(lookRef.current, d / lastPinch);
        lastPinch = d;
        travelled += DRAG_PX + 1; // a pinch is never a tap
        markLooked();
      }
    };
    let tapFlyTimer: number | null = null;
    const tapRay = new THREE.Raycaster();
    const tapFly = (cx: number, cy: number) => {
      const rect = host.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const ndc = new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
      tapRay.setFromCamera(ndc, camera);
      const meshes: THREE.Object3D[] = [];
      world.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o.visible) meshes.push(o);
      });
      const hit = tapRay.intersectObjects(meshes, false)[0];
      let p: V3 | null = null;
      if (hit) {
        // Stop a little short of the surface that was tapped, on the camera's side of it.
        const back = hit.point.clone().addScaledVector(tapRay.ray.direction, -Math.max(24, hit.distance * 0.03));
        p = [back.x, back.y, back.z];
      } else {
        // Nothing there: the point on the ship's own altitude plane under the tap.
        const y = flightRef.current?.pos[1] ?? overviewCamRef.current.look[1];
        const d = tapRay.ray.direction;
        const t = Math.abs(d.y) > 1e-4 ? (y - tapRay.ray.origin.y) / d.y : -1;
        if (t > 0 && t < 20000) p = [tapRay.ray.origin.x + d.x * t, y, tapRay.ray.origin.z + d.z * t];
      }
      if (p) flyToPointRef.current(p);
    };
    const onLookUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size < 2) lastPinch = 0;
      if (travelled > DRAG_PX) {
        // The click that follows the end of a drag is not a tap. Clear the flag if no click comes.
        suppressClickRef.current = true;
        window.setTimeout(() => (suppressClickRef.current = false), 350);
      } else if (pointers.size === 0 && lookAllowedRef.current) {
        // A real tap: two quick ones put the view back where the world had it.
        const now = performance.now();
        if (now - lastTapAt < 320) {
          lookRef.current = NO_LOOK;
          lastLookInputRef.current = now;
          if (tapFlyTimer !== null) window.clearTimeout(tapFlyTimer);
          tapFlyTimer = null;
        } else if (mode === "world" && currentWorld && currentWorld !== "deep-past" && PLACE_RULES[currentWorld] && !inside) {
          // A single tap flies there — after the double-tap window, so a double tap (reset view) never launches her.
          // Deep Past is excluded (merge integration, 2026-10-30): its taps belong to the rework mode
          // machine — a member tap opens its card, the walk/perch/ride own the camera — so a generic
          // fly-to-point would fight them. Other worlds keep main's tap-to-fly unchanged.
          const cx = e.clientX;
          const cy = e.clientY;
          tapFlyTimer = window.setTimeout(() => {
            tapFlyTimer = null;
            tapFly(cx, cy);
          }, 330);
        }
        lastTapAt = now;
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!lookAllowedRef.current) return;
      e.preventDefault();
      lookRef.current = zoomLook(lookRef.current, Math.exp(-e.deltaY * 0.0015));
      markLooked();
    };
    const onDouble = () => {
      lookRef.current = NO_LOOK;
      lastLookInputRef.current = performance.now();
    };
    host.addEventListener("pointerdown", onLookDown);
    host.addEventListener("pointermove", onLookMove);
    host.addEventListener("pointerup", onLookUp);
    host.addEventListener("pointercancel", onLookUp);
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("dblclick", onDouble);

    // Deep Past: the frame loop owns the mode refs; React state mirrors
    // are synced only on transitions (never per frame).
    const dpWalkSync = { moving: walkRefDp.current.moving, atLanding: walkRefDp.current.atLanding, mode: dpModeRef.current, perch: dpPerchRef.current };
    const syncDpWalk = () => {
      const w = walkRefDp.current;
      if (w.moving !== dpWalkSync.moving) {
        dpWalkSync.moving = w.moving;
        setDpWalkMoving(w.moving);
      }
      if (w.atLanding !== dpWalkSync.atLanding) {
        dpWalkSync.atLanding = w.atLanding;
        setDpAtLanding(w.atLanding);
      }
      if (dpModeRef.current !== dpWalkSync.mode) {
        dpWalkSync.mode = dpModeRef.current;
        setDpMode(dpModeRef.current);
      }
      if (dpPerchRef.current !== dpWalkSync.perch) {
        dpWalkSync.perch = dpPerchRef.current;
        setDpPerchStratum(dpPerchRef.current);
      }
    };
    const dpRideSync = { phase: rideRef.current.phase, stop: rideRef.current.stop };
    const syncDpRide = () => {
      const R = rideRef.current;
      if (R.phase !== dpRideSync.phase) {
        dpRideSync.phase = R.phase;
        setDpRidePhase(R.phase);
      }
      if (R.stop !== dpRideSync.stop) {
        dpRideSync.stop = R.stop;
        setDpRideStop(R.stop);
      }
    };

    let raf = 0;
    const startedAt = performance.now();
    let lastFrameAt = startedAt;
    let lastPlacesAt = 0;
    let lastNpcSyncAt = 0;
    const sceneStartedAt = performance.now();
    let lastAnchorAt = 0;
    let npcAnchorTries = 0;
    let npcAnchor: ReturnType<typeof anchorFromBounds> = null;
    let flightPhaseShown = "";
    const BASE_ANGLE = 0.6;
    const frame = () => {
      const elapsed = performance.now() - startedAt;
      // True while this world is running a scripted camera move the traveller's offset must not disturb.
      let scripted = false;
      let pivotY = orbit ? orbit.lookAtY : 0;
      // The point free look turns around; null = the world's centre at pivotY.
      let pivot: [number, number, number] | null = null;
      const now = performance.now();
      const dt = Math.min(250, now - lastFrameAt); // a backgrounded tab must not teleport her
      lastFrameAt = now;
      // The worlds' orbit distances were tuned on a landscape screen; back off on a phone (graph/worldCamera.ts).
      const fit = portraitFit(camera.aspect);
      // The cast lives here (docs/specs/npc-society-2026-10-30.md): whoever is in this world right now flies a lap of it with an engine flame and trail; the Station's
      // controller keeps her patrol from her berth. Each wears a tag, and coming near one is an encounter — they speak. Presentation only (graph/npcBodies.ts).
      if (mode === "world" && currentWorld && !inside && npcBodies) {
        if (now - lastNpcSyncAt > 1000) {
          lastNpcSyncAt = now;
          const present = castIn(currentWorld, Date.now());
          npcBodies.sync(present, (m) => {
            if (m.id !== "harbor-controller" || currentWorld !== "great-station") return null;
            // The Station draws her moored hull once its model lands; give it up to 12 s before flying a second copy.
            return world.group.getObjectByName("harbor-controller-ship") ?? (now - sceneStartedAt < 12_000 ? "wait" : null);
          });
          // The lap is round what the world is: measured from its own bounds once its models have had time to land (and again as they do).
          if (present.length > 0 && (!npcAnchor || (npcAnchorTries < 4 && now - lastAnchorAt > 5000))) {
            lastAnchorAt = now;
            npcAnchorTries++;
            npcAnchor = anchorFromBounds(world.group) ?? npcAnchor;
          }
        }
        const talking = talkNpcRef.current;
        const flTalk = flightRef.current;
        const frames = npcBodies.update(Date.now(), dt, {
          reducedMotion,
          anchor: npcAnchor,
          berth: currentWorld === "great-station" ? HARBOR_CONTROLLER_BERTH : null,
          hold: talking ? new Set([talking]) : undefined,
          faceToward: talking ? (flTalk ? flTalk.pos : [camera.position.x, camera.position.y, camera.position.z]) : null,
        });
        for (const f of frames) {
          const member = castMember(f.id);
          if (!member) continue;
          npcPosRef.current.set(f.id, [f.pos.x, f.pos.y, f.pos.z]);
          if (npcPhasesRef.current.get(f.id) !== f.phase) {
            npcPhasesRef.current.set(f.id, f.phase);
            // On her own station lap the Station controller names the phase of the patrol (docked / casting off / patrolling) when she is not in company.
            if (f.id === "harbor-controller" && member.home === currentWorld && f.phase !== "roaming") {
              const label = patrolLabel(f.phase);
              setPresentNpcs((list) => list.map((n) => (n.id === f.id && n.solo ? { ...n, activity: label } : n)));
            }
          }
          // Nearest of the camera and (while flying) the ship.
          const fl = flightRef.current;
          const d = Math.min(
            camera.position.distanceTo(f.pos),
            fl ? Math.hypot(fl.pos[0] - f.pos.x, fl.pos[1] - f.pos.y, fl.pos[2] - f.pos.z) : Infinity,
          );
          const enc = encounterStep(npcNearRef.current.get(f.id) ?? false, d);
          npcNearRef.current.set(f.id, enc.near);
          if (enc.entered && !metThisVisitRef.current.has(f.id)) {
            metThisVisitRef.current.add(f.id);
            const m = recordMeeting(getSpaceId(), f.id);
            if (m.recorded) {
              pushToast(encounterLine(member, currentWorld, f.phase, m.first, npcScriptRef.current, m.count), "🛰️", 7000, "normal");
              void storyRef.current.onMeeting(f.id, m.count);
            }
          }
          // The tag rides them on screen (a ref write, no re-render).
          const tag = npcTagEls.current.get(f.id);
          if (tag) {
            const sp = f.pos.clone().project(camera);
            const onScreen = sp.z < 1 && Math.abs(sp.x) < 0.92 && sp.y > -0.8 && sp.y < 0.55;
            tag.style.display = onScreen ? "" : "none";
            if (onScreen) {
              const host = hostRef.current;
              const w = host?.clientWidth ?? 0;
              const h = host?.clientHeight ?? 0;
              // Centred above them, but never half off the screen edge.
              const tw = tag.offsetWidth || 150;
              const x = Math.min(Math.max((sp.x * 0.5 + 0.5) * w - tw / 2, 6), Math.max(6, w - tw - 6));
              tag.style.transform = `translate(${x.toFixed(1)}px, calc(${((-sp.y * 0.5 + 0.5) * h).toFixed(1)}px - 130%))`;
            }
          }
        }
      }
      // Places to fly to are read from the scene's own named holders once a second (a model that loads late
      // simply appears); the avatar shows only while a flight is under way or parked.
      if (mode === "world" && currentWorld && PLACE_RULES[currentWorld] && !inside) {
        if (now - lastPlacesAt > 1000) {
          lastPlacesAt = now;
          world.group.updateMatrixWorld(true);
          const bodyRe = currentWorld === "scale" ? "^planet-(?!model)" : currentWorld === "great-station" || currentWorld === "people" ? "^backdrop-(?!.*-model$)" : null;
          shellsRef.current = bodyRe ? locateLandmarks(world.group, bodyRe).map((m) => ({ center: m.center, radius: m.radius })) : [];
          const found = findPlaces(currentWorld, world.group);
          const sig = found.map((pl) => `${pl.id}:${Math.round(pl.radius)}`).join("|");
          if (sig !== placesSigRef.current) {
            placesSigRef.current = sig;
            placesRef.current = found;
            setPlaces(found);
          }
        }
        if (avatar) avatar.group.visible = !!flightRef.current;
      }
      if (mode === "transit") {
        // The flight's clock is the server's: createdAt while arming, departedAt once under way — so a
        // reload resumes mid-sequence, and poll lag never lets the scene run ahead of the server's flip
        // (it holds on the last spool second until the journey actually departs).
        const j = journeyRef.current;
        const armMs = armMsOf(j);
        let t = elapsed;
        if (j) {
          const departed = j.departedAt ? Date.parse(j.departedAt) : NaN;
          const created = Date.parse(j.createdAt);
          if (j.state === "arming") {
            t = Math.min(armMs - 1, Math.max(0, Date.now() - (Number.isFinite(created) ? created : Date.now())));
            // The window has closed: ask the server now, instead of holding on "1" until the next poll.
            const deadline = Date.parse(j.cancelDeadline);
            if (Number.isFinite(deadline) && Date.now() >= deadline && Date.now() - lastDepartPollRef.current > 600) {
              lastDepartPollRef.current = Date.now();
              void refreshTravelRef.current();
            }
          }
          else t = armMs + Math.max(0, Date.now() - (Number.isFinite(departed) ? departed : Date.now()));
        }
        world.update(t, { reducedMotion });
        const tv = (world as TransitScene).view;
        if (tv) {
          if (Math.abs(camera.fov - tv.fov) > 0.01) {
            camera.fov = tv.fov;
            camera.updateProjectionMatrix();
          }
          if (travelFlashRef.current) travelFlashRef.current.style.opacity = String(tv.flash);
          if (travelBlurRef.current) travelBlurRef.current.style.opacity = String(tv.blur);
          // ETA in whole seconds and speed in 10% steps, so the HUD re-renders a few times a second, not every frame.
          const eta = Math.max(0, Math.ceil((armMs + transitTotalMs - t) / 1000));
          const speed = Math.round(tv.speed * 10) * 10;
          setTravelHud((prev) =>
            prev && prev.phase === tv.phase && prev.countdown === tv.countdown && prev.eta === eta && prev.speed === speed
              ? prev
              : { phase: tv.phase, countdown: tv.countdown, eta, speed },
          );
        }
      } else {
        world.update(elapsed, { reducedMotion });
        if (!propsDone && props && elapsed - propsTriedAt > 1000 && elapsed < 60_000) {
          propsTriedAt = elapsed;
          propsDone = props.place();
        }
      }
      if (mode === "world" && currentWorld === "growing-place") {
        // A8: the fog takes the warmer tint of the warmth now rendered.
        const fogColor = gardenSceneRef.current?.getWarmthFogColor?.();
        if (fogColor !== null && fogColor !== undefined && scene.fog) {
          (scene.fog as THREE.FogExp2).color.setHex(fogColor);
        }
      }
      if (mode === "transit") {
        // Chase view: behind and above the ship, looking down the corridor
        // at the arrival gate. The scene moves the gates; the camera holds.
        // The scene's `shake` is the engine's gathering shudder before the jump and the rush after it.
        const sk = (world as TransitScene).view?.shake ?? 0;
        camera.position.set(Math.sin(elapsed * 0.09) * sk, 8 + Math.cos(elapsed * 0.11) * sk, 26);
        camera.lookAt(0, 0, -60);
        // The engine's loudness follows its heat and the ship's speed: a low idle in the align, a rising spool,
        // full on the burn (drift stays quiet).
        const tvAudio = (world as TransitScene).view;
        const heat = tvAudio ? 0.25 + 0.5 * tvAudio.engine + 0.25 * tvAudio.speed : 1;
        engine?.setLevel(1, (transitKind === "warp" ? 1 : 0.35) * heat);
      } else if (orbit) {
        if (currentWorld === "great-station" && inside) {
          scripted = true; // the interior orbits its own room; not free-look (yet)
          // Station interior: the camera holds a slow orbit in the
          // current room — that orbit is how you look around your
          // docked ship in the hangar bay. Room changes jump: the
          // orbit simply holds the new room next frame, no glide, no
          // walk. Reduced motion holds one still angle. The arrival
          // glide never plays while inside (see the branch below).
          const room =
            interiorLayout?.spaces.find((s) => s.id === interiorRoomRef.current) ??
            interiorLayout?.spaces[0];
          if (room) {
            const cam = interiorSpaceCamera(room);
            const angle = reducedMotion
              ? BASE_ANGLE
              : BASE_ANGLE + elapsed * INTERIOR_ORBIT_RATE_RAD_PER_MS;
            camera.position.set(
              cam.center[0] + Math.sin(angle) * cam.radius,
              cam.height,
              cam.center[2] + Math.cos(angle) * cam.radius,
            );
            camera.lookAt(cam.center[0], cam.lookAtY, cam.center[2]);
          }
        } else if (flightRef.current && currentWorld && PLACE_RULES[currentWorld] && avatar) {
          // Flight to a place (docs/specs/worlds-flight-2026-10-29.md): her ship aligns, spools, burns and
          // stops; the camera chases behind and above her. Drag/pinch still turn and zoom around her.
          const r = stepFlight(flightRef.current, dt, { reducedMotion });
          const held = pushOutOfShells(r.state.pos, shellsRef.current);
          flightRef.current = held === r.state.pos ? r.state : { ...r.state, pos: held };
          // A glimmer "Look closer" that flew to the basin completes its find on arrival.
          if (r.arrived && glimmerFindRef.current) {
            const relic = glimmerFindRef.current;
            glimmerFindRef.current = null;
            findRelicRef.current(relic);
          }
          const fs = flightRef.current ?? r.state;
          const tgt = flightTargetRef.current;
          const phaseNow = r.arrived ? "arrived" : fs.phase;
          if (phaseNow !== flightPhaseShown && tgt) {
            flightPhaseShown = phaseNow;
            setFlightCaption(
              phaseNow === "arrived" || phaseNow === "idle"
                ? `${tgt.label} — ${scaleNote(tgt.radius)}`
                : phaseNow === "burn"
                  ? `Burning to ${tgt.label}`
                  : phaseNow === "spool"
                    ? `Engines spooling — ${tgt.label}`
                    : `Aligning to ${tgt.label}`,
            );
          }
          avatar.setPose(fs.pos, fs.yaw, fs.pitch);
          avatar.setHeat(fs.engine);
          avatar.group.updateMatrixWorld(true);
          avatar.setThrust(Math.max(0.12, fs.speed, fs.phase === "spool" ? fs.engine * 0.5 : 0));
          plume?.update(dt, avatar.exhaust(exhaustV));
          plumeFed = true;
          const pose = chasePose(fs);
          const prev = chaseCamRef.current ?? { pos: pose.position, target: pose.target };
          // Tighter during the burn, so she stays in frame while she takes off.
          const k = reducedMotion ? 1 : 1 - Math.exp(-dt / (fs.phase === "burn" ? 110 : 240));
          const mix = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
          const cam = { pos: mix(prev.pos, pose.position), target: mix(prev.target, pose.target) };
          chaseCamRef.current = cam;
          camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
          camera.lookAt(cam.target[0], cam.target[1], cam.target[2]);
          pivot = [fs.pos[0], fs.pos[1], fs.pos[2]];
          if (travelBlurRef.current) travelBlurRef.current.style.opacity = String(reducedMotion ? 0 : fs.speed * 0.55);
        } else if (currentWorld === "deep-past") {
          // Deep Past rework mode machine. FREE CAMERA (F17): no branch
          // here ever sets `scripted` — the look layer below applies the
          // traveller's offset on top of every mode, during every
          // animation. Each branch sets the pivot free look turns around.
          const dpScene = deepPastSceneRef.current;
          const layoutDp = isDeepPastLayout(sceneLayout) ? sceneLayout : null;
          const modeDp = dpModeRef.current;
          let kindle = rideRef.current.kindle; // a parked ride keeps its kindle
          let currentStop = -1;
          let shipPose: { position: DpVec; target: DpVec } | null = null;
          let camPos: DpVec;
          let camLook: DpVec;
          let pivotDp: DpVec;
          if (modeDp === "walk" && dpCurve) {
            const w = walkRefDp.current;
            if (w.moving && !reducedMotion) {
              const prevS = w.s;
              let ns = prevS + (w.dir * (14 * dt)) / Math.max(dpCurveLen, 1);
              // The walk WAITS at every landing it crosses (F2).
              const crossed = dpLandingS
                .filter((l) =>
                  w.dir > 0
                    ? l.s > prevS + 1e-6 && l.s <= ns + 1e-9
                    : l.s < prevS - 1e-6 && l.s >= ns - 1e-9,
                )
                .sort((a, b) => (w.dir > 0 ? a.s - b.s : b.s - a.s))[0];
              if (crossed) {
                ns = crossed.s;
                w.moving = false;
                if (crossed.stratum === 9) {
                  // The basin landing ends the walk: settle into the basin perch.
                  w.atLanding = null;
                  dpFocusRef.current = null;
                  dpPerchRef.current = 9;
                  dpModeRef.current = "perch";
                } else {
                  w.atLanding = crossed.stratum;
                }
              } else if (ns >= 1) {
                ns = 1;
                w.moving = false;
                dpFocusRef.current = null;
                dpPerchRef.current = 9;
                dpModeRef.current = "perch";
              } else if (ns <= 0) {
                ns = 0;
                w.moving = false;
                const l0 = dpLandingS.find((l) => Math.abs(l.s) < 1e-4);
                w.atLanding = l0 ? l0.stratum : null;
              }
              w.s = Math.min(1, Math.max(0, ns));
              syncDpWalk();
            }
            const sC = Math.min(1, Math.max(0, w.s));
            const pt = dpCurve.getPointAt(sC);
            const ahead = dpCurve.getPointAt(Math.min(sC + 12 / Math.max(dpCurveLen, 1), 1));
            // The eye rides 3 units OUT from the curve and a touch
            // higher, and the look blends 45% toward the disc centre —
            // tuned against the A1 mid-descent render, where riding the
            // curve centre-line framed almost nothing but dark disc
            // tops (prototype §9: the walk camera needs the close,
            // angled views, not a plumb-line stare down the stair).
            const radLen = Math.hypot(pt.x, pt.z) || 1;
            camPos = [pt.x + (pt.x / radLen) * 3, pt.y + 3.6, pt.z + (pt.z / radLen) * 3];
            camLook = lerpVec([ahead.x, ahead.y + 1.8, ahead.z], [0, pt.y + 1.2, 0], 0.45);
            // On the final basin segment the look settles toward the orb.
            const s8 = dpLandingS.find((l) => l.stratum === 8);
            const s9 = dpLandingS.find((l) => l.stratum === 9);
            if (s8 && s9 && sC > s8.s) {
              const t = Math.min(1, (sC - s8.s) / Math.max(s9.s - s8.s, 1e-6));
              camLook = lerpVec(camLook, DP_ORB_POS, t);
            }
            pivotDp = camLook;
          } else if (modeDp === "perch") {
            const focus = dpFocusRef.current;
            const landing = dpLandingS.find((l) => l.stratum === dpPerchRef.current);
            // The basin perch orbits INSIDE the bowl, around the orb:
            // pivot on the orb, radius 30, a few units above its centre.
            // Raycast proof on the built scene (probe, 2026-10-30): any
            // perch ABOVE stratum 8's disc plane is blocked by that disc
            // (its 252° arc covers every azimuth but the stair gap) —
            // the prototype's basin framing is an in-bowl view, so the
            // perch lives in the bowl too. Perching at the basin
            // LANDING instead filled the frame with dish rim.
            const basinPerch = dpPerchRef.current === 9 && !focus;
            const base: DpVec = focus
              ? focus.point
              : basinPerch
                ? DP_ORB_POS
                : landing
                  ? landing.point
                  : [0, deepPastFloorY(Math.min(8, Math.max(0, dpPerchRef.current))), 0];
            pivotDp = basinPerch ? base : [base[0], base[1] + 1.5, base[2]];
            const radius = focus ? 8 : basinPerch ? 30 : 15;
            const perchHeight = basinPerch ? 6 : 5;
            const a = reducedMotion ? BASE_ANGLE : BASE_ANGLE + elapsed * 0.0000045;
            camPos = [pivotDp[0] + Math.sin(a) * radius, pivotDp[1] + perchHeight, pivotDp[2] + Math.cos(a) * radius];
            camLook = pivotDp;
          } else if (modeDp === "ride" && layoutDp?.thread && dpScene) {
            // Ship-led Chronicle ride (F5/AN14): the ship travels the
            // thread between stops; the camera chases her; the traveller
            // may look freely around her the whole time (F17).
            const stops = layoutDp.thread.stops;
            const fracs = dpScene.stopFractions();
            const wpPos = (key: number): DpVec =>
              key < 0
                ? DP_BERTH_POS
                : key >= stops.length
                  ? DP_BASIN_REST
                  : [stops[key]!.x, stops[key]!.y + 2.2, stops[key]!.z];
            const R = rideRef.current;
            if (R.phase === "traveling" && !R.leg && R.pendingLeg) {
              const from = wpPos(R.pendingLeg.from);
              const to = wpPos(R.pendingLeg.to);
              const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
              R.leg = {
                from: R.pendingLeg.from,
                to: R.pendingLeg.to,
                tMs: 0,
                durMs: Math.min(9, Math.max(2.2, dist / 9)) * 1000,
                fromKindle: R.kindle,
                toKindle: R.pendingLeg.to >= stops.length ? 1 : (fracs[R.pendingLeg.to] ?? R.kindle),
              };
              R.pendingLeg = null;
            }
            let shipPos: DpVec = DP_BERTH_POS;
            let shipTan: DpVec = [0, 0, 1];
            if (R.phase === "traveling" && R.leg) {
              const leg = R.leg;
              leg.tMs = reducedMotion ? leg.durMs : leg.tMs + dt;
              const k = Math.min(1, leg.tMs / Math.max(leg.durMs, 1));
              const e = (1 - Math.cos(Math.PI * k)) / 2; // cosine 'drift' gait (AN9)
              if (leg.from >= 0 && leg.to >= 0 && leg.to < stops.length) {
                // Stop → stop: the ship rides the thread curve itself.
                const u = (fracs[leg.from] ?? 0) + ((fracs[leg.to] ?? 0) - (fracs[leg.from] ?? 0)) * e;
                const tp = dpScene.threadPointAt(u);
                if (tp) {
                  shipPos = [tp.position[0], tp.position[1], tp.position[2]];
                  shipTan = [tp.tangent[0], tp.tangent[1], tp.tangent[2]];
                } else {
                  shipPos = lerpVec(wpPos(leg.from), wpPos(leg.to), e);
                }
                R.kindle = u; // the kindling front is at the ship (AN14)
              } else {
                // Berth → first stop, or last stop → basin rest: direct legs.
                shipPos = lerpVec(wpPos(leg.from), wpPos(leg.to), e);
                const endTp = dpScene.threadPointAt(leg.to >= stops.length ? 1 : (fracs[leg.to] ?? 0));
                if (endTp) shipTan = [endTp.tangent[0], endTp.tangent[1], endTp.tangent[2]];
                R.kindle = leg.fromKindle + (leg.toKindle - leg.fromKindle) * e;
              }
              if (k >= 1) {
                if (leg.to >= stops.length) {
                  R.phase = "complete";
                  R.kindle = 1;
                } else {
                  R.phase = "dwelling";
                  R.stop = leg.to;
                  R.kindle = fracs[leg.to] ?? R.kindle;
                }
                R.leg = null;
                syncDpRide();
              }
            } else if (R.phase === "complete") {
              shipPos = DP_BASIN_REST;
              R.kindle = 1;
              const tp = dpScene.threadPointAt(1);
              if (tp) shipTan = [tp.tangent[0], tp.tangent[1], tp.tangent[2]];
            } else if (R.phase === "dwelling") {
              shipPos = wpPos(R.stop);
              currentStop = R.stop;
              R.kindle = fracs[R.stop] ?? R.kindle;
              const tp = dpScene.threadPointAt(fracs[R.stop] ?? 0);
              if (tp) shipTan = [tp.tangent[0], tp.tangent[1], tp.tangent[2]];
            }
            const tanLen = Math.hypot(shipTan[0], shipTan[1], shipTan[2]) || 1;
            const tan: DpVec = [shipTan[0] / tanLen, shipTan[1] / tanLen, shipTan[2] / tanLen];
            shipPose = {
              position: shipPos,
              target: [shipPos[0] + tan[0], shipPos[1] + tan[1], shipPos[2] + tan[2]],
            };
            kindle = R.kindle;
            // Chase camera: behind and above the ship, exponentially smoothed.
            const desired: DpVec = [shipPos[0] - tan[0] * 15, shipPos[1] + 6, shipPos[2] - tan[2] * 15];
            const chase = dpChaseRef.current;
            let chasePos: DpVec;
            if (!chase || reducedMotion || Math.hypot(desired[0] - chase.pos[0], desired[1] - chase.pos[1], desired[2] - chase.pos[2]) > 60) {
              dpChaseRef.current = { pos: desired };
              chasePos = desired;
            } else {
              const kk = 1 - Math.exp(-dt / 240);
              chase.pos = lerpVec(chase.pos, desired, kk);
              chasePos = chase.pos;
            }
            camPos = chasePos;
            camLook = shipPos;
            pivotDp = shipPos;
          } else {
            // Overview: the rim orbit around the well's centre. Idle
            // (AN9): ≈9°/s until the traveller's first interaction this
            // visit, then the slow parked rate; static under RM.
            const rate = reducedMotion ? 0 : dpInteractedRef.current ? 0.0000045 : 0.00016;
            const angle = BASE_ANGLE + elapsed * rate;
            camPos = [
              Math.sin(angle) * orbit.orbitRadius * fit,
              orbit.orbitHeight * fit + 10,
              Math.cos(angle) * orbit.orbitRadius * fit,
            ];
            camLook = [0, orbit.lookAtY, 0];
            pivotDp = camLook;
          }
          camera.position.set(camPos[0], camPos[1], camPos[2]);
          camera.lookAt(camLook[0], camLook[1], camLook[2]);
          pivot = pivotDp;
          pivotY = pivotDp[1];
          dpFrameRef.current = { kindle, currentStop, shipPose };
        } else if (currentWorld === "great-station" && !inside && !reducedMotion && !arrivalSkippedRef.current) {
          // Station arrival (A13): fly the approach over 12 s, then
          // settle into the resting orbit over 3 s — radius, height,
          // and azimuth all ease from the arrival pose, so there is no
          // pop when the glide hands over to the orbit.
          const smoothstep = (x: number) => x * x * (3 - 2 * x);
          const orbitAngle = BASE_ANGLE + elapsed * 0.0000045;
          const arrival = approachPose(1);
          const arrivalHeight = Math.sin(arrival.elevation) * arrival.distance;
          const t = elapsed / STATION_ARRIVAL_MS;
          if (t < 1) {
            scripted = true; // the arrival glide; a tap skips it and frees the camera
            const pose = approachPose(t);
            const d = pose.distance;
            camera.position.set(
              Math.sin(pose.azimuth) * Math.cos(pose.elevation) * d,
              Math.sin(pose.elevation) * d,
              Math.cos(pose.azimuth) * Math.cos(pose.elevation) * d,
            );
            camera.lookAt(0, 0, 0);
          } else {
            const s = smoothstep(Math.min(1, (elapsed - STATION_ARRIVAL_MS) / 3000));
            const radius = arrival.distance + (orbit.orbitRadius * fit - arrival.distance) * s;
            const height = arrivalHeight + (orbit.orbitHeight * fit - arrivalHeight) * s;
            const az = arrival.azimuth + (orbitAngle - arrival.azimuth) * s;
            camera.position.set(Math.sin(az) * radius, height, Math.cos(az) * radius);
            camera.lookAt(0, orbit.lookAtY, 0);
          }
        } else if (currentWorld === "growing-place" && gardenSceneRef.current) {
          // Garden v2 walk: her ship skims along the route; the camera
          // follows behind and above her (graph/gardenWalk.ts). Reduced
          // motion: she jumps, and the camera cuts instead of easing.
          const step = stepWalk(walkRef.current, dt, { reducedMotion });
          walkRef.current = step.state;
          const moving = step.state.route.length > 0 || step.arrived;
          if (step.arrived) setWalkingTo(null);
          if (step.arrived && arrivalRef.current) {
            const a = arrivalRef.current;
            arrivalRef.current = null;
            onArriveRef.current(a);
          }
          const f = followRef.current;
          const pos = step.state.pos;
          const groundY = groundHeightAt(pos.x, pos.z) + WALK_HOVER;
          const ease = (ms: number) => (reducedMotion || f.cam === null ? 1 : 1 - Math.exp(-dt / ms));
          f.y += (groundY - f.y) * ease(220);
          if (f.cam === null) f.yaw = step.state.heading;
          if (moving) f.yaw = easeAngle(f.yaw, step.state.heading, ease(450));
          gardenSceneRef.current.setAvatar(pos.x, f.y, pos.z, step.state.heading);
          gardenSceneRef.current.setCarrying(carryingRef.current !== null);
          gardenSceneRef.current.setGrovePulse(carryingRef.current !== null);
          // Her flame while she skims (a low idle glow when she stands), and the trail she leaves behind.
          gardenSceneRef.current.setThrust(step.state.route.length > 0 ? 0.8 : 0.12);
          const hd = step.state.heading;
          plume?.update(dt, step.state.route.length > 0 ? exhaustV.set(pos.x - Math.sin(hd) * 14, f.y, pos.z - Math.cos(hd) * 14) : null);
          plumeFed = true;
          const pose = followPose(pos, f.y, f.yaw);
          const k = ease(260);
          const prev = f.cam ?? pose.position;
          f.cam = [
            prev[0] + (pose.position[0] - prev[0]) * k,
            prev[1] + (pose.position[1] - prev[1]) * k,
            prev[2] + (pose.position[2] - prev[2]) * k,
          ];
          camera.position.set(f.cam[0], f.cam[1], f.cam[2]);
          pivot = pose.target;
          camera.lookAt(pivot[0], pivot[1], pivot[2]);
        } else {
          const angle = reducedMotion ? BASE_ANGLE : BASE_ANGLE + elapsed * 0.0000045;
          camera.position.set(
            Math.sin(angle) * orbit.orbitRadius * fit,
            orbit.orbitHeight * fit,
            Math.cos(angle) * orbit.orbitRadius * fit,
          );
          camera.lookAt(0, orbit.lookAtY, 0);
        }
        // AN16 gentle return (Deep Past only): after ~2.5 s without look
        // input, the traveller's offset eases back toward the mode's
        // composed default. A fresh input interrupts it instantly (the
        // timestamp above is what the traveller's handlers stamp).
        if (
          currentWorld === "deep-past" &&
          isLooked(lookRef.current) &&
          now - lastLookInputRef.current > 2500
        ) {
          const f = Math.exp(-dt / 600);
          const l = lookRef.current;
          const next = { yaw: l.yaw * f, pitch: l.pitch * f, zoom: 1 + (l.zoom - 1) * f };
          lookRef.current =
            Math.abs(next.yaw) < 0.001 && Math.abs(next.pitch) < 0.001 && Math.abs(next.zoom - 1) < 0.001
              ? NO_LOOK
              : next;
        }
        // Free look: the traveller's own offset on top of the pose the world just chose.
        lookAllowedRef.current = !scripted;
        if (!pivot) pivot = [0, pivotY, 0];
        if (!scripted && isLooked(lookRef.current)) {
          const p = applyLook(
            [camera.position.x, camera.position.y, camera.position.z],
            pivot,
            lookRef.current,
          );
          camera.position.set(p[0], p[1], p[2]);
          camera.lookAt(pivot[0], pivot[1], pivot[2]);
        }
        // Deep Past scene frame state, every frame (rework contract):
        // the ride's kindle/stop/ship pose (null ship pose outside the
        // ride — the scene berths her), and the camera's true position.
        if (currentWorld === "deep-past") {
          const fs = dpFrameRef.current;
          deepPastSceneRef.current?.setFrameState({
            kindle: fs.kindle,
            currentStop: fs.currentStop,
            shipPose: fs.shipPose,
            cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
          });
        }
        // The overview camera's pose, so the first flight carries on from where you were looking.
        if (!flightRef.current) {
          overviewCamRef.current = { pos: [camera.position.x, camera.position.y, camera.position.z], look: [pivot[0], pivot[1], pivot[2]] };
          if (mode === "world" && travelBlurRef.current) travelBlurRef.current.style.opacity = "0";
        }
        host.dataset.look = isLooked(lookRef.current)
          ? `${lookRef.current.yaw.toFixed(3)},${lookRef.current.pitch.toFixed(3)},${lookRef.current.zoom.toFixed(3)}`
          : "";
        // Camera floor: where the world sets one (the garden), the view
        // never drops below it — no pose can ever sink under the garden.
        if (orbit.cameraFloorY !== undefined) {
          camera.position.y = clampToGardenFloor(camera.position.y);
        }
        // The heavens shake when Eternity speaks — the scene reports
        // the shudder, the host applies it to its own camera after
        // lookAt, so it can never accumulate.
        if (eternityCtl) {
          const shake = eternityCtl.shakeAt(elapsed);
          if (shake > 0.01) {
            camera.rotation.x += (Math.random() - 0.5) * 0.02 * shake;
            camera.rotation.y += (Math.random() - 0.5) * 0.02 * shake;
          }
        }
      }
      // The warp swings the whole sky round the holding ship (the same yaw its gates turn with).
      sky?.update(camera.position, elapsed / 1000, mode === "transit" ? -((world as TransitScene).view?.yaw ?? 0) : 0, reducedMotion);
      try {
        // The trail fades out when the ship is hidden or parked away, and follows a trail colour changed mid-visit.
        if (plume && !plumeFed) plume.update(dt, null);
        plumeFed = false;
        if (plumeTrail !== trailRef.current) {
          plumeTrail = trailRef.current;
          plume?.setTrail(plumeTrail);
          avatar?.setTrail(plumeTrail);
          gardenSceneRef.current?.setTrail(plumeTrail);
        }
        renderer.render(scene, camera);
      } catch (err) {
        console.error(`[worlds] render failed for ${mode === "transit" ? "transit" : currentWorld}`, err);
        setGraphicsFailed(true);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      props?.dispose();
      window.removeEventListener("resize", onResize);
      host.removeEventListener("pointerdown", skipArrival);
      host.removeEventListener("pointerdown", onLookDown);
      host.removeEventListener("pointermove", onLookMove);
      if (tapFlyTimer !== null) window.clearTimeout(tapFlyTimer);
      host.removeEventListener("pointerup", onLookUp);
      host.removeEventListener("pointercancel", onLookUp);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("dblclick", onDouble);
      lookAllowedRef.current = false;
      gardenSceneRef.current = null;
      deepPastSceneRef.current = null;
      dpCameraRef.current = null;
      engine?.dispose();
      lighting?.dispose();
      sky?.dispose();
      avatar?.dispose();
      plume?.dispose();
      npcBodies?.dispose();
      npcBodiesRef.current = null;
      world.dispose();
      sceneHandleRef.current = null;
      // Keep the renderer (and its context) for the next world; free only this scene's render lists.
      renderer.renderLists.dispose();
      renderer.domElement.remove();
      gardenSceneRef.current = null;
      gardenCameraRef.current = null;
    };
  }, [visible, mode, entry, currentWorld, sceneLayout, gardenGlow, transitKind, transitTotalMs, journey?.origin, journey?.destination, inside, interiorLayout, interiorShipSkin, handleRelicVisible]);

  if (!visible || !mode) {
    return homeArrivalKey > 0 ? (
      <div key={`home-${homeArrivalKey}`} className="travel-home-arrival" aria-hidden={false}>
        <div className="travel-arrive-fade" aria-hidden="true" />
        <div className="travel-arrived" role="status">Arrived · Home</div>
      </div>
    ) : null;
  }
  const title = mode === "transit" ? transitTitle : (entry?.title ?? "");
  const fallback = mode === "transit" ? transitFallback : (entry?.fallback ?? "");
  const thread = atDeepPast ? deepPastLayout?.thread ?? null : null;
  const interiorRoomInfo =
    atStation && inside
      ? (interiorLayout?.spaces.find((s) => s.id === interiorRoom) ?? null)
      : null;

  // The dock (docs/specs/worlds-controls-2026-10-29.md): each world's controls
  // as icon-over-word tiles. Accessible names keep the full phrases.
  const ROOM_TILE: Record<string, { icon: string; label: string }> = {
    "hangar-bay": { icon: "i:hangar", label: "Hangar" },
    "commission-board": { icon: "i:notes", label: "Board" },
    "fleet-deck": { icon: "i:rocket", label: "Fleet" },
    "observation-deck": { icon: "i:observatory", label: "Deck" },
  };
  const GESTURE_ICON: Record<string, string> = {
    stillness: "i:stillness",
    regard: "i:regard",
    blessing: "i:insights",
    sorrow: "i:drop",
    joy: "i:sun",
    warning: "i:warning",
  };
  const TOOL_TILE: Record<string, { icon: string; label: string; name: string }> = {
    reorder: { icon: "i:reorder", label: "Reorder", name: "Reorder the heavens" },
    "part-veil": { icon: "i:veil", label: "Veil", name: "Part the veil" },
    shield: { icon: "i:shield", label: "Shield", name: "Raise the shield" },
    comet: { icon: "i:comet", label: "Comet", name: "Send a comet" },
  };
  const dockGroups: DockGroup[] = [];
  {
    if (atGarden && mode === "world") {
      dockGroups.push({
        id: "garden",
        tiles: [
          { id: "groves", icon: "i:groves", label: "Groves", name: "Groves", expanded: grovesOpen, onClick: () => setGrovesOpen((v) => !v) },
          {
            id: "meadow",
            icon: "i:meadow",
            label: "Meadow",
            name: "Walk to the meadow",
            onClick: () => {
              setGrovesOpen(false);
              walkTo(initialWalk().pos, null);
            },
          },
        ],
      });
    }
    if (atStation) {
      const tiles: DockGroup["tiles"] = [
        {
          id: "harbor",
          icon: "i:harbor",
          label: "Harbor",
          name: showController ? "Hide the harbor controller" : "Harbor controller",
          active: showController,
          onClick: () => setShowController((v) => !v),
        },
        inside
          ? { id: "outside", icon: "i:calm", label: "Back outside", name: "Step back outside", onClick: () => setInside(false) }
          : { id: "inside", icon: "i:door", label: "Step inside", name: "Step inside the Station", onClick: () => setInside(true) },
      ];
      if (inside) {
        for (const room of interiorLayout?.spaces.filter((sp) => sp.id !== interiorRoom) ?? []) {
          const t = ROOM_TILE[room.id] ?? { icon: "i:door", label: room.title.replace(/^The /, "") };
          tiles.push({
            id: `room-${room.id}`,
            icon: t.icon,
            label: t.label,
            name: `Go to the ${room.title.replace(/^The /, "")}`,
            onClick: () => goToInteriorRoom(room.id),
          });
        }
      }
      dockGroups.push({ id: "station", tiles });
    }
    if (mode === "world" && places.length > 0 && !inside) {
      dockGroups.push({
        id: "places",
        label: "Fly to",
        tiles: [
          ...(flightTargetId
            ? [{ id: "overview", icon: "i:observatory", label: "Overview", name: "Back to the overview", onClick: backToOverview }]
            : []),
          ...places.map((pl) => ({
            id: `place-${pl.id}`,
            icon: pl.icon,
            label: pl.label.split(" ").slice(0, 2).join(" "),
            name: `Fly to ${pl.label}`,
            active: flightTargetId === pl.id,
            onClick: () => flyTo(pl),
          })),
        ],
      });
    }
    if (atDeepPast && mode === "world") {
      // Deep Past rework dock: the mode's verbs. The dock chrome itself
      // is untouched — only this group's contents are the modes'.
      const tiles: DockGroup["tiles"] = [];
      if (dpMode === "overview") {
        tiles.push({ id: "dp-walk", icon: "i:descend", label: "Walk", name: "Walk the stair", onClick: startWalk });
        if (thread) {
          tiles.push({ id: "dp-ride", icon: "i:descend", label: "Chronicle", name: "Descend the Chronicle", onClick: enterRide });
        }
      } else if (dpMode === "walk") {
        if (dpAtLanding !== null) {
          tiles.push({ id: "dp-keep", icon: "i:descend", label: "Keep walking", name: "Keep walking", onClick: keepWalking });
          tiles.push(
            dpAtLanding === 9
              ? { id: "dp-step-off", icon: "i:meadow", label: "Step onto", name: "Step onto the basin floor", onClick: stepOff }
              : {
                  id: "dp-step-off",
                  icon: "i:meadow",
                  label: "Step off",
                  name: `Step off — Depth ${dpAtLanding + 1} of 9`,
                  onClick: stepOff,
                },
          );
        } else if (dpWalkMoving) {
          tiles.push({ id: "dp-pause", icon: "i:calm", label: "Pause", name: "Pause walk", onClick: toggleWalkMoving });
        } else {
          // keepWalking resumes normally, and jumps landing-to-landing under reduced motion.
          tiles.push({ id: "dp-resume", icon: "i:descend", label: "Resume", name: "Resume walk", onClick: keepWalking });
        }
        tiles.push({ id: "dp-rim", icon: "i:rise", label: "Rim", name: "Back to the rim", onClick: backToRim });
      } else if (dpMode === "perch") {
        if (dpPerchStratum < 9) {
          tiles.push({ id: "dp-down", icon: "i:descend", label: "Down", name: "Next flight down", onClick: () => perchFlight(1) });
        }
        if (dpPerchStratum > 0) {
          tiles.push({ id: "dp-up", icon: "i:rise", label: "Up", name: "Flight back up", onClick: () => perchFlight(-1) });
        }
        tiles.push({ id: "dp-rim", icon: "i:recenter", label: "Rim", name: "Return to the rim", onClick: backToRim });
      } else if (dpMode === "ride") {
        if (dpRidePhase === "dwelling") {
          tiles.push({ id: "dp-continue", icon: "i:descend", label: "Continue", name: "Continue the Chronicle", onClick: continueRide });
          tiles.push({
            id: "dp-approach",
            icon: "i:insights",
            label: "Approach",
            name: "Approach this memory",
            onClick: () => {
              const stop = thread?.stops[dpRideStop];
              if (stop) openDpMember(stop.nodeId);
            },
          });
          tiles.push({ id: "dp-leave", icon: "i:rise", label: "Leave", name: "Leave the ride", onClick: leaveRide });
        } else if (dpRidePhase === "complete") {
          tiles.push({ id: "dp-rim", icon: "i:recenter", label: "Rim", name: "Return to the rim", onClick: backToRim });
        } else {
          tiles.push({ id: "dp-leave", icon: "i:rise", label: "Leave", name: "Leave the ride", onClick: leaveRide });
        }
      }
      if (tiles.length > 0) dockGroups.push({ id: "deep-past", tiles });
    }
    // Who's here: whoever is in this world right now (their lives move them between worlds), findable in one tap (docs/specs/npc-society-2026-10-30.md).
    if (mode === "world" && !inside && presentNpcs.length > 0) {
      dockGroups.push({
        id: "npcs",
        label: "Who's here",
        tiles: presentNpcs.map((pn) => {
          const m = castMember(pn.id)!;
          const canFly = !!currentWorld && !!PLACE_RULES[currentWorld] && npcPosRef.current.has(pn.id);
          return {
            id: `npc-${pn.id}`,
            icon: npcIcon(m),
            label: m.name.replace(/^The /, "").split(" ")[0]!,
            name: canFly ? `Fly to ${m.name}, ${pn.activity}` : `${m.name}, ${pn.activity}`,
            onClick: () => {
              const pos = npcPosRef.current.get(pn.id);
              if (canFly && pos) flyTo({ id: `npc-${pn.id}`, label: m.name, icon: npcIcon(m), center: pos, radius: 14 });
              setNpcCard(pn.id);
            },
          };
        }),
      });
    }
    if (atEternity) {
      dockGroups.push(
        {
          id: "gestures",
          label: "His gestures",
          tiles: ETERNITY_GESTURE_NAMES.map((name) => ({
            id: `gesture-${name}`,
            icon: GESTURE_ICON[name] ?? "i:insights",
            label: name[0]!.toUpperCase() + name.slice(1),
            name: name[0]!.toUpperCase() + name.slice(1),
            active: eternityGesture === name,
            onClick: () => {
              // The label names what he holds only when the scene
              // actually mounted — a fallback world holds nothing.
              const e = sceneHandleRef.current?.eternity;
              if (!e) return;
              e.setGesture(name);
              setEternityGesture(name);
            },
          })),
        },
        {
          id: "tools",
          label: "His tools",
          tiles: ETERNITY_TOOL_NAMES.map((name) => {
            const t = TOOL_TILE[name]!;
            return { id: `tool-${name}`, icon: t.icon, label: t.label, name: t.name, onClick: () => sceneHandleRef.current?.eternity?.useTool(name) };
          }),
        },
      );
    }
    if (mode === "world" && currentWorld) {
      // Noticing: the way the story is found. Stay still; the world may answer. (Never a timer you can miss — only a stillness.)
      dockGroups.push({
        id: "notice",
        label: "Notice",
        tiles: [
          { id: "regard", icon: "i:regard", label: "Regard", name: "Stay still and regard this place", active: story.noticing === "regard", onClick: () => story.begin("regard") },
          { id: "listen", icon: "i:music", label: "Listen", name: "Stay still and listen", active: story.noticing === "listen", onClick: () => story.begin("listen") },
        ],
      });
    }
  }

  return (
    <section className={`worlds-surface${atPaleWorld && mode === "world" ? " worlds-surface-light" : ""}${dockGroups.length > 0 ? " worlds-surface-docked" : ""}`} role="dialog" aria-label={title}>
      <div className="worlds-surface-canvas" ref={hostRef} onClick={handleCanvasClick} />
      {/* EVE-style travel (docs/specs/eve-travel-2026-10-29.md): the edge blur and the jump flash are
          driven per frame by the flight scene (refs, no re-render); the HUD reads the phase. */}
      {(mode === "transit" || mode === "world") && (
        <>
          <div className="travel-blur" ref={travelBlurRef} aria-hidden="true" />
          <div className="travel-flash" ref={travelFlashRef} aria-hidden="true" />
        </>
      )}
      {/* Flight inside a world: what the ship is doing, and — on arrival — how big the place is next to her. */}
      {mode === "world" && flightCaption && (
        <div className="travel-hud" role="status">
          <span className="travel-hud-phase">{flightCaption}</span>
        </div>
      )}
      {mode === "transit" && (
        <>
          {travelHud && journey && (
            <div className="travel-hud" role="status">
              <span className="travel-hud-phase">
                {travelHud.phase === "align"
                  ? `Aligning to ${worldName(journey.destination)}`
                  : travelHud.phase === "spool"
                    ? "Engines spooling"
                    : travelHud.phase === "arrive"
                      ? "Slowing for arrival"
                      : journey.kind === "warp"
                        ? "Warp"
                        : `Drifting to ${worldName(journey.destination)}`}
              </span>
              {journey.state !== "arming" && (
                <span className="travel-hud-readout">
                  <span>{`Arrival in ${travelHud.eta} s`}</span>
                  <span aria-label={`Velocity ${travelHud.speed} percent`}>
                    {`Velocity ${travelHud.speed}% `}
                    <span className="travel-hud-bar" aria-hidden="true">
                      <span style={{ width: `${travelHud.speed}%` }} />
                    </span>
                  </span>
                </span>
              )}
              {travelHud.countdown !== null && (
                <span className="travel-hud-count" aria-label={`${travelHud.countdown} seconds to jump`}>
                  {travelHud.countdown}
                </span>
              )}
              {journey.state === "arming" && (
                <button type="button" className="travel-hud-cancel" onClick={() => void travel.cancel()}>
                  Cancel departure
                </button>
              )}
            </div>
          )}
        </>
      )}
      {arrivalFadeKey > 0 && mode === "world" && <div key={arrivalFadeKey} className="travel-arrive-fade" aria-hidden="true" />}
      {arrivalFadeKey > 0 && mode === "world" && (
        <div key={`arrived-${arrivalFadeKey}`} className="travel-arrived" role="status">
          {`Arrived · ${worldName(currentWorld ?? "home")}`}
        </div>
      )}
      {mode === "world" && !inside && presentNpcs.map((pn) => {
        const m = castMember(pn.id);
        if (!m || !m.shipUrl || (pn.id === "harbor-controller" && showController)) return null;
        return (
          <button
            key={pn.id}
            type="button"
            ref={(el) => {
              if (el) npcTagEls.current.set(pn.id, el);
              else npcTagEls.current.delete(pn.id);
            }}
            className="npc-tag"
            style={{ display: "none" }}
            aria-label={`${m.name}, ${pn.activity} — tap for details`}
            onClick={() => {
              if (pn.id === "harbor-controller" && atStation) setShowController(true);
              else setNpcCard(pn.id);
            }}
          >
            <span aria-hidden="true">{renderIcon(npcIcon(m), 16)}</span>
            <span>
              <strong>{m.name}</strong>
              <em>{pn.activity}</em>
            </span>
          </button>
        );
      })}
      {npcCard && mode === "world" && (() => {
        const m = castMember(npcCard);
        if (!m) return null;
        const pn = presentNpcs.find((n) => n.id === m.id);
        const met = readMet(getSpaceId())[m.id];
        // What they want this season, and a line they might be overheard saying (the day's script, or their own goals offline).
        const goal = m.goals.length > 0 ? m.goals[Math.floor(hash01(`${m.id}|${society.dayKey}|goal`) * m.goals.length)] : null;
        const chat = npcScriptRef.current?.lines[m.id]?.chatter;
        const overheard = chat && chat.length > 0 ? chat[Math.floor(hash01(`${m.id}|${Math.floor(Date.now() / 1_800_000)}|chat`) * chat.length)] : null;
        return (
          <div className="npc-note npc-card" role="dialog" aria-label={m.name}>
            <div>
              <strong>{m.name}</strong> — {m.job}
              <span className="npc-card-line">{pn?.activity ?? ""}{m.home !== currentWorld ? " · far from home" : ""}</span>
              {pn?.faction && <span className="npc-card-line">{pn.faction} · {pn.faith}{pn.calling ? ` · called today to ${pn.calling.toLowerCase()}` : ""}</span>}
              {!pn?.faction && <span className="npc-card-line">Answers to no faction · {pn?.faith ?? ""}</span>}
              {goal && <span className="npc-card-line">Wants: {goal}</span>}
              {overheard && <span className="npc-card-line">Overheard: “{overheard.replace(/^["“]|["”]$/g, "")}”</span>}
              <span className="npc-card-line">{m.lore.tagline}</span>
              {met && <span className="npc-card-line">You have met {met.count} time{met.count === 1 ? "" : "s"}.</span>}
            </div>
            {canTalkTo(m.id) && (
              <button
                type="button"
                className="mini"
                onClick={() => {
                  // Talking is a meeting too (the same 20-minute cooldown applies), so a thread can open from a conversation, not only from passing by.
                  const mt = recordMeeting(getSpaceId(), m.id);
                  if (mt.recorded) void storyRef.current.onMeeting(m.id, mt.count);
                  setNpcCard(null);
                  setTalkNpc(m.id);
                }}
              >
                Talk
              </button>
            )}
            <button type="button" className="mini" onClick={() => setNpcCard(null)} aria-label="Close">
              ✕
            </button>
          </div>
        );
      })()}
      {talkNpc && mode === "world" && <NpcTalk npc={talkNpc} world={currentWorld ?? null} meetings={readMet(getSpaceId())[talkNpc]?.count ?? 1} onClose={() => setTalkNpc(null)} />}
      {inspect && !reading && mode === "world" && (
        <button type="button" className="place-inspect" onClick={() => setReading(inspect)}>
          Look closely: {inspect.title}
        </button>
      )}
      {reading && mode === "world" && (
        <div className="place-card" role="dialog" aria-label={reading.title}>
          <strong>{reading.title}</strong>
          <p>{reading.text}</p>
          {reading.id === "fold.letter" && <FoldChoice />}
          <button type="button" className="mini" onClick={() => setReading(null)}>
            Close
          </button>
        </div>
      )}
      {story.caption && mode === "world" && (
        <p className="story-notice" role="status">
          {story.caption}
        </p>
      )}
      {npcNote && mode === "world" && (
        <p className="npc-note" role="status">
          {npcNote}
          <button type="button" className="mini" onClick={() => setNpcNote(null)} aria-label="Dismiss">
            ✕
          </button>
        </p>
      )}
      {atDeepPast && mode === "world" && !dpArrivalDismissed ? (
        // Deep Past arrival line (§8): the world's whole tutorial, once
        // per visit, in the look-hint slot — dismissed by the first
        // interaction or any Deep Past dock press, then the generic
        // hint logic below resumes.
        <p className="worlds-look-hint" role="status">
          {thread
            ? "Your earliest memories rest below — the deeper, the longer ago. Walk the stair, or ride the thread."
            : "Your earliest memories rest below — the deeper, the longer ago. Walk the stair down."}
        </p>
      ) : (
        lookHint &&
        visible &&
        mode === "world" && (
          <p className="worlds-look-hint" role="status">
            {(!purposeShown && worldPurpose(currentWorld)) ||
              (atGarden
                ? "Tap the ground to walk · drag to look around · pinch to zoom"
                : "Drag to look around · pinch or scroll to zoom · double-tap to reset")}
          </p>
        )
      )}
      <header className="worlds-surface-bar">
        <h3>{title}</h3>
        {/* "← Galaxy" warps HOME through the real journey (free, a 3 s align): Soumaya flies back instead of the galaxy
            popping up. If the journey can't be armed (offline, a journey already running) it falls back to the old instant return,
            so the way out is never lost. */}
        <button type="button" className="worlds-surface-back" onClick={() => void goHome()} aria-label="Back to your galaxy">
          <span aria-hidden="true">←</span> Galaxy
        </button>
      </header>
      {dockGroups.length > 0 && <WorldsDock groups={dockGroups} label={`${title} controls`} />}
      {mode === "world" && atEternity && (
        <p className="worlds-surface-fallback">
          When he speaks, his words appear in the world near his mouth — never over your view.
          {eternityGesture ? ` He is holding ${eternityGesture}.` : ""}
        </p>
      )}
      {mode === "world" && glimmers.length > 0 && (() => {
        // Union (main landing): the program's hunt surface renders the
        // glimmers inside main's §8 containment (ONE container, at most
        // 3 rows, "+N more" overflow), ordered by main's Deep Past
        // closeness rule; "Look closer" routes through
        // onGlimmerLookCloser so a Deep Past find still flies to the
        // basin first and claims on arrival.
        const currentStratum = !atDeepPast
          ? 0
          : dpMode === "perch"
            ? (dpFocusRef.current?.stratum ?? dpPerchStratum)
            : dpMode === "walk"
              ? (dpAtLanding ?? 0)
              : 0;
        const relicStratum = (_r: RelicDef) => (atDeepPast ? 8 : 0);
        const ordered = atDeepPast
          ? [...glimmers].sort((a, b) => Math.abs(relicStratum(a) - currentStratum) - Math.abs(relicStratum(b) - currentStratum))
          : glimmers;
        return (
          <div className="worlds-glimmers" role="group" aria-label="Something glimmers">
            {ordered.slice(0, 3).map((r) => (
              <RelicHuntControls
                key={r.id}
                relicId={r.id}
                relicName={r.name}
                glimmer={r.glimmer}
                settling={settlingRelic === r.id}
                onLookCloser={() => onGlimmerLookCloser(r)}
                scanPosition={RELIC_ANCHOR_POINTS[r.id]?.[0] ? [...RELIC_ANCHOR_POINTS[r.id]![0]!.position] : [0, 0, 0]}
                stirring={(() => { const list = (relicState?.stirrings ?? []).filter((s) => s.relicId === r.id); return list.find((s) => s.state === "open") ?? list[list.length - 1] ?? null; })()}
                notice={claimNotices[r.id] ?? null}
              />
            ))}
            {glimmers.length > 3 && (
              <div className="worlds-glimmer-row">
                +{glimmers.length - 3} more{atDeepPast ? " below" : ""}
              </div>
            )}
          </div>
        );
      })()}
      {mode === "world" && findError && (
        <p className="worlds-surface-fallback" role="alert">{findError}</p>
      )}
      {mode === "world" && atDeepPast && (dpMode === "perch" || (dpMode === "walk" && dpAtLanding !== null)) && (() => {
        // Stratum label (§7.2): the landing names itself, from the layout.
        const n = dpMode === "perch" ? dpPerchStratum : dpAtLanding;
        if (n === null) return null;
        if (n === 9) {
          return <p className="worlds-surface-fallback">The First Light basin — the oldest resting place.</p>;
        }
        const info = deepPastLayout?.strata?.find((s) => s.stratum === n);
        const year =
          info && info.memberCount > 0 && info.earliestYear !== null && info.earliestYear !== undefined
            ? ` — kept since ${info.earliestYear}`
            : "";
        return <p className="worlds-surface-fallback">{`Depth ${n + 1} of 9${year}`}</p>;
      })()}
      {mode === "world" && atDeepPast && dpCardNode !== null && (() => {
        // Member card (F9): the memory, the layout's own why line, and
        // its anchor lines — each naming its other appearance, each
        // followable along the light line.
        const member = deepPastLayout?.members.find((m) => m.nodeId === dpCardNode);
        const node = graph?.nodes.find((nd) => nd.id === dpCardNode);
        if (!member || !node) return null;
        const anchors = deepPastLayout?.anchors.filter((a) => a.fromNodeId === dpCardNode) ?? [];
        return (
          <div className="worlds-dp-card" role="dialog" aria-label={node.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <strong style={{ fontSize: "14px" }}>{node.label}</strong>
              <button type="button" className="mini" onClick={closeDpCard} aria-label="Close">
                ✕
              </button>
            </div>
            <p style={{ margin: "0 0 8px", fontSize: "13px", opacity: 0.9 }}>{member.why}</p>
            {anchors.map((a) => {
              const target = graph?.nodes.find((nd) => nd.id === a.toNodeId);
              return (
                <div key={a.edgeId} style={{ marginTop: "6px" }}>
                  <span style={{ display: "block", fontSize: "13px", marginBottom: "4px" }}>
                    This memory also appears at {target?.label ?? "another place"}.
                  </span>
                  <button
                    type="button"
                    className="mini"
                    onClick={() => {
                      // Follow the light line: perch at its top end point.
                      dpFocusRef.current = {
                        point: [member.homeX * 1.15, 9, member.homeZ * 1.15],
                        stratum: member.stratum,
                      };
                      setDpCardNode(null);
                    }}
                  >
                    Follow the light line
                  </button>
                </div>
              );
            })}
          </div>
        );
      })()}
      {mode === "world" && currentWorld === "growing-place" && !sceneLayout && (
        <p className="worlds-surface-fallback">Your garden is loading — your memories are unaffected.</p>
      )}
      {mode === "world" && currentWorld === "deep-past" && !sceneLayout && (
        <p className="worlds-surface-fallback">Your past is loading — your memories are unaffected.</p>
      )}
      {mode === "world" && currentWorld === "people" && !peopleLayout && (
        <p className="worlds-surface-fallback">Your people are gathering — your memories are unaffected.</p>
      )}
      {mode === "world" && currentWorld === "quiet-archive" && !quietArchiveLayout && !archivedFailed && (
        <p className="worlds-surface-fallback">Your archive is resting — your memories are unaffected.</p>
      )}
      {mode === "world" && atQuietArchive && archivedFailed && (
        <p className="worlds-surface-fallback">
          Your archive couldn&apos;t load — your memories are unaffected.{" "}
          <button type="button" onClick={() => setArchivedRetry((r) => r + 1)}>
            Try again
          </button>
        </p>
      )}
      {mode === "world" && atQuietArchive && quietArchiveLayout && quietArchiveLayout.archivedCount === 0 && (
        <p className="worlds-surface-fallback">
          Nothing rests here yet — when something is archived, it will rest here.
        </p>
      )}
      {mode === "world" && currentWorld === "scale" && !scaleLayout && (
        <p className="worlds-surface-fallback">The station is coming into view — your journeys are unaffected.</p>
      )}
      {mode === "world" && atDeepPast && thread && (
        <p className="worlds-surface-fallback">
          Chronicle route: {thread.title} — {thread.stops.length} stops along the descent.
        </p>
      )}
      {mode === "world" && journeysFailed && (
        <p className="worlds-surface-fallback">
          {atDeepPast
            ? "Chronicle routes couldn\u2019t load — your past is unaffected."
            : "Landmarks couldn\u2019t load — your garden is unaffected."}
        </p>
      )}
      {/* Verb 1 (Tend a plot): Soumaya's arrival suggestions, in-world only.
          Picking one opens the tend sheet; dismissing hides the panel for
          this stay. An ignored suggestion refreshes quietly next visit. */}
      {mode === "world" && atGarden && suggestions && suggestions.length > 0 && !suggestionsHidden && !tendNode && (
        <div
          role="group"
          aria-label="Soumaya suggests"
          style={{
            position: "absolute",
            // Below the header + dock (a constant height), so neither is covered.
            top: "calc(var(--worlds-bar-h) + 0.5rem)",
            left: "var(--hud-rail)",
            width: "min(320px, calc(100vw - 2 * var(--hud-rail)))",
            background: "rgba(10, 16, 12, 0.92)",
            border: "1px solid rgba(255, 210, 122, 0.4)",
            borderRadius: "12px",
            padding: "12px",
            color: "#e8e4d8",
            zIndex: 20,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <strong style={{ fontSize: "14px" }}>🌱 Soumaya suggests</strong>
            <button type="button" className="mini" onClick={() => setSuggestionsHidden(true)} aria-label="Dismiss suggestions">
              ✕
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {suggestions.map((s) => (
              <button
                key={s.nodeId}
                type="button"
                className="mini"
                onClick={() => {
                  const node = graph?.nodes.find((n) => n.id === s.nodeId);
                  if (node) openTendFor(node, true);
                }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px" }}
              >
                <span style={{ display: "block", fontSize: "14px" }}>{s.label}</span>
                <span style={{ display: "block", opacity: 0.75, fontSize: "12px" }}>{s.why}</span>
              </button>
            ))}
          </div>
          <p style={{ margin: "8px 0 0", opacity: 0.7, fontSize: "12px" }}>
            Or tap any plot in the garden.
          </p>
        </div>
      )}
      {/* Garden v2: every grove (and the meadow) one tap away — she walks there. */}
      {mode === "world" && atGarden && grovesOpen && layout && (
        <div className="garden-groves" role="menu" aria-label="Groves">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setGrovesOpen(false);
              walkTo(initialWalk().pos, null, "the meadow");
            }}
          >
            🌾 The meadow <span>{layout.plots.filter((p) => p.role === "wild").length} loose memories</span>
          </button>
          {layout.groves.length === 0 && <p>No Journeys yet — start one and it grows a grove here.</p>}
          {layout.groves.map((g) => (
            <button
              key={g.journeyId}
              type="button"
              role="menuitem"
              onClick={() => {
                setGrovesOpen(false);
                setSuggestionsHidden(true);
                walkTo(approachPoint(walkRef.current.pos, g, g.radius + 14), { kind: "grove", journeyId: g.journeyId }, g.title);
              }}
            >
              {g.icon ?? "🌳"} {g.title}
              <span>{g.status === "paused" ? "resting" : g.status === "done" ? "completed" : `${g.missionsCompleted} done`}</span>
            </button>
          ))}
        </div>
      )}
      {mode === "world" && atGarden && tendNode && graph && (
        <GardenTendSheet
          node={tendNode}
          graph={graph}
          onClose={() => setTendNode(null)}
          onTended={handleTended}
          onCarry={
            // A loose meadow memory can be picked up and carried to a grove.
            layout?.plots.some((p) => p.nodeId === tendNode.id && p.role === "wild")
              ? () => {
                  setCarrying(tendNode.id);
                  setTendNode(null);
                  setGrovesOpen(true);
                }
              : undefined
          }
        />
      )}
      {mode === "world" && atGarden && layout && (layout.pods.length > 0 || harvest > 0) && (() => {
        // Today's harvest: caught pods + those still ripening, at most five.
        const waiting = layout.pods.filter((p) => p.nodeId !== justCaught);
        const total = Math.min(GARDEN_POD_MAX, harvest + waiting.length);
        const caught = Math.min(harvest, total);
        return (
          <button
            type="button"
            className="garden-harvest"
            aria-label={`Seed pods: ${caught} of ${total} caught today${waiting.length > 0 ? " — go to the nearest" : ""}`}
            disabled={waiting.length === 0}
            onClick={() => {
              // Pods ripen wherever their memory rests, often out of view:
              // this walks her to the nearest one still waiting.
              const here = walkRef.current.pos;
              const next = [...waiting].sort(
                (a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z),
              )[0];
              if (!next) return;
              setSuggestionsHidden(true);
              setGrovesOpen(false);
              walkTo(approachPoint(here, next, 22), { kind: "pod", nodeId: next.nodeId }, `“${next.label}”`);
            }}
          >
            <span aria-hidden="true">
              {"🌼".repeat(caught)}
              {"✨".repeat(Math.max(0, total - caught))}
            </span>
            <span>
              {caught} of {total} caught{waiting.length > 0 ? " · find one ›" : ""}
            </span>
          </button>
        );
      })()}
      {mode === "world" && atGarden && recallPod !== null && layout && (() => {
        const pod = layout.pods.find((p) => p.nodeId === recallPod);
        const due = dueReviews?.find((d) => d.id === recallPod);
        if (!pod) return null;
        const grove = pod.journeyId != null ? layout.groves.find((g) => g.journeyId === pod.journeyId) : undefined;
        return (
          <GardenRecallSheet
            key={pod.nodeId}
            memory={{ id: pod.nodeId, label: pod.label, content: due?.content }}
            groveTitle={grove?.title ?? null}
            onCaught={() => {
              const scene = gardenSceneRef.current;
              scene?.celebrate("bloom", { x: pod.x, y: pod.y, z: pod.z });
              const left = layout.pods.filter((p) => p.nodeId !== pod.nodeId).length;
              if (left === 0) scene?.celebrate("harvest");
              setJustCaught(pod.nodeId);
              bumpDay("recalls");
              setGardenResult(`Recalled “${pod.label}”.`);
              const stored = bumpHarvest(getSpaceId());
              setHarvest((h) => Math.max(h + 1, stored));
            }}
            onNotToday={() => {
              setPodsAside((prev) => new Set(prev).add(pod.nodeId));
              setRecallPod(null);
            }}
            onClose={() => {
              // Caught: it's no longer due — the pod is gone from the garden.
              setDueReviews((prev) => prev?.filter((d) => d.id !== pod.nodeId) ?? prev);
              setJustCaught(null);
              setRecallPod(null);
            }}
          />
        );
      })()}
      {mode === "world" && atGarden && layout && (
        <GardenObjective
          objective={gardenObjective({
            carryingLabel: carrying !== null ? (graph?.nodes.find((n) => n.id === carrying)?.label ?? "a memory") : null,
            podsWaiting: layout.pods.filter((p) => p.nodeId !== justCaught).length,
            coldPlots: suggestions?.length ?? 0,
            groves: layout.groves.length,
          })}
          carrying={carrying !== null}
          onDrop={() => {
            setCarrying(null);
            setGrovesOpen(false);
            setGardenResult("Put it back.");
          }}
          walkingTo={walkingTo}
          onStop={stopWalking}
          result={gardenResult}
          guide={guide}
          onDismissGuide={() => bumpGuide({ dismissed: true })}
          day={gardenDay}
        />
      )}
      {mode === "world" && atGarden && groveSheet !== null && layout && graph && (() => {
        const grove = layout.groves.find((g) => g.journeyId === groveSheet);
        if (!grove) return null;
        const inGrove = layout.plots.filter((p) => p.journeyId === grove.journeyId);
        const nodeOf = (id: number) => graph.nodes.find((n) => n.id === id);
        const pick = (role: "mission" | "memory") =>
          inGrove.filter((p) => p.role === role).map((p) => nodeOf(p.nodeId)).filter((n): n is GraphNode => !!n);
        return (
          <GardenGroveSheet
            key={grove.journeyId}
            grove={grove}
            missions={pick("mission")}
            memories={pick("memory")}
            carrying={carrying !== null ? (nodeOf(carrying) ?? null) : null}
            onClose={() => setGroveSheet(null)}
            onChanged={gardenChanged}
            onPlaced={() => {
              const what = carrying !== null ? nodeOf(carrying)?.label : undefined;
              bumpGuide({ carried: true });
              bumpDay("places");
              setGardenResult(`Placed ${what ? `“${what}”` : "the memory"} in ${grove.title} — it shows as a stone there.`);
              setCarrying(null);
            }}
          />
        );
      })()}
      {graphicsFailed && <p className="worlds-surface-fallback">{fallback}</p>}
      {mode === "world" && atStation && showController && (
        <HarborControllerPanel enabled onClose={() => setShowController(false)} />
      )}
      {/* The room's caption and its work share one bottom card (the header
          above wraps to several rows on a phone — a caption pinned to the
          top collided with it, and a tall card covered "Back to your
          galaxy"). The observation deck has no work, just its caption. */}
      {mode === "world" && atStation && inside && (interiorRoomInfo || interiorRoom !== "observation-deck") && (
        <div className="worlds-surface-room">
          {interiorRoomInfo && (
            <p className="worlds-surface-room-caption">
              <strong>{interiorRoomInfo.title}</strong> — {interiorRoomInfo.blurb}
            </p>
          )}
          {interiorRoom !== "observation-deck" && (
            <StationInteriorRoomPanel
              room={interiorRoom}
              graph={graph}
              spaceId={getSpaceId() ?? ""}
              getFleetStatus={getFleetStatus}
              onFocus={onFocus}
              onEquipChanged={() => {
                setBayShipNonce((n) => n + 1);
                onHangarEquipChanged?.();
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
