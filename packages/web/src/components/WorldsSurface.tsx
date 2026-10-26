import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import type { GraphData, Journey, JourneyLinkSummary } from "@brain/shared";
import { useTravel } from "../hooks/useTravel.js";
import { getJourneys, journeyLinks } from "../api/journeys.js";
import { createStationScene } from "../graph/stationScene.js";
import {
  STATION_ARRIVAL_MS,
  STATION_ORBIT_HEIGHT,
  STATION_ORBIT_RADIUS,
  STATION_PALETTE,
  approachPose,
} from "../graph/stationLayout.js";
import { ensureKtx2Support } from "../graph/gltf.js";
import { buildGardenLayout, type GardenLayout } from "../graph/gardenLayout.js";
import { createGardenScene } from "../graph/gardenScene.js";
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
import WorldCredits from "./WorldCredits.js";
import { createTransitScene } from "../graph/transitScene.js";
import { TRANSIT_MS } from "./TravelPanel.js";
import { makeEngineAudio } from "../graph/engineAudio.js";
import { WORLD_CHART } from "../lib/routeBoard.js";

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
 * and the Deep Past (the helix — members = old memories by the D-7 rule,
 * anchors = links to their other appearances, the Chronicle thread = the
 * earliest done Journey with two member stops). Each world renders the graph
 * data the app already holds — the same window the home galaxy sees — via
 * the `graph` prop from App; none fetches its own copy of the brain.
 * Journeys are fetched on garden/deep-past entry (landmarks / routes); if a
 * fetch fails, the world renders without that layer and says so honestly.
 *
 * Dark contract, same as the panel's: while the flag is off this renders
 * nothing, fetches nothing, and never touches three.js or any scene. The
 * host owns the renderer, camera, and fog; each scene module owns its
 * group and its per-frame motion. The camera is presentation — a slow,
 * monumental orbit, frozen under reduced motion. Closing the surface is
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
}

function isGardenLayout(
  layout: GardenLayout | DeepPastLayout | undefined,
): layout is GardenLayout {
  return !!layout && "plots" in layout;
}

function isDeepPastLayout(
  layout: GardenLayout | DeepPastLayout | undefined,
): layout is DeepPastLayout {
  return !!layout && "members" in layout;
}

interface WorldSceneEntry {
  title: string;
  background: number;
  fogDensity: number;
  orbitRadius: number;
  orbitHeight: number;
  lookAtY: number;
  fallback: string;
  build: (layout?: GardenLayout | DeepPastLayout) => WorldSceneHandle;
}

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
    fallback: "The garden view needs graphics support on this device — your memories are unaffected.",
    build: (layout) =>
      createGardenScene(
        isGardenLayout(layout)
          ? layout
          : { plots: [], paths: [], landmarks: [], eligibleCount: 0, excludedCount: 0, omittedEdgeCount: 0 },
      ),
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
};

export default function WorldsSurface({
  enabled = WORLDS_TRAVEL_ENABLED,
  graph = null,
}: {
  enabled?: boolean;
  graph?: GraphData | null;
}) {
  const travel = useTravel(enabled);
  const [dismissed, setDismissed] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [graphicsFailed, setGraphicsFailed] = useState(false);
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [journeysFailed, setJourneysFailed] = useState(false);
  const [journeyLinksMap, setJourneyLinksMap] = useState<Map<number, JourneyLinkSummary[]> | null>(null);
  const [guided, setGuided] = useState(false);
  const guidedRef = useRef(false);
  const descentStartedAtRef = useRef(0);
  const descentFromRef = useRef(0);
  const parkedProgressRef = useRef(0);
  const lastProgressRef = useRef(0);
  // Station arrival glide (A13): any pointer press skips it. Reset per stay.
  const arrivalSkippedRef = useRef(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

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
  const atDeepPast = atWorld && currentWorld === "deep-past";
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
    guidedRef.current = false;
    parkedProgressRef.current = 0;
    lastProgressRef.current = 0;
    arrivalSkippedRef.current = false;
  }, [mode, currentWorld, journeyId]);

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

  // The garden layout derives from the app's graph on every data change —
  // the world re-reads the brain; it stores nothing of its own.
  const layout = useMemo<GardenLayout | undefined>(() => {
    if (!atGarden || !graph) return undefined;
    return buildGardenLayout(graph, journeys ?? []);
  }, [atGarden, graph, journeys]);

  // The Deep Past layout derives the same way, plus the fetched Journey
  // links that make the Chronicle thread. No links yet → no thread yet;
  // the helix still renders, honestly, without it.
  const deepPastLayout = useMemo<DeepPastLayout | undefined>(() => {
    if (!atDeepPast || !graph) return undefined;
    return buildDeepPastLayout(graph, journeys ?? [], journeyLinksMap ?? new Map());
  }, [atDeepPast, graph, journeys, journeyLinksMap]);

  const sceneLayout = currentWorld === "growing-place" ? layout : currentWorld === "deep-past" ? deepPastLayout : undefined;

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
    // builds nothing.
    if (mode === "world" && (atGarden || atDeepPast) && !sceneLayout) return;
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
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
    const world =
      mode === "transit"
        ? createTransitScene({
            kind: transitKind ?? "warp",
            totalMs: transitTotalMs,
            origin: journey?.origin ?? "home",
            destination: journey?.destination ?? "home",
          })
        : entry
          ? entry.build(sceneLayout)
          : null;
    if (!world) return;
    scene.add(world.group);
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
    // straight into the resting orbit.
    const skipArrival = () => {
      arrivalSkippedRef.current = true;
    };
    host.addEventListener("pointerdown", skipArrival);

    let raf = 0;
    const startedAt = performance.now();
    const BASE_ANGLE = 0.6;
    const frame = () => {
      const elapsed = performance.now() - startedAt;
      world.update(elapsed, { reducedMotion });
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
      }
      try {
        renderer.render(scene, camera);
      } catch {
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
      engine?.dispose();
      world.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [visible, mode, entry, currentWorld, sceneLayout, transitKind, transitTotalMs, journey?.origin, journey?.destination]);

  if (!visible || !mode) return null;
  const title = mode === "transit" ? transitTitle : (entry?.title ?? "");
  const fallback = mode === "transit" ? transitFallback : (entry?.fallback ?? "");
  const thread = atDeepPast ? deepPastLayout?.thread ?? null : null;

  return (
    <section className="worlds-surface" role="dialog" aria-label={title}>
      <div className="worlds-surface-canvas" ref={hostRef} />
      <header className="worlds-surface-bar">
        <h3>{title}</h3>
        {atDeepPast && thread && (
          <button type="button" onClick={toggleGuided}>
            {guided ? "Back to the rim" : "Descend the Chronicle"}
          </button>
        )}
        <button type="button" onClick={() => setDismissed(true)}>
          Back to your galaxy
        </button>
      </header>
      {mode === "world" && currentWorld === "growing-place" && !layout && (
        <p className="worlds-surface-fallback">Your garden is loading — your memories are unaffected.</p>
      )}
      {mode === "world" && currentWorld === "deep-past" && !deepPastLayout && (
        <p className="worlds-surface-fallback">Your past is loading — your memories are unaffected.</p>
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
      {graphicsFailed && <p className="worlds-surface-fallback">{fallback}</p>}
      <footer className="worlds-surface-credits">
        <button type="button" onClick={() => setShowCredits((v) => !v)}>
          {showCredits ? "Hide credits" : "Credits"}
        </button>
        {showCredits && <WorldCredits />}
      </footer>
    </section>
  );
}
