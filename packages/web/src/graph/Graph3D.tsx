import {
  forwardRef,
  useCallback,
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
import { LINK_LOD_MIN, LINK_LOD_ZOOM, LINK_LOD_CUTOFF, linkEnd, linkKey, updateFigurine, disposeObject3D, isNodeCacheEntryValid, shouldApplyPixelRatio, highlightMaterialState, computeGlowFar, pickNearestIds } from "./graph3dHelpers.js";
import { CurvedLinkGeometryCache, type LinkPositions } from "./linkTube.js";
import { getGalaxyDiagConfig, shouldHideNodeChild, mountGalaxyDiagOverlay, type GalaxyDiagConfig } from "./perfDiag.js";
import { isSweepActive, getSweepDiagConfig, getSweepNodeBodyConfig, recordSweepMeasurement, SWEEP_WARMUP_MS, SWEEP_MEASURE_MS } from "./galaxySweep.js";
import { shouldHideNodeBodyChild, DEFAULT_NODE_BODY_DIAG, type NodeBodyDiagConfig } from "./nodeBodyDiag.js";
import { isComposerBypassEnabled, applyComposerBypass, setComposerBypassLive } from "./composerBypassDiag.js";
import {
  installComposerTrace,
  installRenderPassTrace,
  getLatestComposerMs,
  getLatestRenderPassMs,
  getPassesInLastComposerFrame,
} from "./renderStageTrace.js";
import { noteRefreshInvoked, registerSnapshotCapture, getRefreshCallsInWindow, type GalaxyDiagSnapshot } from "./galaxyStateSnapshot.js";
import {
  buildRunPlan,
  computeVerdict,
  registerAutoDiagRunner,
  reportAutoDiagProgress,
  AUTO_DIAG_WARMUP_MS,
  AUTO_DIAG_MEASURE_MS,
  type AutoDiagConditionKey,
  type AutoDiagRunner,
  type AutoDiagStepResult,
} from "./autoRenderDiag.js";
import { selectDetailedLinks, isBoundedLinksEnabled, getDetailedLinkBudget, type LinkSelectionInput } from "./renderModel.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { GraphData, GraphNode } from "@brain/shared";
import { makeNodeObject, nodeVisualCacheKey, releaseNodeTextures, setSectorTitleMassThreshold, sectorTitleThresholdFor } from "./nodeObject.js";
import { makeStarfield, makeGalaxies, makeMilkyWay } from "./starfield.js";
import { makeConstellations } from "./skybox.js";
import { makeDeepSpace, makeBackdropBakeSources, DEEP_SPACE_BASE } from "./deepSpace.js";
import { bakeBackdrop, disposeBakedBackdrop, type BakedBackdrop } from "./backdropBake.js";
import { beginTick, endTick, attachRenderer, markMoved, reset as resetPerfStats, snapshot as perfSnapshot, registerGalaxyCounts, getRendererPixelRatio } from "./perfStats.js";
import { applyRenderRateCap } from "./renderRateCap.js";
import { makeMoneySky, MONEY_SKY_BASE } from "./moneySky.js";
import { getMoneySky } from "../api/finance.js";
import { makeJourneyHubs, JOURNEY_HUBS_BASE } from "./journeyHubs.js";
import { getJourneys } from "../api/journeys.js";
import { addBloom } from "./bloom.js";
import { resolveGraphics, getGraphics, detectTier, type ResolvedGraphics } from "./graphicsConfig.js";
import {
  RUNG_TABLE,
  MAX_RUNG,
  initialState as initialAdaptiveState,
  step as adaptiveStep,
  seedRungFromTier,
  loadPersistedRung,
  savePersistedRung,
  ADAPTIVE_MODEL_VERSION,
  type AdaptiveState,
} from "./adaptiveController.js";
import { makeCollisionBursts, makeLinkForming } from "./effects.js";
import { shouldCalmMotion } from "./motion.js";
import { makeSoumaya, type SoumayaHandle, type LinkTask, type RemovalTask } from "./soumaya.js";
import { makeEngineAudio } from "./engineAudio.js";
import { makeSpaceStation } from "./spaceStation.js";
import { gltfLoader, ensureKtx2Support } from "./gltf.js";
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
  /** Frame the camera on a single Journey hub or Money-sky star (Maya Intelligence Part I3) —
   *  a one-shot, non-follow-locking fly (modeled on `isolateLayer`'s bounding-sphere framing,
   *  not `flyTo`'s memory-node follow-lock, since a journey/bill/goal id lives in a DIFFERENT
   *  id space than memory node ids and must never be compared against `followRef`). Returns
   *  false when the body isn't currently in the scene (e.g. its overlay ring is hidden). */
  flyToGalaxyEntity: (kind: "journey" | "bill" | "goal", id: number) => boolean;
}

interface Props {
  data: GraphData;
  onSelect: (node: GraphNode) => void;
  onSoumayaClick?: () => void;
  /** Fires when a Journey hub or Money-sky star is clicked (Maya Intelligence Part I3) —
   *  these are plain overlay scenery, not force-graph "nodes", so they need their own
   *  raycast the way `onSoumayaClick` already does for the ship. */
  onGalaxyEntityClick?: (kind: "journey" | "bill" | "goal", id: number) => void;
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
    onGalaxyEntityClick,
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
  // Galaxy Performance Isolation Mode (TEMPORARY diagnostic — see perfDiag.ts). Reads
  // `?galaxyDiag=1&...` once (cached in that module), so `diag.enabled` is false and
  // every category defaults to true unless the URL explicitly turns diagnostic mode
  // on — every call site below is a no-op change in that default case. A render-
  // isolation sweep in progress (galaxySweep.ts — the no-URL-typing, Settings-button
  // alternative for a device that can't edit the address bar) takes priority when
  // active, driving the same underlying category flags across a sequence of page
  // reloads instead of a single manually-typed URL.
  const diag = getSweepDiagConfig() ?? getGalaxyDiagConfig();
  // Node-body sub-isolation (forensic trace follow-up, nodeBodyDiag.ts) — a SEPARATE
  // config from `diag` above, only ever driven by the sweep's `kind: "nodeBody"` steps
  // (URL params never set this; there's no manual equivalent, matching this being a
  // forensic-only addition rather than a general-purpose diagnostic surface).
  const nodeBodyDiag = getSweepNodeBodyConfig() ?? DEFAULT_NODE_BODY_DIAG;
  // Automated in-session diagnostic harness (autoRenderDiag.ts) — the ONLY thing that
  // ever sets these, mid-session, with no reload. Unlike `diag`/`nodeBodyDiag` above
  // (deliberately read once at mount — see their own comments), the harness needs to
  // flip categories on and off repeatedly within ONE page load, since a reload-based
  // sweep re-frames the camera and resets JIT/thermal state between every condition,
  // which is exactly what made the earlier reload-based sweep's results non-monotonic.
  // `null` (the default, every normal page load) means "no override" — see
  // isDiagForceHidden below for why that keeps the normal path fully allocation-free.
  const liveDiagOverrideRef = useRef<Partial<GalaxyDiagConfig> | null>(null);
  const liveNodeBodyOverrideRef = useRef<Partial<NodeBodyDiagConfig> | null>(null);
  // Combines both diagnostic mechanisms' force-hide decisions for one child — used at
  // every call site that previously checked only `diag.enabled && shouldHideNodeChild`,
  // so a node-body sub-isolation step (nodeBodyDiag.enabled) hides its target the same
  // way an ordinary perfDiag category does, without changing perfDiag's own behavior.
  // The live-override merge only allocates while the automated harness is actively
  // running (both refs non-null) — every normal page load takes the exact same
  // zero-allocation path this always has.
  const isDiagForceHidden = (child: THREE.Object3D): boolean => {
    const dOverride = liveDiagOverrideRef.current;
    const effDiag = dOverride ? { ...diag, ...dOverride } : diag;
    const nbOverride = liveNodeBodyOverrideRef.current;
    const effNodeBody = nbOverride ? { ...nodeBodyDiag, ...nbOverride } : nodeBodyDiag;
    return (
      (effDiag.enabled && shouldHideNodeChild(child, effDiag)) ||
      (effNodeBody.enabled && shouldHideNodeBodyChild(child, effNodeBody))
    );
  };
  // Phase 2.1 bounded Detailed-link selection (soumaya-galaxy-bounded-render-
  // architecture.md). Both read a cached URL param once per page load (same pattern as
  // `diag` above); `boundedLinksOn` defaults to false, so this whole feature is inert
  // unless a real-device A/B test explicitly opts in via `?boundedLinks=1`.
  const boundedLinksOn = isBoundedLinksEnabled();
  const detailedLinkBudget = getDetailedLinkBudget();

