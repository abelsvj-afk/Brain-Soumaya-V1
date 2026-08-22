import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { logDiagnosticEvent } from "../diagnostics/buffer";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
// Pure helpers (link LOD, figurine building, GPU disposal) live in graph3dHelpers.ts
// (Post-MVP D4 split); behaviour unchanged.
import { LINK_LOD_MIN, LINK_LOD_ZOOM, LINK_LOD_CUTOFF, linkEnd, linkKey, updateFigurine, disposeObject3D } from "./graph3dHelpers.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { GraphData, GraphNode } from "@brain/shared";
import { makeNodeObject } from "./nodeObject.js";
import { makeStarfield, makeNebulae, makeComets, makeGalaxies, makeMilkyWay } from "./starfield.js";
import { makeConstellations, loadNebulaSkybox, loadEquirectSkybox } from "./skybox.js";
import { makeDeepSpace, DEEP_SPACE_BASE } from "./deepSpace.js";
import { makeMoneySky, MONEY_SKY_BASE } from "./moneySky.js";
import { getMoneySky } from "../api/finance.js";
import { makeJourneyHubs, JOURNEY_HUBS_BASE } from "./journeyHubs.js";
import { getJourneys } from "../api/journeys.js";
import { addBloom } from "./bloom.js";
import { resolveGraphics, type ResolvedGraphics } from "./graphicsConfig.js";
import { makeCollisionBursts, makeLinkForming } from "./effects.js";
import { shouldCalmMotion } from "./motion.js";
import { makeSoumaya, type SoumayaHandle, type LinkTask, type RemovalTask } from "./soumaya.js";
import { makeEngineAudio } from "./engineAudio.js";
import { makeSpaceStation } from "./spaceStation.js";
import { gltfLoader } from "./gltf.js";
import { makeSun, SUN_RADIUS_MAX } from "./sun.js";
import { makeOrbitSystem } from "./orbits.js";
import { makeVisitors, type VisitorSystem } from "./visitors.js";
import { isNodeProcessing, logVisits } from "../api/client.js";
import { makeSatellites, type SatelliteSystem } from "./satellites.js";
import { makeSubAgents, type SubAgentSystem, type SubAgentHazard } from "./subAgents.js";
import { BG, colorForType, EMOTION_RGB, emotionKind } from "./theme.js";

/** Live status of each fleet unit, read by the Fleet panel. */
export type FleetStatus = Record<
  string,
  { active: boolean; detail: string; targets?: { id: number; label: string }[]; pending?: number }
>;

export interface Graph3DHandle {
  focusNode: (id: number) => void;
  /** Frame the whole galaxy back in view (fixes drift / "stuck on one side"). */
  recenter: () => void;
  /** On-screen zoom: factor < 1 zooms in, > 1 zooms out (for the +/- buttons). */
  zoomBy: (factor: number) => void;
  /** Toggle the camera focusing Soumaya's ship; returns the new state. */
  toggleFollowShip: (forceState?: boolean) => boolean;
  /** Re-level the camera on the ship: a wide, right-side-up external view (undoes the
   *  upside-down/sideways drift that banking + free orbit can leave you in). */
  levelShipView: () => void;
  /** Toggle the camera focusing the space station; returns the new state. */
  toggleFollowStation: () => boolean;
  /** Toggle camera focusing slot 1 figurine; returns the new state. */
  toggleFollowFig1: () => boolean;
  /** Toggle camera focusing slot 2 figurine; returns the new state. */
  toggleFollowFig2: () => boolean;
  /** Jump to the next active Aura beacon (cycles through them). False if none. */
  cycleFollowSatellite: () => boolean;
  /** Jump to the next visitor craft (cycles through them). False if none. */
  cycleFollowVisitor: () => boolean;
  /** Jump to the next fleet craft — Escort first, then scout/defender/tenders. False if none. */
  cycleFollowFleet: () => boolean;
  /** Isolate a memory's system: show only it + the bodies orbiting it. */
  isolateSystem: (id: number) => void;
  /** Exit the isolated system view (show the whole galaxy again). */
  exitCluster: () => void;
  /** Isolate an arbitrary SET of memories (a Smart Lens) and frame them. */
  isolateSet: (ids: number[]) => void;
  /** View ONLY an overlay layer (the money-sky or journey hubs): hide memories + the other
   *  overlay, frame this one. Their own "category view" for the perf pivot. */
  isolateLayer: (layer: "money" | "journeys") => void;
  /** Trigger a visual burst at a node (e.g., for user action rewards). */
  spawnBurst: (nodeId: number, type?: string) => void;
  /** A celebratory burst salvo around the Sun (rank-ups, milestones). */
  celebrate: () => void;
  /** Fire visual recall signals along synapses for cited node IDs. */
  fireRecall: (citationIds: number[]) => void;
  /** Soumaya flies into view and shows a short message (autonomous hail). */
  hailSoumaya: (message: string) => void;
  /** Night Replay: she re-enacts overnight agent-log events (visual only). */
  replayEvents: (items: { id: number; label: string }[]) => void;
  /** Live status of every fleet unit (ship/station/beacons/scout/defender). */
  getFleetStatus: () => FleetStatus;
  reorderTasks: (newOrder: { id: string; type: string }[]) => void;
}

