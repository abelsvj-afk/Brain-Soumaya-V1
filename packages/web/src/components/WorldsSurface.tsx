import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import { useTravel } from "../hooks/useTravel.js";
import { getJourneys, journeyLinks } from "../api/journeys.js";
import { getDueReviews, type DueReview } from "../api/features.js";
import { getArchivedNodesStrict, getIncidentEdges, getSpaceId } from "../api/client.js";
import type { GraphData, GraphEdge, GraphNode, Journey, JourneyLinkSummary } from "@brain/shared";
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
import WorldCredits from "./WorldCredits.js";
import HarborControllerPanel from "./HarborControllerPanel.js";
import { createTransitScene } from "../graph/transitScene.js";
import { TRANSIT_MS } from "./TravelPanel.js";
import { ENTER_WORLD_EVENT, TRAVEL_CHANGED_EVENT, type TravelChangedDetail } from "../lib/travelEvents.js";
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
import { NO_LOOK, applyLook, dragLook, isLooked, pinchDistance, zoomLook, type LookState } from "../graph/worldLook.js";
import { makeEngineAudio } from "../graph/engineAudio.js";
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
     * whose real GLB has actually loaded. WorldsSurface passes nothing on
     * this tip — the relics store does not exist here yet — but the
     * wiring point is the relics increment's rebase, not a second edit.
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
    background: STATION_PALETTE.indigo,
    fogDensity: 0.00016,
    orbitRadius: STATION_ORBIT_RADIUS,
    orbitHeight: STATION_ORBIT_HEIGHT,
    lookAtY: 0,
    fallback: "The Station view needs graphics support on this device — your journeys are unaffected.",
    build: () => createStationScene(),
  },
  "growing-place": {
    title: "The Growing Place",
    background: 0x0a2420,
    fogDensity: 0.00016,
    orbitRadius: 1150,
    orbitHeight: 300,
    lookAtY: 60,
    cameraFloorY: GARDEN_CAMERA_FLOOR_Y,
    fallback: "The garden view needs graphics support on this device — your memories are unaffected.",
    build: (layout) => createGardenScene(isGardenLayout(layout) ? layout : EMPTY_GARDEN_LAYOUT),
  },
  "deep-past": {
    title: "The Deep Past",
    background: 0x140d24,
    fogDensity: 0.00016,
    orbitRadius: 850,
    orbitHeight: 150,
    lookAtY: -200,
    fallback: "The Deep Past view needs graphics support on this device — your memories are unaffected.",
    build: (layout) =>
      createDeepPastScene(isDeepPastLayout(layout) ? layout : EMPTY_DEEP_PAST_LAYOUT),
  },
  people: {
    title: "The People",
    background: 0x1a120c,
    fogDensity: 0.00016,
    orbitRadius: 700,
    orbitHeight: 140,
    lookAtY: 0,
    fallback: "The People view needs graphics support on this device — your people are unaffected.",
    build: (layout) =>
      createPeopleScene(isPeopleLayout(layout) ? layout : EMPTY_PEOPLE_LAYOUT),
  },
  "quiet-archive": {
    title: "Quiet/Archive",
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

export default function WorldsSurface({
  enabled = WORLDS_TRAVEL_ENABLED,
  graph = null,
  onChanged,
  getFleetStatus,
  onFocus,
  onHangarEquipChanged,
  onGardenChanged,
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
  const [showCredits, setShowCredits] = useState(false);
  const [graphicsFailed, setGraphicsFailed] = useState(false);
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [journeysFailed, setJourneysFailed] = useState(false);
  const [dueReviews, setDueReviews] = useState<DueReview[] | null>(null);
  const [journeyLinksMap, setJourneyLinksMap] = useState<Map<number, JourneyLinkSummary[]> | null>(null);
  const [archivedGraph, setArchivedGraph] = useState<GraphData | null>(null);
  const [archivedFailed, setArchivedFailed] = useState(false);
  const [archivedRetry, setArchivedRetry] = useState(0);
  const [guided, setGuided] = useState(false);
  const [showController, setShowController] = useState(false);
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
  // Garden v2 step 4 (Seed Pods): the pod being recalled, pods set aside
  // ("Not today") or caught this stay, and today's harvest count.
  const [recallPod, setRecallPod] = useState<number | null>(null);
  const [podsAside, setPodsAside] = useState<Set<number>>(new Set());
  const [harvest, setHarvest] = useState(0);
  const carryingRef = useRef<number | null>(null);
  carryingRef.current = carrying;
  // The mounted scene handle — the Eternity gesture/tool buttons below
  // call into it. Set in the mount effect, cleared in its cleanup.
  const sceneHandleRef = useRef<WorldSceneHandle | null>(null);
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

  const currentWorld = travel.state?.currentWorld;
  const journey = travel.state?.activeJourney ?? null;
  const atWorld =
    enabled && !!currentWorld && currentWorld in WORLD_SCENES && !journey;
  const inTransit =
    enabled &&
    !!journey &&
    (journey.state === "in_transit" || journey.state === "returning");
  const transitKind = inTransit ? journey.kind : null;
  const transitTotalMs = transitKind ? TRANSIT_MS[transitKind] : 0;
  const mode = inTransit ? "transit" : atWorld ? "world" : null;
  const visible = !!mode && !dismissed && engaged;

  // First time in a world: say that it can be moved. Shown once per browser, gone on the first
  // gesture or after a few seconds — a world that silently ignored touch was the complaint.
  useEffect(() => {
    // Start when the world is actually ON SCREEN — not when the app loads at a saved world, whose
    // layer stays hidden until the traveller acts (the timer would run out before they ever got there).
    if (!enabled || !visible || mode !== "world") return;
    let seen = false;
    try {
      seen = localStorage.getItem("worlds.lookHintSeen") === "1";
    } catch {
      /* storage unavailable — show it; it just won't be remembered */
    }
    if (seen) return;
    setLookHint(true);
    const done = () => {
      setLookHint(false);
      try {
        localStorage.setItem("worlds.lookHintSeen", "1");
      } catch {
        /* ignore */
      }
    };
    lookedRef.current = done;
    const t = window.setTimeout(done, 9000);
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
  const transitTitle = inTransit ? `Travelling to ${worldName(journey.destination)}` : "";
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
        if (!cancelled) setRecentTends(tends);
      })
      .catch(() => {
        if (!cancelled) setRecentTends([]);
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

  const sceneLayout =
    currentWorld === "growing-place"
      ? layout
      : currentWorld === "deep-past"
        ? deepPastLayout
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
    if (grove) walkTo(approachPoint(walkRef.current.pos, grove, grove.radius * 0.6), { kind: "grove", journeyId: grove.journeyId });
    else if (pick.kind === "ground") walkTo({ x: pick.x, z: pick.z }, null);
    else walkTo(approachPoint(walkRef.current.pos, pick, pick.kind === "pod" ? 22 : 28), { kind: pick.kind, nodeId: pick.nodeId });
  };

  // Send her ship somewhere; `arrival` is what opens when she gets there.
  const walkTo = (target: WalkPoint, arrival: GardenArrival | null) => {
    const w = walkRef.current;
    walkRef.current = { ...w, route: walkRoute(w.pos, target) };
    arrivalRef.current = arrival;
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
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
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
        built = entry.build(sceneLayout);
      }
    }
    const world =
      mode === "transit"
        ? createTransitScene({
            kind: transitKind ?? "warp",
            totalMs: transitTotalMs,
            origin: journey?.origin ?? "home",
            destination: journey?.destination ?? "home",
          })
        : built;
    if (!world) return;
    scene.add(world.group);
    sceneHandleRef.current = world;
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
      world.update(elapsed, { reducedMotion });
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
        camera.position.set(0, 8, 26);
        camera.lookAt(0, 0, -60);
        engine?.setLevel(1, transitKind === "warp" ? 1 : 0.35);
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
              Math.sin(angle) * orbit.orbitRadius,
              pose.position[1],
              Math.cos(angle) * orbit.orbitRadius,
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
            const radius = arrival.distance + (orbit.orbitRadius - arrival.distance) * s;
            const height = arrivalHeight + (orbit.orbitHeight - arrivalHeight) * s;
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
            Math.sin(angle) * orbit.orbitRadius,
            orbit.orbitHeight,
            Math.cos(angle) * orbit.orbitRadius,
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
      try {
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
      world.dispose();
      sceneHandleRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
      gardenSceneRef.current = null;
      gardenCameraRef.current = null;
    };
  }, [visible, mode, entry, currentWorld, sceneLayout, gardenGlow, transitKind, transitTotalMs, journey?.origin, journey?.destination, inside, interiorLayout, interiorShipSkin]);

  if (!visible || !mode) return null;
  const title = mode === "transit" ? transitTitle : (entry?.title ?? "");
  const fallback = mode === "transit" ? transitFallback : (entry?.fallback ?? "");
  const thread = atDeepPast ? deepPastLayout?.thread ?? null : null;
  const interiorRoomInfo =
    atStation && inside
      ? (interiorLayout?.spaces.find((s) => s.id === interiorRoom) ?? null)
      : null;

  return (
    <section className={`worlds-surface${atEternity && mode === "world" ? " worlds-surface-light" : ""}`} role="dialog" aria-label={title}>
      <div className="worlds-surface-canvas" ref={hostRef} onClick={handleCanvasClick} />
      {lookHint && visible && mode === "world" && (
        <p className="worlds-look-hint" role="status">
          {atGarden
            ? "Tap the ground to walk · drag to look around · pinch to zoom"
            : "Drag to look around · pinch or scroll to zoom · double-tap to reset"}
        </p>
      )}
      <header className="worlds-surface-bar">
        <h3>{title}</h3>
        {atGarden && mode === "world" && (
          <button type="button" aria-expanded={grovesOpen} onClick={() => setGrovesOpen((v) => !v)}>
            🌳 Groves {grovesOpen ? "▴" : "▾"}
          </button>
        )}
        {atStation && (
          <button type="button" onClick={() => setShowController((v) => !v)}>
            {showController ? "Hide the harbor controller" : "Harbor controller"}
          </button>
        )}
        {atStation && !inside && (
          <button type="button" onClick={() => setInside(true)}>
            Step inside the Station
          </button>
        )}
        {atStation && inside && (
          <>
            <button type="button" onClick={() => setInside(false)}>
              Step back outside
            </button>
            {interiorLayout?.spaces
              .filter((s) => s.id !== interiorRoom)
              .map((s) => (
                <button key={s.id} type="button" onClick={() => goToInteriorRoom(s.id)}>
                  Go to the {s.title.replace(/^The /, "")}
                </button>
              ))}
          </>
        )}
        {atDeepPast && thread && (
          <button type="button" onClick={toggleGuided}>
            {guided ? "Back to the rim" : "Descend the Chronicle"}
          </button>
        )}
        {atEternity && (
          <>
            <span className="worlds-surface-eternity-label">His gestures</span>
            {ETERNITY_GESTURE_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  // The label names what he holds only when the scene
                  // actually mounted — a fallback world holds nothing.
                  const e = sceneHandleRef.current?.eternity;
                  if (!e) return;
                  e.setGesture(name);
                  setEternityGesture(name);
                }}
              >
                {name[0]!.toUpperCase() + name.slice(1)}
              </button>
            ))}
            <span className="worlds-surface-eternity-label">His tools</span>
            {ETERNITY_TOOL_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => sceneHandleRef.current?.eternity?.useTool(name)}
              >
                {name === "reorder"
                  ? "Reorder the heavens"
                  : name === "part-veil"
                    ? "Part the veil"
                    : name === "shield"
                      ? "Raise the shield"
                      : "Send a comet"}
              </button>
            ))}
          </>
        )}
        <button type="button" onClick={() => setDismissed(true)}>
          Back to your galaxy
        </button>
      </header>
      {mode === "world" && atEternity && (
        <p className="worlds-surface-fallback">
          When he speaks, his words appear in the world near his mouth — never over your view.
          {eternityGesture ? ` He is holding ${eternityGesture}.` : ""}
        </p>
      )}
      {mode === "world" && currentWorld === "growing-place" && !layout && (
        <p className="worlds-surface-fallback">Your garden is loading — your memories are unaffected.</p>
      )}
      {mode === "world" && currentWorld === "deep-past" && !deepPastLayout && (
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
            // Below the header's second row (it wraps on a phone), so
            // "Back to your galaxy" is never covered.
            top: "6.5rem",
            left: "12px",
            width: "min(320px, 82vw)",
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
              walkTo(initialWalk().pos, null);
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
                walkTo(approachPoint(walkRef.current.pos, g, g.radius + 14), { kind: "grove", journeyId: g.journeyId });
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
        const total = Math.min(GARDEN_POD_MAX, harvest + layout.pods.length);
        const caught = Math.min(harvest, total);
        return (
          <button
            type="button"
            className="garden-harvest"
            aria-label={`Seed pods: ${caught} of ${total} caught today${layout.pods.length > 0 ? " — go to the nearest" : ""}`}
            disabled={layout.pods.length === 0}
            onClick={() => {
              // Pods ripen wherever their memory rests, often out of view:
              // this walks her to the nearest one still waiting.
              const here = walkRef.current.pos;
              const next = [...layout.pods].sort(
                (a, b) => Math.hypot(a.x - here.x, a.z - here.z) - Math.hypot(b.x - here.x, b.z - here.z),
              )[0];
              if (!next) return;
              setSuggestionsHidden(true);
              setGrovesOpen(false);
              walkTo(approachPoint(here, next, 22), { kind: "pod", nodeId: next.nodeId });
            }}
          >
            <span aria-hidden="true">
              {"🌼".repeat(caught)}
              {"✨".repeat(Math.max(0, total - caught))}
            </span>
            <span>
              {caught} of {total} caught{layout.pods.length > 0 ? " · find one ›" : ""}
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
              setRecallPod(null);
            }}
          />
        );
      })()}
      {mode === "world" && atGarden && carrying !== null && groveSheet === null && (
        <div className="garden-carrying" role="status">
          🧺 Carrying “{graph?.nodes.find((n) => n.id === carrying)?.label ?? "a memory"}” — walk to a grove to place it
          <button type="button" className="mini" onClick={() => setCarrying(null)} aria-label="Put it down">
            ✕
          </button>
        </div>
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
            onPlaced={() => setCarrying(null)}
          />
        );
      })()}
      {graphicsFailed && <p className="worlds-surface-fallback">{fallback}</p>}
      {mode === "world" && atStation && showController && (
        <HarborControllerPanel enabled onClose={() => setShowController(false)} />
      )}
      {mode === "world" && atStation && inside && interiorRoomInfo && (
        <p className="worlds-surface-fallback">
          {interiorRoomInfo.title} — {interiorRoomInfo.blurb}
        </p>
      )}
      {mode === "world" && atStation && inside && interiorRoom !== "observation-deck" && (
        <div className="worlds-surface-room">
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
        </div>
      )}
      <footer className="worlds-surface-credits">
        <button type="button" onClick={() => setShowCredits((v) => !v)}>
          {showCredits ? "Hide credits" : "Credits"}
        </button>
        {showCredits && <WorldCredits />}
      </footer>
    </section>
  );
}
