import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TRAVEL_CANCEL_WINDOW_SECONDS, WORLDS_TRAVEL_ENABLED, relicCodexKey, relicsForWorld } from "@brain/shared";
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
  type DeepPastLayout,
} from "../graph/deepPastLayout.js";
import {
  createDeepPastScene,
  EMPTY_DEEP_PAST_LAYOUT,
  deepPastDescentCamera,
  deepPastDescentStage,
  DEEP_PAST_DESCENT,
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
import { markRelicFound, useFoundRelics } from "./relicsFound.js";
import { createTransitScene } from "../graph/transitScene.js";
import { TRANSIT_MS } from "./TravelPanel.js";
import { renderIcon } from "./icons/Icon.js";
import { getNpcScript } from "../api/npcs.js";
import type { NpcDayScript } from "@brain/shared";
import { GO_HOME_EVENT, HOME_PLACE, announcePlace } from "../lib/worldPlace.js";
import { NPC_PRESENCES, encounterLine, encounterStep, npcsIn, patrolAt, patrolLabel, recordMeeting, type NpcKey, type PatrolPhase } from "../graph/npcPresence.js";
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
 * Guided descent (P3-2, A21, follow-only): at the Deep Past, when a
 * Chronicle thread exists, one button starts the slow descent along the
 * thread (rim → basin, 90 s, capped); the same button leaves it. Leaving
 * parks the view — the orbit continues at the parked depth, and re-entering
 * resumes from there; the route is never lost. Reduced motion turns the
 * descent into stratified stage holds (rim → mid → basin).
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
    orbitRadius: 850,
    orbitHeight: 150,
    lookAtY: -200,
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
  const [guided, setGuided] = useState(false);
  const [showController, setShowController] = useState(false);
  // NPC presence (docs/specs/npcs-alive-2026-10-30.md): the Station controller's patrol, her on-screen tag, and who you have met.
  const npcTagRef = useRef<HTMLButtonElement | null>(null);
  const npcBodyRef = useRef<THREE.Object3D | null>(null);
  const npcWorldPosRef = useRef<V3>([0, 0, 0]);
  const npcNearRef = useRef(false);
  const npcPhaseRef = useRef<PatrolPhase | null>(null);
  const [npcPhase, setNpcPhase] = useState<PatrolPhase | null>(null);
  const metThisVisitRef = useRef<Set<NpcKey>>(new Set());
  // Today's batched NPC lines (one model call per brain per day, cached server-side) — fetched when you enter a world that has NPCs.
  const npcScriptRef = useRef<NpcDayScript | null>(null);
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
  const guidedRef = useRef(false);
  const descentStartedAtRef = useRef(0);
  const descentFromRef = useRef(0);
  const parkedProgressRef = useRef(0);
  const lastProgressRef = useRef(0);
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
  // A new stay is a new visit: encounters can happen again (the 20-minute cooldown still applies), and Eternity — cosmic,
  // not roaming — is "met" a few seconds after you arrive in his world.
  useEffect(() => {
    metThisVisitRef.current = new Set();
    npcNearRef.current = false;
    npcBodyRef.current = null;
    setNpcNote(null);
    // The day's script is one cached read (the first of the day makes the single model call); offline lines if it never arrives.
    let scriptReady: Promise<unknown> = Promise.resolve();
    if (visible && mode === "world" && npcsIn(currentWorld).length > 0) {
      scriptReady = getNpcScript().then((sc) => {
        npcScriptRef.current = sc;
      });
    }
    if (!visible || mode !== "world" || currentWorld !== "eternity") return;
    const e = NPC_PRESENCES.find((n) => n.id === "eternity")!;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      // Give the day's script (its first read of the day is the one model call) a few seconds; the offline line covers a slow one.
      await Promise.race([scriptReady, new Promise((r) => window.setTimeout(r, 6000))]);
      if (cancelled) return;
      metThisVisitRef.current.add(e.id);
      const m = recordMeeting(getSpaceId(), e.id);
      if (m.recorded) pushToast(encounterLine(e, null, m.first, npcScriptRef.current, m.count), "✦", 7000, "normal");
    }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [visible, mode, currentWorld]);
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
    flightRef.current = startFlight(fs, { center: place.center, radius: place.radius });
    flightTargetRef.current = place;
    setFlightTargetId(place.id);
    setFlightCaption(`Aligning to ${place.label}`);
  };
  const backToOverview = () => {
    flightRef.current = null;
    flightTargetRef.current = null;
    chaseCamRef.current = null;
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
  const worldName = (key: string) =>
    WORLD_CHART.find((w) => w.key === key)?.name ?? key;
  const transitTitle = inFlightScene ? `${arming ? "Departing for" : "Travelling to"} ${worldName(journey.destination)}` : "";
  const transitFallback =
    "The journey view needs graphics support on this device — your journey is unaffected.";

  // A new stay — a new world, or a new journey — reopens the view and
  // parks the guided descent back at the rim. (A transit dismissed
  // mid-flight reopens at arrival: the destination scene is a new stay,
  // not the dismissed transit.)
  const journeyId = journey?.id ?? null;
  useEffect(() => {
    setDismissed(false);
    setGraphicsFailed(false);
    setVisibleRelics([]);
    setGuided(false);
    setShowController(false);
    setInside(false);
    setInteriorRoom("hangar-bay");
    interiorRoomRef.current = "hangar-bay";
    guidedRef.current = false;
    parkedProgressRef.current = 0;
    lastProgressRef.current = 0;
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
    return buildDeepPastLayout(graph, journeys ?? [], journeyLinksMap ?? new Map());
  }, [atDeepPast, graph, journeys, journeyLinksMap]);

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

  const onFindRelic = (relic: RelicDef) => {
    if (!spaceId) return;
    markRelicFound(spaceId, relicCodexKey(relic.id));
    pushToast(`You found ${relic.name} — it's in your Codex now.`, "🏺", 6000, "high");
  };

  const toggleGuided = () => {
    if (guidedRef.current) {
      // Leaving the descent parks the view at the last progress.
      parkedProgressRef.current = lastProgressRef.current;
      guidedRef.current = false;
      setGuided(false);
    } else {
      descentFromRef.current = parkedProgressRef.current;
      descentStartedAtRef.current = performance.now();
      guidedRef.current = true;
      setGuided(true);
    }
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
    // Her hull is shown only once it is ready (never a placeholder), so warm it before anything needs it.
    void loadSoumayaShip();
    void loadWarpGate(); // null (and the generated ring stays) until public/warp-gate.glb exists
    // One universe: every world and the warp draw the same home sky. The garden keeps its own backdrop and
    // Eternity is a white void by design.
    const sky =
      mode === "transit" || (currentWorld !== "growing-place" && currentWorld !== "eternity")
        ? installHomeSky(renderer, scene)
        : null;
    if (sky) scene.add(sky.group);
    // Shared lighting for this world (the corridor only takes the environment map — it lights itself otherwise).
    const lighting =
      mode === "transit"
        ? applyWorldLighting(scene, renderer, TRANSIT_LIGHT_RIG)
        : mode === "world" && entry?.light
          ? applyWorldLighting(scene, renderer, entry.light)
          : null;
    sceneHandleRef.current = world;
    // The traveller's ship inside a world that has places to fly to (hidden until the first flight).
    const avatar: ShipAvatar | null = mode === "world" && currentWorld && PLACE_RULES[currentWorld] && !inside ? createShipAvatar(trailRef.current) : null;
    if (avatar) {
      avatar.group.visible = false;
      scene.add(avatar.group);
    }
    // Her exhaust trail in world space — flying her ship through a world leaves the same trail she leaves at home (graph/enginePlume.ts).
    const plume = avatar || currentWorld === "growing-place" ? createEnginePlume(trailRef.current, { scale: currentWorld === "growing-place" ? 1.8 : 1 }) : null;
    if (plume) scene.add(plume.group);
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
    const markLooked = () => lookedRef.current();
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
        if (now - lastTapAt < 320) lookRef.current = NO_LOOK;
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
    };
    host.addEventListener("pointerdown", onLookDown);
    host.addEventListener("pointermove", onLookMove);
    host.addEventListener("pointerup", onLookUp);
    host.addEventListener("pointercancel", onLookUp);
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("dblclick", onDouble);

    let raf = 0;
    const startedAt = performance.now();
    let lastFrameAt = startedAt;
    let lastPlacesAt = 0;
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
      // The Station's harbor controller lives here: a patrol on a wall-clock cycle, a tag that follows her, and an encounter when
      // your ship or camera comes near (graph/npcPresence.ts). Presentation only — no act, no speech.
      if (mode === "world" && currentWorld === "great-station" && !inside) {
        const hc = NPC_PRESENCES[0]!;
        let body = npcBodyRef.current;
        if (!body || !body.parent) {
          body = world.group.getObjectByName(hc.objectName ?? "") ?? null;
          npcBodyRef.current = body;
        }
        if (body) {
          const pose = patrolAt(Date.now(), HARBOR_CONTROLLER_BERTH, { reducedMotion });
          body.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
          body.rotation.y = pose.rotationY;
          if (npcPhaseRef.current !== pose.phase) {
            npcPhaseRef.current = pose.phase;
            setNpcPhase(pose.phase);
          }
          body.updateWorldMatrix(true, false);
          const wp = new THREE.Vector3().setFromMatrixPosition(body.matrixWorld);
          npcWorldPosRef.current = [wp.x, wp.y, wp.z];
          // Nearest of the camera and (while flying) the ship.
          const fl = flightRef.current;
          const d = Math.min(
            camera.position.distanceTo(wp),
            fl ? Math.hypot(fl.pos[0] - wp.x, fl.pos[1] - wp.y, fl.pos[2] - wp.z) : Infinity,
          );
          const enc = encounterStep(npcNearRef.current, d);
          npcNearRef.current = enc.near;
          if (enc.entered && !metThisVisitRef.current.has(hc.id)) {
            metThisVisitRef.current.add(hc.id);
            const m = recordMeeting(getSpaceId(), hc.id);
            if (m.recorded) pushToast(encounterLine(hc, pose.phase, m.first, npcScriptRef.current, m.count), "🛰️", 7000, "normal");
          }
          // The tag rides her on screen (a ref write, no re-render).
          const tag = npcTagRef.current;
          if (tag) {
            const sp = wp.clone().project(camera);
            const onScreen = sp.z < 1 && Math.abs(sp.x) < 0.92 && sp.y > -0.8 && sp.y < 0.85;
            tag.style.display = onScreen ? "" : "none";
            if (onScreen) {
              const host = hostRef.current;
              const w = host?.clientWidth ?? 0;
              const h = host?.clientHeight ?? 0;
              // Centred above her, but never half off the screen edge.
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
          flightRef.current = r.state;
          const fs = r.state;
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
          // Guided descent (A21, follow-only): the camera follows the thread
          // down; leaving parks the view at the last progress, and re-entering
          // resumes from there. Reduced motion = stratified stage holds.
          let progress = parkedProgressRef.current;
          if (guidedRef.current) {
            const sinceStart = performance.now() - descentStartedAtRef.current;
            progress = reducedMotion
              ? deepPastDescentStage(sinceStart)
              : Math.min(1, descentFromRef.current + sinceStart / DEEP_PAST_DESCENT.durationMs);
            lastProgressRef.current = progress;
          }
          const pose = deepPastDescentCamera(progress);
          pivotY = pose.lookAt[1];
          if (guidedRef.current) {
            scripted = true; // following the thread down
            camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
            camera.lookAt(pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]);
          } else {
            // Parked orbit: the same slow orbit, at the parked depth.
            const angle = reducedMotion ? BASE_ANGLE : BASE_ANGLE + elapsed * 0.0000045;
            camera.position.set(
              Math.sin(angle) * orbit.orbitRadius * fit,
              pose.position[1],
              Math.cos(angle) * orbit.orbitRadius * fit,
            );
            camera.lookAt(0, pose.lookAt[1], 0);
          }
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
      window.removeEventListener("resize", onResize);
      host.removeEventListener("pointerdown", skipArrival);
      host.removeEventListener("pointerdown", onLookDown);
      host.removeEventListener("pointermove", onLookMove);
      host.removeEventListener("pointerup", onLookUp);
      host.removeEventListener("pointercancel", onLookUp);
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("dblclick", onDouble);
      lookAllowedRef.current = false;
      gardenSceneRef.current = null;
      engine?.dispose();
      lighting?.dispose();
      sky?.dispose();
      avatar?.dispose();
      plume?.dispose();
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
    if (atDeepPast && thread) {
      dockGroups.push({
        id: "deep-past",
        tiles: [
          guided
            ? { id: "rim", icon: "i:rise", label: "Rim", name: "Back to the rim", onClick: toggleGuided }
            : { id: "descend", icon: "i:descend", label: "Descend", name: "Descend the Chronicle", onClick: toggleGuided },
        ],
      });
    }
    // Who's here: the NPCs that live in this world, findable in one tap (docs/specs/npcs-alive-2026-10-30.md).
    const whoIsHere = npcsIn(currentWorld);
    if (mode === "world" && !inside && whoIsHere.length > 0) {
      dockGroups.push({
        id: "npcs",
        label: "Who's here",
        tiles: whoIsHere.map((n) => {
          const isController = n.id === "harbor-controller";
          return {
            id: `npc-${n.id}`,
            icon: n.icon,
            label: isController ? "Controller" : n.name,
            name: isController ? `Fly to the Harbor controller, ${patrolLabel(npcPhase ?? "docked")}` : `${n.name}: ${n.role}`,
            onClick: () => {
              if (isController && npcBodyRef.current) {
                flyTo({ id: "npc-harbor-controller", label: "Harbor controller", icon: n.icon, center: npcWorldPosRef.current, radius: 14 });
              } else {
                setNpcNote(`${n.name} is here — ${n.role}.`);
              }
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
  }

  return (
    <section className={`worlds-surface${atEternity && mode === "world" ? " worlds-surface-light" : ""}${dockGroups.length > 0 ? " worlds-surface-docked" : ""}`} role="dialog" aria-label={title}>
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
      {mode === "world" && atStation && !inside && !showController && npcBodyRef.current && (
        <button
          type="button"
          ref={npcTagRef}
          className="npc-tag"
          aria-label={`Harbor controller, ${patrolLabel(npcPhase ?? "docked")} — tap to talk`}
          onClick={() => setShowController(true)}
        >
          <span aria-hidden="true">{renderIcon("i:harbor", 16)}</span>
          <span>
            <strong>Harbor controller</strong>
            <em>{patrolLabel(npcPhase ?? "docked")}</em>
          </span>
        </button>
      )}
      {npcNote && mode === "world" && (
        <p className="npc-note" role="status">
          {npcNote}
          <button type="button" className="mini" onClick={() => setNpcNote(null)} aria-label="Dismiss">
            ✕
          </button>
        </p>
      )}
      {lookHint && visible && mode === "world" && (
        <p className="worlds-look-hint" role="status">
          {(!purposeShown && worldPurpose(currentWorld)) ||
            (atGarden
              ? "Tap the ground to walk · drag to look around · pinch to zoom"
              : "Drag to look around · pinch or scroll to zoom · double-tap to reset")}
        </p>
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
      {mode === "world" &&
        glimmers.map((r) => (
          <p key={r.id} className="worlds-surface-fallback">
            Something glimmers {r.glimmer}.{" "}
            <button type="button" onClick={() => onFindRelic(r)}>
              Look closer
            </button>
          </p>
        ))}
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