interface Props {
  data: GraphData;
  onSelect: (node: GraphNode) => void;
  onSoumayaClick?: () => void;
  /** Fires when the number of active beacons changes (drives the pulsing FAB). */
  onSatelliteCount?: (count: number) => void;
  /** Fires when the number of visitors in the sandbox changes (drives the FAB). */
  onVisitorCount?: (count: number) => void;
  /** Currently-selected node — when set, only it + its links stay lit (tap-to-isolate). */
  selectedId?: number | null;
  /** True when the bottom sheet is open — shifts the followed body up so it clears it. */
  bottomInset?: boolean;
  /** Show the floating "current task" label above Soumaya's ship. */
  showShipTask?: boolean;
  /** Progression flight-speed multiplier for Soumaya (~1.0 → ~1.9). */
  pilotSpeed?: number;
  /** True when the initial API fetch of the real galaxy is done. */
  loaded?: boolean;
  /** Fires ONCE after the galaxy survives its first full animation frame — the app
   *  uses this to clear its "galaxy stuck" safe-mode flag. If the mount or first tick
   *  hangs/throws, this never fires and the next load falls back to the app-without-galaxy. */
  onFirstFrame?: () => void;
  /** Fuel her fast flight burned since the last flush — the app spends it. */
  onFuelBurn?: (amount: number) => void;
  onTasksChange?: (tasks: any[]) => void;
  shipViewMode?: "orbit" | "cockpit";
  fuel?: any;
  equippedShip?: string;
  equippedFig1?: string;
  equippedFig2?: string;
  equippedTrail?: string;
  spaceId?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export const Graph3D = forwardRef<Graph3DHandle, Props>(function Graph3D(
  {
    data,
    onSelect,
    onSoumayaClick,
    onSatelliteCount,
    onVisitorCount,
    selectedId,
    bottomInset,
    showShipTask,
    pilotSpeed,
    loaded,
    onFirstFrame,
    onFuelBurn,
    onTasksChange,
    shipViewMode,
    fuel,
    equippedShip = "default",
    equippedFig1 = "none",
    equippedFig2 = "none",
    equippedTrail = "blue",
    spaceId = "",
  },
  ref,
) {
  const renderCount = useRef(0);
  renderCount.current++;
  useEffect(() => {
    logDiagnosticEvent('event', 'Graph3D', { action: 'mount', render: renderCount.current });
    return () => logDiagnosticEvent('event', 'Graph3D', { action: 'unmount' });
  }, []);
  
  useEffect(() => {
    logDiagnosticEvent('effect', 'Graph3D.data', { nodes: data.nodes.length, links: data.links.length });
  }, [data]);

  useEffect(() => {
    logDiagnosticEvent('effect', 'Graph3D.selectedId', { id: selectedId });
  }, [selectedId]);

  const fgRef = useRef<any>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  // When set, only these node ids (a memory + its orbiting system) are shown.
  const [cluster, setCluster] = useState<Set<number> | null>(null);
  // Mirror the cluster into a ref so the render loop can scope Soumaya + the fleet to the
  // VISIBLE bodies only (she shouldn't fly off to tend things hidden by a lens/category view).
  const clusterRef = useRef<Set<number> | null>(null);
  useEffect(() => { clusterRef.current = cluster; }, [cluster]);
  // Hover wins; otherwise the selected node drives the highlight (mobile = no hover).
  const activeId = hoverId ?? selectedId ?? null;
  // Ref mirror for callbacks captured once (the imperative handle only rebuilds on
  // [data], so reading `activeId` there directly recalled from a stale selection).
  const activeIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  const insetRef = useRef(false);
  useEffect(() => {
    insetRef.current = !!bottomInset;
  }, [bottomInset]);
  // Buffer visitor arrivals and flush them to the backend periodically.
  const visitBufRef = useRef<{ nodeId: number; type: string }[]>([]);
  const finChangeHandlerRef = useRef<(() => void) | null>(null);
  const journeyChangeHandlerRef = useRef<(() => void) | null>(null);
  // Drain the visitor buffer when the tab hides/closes — the 20s flush lives in
  // the rAF loop, which browsers pause for hidden tabs, so the tail was lost on
  // every close/background. keepalive lets the request outlive the page.
  useEffect(() => {
    const drain = () => {
      if (visitBufRef.current.length > 0) {
        logVisits(visitBufRef.current.splice(0, visitBufRef.current.length), true);
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") drain();
    };
    window.addEventListener("pagehide", drain);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", drain);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  const loadedRef = useRef(false);
  useEffect(() => {
    loadedRef.current = !!loaded;
  }, [loaded]);
  // Floating ship task label preference — kept in a ref for the engine loop, and
  // pushed to the live handle whenever the user toggles it.
  const showShipTaskRef = useRef(true);
  useEffect(() => {
    showShipTaskRef.current = !!showShipTask;
    soumayaHandleRef.current?.setTaskVisible(!!showShipTask);
  }, [showShipTask]);

  // Progression flight speed — pushed to Soumaya so she flies faster as you grow
  // the brain. Re-applied on change and once on (re)creation via the same handle.
  const pilotSpeedRef = useRef(1);
  useEffect(() => {
    pilotSpeedRef.current = pilotSpeed ?? 1;
    soumayaHandleRef.current?.setPilotSpeed?.(pilotSpeed ?? 1);
  }, [pilotSpeed]);

  // Hangar customization states and refs
  const fig1GroupRef = useRef<THREE.Group | null>(null);
  const fig2GroupRef = useRef<THREE.Group | null>(null);

  const equippedShipRef = useRef(equippedShip);
  const equippedFig1Ref = useRef(equippedFig1);
  const equippedFig2Ref = useRef(equippedFig2);
  const equippedTrailRef = useRef(equippedTrail);

  const spaceIdRef = useRef(spaceId);
  useEffect(() => {
    spaceIdRef.current = spaceId;
  }, [spaceId]);

  // Fuel is polled async and updates over time; the engine loop is a one-shot effect,
  // so read it through a ref or the loop would forever see the initial null and the
  // fuel-gated flight behavior would never engage.
  const fuelRef = useRef(fuel);
  useEffect(() => {
    fuelRef.current = fuel;
  }, [fuel]);

  // Deferred FX (particle bursts, pulse trains) schedule short timeouts that fire into
  // the live ForceGraph instance. Track every pending id so the unmount cleanup can
  // clear them — otherwise an unmount (logout → remount) leaves orphan timers that fire
  // into a torn-down scene. Stable identity via a ref so the one-shot effect captures it.
  const pendingTimersRef = useRef<Set<number>>(new Set());
  const scheduleTimeout = useRef((fn: () => void, ms: number): number => {
    const id = window.setTimeout(() => {
      pendingTimersRef.current.delete(id);
      fn();
    }, ms);
    pendingTimersRef.current.add(id);
    return id;
  }).current;

  useEffect(() => {
    equippedShipRef.current = equippedShip;
    if (soumayaHandleRef.current?.setShipSkin) {
      soumayaHandleRef.current.setShipSkin(equippedShip);
    }
  }, [equippedShip]);

  useEffect(() => {
    equippedTrailRef.current = equippedTrail;
    if (soumayaHandleRef.current?.setTrailColor) {
      soumayaHandleRef.current.setTrailColor(equippedTrail);
    }
  }, [equippedTrail]);

  useEffect(() => {
    equippedFig1Ref.current = equippedFig1;
    if (fig1GroupRef.current) {
      updateFigurine(
        fig1GroupRef.current,
        equippedFig1,
        new THREE.Vector3(8000, 3000, -9500),
        () => fgRef.current?.scene?.()?.environment ?? null
      );
    }
  }, [equippedFig1]);

  useEffect(() => {
    equippedFig2Ref.current = equippedFig2;
    if (fig2GroupRef.current) {
      updateFigurine(
        fig2GroupRef.current,
        equippedFig2,
        new THREE.Vector3(-9000, -2000, -9500),
        () => fgRef.current?.scene?.()?.environment ?? null
      );
    }
  }, [equippedFig2]);

  // Live graph data for the Soumaya agent (react-force-graph mutates x/y/z on
  // these node objects each tick, so the agent always has current positions).
  const dataRef = useRef(data);
  // id → node map for O(1) lookups in the per-link accessors (see getLinkActivity).
  const nodeByIdRef = useRef<Map<number, any>>(new Map());
  const nodeThreeObjCacheRef = useRef<Map<number, { obj: THREE.Object3D; key: string }>>(new Map());
  const orbitsRef = useRef(makeOrbitSystem());
  useEffect(() => {
    dataRef.current = data;
    const liveIds = new Set((data.nodes as any[]).map((n) => n.id));
    for (const [id, entry] of nodeThreeObjCacheRef.current) {
      if (!liveIds.has(id)) {
        disposeObject3D(entry.obj); // free VRAM for deleted nodes
        nodeThreeObjCacheRef.current.delete(id);
      }
    }
    const prevById = nodeByIdRef.current; // last frame's nodes (for detecting deletions)
    nodeByIdRef.current = new Map((data.nodes as any[]).map((n: any) => [n.id, n]));
    orbitsRef.current.rebuild(data.nodes as any[], data.links as any[]);
    sunRef.current?.userData?.setBrainScale?.(data.nodes.length); // core-self size (clamped)
    // Place the station just outside the bodies (so planets never pass through it)
    // and size the zoom ceiling so you can frame the station — wrapped in stars —
    // but never zoom far enough to exit the surrounding star field.
    const reff = Math.max(orbitsRef.current.getRadius(), 1000);
    stationOrbitRef.current = reff + 800;
    // The zoom-out ceiling scales with the TRUE galaxy radius so recenter can always pull
    // far enough to frame the whole thing (the old flat 6200 cap couldn't, even for small
    // galaxies — measured). frameGalaxy may raise this further for narrow/portrait fits;
    // the scenery is scaled well beyond it so the star-field edge is never revealed.
    maxDistRef.current = Math.max(3200, reff * 3.4 + 900);
    scaleSceneryRef.current();

    // Detect freshly-formed connections so SOUMAYA flies out and draws them herself
    // (rather than the line just popping in). The first data load is the baseline —
    // we don't make her redraw the entire pre-existing graph.
    const keys = (data.links as any[]).map(linkKey);
    if (!linksInitedRef.current) {
      if (loaded || data.nodes.length > 0) {
        knownLinksRef.current = new Set(keys);
        knownNodesRef.current = new Set((data.nodes as any[]).map((n) => n.id));
        linksInitedRef.current = true;
        fgRef.current?.refresh?.();
      }
    } else {
      // New CONNECTIONS appear immediately (never hidden). We still hand the newest few
      // to Soumaya so she flies over and PULSES them (a bright neuron-firing flash that
      // fades) — but the line itself is already there the whole time.
      const fresh: LinkTask[] = [];
      const calm = shouldCalmMotion();
      for (const l of data.links as any[]) {
        const k = linkKey(l);
        if (!knownLinksRef.current.has(k)) {
          knownLinksRef.current.add(k);
          if (fresh.length < PULSE_VISIT_CAP) {
            fresh.push({ id: `link-${k}`, source: linkEnd(l.source), target: linkEnd(l.target), key: k });
            // A comet sweeps along the new connection as it forms (#1b) — skipped under
            // reduced-motion, and bounded by the same cap so a bulk sync can't fire
            // hundreds of sparks (the pool only shows a few anyway).
            if (!calm) {
              const a = nodeByIdRef.current.get(linkEnd(l.source));
              const b = nodeByIdRef.current.get(linkEnd(l.target));
              if (a?.x != null && b?.x != null) {
                linkFormingRef.current?.fire(
                  new THREE.Vector3(a.x, a.y, a.z ?? 0),
                  new THREE.Vector3(b.x, b.y, b.z ?? 0),
                );
              }
            }
          }
        }
      }
      if (fresh.length > 0) soumayaHandleRef.current?.enqueueLinks(fresh);

      // New MEMORIES: park each at the waystation "dock" and have Soumaya ferry it
      // into its orbit slot (Phase 2). The orbit system holds it (won't place it)
      // until she drops it home. Falls back to normal placement if no dock yet.
      const dock = stationObjRef.current?.getWorldPosition(new THREE.Vector3()) ?? null;
      if (dock) {
        const freshNodes: number[] = [];
        for (const n of data.nodes as any[]) {
          if (!knownNodesRef.current.has(n.id)) {
            knownNodesRef.current.add(n.id);
            n.x = dock.x + (Math.random() - 0.5) * 90;
            n.y = dock.y + (Math.random() - 0.5) * 50;
            n.z = dock.z + (Math.random() - 0.5) * 90;
            n.fx = n.x; n.fy = n.y; n.fz = n.z; // wait at the dock
            orbitsRef.current.hold(n.id);
            freshNodes.push(n.id);
          }
        }
        if (freshNodes.length > 0) {
          soumayaHandleRef.current?.enqueuePlacements(freshNodes);
          // Arrival flourish: a soft materialize burst at the dock as each new star docks
          // (before Soumaya ferries it out to its orbit), so a new memory visibly "lands".
          if (!shouldCalmMotion()) {
            for (let i = 0; i < Math.min(freshNodes.length, 3); i++) {
              scheduleTimeout(() => burstsRef.current?.spawn(dock.x, dock.y, dock.z, "user"), i * 160);
            }
          }
        }
      } else {
        // No station yet — just track them as known so they place normally.
        for (const n of data.nodes as any[]) knownNodesRef.current.add(n.id);
      }

      // DELETED memories: Soumaya drags each to the Sun and flings it in (Phase 2b).
      const liveIds = new Set((data.nodes as any[]).map((n) => n.id));
      const removals: RemovalTask[] = [];
      for (const id of knownNodesRef.current) {
        if (!liveIds.has(id)) {
          knownNodesRef.current.delete(id);
          orbitsRef.current.release(id); // in case it was mid-ferry
          const old = prevById.get(id);
          if (old && old.x != null) {
            removals.push({
              id: `removal-${id}-${Date.now()}`,
              x: old.x,
              y: old.y,
              z: old.z ?? 0,
              color: colorForType(old.type),
              size: 4 + (old.mass ?? 0.3) * 5,
            });
          }
        }
      }
      if (removals.length > 0) soumayaHandleRef.current?.enqueueRemovals(removals);
    }

    // A just-formed constellation has now landed in the data → fly-to-isolate it with a
    // celebratory burst, once (its members are already placed, so the system frames).
    if (pendingHubRef.current != null) {
      const hubId = pendingHubRef.current;
      const present = (data.nodes as any[]).some((n) => n.id === hubId);
      if (present) {
        pendingHubRef.current = null;
        scheduleTimeout(() => doIsolateSystem(hubId, true), 200);
      }
    }
  }, [data, loaded]);

  // When set, the camera locks onto this node and rides along as it orbits, so a
  // body you jumped to doesn't drift out of frame.
  const followRef = useRef<number | null>(null);
  // Generic "focus on a non-memory object" (ship / station). On enable we snap to
  // the front of it once, then just track it so the user can orbit freely.
  const followObjRef = useRef<THREE.Object3D | null>(null);
  const followDistRef = useRef(30);
  const followSnapRef = useRef(false);
  const followKindRef = useRef<"ship" | "station" | "satellite" | "visitor" | "fleet" | "fig1" | "fig2" | null>(null);
  // Which active beacon we're cycling through with the satellite focus button.
  const satFollowIndexRef = useRef(0);
  // Ride-along anchor so focusing a moving body keeps a locked view (no swinging).
  const followObjAnchor = useRef(new THREE.Vector3());
  const followObjAnchored = useRef(false);
  // While > now, a focus fly-to tween is in flight — the loop lets it own the camera.
  const followFlyUntilRef = useRef(0);
  // Camera zoom-out ceiling, kept just beyond the galaxy so you can never zoom so
  // far that the bodies leave the star field / you see its edge.
  const maxDistRef = useRef(5200);
  // Desired station orbit radius (sized to sit just outside the galaxy bodies).
  const stationOrbitRef = useRef(1700);

  const soumayaObjRef = useRef<THREE.Object3D | null>(null);
  const soumayaHandleRef = useRef<SoumayaHandle | null>(null);
  const stationObjRef = useRef<THREE.Object3D | null>(null);
  const sunRef = useRef<THREE.Object3D | null>(null);

  const onFirstFrameRef = useRef(onFirstFrame);
  onFirstFrameRef.current = onFirstFrame;
  const firstFrameDoneRef = useRef(false);
  const onFuelBurnRef = useRef(onFuelBurn);
  onFuelBurnRef.current = onFuelBurn;
  const onTasksChangeRef = useRef(onTasksChange);
  useEffect(() => {
    onTasksChangeRef.current = onTasksChange;
  }, [onTasksChange]);

  const shipViewModeRef = useRef<"orbit" | "cockpit">("orbit");
  useEffect(() => {
    if (shipViewMode) shipViewModeRef.current = shipViewMode;
  }, [shipViewMode]);

  const lastTasksJsonRef = useRef("");

  const bloomRef = useRef<{ strength: number } | null>(null);
  const gfxRef = useRef<ResolvedGraphics | null>(null);
  const initialFramedRef = useRef(false);
  const cinematicStartedRef = useRef(false);
  // Link keys we've already seen, so only NEW connections get drawn by Soumaya.
  const knownLinksRef = useRef<Set<string>>(new Set());
  // Node ids we've already seen, so only BRAND-NEW memories get ferried into place.
  const knownNodesRef = useRef<Set<number>>(new Set());
  // Per-link last-repaired time (ms). Links decay with neglect; Soumaya re-forging
  // one refreshes it (Phase 3). Kept client-side so it needs no schema change.
  const linkHealthRef = useRef<Map<string, number>>(new Map());
  const linksInitedRef = useRef(false);
  // New links stay hidden until Soumaya physically flies out and connects them.
  // How many newly-appeared links Soumaya flies over to PULSE per refresh (they're
  // already visible; this just gives the freshest ones her neuron-firing flourish).
  const PULSE_VISIT_CAP = 4;
  const FOLLOW_FLY_MS = 850; // cinematic fly-to duration when engaging a focus lock
  const satellitesRef = useRef<SatelliteSystem | null>(null);
  const subAgentsRef = useRef<SubAgentSystem | null>(null);
  const visitorsRef = useRef<VisitorSystem | null>(null);
  const visFollowIndexRef = useRef(0);
  const fleetFollowIndexRef = useRef(0);
  const lastSatCountRef = useRef(-1);
  const lastVisCountRef = useRef(-1);
  const burstsRef = useRef<ReturnType<typeof makeCollisionBursts> | null>(null);
  const linkFormingRef = useRef<ReturnType<typeof makeLinkForming> | null>(null);
  // Scenery we scale outward as the galaxy grows, so the camera never zooms past its
  // edge (starfield/constellations/GLB skybox). Base radii are their creation sizes.
  const sceneryRef = useRef<{ starfield?: THREE.Object3D; constellations?: THREE.Object3D; skybox?: THREE.Object3D; equirect?: THREE.Object3D; deepspace?: THREE.Object3D; milkyway?: THREE.Object3D; galaxies?: THREE.Object3D; moneysky?: THREE.Object3D; journeyhubs?: THREE.Object3D; nebulae?: THREE.Object3D; comets?: THREE.Object3D }>({});
  // Push the scenery out so its radius always exceeds the camera's reach for the current
  // galaxy size (getRadius). Base radii = each object's creation size. Cheap (a transform).
  const scaleSceneryRef = useRef<() => void>(() => {});
  scaleSceneryRef.current = () => {
    const R = orbitsRef.current?.getRadius?.() ?? 1000;
    const s = sceneryRef.current;
    const fit = (obj: THREE.Object3D | undefined, base: number, mult: number) => {
      if (obj) obj.scale.setScalar(Math.max(1, (R * mult) / base));
    };
    fit(s.starfield, 7000, 7); // stars surround the camera at any zoom-out
    fit(s.milkyway, 8600, 7.4); // the galactic band arcs just beyond the starfield
    fit(s.constellations, 9500, 8);
    fit(s.galaxies, 12750, 11); // distant spiral galaxies stay beyond the memory galaxy
    fit(s.equirect, 11500, 9.5); // optional photographic Milky Way panorama (if the asset exists)
    fit(s.deepspace, DEEP_SPACE_BASE, 8.5); // nebula clouds / dust / galaxies / belt sit far out
    fit(s.moneysky, MONEY_SKY_BASE, 1.6); // your money constellation sits just outside the galaxy
    fit(s.journeyhubs, JOURNEY_HUBS_BASE, 1.9); // life-chapter hubs ring higher, watching over it all
    fit(s.skybox, 12000, 10); // the nebula shell sits furthest out
    // The far clip must exceed the (now-scaled) skybox on the far side of the galaxy, or
    // everything past 30000 clips. Scale it with the ceiling (kept ≥ the old 30000).
    const fg = fgRef.current;
    const cam = fg?.camera?.() as THREE.PerspectiveCamera | undefined;
    if (cam?.isPerspectiveCamera) {
      const want = Math.max(30000, maxDistRef.current * 6);
      if (Math.abs((cam.far ?? 0) - want) > 1) {
        cam.far = want;
        cam.updateProjectionMatrix();
      }
    }
  };
  // Accessibility: when reduced-motion is on we crawl the orbits + skip ambient
  // pulses (#3b). Kept in a ref so the render loop reads it without re-subscribing.
  const calmMotionRef = useRef(shouldCalmMotion());
  const spatialGrid = useRef<Map<string, { isVisible: boolean }>>(new Map());
  const lastCellUpdatePos = useRef(new THREE.Vector3(Infinity, Infinity, Infinity));
  const frustum = useRef(new THREE.Frustum());
  const projScreenMatrix = useRef(new THREE.Matrix4());
  const sphere = useRef(new THREE.Sphere(new THREE.Vector3(), 150));
  useEffect(() => {
    const sync = () => { calmMotionRef.current = shouldCalmMotion(); };
    window.addEventListener("brain-motion-change", sync);
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    mq?.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener("brain-motion-change", sync);
      mq?.removeEventListener?.("change", sync);
    };
  }, []);

  // Undirected adjacency for neighbor highlighting.
  const adjacency = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const l of data.links) {
      const s = linkEnd(l.source);
      const t = linkEnd(l.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [data]);

  const isLit = (id: number): boolean =>
    activeId === null || id === activeId || (adjacency.get(activeId)?.has(id) ?? false);

  // One-time imperative scene setup: lights, starfield, bloom, spin loop.
  const defer = (fn: () => void) => {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(fn);
    } else {
      setTimeout(fn, 1);
    }
  };

  useEffect(() => {
  const fg = fgRef.current;
  if (!fg || fg.__brainInited) return;
  fg.__brainInited = true;

  const scene: THREE.Scene = fg.scene();
  const controls = fg.controls?.();
  // See the far galaxies + the nebula skybox shell (~12000 out).
  const pcam = fg.camera() as THREE.PerspectiveCamera;
  if (pcam?.isPerspectiveCamera) {
    pcam.far = Math.max(30000, maxDistRef.current * 4);
    pcam.updateProjectionMatrix();
  }
  scene.add(new THREE.AmbientLight(0x8888aa, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(1, 1, 1);
  scene.add(dir);

  // Image-based lighting: a PMREM environment so the glTF models (ship, station,
  // Aura satellites) — which use metallic PBR materials — actually catch light and
  // reflections instead of rendering as black silhouettes. Also gives every body a
  // subtle premium sheen. Generated once from a neutral procedural room.
  defer(() => {
    try {
      const renderer = fg.renderer() as THREE.WebGLRenderer;
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose(); // the generator's internal render targets are no longer needed
    } catch (err) {
      console.warn("[graph] environment map unavailable:", err);
    }
  });

  // Declared outside try-catch so spawnBurst can access it
  let soumaya: SoumayaHandle | null = null;
  let engine: ReturnType<typeof makeEngineAudio> | null = null;
  let prevShipPos: THREE.Vector3 | null = null;
  let visitors: VisitorSystem | null = null;
  let satellites: SatelliteSystem | null = null;
  let subAgents: SubAgentSystem | null = null;

  // Adaptive graphics: the central config decides how heavy we render (Graph3D
  // never decides itself). Weak devices get fewer stars, no bloom, a capped pixel
  // ratio and FPS — the SAME app, optimized. Held in a ref so live setting changes
  // can retune the cheap knobs (pixel ratio, FPS) without a reload.
  const gfx: ResolvedGraphics = resolveGraphics();
  gfxRef.current = gfx;
  try {
    // Cap the renderer's pixel ratio FIRST — the single biggest GPU cost on mobile
    // (a 3× retina phone renders 9× the pixels). This alone prevents most freezes.
    try {
      fg.renderer().setPixelRatio(gfx.pixelRatio);
    } catch {
      /* renderer not ready yet — the effect below re-applies it */
    }
    scene.background = new THREE.Color(BG);
    defer(() => {
        const starfield = makeStarfield(gfx.starCount);
        sceneryRef.current.starfield = starfield;
        scene.add(starfield);
        
        const milkyway = makeMilkyWay(8600, gfx.tier === "quality" ? "high" : gfx.tier === "balanced" ? "medium" : "low");
        sceneryRef.current.milkyway = milkyway;
        scene.add(milkyway);

        const galaxies = makeGalaxies(gfx.tier === "quality" ? 4 : gfx.tier === "balanced" ? 3 : 2);
        sceneryRef.current.galaxies = galaxies;
        scene.add(galaxies);

        const constellations = makeConstellations();
        sceneryRef.current.constellations = constellations;
        scene.add(constellations);
        
        scaleSceneryRef.current(); // Ensure scale is applied after addition
    });
    
    // Heavy background scenery (skybox, nebulae, galaxy sprites, comets) is a pile of
    // extra draw calls + textures that can stall a mid/low phone on the first frame —
    // render it only on the top graphics tier. The starfield alone still reads as space.
    // Deep-space ambience — nebula clouds / dust / distant galaxies / asteroid belt.
    // Procedural (no assets) + cheap, so it runs on mid-range mobile too (not just the
    // top graphics tier like the legacy heavy scenery). Count scales with the tier.
    defer(() => {
        const deepspace = makeDeepSpace(gfx.tier === "quality" ? "high" : gfx.tier === "balanced" ? "medium" : "low");
        sceneryRef.current.deepspace = deepspace;
        scene.add(deepspace);
    });
    // Money-sky (Stage 4): your bills as stars in their own constellation. Fetched from the
    // server (state → colour/glyph/pulse; cooling=blue, urgent=red pulse) and rebuilt whenever
    // finances change.
    const disposeGroup = (g: THREE.Object3D) => g.traverse((o: any) => {
      if (o.material) { const m = o.material; (Array.isArray(m) ? m : [m]).forEach((x: any) => { x.map?.dispose?.(); x.dispose?.(); }); }
      o.geometry?.dispose?.();
    });
    defer(() => {
        const rebuildMoneySky = async () => {
          const stars = (await getMoneySky()) ?? [];
          const old = sceneryRef.current.moneysky;
          if (old) { scene.remove(old); disposeGroup(old); }
          const grp = makeMoneySky(stars);
          sceneryRef.current.moneysky = grp;
          scene.add(grp);
          scaleSceneryRef.current();
        };
        void rebuildMoneySky();
        const onFinanceChanged = () => void rebuildMoneySky();
        finChangeHandlerRef.current = onFinanceChanged;
        window.addEventListener("brain-finance-changed", onFinanceChanged);
    });

    // Living Galaxy — Journey hubs (Vision 2.0): bright hubs that brighten with progress, dim
    // when cold. Same pattern as the money-sky; rebuilt on `brain-journeys-changed`.
    defer(() => {
        const rebuildJourneyHubs = async () => {
          const journeys = (await getJourneys()) ?? [];
          const old = sceneryRef.current.journeyhubs;
          if (old) { scene.remove(old); disposeGroup(old); }
          const grp = makeJourneyHubs(journeys);
          sceneryRef.current.journeyhubs = grp;
          scene.add(grp);
          scaleSceneryRef.current();
        };
        void rebuildJourneyHubs();
        const onJourneysChanged = () => void rebuildJourneyHubs();
        journeyChangeHandlerRef.current = onJourneysChanged;
        window.addEventListener("brain-journeys-changed", onJourneysChanged);
    });
    const bursts = makeCollisionBursts();
    burstsRef.current = bursts;
    scene.add(bursts.group);
    // Constellation-forming flourish (#1b): a comet sweeps along each new link.
    const linkForming = makeLinkForming();
    linkForming.group.userData.update = () => linkForming.update();
    linkFormingRef.current = linkForming;
    scene.add(linkForming.group);

      // Create background figurine groups and register them
      const fig1Group = new THREE.Group();
      const fig2Group = new THREE.Group();
      fig1GroupRef.current = fig1Group;
      fig2GroupRef.current = fig2Group;
      scene.add(fig1Group);
      scene.add(fig2Group);

      // Initialize background figurines with current values
      updateFigurine(fig1Group, equippedFig1Ref.current, new THREE.Vector3(8000, 3000, -9500), () => scene.environment);
      updateFigurine(fig2Group, equippedFig2Ref.current, new THREE.Vector3(-9000, -2000, -9500), () => scene.environment);

      soumaya = makeSoumaya(equippedShipRef.current);
      soumayaHandleRef.current = soumaya;
      if (soumaya.setTrailColor) {
        soumaya.setTrailColor(equippedTrailRef.current);
      }
      scene.add(soumaya.object);
      scene.add(soumaya.taskLabel);
      scene.add(soumaya.cargo); // the discarded memory she drags into the Sun
      scene.add(soumaya.trail); // engine plume (world-space)
      soumaya.setTaskVisible(!!showShipTaskRef.current);
      soumaya.setPilotSpeed?.(pilotSpeedRef.current);
      soumayaObjRef.current = soumaya.object;

      // Real ship-engine audio, only audible when the camera is focused on her.
      engine = makeEngineAudio();
      // The Sun: the gigantic central body every cluster revolves around.
      const sun = makeSun();
      sunRef.current = sun;
      sun.userData.setBrainScale?.(dataRef.current.nodes.length);
      scene.add(sun);
      
      const station = makeSpaceStation();
      scene.add(station);
      stationObjRef.current = station;

      visitors = makeVisitors(3, (nodeId, type) => {
        visitBufRef.current.push({ nodeId, type });
      });
      visitorsRef.current = visitors;
      scene.add(visitors.group);
      satellites = makeSatellites();
      satellitesRef.current = satellites;
      scene.add(satellites.group);
      subAgents = makeSubAgents();
      subAgentsRef.current = subAgents;
      scene.add(subAgents.group);
      // Bloom is expensive post-processing — skip it entirely on Performance/weak
      // devices (a major GPU + VRAM saving), else add it at the resolved strength.
      bloomRef.current = gfx.bloom ? addBloom(fg, { strength: gfx.bloomStrength }) : null;

      // Click detection for Soumaya's ship
      const canvas = fg.renderer().domElement;
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const handleClick = (e: MouseEvent) => {
        if (!onSoumayaClick) return;
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, fg.camera());
        const intersects = raycaster.intersectObject(soumaya!.object, true);
        if (intersects.length > 0) {
          logDiagnosticEvent('callback', 'Graph3D.onSoumayaClick');
          onSoumayaClick();
        }
      };
      canvas.addEventListener("click", handleClick);
      fg.__brainCleanupClick = () => canvas.removeEventListener("click", handleClick);

      // Motion is handled by the kinematic orbit system (orbits.ts), which pins
      // node positions each frame — so disable the force-engine layout entirely
      // (no charge/gravity tug-of-war, no collapse). Links are kept only as
      // visual tethers between the orbiting bodies.
      fg.d3Force("charge")?.strength(0);
      fg.d3Force("center", null);
      fg.d3Force("link")?.strength(0);

      // Zoom-out ceiling is driven each frame by maxDistRef (sized to the galaxy)
      // so you can admire it all but never zoom past the star field. Smooth,
      // weighty controls (inertial damping + zoom-toward-cursor) for a premium,
      // non-jittery feel when flying around and zooming in on planets.
      if (controls) {
        controls.maxDistance = maxDistRef.current;
        controls.minDistance = 8;
        controls.enableDamping = true;
        controls.dampingFactor = 0.075;
        controls.rotateSpeed = 0.55;
        controls.zoomSpeed = 0.9;
        controls.panSpeed = 0.6;
        controls.zoomToCursor = true; // dolly toward whatever you point at
        controls.screenSpacePanning = true;
      }
    } catch (err) {
      console.error("[graph] scene setup failed:", err);
    }

    // Labels fade in as you approach and out when far, so a zoomed-out galaxy
    // reads as points of light instead of a wall of text (Obsidian-style LOD).
    const camera: THREE.Camera = fg.camera();
    const tmp = new THREE.Vector3();
    const FADE_NEAR = 170; // labels fully visible at/under this camera distance
    // Labels are transparent canvas sprites (extra draw calls + overdraw) — the cost that makes
    // a big galaxy heavy on a weak phone (you feel it lift when a lens/isolate hides bodies). So
    // on lower graphics tiers, fade labels out SOONER: fewer are on screen at once = less GPU load.
    const perfTier = gfxRef.current?.tier ?? "quality";
    const FADE_FAR = perfTier === "performance" ? 300 : perfTier === "balanced" ? 420 : 540;
    // Small screens show these zoomed-out sector names much smaller — give them a boost so
    // they're actually readable on a phone (the "can't read the names when zoomed out" bug).
    const isNarrowScreen = typeof window !== "undefined" && window.innerWidth < 760;
    const SECTOR_LABEL_BOOST = isNarrowScreen ? 1.4 : 1;

    const MACRO_DIST = 2600; // swap fidelity for points-of-light beyond this
    // (raised so bodies resolve into full 3D as you fly toward a cluster, not only
    // when you're right on top of them — dots are for genuinely distant bodies).

    // Brightness is INVERTED with zoom: a body blooms brightest from afar (the
    // galaxy reads as points of light) and dims/concentrates up close so you can
    // read its label and see the surface texture.
    const DIM_NEAR = 70;
    const BRIGHT_FAR = 430;
    const brightness = (d: number): number => {
      const t = Math.min(1, Math.max(0, (d - DIM_NEAR) / (BRIGHT_FAR - DIM_NEAR)));
      return 0.25 + 0.35 * t; // 0.25x up close .. 0.6x far away
    };

    // Nerve firing: emit single particles down links ON ACTIVITY (Soumaya tending a
    // memory, or fastening a new connection) instead of a constant random stream.
    // `emitParticle` fires one dot along a link using the particle accessors below.
    const fireAlongNode = (nodeId: number) => {
      const f = fgRef.current;
      if (!f?.emitParticle) return;
      let fired = 0;
      for (const l of dataRef.current.links as any[]) {
        if (fired >= 5) break;
        if (linkEnd(l.source) === nodeId || linkEnd(l.target) === nodeId) {
          try {
            f.emitParticle(l);
          } catch {
            /* link not mounted yet */
          }
          fired++;
        }
      }
    };
    const fireLink = (key: string) => {
      const f = fgRef.current;
      // A freshly pulsed OR repaired connection is now fully fresh (Phase 3 decay) —
      // it flares bright, then eases back to its resting colour over time.
      linkHealthRef.current.set(key, Date.now());
      f?.refresh?.(); // apply the fresh brightness immediately
      if (!f?.emitParticle) return;
      const l = (dataRef.current.links as any[]).find((x) => linkKey(x) === key);
      if (!l) return;
      // A short burst of dots so the new connection visibly "lights up".
      for (let i = 0; i < 4; i++) {
        scheduleTimeout(() => {
          try {
            f.emitParticle(l);
          } catch {
            /* ignore */
          }
        }, i * 160);
      }
      // Spark at both endpoints to read as "connected".
      const s = (dataRef.current.nodes as any[]).find((n) => n.id === linkEnd(l.source));
      const t2 = (dataRef.current.nodes as any[]).find((n) => n.id === linkEnd(l.target));
      if (s?.x != null) burstsRef.current?.spawn(s.x, s.y, s.z ?? 0, "synthesis");
      if (t2?.x != null) burstsRef.current?.spawn(t2.x, t2.y, t2.z ?? 0, "synthesis");
    };

    // Faint idle pulse: so dormant threads aren't lifeless, occasionally send a
    // single slow dot down a few random visible links (much quieter than the
    // activity firing).
    const IDLE_PULSE_EVERY_BASE = 4; // base seconds between ambient pulses
    let idlePulseT = IDLE_PULSE_EVERY_BASE;
    // Flush buffered visitor arrivals to the backend every ~20s.
    let visitFlushT = 20;
    // Phase 3: how often to scan for decayed links to send Soumaya to repair.
    let repairScanT = 18;
    // Ship-task → React sync cadence (see the throttle note in the tick).
    let taskSyncT = 0;
    let fuelBurnT = 0;
    const idlePulse = () => {
      const f = fgRef.current;
      if (!f?.emitParticle) return;
      const links = dataRef.current.links as any[];
      if (links.length === 0) return;
      // Intensify pulse density with node count: more links shimmer for larger brains (capped at 15 to prevent flooding)
      const numNodes = dataRef.current.nodes.length;
      const pulseLinksCount = Math.min(15, Math.max(2, Math.floor(numNodes / 10)));
      for (let i = 0; i < Math.min(pulseLinksCount, links.length); i++) {
        // Tournament selection: pick two random links and choose the one connected to
        // higher-degree nodes (i.e. denser clusters).
        const l1 = links[Math.floor(Math.random() * links.length)];
        const l2 = links[Math.floor(Math.random() * links.length)];
        const byId = nodeByIdRef.current; // O(1) lookups — no per-pick full-array scans
        const deg1 = (byId.get(linkEnd(l1.source))?.degree ?? 0) + (byId.get(linkEnd(l1.target))?.degree ?? 0);
        const deg2 = (byId.get(linkEnd(l2.source))?.degree ?? 0) + (byId.get(linkEnd(l2.target))?.degree ?? 0);
        const l = deg1 >= deg2 ? l1 : l2;

        try {
          f.emitParticle(l);
        } catch {
          /* link not mounted */
        }
      }
    };

    let raf = 0;
    let last = performance.now() * 0.001;
    let lastFrameMs = 0; // FPS-cap gate (adaptive graphics)
    let lastDist = 0;
    let lastRefreshTime = 0;
    let prevCamPos: THREE.Vector3 | null = null; // for camera-speed → starfield blur
    let starBlur = 0;
    let frameCount = 0;
    const followAnchor = new THREE.Vector3();
    let followAnchorId: number | null = null;
    const followPos = new THREE.Vector3();
    const tick = () => {
      raf = requestAnimationFrame(tick); // keep the loop alive even on capped frames
      // FPS cap (adaptive graphics): on Performance / battery-saver, skip this frame's
      // animation work when we're ahead of the target rate — a real CPU saving on weak
      // phones without touching functionality.
      const nowMs = performance.now();
      frameCount++;
      const cap = gfxRef.current?.fpsCap ?? 60;
      if (nowMs - lastFrameMs < 1000 / cap - 1.5) return;
      lastFrameMs = nowMs;

      const now = nowMs * 0.001;
      const dt = Math.min(0.05, now - last);
      last = now;

      // Sync tasks changes back to React UI — throttled to ~3Hz. getTasks does
      // multiple O(nodes) scans + builds arrays, and stringifying the result was
      // running at 60fps purely to DETECT change (a measured mobile battery sink).
      taskSyncT -= dt;
      if (taskSyncT <= 0 && soumayaHandleRef.current && onTasksChangeRef.current) {
        taskSyncT = 0.35;
        const currentTasks = soumayaHandleRef.current.getTasks(dataRef.current.nodes);
        const tasksJson = JSON.stringify(currentTasks);
        if (tasksJson !== lastTasksJsonRef.current) {
          lastTasksJsonRef.current = tasksJson;
          onTasksChangeRef.current(currentTasks);
        }
      }

      // Flush her accumulated fast-flight fuel burn to the app (~every 4s), so the
      // gauge ticks down as she cruises hard — without a per-frame network call.
      fuelBurnT -= dt;
      if (fuelBurnT <= 0) {
        fuelBurnT = 4;
        const burned = soumayaHandleRef.current?.getAndResetFuelBurn?.() ?? 0;
        if (burned > 0.05 && onFuelBurnRef.current) onFuelBurnRef.current(Math.round(burned * 100) / 100);
      }

      // Make link curvature/opacity zoom-bias live:
      // Track camera distance and periodically refresh link styles when zooming/scrolling
      const camera = fgRef.current?.camera();
      if (camera) {
        const dist = camera.position.length();
        const nowMs = performance.now();
        if (Math.abs(dist - lastDist) > 35 && nowMs - lastRefreshTime > 250) {
          lastDist = dist;
          lastRefreshTime = nowMs;
          fgRef.current?.refresh?.();
        }
      }

      // Ambient "alive" shimmer on idle threads — suppressed under reduced-motion,
      // where the resting galaxy should stay calm rather than constantly flowing (#3b).
      idlePulseT -= dt;
      if (idlePulseT <= 0) {
        if (!calmMotionRef.current) idlePulse();
        // Intensify idle pulse frequency with node count (down to every 1 second)
        const numNodes = dataRef.current.nodes.length;
        const pulseEvery = Math.max(1, IDLE_PULSE_EVERY_BASE - Math.floor(numNodes / 20));
        idlePulseT = pulseEvery;
      }

      // Phase 3 — link tending: on a calm cadence Soumaya flies to the COLDEST
      // connections and re-energizes them (fireLink → they flare bright + stream
      // packets, then decay over ~3 days). She always has the lowest-activity links
      // to tend (not only sub-threshold ones), so her tending is continuously visible
      // even on a fresh brain. Skipped only if she's already busy on links.
      repairScanT -= dt;
      if (repairScanT <= 0) {
        repairScanT = 10; // a calm, steady housekeeping cadence
        const links = dataRef.current.links as any[];
        if (links.length > 0) {
          const coldest = links
            .map((l) => ({ l, key: linkKey(l), act: getLinkActivity(l) }))
            .sort((a, b) => a.act - b.act) // least-active first
            .slice(0, 2)
            .map(({ l, key }) => ({ source: linkEnd(l.source), target: linkEnd(l.target), key }));
          if (coldest.length > 0) soumayaHandleRef.current?.enqueueLinks(coldest);
        }
      }

      // Persist visitor arrivals in batches.
      visitFlushT -= dt;
      if (visitFlushT <= 0) {
        visitFlushT = 20;
        if (visitBufRef.current.length > 0) {
          logVisits(visitBufRef.current.splice(0, visitBufRef.current.length));
        }
      }

      // Advance every body along its orbit first, so the camera + Soumaya read
      // up-to-date positions this frame. Under reduced-motion the drift slows to a
      // gentle crawl (never fully frozen, so the galaxy still feels alive) (#3b).
      const motionDt = calmMotionRef.current ? dt * 0.12 : dt;
      orbitsRef.current.update(motionDt, dataRef.current.nodes as any[]);

      // First frame with real positions → open zoomed-out (not inside the sun).
      if (!cinematicStartedRef.current) {
        // Trigger intro if we have loaded data.
        const ns = dataRef.current.nodes as any[];
        if (ns.length > 0) {
          cinematicStartedRef.current = true;
          initialFramedRef.current = true;
          frameGalaxy(3200, undefined, true);
        }
      }

      // Focus dim: when the camera is locked onto a body, fade the sun's glare +
      // soften bloom so the body reads clearly; restore when free/recentered.
      const focused = followRef.current != null || followObjRef.current != null;
      sunRef.current?.userData?.setFocusDim?.(focused);
      if (bloomRef.current) {
        const target = focused ? 0.16 : 0.35;
        bloomRef.current.strength += (target - bloomRef.current.strength) * Math.min(1, dt * 3);
      }

      // Scope Soumaya + the fleet to the VISIBLE bodies when a lens/category view is active —
      // she can't work on things a lens is hiding. No cluster → the whole galaxy, as before.
      const _cl = clusterRef.current;
      const workNodes = _cl && _cl.size
        ? (dataRef.current.nodes as any[]).filter((n: any) => _cl.has(n.id))
        : (dataRef.current.nodes as any[]);

      // Beacons launch from the station/ship, so hand the satellites their world positions.
      const stationWorld = stationObjRef.current
        ? stationObjRef.current.getWorldPosition(new THREE.Vector3())
        : null;
      const soumayaPos = soumayaObjRef.current
        ? soumayaObjRef.current.position.clone()
        : null;
      satellites?.update(dt, workNodes, stationWorld, soumayaPos);
      if (satellites && soumayaHandleRef.current) {
        const pending = satellites.getPendingDispatches();
        if (pending.length > 0) {
          soumayaHandleRef.current.enqueueBeacons(pending);
          if (spaceIdRef.current) {
            const key = `stat.beacons_deployed.${spaceIdRef.current}`;
            localStorage.setItem(key, String(parseInt(localStorage.getItem(key) || "0", 10) + pending.length));
            // Force evaluate achievements in App
            fgRef.current?.refresh?.();
          }
        }
      }
      // Defender live drifter intercept: wire visitor positions as a hazard context
      let subAgentHazard: SubAgentHazard | undefined = undefined;
      if (visitors) {
        subAgentHazard = {
          positions: visitors.getActive().map((v) => {
            const p = new THREE.Vector3();
            v.object.getWorldPosition(p);
            return p;
          }),
        };
      }
      subAgents?.update(dt, workNodes, subAgentHazard, soumayaPos);
      // Drifters fear/hate the beacons: hand the visitor system the live hazard set.
      visitors?.update(
        dt,
        dataRef.current.nodes as any[],
        satellites
          ? { beaconedIds: satellites.getBeaconedIds(), positions: satellites.getPositions() }
          : undefined,
      );
      // Tell React how many beacons are live, so the focus button can pulse.
      // Tell React how many beacons are live, so the focus button can pulse.
      if (satellites) {
        const active = satellites.getActive();
        if (active.length !== lastSatCountRef.current) {
          lastSatCountRef.current = active.length;
          onSatelliteCount?.(active.length);
        }
        // If the beacon we're following went dark, release the camera.
        if (followKindRef.current === "satellite") {
          const stillActive = active.some((a) => a.object === followObjRef.current);
          if (!stillActive) {
            followObjRef.current = null;
            followKindRef.current = null;
          }
        }
      }
      // Tell React how many visitors are around (drives the "jump to visitor" FAB).
      if (visitors) {
        const vActive = visitors.getActive();
        if (vActive.length !== lastVisCountRef.current) {
          lastVisCountRef.current = vActive.length;
          onVisitorCount?.(vActive.length);
        }
        // Release the camera if the visitor we were following has left.
        if (followKindRef.current === "visitor") {
          const stillHere = vActive.some((a) => a.object === followObjRef.current);
          if (!stillHere) {
            followObjRef.current = null;
            followKindRef.current = null;
          }
        }
      }
      // Release if the fleet craft we're following has docked (gone invisible).
      if (followKindRef.current === "fleet") {
        const stillFlying = (subAgentsRef.current?.getCraft() ?? []).some((c) => c.object === followObjRef.current);
        if (!stillFlying) {
          followObjRef.current = null;
          followKindRef.current = null;
        }
      }

      // Keep the zoom ceiling matched to the current galaxy size.
      if (controls) controls.maxDistance = maxDistRef.current;
      // Keep the station orbiting just outside the bodies (scales with the galaxy).
      stationObjRef.current?.userData?.setOrbit?.(stationOrbitRef.current);

      // Follow-lock: keep the jumped-to body centered as it orbits/drifts.
      const fid = followRef.current;
      if (fid != null && controls) {
        const fn = (dataRef.current.nodes as any[]).find((n) => n.id === fid);
        if (fn && fn.x != null) {
          followPos.set(fn.x, fn.y, fn.z ?? 0);
          if (followAnchorId === fid) {
            camera.position.add(followPos.clone().sub(followAnchor)); // ride along
          }
          controls.target.copy(followPos);
          // When the bottom sheet is open on mobile, look a bit lower so the body
          // rides above the panel instead of being centered behind it. On desktop,
          // look a bit to the right to shift the focused target to the left.
          if (insetRef.current) {
            if (window.innerWidth <= 720) {
              const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
              controls.target.addScaledVector(down, camera.position.distanceTo(followPos) * 0.18);
            } else {
              const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
              controls.target.addScaledVector(right, camera.position.distanceTo(followPos) * 0.095);
            }
          }
          followAnchor.copy(followPos);
          followAnchorId = fid;
        }
      } else {
        followAnchorId = null;
      }

      // Slowly rotate the deep space background figurines
      if (fig1GroupRef.current) {
        fig1GroupRef.current.rotation.y += 0.001;
      }
      if (fig2GroupRef.current) {
        fig2GroupRef.current.rotation.y += 0.0008;
      }

      // Camera speed → starfield blur: stars smear past when you rush by close up.
      // Per-frame camera move, normalized; eased so it ramps instead of snapping.
      {
        const cam = fgRef.current?.camera();
        if (cam) {
          if (prevCamPos) {
            const move = cam.position.distanceTo(prevCamPos);
            const target = Math.min(1, move / 26); // ~26 u/frame = full blur
            starBlur += (target - starBlur) * 0.25;
            prevCamPos.copy(cam.position);
          } else {
            prevCamPos = cam.position.clone();
          }
        }
      }

      // 1. Update background / global objects
      const s = sceneryRef.current;
      s.starfield?.userData?.update?.(now, starBlur);
      s.milkyway?.userData?.update?.(now);
      s.skybox?.userData?.update?.(now);
      s.constellations?.userData?.update?.(now);
      s.galaxies?.children.forEach((o: any) => o.userData?.update?.(now));
      s.equirect?.userData?.update?.(now);
      s.deepspace?.children.forEach((o: any) => o.userData?.update?.(now));
      s.moneysky?.children.forEach((o: any) => o.userData?.update?.(now));
      s.journeyhubs?.children.forEach((o: any) => o.userData?.update?.(now));
      s.nebulae?.children.forEach((o: any) => o.userData?.update?.(now));
      s.comets?.children.forEach((o: any) => o.userData?.update?.(now));
      burstsRef.current?.group?.children.forEach((o: any) => o.userData?.update?.());
      linkFormingRef.current?.group?.userData?.update?.();
      sunRef.current?.userData?.update?.(now);
      stationObjRef.current?.userData?.update?.(now);

      // 2. Optimized node updates (LOD + Pulse + Corona)
      // Instead of traversing the WHOLE scene (including starfield/nebulae), we
      // only iterate the bodies themselves. react-force-graph keeps them in a
      // dedicated group.
      const cam = fgRef.current?.camera() as THREE.PerspectiveCamera | undefined;
      if (cam?.isPerspectiveCamera) {
        cam.updateMatrixWorld();
        cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
        projScreenMatrix.current.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        frustum.current.setFromProjectionMatrix(projScreenMatrix.current);
      }

      // Find the group react-force-graph keeps the node objects in. Identify it by
      // its CONTENTS (children carrying a nodeId) rather than a fragile children-
      // count heuristic, which could latch onto the link group and silently stop
      // spin/pulse/LOD from ever running.
      const graphGroup = scene.children.find(
        (c: any) => c.type === "Group" && c.children?.some((ch: any) => ch.userData?.nodeId != null),
      );
      if (graphGroup) {
        // Update spatial grid visibility throttled
        if (frameCount % 60 === 0 || camera.position.distanceTo(lastCellUpdatePos.current) > 500) {
          spatialGrid.current.forEach((cell, key) => {
            const [cx, cy, cz] = key.split('_').map(Number);
            const cellPos = new THREE.Vector3(cx! * 1500 + 750, cy! * 1500 + 750, cz! * 1500 + 750);
            cell.isVisible = camera.position.distanceTo(cellPos) < 4000;
          });
          lastCellUpdatePos.current.copy(camera.position);
        }

        graphGroup.children.forEach((o: any) => {
          if (o.userData?.nodeId == null) return;
          const id = o.userData.nodeId;

          const n = nodeByIdRef.current.get(id);
          if (n && n.x != null && !isNaN(n.x)) {
            o.position.set(n.x, n.y, n.z ?? 0);
          }

          tmp.set(n.x, n.y, n.z ?? 0);
          const dist = tmp.distanceTo(camera.position);
          const bf = brightness(dist);
          const isSelected = id === activeId;
          const isMacroView = dist > MACRO_DIST && !isSelected;

          const processing = isNodeProcessing(id);
          if (processing) {
            // Strong size pulse during processing/LLM activity
            const scalePulse = 1.0 + 0.28 * (Math.sin(now * 8.0) * 0.5 + 0.5);
            o.scale.setScalar(scalePulse);
          } else if (isSelected) {
            // Gentle "this is the one you're on" breathing pulse on the focused body —
            // a steady slight enlarge under reduced-motion so it's still marked.
            o.scale.setScalar(calmMotionRef.current ? 1.08 : 1.0 + 0.09 * (Math.sin(now * 3.2) * 0.5 + 0.5));
          } else {
            o.scale.setScalar(1.0);
          }

          // Spatial Grid Check
          const key = `${Math.floor(n.x / 1500)}_${Math.floor(n.y / 1500)}_${Math.floor(n.z / 1500)}`;
          if (!spatialGrid.current.has(key)) spatialGrid.current.set(key, { isVisible: true });
          const cell = spatialGrid.current.get(key)!;

          sphere.current.center.set(n.x, n.y, n.z);
          const isFocused = isSelected || id === followRef.current;
          const isCulled = !isFocused && !frustum.current.intersectsSphere(sphere.current);

          if (!cell.isVisible && !isFocused) {
            o.visible = false;
            return;
          }
          o.visible = true;

          for (const child of o.children as any[]) {
          // Self-rotation: the body (+ rings) spins on its own axis while the
          // orbit system carries it around its neighbor. (Lives on the fidelity
          // group so labels don't rotate.)
          if (child.userData?.spin) child.rotation.y += child.userData.spinSpeed ?? 0.005;

          // Process titles regardless of parent culling
          if (child.userData?.isSectorTitle) {
            child.visible = isMacroView;
            if (child.visible) {
              const mat = child.material as THREE.SpriteMaterial;
              mat.opacity = 0.92;
              // Grow the label with camera distance so it holds a readable on-screen size
              // as you pull further out (world-scale sprites otherwise shrink to specks),
              // with an extra bump on small screens. Clamped so it never balloons up close.
              const base = child.userData.baseScale;
              if (base) {
                const k = Math.min(3.4, Math.max(1, dist / MACRO_DIST)) * SECTOR_LABEL_BOOST;
                child.scale.set(base.x * k, base.y * k, 1);
              }
              const mq = child.userData.marquee;
              if (mq) {
                mq.t += dt * 0.36;
                mat.map!.offset.x = (Math.sin(mq.t) * 0.5 + 0.5) * mq.range;
              }
            }
          }

          // Skip individual label processing if too far, not selected, and not focused.
          if (child.userData?.isLabel && dist > MACRO_DIST && !isSelected && id !== followRef.current) continue;
          
          // Optimization: throttle updates for distant/insignificant labels
          if ((child.userData?.isLabel || child.userData?.isSectorTitle) && frameCount % 2 !== 0 && dist > FADE_NEAR) {
            continue;
          }

          // Point Light Management
          if (child.userData?.isStarLight) {
            child.visible = dist < 2200;
          }

          // LOD Swapping
          if (child.userData?.isFidelity) child.visible = !isMacroView;
          if (child.userData?.isMacro) child.visible = isMacroView;

          if (isCulled) continue;

          if (child.userData?.isSectorTitle) {
            // Already handled above
          } else if (child.userData?.isLabel) {
              const labelVis = (isMacroView && !isSelected) ? 0 : Math.min(1, Math.max(0, (FADE_FAR - dist) / (FADE_FAR - FADE_NEAR)));
              child.visible = labelVis > 0.02;
              if (child.visible) {
                const mat = child.material as THREE.SpriteMaterial;
                mat.opacity = labelVis * 0.95;
                const mq = child.userData.marquee;
                if (mq) {
                  mq.t += dt * 0.36;
                  mat.map!.offset.x = (Math.sin(mq.t) * 0.5 + 0.5) * mq.range;
                }
              }
            }

            if (!child.visible) continue;

            // Pulse/Brightness
            if (child.userData?.pulse) {
              const p = child.userData.pulse;
              
              let s;
              let intensity;
              if (processing) {
                // Faster, stronger pulse during processing
                s = Math.sin(now * 8.0) * 0.5 + 0.5;
                intensity = (p.base * 1.5 + 0.65 * s) * bf;
              } else {
                s = Math.sin(now * p.speed + p.phase) * 0.5 + 0.5;
                intensity = (p.base + p.amp * s) * bf * (p.vitality ?? 1);
              }

              const mat = child.material as any;
              if (mat?.isShaderMaterial) {
                mat.uniforms.uBrightness.value = intensity;
                mat.uniforms.uTime.value = now;
              } else if (mat && mat.emissiveIntensity != null) {
                mat.emissiveIntensity = intensity;
              }
            }
            // Corona
            if (child.userData?.corona) {
              const c = child.userData.corona;
              const k = c.base * (1 + 0.2 * (Math.sin(now * c.speed + c.phase) * 0.5 + 0.5));
              child.scale.set(k, k, 1);
              (child.material as THREE.SpriteMaterial).opacity = c.baseOpacity * Math.min(1, bf);
            }
          }
        });
      }

      // Drive Soumaya along the live graph; spark a maintenance burst on arrival.
      if (soumaya) {
        const d = dataRef.current;
        const stationP = stationObjRef.current
          ? stationObjRef.current.getWorldPosition(new THREE.Vector3())
          : null;
        soumaya.update(
          dt,
          workNodes,
          d.links as any[],
          (x: number, y: number, z: number, type: string, nodeId: number | undefined) => {
            if (spaceIdRef.current) {
              const hopKey = `stat.travel_hops.${spaceIdRef.current}`;
              localStorage.setItem(hopKey, String(parseInt(localStorage.getItem(hopKey) || "0", 10) + 1));
            }
            if (type === "beacon_dispatch" && nodeId != null) {
              satellitesRef.current?.release(nodeId);
              burstsRef.current?.spawn(x, y, z, "synthesis");
            } else if (type === "consume") {
              // A discarded memory hit the Sun — fiery burst + a corona eruption.
              burstsRef.current?.spawn(x, y, z, "consume");
              sunRef.current?.userData?.flare?.();
            } else {
              burstsRef.current?.spawn(x, y, z, type);
            }
            // Nerve firing: when she tends a memory, pulse signal down its synapses.
            if (nodeId != null) fireAlongNode(nodeId);
          },
          stationP,
          // When she fastens a new connection, fire a burst of pulses down it.
          (key: string) => fireLink(key),
          // Orbit seam: lets her ferry a held new memory to its live slot, then
          // release it back to normal orbiting once she drops it home.
          {
            slotOf: (id: number) => orbitsRef.current.slotOf(id),
            release: (id: number) => orbitsRef.current.release(id),
          },
          fuelRef.current,
          controls?.target,
        );

        // Engine audio level = focus-on-her × how fast she's moving. You hear her
        // thrusters when you're watching her fly; near-silence otherwise.
        try {
          const shipPos = soumaya.object.position;
          const cam = fgRef.current?.camera();
          let speed = 0;
          if (prevShipPos) speed = shipPos.distanceTo(prevShipPos) / Math.max(dt, 0.001);
          prevShipPos = (prevShipPos ?? new THREE.Vector3()).copy(shipPos);
          const motion = Math.min(1, speed / 55);
          let focus = 0;
          if (followKindRef.current === "ship") focus = 1;
          else if (cam) {
            const d = cam.position.distanceTo(shipPos);
            focus = Math.max(0, Math.min(0.85, 1 - (d - 350) / 1400)); // louder the closer you are
          }
          // focus drives the ignition; motion drives the thruster loop (silent when parked).
          engine?.setLevel(focus, motion);
        } catch {
          /* engine audio is non-critical */
        }
      }

      // Focus on a non-memory object (ship/station): snap to its FRONT once, then
      // just track it so the body stays centered while you orbit the camera freely.
      const fo = followObjRef.current;
      if (fo && controls) {
        const sp = new THREE.Vector3();
        sp.copy(fo.position);
        
        // Disable damping when following her ship to prevent aggravating lag/trailing.
        if (followKindRef.current === "ship") {
          controls.enableDamping = false;
        } else {
          controls.enableDamping = true;
        }

        if (followKindRef.current === "ship" && shipViewModeRef.current === "cockpit") {
          // Cockpit Lock: camera is locked in front of the ship, looking back at the nose.
          const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(fo.quaternion).normalize();
          const up = new THREE.Vector3(0, 1, 0).applyQuaternion(fo.quaternion).normalize();
          const dist = 28;
          const camPos = sp.clone().addScaledVector(fwd, dist).addScaledVector(up, 8);
          camera.position.copy(camPos);
          
          const target = sp.clone();
          if (insetRef.current) {
            if (window.innerWidth <= 720) {
              const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
              target.addScaledVector(down, camera.position.distanceTo(sp) * 0.18);
            } else {
              const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
              target.addScaledVector(right, camera.position.distanceTo(sp) * 0.095);
            }
          }
          controls.target.copy(target);
          followObjAnchored.current = false;
        } else if (followKindRef.current === "fig1" || followKindRef.current === "fig2") {
          // Figurine Focus: place camera in front of it and slightly below, looking up.
          // The framing distance scales with the figurine (the black hole is huge, so a
          // fixed -4000 would put the camera inside it).
          if (followSnapRef.current) {
            const fd = (followObjRef.current as any)?.userData?.focusDist ?? 4000;
            const dir = sp.clone().normalize();
            const camPos = sp.clone().addScaledVector(dir, -fd);
            camPos.y -= fd * 0.2; // Looking up from below, scaled to size
            camera.position.copy(camPos);
            followObjAnchor.current.copy(sp);
            followObjAnchored.current = true;
            followSnapRef.current = false;
          }
          const target = sp.clone();
          if (insetRef.current) {
            if (window.innerWidth <= 720) {
              const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
              target.addScaledVector(down, camera.position.distanceTo(sp) * 0.18);
            } else {
              const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
              target.addScaledVector(right, camera.position.distanceTo(sp) * 0.095);
            }
          }
          controls.target.copy(target);
        } else {
          // Standard Orbit Follow: FLY in once (you see the approach), then ride along.
          if (followSnapRef.current) {
            const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(fo.quaternion).normalize();
            const d = followDistRef.current;
            const dest = sp.clone().addScaledVector(fwd, d).add(new THREE.Vector3(0, d * 0.35, 0));
            const fgc = fgRef.current;
            if (fgc && !calmMotionRef.current && camera.position.distanceTo(dest) > d * 0.6) {
              // Cinematic fly-to: cameraPosition tweens position AND look-target, so we
              // watch the body the whole way in before locking on.
              fgc.cameraPosition({ x: dest.x, y: dest.y, z: dest.z }, sp, FOLLOW_FLY_MS);
              followFlyUntilRef.current = performance.now() + FOLLOW_FLY_MS + 30;
            } else {
              camera.position.copy(dest); // already close, or reduced-motion → no swoop
              followObjAnchor.current.copy(sp);
              followObjAnchored.current = true;
            }
            followSnapRef.current = false;
          }
          if (performance.now() < followFlyUntilRef.current) {
            // Flying in — let the tween own the camera + target this frame.
          } else {
            if (!followObjAnchored.current) {
              // Fly finished: engage ride-along from wherever we landed.
              followObjAnchor.current.copy(sp);
              followObjAnchored.current = true;
            } else {
              // Ride along with the moving body: translate the camera by the body's
              // delta so the view stays locked instead of swinging to chase it.
              camera.position.add(sp.clone().sub(followObjAnchor.current));
              followObjAnchor.current.copy(sp);
            }
            const target = sp.clone();
            // Offset the target when panel is open
            if (insetRef.current) {
              if (window.innerWidth <= 720) {
                const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
                target.addScaledVector(down, camera.position.distanceTo(sp) * 0.18);
              } else {
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
                target.addScaledVector(right, camera.position.distanceTo(sp) * 0.095);
              }
            }
            controls.target.copy(target);
          }
        }
      } else if (controls) {
        // Ensure damping is enabled when not following any object
        controls.enableDamping = true;
      }

      // Sync computed coordinates from dataRef.current.nodes back to the active simulated nodes
      // in react-force-graph-3d.
      const fg = fgRef.current;
      const liveNodes = fg?.graphData?.()?.nodes as any[];
      if (liveNodes && liveNodes.length > 0) {
        const liveById = new Map<number, any>(liveNodes.map((n) => [n.id, n]));
        for (const n of dataRef.current.nodes as any[]) {
          const live = liveById.get(n.id);
          if (live) {
            live.x = n.x;
            live.y = n.y;
            live.z = n.z;
            live.fx = n.fx;
            live.fy = n.fy;
            live.fz = n.fz;
          }
        }
      }

      // Single damped update per frame (required for inertia + zoom-to-cursor).
      controls?.update();
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      engine?.dispose();
      if (finChangeHandlerRef.current) window.removeEventListener("brain-finance-changed", finChangeHandlerRef.current);
      if (journeyChangeHandlerRef.current) window.removeEventListener("brain-journeys-changed", journeyChangeHandlerRef.current);
      if (fg.__brainCleanupClick) fg.__brainCleanupClick();
      // The bloom pass holds several render targets (real VRAM) and lives on the
      // library's persistent composer — without remove+dispose, a re-init would
      // stack a second pass on top of the leaked first.
      if (bloomRef.current) {
        try {
          const pass = bloomRef.current as any;
          (fg as any).postProcessingComposer?.()?.removePass?.(pass);
          pass.dispose?.();
        } catch {
          /* best-effort */
        }
        bloomRef.current = null;
      }
      // Cancel any deferred FX timers so they don't fire into the torn-down scene.
      for (const id of pendingTimersRef.current) clearTimeout(id);
      pendingTimersRef.current.clear();
      // Free the VRAM held by every cached node object on unmount (e.g. logout →
      // remount), so a new session doesn't start atop the old scene's leaked buffers.
      for (const entry of nodeThreeObjCacheRef.current.values()) disposeObject3D(entry.obj);
      nodeThreeObjCacheRef.current.clear();
      // Full scene teardown: dispose every imperatively-added object's geometry/
      // materials/textures (starfield, nebulae, skybox, ship, station, satellites,
      // figurines, sun, bursts) plus the PMREM environment map — otherwise all of it
      // leaks on logout→remount. Lights need no disposal; disposeObject3D is idempotent.
      try {
        const scn = fg.scene?.();
        if (scn) {
          scn.traverse((o: any) => {
            o.geometry?.dispose?.();
            const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
            for (const m of mats) {
              for (const k in m) {
                const v = (m as any)[k];
                if (v && v.isTexture) v.dispose?.();
              }
              m.dispose?.();
            }
          });
          (scn.environment as any)?.dispose?.();
          scn.environment = null;
        }
      } catch {
        /* teardown is best-effort */
      }
      fg.__brainInited = false; // allow a clean re-init if this fg instance is reused
    };
  }, []);

  // Live-apply the cheap graphics knobs when Settings change: pixel ratio + FPS cap
  // update instantly (huge on mobile); star count + bloom need a reload (the Settings
  // panel says so), since they're one-time scene construction.
  useEffect(() => {
    const apply = () => {
      const g = resolveGraphics();
      gfxRef.current = g;
      try {
        (fgRef.current as any)?.renderer?.().setPixelRatio(g.pixelRatio);
      } catch {
        /* renderer may be mid-teardown */
      }
    };
    window.addEventListener("brain-graphics-change", apply);
    return () => window.removeEventListener("brain-graphics-change", apply);
  }, []);

  // Hover highlighting: dim node groups that aren't the focus or its neighbors.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg?.scene) return;
    fg.scene().traverse((o: any) => {
      const id = o.userData?.nodeId;
      if (id == null) return;
      const lit = isLit(id);
      o.traverse((child: any) => {
        const mat = child.material;
        if (!mat) return;
        mat.transparent = true;
        mat.opacity = lit ? 1 : 0.12;
        if (mat.emissiveIntensity != null) mat.emissiveIntensity = lit ? 0.85 : 0.08;
      });
    });
  }, [activeId, adjacency]);

  // Fly to a node so it lands centered in the *visible* area at a consistent
  // zoom. We keep the current viewing angle (no jarring swing) and nudge the
  // look-target so the node clears whichever panel is open: a bottom sheet on
  // mobile, the right dock on desktop.
  const flyTo = (n: any) => {
    const fg = fgRef.current;
    if (!fg || !n || n.x == null) return;
    const D = 115; // consistent camera distance from the node
    const cam: THREE.Camera = fg.camera();
    const node = new THREE.Vector3(n.x, n.y, n.z ?? 0);

    let dir = new THREE.Vector3().subVectors(cam.position, node);
    if (dir.lengthSq() < 1e-3) dir.set(0, 0, 1);
    dir.normalize();
    const camPos = node.clone().addScaledVector(dir, D);

    // Offset the look-target (in screen space) so the node sits in clear sky.
    const target = node.clone();
    if (window.innerWidth <= 720) {
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(cam.quaternion);
      target.addScaledVector(down, D * 0.22); // look lower → node rides higher
    } else {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      target.addScaledVector(right, D * 0.2); // look right → node sits left of dock
    }

    // Don't fight the fly tween; lock the follow-cam on once it lands.
    followRef.current = null;
    followObjRef.current = null; // jumping to a node releases object-follow
    followKindRef.current = null;
    if (shouldCalmMotion()) {
      fg.cameraPosition({ x: camPos.x, y: camPos.y, z: camPos.z }, target, 0); // no swoop
      scheduleTimeout(() => { followRef.current = n.id; }, 60);
    } else {
      // Cinematic ARC: bend the path through a lifted waypoint (pushed outward from the
      // Sun + up) so the camera swoops in rather than sliding along a dead-straight line.
      // Two chained cameraPosition tweens approximate the curve, reusing the proven tween
      // (no custom rAF that could fight the render loop). Look at the node the whole way.
      const span = cam.position.distanceTo(camPos);
      const way = cam.position.clone().lerp(camPos, 0.5);
      const lift = span * 0.3;
      way.addScaledVector(way.clone().normalize(), lift); // arc away from the galaxy core
      way.y += lift * 0.45; // and a little up, for a swoop
      fg.cameraPosition({ x: way.x, y: way.y, z: way.z }, node, 440);
      scheduleTimeout(() => {
        fgRef.current?.cameraPosition({ x: camPos.x, y: camPos.y, z: camPos.z }, target, 640);
      }, 400);
      scheduleTimeout(() => { followRef.current = n.id; }, 1080);
    }
  };

  // Ripple a set of stars alight: staggered bursts across a sample, so a lens/system
  // visibly "comes on" as it's isolated. Reduced-motion-safe; bounded to keep it cheap.
  const lightUpSweep = (ids: number[], type = "synthesis") => {
    if (shouldCalmMotion() || ids.length === 0) return;
    const byId = nodeByIdRef.current;
    const sample = ids.slice(0, 6);
    sample.forEach((id, i) => {
      scheduleTimeout(() => {
        const n = byId.get(id);
        if (n?.x != null) burstsRef.current?.spawn(n.x, n.y, n.z ?? 0, type);
      }, 120 + i * 110);
    });
  };

  // Isolate a node's whole system + frame it (used by tap-to-isolate AND the
  // constellation-formed flourish). `celebrate` fires a gold burst at the hub.
  const doIsolateSystem = (id: number, celebrate = false) => {
    const sys = orbitsRef.current.getDescendants(id);
    setCluster(sys);
    followRef.current = null;
    followObjRef.current = null;
    followKindRef.current = null;
    scheduleTimeout(() => {
      frameGalaxy(900, (n: any) => sys.has(n.id));
    }, 80);
    scheduleTimeout(() => {
      followRef.current = id;
    }, 1050);
    // The system's members ripple alight as it isolates.
    lightUpSweep([...sys].filter((x) => x !== id), celebrate ? "harmonization" : "calibration");
    if (celebrate && !shouldCalmMotion()) {
      const byId = nodeByIdRef.current;
      const hub = byId.get(id);
      if (hub?.x != null) {
        const hubPos = new THREE.Vector3(hub.x, hub.y, hub.z ?? 0);
        // Gathering: streams flow from the members INWARD to the new hub, as if the
        // constellation is pulling itself together, then the hub flares as it names itself.
        const members = [...sys].filter((x) => x !== id).slice(0, 8);
        members.forEach((mid, i) => {
          scheduleTimeout(() => {
            const m = byId.get(mid);
            if (m?.x != null) {
              linkFormingRef.current?.fire(new THREE.Vector3(m.x, m.y, m.z ?? 0), hubPos, "rgba(255,220,150,1)");
            }
          }, i * 70);
        });
        // The hub flares as the streams arrive, then a soft settle burst.
        scheduleTimeout(() => burstsRef.current?.spawn(hubPos.x, hubPos.y, hubPos.z, "harmonization"), 520);
        scheduleTimeout(() => {
          const h = byId.get(id);
          if (h?.x != null) burstsRef.current?.spawn(h.x, h.y, h.z ?? 0, "synthesis");
        }, 1200);
      }
    }
  };
  // When a constellation forms (user promotes a hub), fly-to-isolate it once it lands in
  // the galaxy data. The id is stashed here by the brain-constellation-formed event and
  // consumed by the data-update effect below (the node doesn't exist until the refresh).
  const pendingHubRef = useRef<number | null>(null);
  useEffect(() => {
    const onFormed = (e: Event) => {
      const id = (e as CustomEvent).detail?.id;
      if (typeof id === "number") pendingHubRef.current = id;
    };
    window.addEventListener("brain-constellation-formed", onFormed);
    return () => window.removeEventListener("brain-constellation-formed", onFormed);
  }, []);

  // Snap to a flattering "best view" of the whole galaxy: a consistent cinematic
  // 3/4 angle (slightly above + to the side) framed to the galaxy's bounding
  // sphere, rather than zoomToFit's lock to whatever angle the camera drifted to.
  const frameGalaxy = (ms = 900, filter?: (n: any) => boolean, isIntro = false) => {
    const fg = fgRef.current;
    if (!fg) return;
    const pts = (dataRef.current.nodes as any[]).filter(
      (n) => n.x != null && !isNaN(n.x) && n.y != null && !isNaN(n.y) && (!filter || filter(n)),
    );
    if (pts.length === 0) {
      fg.zoomToFit(ms, 80, filter);
      return;
    }
    const center = new THREE.Vector3();
    for (const n of pts) center.add(new THREE.Vector3(n.x, n.y, n.z ?? 0));
    center.multiplyScalar(1 / pts.length);
    // Enclose the FURTHEST star (not the 85th percentile — that left the outer ~15% of
    // a grown galaxy sticking out of frame, which is exactly the "recenter doesn't fit"
    // bug). Fall back to the orbit system's own measured extent for safety.
    let radius = 1;
    for (const n of pts) radius = Math.max(radius, center.distanceTo(new THREE.Vector3(n.x, n.y, n.z ?? 0)));
    radius = Math.max(radius, orbitsRef.current.getRadius(), center.length() + SUN_RADIUS_MAX) * 1.06;
    const cam = fg.camera() as THREE.PerspectiveCamera;
    // Land UPRIGHT: clear any camera roll (e.g. left over from following the banking ship
    // or free-orbit gymnastics) so recenter is always right-side up.
    cam.up.set(0, 1, 0);
    { const c = fg.controls?.(); if (c) (c.object as THREE.Object3D).up.set(0, 1, 0); }
    const fov = ((cam.fov ?? 60) * Math.PI) / 180;
    // Guard a zero/invalid aspect (canvas not yet sized during the intro framing),
    // which would make hFit divide by sin(0) = Infinity. Clamp the aspect to a floor so a
    // TALL portrait phone can't shove the camera miles back just to fit the galaxy's width
    // (that's the "focus lands way too far out" bug) — we let the outermost stars sit a hair
    // past the side edges instead, so the galaxy actually FILLS the screen. Landscape/desktop
    // (aspect > 1) is unaffected since vFit dominates there.
    const rawAspect = cam.aspect && cam.aspect > 0 ? cam.aspect : 1;
    const aspect = Math.max(rawAspect, 0.62);
    // Fit by the tighter of vertical/horizontal FOV, with a little margin for labels/orbits.
    const vFit = radius / Math.sin(fov / 2);
    const hFit = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    const dist = Math.max(vFit, hFit) * 1.12;
    // Guarantee the ceiling admits this framing (a narrow portrait screen needs ~2× the
    // landscape distance). Raising it here + scaling scenery beyond means recenter ALWAYS
    // fits the full galaxy, at any aspect or size, instead of being clamped short.
    if (dist * 1.06 > maxDistRef.current) {
      maxDistRef.current = dist * 1.06;
      scaleSceneryRef.current();
    }
    const az = Math.PI * 0.22; // gentle yaw so it doesn't look dead-on
    const el = Math.PI * 0.2; // lift above the orbital plane for depth
    const dirv = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
    const camPos = center.clone().addScaledVector(dirv, dist);

    if (isIntro) {
      // Cinematic start: position camera far away, at a steep angle, rotated around the sun
      const startAz = az + Math.PI * 0.42; // offset yaw by ~75 degrees
      const startEl = Math.PI * 0.38;       // steeper elevation to look down
      const startDir = new THREE.Vector3(
        Math.cos(startEl) * Math.sin(startAz),
        Math.sin(startEl),
        Math.cos(startEl) * Math.cos(startAz)
      );
      const startPos = center.clone().addScaledVector(startDir, dist * 3.0);
      // Snap FAR away instantly (duration 0)…
      fg.cameraPosition({ x: startPos.x, y: startPos.y, z: startPos.z }, center, 0);

      // Lock user controls during the cinematic fly-in to keep it smooth.
      const controls = fg.controls?.();
      if (controls) {
        controls.enabled = false;
        scheduleTimeout(() => {
          controls.enabled = true;
        }, ms + 80);
      }

      // …then fly IN one frame later. Calling both cameraPositions in the same tick
      // makes react-force-graph tween from the camera's OLD spot (no swoop) — the
      // instant snap hasn't committed yet. Deferring lets the far start-pose land first,
      // so you actually see the long cinematic descent into the galaxy.
      scheduleTimeout(() => {
        fgRef.current?.cameraPosition({ x: camPos.x, y: camPos.y, z: camPos.z }, center, ms);
      }, 40);
      return;
    }

    fg.cameraPosition({ x: camPos.x, y: camPos.y, z: camPos.z }, center, ms);
  };

  // Activity per link, memoized with a ~1s TTL: SEVEN accessors call this per
  // link on every 250ms zoom refresh, each doing Date.now/Date.parse — on a few
  // hundred links that was thousands of parses per refresh for values that only
  // meaningfully change over hours.
  const linkActivityCacheRef = useRef<Map<string, { at: number; v: number }>>(new Map());
  const getLinkActivity = (l: any) => {
    const key = linkKey(l);
    const cached = linkActivityCacheRef.current.get(key);
    const nowMs = Date.now();
    if (cached && nowMs - cached.at < 1000) return cached.v;
    const v = computeLinkActivity(l, nowMs);
    const cache = linkActivityCacheRef.current;
    if (cache.size > 4000) cache.clear(); // bound long-session growth
    cache.set(key, { at: nowMs, v });
    return v;
  };
  
  // Minimal Link LOD: short-circuit expensive accessors for distant/inactive links.
  const shouldRenderLink = (l: any) => {
    const activity = getLinkActivity(l);
    const sId = linkEnd(l.source);
    const tId = linkEnd(l.target);
    const lit = activeId === null || (isLit(sId) && isLit(tId));
    
    // Always render if active or important (recently tended)
    if (lit || activity > 0.4) return true;

    // Otherwise, check distance
    const camera = fgRef.current?.camera();
    const dist = camera ? camera.position.length() : 1200;
    
    // Only render inactive/weak links if close
    return dist < 800;
  };

  const computeLinkActivity = (l: any, nowMs: number) => {
    // O(1) id→node lookup (rebuilt on each data change) — the link color/width/
    // curvature accessors call this per link on every refresh, so a .find() scan
    // here was O(links × nodes) and janked larger brains on mobile.
    const byId = nodeByIdRef.current;
    const sourceNode = byId.get(linkEnd(l.source));
    const targetNode = byId.get(linkEnd(l.target));
    if (!sourceNode || !targetNode) return 0;
    // The FRESHEST end lights the link — a `??` chain here let a stale source
    // timestamp shadow a just-tended target, so tending visibly did nothing.
    let act = 0;
    for (const timeStr of [
      sourceNode.lastTendedAt ?? sourceNode.createdAt,
      targetNode.lastTendedAt ?? targetNode.createdAt,
    ]) {
      if (!timeStr) continue;
      const ageMs = nowMs - Date.parse(timeStr);
      if (!Number.isNaN(ageMs)) act = Math.max(act, Math.exp(-ageMs / (3 * 24 * 3600 * 1000))); // 3-day decay
    }
    // A link Soumaya recently re-forged/repaired counts as fresh too (Phase 3:
    // links decay with neglect, then she revives them). Decays over ~3 days.
    const repaired = linkHealthRef.current.get(linkKey(l));
    if (repaired) act = Math.max(act, Math.exp(-(nowMs - repaired) / (3 * 24 * 3600 * 1000)));
    return act;
  };

  useImperativeHandle(
    ref,
    () => ({
      focusNode: (id: number) => flyTo((dataRef.current.nodes as any[]).find((x) => x.id === id)),
      recenter: () => {
        followRef.current = null; // release every follow-lock so we can frame all
        followObjRef.current = null;
        followKindRef.current = null;
        setCluster(null); // exit any isolated system view
        frameGalaxy(900);
      },
      zoomBy: (factor: number) => {
        const fg = fgRef.current;
        if (!fg) return;
        const cam = fg.camera() as THREE.PerspectiveCamera;
        const controls = fg.controls?.();
        if (!controls) return;
        const target = controls.target as THREE.Vector3;
        const offset = cam.position.clone().sub(target);
        const dist = offset.length();
        const following = followRef.current != null || followObjRef.current != null;
        const ceiling = maxDistRef.current;
        const NEAR = 120; // closest we dolly to a pivot before we start travelling

        if (following) {
          // Locked on a body → classic dolly toward/away from it (clamped).
          const min = controls.minDistance ?? 8;
          const len = Math.max(min, Math.min(ceiling, dist * factor));
          cam.position.copy(target.clone().add(offset.normalize().multiplyScalar(len)));
        } else if (factor < 1 && dist * factor < NEAR) {
          // Zooming in but already near the pivot → TRAVEL forward through space
          // (move the camera AND its look-pivot together) instead of stopping dead
          // at a wall. This is what makes free roaming feel continuous.
          const fwd = offset.clone().multiplyScalar(-1).normalize(); // camera → pivot
          let step = dist * (1 - factor);
          // Never dead-stop: instead of refusing the move when it would cross the
          // star-field shell, advance as FAR as the shell allows (ray↔sphere). Flying
          // inward/through is always full step; only travelling straight OUT at the very
          // edge yields ~0 (there's genuinely nothing beyond). Keeps roaming continuous.
          const p = cam.position;
          const b = p.dot(fwd);
          const c = p.lengthSq() - ceiling * ceiling;
          const disc = b * b - c; // ≥ 0 while inside the shell
          const tMax = disc > 0 ? -b + Math.sqrt(disc) : 0; // distance along fwd to the shell
          step = Math.max(0, Math.min(step, tMax));
          if (step > 0.01) {
            cam.position.addScaledVector(fwd, step);
            target.addScaledVector(fwd, step); // keep the pivot ahead of us
          }
        } else {
          // Normal dolly toward/away from the pivot, clamped to the star-field shell.
          const len = Math.max(NEAR, Math.min(ceiling, dist * factor));
          cam.position.copy(target.clone().add(offset.normalize().multiplyScalar(len)));
        }
        controls.update?.();
      },
      toggleFollowShip: (forceState?: boolean) => {
        const on = forceState !== undefined ? forceState : followKindRef.current !== "ship";
        followKindRef.current = on ? "ship" : null;
        followObjRef.current = on ? soumayaObjRef.current : null;
        followDistRef.current = 26;
        followSnapRef.current = on;
        followObjAnchored.current = false;
        if (on) followRef.current = null;
        return on;
      },
      levelShipView: () => {
        const fg = fgRef.current;
        if (!fg || !soumayaObjRef.current) return;
        const cam = fg.camera() as THREE.PerspectiveCamera;
        const controls = fg.controls?.();
        if (!controls) return;
        // Force a wide UPRIGHT external view, whatever the ship's current bank/roll.
        shipViewModeRef.current = "orbit";
        followKindRef.current = "ship";
        followObjRef.current = soumayaObjRef.current;
        followRef.current = null;
        const sp = soumayaObjRef.current.getWorldPosition(new THREE.Vector3());
        cam.up.set(0, 1, 0);
        (controls.object as THREE.Object3D).up.set(0, 1, 0);
        const d = 72; // comfortable wide framing
        followDistRef.current = d;
        // Behind + above along WORLD axes → guaranteed right-side up.
        cam.position.copy(sp).add(new THREE.Vector3(0, d * 0.5, d));
        controls.target.copy(sp);
        followObjAnchor.current.copy(sp);
        followObjAnchored.current = true;
        followSnapRef.current = false; // keep the pose we just set (don't re-snap off the ship's nose)
        followFlyUntilRef.current = 0; // track immediately (no lingering fly-in from a prior focus)
        controls.update?.();
      },
      reorderTasks: (newOrder: { id: string; type: string }[]) => {
        soumayaHandleRef.current?.reorderTasks(newOrder);
      },
      toggleFollowStation: () => {
        const on = followKindRef.current !== "station";
        followKindRef.current = on ? "station" : null;
        followObjRef.current = on ? stationObjRef.current : null;
        followDistRef.current = 700; // station is colossal — stand well back
        followSnapRef.current = on;
        followObjAnchored.current = false;
        if (on) followRef.current = null;
        return on;
      },
      toggleFollowFig1: () => {
        const on = followKindRef.current !== "fig1";
        followKindRef.current = on ? "fig1" : null;
        followObjRef.current = on ? fig1GroupRef.current : null;
        followDistRef.current = 4500;
        followSnapRef.current = on;
        followObjAnchored.current = false;
        if (on) followRef.current = null;
        return on;
      },
      toggleFollowFig2: () => {
        const on = followKindRef.current !== "fig2";
        followKindRef.current = on ? "fig2" : null;
        followObjRef.current = on ? fig2GroupRef.current : null;
        followDistRef.current = 4500;
        followSnapRef.current = on;
        followObjAnchored.current = false;
        if (on) followRef.current = null;
        return on;
      },
      cycleFollowSatellite: () => {
        const active = satellitesRef.current?.getActive() ?? [];
        if (active.length === 0) return false;
        // Advance to the next beacon each press (wraps around the fleet).
        const i = satFollowIndexRef.current % active.length;
        satFollowIndexRef.current = (i + 1) % active.length;
        followKindRef.current = "satellite";
        followObjRef.current = active[i]!.object;
        followDistRef.current = 30; // probes are small — sit in close
        followSnapRef.current = true;
        followObjAnchored.current = false;
        followRef.current = null;
        return true;
      },
      cycleFollowVisitor: () => {
        const active = visitorsRef.current?.getActive() ?? [];
        if (active.length === 0) return false;
        const i = visFollowIndexRef.current % active.length;
        visFollowIndexRef.current = (i + 1) % active.length;
        followKindRef.current = "visitor";
        followObjRef.current = active[i]!.object;
        followDistRef.current = 34; // craft are small — sit in fairly close
        followSnapRef.current = true;
        followObjAnchored.current = false;
        followRef.current = null;
        return true;
      },
      cycleFollowFleet: () => {
        const craft = subAgentsRef.current?.getCraft() ?? [];
        if (craft.length === 0) return false;
        const i = fleetFollowIndexRef.current % craft.length;
        fleetFollowIndexRef.current = (i + 1) % craft.length;
        followKindRef.current = "fleet";
        followObjRef.current = craft[i]!.object;
        followDistRef.current = 22; // fleet drones are small — sit in close
        followSnapRef.current = true;
        followObjAnchored.current = false;
        followRef.current = null;
        return true;
      },
      isolateSystem: (id: number) => doIsolateSystem(id),
      exitCluster: () => {
        setCluster(null);
        followRef.current = null;
        // Restore the contextual overlay layers hidden during a focused/category view.
        if (sceneryRef.current.moneysky) sceneryRef.current.moneysky.visible = true;
        if (sceneryRef.current.journeyhubs) sceneryRef.current.journeyhubs.visible = true;
        frameGalaxy(800);
      },
      isolateSet: (ids: number[]) => {
        // A Smart Lens: show only the matching bodies (dim/hide the rest) and frame
        // them. Reuses the isolate-system cluster machinery with an arbitrary set.
        const set = new Set(ids);
        setCluster(set);
        // While viewing a slice (category view / lens), drop the extra sprite overlays
        // (money-sky + journey hubs) — fewer draw calls on a weak phone; restored on exit.
        if (sceneryRef.current.moneysky) sceneryRef.current.moneysky.visible = false;
        if (sceneryRef.current.journeyhubs) sceneryRef.current.journeyhubs.visible = false;
        followRef.current = null;
        followObjRef.current = null;
        followKindRef.current = null;
        if (set.size > 0) {
          scheduleTimeout(() => frameGalaxy(900, (n: any) => set.has(n.id)), 80);
          lightUpSweep(ids, "calibration"); // the lens' stars ripple alight as it opens
        }
      },
      isolateLayer: (layer: "money" | "journeys") => {
        setCluster(new Set()); // hide all memory bodies
        followRef.current = null;
        followObjRef.current = null;
        followKindRef.current = null;
        const money = layer === "money";
        const s = sceneryRef.current;
        if (s.moneysky) s.moneysky.visible = money;
        if (s.journeyhubs) s.journeyhubs.visible = !money;
        // Frame the chosen overlay ring by its bounding sphere.
        const grp = money ? s.moneysky : s.journeyhubs;
        const fg = fgRef.current;
        const cam = fg?.camera?.() as THREE.PerspectiveCamera | undefined;
        if (grp && fg && cam) {
          const sphere = new THREE.Box3().setFromObject(grp).getBoundingSphere(new THREE.Sphere());
          if (sphere.radius > 0) {
            const fov = ((cam.fov ?? 60) * Math.PI) / 180;
            const dist = (sphere.radius / Math.sin(fov / 2)) * 1.15;
            const dir = new THREE.Vector3(0.3, 0.45, 1).normalize();
            const pos = sphere.center.clone().addScaledVector(dir, dist);
            fg.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, { x: sphere.center.x, y: sphere.center.y, z: sphere.center.z }, 900);
          }
        }
      },
      spawnBurst: (id: number, type = "user") => {
        const n = (dataRef.current.nodes as any[]).find((x) => x.id === id);
        if (n && n.x != null) {
          burstsRef.current?.spawn(n.x, n.y, n.z ?? 0, type);
        }
      },
      celebrate: () => {
        if (shouldCalmMotion()) return;
        const c = sunRef.current?.position ?? new THREE.Vector3();
        // A ring of alternating gold/amber bursts fanning out around the Sun.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          scheduleTimeout(() => {
            burstsRef.current?.spawn(
              c.x + Math.cos(a) * 340,
              c.y + Math.sin(a * 2) * 140,
              c.z + Math.sin(a) * 340,
              i % 2 ? "fuel" : "harmonization",
            );
          }, i * 110);
        }
      },
      hailSoumaya: (message: string) => {
        soumayaHandleRef.current?.hail?.(message);
      },
      replayEvents: (items: { id: number; label: string }[]) => {
        soumayaHandleRef.current?.enqueueReplays?.(items);
      },
      fireRecall: (ids: number[]) => {
        const f = fgRef.current;
        if (!f?.emitParticle) return;
        if (ids.length === 0) return;

        // Build adjacency graph
        // Map: nodeId -> array of { neighborId, link }
        const adj = new Map<number, Array<{ neighborId: number; link: any }>>();
        for (const l of dataRef.current.links as any[]) {
          const s = linkEnd(l.source);
          const t = linkEnd(l.target);
          
          if (!adj.has(s)) adj.set(s, []);
          if (!adj.has(t)) adj.set(t, []);
          
          adj.get(s)!.push({ neighborId: t, link: l });
          adj.get(t)!.push({ neighborId: s, link: l });
        }

        // Determine the seed (source) node for the path.
        // If the LIVE active node is in the graph, use it. Otherwise the first cited id.
        const allNodes = dataRef.current.nodes as any[];
        const liveActive = activeIdRef.current;
        let seed: number = ids[0]!;
        if (liveActive !== null && allNodes.some(n => n.id === liveActive)) {
          seed = liveActive;
        }

        // Run BFS from seed to find shortest path parent pointers
        const parent = new Map<number, { parentId: number; link: any }>();
        const queue: number[] = [seed];
        const visited = new Set<number>([seed]);

        while (queue.length > 0) {
          const curr = queue.shift()!;
          const neighbors = adj.get(curr) || [];
          for (const n of neighbors) {
            if (!visited.has(n.neighborId)) {
              visited.add(n.neighborId);
              parent.set(n.neighborId, { parentId: curr, link: n.link });
              queue.push(n.neighborId);
            }
          }
        }

        // For each cited node, reconstruct the path from seed and fire particles sequentially
        for (const targetId of ids) {
          if (targetId === seed) {
            const n = allNodes.find((x) => x.id === seed);
            if (n && n.x != null) {
              burstsRef.current?.spawn(n.x, n.y, n.z ?? 0, "synthesis");
            }
            continue;
          }

          const pathLinks: any[] = [];
          let curr = targetId;
          while (parent.has(curr)) {
            const p = parent.get(curr)!;
            pathLinks.unshift(p.link); // trace order: seed -> ... -> targetId
            curr = p.parentId;
          }

          if (pathLinks.length > 0) {
            // Emit particles sequentially down the path.
            pathLinks.forEach((link, index) => {
              scheduleTimeout(() => {
                try {
                  f.emitParticle(link);
                  scheduleTimeout(() => {
                    try {
                      f.emitParticle(link);
                    } catch {}
                  }, 80);
                } catch {}
              }, index * 220);
            });

            // After the path completes, spawn a visual burst at the target node
            const targetNode = allNodes.find((x) => x.id === targetId);
            if (targetNode && targetNode.x != null) {
              scheduleTimeout(() => {
                try {
                  if (targetNode.x != null) {
                    burstsRef.current?.spawn(targetNode.x, targetNode.y, targetNode.z ?? 0, "synthesis");
                  }
                } catch {}
              }, pathLinks.length * 220 + 350);
            }
          } else {
            // Fallback: no path found, spawn a burst directly
            const targetNode = allNodes.find((x) => x.id === targetId);
            if (targetNode && targetNode.x != null) {
              burstsRef.current?.spawn(targetNode.x, targetNode.y, targetNode.z ?? 0, "synthesis");
            }
          }
        }
      },
      getFleetStatus: (): FleetStatus => {
        const labelOf = (nid: number) =>
          (dataRef.current.nodes as any[]).find((n) => n.id === nid)?.label ?? `#${nid}`;
        const active = satellitesRef.current?.getActive() ?? [];
        const pending = satellitesRef.current?.getPendingDispatches() ?? [];
        const sub = subAgentsRef.current?.getStatus() ?? [];
        const status: FleetStatus = {
          ship: { active: true, detail: "On her rounds" },
          station: { active: true, detail: "Holding orbit" },
          beacon: {
            active: active.length > 0,
            detail:
              pending.length > 0
                ? `Dispatching ${pending.length}…`
                : active.length > 0
                  ? `${active.length} warming ${active.length === 1 ? "a memory" : "memories"}`
                  : "None deployed",
            targets: active.map((a) => ({ id: a.targetId, label: labelOf(a.targetId) })),
            pending: pending.length,
          },
        };
        for (const s of sub) {
          status[s.id] = {
            active: s.active,
            detail: s.detail,
            targets: s.targetId != null ? [{ id: s.targetId, label: s.targetLabel ?? labelOf(s.targetId) }] : [],
          };
        }
        return status;
      },
    }),
    [data],
  );

  const renderCountRef = useRef(0);
  const instanceIdRef = useRef(Math.random().toString(36).slice(2, 9));
  useEffect(() => {
    renderCountRef.current++;
    console.log(`[Graph3D] Render: ${renderCountRef.current}, Instance: ${instanceIdRef.current}`);
  });
  useEffect(() => {
    console.log(`[Graph3D] Mount: ${instanceIdRef.current}`);
    return () => console.log(`[Graph3D] Unmount: ${instanceIdRef.current}`);
  }, []);

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data as any}
      backgroundColor={BG}
      showNavInfo={false}
      warmupTicks={0}
      cooldownTicks={9999999}
      cooldownTime={9999999}
      nodeVisibility={(n: any) => !cluster || cluster.has(n.id)}
      linkVisibility={(l: any) => {
        // Isolate-system view filters to the selected cluster.
        if (cluster) return cluster.has(linkEnd(l.source)) && cluster.has(linkEnd(l.target));
        // LEVEL-OF-DETAIL: on a DENSE brain, drawing every faint filament at macro zoom
        // is what makes a big galaxy lag on a phone. So when there are many links AND the
        // camera is pulled back, draw only the STRONGER / actively-tended connections;
        // zoom in past LINK_LOD_ZOOM and every link returns. Small graphs draw everything.
        const total = dataRef.current.links.length;
        if (total <= LINK_LOD_MIN) return true;
        const camera = fgRef.current?.camera();
        const dist = camera ? camera.position.length() : 1200;
        if (dist < LINK_LOD_ZOOM) return true; // zoomed in: full detail
        const strength = (l.weight ?? 0.4) + getLinkActivity(l);
        return strength >= LINK_LOD_CUTOFF;
      }}
      nodeThreeObject={(node: any) => {
        const cacheKey = `${node.label}_${node.importance}_${node.degree}_${node.entropy}_${node.color || ""}_${node.kind}`;
        const cached = nodeThreeObjCacheRef.current.get(node.id);
        let obj;
        if (cached && cached.key === cacheKey) {
          obj = cached.obj;
        } else {
          if (cached) disposeObject3D(cached.obj); // free the superseded build's VRAM
          obj = makeNodeObject(node);
          nodeThreeObjCacheRef.current.set(node.id, { obj, key: cacheKey });
        }
        return obj;
      }}
      nodeLabel={(n: any) => {
        const proc = isNodeProcessing(n.id) ? " ⚙️ (Writing...)" : "";
        return `${n.label}${proc} · ${String(n.type).replace(/_/g, " ")}`;
      }}
      onNodeClick={(n: any) => {
        logDiagnosticEvent('callback', 'Graph3D.onNodeClick', { nodeId: n.id });
        onSelect(n);
        // Instant tap feedback: a soft ripple right on the body you clicked, so the
        // selection registers visually the moment you tap (before the fly-to lands).
        if (!shouldCalmMotion() && n?.x != null) burstsRef.current?.spawn(n.x, n.y, n.z ?? 0, "user");
        flyTo(n);
      }}
      onNodeHover={(n: any) => setHoverId(n ? n.id : null)}
      // Connections read as faint gravitational filaments; the relationship is
      // carried by streams of drifting "space dust" rather than solid lines.
      // Curvature and opacity are biased by activity (recent tending) and zoom distance.
      linkColor={(l: any) => {
        if (!shouldRenderLink(l)) return "rgba(0,0,0,0)";
        // Connections are living synapses: they REST in a colour set by the emotion of
        // the two memories (green = neutral/positive spark, gold = joyful/warm, indigo =
        // heavy) and flare BRIGHT when Soumaya pulses them (recent activity), easing back
        // over ~3 days. They never turn grey and never disappear.
        const byId = nodeByIdRef.current;
        const s = byId.get(linkEnd(l.source));
        const t = byId.get(linkEnd(l.target));
        const ew = ((s?.emotionalWeight ?? 0) + (t?.emotionalWeight ?? 0)) / 2;
        // The scene-wide emotion palette (theme.ts) — gold joyful, indigo heavy,
        // synapse green neutral.
        let [r, g, b] = EMOTION_RGB[emotionKind(ew)];
        const activity = getLinkActivity(l); // 0..1, spikes right after she pulses it
        const lit = activeId === null || (isLit(linkEnd(l.source)) && isLit(linkEnd(l.target)));
        // A fresh pulse only brightens toward white a LITTLE (≤40%), so the line still
        // GLOWS IN ITS OWN COLOUR (a joyful link glows gold, not white) — the fat width
        // carries the bloom. Eases back over ~3 days.
        const flash = Math.min(0.4, activity * 0.45);
        r = Math.round(r + (255 - r) * flash);
        g = Math.round(g + (255 - g) * flash);
        b = Math.round(b + (255 - b) * flash);
        // Always clearly visible: strong floor, brighter when active, gently dimmed (but
        // same hue) when another memory is focused.
        let opacity = 0.55 + activity * 0.4;
        if (!lit) opacity = 0.32;
        return `rgba(${r}, ${g}, ${b}, ${Math.min(1, opacity).toFixed(2)})`;
      }}
      linkWidth={(l: any) => {
        if (!shouldRenderLink(l)) return 0;
        // The LINE itself is the glow. A tended connection swells into a fat, bright
        // tube (quadratic in activity, so the bloom pass lights it up), then thins back
        // to a clean resting filament over ~3 days. Cold links stay slim but visible.
        const activity = getLinkActivity(l);
        return 0.7 + (l.weight ?? 0.4) * 0.9 + activity * activity * 5;
      }}
      linkCurvature={(l: any) => {
        const activity = getLinkActivity(l);
        const camera = fgRef.current?.camera();
        const dist = camera ? camera.position.length() : 1200;
        
        // At macro zoom (> 800 distance), links curve significantly with organic wavy variance per link
        if (dist > 800) {
          const linkSeed = l.id || 0;
          const baseCurvature = 0.25 + (Math.abs(Math.sin(linkSeed * 1.7)) * 0.15);
          return baseCurvature + activity * 0.18;
        }
        
        return 0.12 + activity * 0.16; // active lines wander/curve more organically
      }}
      // Knowledge packets: only a few dots, and only while real info is actually
      // flowing — i.e. right after Soumaya tends a link (very high activity). The GLOW
      // (above) is the persistent signal; the dots are the occasional "data in transit".
      linkDirectionalParticles={(l: any) => {
        const a = getLinkActivity(l);
        if (a > 0.75) return 2; // she's actively working this connection right now
        if (a > 0.45) return 1;
        return 0; // resting — the glow carries the meaning, no packets
      }}
      linkDirectionalParticleSpeed={(l: any) => 0.004 + (l.weight ?? 0.4) * 0.004 + getLinkActivity(l) * 0.006}
      linkDirectionalParticleWidth={(l: any) => 1.4 + (l.weight ?? 0.4) * 1.8 + getLinkActivity(l) * 2.2}
      linkDirectionalParticleColor={(l: any) => {
        // Match the synapse's emotion hue, flaring toward white right after a pulse.
        const byId = nodeByIdRef.current;
        const s = byId.get(linkEnd(l.source));
        const t = byId.get(linkEnd(l.target));
        const ew = ((s?.emotionalWeight ?? 0) + (t?.emotionalWeight ?? 0)) / 2;
        // Same palette as the line, pre-brightened a touch (packets read lighter).
        let [r, g, b] = EMOTION_RGB[emotionKind(ew)].map((c) => Math.min(255, c + 25)) as [number, number, number];
        const flash = Math.min(0.45, getLinkActivity(l) * 0.5);
        r = Math.round(r + (255 - r) * flash);
        g = Math.round(g + (255 - g) * flash);
        b = Math.round(b + (255 - b) * flash);
        return `rgba(${r}, ${g}, ${b}, 0.95)`;
      }}
    />
  );
});