  // Render-isolation sweep measurement (galaxySweep.ts). If a sweep is mid-flight, this
  // page load's `diag` config above already has exactly one category (or none, for the
  // baseline step) hidden. After a warmup window (let the scene finish its own deferred/
  // idle-callback construction so an early step isn't penalized by one-time load cost)
  // plus a measurement window, take a real perfStats sample and hand it to
  // recordSweepMeasurement — which either reloads onto the next step or, on the last
  // step, finalizes the report. Entirely inert (returns immediately) when no sweep is
  // running, which is every normal page load.
  useEffect(() => {
    if (!isSweepActive()) return;
    let cancelled = false;
    let measureTimer: number | undefined;
    const warmupTimer = window.setTimeout(() => {
      if (cancelled) return;
      resetPerfStats();
      measureTimer = window.setTimeout(() => {
        if (cancelled) return;
        const snap = perfSnapshot();
        recordSweepMeasurement({
          presentP50: snap.present.p50,
          presentP95: snap.present.p95,
          renderP50: snap.render.p50,
          tickP50: snap.tick.p50,
          drawCalls: snap.drawInfo?.calls ?? null,
          programs: snap.programs,
          programsChurnCount: snap.programsChurnCount,
          transparentObjects: snap.galaxyCounts?.transparentObjects ?? null,
        });
      }, SWEEP_MEASURE_MS);
    }, SWEEP_WARMUP_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(warmupTimer);
      if (measureTimer !== undefined) window.clearTimeout(measureTimer);
    };
  }, []);
  // Automated in-session render-stall diagnostic (autoRenderDiag.ts). Registers the
  // actual stepping logic — building the randomized run plan, applying each condition
  // LIVE via the refs above (no reload, no camera move, same warmed-up JS/thermal
  // state throughout, see that file's module doc for why this replaces the earlier
  // reload-based sweep), measuring, and restoring everything to how it was before the
  // run started. Registration itself costs nothing until someone actually calls
  // `runAutoDiag()` from Settings.
  useEffect(() => {
    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const applyCondition = (
      key: AutoDiagConditionKey,
      composer: { render: (dt?: number) => void } | undefined,
      renderer: THREE.WebGLRenderer,
      sceneObj: THREE.Scene,
      cameraObj: THREE.Camera,
    ) => {
      // Every condition starts from the same clean slate — "everything on, composer
      // normal" — then layers its one change on top, so conditions never compound.
      liveDiagOverrideRef.current = { enabled: false };
      liveNodeBodyOverrideRef.current = { enabled: false };
      if (composer) setComposerBypassLive(composer, renderer, sceneObj, cameraObj, false);

      switch (key) {
        case "baseline":
          break; // the clean slate above IS the baseline
        case "composerBypass":
          if (composer) setComposerBypassLive(composer, renderer, sceneObj, cameraObj, true);
          break;
        case "nodeCoreMesh":
          liveNodeBodyOverrideRef.current = { enabled: true, coreMesh: false, rings: true, glowSprites: true, asteroidBelt: true, macro: true };
          break;
        case "nodeRings":
          liveNodeBodyOverrideRef.current = { enabled: true, coreMesh: true, rings: false, glowSprites: true, asteroidBelt: true, macro: true };
          break;
        case "nodeGlowSprites":
          liveNodeBodyOverrideRef.current = { enabled: true, coreMesh: true, rings: true, glowSprites: false, asteroidBelt: true, macro: true };
          break;
        case "nodeAsteroidBelt":
          liveNodeBodyOverrideRef.current = { enabled: true, coreMesh: true, rings: true, glowSprites: true, asteroidBelt: false, macro: true };
          break;
        case "nodeMacro":
          liveNodeBodyOverrideRef.current = { enabled: true, coreMesh: true, rings: true, glowSprites: true, asteroidBelt: true, macro: false };
          break;
      }
    };

    const run: AutoDiagRunner = async () => {
      const startedAt = Date.now();
      const fgNow = fgRef.current;
      const renderer = fgNow?.renderer?.() as THREE.WebGLRenderer | undefined;
      const sceneObj = fgNow?.scene?.() as THREE.Scene | undefined;
      const cameraObj = fgNow?.camera?.() as THREE.Camera | undefined;
      const composer = fgNow?.postProcessingComposer?.() as { render: (dt?: number) => void } | undefined;
      // The persisted Settings choice — restored at the end regardless of what this
      // run does mid-flight, so the harness never leaves the app in a different
      // steady state than the user had chosen before pressing the button.
      const persistedComposerBypass = isComposerBypassEnabled();

      const plan = buildRunPlan();
      const steps: AutoDiagStepResult[] = [];

      try {
        for (let i = 0; i < plan.length; i++) {
          const cond = plan[i]!;
          reportAutoDiagProgress(cond.label, i + 1, plan.length);
          if (renderer && sceneObj && cameraObj) {
            applyCondition(cond.key, composer, renderer, sceneObj, cameraObj);
          }
          await sleep(AUTO_DIAG_WARMUP_MS);
          resetPerfStats();
          await sleep(AUTO_DIAG_MEASURE_MS);
          const snap = perfSnapshot();
          steps.push({
            key: cond.key,
            label: cond.label,
            isBaseline: cond.key === "baseline",
            index: i,
            sample: {
              renderP50: snap.render.p50,
              renderP95: snap.render.p95,
              presentP50: snap.present.p50,
              tickP50: snap.tick.p50,
              drawCalls: snap.drawInfo?.calls ?? null,
              triangles: snap.drawInfo?.triangles ?? null,
              programs: snap.programs,
              programsChurnCount: snap.programsChurnCount,
              transparentObjects: snap.galaxyCounts?.transparentObjects ?? null,
              dpr: getRendererPixelRatio(),
            },
          });
        }
      } finally {
        // Always restore, even if the run threw or the tab was hidden mid-run —
        // never leave the app parked in a diagnostic condition.
        liveDiagOverrideRef.current = null;
        liveNodeBodyOverrideRef.current = null;
        if (composer && renderer && sceneObj && cameraObj) {
          setComposerBypassLive(composer, renderer, sceneObj, cameraObj, persistedComposerBypass);
        }
      }

      return { steps, verdict: computeVerdict(steps), startedAt, finishedAt: Date.now() };
    };

    registerAutoDiagRunner(run);
    return () => registerAutoDiagRunner(null);
  }, []);
  // The currently-selected Detailed-tier link set, or null when bounded selection is
  // off/not yet computed — `linkVisibility` below falls back to today's exact unbounded
  // behavior whenever this is null, so the feature is fully inert by default. Recomputed
  // only on explicit events (see `recomputeDetailedLinksRef` below), never per frame.
  const detailedLinkIdsRef = useRef<Set<string> | null>(null);
  // `recomputeDetailedLinks` itself is defined much further down (it needs
  // `getLinkActivity`/`nodeByIdRef`, both declared later in this large component) — the
  // effects below call through this ref rather than the function directly so their
  // position in the file doesn't matter: the ref is reassigned to the real function on
  // every render, well before React actually RUNS any effect after that render commits.
  const recomputeDetailedLinksRef = useRef<() => void>(() => {});
  const [hoverId, setHoverId] = useState<number | null>(null);
  // Populate-path repair D2 (docs/repairs/galaxy-populate-render-stall.md): bumping this
  // state re-renders Graph3D so the unmemoized `linkColor` accessor re-fires through
  // three-forcegraph's cheap per-render digest — the replacement for the old
  // `fg.refresh()` call in `fireLink`, which set `_flushObjects` and tore down +
  // rebuilt the entire galaxy on every link pulse.
  const [, setPulseTick] = useState(0);
  // When set, only these node ids (a memory + its orbiting system) are shown.
  const [cluster, setCluster] = useState<Set<number> | null>(null);
  // Mirror the cluster into a ref so the render loop can scope Soumaya + the fleet to the
  // VISIBLE bodies only (she shouldn't fly off to tend things hidden by a lens/category view).
  const clusterRef = useRef<Set<number> | null>(null);
  useEffect(() => {
    clusterRef.current = cluster;
    recomputeDetailedLinksRef.current();
  }, [cluster]);
  // Hover wins; otherwise the selected node drives the highlight (mobile = no hover).
  const activeId = hoverId ?? selectedId ?? null;
  // Ref mirror for callbacks captured once (the imperative handle only rebuilds on
  // [data], so reading `activeId` there directly recalled from a stale selection).
  const activeIdRef = useRef<number | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
    recomputeDetailedLinksRef.current();
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
  // Reused curved-link tube geometries (linkTube.ts) — see linkPositionUpdateCb below.
  const curvedLinkGeometryRef = useRef(new CurvedLinkGeometryCache());
  const orbitsRef = useRef(makeOrbitSystem());
  useEffect(() => {
    dataRef.current = data;
    const liveIds = new Set((data.nodes as any[]).map((n) => n.id));
    for (const [id, entry] of nodeThreeObjCacheRef.current) {
      if (!liveIds.has(id)) {
        // Stage 7: release this node's claim on any shared label/glow textures BEFORE
        // disposeObject3D runs (order doesn't matter functionally — they touch disjoint
        // resources — but releasing first keeps the "this object is going away, account
        // for everything it referenced" intent in one clear place).
        releaseNodeTextures(entry.obj);
        disposeObject3D(entry.obj); // free VRAM for deleted nodes
        nodeThreeObjCacheRef.current.delete(id);
      }
    }
    const prevById = nodeByIdRef.current; // last frame's nodes (for detecting deletions)
    nodeByIdRef.current = new Map((data.nodes as any[]).map((n: any) => [n.id, n]));
    // Phase 2.1: the graph data itself changed, so the Detailed-link selection (if the
    // bounded-links flag is on) needs to be recomputed against the new node/link set.
    recomputeDetailedLinksRef.current();
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
        noteRefreshInvoked(); // diagnostic-only — see galaxyStateSnapshot.ts
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
  // Stage 6: the adaptive controller's live state (rung, streaks, ceiling). Lives in a
  // plain ref, not React state — it's sampled/updated on a 2s cadence inside the tick
  // loop, not something the render tree needs to react to.
  const adaptiveStateRef = useRef<AdaptiveState | null>(null);
  // The last pixelRatio value actually applied to the renderer. `setPixelRatio()` has no
  // internal early-out (it unconditionally resizes the WebGL drawing buffer), so every
  // call site that hot-applies a rung/settings change must gate on this instead of
  // assuming "the rung changed" implies "the effective pixel ratio changed" — see
  // `shouldApplyPixelRatio` (graph3dHelpers.ts).
  const lastAppliedPixelRatioRef = useRef<number | null>(null);
  // Stage 4 light pool: a FIXED-size set of PointLights reassigned to the nearest stars
  // on a throttle, instead of one Light per star toggled by `.visible` (see the pool's
  // creation site for why a fixed count matters).
  const starLightPoolRef = useRef<THREE.PointLight[]>([]);
  const lastStarLightScanFrameRef = useRef(-999);
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
  // Tracks whether the previous tick frame had pending beacon dispatches,
  // so the beacon-deployed stat is recorded once per dispatch batch
  // (empty -> non-empty transition) instead of every frame while beacons
  // are pending.
  const hadPendingBeaconsRef = useRef(false);
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
  // The baked backdrop cubemap (Performance Program Stage 3) — set once the bake completes,
  // used both to keep it slowly rotating in the tick loop and to dispose the render target
  // (real GPU memory, distinct from a plain Texture) on unmount.
  const bakedBackdropRef = useRef<BakedBackdrop | null>(null);
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
  // Simultaneous-label cap (see MAX_VISIBLE_LABELS below): the nearest-N eligible bodies,
  // recomputed on a throttle rather than every frame.
  const labelCandidatesRef = useRef<{ id: number; d: number }[]>([]);
  const visibleLabelIdsRef = useRef<Set<number>>(new Set());
  const lastLabelCapFrameRef = useRef(-999);
  // Simultaneous full-fidelity body cap (see MAX_FIDELITY_BODIES below) — the same
  // nearest-N shape as the label cap above, recomputed in the same throttle window.
  const fidelityCandidatesRef = useRef<{ id: number; d: number }[]>([]);
  const visibleFidelityIdsRef = useRef<Set<number>>(new Set());

  // Perf HUD Phase 1 measurement (soumaya-galaxy-rendering-architecture-audit.md):
  // register a pull-based counts provider so the HUD can show "tracked" (fetched)
  // vs. "visible" (post-cluster-isolate) node/link counts — the exact distinction
  // needed to compare a large View against a small cluster View. Only ever invoked
  // from perfStats.snapshot(), i.e. at the HUD's existing 2Hz poll — never from
  // either render loop, so this is zero per-frame cost. Independent of the big
  // mount effect below on purpose: it only reads already-existing refs, so it
  // doesn't need to participate in that effect's setup/teardown at all.
  useEffect(() => {
    registerGalaxyCounts(() => {
      const nodes = dataRef.current.nodes as any[];
      const links = dataRef.current.links as any[];
      const cluster = clusterRef.current;
      const visibleLinks = cluster
        ? links.filter((l) => cluster.has(linkEnd(l.source)) && cluster.has(linkEnd(l.target))).length
        : links.length; // note: doesn't additionally account for the distance/activity link LOD (shouldRenderLink) — see the audit doc
      return {
        trackedNodes: nodes.length,
        visibleNodes: cluster ? cluster.size : nodes.length,
        trackedLinks: links.length,
        visibleLinks,
        visibleLabels: visibleLabelIdsRef.current.size,
        lightPoolSize: starLightPoolRef.current.length,
        journeyObjects: sceneryRef.current.journeyhubs?.children.length ?? 0,
        moneyObjects: sceneryRef.current.moneysky?.children.length ?? 0,
        // Phase 2.1 (soumaya-galaxy-bounded-render-architecture.md): the Detailed-link
        // selection's own state, for the real-device A/B comparison this phase's design
        // explicitly requires. Read-only — this callback only ever runs from
        // perfStats.snapshot()'s 2Hz poll, so this adds zero per-frame cost, matching
        // every other field on this object.
        boundedLinksEnabled: boundedLinksOn,
        detailedLinkBudget,
        detailedLinks: detailedLinkIdsRef.current ? detailedLinkIdsRef.current.size : visibleLinks,
        // Render-stall forensic trace (2026-09-10) item 9: count of currently-tracked
        // scene objects carrying a `transparent: true` material. Same `scene.traverse()`
        // pattern the hover-highlight effect elsewhere in this file already runs, just
        // pulled from the 2Hz HUD poll instead of a state-change effect — zero added
        // per-frame cost, only runs when someone actually reads perfStats.snapshot().
        transparentObjects: (() => {
          const scene = fgRef.current?.scene?.();
          if (!scene) return undefined;
          let count = 0;
          scene.traverse((o: any) => {
            const mat = o.material;
            if (!mat) return;
            for (const m of Array.isArray(mat) ? mat : [mat]) if (m?.transparent) count++;
          });
          return count;
        })(),
        // Item 3/4: react-force-graph-3d creates an EffectComposer unconditionally at
        // renderer init (three-render-objects.mjs — `state.postProcessingComposer = new
        // EffectComposer(...)`), whether or not `addBloom()` is ever called. EffectComposer's
        // OWN constructor then allocates TWO full-screen WebGLRenderTargets at HalfFloatType
        // regardless of pass count — this reads the ACTUAL dimensions/type off this device's
        // real renderTarget1 rather than assuming from source, so the idle-VRAM cost (or lack
        // thereof) is a measured number, not a guess.
        composerBuffers: (() => {
          const composer = fgRef.current?.postProcessingComposer?.() as
            | { renderTarget1?: { width: number; height: number; texture?: { type: number } } }
            | undefined;
          const rt = composer?.renderTarget1;
          if (!rt) return null;
          return {
            width: rt.width,
            height: rt.height,
            pixelRatio: fgRef.current?.renderer?.()?.getPixelRatio?.() ?? 1,
            halfFloat: rt.texture?.type === THREE.HalfFloatType,
          };
        })(),
      };
    });
    return () => registerGalaxyCounts(null);
  }, []);
  // DIAGNOSTIC ONLY (galaxyStateSnapshot.ts) — the BAD-vs-GOOD forensic snapshot this
  // pass adds. Pull-based, like registerGalaxyCounts just above: only invoked when the
  // user presses "Capture" in Settings, never from either render loop, so it adds zero
  // per-frame cost. Does ONE scene.traverse() for total/visible Object3D counts (the
  // one piece registerGalaxyCounts doesn't already compute) — acceptable for an
  // on-demand diagnostic action, not something that runs automatically or repeatedly.
  useEffect(() => {
    registerSnapshotCapture((label: string): GalaxyDiagSnapshot => {
      const snap = perfSnapshot();
      const gc = snap.galaxyCounts;
      const cam = fgRef.current?.camera?.() as THREE.PerspectiveCamera | undefined;
      const renderer = fgRef.current?.renderer?.() as THREE.WebGLRenderer | undefined;
      const composer = fgRef.current?.postProcessingComposer?.() as { passes?: unknown[] } | undefined;
      const sceneObj = fgRef.current?.scene?.();
      let totalObject3Ds: number | null = null;
      let visibleObject3Ds: number | null = null;
      if (sceneObj) {
        totalObject3Ds = 0;
        visibleObject3Ds = 0;
        sceneObj.traverse((o: THREE.Object3D) => {
          totalObject3Ds!++;
          if (o.visible) visibleObject3Ds!++;
        });
      }
      const now = performance.now();
      return {
        capturedAt: Date.now(),
        label,
        tickP50: snap.tick.p50,
        renderP50: snap.render.p50,
        renderP95: snap.render.p95,
        presentP50: snap.present.p50,
        gpuP50: snap.gpu?.p50 ?? null,
        gpuTimingSupported: snap.gpuTimingSupported,
        composerMs: getLatestComposerMs(),
        renderPassMs: getLatestRenderPassMs(),
        passesInLastComposerFrame: getPassesInLastComposerFrame(),
        drawCalls: snap.drawInfo?.calls ?? null,
        triangles: snap.drawInfo?.triangles ?? null,
        lines: snap.drawInfo?.lines ?? null,
        points: snap.drawInfo?.points ?? null,
        geometries: snap.memory?.geometries ?? null,
        textures: snap.memory?.textures ?? null,
        programs: snap.programs,
        programsChurnCount: snap.programsChurnCount,
        canvasWidth: renderer?.domElement?.width ?? null,
        canvasHeight: renderer?.domElement?.height ?? null,
        pixelRatio: renderer?.getPixelRatio?.() ?? null,
        cameraX: cam?.position?.x ?? null,
        cameraY: cam?.position?.y ?? null,
        cameraZ: cam?.position?.z ?? null,
        totalObject3Ds,
        visibleObject3Ds,
        transparentObjects: gc?.transparentObjects ?? null,
        trackedNodes: gc?.trackedNodes ?? null,
        visibleNodes: gc?.visibleNodes ?? null,
        trackedLinks: gc?.trackedLinks ?? null,
        visibleLinks: gc?.visibleLinks ?? null,
        visibleLabels: gc?.visibleLabels ?? null,
        lightPoolSize: gc?.lightPoolSize ?? null,
        composerBypassed: isComposerBypassEnabled(),
        bloomPassCount: composer?.passes?.length ?? null,
        refreshCallsLast3s: getRefreshCallsInWindow(now),
      };
    });
    return () => registerSnapshotCapture(null);
  }, []);
  // Link LOD hysteresis: whether we're currently in the "fully zoomed in, every link
  // draws" state. A single hard threshold re-checked every frame flickers links on/off
  // whenever the camera orbits near that exact distance; this only flips once the camera
  // has crossed a buffer PAST the threshold, so hovering near the boundary is stable.
  const linkLodZoomedInRef = useRef(true);
  // Same hysteresis need as linkLodZoomedInRef above, for the separate `shouldRenderLink`
  // distance short-circuit (added later, missed this pattern the first time round) — a
  // bare `dist < 800` re-checked every frame flickers non-lit/weak links on/off whenever
  // the camera orbits near that distance.
  const shouldRenderLinkCloseRef = useRef(true);
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

  // Pending defer() handles, tracked so a fast unmount (route change, logout) inside the
  // ~2s idle-callback window can cancel them — otherwise scenery gets added to an already
  // torn-down scene, and the money-sky/journey-hub blocks register their window event
  // listeners with no matching removal (those refs are only set INSIDE the deferred
  // callback, after cleanup has already run).
  const pendingDeferIdsRef = useRef<{ id: number; idle: boolean }[]>([]);
  // One-time imperative scene setup: lights, starfield, bloom, spin loop. A `timeout` is
  // REQUIRED here — this app runs a continuous requestAnimationFrame render loop, so the
  // main thread is rarely ever truly "idle" and an untimed requestIdleCallback can be
  // starved indefinitely (the browser never gets a large-enough idle gap to run it),
  // which silently dropped the starfield/nebula/galaxy scenery layers entirely. The
  // timeout guarantees each deferred block still runs within ~2s even under sustained load.
  const defer = (fn: () => void) => {
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(fn, { timeout: 2000 });
      pendingDeferIdsRef.current.push({ id, idle: true });
    } else {
      const id = window.setTimeout(fn, 1);
      pendingDeferIdsRef.current.push({ id, idle: false });
    }
  };

  useEffect(() => {
  const fg = fgRef.current;
  if (!fg || fg.__brainInited) return;
  fg.__brainInited = true;

  const scene: THREE.Scene = fg.scene();
  // Galaxy Performance Isolation Mode: a plain-DOM readout, independent of PerfHUD
  // (not currently visible on-device — this must not depend on whatever is wrong
  // with that component). See perfDiag.ts's module doc for the full mechanism.
  const unmountDiagOverlay = diag.enabled ? mountGalaxyDiagOverlay(diag) : null;
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
      // A high blur (sigma) is deliberate: RoomEnvironment is a small stylized room with a
      // few flat rectangular "panel" lights, and a near-mirror-sharp env map (the previous
      // 0.04) reflects those panels as crisp, visible rectangles on any glTF PBR surface —
      // exactly the "square block of light" artifact reported on the sun. A heavy blur turns
      // that into the intended soft ambient sheen instead of a discrete rectangle.
      // Node-body sub-isolation item G: `scene.environment` is auto-applied by three.js
      // to every MeshStandardMaterial in the scene (moon/asteroid rock, macro-LOD sphere,
      // action-item core) but NOT to the star/planet bodies' raw ShaderMaterial, which
      // never receives it. Skipping the assignment entirely for the "envMap off"
      // sub-isolation step is a real, if blunt, isolation of that contribution.
      if (nodeBodyDiag.envMap) {
        scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.6).texture;
      }
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
  //
  // Stage 6: seed the adaptive controller from whatever it learned last session
  // (falling back to the one-shot detectTier() guess for a brand-new device), so a
  // returning visitor starts at their settled quality instead of re-climbing from
  // scratch every load. Only actually DRIVES rendering in "auto" mode (see
  // resolveGraphics' `rung` param) — an explicit Performance/Balanced/Quality pick
  // stays on its own fixed preset, so the seed is harmless to compute either way.
  const initialSettings = getGraphics();
  const persistedRung = loadPersistedRung(ADAPTIVE_MODEL_VERSION);
  const seedRung = persistedRung?.rung ?? seedRungFromTier(detectTier());
  const adaptive = initialAdaptiveState(seedRung, [0, MAX_RUNG]);
  if (persistedRung) adaptive.ceilingRung = Math.min(adaptive.ceilingRung, persistedRung.ceilingRung);
  adaptiveStateRef.current = adaptive;
  const gfx: ResolvedGraphics = resolveGraphics(initialSettings, RUNG_TABLE[adaptive.rung]);
  gfxRef.current = gfx;
  try {
    // Cap the renderer's pixel ratio FIRST — the single biggest GPU cost on mobile
    // (a 3× retina phone renders 9× the pixels). This alone prevents most freezes.
    try {
      fg.renderer().setPixelRatio(gfx.pixelRatio);
      lastAppliedPixelRatioRef.current = gfx.pixelRatio;
      // Frame-timing instrument (Stage 0): patches renderer.render so we can measure the
      // true present cadence and draw-submission cost. react-force-graph owns the render
      // loop, so this is the only place a frame's completion is observable to us.
      attachRenderer(fg.renderer() as THREE.WebGLRenderer);
      // The ACTUAL fps-cap fix (renderRateCap.ts): react-force-graph's own
      // requestAnimationFrame loop (_animationCycle) submits a real GPU draw every
      // native frame regardless of gfx.fpsCap — Graph3D's tick() only ever gated OUR
      // scene-mutation work, never the library's own draw call, so "30fps" never meant
      // 30 real GPU submissions/sec on a 60/90/120Hz display. Wraps the composer's own
      // render() (always present — three-render-objects creates one unconditionally at
      // init) so a throttled frame skips the GPU submission entirely, atomically —
      // patching renderer.render directly instead would leave bloom's internal
      // multi-pass renderer.render() calls only partially skipped, corrupting the frame.
      try {
        const composer = fg.postProcessingComposer?.();
        if (composer) applyRenderRateCap(composer, () => gfxRef.current?.fpsCap ?? 60);
      } catch {
        /* composer not ready yet — capped on the next mount/remount instead */
      }
      // KTX2/Basis Universal support (see gltf.ts) — must run before ANY of the
      // model-loading modules below (sun/satellites/soumaya/etc., several behind
      // defer()) get a chance to call gltfLoader().load() on a KTX2-textured model.
      // This is the earliest point in Graph3D's own init that the renderer exists.
      ensureKtx2Support(fg.renderer() as THREE.WebGLRenderer);
      // DIAGNOSTIC ONLY (composerBypassDiag.ts) — off by default; see that file's doc
      // comment. Patches the composer's OWN .render() to skip straight to
      // renderer.render(scene, camera), isolating whether EffectComposer's per-frame
      // pass-iteration is contributing to the render stall under investigation.
      if (isComposerBypassEnabled()) {
        try {
          const composer = fg.postProcessingComposer?.();
          if (composer) applyComposerBypass(composer, fg.renderer(), scene, fg.camera());
        } catch {
          /* composer not ready yet — bypass simply won't apply this session */
        }
      }
      // DIAGNOSTIC ONLY (renderStageTrace.ts) — gated behind Galaxy Diagnostic mode
      // (`?galaxyDiag=1`, same `diag.enabled` flag as composerBypassDiag/nodeBodyDiag
      // above/below), NOT installed for ordinary sessions. This was previously always
      // on ("negligible cost" per call), but that means EVERY visitor's RenderPass.
      // prototype got permanently monkey-patched for a forensic pass whose root cause
      // (the link-tube geometry disposal bug) was already found and fixed — real,
      // if small, hot-path cost with no benefit once nobody is actively debugging.
      // Times composer.render() as a whole and RenderPass.render() (the base scene
      // draw) specifically, so a BAD-vs-GOOD snapshot comparison (galaxyStateSnapshot.ts)
      // can distinguish "the composer's own pass-iteration/render-target bookkeeping is
      // slow" from "the base scene draw itself is slow" without guessing. Trade-off:
      // the snapshot's composerMs/renderPassMs/passesInLastComposerFrame fields report
      // null outside diagnostic mode — the core tick/render/present numbers (perfStats.ts,
      // always on) are unaffected.
      if (diag.enabled) {
        installRenderPassTrace();
        try {
          const composer = fg.postProcessingComposer?.();
          if (composer) installComposerTrace(composer);
        } catch {
          /* composer not ready yet — traced on the next mount/remount instead */
        }
      }
    } catch {
      /* renderer not ready yet — the effect below re-applies it */
    }
    scene.background = new THREE.Color(BG);

    // Light pool (Stage 4): stars used to each own a PointLight, hidden via
    // `.visible = dist < 2200` — but an invisible Light is STILL counted toward
    // `NUM_POINT_LIGHTS` unless removed from the scene graph, so the count of
    // currently-visible stars fluctuated every frame and recompiled every lit
    // shader on nearly every camera move. A fixed-size pool, reassigned to the N
    // nearest stars on a throttle instead of created/destroyed, keeps the light
    // count perfectly constant — zero shader recompiles regardless of how the
    // camera flies. Unused slots get `intensity = 0` (never removed/hidden).
    // detailTier, not tier: Stage 6's adaptive controller (auto mode) can move this
    // independently of the coarse detected tier once it measures real headroom.
    // Galaxy Performance Isolation Mode: GLOW/LIGHTING off means zero pool lights
    // exist at all — simpler and safer than fighting the throttled reassignment scan
    // (which already handles pool.length === 0 gracefully), and it's still the same
    // "fixed pool size, never mutated mid-session" contract this pool depends on.
    const starLightPoolSize =
      diag.enabled && !diag.glow ? 0 : gfx.detailTier === "quality" ? 6 : gfx.detailTier === "balanced" ? 4 : 3;
    const starLightPool: THREE.PointLight[] = [];
    for (let i = 0; i < starLightPoolSize; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 100, 2);
      scene.add(l);
      starLightPool.push(l);
    }
    starLightPoolRef.current = starLightPool;

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
    
    // Deep-space ambience. Split (Performance Program Stage 3):
    //  - dust: a cheap live Points cloud, animated + added to the scene as before.
    //  - the nebula-cloud / distant-galaxy SPRITES: the actual fill-rate cost (large
    //    additive, depthWrite:false quads re-blended every frame for no reason, since
    //    they never change shape frame-to-frame in any way that matters) — baked ONCE
    //    into a cubemap and installed as scene.background instead of added live. The
    //    starfield's own spiral galaxies / stars / milky way / constellations are
    //    untouched Points-based effects and were never this cost (see backdropBake.ts).
    // Gated on `heavyScenery` (Settings -> "Background scenery") — on by default for
    // every tier; only Battery Saver or an explicit override turns it off. Baking means
    // this can affordably stay on unconditionally, everywhere, even at higher fidelity
    // than before, since the bake cost is one-time rather than paid every frame.
    if (gfx.heavyScenery) {
      const level = gfx.tier === "quality" ? "high" : gfx.tier === "balanced" ? "medium" : "low";
      defer(() => {
          const deepspace = makeDeepSpace(level);
          sceneryRef.current.deepspace = deepspace;
          scene.add(deepspace);
      });
      defer(() => {
          const renderer = fg.renderer() as THREE.WebGLRenderer;
          // detailTier, not tier — the adaptive controller's rung (auto mode) is what
          // decides bake resolution; `level` above (visible cloud/galaxy COUNT) stays on
          // the coarse tier by design (Stage 3: bake at high content density regardless
          // of device, only resolution scales).
          const faceSize = gfx.detailTier === "quality" ? 1024 : gfx.detailTier === "balanced" ? 768 : 512;
          const sources = makeBackdropBakeSources(level);
          bakedBackdropRef.current = bakeBackdrop(renderer, scene, sources, faceSize);
          // The bake does 6 sub-renders through the SAME instrumented renderer.render()
          // (Stage 0) — clear the rolling window so those atypical one-off samples don't
          // sit in the perf HUD's percentiles alongside real per-frame numbers.
          resetPerfStats();
      });
    }
    // Money-sky (Stage 4): your bills as stars in their own constellation. Fetched from the
    // server (state → colour/glyph/pulse; cooling=blue, urgent=red pulse) and rebuilt whenever
    // finances change.
    // Skips textures flagged `userData.shared` (moneySky's STAR_TEX, journeyHubs' HALO) — those
    // are module-level singletons reused by every star/hub sprite; disposing one here would
    // blank out every OTHER money-sky/journey-hub sprite for the rest of the session the first
    // time a rebuild runs (same bug class as disposeObject3D in graph3dHelpers.ts).
    const disposeGroup = (g: THREE.Object3D) => g.traverse((o: any) => {
      if (o.material) {
        const m = o.material;
        (Array.isArray(m) ? m : [m]).forEach((x: any) => {
          if (!x.map?.userData?.shared) x.map?.dispose?.();
          x.dispose?.();
        });
      }
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
          // Galaxy Performance Isolation Mode: AUXILIARY OBJECTS off. Re-applied on
          // every rebuild (finance changes) since `grp` is a fresh object each time.
          if (diag.enabled && !diag.aux) grp.visible = false;
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
          // Galaxy Performance Isolation Mode: AUXILIARY OBJECTS off. Re-applied on
          // every rebuild (journey changes) since `grp` is a fresh object each time.
          if (diag.enabled && !diag.aux) grp.visible = false;
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
      // Galaxy Performance Isolation Mode: AUXILIARY OBJECTS off — just hides the
      // already-created groups (not disposed, not removed from the scene, no data/
      // simulation change), matching every other diagnostic category's approach.
      if (diag.enabled && !diag.aux) {
        visitors.group.visible = false;
        satellites.group.visible = false;
        subAgents.group.visible = false;
      }
      // Bloom is expensive post-processing — skip it entirely on Performance/weak
      // devices (a major GPU + VRAM saving), else add it at the resolved strength.
      // Galaxy Performance Isolation Mode: bloom is explicitly "bloom-related Galaxy
      // glow" per the diagnostic spec, so GLOW/LIGHTING off skips it regardless of
      // the resolved graphics setting.
      bloomRef.current =
        diag.enabled && !diag.glow ? null : gfx.bloom ? addBloom(fg, { strength: gfx.bloomStrength }) : null;

      // Click detection for Soumaya's ship
      const canvas = fg.renderer().domElement;
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      const handleClick = (e: MouseEvent) => {
        if (!onSoumayaClick && !onGalaxyEntityClick) return;
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, fg.camera());
        if (onSoumayaClick) {
          const intersects = raycaster.intersectObject(soumaya!.object, true);
          if (intersects.length > 0) {
            logDiagnosticEvent('callback', 'Graph3D.onSoumayaClick');
            onSoumayaClick();
            return;
          }
        }
        // Journey hubs / Money-sky stars (Maya Intelligence Part I3) are plain overlay
        // scenery, not force-graph "nodes", so `onSelect`/`onNodeClick` never fires for
        // them — this is the only click path that can. Only the star/hub sprite itself
        // carries the id in `userData` (its sibling glyph/label sprite doesn't), and
        // three.js's raycaster ignores `.visible` entirely, so both checks are manual.
        if (onGalaxyEntityClick) {
          const s = sceneryRef.current;
          if (s.moneysky && s.moneysky.visible !== false) {
            const hit = raycaster.intersectObject(s.moneysky, true).find((h) => (h.object as any).userData?.moneyId != null);
            if (hit) {
              const ud = (hit.object as any).userData;
              logDiagnosticEvent('callback', 'Graph3D.onGalaxyEntityClick');
              onGalaxyEntityClick(ud.moneyKind, ud.moneyId);
              return;
            }
          }
          if (s.journeyhubs && s.journeyhubs.visible !== false) {
            const hit = raycaster.intersectObject(s.journeyhubs, true).find((h) => (h.object as any).userData?.journeyId != null);
            if (hit) {
              logDiagnosticEvent('callback', 'Graph3D.onGalaxyEntityClick');
              onGalaxyEntityClick("journey", (hit.object as any).userData.journeyId);
            }
          }
        }
      };
      canvas.addEventListener("click", handleClick);
      fg.__brainCleanupClick = () => canvas.removeEventListener("click", handleClick);

      // Motion is handled by the kinematic orbit system (orbits.ts), which pins
      // node positions each frame — so disable the force-engine layout entirely
      // (no charge/gravity tug-of-war, no collapse). Links are kept only as
      // visual tethers between the orbiting bodies.
      //
      // REGRESSION NOTE (docs/specs/soumaya-galaxy-force-removal-regression.md): a prior
      // attempt also removed "link" this way, which broke the Galaxy — three-forcegraph
      // relies on the link force's own initialization to normalize link source/target IDs
      // into node object references, and nothing else in the stack does that. `link` MUST
      // stay as .strength(0), never d3Force("link", null).
      //
      // `charge` has no such dependency — a dedicated safety audit
      // (docs/specs/soumaya-galaxy-charge-force-audit.md) traced the installed
      // three-forcegraph/3d-force-graph source directly and confirmed charge is never read
      // outside its own registration and one guarded, never-fired numDimensions handler, and
      // never mutates a node/link object the renderer depends on — so it's safe to fully
      // remove (like `center`) rather than merely zero its strength, dropping the Barnes-Hut
      // octree rebuild that still ran every tick even at strength 0.
      fg.d3Force("charge", null);
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
    // Scratch for the planet-material sun-direction uniform (see makePlanetMaterial /
    // uSunDirView) — reused every frame per body rather than allocated.
    const sunDirScratch = new THREE.Vector3();
    // Scratch for the sun-occlusion check (see isOccludedBySun below).
    const occDirScratch = new THREE.Vector3();
    const occClosestScratch = new THREE.Vector3();
    // Names/sector titles are otherwise purely distance-based — nothing ever checked
    // whether a large opaque body (the sun) actually sits between the camera and the
    // body being named, so a body directly behind the sun kept showing its name right
    // through it. The sun sits at the fixed world origin (sun.ts) with a known max
    // radius, so this is a cheap closest-point-on-segment test, not a real raycast —
    // no Raycaster/BVH needed. Skips immediately for anything closer than the sun's own
    // radius, since nothing that near can possibly be occluded by it.
    const isOccludedBySun = (bodyPos: THREE.Vector3, camPos: THREE.Vector3): boolean => {
      const distToBody = camPos.distanceTo(bodyPos);
      if (distToBody <= SUN_RADIUS_MAX) return false;
      occDirScratch.copy(bodyPos).sub(camPos).normalize();
      // Projection of (sun − camera) onto the camera→body direction — how far along the
      // segment the closest approach to the sun's center (the origin) falls.
      const tClosest = -camPos.dot(occDirScratch);
      if (tClosest <= 0 || tClosest >= distToBody) return false; // sun isn't between the two
      occClosestScratch.copy(camPos).addScaledVector(occDirScratch, tClosest);
      return occClosestScratch.length() < SUN_RADIUS_MAX;
    };
    // Stage 4 light-pool scratch: reused every scan instead of allocated, same pattern as
    // labelCandidatesRef but plain (this is per-effect-instance, not read outside tick()).
    const starLightCandidates: { x: number; y: number; z: number; d: number; starLight: { color: THREE.Color; intensity: number; distance: number } }[] = [];
    const FADE_NEAR = 170; // labels fully visible at/under this camera distance
    // Labels are transparent canvas sprites (extra draw calls + overdraw) — the cost that makes
    // a big galaxy heavy on a weak phone (you feel it lift when a lens/isolate hides bodies). So
    // on lower graphics tiers, fade labels out SOONER: fewer are on screen at once = less GPU load.
    const perfTier = gfxRef.current?.tier ?? "quality";
    const FADE_FAR = perfTier === "performance" ? 300 : perfTier === "balanced" ? 420 : 540;
    // The distance fade alone doesn't cap how many names can be on screen AT ONCE — a dense
    // cluster sitting inside the fade band shows every one of its names simultaneously,
    // which is the "not 100% how I wanted it" clutter (the original intent, per the
    // comment above, was to keep the galaxy from populating everything on screen at once).
    // This caps it to the nearest N regardless of how many bodies are within fade range.
    const MAX_VISIBLE_LABELS = perfTier === "performance" ? 10 : perfTier === "balanced" ? 16 : 24;
    // Hard cap on how many bodies may render their FULL-FIDELITY representation
    // (procedural shader mesh + glow/corona sprite + ring + asteroid belt) at once.
    // Everything past the cap falls back to the macro-LOD sphere that already exists.
    //
    // This is the one conclusion every automated in-session diagnostic run agreed on,
    // whichever individual decoration it was nominally isolating: a mostly-macro galaxy
    // renders in ~9-15ms/frame, a mostly-full-fidelity one in ~1400-2900ms. The
    // per-condition attributions were never reproducible (rings "0.01x" in one run,
    // asteroid belt "0.00x" in another and "2.30x" in the next) because the galaxy is
    // in constant orbital motion against a fixed camera, so the macro/fidelity split
    // drifts DURING a measurement window and dominates whatever was being toggled —
    // e.g. the rings-off window recorded 271 draws / 345k tris, which is an all-macro
    // galaxy, not a galaxy missing its handful of rings (only two RingGeometry call
    // sites exist, worth at most a few dozen objects and ~100 tris each; they cannot
    // account for -787 draws / -189k tris).
    //
    // It also matches the owner's own repeated real-world observation: opening a
    // Lens/View — which does nothing but put fewer bodies on screen — makes the Galaxy
    // instantly usable. A distance threshold alone (MACRO_DIST) could never guarantee
    // that, because its cost still scales with however many bodies happen to fall
    // inside it; that's why retuning MACRO_DIST repeatedly failed to fix the collapse.
    // A COUNT cap is bounded by construction, at any camera position, on any dataset.
    const MAX_FIDELITY_BODIES = perfTier === "performance" ? 12 : perfTier === "balanced" ? 20 : 32;
    // Small screens show these zoomed-out sector names much smaller — give them a boost so
    // they're actually readable on a phone (the "can't read the names when zoomed out" bug).
    const isNarrowScreen = typeof window !== "undefined" && window.innerWidth < 760;
    const SECTOR_LABEL_BOOST = isNarrowScreen ? 1.4 : 1;

    // Galaxy render recovery pass (2026-09-10): lowered from 2600. Two independent
    // real-device readings (Xclipse 530, hardware-accelerated) at comparable node/link
    // counts showed render() cost tracking draw-call count at a WILDLY different rate
    // depending on how many bodies were within this distance: ~0.07ms/draw-call when
    // most bodies were in cheap macro-sphere mode (990 draw calls -> 14.6ms was NOT
    // this state; the actual low-cost reading was 221 draw calls -> 14.6ms), versus
    // ~1-1.4ms/draw-call in two separate readings where far more bodies were within
    // full-detail range (1389 calls -> 1318.7ms; 990 calls -> 1383.4ms) -- a ~15-20x
    // per-object cost difference tied specifically to the full-detail tier (unique
    // procedural ShaderMaterial + unique geometry + unique glow/label textures per
    // body), not to raw triangle/pixel counts (which stayed trivial throughout,
    // ruling out ordinary fill-rate). Shrinking the full-detail "bubble" directly
    // bounds how many of these expensive per-node materials can ever be active at
    // once, regardless of total node count or camera position. Safe: the selected/
    // followed body is EXEMPT from this swap regardless of distance (`!isSelected`
    // below), so whatever you actually click always renders in full detail — this
    // only affects how many OTHER, non-selected nearby bodies pay the same cost
    // simultaneously.
    const MACRO_DIST = 1200; // swap fidelity for points-of-light beyond this
    const MACRO_HYST = 150; // buffer band around MACRO_DIST so hovering near it doesn't flicker
    // (raised so bodies resolve into full 3D as you fly toward a cluster, not only
    // when you're right on top of them — dots are for genuinely distant bodies).
    // Node-glow render-stall fix (2026-09-10 sub-isolation sweep) — a TIGHTER cutoff
    // than MACRO_DIST applied only to the glow/corona sprite; see computeGlowFar's own
    // doc comment (graph3dHelpers.ts) for the full measurement/reasoning.
    const GLOW_DIST = MACRO_DIST * 0.5;
    const GLOW_HYST = 80;

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
      noteRefreshInvoked(); // diagnostic-only — see galaxyStateSnapshot.ts
      // D2: no `f.refresh()` here — it sets three-forcegraph's `_flushObjects`, which
      // unconditionally clears AND disposes every tracked node AND link Object3D (a full
      // galaxy rebuild on every pulse). Bumping pulseTick re-renders Graph3D instead, so
      // the unmemoized `linkColor` accessor re-fires through the cheap per-render digest
      // and picks up the fresh activity above. On-device visual confirmation is the gate
      // (see the repair doc); fallback is a refresh scoped to first-seen link keys only.
      setPulseTick((t) => t + 1);
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
    // Stage 6 adaptive controller: how often to sample perfStats and let the rung
    // ladder climb/descend. 2s is frequent enough that a real stall gets reacted to
    // quickly (the controller's OWN hysteresis — 2 bad windows to descend, 5 good + 8s
    // to ascend — is what actually prevents flapping, not a slow sample rate).
    let adaptiveSampleT = 2;
    // Ship-task → React sync cadence (see the throttle note in the tick).
    let taskSyncT = 0;
    let fuelBurnT = 0;
    // Journey-hub / Money-sky sprite "breathing"/pulse update cadence. Each hub/star's
    // userData.update(t) is a pure function of absolute elapsed time (no accumulated
    // per-frame delta), so sampling it less often doesn't introduce drift or a visible
    // jump — it's just a coarser, still-correct sample of the same continuous curve.
    // 10Hz is comfortably smooth for periods in the ~1.3-12s range these use (measured
    // from their own sine multipliers) while cutting the unconditional per-frame cost
    // that scales with Journey/bill count (soumaya-galaxy-performance-audit-2.md).
    let auxSkyT = 0;
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
    let prevCamPos: THREE.Vector3 | null = null; // for camera-speed → starfield blur
    let starBlur = 0;
    // Stage 6: a DEDICATED (not perfStats') "did the camera move" flag for the adaptive
    // sampler. perfStats.snapshot()'s own `movedRecently` is consume-once and already
    // has a consumer (PerfHUD's poll) — sharing it here would mean the HUD silently
    // stealing the "moved" evidence out from under the controller whenever it's open,
    // making ascends nearly impossible to observe. Own flag, own consume-on-sample.
    let movedSinceAdaptiveSample = false;
    let frameCount = 0;
    const followAnchor = new THREE.Vector3();
    let followAnchorId: number | null = null;
    const followPos = new THREE.Vector3();
    // Scratch for the station/Soumaya world-position handed to satellites/subAgents each
    // frame — both consumers only read .x/.y/.z synchronously within the same call (they
    // .copy() into their own owned vectors), never retain the reference, so reusing one
    // scratch instead of allocating a fresh Vector3 every frame is safe.
    const stationWorldScratch = new THREE.Vector3();
    const soumayaPosScratch = new THREE.Vector3();
    // Separate scratch for the later-in-frame station lookup passed to soumaya.update()
    // (not reused from stationWorldScratch above — different point in the frame, and
    // getWorldPosition() re-reads the current world matrix each time regardless).
    const stationWorldScratch2 = new THREE.Vector3();
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
      // Open the frame-timing bracket AFTER the cap gate, so skipped frames (which do no
      // work) never dilute the measurement of what a real frame actually costs.
      beginTick();

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

      // REMOVED (FPS regression fix): this used to call fgRef.current?.refresh?.() on a
      // 250ms/35-unit camera-distance throttle to keep link curvature/opacity/width "live"
      // while zooming or panning. Verified against the installed three-forcegraph source
      // that none of the three properties actually need it:
      //  - Curvature: calcLinkCurve() (three-forcegraph's own per-frame link-position-sync
      //    loop, unconditional, no _flushObjects/hasAnyPropChanged gate) already calls the
      //    linkCurvature accessor — which reads live camera distance — every real frame.
      //  - Width (curved/tube links, i.e. once zoomed out past 800 units): the same
      //    per-frame loop rebuilds each curved link's TubeGeometry every frame, reading the
      //    linkWidth accessor fresh each time — already live with no refresh() involved.
      //  - Color/opacity (and width for straight/close links): linkColor is still an
      //    inline, unmemoized prop (Round "ForceGraph callback stabilization" only
      //    memoized nodeThreeObject/linkWidth) — its identity already changes on every
      //    Graph3D render, which already re-triggers three-forcegraph's cheap link
      //    material/geometry digest independent of camera distance.
      // fg.refresh() itself sets _flushObjects = true, which unconditionally clears AND
      // disposes every currently-tracked node's AND link's Object3D before rebuilding them
      // from scratch — on a 250ms camera-movement throttle, this was forcing a full Galaxy
      // rebuild several times a second during any camera motion, the confirmed cause of the
      // "freeze, one frame, freeze" FPS collapse. Removing it changes no visual behavior:
      // every property it was keeping live is already kept live by the mechanisms above.

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

      // Stage 6 — adaptive controller: sample real measured cost and let the rung
      // ladder climb or descend. Only the current adaptive state's OWN hysteresis
      // (2 bad windows to descend; 5 good + 8s + camera motion to ascend) prevents
      // flapping — this is just the sampling cadence, not a rate limit on reactions.
      adaptiveSampleT -= dt;
      if (adaptiveSampleT <= 0 && adaptiveStateRef.current) {
        adaptiveSampleT = 2;
        const settings = getGraphics();
        // The controller only DRIVES anything in auto mode (see resolveGraphics); an
        // explicit Performance/Balanced/Quality pick is a stated preference and its
        // fixed preset is left alone. Still worth sampling in the background even
        // then, cheaply, so if the user switches back to auto it's already warm.
        const snap = perfSnapshot();
        const workMs = snap.tick.p95 + snap.render.p95;
        const targetMs = (1000 / gfxRef.current!.fpsCap) * 0.8; // 20% safety margin
        const cameraMoved = movedSinceAdaptiveSample;
        movedSinceAdaptiveSample = false;
        const prevRung = adaptiveStateRef.current.rung;
        adaptiveStateRef.current = adaptiveStep(
          adaptiveStateRef.current,
          { workMs, targetMs, cameraMoved, now: performance.now() },
          [0, MAX_RUNG],
        );
        if (adaptiveStateRef.current.rung !== prevRung) {
          const rungSettings = RUNG_TABLE[adaptiveStateRef.current.rung]!;
          const g = resolveGraphics(settings, rungSettings);
          gfxRef.current = g;
          if (settings.mode === "auto") {
            // pixelRatio is the only rung-driven knob that's safe to hot-apply — shader
            // octave/geometry tier, light-pool size, and backdrop resolution are all
            // one-time scene construction (same "needs a reload" precedent as star
            // count/bloom elsewhere in this file). Persisting means next launch at
            // least starts on the learned detailTier instead of re-climbing from zero.
            //
            // Only actually call setPixelRatio() when the EFFECTIVE value changed.
            // WebGLRenderer.setPixelRatio() has no internal early-out — it always calls
            // setSize(), resizing the WebGL drawing buffer — so a rung change whose
            // resolved pixelRatio happens to match the previous one (adjacent rungs can
            // share a pixelRatioCap, and a descend-then-ascend flap can round-trip back
            // to the same value) would otherwise still pay for a real buffer resize with
            // nothing visually different to show for it.
            if (shouldApplyPixelRatio(lastAppliedPixelRatioRef.current, g.pixelRatio)) {
              try {
                fgRef.current?.renderer?.().setPixelRatio(g.pixelRatio);
                lastAppliedPixelRatioRef.current = g.pixelRatio;
              } catch {
                /* renderer mid-teardown */
              }
            }
          }
          savePersistedRung(adaptiveStateRef.current, ADAPTIVE_MODEL_VERSION);
        }
      }

      // Advance every body along its orbit first, so the camera + Soumaya read
      // up-to-date positions this frame. Under reduced-motion the drift slows to a
      // gentle crawl (never fully frozen, so the galaxy still feels alive) (#3b).
      const motionDt = calmMotionRef.current ? dt * 0.12 : dt;
      // Orbit LOD (Stage 5): passing the camera position lets far bodies update less
      // often (see orbits.ts) — omitting it (as every call before this stage did) would
      // fall back to updating every node every frame.
      orbitsRef.current.update(motionDt, dataRef.current.nodes as any[], camera.position);

      // First frame with real positions → open zoomed-out (not inside the sun).
      // frameGalaxy reports whether it actually ran: a failed attempt (nodes not
      // positioned yet) must NOT consume the one-shot — it retries next frame
      // instead of the intro being lost forever.
      if (!cinematicStartedRef.current) {
        const ns = dataRef.current.nodes as any[];
        if (ns.length > 0 && frameGalaxy(3200, undefined, true)) {
          cinematicStartedRef.current = true;
          initialFramedRef.current = true;
        }
      }

      // First rendered frame with data → notify App (boot log, stuck-guard).
      // This prop was stored but never invoked, so App's loading-complete hook
      // only ever fired from data-fetch.
      if (!firstFrameDoneRef.current && (dataRef.current.nodes as any[]).length > 0) {
        firstFrameDoneRef.current = true;
        try {
          onFirstFrameRef.current?.();
        } catch {
          /* non-fatal: boot logging must never break the frame loop */
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
        ? stationObjRef.current.getWorldPosition(stationWorldScratch)
        : null;
      const soumayaPos = soumayaObjRef.current
        ? soumayaPosScratch.copy(soumayaObjRef.current.position)
        : null;
      satellites?.update(dt, workNodes, stationWorld, soumayaPos);
      if (satellites && soumayaHandleRef.current) {
        const pending = satellites.getPendingDispatches();
        if (pending.length > 0) {
          soumayaHandleRef.current.enqueueBeacons(pending);
          if (spaceIdRef.current && !hadPendingBeaconsRef.current) {
            // Record the dispatch batch once, on the empty -> non-empty
            // transition. Previously this block ran every frame while any
            // beacon was pending: the localStorage stat was inflated ~60x
            // per second of pending time, and fg.refresh() forced a full
            // _flushObjects dispose+rebuild of every node/link Object3D on
            // every frame of every pending window (the periodic
            // steady-state freeze). The refresh's comment claimed to "force
            // evaluate achievements in App", but App's achievement effect
            // depends on React state references (data.nodes, data.links,
            // fuel, streak, space, loaded) that a scene-graph refresh()
            // never changes — so it achieved nothing. Removed; the
            // diagnostic note goes with it so refreshCallsLast3s keeps
            // counting actual refresh() invocations.
            const key = `stat.beacons_deployed.${spaceIdRef.current}`;
            localStorage.setItem(key, String(parseInt(localStorage.getItem(key) || "0", 10) + pending.length));
          }
        }
        hadPendingBeaconsRef.current = pending.length > 0;
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
        // O(1) via the existing id->node map instead of an O(N) scan every frame this
        // camera is follow-locked (a common, often long-lived state).
        const fn = nodeByIdRef.current.get(fid);
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
            // Reuse this existing camera-speed signal to flag "the window contained real
            // motion". Idle frames are cheap and would lie to the adaptive controller about
            // how much headroom the device actually has (Stage 6).
            if (move > 0.5) {
              markMoved();
              movedSinceAdaptiveSample = true;
            }
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
      // Keep the baked backdrop (Stage 3) drifting instead of frozen — a cheap Euler
      // rotation on scene.background, not a re-render, so this costs nothing like the
      // per-frame blending it replaced. Scaled by motionDt (same reduced-motion slowdown
      // as orbits/marquee) rather than a fixed per-call amount, unlike the pre-existing
      // per-sprite rotations above, which are frame-rate-dependent and don't currently
      // honor prefers-reduced-motion — not replicating that gap in new code.
      if (bakedBackdropRef.current) scene.backgroundRotation.y += motionDt * 0.006;
      // Throttled to 10Hz (see auxSkyT's declaration) and skipped entirely while the
      // layer is invisible (a Lens/View isolate toggles .visible — three.js visibility
      // only gates the draw call, not this manual per-child work, so without this check
      // the update kept running, unconditionally, purely to recompute an opacity/scale
      // nothing is currently drawing).
      auxSkyT -= dt;
      if (auxSkyT <= 0) {
        auxSkyT = 0.1;
        if (s.moneysky?.visible) s.moneysky.children.forEach((o: any) => o.userData?.update?.(now));
        if (s.journeyhubs?.visible) s.journeyhubs.children.forEach((o: any) => o.userData?.update?.(now));
      }
      s.nebulae?.children.forEach((o: any) => o.userData?.update?.(now));
      s.comets?.children.forEach((o: any) => o.userData?.update?.(now));
      burstsRef.current?.group?.children.forEach((o: any) => o.userData?.update?.());
      linkFormingRef.current?.group?.userData?.update?.();
      sunRef.current?.userData?.update?.(now);
      // camera.position drives the station's heavy-glTF distance LOD (spaceStation.ts,
      // shouldHideStationModel) — optional param, same contract as orbits.update's cameraPos.
      stationObjRef.current?.userData?.update?.(now, camera.position);

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

        // Recompute the nearest-N label cap on a throttle (not every frame — a full
        // distance sort over every body is unnecessary at 60fps for something that only
        // needs to settle within a few frames of the camera moving).
        if (frameCount - lastLabelCapFrameRef.current >= 6) {
          lastLabelCapFrameRef.current = frameCount;
          const candidates = labelCandidatesRef.current;
          candidates.length = 0;
          const fidelityCandidates = fidelityCandidatesRef.current;
          fidelityCandidates.length = 0;
          const wasVisible = visibleLabelIdsRef.current; // read before it's cleared below
          for (const o of graphGroup.children as any[]) {
            const id = o.userData?.nodeId;
            if (id == null) continue;
            const n = nodeByIdRef.current.get(id);
            if (!n || n.x == null || isNaN(n.x)) continue;
            tmp.set(n.x, n.y, n.z ?? 0);
            const d = tmp.distanceTo(camera.position);
            // Fidelity cap candidates are UNFILTERED by distance (unlike labels, which
            // are only eligible inside their fade range) — the cap's whole job is to
            // rank every body and keep only the nearest N in full detail.
            fidelityCandidates.push({ id, d });
            // A hasSectorTitle body's own label now fades out at MACRO_DIST + MACRO_HYST
            // (see labelFadeFar below), not the ordinary FADE_FAR — it must stay eligible
            // for the crowd cap that far out too, or this filter would exclude it from
            // visibleLabelIdsRef and the "capped" check further down would force it
            // invisible anyway, silently undoing that extended fade-out entirely.
            const labelFadeFar = o.userData?.hasSectorTitle ? MACRO_DIST + MACRO_HYST : FADE_FAR;
            if (d < labelFadeFar) candidates.push({ id, d });
          }
          // Sticky sort: an already-visible body needs to be clearly overtaken — not just
          // marginally nearer — before losing its slot to a new candidate. Without this, two
          // bodies hovering near the Nth-nearest boundary could swap in/out of the visible
          // set on ordinary camera drift between throttle windows, even though the total
          // visible count never changes — reading as "which names show is unpredictable."
          const STICKY_FACTOR = 0.85; // an already-visible body's effective distance reads ~15% closer
          candidates.sort((a, b) => {
            const da = wasVisible.has(a.id) ? a.d * STICKY_FACTOR : a.d;
            const db = wasVisible.has(b.id) ? b.d * STICKY_FACTOR : b.d;
            return da - db;
          });
          const visible = visibleLabelIdsRef.current;
          visible.clear();
          for (let i = 0; i < Math.min(MAX_VISIBLE_LABELS, candidates.length); i++) visible.add(candidates[i]!.id);
          // Nearest-N full-fidelity cap, same sticky ranking as the label cap (see
          // pickNearestIds in graph3dHelpers.ts for why stickiness matters here).
          visibleFidelityIdsRef.current = pickNearestIds(
            fidelityCandidates,
            MAX_FIDELITY_BODIES,
            visibleFidelityIdsRef.current,
          );
        }

        // Reassign the fixed star-light pool (Stage 4) to the nearest N stars, same
        // throttle as the label cap above — a light this far away doesn't need to react
        // faster than every 6 frames, and it keeps the scan/sort off the hot per-frame path.
        if (frameCount - lastStarLightScanFrameRef.current >= 6) {
          lastStarLightScanFrameRef.current = frameCount;
          const pool = starLightPoolRef.current;
          if (pool.length) {
            starLightCandidates.length = 0;
            for (const o of graphGroup.children as any[]) {
              const starLight = o.userData?.starLight;
              if (!starLight) continue;
              const id = o.userData?.nodeId;
              const n = nodeByIdRef.current.get(id);
              if (!n || n.x == null || isNaN(n.x)) continue;
              tmp.set(n.x, n.y, n.z ?? 0);
              const d = tmp.distanceTo(camera.position);
              if (d < 2200) starLightCandidates.push({ x: n.x, y: n.y, z: n.z ?? 0, d, starLight });
            }
            starLightCandidates.sort((a, b) => a.d - b.d);
            for (let i = 0; i < pool.length; i++) {
              const light = pool[i]!;
              const c = starLightCandidates[i];
              if (c) {
                light.position.set(c.x, c.y, c.z);
                light.color.copy(c.starLight.color);
                light.intensity = c.starLight.intensity;
                light.distance = c.starLight.distance;
              } else {
                // Never removed/hidden — that would change NUM_POINT_LIGHTS, the exact
                // shader-recompile problem this pool exists to avoid. Zero intensity
                // makes it contribute nothing while keeping the light count constant.
                light.intensity = 0;
              }
            }
          }
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
          // Hysteresis around MACRO_DIST — same fix pattern as the link-LOD flicker fix
          // (linkLodZoomedInRef): a hard cutoff re-evaluated every frame flips a body
          // between its full-detail and macro (low-poly) representation every single
          // frame while it drifts/orbits near that exact distance. State is kept on the
          // object itself (persists across frames for this node) rather than a separate
          // ref map, since `o` is the same Object3D instance while the node stays mounted.
          const wasMacroView = o.userData.isMacroView ?? false;
          // Bounded full-fidelity population (MAX_FIDELITY_BODIES): a body outside the
          // nearest-N set renders as the macro sphere no matter how close it is, so the
          // expensive representation can never scale with how many bodies happen to sit
          // inside MACRO_DIST. The selected body and the followed body are exempt at any
          // distance — active-node emphasis must never be capped away.
          const fidelityCapped =
            !isSelected && id !== followRef.current && !visibleFidelityIdsRef.current.has(id);
          const isMacroView =
            !isSelected &&
            (fidelityCapped ||
              (wasMacroView ? dist > MACRO_DIST - MACRO_HYST : dist > MACRO_DIST + MACRO_HYST));
          o.userData.isMacroView = isMacroView;

          // TITLE FAR VIEW: distance ONLY — no fidelity-cap term. Sector-title
          // visibility was keyed off isMacroView, which is also true when a hub
          // falls outside the nearest-N fidelity set, so a CLOSE hub's giant title
          // popped on/off as the set churned during flight. Titles are map labels;
          // they only care how far the camera is, not which LOD the body uses.
          const wasTitleFarView = o.userData.isTitleFarView ?? false;
          const isTitleFarView = wasTitleFarView
            ? dist > MACRO_DIST - MACRO_HYST
            : dist > MACRO_DIST + MACRO_HYST;
          o.userData.isTitleFarView = isTitleFarView;
          // Same hysteresis pattern as isMacroView immediately above, just a tighter
          // threshold applied only to the glow/corona sprite child (see GLOW_DIST and
          // computeGlowFar's own doc comment) — state cached on the same `o` object.
          const wasGlowFar = o.userData.isGlowFar ?? false;
          const isGlowFar = computeGlowFar(dist, wasGlowFar, isSelected, GLOW_DIST, GLOW_HYST);
          o.userData.isGlowFar = isGlowFar;
          // The selected/followed body's own name should never be hidden by this — you
          // deliberately flew to it or selected it, so it must stay readable regardless of
          // what's technically between the camera and its position.
          const occludedBySun = !isSelected && id !== followRef.current && isOccludedBySun(tmp, camera.position);

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

          if (!cell.isVisible && !isFocused && !o.userData?.hasSectorTitle) {
            o.visible = false;
            return;
          }
          // Sector-title hubs bypass the spatial grid: titles are far-view map
          // labels, and the grid's 4000-unit cells flip as the camera orbits —
          // without this, a far sector's title pops on/off ~1/sec at the cell
          // boundary ("pops up for a second then disappears"). The body still
          // uses cheap macro LOD out there, so the bypass costs nothing.
          // Performance Program Stage 5: a frustum-culled body skips its ENTIRE per-
          // child update (spin/label-distance/LOD-swap/pulse/corona) here, not just the
          // pulse/corona tail the old inner `if (isCulled) continue` reached — three.js
          // was never drawing it either way (Object3D.frustumCulled already skips the
          // GPU submission), so all that per-child work was pure CPU waste on anything
          // off-screen. The one exception: a body with a sector title, whose sprite
          // scales up and can read on screen well past its own body's small culling
          // sphere — those still need the full per-child pass (the inner isCulled check
          // further down still gates their non-title children).
          if (isCulled && !o.userData?.hasSectorTitle) {
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
            // Galaxy Performance Isolation Mode: same reasoning as the other LOD/label
            // visibility guards in this loop — see the isFidelity/isMacro comment above.
            // No sun-occlusion gate: titles only show in far (map) view, where the sun
            // is scenery, not an occluder. Occluding them made titles blink on/off as
            // hubs grazed the sun's limb during orbit ("pops up for a second then
            // disappears"). The hub's own close-up label keeps its occlusion check.
            child.visible = isDiagForceHidden(child) ? false : isTitleFarView;
            if (child.visible) {
              const mat = child.material as THREE.SpriteMaterial;
              mat.opacity = 0.92;
              // Grow the label with camera distance so it holds a readable on-screen size
              // as you pull further out (world-scale sprites otherwise shrink to specks),
              // with an extra bump on small screens. No upper cap: the old 3.4× cap
              // froze title growth past ~4100 units, so titles shrank into specks in
              // the recentered whole-galaxy view. Uncapped, a title holds constant
              // on-screen size at any zoom (map-label behavior).
              const base = child.userData.baseScale;
              if (base) {
                const k = Math.max(1, dist / MACRO_DIST) * SECTOR_LABEL_BOOST;
                child.scale.set(base.x * k, base.y * k, 1);
              }
              const mq = child.userData.marquee;
              if (mq) {
                // motionDt (not raw dt) — same reduced-motion slowdown orbit motion already
                // gets (calmMotionRef ? dt*0.12 : dt); this marquee scroll previously ran at
                // full speed regardless of prefers-reduced-motion.
                mq.t += motionDt * 0.36;
                mat.map!.offset.x = (Math.sin(mq.t) * 0.5 + 0.5) * mq.range;
              }
            }
          }

          // Skip individual label processing if too far, not selected, and not focused.
          // Raised from a bare MACRO_DIST to MACRO_DIST + MACRO_HYST so this can never cut a
          // hasSectorTitle body's own label off before its extended fade-out below (labelFadeFar)
          // has a chance to run — ordinary (non-hub) labels are already invisible well before
          // this point regardless (FADE_FAR tops out at 540, far short of MACRO_DIST), so
          // raising it doesn't change anything for them.
          if (child.userData?.isLabel && dist > MACRO_DIST + MACRO_HYST && !isSelected && id !== followRef.current) continue;
          
          // Optimization: throttle updates for distant/insignificant labels
          if ((child.userData?.isLabel || child.userData?.isSectorTitle) && frameCount % 2 !== 0 && dist > FADE_NEAR) {
            continue;
          }

          // LOD Swapping. Galaxy Performance Isolation Mode note: this unconditionally
          // reassigns .visible every frame for near/far LOD, which would otherwise
          // fight the one-time diagnostic hide applied at construction time
          // (nodeThreeObjectCb) whenever the camera crosses the macro-view distance —
          // `diag.enabled &&` short-circuits before the (still allocation-free)
          // shouldHideNodeChild check runs, so the normal (non-diagnostic) path pays
          // only one extra cached-boolean read per applicable child, same as before.
          if (child.userData?.isFidelity) {
            // The glow/corona sprite gets the tighter GLOW_DIST cutoff (isGlowFar) on
            // top of the ordinary macro-view swap every other fidelity child uses — see
            // computeGlowFar's doc comment. Hidden if EITHER the body itself has gone
            // macro OR the glow-specific distance was crossed.
            const hiddenByLod = child.userData?.glowCacheKey != null ? isMacroView || isGlowFar : isMacroView;
            child.visible = isDiagForceHidden(child) ? false : !hiddenByLod;
          }
          if (child.userData?.isMacro) {
            child.visible = isDiagForceHidden(child) ? false : isMacroView;
          }

          if (isCulled) {
            // A hasSectorTitle hub bypasses the top-level cull-hide above (so its title
            // sprite, which scales up with distance, can still read on screen past the
            // body's own small culling sphere) — but that must not also leave the hub's
            // OWN close-up label frozen at whatever visibility/opacity it last had before
            // rotating out of frustum. Without this, a hub's name could stay stuck fully
            // visible indefinitely while the camera orbits (e.g. following Soumaya around
            // the sun swings hubs in and out of frustum continuously) — explicitly hide it
            // instead of silently skipping its update.
            if (child.userData?.isLabel) child.visible = false;
            continue;
          }

          if (child.userData?.isSectorTitle) {
            // Already handled above
          } else if (child.userData?.isLabel) {
              // Always exempt the selected/followed body — its name should never be
              // subject to the crowd cap, only the ambient population is capped.
              const capped = !isSelected && id !== followRef.current && !visibleLabelIdsRef.current.has(id);
              // A hasSectorTitle body's OWN label used to fade out at the same FADE_FAR as
              // any ordinary body (300-540 units) while its sector title doesn't switch on
              // until MACRO_DIST's hysteresis band (~2450-2750) — leaving it nameless for a
              // ~1900-2200-unit dead zone in between (neither name nor sector title showing,
              // regardless of how steadily the camera sits there). Extend ONLY a hub's own
              // label out to meet the sector title's own turn-on point (with the same
              // hysteresis buffer), so the handoff is continuous — briefly overlapping as the
              // sector title fades in is fine; a gap where nothing is shown is not.
              const labelFadeFar = o.userData?.hasSectorTitle ? MACRO_DIST + MACRO_HYST : FADE_FAR;
              // A hub's own label fades out when its sector title takes over (far view),
              // gated on the distance-only flag so it can't flicker with the LOD set.
              const labelVis = (isTitleFarView && !isSelected) || capped || occludedBySun ? 0 : Math.min(1, Math.max(0, (labelFadeFar - dist) / (labelFadeFar - FADE_NEAR)));
              // Galaxy Performance Isolation Mode: same reasoning as the LOD-swap guard
              // above — this line otherwise reassigns label visibility every frame,
              // fighting the one-time diagnostic hide. `diag.enabled &&` short-circuits
              // to zero added cost in the normal (non-diagnostic) path.
              child.visible = isDiagForceHidden(child) ? false : labelVis > 0.02;
              if (child.visible) {
                const mat = child.material as THREE.SpriteMaterial;
                mat.opacity = labelVis * 0.95;
                const mq = child.userData.marquee;
                if (mq) {
                  // motionDt (not raw dt) — same reduced-motion slowdown orbit motion already
                // gets (calmMotionRef ? dt*0.12 : dt); this marquee scroll previously ran at
                // full speed regardless of prefers-reduced-motion.
                mq.t += motionDt * 0.36;
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
                // Floor the combined multiplier: bf (0.25× near) × vitality
                // (~0.1× for old/neglected memories) used to stack to ~0.03 —
                // effectively black — making the macro→fidelity LOD swap a
                // visible cliff ("planets go dark up close"). The floor keeps
                // relative dimming cues above it while sitting near the macro
                // body's constant 0.5 emissive at the swap boundary.
                intensity = Math.max(0.45, (p.base + p.amp * s) * bf * (p.vitality ?? 1));
              }

              const mat = child.material as any;
              if (mat?.isShaderMaterial) {
                mat.uniforms.uBrightness.value = intensity;
                mat.uniforms.uTime.value = now;
                // Planets (only — makeStarMaterial has no uSunDirView uniform, so this is
                // a no-op for stars): the sun sits at the world origin (sun.ts), so the
                // direction from this body toward it is just -position, transformed into
                // VIEW space to match vNormal (also view-space, via the vertex shader's
                // normalMatrix) — this is what makes a planet's lit side actually track
                // the real sun instead of a direction fixed to the camera.
                if (mat.uniforms.uSunDirView) {
                  sunDirScratch.set(-tmp.x, -tmp.y, -tmp.z).normalize().transformDirection(camera.matrixWorldInverse);
                  mat.uniforms.uSunDirView.value.copy(sunDirScratch);
                }
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
          ? stationObjRef.current.getWorldPosition(stationWorldScratch2)
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
      // in react-force-graph-3d. Looks up via the EXISTING nodeByIdRef (id -> dataRef.current's
      // own node objects, which orbits.update() already wrote this frame's x/y/z/fx/fy/fz onto
      // in place, above) instead of allocating a fresh id->node Map here every frame — that
      // Map + its N two-element entries was the single largest per-frame GC source in the
      // whole tick loop at a few hundred nodes. `liveNodes` itself is already a live reference
      // handed to us by the library, so this loop now allocates nothing.
      const fg = fgRef.current;
      const liveNodes = fg?.graphData?.()?.nodes as any[];
      if (liveNodes && liveNodes.length > 0) {
        for (const live of liveNodes) {
          const n = nodeByIdRef.current.get(live.id);
          if (n) {
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
      // Close the frame-timing bracket (Stage 0 instrument). The sample is only committed
      // once the frame actually draws — see perfStats.attachRenderer.
      endTick();
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      unmountDiagOverlay?.();
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
      // Cancel any pending defer() scenery/init blocks (see pendingDeferIdsRef above).
      for (const { id, idle } of pendingDeferIdsRef.current) {
        if (idle && typeof cancelIdleCallback !== "undefined") cancelIdleCallback(id);
        else clearTimeout(id);
      }
      pendingDeferIdsRef.current.length = 0;
      // The star-light pool (Stage 4) holds no GPU resources — PointLight has no
      // dispose() — so clearing the ref (rather than disposing) is all a remount needs;
      // the old lights are freed with the rest of the torn-down scene.
      starLightPoolRef.current = [];
      // Free the VRAM held by every cached node object on unmount (e.g. logout →
      // remount), so a new session doesn't start atop the old scene's leaked buffers.
      // releaseNodeTextures matters MOST here: labelTexCache/glowTexCache (nodeObject.ts)
      // are module-level singletons that survive a remount — without releasing here, a
      // fresh session's refcounts would just keep incrementing on top of the torn-down
      // session's stale counts, forever preventing the ORIGINAL entries from reaching
      // zero and ever being freed.
      for (const entry of nodeThreeObjCacheRef.current.values()) {
        releaseNodeTextures(entry.obj);
        disposeObject3D(entry.obj);
      }
      nodeThreeObjCacheRef.current.clear();
      // Full scene teardown: dispose every imperatively-added object's geometry/
      // materials/textures (starfield, nebulae, skybox, ship, station, satellites,
      // figurines, sun, bursts) plus the PMREM environment map — otherwise all of it
      // leaks on logout→remount. Lights need no disposal; disposeObject3D is idempotent.
      try {
        const scn = fg.scene?.();
        if (scn) {
          scn.traverse((o: any) => {
            // Same shared-resource guard as disposeObject3D (graph3dHelpers.ts): several
            // caches in nodeObject.ts/moneySky.ts/journeyHubs.ts are intentional MODULE-
            // level singletons meant to live for the page's whole lifetime, reused across
            // remounts (e.g. logout → remount). Disposing them here would leave the cache
            // holding a reference to an already-disposed GPU texture/geometry, so the next
            // mount renders every moon/glow/macro-body/label/money-star/journey-hub with a
            // dead resource until a full page reload.
            if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose?.();
            const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
            for (const m of mats) {
              for (const k in m) {
                const v = (m as any)[k];
                if (v && v.isTexture && !v.userData?.shared) v.dispose?.();
              }
              m.dispose?.();
            }
          });
          (scn.environment as any)?.dispose?.();
          scn.environment = null;
          // The baked backdrop (Stage 3) is a WebGLCubeRenderTarget, not a plain Texture
          // like the solid-colour background it replaces — disposing the render target
          // (not just `.texture`) is what actually frees the render-target's GPU memory.
          if (bakedBackdropRef.current) {
            disposeBakedBackdrop(bakedBackdropRef.current);
            bakedBackdropRef.current = null;
          }
          scn.background = new THREE.Color(BG);
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
      const s = getGraphics();
      // Keep whatever rung the controller has settled on (ignored by resolveGraphics
      // outside auto mode anyway) — a Settings change elsewhere (e.g. toggling a
      // different knob) shouldn't reset the learned quality.
      const rung = RUNG_TABLE[adaptiveStateRef.current?.rung ?? 0];
      const g = resolveGraphics(s, rung);
      gfxRef.current = g;
      // Same guard as the adaptive controller's own hot-apply site: only resize the
      // WebGL drawing buffer when the effective pixel ratio actually changed.
      if (shouldApplyPixelRatio(lastAppliedPixelRatioRef.current, g.pixelRatio)) {
        try {
          (fgRef.current as any)?.renderer?.().setPixelRatio(g.pixelRatio);
          lastAppliedPixelRatioRef.current = g.pixelRatio;
        } catch {
          /* renderer may be mid-teardown */
        }
      }
    };
    window.addEventListener("brain-graphics-change", apply);
    return () => window.removeEventListener("brain-graphics-change", apply);
  }, []);

  // Hover highlighting: dim node groups that aren't the focus or its neighbors.
  //
  // This effect used to force `transparent = true` on EVERY node child unconditionally,
  // including opaque-by-construction bodies, and including when `activeId === null`
  // (nothing selected — the default, most common state, where `isLit()` returns true for
  // everyone and the dimming has no visual effect at all). That moved every body into
  // three.js's back-to-front TRANSPARENT render queue permanently, which has no early-Z
  // rejection — an occluded body still paid its full per-pixel shader cost. See
  // docs/specs/soumaya-galaxy-large-render-forensic-audit.md §8.2/§22.
  // `highlightMaterialState` (graph3dHelpers.ts) restores a lit body to its natural opaque
  // state instead; a dimmed body still gets real alpha blending, exactly as before.
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
        const { transparent, opacity } = highlightMaterialState(!!child.userData?.isBody, lit);
        mat.transparent = transparent;
        mat.opacity = opacity;
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
      // recomputeDetailedLinksRef: covers the `focusNode` imperative-handle path (e.g.
      // chat navigation), which flies here WITHOUT going through onSelect/selectedId —
      // without this, that node's own links wouldn't be promoted into the Detailed
      // budget until some unrelated event happened to trigger a recompute.
      scheduleTimeout(() => { followRef.current = n.id; recomputeDetailedLinksRef.current(); }, 60);
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
      scheduleTimeout(() => { followRef.current = n.id; recomputeDetailedLinksRef.current(); }, 1080);
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
  // Returns true when it actually framed (false = no scene/graph yet, or no
  // positioned nodes — caller must NOT treat that as done; see the intro trigger).
  const frameGalaxy = (ms = 900, filter?: (n: any) => boolean, isIntro = false): boolean => {
    const fg = fgRef.current;
    if (!fg) return false;
    const pts = (dataRef.current.nodes as any[]).filter(
      (n) => n.x != null && !isNaN(n.x) && n.y != null && !isNaN(n.y) && (!filter || filter(n)),
    );
    if (pts.length === 0) {
      fg.zoomToFit(ms, 80, filter);
      return false;
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
      return true;
    }

    fg.cameraPosition({ x: camPos.x, y: camPos.y, z: camPos.z }, center, ms);
    return true;
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

    // Otherwise, check distance — camera to its look-target (what you're actually
    // looking at), NOT distance from the world origin. Origin-distance wrongly
    // reads "zoomed out" when following the ship far from the sun, hiding nearby
    // weak links that then pop back as the ship's radial distance crosses the band.
    const camera = fgRef.current?.camera();
    const lookTarget = fgRef.current?.controls?.()?.target as THREE.Vector3 | undefined;
    const dist = camera ? (lookTarget ? camera.position.distanceTo(lookTarget) : camera.position.length()) : 1200;

    // Hysteresis band around the 800-unit cutoff — same reasoning as linkLodZoomedInRef
    // above: a bare distance check re-evaluated every frame flips visibility on/off every
    // frame while the camera orbits near that exact distance ("lines disappear, camera
    // moves, they pop back for a second, then disappear again").
    const HYST = 80;
    if (shouldRenderLinkCloseRef.current) {
      if (dist > 800 + HYST) shouldRenderLinkCloseRef.current = false;
    } else if (dist < 800 - HYST) {
      shouldRenderLinkCloseRef.current = true;
    }

    // Only render inactive/weak links if close
    return shouldRenderLinkCloseRef.current;
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

  // Phase 2.1 bounded Detailed-link selection (soumaya-galaxy-bounded-render-
  // architecture.md §15 Phase 2 / soumaya-galaxy-large-small-workload-diff-audit.md).
  // Reuses the SAME weight/activity signals `linkColor`/`linkWidthCb` already compute
  // above, plus the existing `cluster`/`activeId`/`node.importance` state — no new
  // intelligence, no new per-link query. Deliberately event-driven: called only from the
  // data/cluster/activeId effects near the top of this component and from `flyTo` below,
  // NEVER from tick()/the rAF loop, per the architecture doc's explicit "never put a
  // full link-ranking pass in the uncapped RAF loop" requirement. A no-op (clears the ref
  // to null) unless `?boundedLinks=1` is set, so `linkVisibility` falls back to today's
  // exact unbounded behavior by default — this is a feature-flagged, real-device-A/B-only
  // change in this phase, not yet a default-on production behavior change.
  const recomputeDetailedLinks = () => {
    if (!boundedLinksOn) {
      detailedLinkIdsRef.current = null;
      return;
    }
    const links = dataRef.current.links as any[];
    const byId = nodeByIdRef.current;
    const input: LinkSelectionInput[] = links.map((l) => ({
      key: linkKey(l),
      sourceId: linkEnd(l.source),
      targetId: linkEnd(l.target),
      weight: l.weight ?? 0.4,
      activity: getLinkActivity(l),
    }));
    // "Active" = whatever the existing isLit()/shouldRenderLink() machinery already
    // treats as focused (hover-or-selection, via `activeIdRef`), plus whatever node is
    // currently camera-followed — both id spaces already exist in this file; nothing new
    // is computed here.
    const activeNodeIds = new Set<number>();
    if (activeIdRef.current != null) activeNodeIds.add(activeIdRef.current);
    if (followRef.current != null) activeNodeIds.add(followRef.current);
    const nodeImportance = new Map<number, number>();
    for (const [id, n] of byId) nodeImportance.set(id, (n as any)?.importance ?? 0);
    detailedLinkIdsRef.current = selectDetailedLinks(input, {
      budget: detailedLinkBudget,
      activeNodeIds,
      clusterIds: clusterRef.current,
      nodeImportance,
      previousDetailedKeys: detailedLinkIdsRef.current ?? undefined,
    });
  };
  recomputeDetailedLinksRef.current = recomputeDetailedLinks;

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
      flyToGalaxyEntity: (kind: "journey" | "bill" | "goal", id: number) => {
        // Modeled on isolateLayer's own one-shot bounding-sphere framing above, NOT on
        // flyTo's follow-lock (`followRef.current = n.id`) — a journey/bill/goal id lives
        // in a completely different id space than memory node ids, so setting followRef
        // to one could silently "follow" an unrelated memory that happens to share the
        // same numeric id every frame afterward. This never touches followRef at all.
        const s = sceneryRef.current;
        const group = kind === "journey" ? s.journeyhubs : s.moneysky;
        if (!group || group.visible === false) return false;
        const obj = group.children.find((c: any) =>
          kind === "journey" ? c.userData?.journeyId === id : c.userData?.moneyKind === kind && c.userData?.moneyId === id,
        );
        const fg = fgRef.current;
        const cam = fg?.camera?.() as THREE.PerspectiveCamera | undefined;
        if (!obj || !fg || !cam) return false;
        followRef.current = null;
        followObjRef.current = null;
        followKindRef.current = null;
        const worldPos = new THREE.Vector3();
        obj.getWorldPosition(worldPos);
        const fov = ((cam.fov ?? 60) * Math.PI) / 180;
        // A single small body needs a much tighter frame than isolateLayer's whole-ring
        // bounding sphere — 220 units keeps it comfortably filling the view regardless of fov.
        const dist = 220 / Math.sin(fov / 2);
        const dir = new THREE.Vector3(0.3, 0.45, 1).normalize();
        const pos = worldPos.clone().addScaledVector(dir, dist);
        fg.cameraPosition({ x: pos.x, y: pos.y, z: pos.z }, { x: worldPos.x, y: worldPos.y, z: worldPos.z }, 900);
        return true;
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

  // Perf: stabilize the two <ForceGraph3D> callback props that three-forcegraph's own
  // internal node/link object caches key their invalidation on
  // (docs/specs/soumaya-galaxy-react-prop-identity-audit.md). Passed inline, these were fresh
  // closures on every Graph3D render — including renders wholly unrelated to the Galaxy's own
  // data (e.g. App.tsx's useCountUp tween) — which react-kapsule observes as "changed" by
  // reference and forwards to three-forcegraph, wiping and rebuilding every currently-tracked
  // node/link Object3D (nodeDataMapper.clear()/linkDataMapper.clear() → _deallocate()) for no
  // visual reason. Confirmed safe by the audit: nodeThreeObject closes only over refs
  // (nodeThreeObjCacheRef, gfxRef), so `[]` is correct with no stale-closure risk. linkWidth
  // transitively reads `activeId` (via shouldRenderLink) — NOT a ref — so it must depend on
  // `[activeId]`; memoizing it with `[]` would freeze hover/selection-driven link width at
  // whatever it was on first render, a real correctness bug, not merely a missed optimization.
  const nodeThreeObjectCb = useCallback((node: any) => {
    // Performance Program Round 3: cache identity is computed by nodeVisualCacheKey
    // (nodeObject.ts), which buckets `entropy` instead of using it raw — see that
    // function's doc comment for why.
    const cacheKey = nodeVisualCacheKey(node);
    const cached = nodeThreeObjCacheRef.current.get(node.id);
    let obj;
    // Cache-disposal desync fix (docs/specs/soumaya-galaxy-cache-disposal-audit.md): a
    // matching key alone isn't enough — three-forcegraph's own internal node cache can be
    // cleared (and its Object3Ds disposed) independently of this cache, so also require the
    // cached object to still be attached to the scene (see isNodeCacheEntryValid's doc
    // comment for the full mechanism).
    if (isNodeCacheEntryValid(cached, cacheKey)) {
      obj = cached!.obj; // isNodeCacheEntryValid only returns true when `cached` is defined
    } else {
      if (cached) {
        releaseNodeTextures(cached.obj); // Stage 7: release the superseded build's label/glow claims
        disposeObject3D(cached.obj); // free the superseded build's VRAM
      }
      obj = makeNodeObject(node, gfxRef.current?.detailTier ?? "quality");
      // Galaxy Performance Isolation Mode: applied ONCE here at construction time
      // (not per frame) — a freshly-built node's children are classified via tags
      // nodeObject.ts already sets for other reasons (see shouldHideNodeChild), and
      // hidden (not removed/disposed) for any diagnostically-disabled category. This
      // result gets cached below like any other node build, so it costs nothing on
      // subsequent cache hits.
      if (diag.enabled || nodeBodyDiag.enabled) {
        for (const child of obj.children) {
          if (isDiagForceHidden(child)) child.visible = false;
        }
      }
      nodeThreeObjCacheRef.current.set(node.id, { obj, key: cacheKey });
    }
    return obj;
  }, []);

  const linkWidthCb = useCallback(
    (l: any) => {
      if (!shouldRenderLink(l)) return 0;
      // The LINE itself is the glow. A tended connection swells into a fat, bright
      // tube (quadratic in activity, so the bloom pass lights it up), then thins back
      // to a clean resting filament over ~3 days. Cold links stay slim but visible.
      const activity = getLinkActivity(l);
      return 0.7 + (l.weight ?? 0.4) * 0.9 + activity * activity * 5;
    },
    [activeId],
  );

  // Extracted (unchanged logic) so linkPositionUpdateCb below can compute the exact
  // same curvature three-forcegraph itself would have used, without duplicating the
  // formula — both this function and the <ForceGraph3D linkCurvature> prop call it.
  const computeLinkCurvature = (l: any) => {
    const activity = getLinkActivity(l);
    // "Macro zoom" = camera to its look-target (see shouldRenderLink) — not
    // origin-distance, which misreads a close follow far from the sun.
    const camera = fgRef.current?.camera();
    const lookTarget = fgRef.current?.controls?.()?.target as THREE.Vector3 | undefined;
    const dist = camera ? (lookTarget ? camera.position.distanceTo(lookTarget) : camera.position.length()) : 1200;

    // At macro zoom (> 800 distance), links curve significantly with organic wavy variance per link
    if (dist > 800) {
      const linkSeed = l.id || 0;
      const baseCurvature = 0.25 + Math.abs(Math.sin(linkSeed * 1.7)) * 0.15;
      return baseCurvature + activity * 0.18;
    }

    return 0.12 + activity * 0.16; // active lines wander/curve more organically
  };

  // Perf: reuse curved-link tube geometry across frames instead of the per-frame
  // rebuild three-forcegraph's own layoutTick() otherwise does for every curved link
  // (see linkTube.ts's doc comment — this is the confirmed dominant cause of the
  // data-dependent 0-1 FPS collapse on a large/full Galaxy View, per the Round 4
  // regression audit). Returning true from linkPositionUpdate tells three-forcegraph
  // to skip its own calcLinkCurve()+geometry-rebuild for a link entirely.
  // Tube-sync: a full tube recompute per link per frame (Frenet frames + ~217
  // sin/cos vertex writes + dual GPU buffer uploads, ×941 links) collapsed FPS
  // to ~5 once the d3 engine stopped cooling down. But a fixed time-shard made
  // tubes visibly step (~10Hz) instead of tracking smoothly. Solution: sync
  // every frame for links near what you're looking at (smooth where visible),
  // and for the rest only when their endpoints actually moved (epsilon-gated) —
  // orbit drift is sub-pixel per frame, so most links skip most frames. A slow
  // time-shard remains as backstop for width/curvature drift on still links.
  // Returning true keeps the old geometry and tells three-forcegraph to skip
  // its own rebuild for skipped links.
  const TUBE_SYNC_SHARDS = 6;
  const TUBE_SYNC_MS = 100;
  const TUBE_EPS = 0.12; // world units; endpoint drift below this is sub-pixel
  const TUBE_NEAR_TARGET = 350; // links this close to the look-target sync every frame
  const lastTubePosRef = useRef(new Map<any, number[]>());
  const linkPositionUpdateCb = useCallback(
    (obj: any, pos: LinkPositions, link: any) => {
      const linkId = link?.id;
      // Smooth where it matters: near the look-target (e.g. a focused planet's
      // links), tubes track every frame — no stepping.
      const target = fgRef.current?.controls?.()?.target as THREE.Vector3 | undefined;
      let nearTarget = false;
      if (target) {
        const mx = (pos.start.x + pos.end.x) * 0.5;
        const my = ((pos.start.y || 0) + (pos.end.y || 0)) * 0.5;
        const mz = ((pos.start.z || 0) + (pos.end.z || 0)) * 0.5;
        const dx = mx - target.x, dy = my - target.y, dz = mz - target.z;
        nearTarget = dx * dx + dy * dy + dz * dz < TUBE_NEAR_TARGET * TUBE_NEAR_TARGET;
      }

      if (!nearTarget) {
        const last = lastTubePosRef.current.get(linkId);
        if (last) {
          const dx1 = pos.start.x - last[0], dy1 = (pos.start.y || 0) - last[1], dz1 = (pos.start.z || 0) - last[2];
          const dx2 = pos.end.x - last[3], dy2 = (pos.end.y || 0) - last[4], dz2 = (pos.end.z || 0) - last[5];
          const eps2 = TUBE_EPS * TUBE_EPS;
          const moved = dx1 * dx1 + dy1 * dy1 + dz1 * dz1 > eps2 || dx2 * dx2 + dy2 * dy2 + dz2 * dz2 > eps2;
          if (!moved) {
            const linkShard = Math.abs(Number(linkId) || 0) % TUBE_SYNC_SHARDS;
            if (Math.floor(performance.now() / TUBE_SYNC_MS) % TUBE_SYNC_SHARDS !== linkShard) {
              return true;
            }
          }
        }
      }

      const ok = curvedLinkGeometryRef.current.update(obj, pos, link, linkWidthCb(link), computeLinkCurvature(link));
      lastTubePosRef.current.set(linkId, [
        pos.start.x, pos.start.y || 0, pos.start.z || 0,
        pos.end.x, pos.end.y || 0, pos.end.z || 0,
      ]);
      return ok;
    },
    [linkWidthCb],
  );

  // Far-zoom labels: guarantee the recentered whole-galaxy view is never empty.
  // The threshold is memoized on the node array and applied during render (not
  // in an effect) so it is current before three-forcegraph's digest calls
  // nodeThreeObject/nodeVisualCacheKey for this data.
  const sectorTitleThreshold = useMemo(
    () => sectorTitleThresholdFor(data.nodes as any[]),
    [data.nodes],
  );
  setSectorTitleMassThreshold(sectorTitleThreshold);

  return (
    <ForceGraph3D
      ref={fgRef}
      graphData={data as any}
      backgroundColor={BG}
      showNavInfo={false}
      warmupTicks={0}
      // Galaxy render recovery pass (2026-09-10): this used to run the D3 force
      // simulation FOREVER (9999999 ticks/ms — i.e. never stops). That is pure waste:
      // orbits.ts's own doc comment states its whole design premise — "Positions are
      // written to node.fx/fy/fz each frame so the force engine leaves them alone" —
      // meaning whatever the simulation computes is discarded every single frame,
      // regardless of how long it keeps ticking. The only registered force is `link`
      // at strength 0 (charge/center were already removed, d24f7cc, the one PROVEN
      // real-device win), so continuing to tick it forever computes work for 941 links
      // that no code ever reads. A real-device measurement (Xclipse 530, hardware-
      // accelerated) after cutting render-path draw calls by ~84% still showed present
      // (frame-to-frame) time stuck at ~1.8s while render() itself dropped to 14.6ms
      // median -- i.e. the stall moved from INSIDE renderer.render() to somewhere in
      // three-forcegraph's OTHER per-frame work, which our own tick()/render()
      // instrumentation cannot see. tickFrame()'s own d3-simulation branch
      // (state.layout.tick(), three-forcegraph.mjs) is the one candidate in that path
      // that scales with total (not just visible/tracked) link count and has never
      // been bounded in this program -- unlike the charge-force removal, this is safe
      // to test without repeating the KNOWN regression (soumaya-galaxy-force-removal-
      // regression.md): endpoint-id resolution happens via forceLink().links()'s
      // SETTER call, not via ticking, and three-forcegraph's own resetCountdown()
      // (three-forcegraph.mjs) reheats this exact allotment on every graphData change,
      // so the resolution mechanism is untouched -- only the ONGOING, already-
      // discarded per-frame tick work stops once settled. A small nonzero allotment
      // (not 0) is kept as a conservative margin against any other code path that
      // might read a link's resolved endpoints before orbits.ts's own first update.
      // Effectively never stops: the d3 engine must keep ticking every frame,
      // because layoutTick() is the ONLY path that refreshes link-tube geometry
      // to match the orbit system's per-frame mesh moves. Letting it cool down
      // (the old 30/2000) froze tube positions while meshes kept moving — a
      // focused planet visibly drifted off its lines until a re-render reheated
      // the engine for one sync frame. The tick itself is trivially cheap now
      // (charge/center forces nulled, link strength 0, all nodes fx/fy/fz-pinned),
      // so an always-on engine costs ~nothing — see the comment above.
      cooldownTicks={1000000000}
      cooldownTime={86400000}
      nodeVisibility={(n: any) => !cluster || cluster.has(n.id)}
      linkVisibility={(l: any) => {
        // Galaxy Performance Isolation Mode: LINKS off. Uses the exact same mechanism
        // three-forcegraph already uses for a cluster isolate (§6 of the rendering-
        // architecture audit) — a link failing this filter is fully excluded from
        // three-forcegraph's own tracked object set, not merely `.visible = false`'d.
        if (diag.enabled && !diag.links) return false;
        // Isolate-system view filters to the selected cluster.
        if (cluster && !(cluster.has(linkEnd(l.source)) && cluster.has(linkEnd(l.target)))) return false;
        // Phase 2.1 bounded Detailed-link selection (soumaya-galaxy-bounded-render-
        // architecture.md). `detailedLinkIdsRef` is null unless `?boundedLinks=1` is
        // set (see recomputeDetailedLinks above), so this branch is a complete no-op by
        // default — every line below is byte-for-byte the same as before this phase.
        // When enabled, a link NOT in the current Detailed selection is excluded from
        // three-forcegraph's tracked object set entirely — BEFORE any TubeGeometry/Mesh
        // is ever constructed for it (the actual expensive step the architecture audit
        // identified), not built-then-hidden. Documented, deliberate limitation for this
        // phase: an excluded link has no Simplified-tier fallback yet — it is fully
        // invisible while this flag is on, not merely dimmed; that fallback is the next
        // phase's job (soumaya-galaxy-bounded-render-architecture.md §5/§15 Phase 3).
        const detailed = detailedLinkIdsRef.current;
        if (detailed && !detailed.has(linkKey(l))) return false;
        if (cluster) return true; // isolate view: every remaining (in-cluster, budget-cleared) link draws
        // LEVEL-OF-DETAIL: on a DENSE brain, drawing every faint filament at macro zoom
        // is what makes a big galaxy lag on a phone. So when there are many links AND the
        // camera is pulled back, draw only the STRONGER / actively-tended connections;
        // zoom in past LINK_LOD_ZOOM and every link returns. Small graphs draw everything.
        const total = dataRef.current.links.length;
        if (total <= LINK_LOD_MIN) return true;
        // "Zoomed out" = camera to its look-target, not to the world origin (see
        // shouldRenderLink above for why origin-distance is the wrong metric).
        const camera = fgRef.current?.camera();
        const lookTarget = fgRef.current?.controls?.()?.target as THREE.Vector3 | undefined;
        const dist = camera ? (lookTarget ? camera.position.distanceTo(lookTarget) : camera.position.length()) : 1200;
        // Hysteresis band around LINK_LOD_ZOOM (see linkLodZoomedInRef above) — without
        // it, orbiting the camera near this exact distance flipped every link's
        // visibility on/off every single frame ("lines disappear and pop back up").
        const HYST = 80;
        if (linkLodZoomedInRef.current) {
          if (dist > LINK_LOD_ZOOM + HYST) linkLodZoomedInRef.current = false;
        } else if (dist < LINK_LOD_ZOOM - HYST) {
          linkLodZoomedInRef.current = true;
        }
        if (linkLodZoomedInRef.current) return true; // zoomed in: full detail
        const strength = (l.weight ?? 0.4) + getLinkActivity(l);
        return strength >= LINK_LOD_CUTOFF;
      }}
      nodeThreeObject={nodeThreeObjectCb}
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
      linkWidth={linkWidthCb}
      linkCurvature={computeLinkCurvature}
      linkPositionUpdate={linkPositionUpdateCb}
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
