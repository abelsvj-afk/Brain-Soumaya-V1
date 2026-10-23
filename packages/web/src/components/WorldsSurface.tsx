import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { WORLDS_TRAVEL_ENABLED } from "@brain/shared";
import { useTravel } from "../hooks/useTravel.js";
import { createStationScene } from "../graph/stationScene.js";
import { STATION_PALETTE } from "../graph/stationLayout.js";
import WorldCredits from "./WorldCredits.js";

/**
 * The worlds surface view (Phase 2, P2-4 — the mount the P2-3 audit's
 * F-01 reconciled as deliberately deferred to here). A GalaxyViews
 * sibling in the overlay layer: when the travel flag is on AND the
 * server's travel state places the brain at the Great Station, the
 * Station scene (P2-3's createStationScene — hull, accessories, and
 * the real HYG sky) mounts in a full-screen surface.
 *
 * Dark contract, same as the panel's: while the flag is off this
 * renders nothing, fetches nothing, and never touches three.js or
 * the scene. The host owns the renderer, camera, and fog (the scene
 * module's stated contract); the camera is presentation — a slow,
 * monumental orbit, frozen under reduced motion. Closing the surface
 * is view-only: the brain stays where the server says it is, and the
 * travel panel is how it journeys on.
 */
export default function WorldsSurface({ enabled = WORLDS_TRAVEL_ENABLED }: { enabled?: boolean }) {
  const travel = useTravel(enabled);
  const [dismissed, setDismissed] = useState(false);
  const [showCredits, setShowCredits] = useState(false);
  const [graphicsFailed, setGraphicsFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const atStation =
    enabled && travel.state?.currentWorld === "great-station" && !travel.state?.activeJourney;
  const visible = atStation && !dismissed;

  // A new stay at the Station (leaving and returning) reopens the view.
  useEffect(() => {
    if (!atStation) setDismissed(false);
  }, [atStation]);

  useEffect(() => {
    if (!visible) return;
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
    scene.background = new THREE.Color(STATION_PALETTE.indigo);
    scene.fog = new THREE.FogExp2(STATION_PALETTE.indigo, 0.00016);
    const camera = new THREE.PerspectiveCamera(
      55,
      host.clientWidth / Math.max(1, host.clientHeight),
      1,
      9000,
    );
    const station = createStationScene();
    scene.add(station.group);

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
    const ORBIT_RADIUS = 1250;
    const frame = () => {
      const elapsed = performance.now() - startedAt;
      station.update(elapsed, { reducedMotion });
      const angle = reducedMotion ? BASE_ANGLE : BASE_ANGLE + elapsed * 0.0000045;
      camera.position.set(Math.sin(angle) * ORBIT_RADIUS, 240, Math.cos(angle) * ORBIT_RADIUS);
      camera.lookAt(0, 0, 0);
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
      station.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <section className="worlds-surface" role="dialog" aria-label="The Great Station">
      <div className="worlds-surface-canvas" ref={hostRef} />
      <header className="worlds-surface-bar">
        <h3>The Great Station</h3>
        <button type="button" onClick={() => setDismissed(true)}>
          Back to your galaxy
        </button>
      </header>
      {graphicsFailed && (
        <p className="worlds-surface-fallback">
          The Station view needs graphics support on this device — your journeys are unaffected.
        </p>
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
