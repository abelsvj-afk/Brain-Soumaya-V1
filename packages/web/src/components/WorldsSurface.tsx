import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import { useTravel } from "../hooks/useTravel.js";
import { getJourneys, journeyLinks } from "../api/journeys.js";
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
import { createStationScene } from "../graph/stationScene.js";
import {
  STATION_ARRIVAL_MS,
  STATION_ORBIT_HEIGHT,
  STATION_ORBIT_RADIUS,
  STATION_PALETTE,
  approachPose,
} from "../graph/stationLayout.js";
import { ensureKtx2Support } from "../graph/gltf.js";
import { buildGardenLayout, clampToGardenFloor, GARDEN_CAMERA_FLOOR_Y, landmarkPositionFor, type GardenLayout } from "../graph/gardenLayout.js";
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
}) {
  const travel = useTravel(enabled);
  const [dismissed, setDismissed] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [graphicsFailed, setGraphicsFailed] = useState(false);
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [journeysFailed, setJourneysFailed] = useState(false);
  const [journeyLinksMap, setJourneyLinksMap] = useState<Map<number, JourneyLinkSummary[]> | null>(null);
  const [archivedGraph, setArchivedGraph] = useState<GraphData | null>(null);
  const [archivedFailed, setArchivedFailed] = useState(false);
  const [archivedRetry, setArchivedRetry] = useState(0);
  const [guided, setGuided] = useState(false);
  const [showController, setShowController] = useState(false);
  const guidedRef = useRef(false);
  const descentStartedAtRef = useRef(0);
  const descentFromRef = useRef(0);
  const parkedProgressRef = useRef(0);
  const lastProgressRef = useRef(0);
  // Station arrival glide (A13): any pointer press skips it. Reset per stay.
  const arrivalSkippedRef = useRef(false);
  const hostRef = useRef<HTMLDivElement | null>(null);
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
  const visible = !!mode && !dismissed;
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
  }, [atGarden, atDeepPast]);

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

  // Chronicle routes: a done Journey's linked memories, fetched per Journey
  // on Deep Past entry. A single Journey's links failing omits only that
  // Journey's route — the world still renders, honestly, without it.
  useEffect(() => {
    if (!atDeepPast || !journeys) return;
    let cancelled = false;
    const done = journeys.filter((j) => j.status === "done");
    void Promise.all(
      done.map(async (j): Promise<[number, JourneyLinkSummary[]]> => {
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
  }, [atDeepPast, journeys]);

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
    return buildGardenLayout(graph, journeys ?? []);
  }, [atGarden, graph, journeys]);

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
    const nodeId = scene.pickPlot(ndc, camera);
    if (nodeId === null) return;
    const node = graph.nodes.find((n) => n.id === nodeId);
    if (node) setTendNode(node);
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

    let raf = 0;
    const startedAt = performance.now();
    const BASE_ANGLE = 0.6;
    const frame = () => {
      const elapsed = performance.now() - startedAt;
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
        if (currentWorld === "deep-past") {
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
          if (guidedRef.current) {
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
        } else if (currentWorld === "great-station" && !reducedMotion && !arrivalSkippedRef.current) {
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
        } else {
          const angle = reducedMotion ? BASE_ANGLE : BASE_ANGLE + elapsed * 0.0000045;
          camera.position.set(
            Math.sin(angle) * orbit.orbitRadius,
            orbit.orbitHeight,
            Math.cos(angle) * orbit.orbitRadius,
          );
          camera.lookAt(0, orbit.lookAtY, 0);
        }
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
      gardenSceneRef.current = null;
      engine?.dispose();
      world.dispose();
      sceneHandleRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
      gardenSceneRef.current = null;
      gardenCameraRef.current = null;
    };
  }, [visible, mode, entry, currentWorld, sceneLayout, gardenGlow, transitKind, transitTotalMs, journey?.origin, journey?.destination]);

  if (!visible || !mode) return null;
  const title = mode === "transit" ? transitTitle : (entry?.title ?? "");
  const fallback = mode === "transit" ? transitFallback : (entry?.fallback ?? "");
  const thread = atDeepPast ? deepPastLayout?.thread ?? null : null;

  return (
    <section className={`worlds-surface${atEternity && mode === "world" ? " worlds-surface-light" : ""}`} role="dialog" aria-label={title}>
      <div className="worlds-surface-canvas" ref={hostRef} onClick={handleCanvasClick} />
      <header className="worlds-surface-bar">
        <h3>{title}</h3>
        {atStation && (
          <button type="button" onClick={() => setShowController((v) => !v)}>
            {showController ? "Hide the harbor controller" : "Harbor controller"}
          </button>
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
            top: "56px",
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
      {mode === "world" && atGarden && tendNode && graph && (
        <GardenTendSheet node={tendNode} graph={graph} onClose={() => setTendNode(null)} onTended={handleTended} />
      )}
      {graphicsFailed && <p className="worlds-surface-fallback">{fallback}</p>}
      {mode === "world" && atStation && showController && (
        <HarborControllerPanel enabled onClose={() => setShowController(false)} />
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
