import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import type { GraphData, Journey } from "@brain/shared";
import { useTravel } from "../hooks/useTravel.js";
import { getJourneys } from "../api/journeys.js";
import { createStationScene } from "../graph/stationScene.js";
import { STATION_PALETTE } from "../graph/stationLayout.js";
import { buildGardenLayout, type GardenLayout } from "../graph/gardenLayout.js";
import { createGardenScene } from "../graph/gardenScene.js";
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
 * Worlds (P3-1): the Great Station (P2-4) and the Growing Place (the
 * garden — plots = real memories, paths = real connections, landmarks =
 * completed Journeys, all derived per-visit from the graph the app
 * already holds). The garden renders the graph data the app holds — the
 * same window the home galaxy sees — via the `graph` prop from App; it
 * never fetches its own copy of the brain. Journeys are fetched on
 * garden entry for the landmarks; if that fetch fails, landmarks are
 * simply absent and the surface says so honestly.
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
 * The ship is the procedural hull: the soumaya-ship.glb license is
 * unconfirmed (see the P2-5 audit brief), so the GLB is not loaded here.
 * Engine audio rides along, gated by the interface-sounds setting.
 * Arming still shows nothing — the user is still at the origin world and
 * the panel owns the countdown.
 */

interface WorldSceneEntry {
  title: string;
  background: number;
  fogDensity: number;
  orbitRadius: number;
  orbitHeight: number;
  lookAtY: number;
  fallback: string;
  build: (layout?: GardenLayout) => { group: THREE.Group; update: (ms: number, opts?: { reducedMotion?: boolean }) => void; dispose: () => void };
}

const WORLD_SCENES: Record<string, WorldSceneEntry> = {
  "great-station": {
    title: "The Great Station",
    background: STATION_PALETTE.indigo,
    fogDensity: 0.00016,
    orbitRadius: 1250,
    orbitHeight: 240,
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
    build: (layout) => createGardenScene(layout ?? { plots: [], paths: [], landmarks: [], eligibleCount: 0, excludedCount: 0, omittedEdgeCount: 0 }),
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
  const worldName = (key: string) =>
    WORLD_CHART.find((w) => w.key === key)?.name ?? key;
  const transitTitle = inTransit ? `Travelling to ${worldName(journey.destination)}` : "";
  const transitFallback =
    "The journey view needs graphics support on this device — your journey is unaffected.";

  // A new stay — a new world, or a new journey — reopens the view. (A
  // transit dismissed mid-flight reopens at arrival: the destination scene
  // is a new stay, not the dismissed transit.)
  const journeyId = journey?.id ?? null;
  useEffect(() => {
    setDismissed(false);
    setGraphicsFailed(false);
  }, [mode, currentWorld, journeyId]);

  // Landmarks need the user's Journeys; the graph prop already carries the
  // memories. A failed fetch omits landmarks and says so — it never blocks
  // the garden, and it never invents a landmark.
  useEffect(() => {
    if (!atGarden) return;
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
  }, [atGarden]);

  // The garden layout derives from the app's graph on every data change —
  // the world re-reads the brain; it stores nothing of its own.
  const layout = useMemo<GardenLayout | undefined>(() => {
    if (!atGarden || !graph) return undefined;
    return buildGardenLayout(graph, journeys ?? []);
  }, [atGarden, graph, journeys]);

  useEffect(() => {
    if (!visible || !mode) return;
    // The garden needs the graph before it can build; until then the dialog
    // shows its loading line (see the render below) and builds nothing.
    if (mode === "world" && currentWorld === "growing-place" && !layout) return;
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
          ? entry.build(layout)
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
        const angle = reducedMotion ? BASE_ANGLE : BASE_ANGLE + elapsed * 0.0000045;
        camera.position.set(
          Math.sin(angle) * orbit.orbitRadius,
          orbit.orbitHeight,
          Math.cos(angle) * orbit.orbitRadius,
        );
        camera.lookAt(0, orbit.lookAtY, 0);
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
      engine?.dispose();
      world.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [visible, mode, entry, currentWorld, layout, transitKind, transitTotalMs, journey?.origin, journey?.destination]);

  if (!visible || !mode) return null;
  const title = mode === "transit" ? transitTitle : (entry?.title ?? "");
  const fallback = mode === "transit" ? transitFallback : (entry?.fallback ?? "");

  return (
    <section className="worlds-surface" role="dialog" aria-label={title}>
      <div className="worlds-surface-canvas" ref={hostRef} />
      <header className="worlds-surface-bar">
        <h3>{title}</h3>
        <button type="button" onClick={() => setDismissed(true)}>
          Back to your galaxy
        </button>
      </header>
      {mode === "world" && currentWorld === "growing-place" && !layout && (
        <p className="worlds-surface-fallback">Your garden is loading — your memories are unaffected.</p>
      )}
      {mode === "world" && journeysFailed && (
        <p className="worlds-surface-fallback">
          Landmarks couldn&apos;t load — your garden is unaffected.
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
