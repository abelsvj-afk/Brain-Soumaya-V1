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
  const atWorld =
    enabled &&
    !!currentWorld &&
    currentWorld in WORLD_SCENES &&
    !travel.state?.activeJourney;
  const visible = atWorld && !dismissed;
  const entry = atWorld && currentWorld ? WORLD_SCENES[currentWorld] : undefined;
  const atGarden = atWorld && currentWorld === "growing-place";

  // A new stay in a world (leaving and returning) reopens the view.
  useEffect(() => {
    if (!atWorld) {
      setDismissed(false);
      setGraphicsFailed(false);
    }
  }, [atWorld]);

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
    if (!visible || !entry) return;
    // The garden needs the graph before it can build; until then the dialog
    // shows its loading line (see the render below) and builds nothing.
    if (currentWorld === "growing-place" && !layout) return;
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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(entry.background);
    scene.fog = new THREE.FogExp2(entry.background, entry.fogDensity);
    const camera = new THREE.PerspectiveCamera(
      55,
      host.clientWidth / Math.max(1, host.clientHeight),
      1,
      9000,
    );
    const world = entry.build(layout);
    scene.add(world.group);

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
      const angle = reducedMotion ? BASE_ANGLE : BASE_ANGLE + elapsed * 0.0000045;
      camera.position.set(
        Math.sin(angle) * entry.orbitRadius,
        entry.orbitHeight,
        Math.cos(angle) * entry.orbitRadius,
      );
      camera.lookAt(0, entry.lookAtY, 0);
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
      world.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [visible, entry, currentWorld, layout]);

  if (!visible || !entry) return null;

  return (
    <section className="worlds-surface" role="dialog" aria-label={entry.title}>
      <div className="worlds-surface-canvas" ref={hostRef} />
      <header className="worlds-surface-bar">
        <h3>{entry.title}</h3>
        <button type="button" onClick={() => setDismissed(true)}>
          Back to your galaxy
        </button>
      </header>
      {currentWorld === "growing-place" && !layout && (
        <p className="worlds-surface-fallback">Your garden is loading — your memories are unaffected.</p>
      )}
      {journeysFailed && (
        <p className="worlds-surface-fallback">
          Landmarks couldn&apos;t load — your garden is unaffected.
        </p>
      )}
      {graphicsFailed && <p className="worlds-surface-fallback">{entry.fallback}</p>}
      <footer className="worlds-surface-credits">
        <button type="button" onClick={() => setShowCredits((v) => !v)}>
          {showCredits ? "Hide credits" : "Credits"}
        </button>
        {showCredits && <WorldCredits />}
      </footer>
    </section>
  );
}
