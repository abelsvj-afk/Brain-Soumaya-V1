/* eslint-disable @typescript-eslint/no-explicit-any */
import * as THREE from "three";
// Pure helpers (vector conv, smoothstep, task-label sprite, body radius) live in
// soumayaHelpers.ts (Post-MVP D4 split); behaviour unchanged.
import { vecOf, smooth, makeTaskLabel, makeSpeechBubble, bodyRadius } from "./soumayaHelpers.js";
import { gltfLoader, fadeSwapIn, noteModelFallback } from "./gltf.js";
import { SUN_RADIUS_MAX } from "./sun.js";
import { getNextMaintenanceJob, completeMaintenanceJob, type MaintenanceJob } from "../api/client.js";
import { playSfx } from "./sfx.js";
import { shipTaskLabel } from "../lib/jobLabels.js";

/** Free GPU resources for a swapped-out ship model so skin changes don't leak VRAM. */
function disposeModel(obj: THREE.Object3D): void {
  obj.traverse((o: any) => {
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
}

/** A connection Soumaya should personally fly out and forge (source → target). */
export interface LinkTask {
  id?: string;
  source: number;
  target: number;
  key: string;
}

/** A discarded memory Soumaya should drag to the Sun and fling in (deletion). */
export interface RemovalTask {
  id?: string;
  x: number;
  y: number;
  z: number;
  color?: string;
  size?: number;
}

export interface SoumayaHandle {
  object: THREE.Object3D;
  /** Advance the agent; reads live node/link positions, sparks on arrival. */
  update: (
    dt: number,
    nodes: any[],
    links: any[],
    onArrive: (x: number, y: number, z: number, type: string, nodeId?: number) => void,
    stationPos?: THREE.Vector3 | null,
    onLinkConnect?: (key: string) => void,
    orbit?: { slotOf: (id: number) => THREE.Vector3 | null; release: (id: number) => void },
    fuel?: any,
    cameraTarget?: THREE.Vector3 | null,
  ) => void;
  /** Queue new connections for her to draw herself (takes priority over patrol). */
  enqueueLinks: (tasks: LinkTask[]) => void;
  /** Queue brand-new memories for her to physically ferry from the dock into their
   *  orbit slot (held by the orbit system until she drops them). */
  enqueuePlacements: (ids: number[]) => void;
  /** Queue beacon targets for her to fly to and dispatch (takes priority over patrol). */
  enqueueBeacons: (ids: number[]) => void;
  /** Queue discarded memories for her to drag to the Sun and fling in (deletion). */
  enqueueRemovals: (tasks: RemovalTask[]) => void;
  /** The body she's currently dragging to the Sun — added to the scene by Graph3D
   *  so it animates in world space (not parented to the banking ship). */
  cargo: THREE.Object3D;
  /** Engine plume (world-space puffs) — added to the scene by Graph3D. */
  trail: THREE.Object3D;
  /** Floating "current task" billboard — added to the scene by Graph3D so the
   *  ship's banking never tilts it. Toggle its visibility via setTaskVisible. */
  taskLabel: THREE.Object3D;
  /** Turn the floating task label on/off (user preference). */
  setTaskVisible: (v: boolean) => void;
  /** In-world speech bubble (IM-139) — added to the scene by Graph3D so it
   *  floats anchored above the ship, untitled by her banking. */
  speechBubble: THREE.Object3D;
  /** Speak a reaction in the bubble for a few seconds (her in-world voice:
   *  connection reactions, the mass-cooling concern). Latest call wins. */
  say: (message: string) => void;
  /** Fuel her fast flight has burned since the last read (Graph3D flushes it to spend). */
  getAndResetFuelBurn: () => number;
  getTasks: (nodes: any[]) => { id: string; type: string; label: string; status: "doing" | "planned" | "done" }[];
  reorderTasks: (newOrder: { id: string; type: string; status?: "doing" | "planned" | "done" }[]) => void;
  setShipSkin?: (skin: string) => void;
  setTrailColor?: (color: string) => void;
  /** Progression speed multiplier (~1.0 new pilot → ~1.9 seasoned). Scales every
   *  travel/ferry/delete velocity so she gets faster the more you use the brain. */
  setPilotSpeed?: (v: number) => void;
  /** Autonomously fly into view and show a short message to get the user's
   *  attention (she has something to say). No-op until she's free to do it. */
  hail: (message: string) => void;
  /** Demo galaxy: she flies local patrols only — no real backend jobs are fetched
   *  or completed (demo node ids must never hit the real brain's API). */
  setDemoMode: (v: boolean) => void;
  /** Night Replay: she PERFORMS her real overnight work on arrival — flies to
   *  each memory the 24/7 loop touched and re-enacts it (visual only; replay
   *  never re-executes a job against the backend). */
  enqueueReplays: (items: { id: number; label: string }[]) => void;
}


/**
 * Soumaya — the autonomous maintenance agent. A small low-poly craft that
 * continuously hops between connected memories, performing maintenance tasks
 * (synthesis, calibration, patrol) fetched from the backend.
 */
export function makeSoumaya(initialSkin = "default"): SoumayaHandle {
  const group = new THREE.Group();

  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 4, 10),
    new THREE.MeshStandardMaterial({
      color: "#e6edff",
      emissive: new THREE.Color("#7af9ff"),
      emissiveIntensity: 0.7,
      metalness: 0.7,
      roughness: 0.25,
    }),
  );
  hull.rotation.x = Math.PI / 2; // nose points +Z (direction of travel)
  group.add(hull);

  let currentLoadedModel: THREE.Object3D | null = null;

  const setShipSkin = (skin: string) => {
    // Remove the previously loaded glTF model from group (and free its VRAM)
    if (currentLoadedModel) {
      group.remove(currentLoadedModel);
      disposeModel(currentLoadedModel);
      currentLoadedModel = null;
    }
    
    // Determine path based on skin
    let modelPath: string | null = "/soumaya-ship.glb";
    if (skin === "organic") {
      modelPath = "/organic-spaceship.glb";
    } else if (skin === "fusion_core") {
      // No real GLB has ever been shipped for this skin (it 404s every single time it's
      // selected) — the procedural tinted hull styled just below IS the design for this
      // skin today, not a load-failure fallback. `modelPath = null` skips the always-
      // failing network request + console warning entirely rather than silently eating
      // a 404 on every selection; the visible result is identical either way (the hull
      // stays visible with its fusion_core tint/sheen, exactly as the old failure path
      // already produced).
      modelPath = null;
    }

    // Procedural fallback styling
    const mat = hull.material as THREE.MeshStandardMaterial;
    if (skin === "holographic") {
      mat.wireframe = true;
      mat.color.set("#00f5ff");
      mat.emissive.set("#00aeff");
      mat.transparent = true;
      mat.opacity = 0.6;
    } else if (skin === "fusion_core") {
      mat.wireframe = false;
      mat.color.set("#ff4500");
      mat.emissive.set("#ff8c00");
      mat.transparent = false;
      mat.opacity = 1.0;
    } else {
      mat.wireframe = false;
      mat.color.set("#e6edff");
      mat.emissive.set("#7af9ff");
      mat.transparent = false;
      mat.opacity = 1.0;
    }
    mat.needsUpdate = true;
    
    // Show the procedural fallback first in case GLB fails or while loading
    hull.visible = true;

    if (!modelPath) return; // fusion_core: procedural hull IS the design, nothing to fetch

    gltfLoader().load(
      modelPath,
      (gltf) => {
        // If we loaded another model in the meantime, discard this one
        if (currentLoadedModel) {
          group.remove(currentLoadedModel);
          disposeModel(currentLoadedModel);
        }
        
        const model = gltf.scene;
        
        // If holographic, make all meshes transparent wireframes
        if (skin === "holographic") {
          model.traverse((o: any) => {
            if (o.isMesh) {
              o.material = new THREE.MeshBasicMaterial({
                color: 0x00f5ff,
                wireframe: true,
                transparent: true,
                opacity: 0.45
              });
            }
          });
        } else {
          // The shipped hull GLBs (soumaya-ship/organic/fusion) ship with bare gray
          // materials, so the body renders flat grey. Tint the hull meshes per skin so
          // the ship itself is coloured — this only touches the GLB body; the engine
          // trail/plume/glow are separate code-added effects and stay untouched.
          // Default skin: a cool blue-steel body with a faint cyan sheen (Soumaya's accent).
          const tint =
            skin === "fusion_core" ? new THREE.Color("#ff5a2a")
            : skin === "organic" ? new THREE.Color("#8fe7c0")
            : new THREE.Color("#c2d4f5");
          const sheen =
            skin === "fusion_core" ? new THREE.Color("#ff8c00")
            : skin === "organic" ? new THREE.Color("#1f9e8f")
            : new THREE.Color("#2f7bff");
          model.traverse((o: any) => {
            if (!o.isMesh || !o.material) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
              if (m.color) m.color.copy(tint);
              if (m.emissive) {
                m.emissive.copy(sheen);
                m.emissiveIntensity = 0.3;
              }
              if ("metalness" in m) m.metalness = 0.35;
              if ("roughness" in m) m.roughness = 0.45;
              m.needsUpdate = true;
            }
          });
        }

        const box = new THREE.Box3().setFromObject(model);
        const dim = new THREE.Vector3();
        box.getSize(dim);
        const maxDim = Math.max(dim.x, dim.y, dim.z) || 1;
        const k = 9 / maxDim;
        model.scale.setScalar(k);
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.copy(center.multiplyScalar(-k)); // recenter on origin

        currentLoadedModel = model;
        group.add(model);
        // IM-24: crossfade the real hull in over the procedural one.
        fadeSwapIn(model, () => {
          hull.visible = false;
        });
      },
      undefined,
      (err) => {
        console.warn(`[soumaya] ship skin '${skin}' failed to load; using procedural hull`, err);
        noteModelFallback("Soumaya's ship model");
        // Ensure procedural fallback remains visible
        hull.visible = true;
      }
    );
  };

  // Load the initial ship skin
  setShipSkin(initialSkin);

  // Engine glow trailing behind the nose.
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 64;
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  
  // Engine-trail tint (RGB 0..1), kept in sync with the chosen trail color below.
  let trailRGB = new THREE.Color(0.71, 0.86, 1);

  const setTrailColor = (color: string) => {
    const ctx = glowCanvas.getContext("2d")!;
    ctx.clearRect(0, 0, 64, 64);
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    trailRGB =
      color === "neon" ? new THREE.Color(1, 0.25, 0.6)
      : color === "gold" ? new THREE.Color(1, 0.78, 0.2)
      : color === "purple" ? new THREE.Color(0.7, 0.55, 1)
      : new THREE.Color(0.71, 0.86, 1);

    if (color === "neon") {
      // Hot pink / cyan neon
      grad.addColorStop(0, "rgba(255, 20, 147, 0.95)");
      grad.addColorStop(1, "rgba(0, 245, 255, 0)");
    } else if (color === "gold") {
      // Solar Gold
      grad.addColorStop(0, "rgba(255, 215, 0, 0.95)");
      grad.addColorStop(1, "rgba(255, 69, 0, 0)");
    } else if (color === "purple") {
      // Void Purple
      grad.addColorStop(0, "rgba(147, 112, 219, 0.95)");
      grad.addColorStop(1, "rgba(75, 0, 130, 0)");
    } else {
      // Standard Blue
      grad.addColorStop(0, "rgba(180, 220, 255, 0.95)");
      grad.addColorStop(1, "rgba(122, 249, 255, 0)");
    }
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    glowTex.needsUpdate = true;
  };

  // Draw initial trail
  setTrailColor("blue");

  glow.scale.set(9, 9, 1);
  glow.position.set(0, 0, -2.5);
  group.add(glow);
  group.scale.setScalar(1.5);
  group.visible = false;

  // --- Engine plume: a pool of soft additive puffs that form a thick, cylinder-
  // like exhaust which dissipates quickly (still lingers a moment when she stops). ---
  const PLUME_N = 40; // bigger pool so a fast, interpolated streak stays continuous
  const PLUME_LIFE = 0.55; // seconds each puff lives → fast dissipation
  const PLUME_STEP = 3.2; // world distance between spawned puffs (also the streak spacing)
  const plume = new THREE.Group();
  plume.frustumCulled = false;
  const puffs = Array.from({ length: PLUME_N }, () => {
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
    );
    s.visible = false;
    plume.add(s);
    return { sprite: s, life: 0 };
  });
  let lastPuffPos: THREE.Vector3 | null = null;

  // The doomed memory she drags to the Sun (world-space; added to scene by Graph3D).
  const cargo = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 16),
    new THREE.MeshStandardMaterial({
      color: "#cfe0ff",
      emissive: new THREE.Color("#8aa0ff"),
      emissiveIntensity: 0.5,
      roughness: 0.7,
    }),
  );
  cargo.visible = false;

  // Floating "what she's doing" label (billboard added to scene by Graph3D).
  const taskLabel = makeTaskLabel();
  // In-world speech bubble (IM-139): her reactions, spoken above the ship.
  const speechBubble = makeSpeechBubble();
  let bubbleText = "";
  let bubbleUntil = 0;
  const say = (message: string) => {
    const text = message.trim().slice(0, 140);
    if (!text) return;
    bubbleText = text;
    speechBubble.draw(text);
    bubbleUntil = Date.now() + 6000;
  };
  let taskEnabled = false;
  let lastTaskText = "";
  let bank = 0; // current banked roll (smoothed toward target each frame)
  let currentVel = 0; // her current speed (units/sec) — drives propulsion glow, trail, streaks
  // Track last-frame mode so the docking-clamp cue fires once on arrival.
  let prevModeSfx = "idle";

  let mode:
    | "travel"
    | "orbit"
    | "idle"
    | "dockTravel"
    | "docking"
    | "linkToSource"
    | "linkToTarget"
    | "placePickup"
    | "placeCarry"
    | "removeTravel"
    | "removeCarry"
    | "beaconTravel"
    | "distressTravel"
    | "distressHover" = "idle";
  let curve: THREE.QuadraticBezierCurve3 | null = null;
  let t = 0;
  let speed = 0.25;
  // Progression multiplier: she flies faster the more you've grown the brain.
  // Set from App via setPilotSpeed (memories + streak). Clamped for sanity.
  let pilotSpeed = 1;
  // FUEL & SPEED: her fast cruising + progression "warp" costs Fuel; her BASE speed is
  // always free. When Fuel runs low she drops to base speed (no boost, no warp) — she
  // never stops, she just does one gear. Accumulated burn is flushed by Graph3D.
  const LOW_FUEL = 15;
  const BURN_ABOVE_VEL = 40; // only speed above this burns fuel (raised → base cruise is free)
  const SPEED_BURN_RATE = 0.0002; // gentler — earning should outpace flying
  let lowFuelSpeed = false; // set each frame from the live fuel
  let fuelBurnAccum = 0;
  // Distance-aware cruise → a curve-fraction-per-second rate. We bound the TRIP
  // TIME between minT and maxT: a short hop holds a gentle minimum; a normal hop
  // cruises at ~baseVel u/s; a very long haul caps at maxT, so her top speed RISES
  // with distance (she "warps" across open stretches). pilotSpeed shortens every
  // trip (progression). smooth() still eases accel/decel within each hop.
  const cruise = (dist: number, baseVel: number, minT: number, maxT: number): number => {
    // Low fuel → base pace only: no progression boost, and no long-haul "warp" (time
    // scales with distance at baseVel instead of capping at maxT). She keeps moving.
    const eff = lowFuelSpeed ? 1 : pilotSpeed;
    const cap = lowFuelSpeed ? Number.POSITIVE_INFINITY : maxT;
    const time = Math.min(cap, Math.max(minT, (dist || 1) / baseVel)) / eff;
    return 1 / time;
  };
  let target: any = null;
  let currentJob: MaintenanceJob | null = null;
  let isFetching = false;
  let lastMaintenanceRefresh = 0;
  let demoMode = false; // demo galaxy: local patrols only, no real backend jobs
  // Throttles the idle-mode "clean taskOrder + pick next task" scan below (a Set +
  // several array builds) to 5Hz. She's idle a lot, and none of that bookkeeping needs
  // to re-run 60x/sec — the queues it reconciles only change when something enqueues a
  // job elsewhere, and a ~200ms delay before she notices is imperceptible for an ambient
  // background agent (the existing maintenance-queue refresh throttle above is 1000ms).
  let pickTaskT = 0;

  // Beacons she needs to dispatch (fly to target memory and deploy)
  const beaconQueue: number[] = [];
  let activeBeacon: number | null = null;

  // Night Replay: overnight agent-log events she re-enacts on arrival (visual
  // theater over real data — the work already happened server-side).
  const replayQueue: { id: number; label: string }[] = [];

  // Discarded memories to drag to the Sun and fling in (deletion spectacle).
  const removalQueue: RemovalTask[] = [];
  let activeRemoval: RemovalTask | null = null;

  // Connections she's been asked to forge herself (fly to A, grab the thread, fly
  // to B, connect). Drained before patrol so new memories get linked on-screen.
  const linkQueue: LinkTask[] = [];
  let activeLink: LinkTask | null = null;
  let linkTgtNode: any = null;
  let onLinkConnectCb: ((key: string) => void) | null = null;

  // Placement: brand-new memories she ferries from the dock into their orbit slot.
  // The orbit system "holds" each (won't move it) until she drops it + releases.
  const placeQueue: number[] = [];
  let activePlace: number | null = null;
  let orbitApi: { slotOf: (id: number) => THREE.Vector3 | null; release: (id: number) => void } | null = null;

  // Station docking: after a few jobs, fly to the station to "recharge".
  const DOCK_EVERY = 4;
  let jobsSinceDock = 0;
  let dockTime = 0;
  const stationLoc = new THREE.Vector3();
  let haveStation = false;

  // Orbit-phase state.
  let orbitAngle = 0;
  let orbitRadius = 20;
  let orbitTime = 0;
  let jobTimer = 0;
  let ou = new THREE.Vector3(1, 0, 0);
  let ov = new THREE.Vector3(0, 0, 1);

  // Scratch vectors for the per-frame curve-following branch of `update()` (the "flying
  // between tasks" state, one of her most common). THREE.Curve's getPoint(At)/getTangent(At)
  // accept an optional target to write into instead of allocating — reused here every
  // frame instead of letting each call construct a fresh Vector3. (getTangent's own
  // internal two-point sample still allocates internally; that's three.js's own Curve
  // implementation, not something a call-site scratch vector can avoid.)
  const curvePosScratch = new THREE.Vector3();
  const curvePrevPosScratch = new THREE.Vector3();
  const tangentScratch = new THREE.Vector3();
  const tangentPrevScratch = new THREE.Vector3();
  const turnScratch = new THREE.Vector3();
  const upAxisScratch = new THREE.Vector3();
  const lookAtScratch = new THREE.Vector3();

  // Pre-planning queues & unified priority order
  const plannedMaintenance: MaintenanceJob[] = [];
  const taskOrder: string[] = [];
  let distressTarget: THREE.Vector3 | null = null;
  // Autonomous "hail": when she has something to say she flies into view (reusing
  // the distress fly-to-camera path) and shows the message, then resumes.
  let hailPending: string | null = null;
  let hailLabel: string | null = null;

  const getUniquePatrol = (nodes: any[], excludeIds: Set<number>): MaintenanceJob | null => {
    const candidates = nodes.filter((n) => n.x != null && !excludeIds.has(n.id));
    if (candidates.length === 0) return null;
    const r = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      type: "patrol",
      targets: [r.id],
      description: `Routine patrol of memory: ${r.label || `#${r.id}`}`
    };
  };

  // Awareness: tell the user when Soumaya *decides* to do something consequential
  // (research, merge, chart a sector, write the log) — not routine patrols/pruning.
  // Decoupled via a window event so this graph module doesn't depend on the UI layer;
  // App turns it into a toast + inbox entry. Deduped so a queued job announces once.
  const NOTABLE_DECISIONS = new Set(["research", "merging", "sector_vibe", "daily_log"]);
  const announcedDecisions = new Set<string>();
  const announceDecision = (job: MaintenanceJob | null) => {
    if (!job || !NOTABLE_DECISIONS.has(job.type)) return;
    const key = `${job.type}-${job.targets[0] ?? "x"}`;
    if (announcedDecisions.has(key)) return;
    if (announcedDecisions.size > 200) announcedDecisions.clear();
    announcedDecisions.add(key);
    try {
      window.dispatchEvent(
        new CustomEvent("brain-agent-decision", {
          detail: { type: job.type, text: job.rationale?.objective || job.description || "" },
        }),
      );
    } catch {
      /* SSR / no window — ignore */
    }
  };

  const fillPlannedMaintenance = async (nodes: any[]) => {
    const now = Date.now();
    if (isFetching || nodes.length === 0 || now - lastMaintenanceRefresh < 1000) return;
    lastMaintenanceRefresh = now;

    while (plannedMaintenance.length < 3) {
      let job: MaintenanceJob | null = null;
      // Demo galaxy: never fetch real jobs — the server would hand out REAL-brain
      // node ids that don't exist here (and demo completions would mutate the real
      // brain). Local patrols only.
      if (!demoMode) {
        try {
          isFetching = true;
          const serverJob = await getNextMaintenanceJob();
          isFetching = false;

          const inProgress = currentJob && currentJob.targets[0] === serverJob.targets[0];
          const alreadyQueued = plannedMaintenance.some(j => j.targets[0] === serverJob.targets[0]);
          if (!inProgress && !alreadyQueued) {
            job = serverJob;
          }
        } catch {
          isFetching = false;
        }
      }
      
      if (!job) {
        const excludeIds = new Set<number>();
        if (currentJob && currentJob.targets[0] != null) excludeIds.add(currentJob.targets[0]);
        for (const j of plannedMaintenance) {
          if (j.targets[0] != null) excludeIds.add(j.targets[0]);
        }
        job = getUniquePatrol(nodes, excludeIds);
      }
      
      if (job) {
        announceDecision(job);
        plannedMaintenance.push(job);
        const id = `planned-maint-${job.targets[0]}`;
        if (!taskOrder.includes(id)) {
          taskOrder.push(id);
        }
      } else {
        break; // no candidates
      }
    }
  };

  /** Fetch a real job from the backend or fall back to a random patrol if offline. */
  const acquireJob = async (nodes: any[]) => {
    if (isFetching || nodes.length === 0) return;
    isFetching = true;
    try {
      if (demoMode) throw new Error("demo"); // demo → local patrol fallback below
      currentJob = await getNextMaintenanceJob();
      announceDecision(currentJob);
    } catch (err) {
      // Fallback: local random patrol
      const candidates = nodes.filter((n) => n.x != null);
      if (candidates.length > 0) {
        const r = candidates[Math.floor(Math.random() * candidates.length)];
        currentJob = { type: "patrol", targets: [r.id], description: "Routine patrol (offline fallback)" };
      }
    } finally {
      isFetching = false;
      if (currentJob) planRoute(nodes);
    }
  };

  // Fly to a STANDOFF point near a body (never its center) on a curved path.
  const planRoute = (nodes: any[]): boolean => {
    if (!currentJob) return false;
    
    // For now, always target the first node in the job targets
    target = nodes.find((n) => n.id === currentJob?.targets[0]);
    if (!target || target.x == null) {
      currentJob = null;
      mode = "idle";
      return false;
    }

    const to = vecOf(target);
    const standoff = bodyRadius(target) + 12;
    const off = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(standoff);
    const endpoint = to.clone().add(off);
    const from = group.visible
      ? group.position.clone()
      : endpoint.clone().add(new THREE.Vector3(80, 50, 80));
    const mid = from
      .clone()
      .add(endpoint)
      .multiplyScalar(0.5)
      .add(new THREE.Vector3((Math.random() - 0.5) * 40, 20 + Math.random() * 30, (Math.random() - 0.5) * 40));
    curve = new THREE.QuadraticBezierCurve3(from, mid, endpoint);
    t = 0;
    speed = cruise(from.distanceTo(endpoint), 160, 0.7, 5.5);
    mode = "travel";
    group.visible = true;
    return true;
  };

  // Fly to a standoff point near the space station for a recharge dock.
  const planDock = (): void => {
    const standoff = 360; // clear the colossal station's radius
    const off = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(standoff);
    const endpoint = stationLoc.clone().add(off);
    const from = group.visible
      ? group.position.clone()
      : endpoint.clone().add(new THREE.Vector3(120, 70, 120));
    const mid = from
      .clone()
      .add(endpoint)
      .multiplyScalar(0.5)
      .add(new THREE.Vector3((Math.random() - 0.5) * 60, 50 + Math.random() * 50, (Math.random() - 0.5) * 60));
    curve = new THREE.QuadraticBezierCurve3(from, mid, endpoint);
    t = 0;
    speed = cruise(from.distanceTo(endpoint), 130, 0.9, 6.5);
    mode = "dockTravel";
    group.visible = true;
  };

  // Curve from the current position to a standoff point near a given body.
  const curveTo = (node: any): boolean => {
    if (!node || node.x == null) return false;
    const to = vecOf(node);
    const standoff = bodyRadius(node) + 12;
    const off = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
      .normalize()
      .multiplyScalar(standoff);
    const endpoint = to.clone().add(off);
    const from = group.visible
      ? group.position.clone()
      : endpoint.clone().add(new THREE.Vector3(80, 50, 80));
    const mid = from
      .clone()
      .add(endpoint)
      .multiplyScalar(0.5)
      .add(new THREE.Vector3((Math.random() - 0.5) * 40, 20 + Math.random() * 30, (Math.random() - 0.5) * 40));
    curve = new THREE.QuadraticBezierCurve3(from, mid, endpoint);
    t = 0;
    speed = cruise(from.distanceTo(endpoint), 170, 0.6, 5);
    group.visible = true;
    return true;
  };

  // Begin the next queued connection: fly to its source memory first.
  const startLink = (nodes: any[]): void => {
    while (linkQueue.length > 0) {
      const task = linkQueue.shift()!;
      const src = nodes.find((n) => n.id === task.source);
      const tgt = nodes.find((n) => n.id === task.target);
      if (src?.x != null && tgt?.x != null && curveTo(src)) {
        activeLink = task;
        target = src;
        linkTgtNode = tgt;
        mode = "linkToSource";
        return;
      }
    }
  };

  // Begin ferrying the next brand-new memory: fly to where it waits (the dock)
  const startPlacement = (nodes: any[]): void => {
    while (placeQueue.length > 0) {
      const id = placeQueue.shift()!;
      const node = nodes.find((n) => n.id === id);
      const slot = orbitApi?.slotOf(id) ?? null;
      if (!node || node.x == null || !slot) {
        orbitApi?.release(id);
        continue;
      }
      if (curveTo(node)) {
        activePlace = id;
        target = node;
        mode = "placePickup";
        return;
      }
      orbitApi?.release(id);
    }
  };

  // Begin a deletion: fly to where the discarded memory was
  const startRemoval = (): void => {
    const task = removalQueue.shift();
    if (!task) return;
    const to = new THREE.Vector3(task.x, task.y, task.z);
    const from = group.visible ? group.position.clone() : to.clone().add(new THREE.Vector3(80, 50, 80));
    const mid = from
      .clone()
      .add(to)
      .multiplyScalar(0.5)
      .add(new THREE.Vector3((Math.random() - 0.5) * 40, 20 + Math.random() * 30, (Math.random() - 0.5) * 40));
    curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    t = 0;
    speed = cruise(from.distanceTo(to), 170, 0.6, 5);
    activeRemoval = task;
    mode = "removeTravel";
    group.visible = true;
  };

  // Start beacon dispatch: fly directly to the target memory to deploy the beacon.
  const startBeaconDispatch = (nodes: any[]): void => {
    while (beaconQueue.length > 0) {
      const id = beaconQueue.shift()!;
      const node = nodes.find((n) => n.id === id);
      if (node?.x != null && curveTo(node)) {
        activeBeacon = id;
        target = node;
        mode = "beaconTravel";
        return;
      }
    }
  };

  // Keep the floating task label in sync with whatever she's doing right now.
  const syncLabel = (dt: number) => {
    let taskText = "";
    if (mode === "removeTravel" || mode === "removeCarry") {
      taskText = "Casting a memory into the Sun";
    } else if (mode === "placePickup" || mode === "placeCarry") {
      taskText = "Ferrying a new memory into place";
    } else if (mode === "beaconTravel") {
      taskText = "Deploying an Aura beacon";
    } else if (mode === "docking" || mode === "dockTravel") {
      taskText = "Recharging at the station";
    } else if (mode === "linkToSource" || mode === "linkToTarget") {
      taskText = "Energizing a connection";
    } else if (mode === "distressTravel" || mode === "distressHover") {
      taskText = hailLabel ?? "🚨 Fuel depleted! Help me refuel.";
    } else if (currentJob) {
      // IM-04: never render a raw job-type token ("Running sector_vibe") —
      // the shared label map humanizes every server job type.
      taskText = shipTaskLabel(currentJob);
    }
    if (taskText !== lastTaskText) {
      lastTaskText = taskText;
      if (taskText) taskLabel.draw(taskText);
    }
    
    // Position task label dynamically above her head, slightly to the rear, aligned to her local coordinates.
    const upVec = new THREE.Vector3(0, 1, 0).applyQuaternion(group.quaternion).normalize();
    const fwdVec = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion).normalize();
    const pos = group.position.clone().addScaledVector(upVec, 6.0).addScaledVector(fwdVec, -2.5);
    taskLabel.sprite.position.copy(pos);
    taskLabel.tick(dt);
    // Hails + distress always show (attention grab); routine task labels honor the toggle.
    const forceShow = hailLabel != null || mode === "distressTravel" || mode === "distressHover";
    taskLabel.sprite.visible = (taskEnabled || forceShow) && group.visible && taskText !== "";
    // Speech bubble (IM-139): anchored above the task label while its line lasts.
    const bubbleLive = bubbleText !== "" && Date.now() < bubbleUntil;
    speechBubble.sprite.visible = bubbleLive && group.visible;
    if (bubbleLive) {
      speechBubble.sprite.position.copy(pos).addScaledVector(upVec, taskLabel.sprite.visible ? 13 : 9);
    }
  };

  // Done tasks cache
  const completedTasks: { id: string; type: string; label: string; status: "done"; time: number }[] = [];
  const pushCompleted = (type: string, label: string, id: string) => {
    completedTasks.push({ id, type, label, status: "done", time: Date.now() });
    if (completedTasks.length > 8) completedTasks.shift();
  };

  const update: SoumayaHandle["update"] = (
    dt,
    nodes,
    _links,
    onArrive,
    stationPos,
    onLinkConnect,
    orbit,
    fuel,
    cameraTarget,
  ) => {
    if (onLinkConnect) onLinkConnectCb = onLinkConnect;
    if (orbit) orbitApi = orbit;
    lowFuelSpeed = !!(fuel && typeof fuel.fuel === "number" && fuel.fuel < LOW_FUEL); // gate top speed
    currentVel = 0; // reset each frame; modes set it; trail/streaks/clamp read it in `finally`
    try {
      if (stationPos) {
        stationLoc.copy(stationPos);
        haveStation = true;
      }

      // Auto-fill planned maintenance queue
      fillPlannedMaintenance(nodes);

      // Priority Interruption Check:
      // If there are new placements or removals waiting, and she is currently doing a routine
      // maintenance job (travel/orbit) or recharging or distress-hovering, interrupt her immediately.
      const hasPriority = placeQueue.length > 0 || removalQueue.length > 0 || linkQueue.length > 0 || beaconQueue.length > 0;
      if (hasPriority) {
        if (
          mode === "distressTravel" ||
          mode === "distressHover" ||
          (currentJob && (mode === "travel" || mode === "orbit")) ||
          (mode === "docking" || mode === "dockTravel")
        ) {
          currentJob = null;
          curve = null;
          mode = "idle";
          hailLabel = null; // priority work wins — drop any in-flight hail
        }
      }

      if (mode === "idle") {
        // Distress Check: if fuel is very low, fly directly into the user's view (camera target) to request fuel!
        const isLowFuel = fuel && fuel.fuel < 20;
        if (isLowFuel && !hasPriority) {
          if (cameraTarget) {
            const dest = cameraTarget.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 30,
              15 + (Math.random() - 0.5) * 10,
              (Math.random() - 0.5) * 30
            ));
            const from = group.position.clone();
            const mid = from.clone().add(dest).multiplyScalar(0.5).add(new THREE.Vector3((Math.random() - 0.5) * 30, 20, (Math.random() - 0.5) * 30));
            curve = new THREE.QuadraticBezierCurve3(from, mid, dest);
            t = 0;
            speed = cruise(from.distanceTo(dest), 150, 0.7, 6);
            mode = "distressTravel";
            distressTarget = dest;
            return;
          }
        }

        // Hail: she has something to say → fly into view and show it (reuses the
        // distress fly-to-camera path). Consumed once; resumes normal work after.
        if (hailPending && cameraTarget && !hasPriority) {
          const dest = cameraTarget.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 30,
            15 + (Math.random() - 0.5) * 10,
            (Math.random() - 0.5) * 30,
          ));
          const from = group.position.clone();
          const mid = from.clone().add(dest).multiplyScalar(0.5).add(new THREE.Vector3((Math.random() - 0.5) * 30, 20, (Math.random() - 0.5) * 30));
          curve = new THREE.QuadraticBezierCurve3(from, mid, dest);
          t = 0;
          speed = cruise(from.distanceTo(dest), 150, 0.7, 6);
          mode = "distressTravel";
          distressTarget = dest;
          hailLabel = hailPending;
          hailPending = null;
          return;
        }

        // Clean taskOrder to remove IDs that are no longer in any queue, then pick the
        // next one — throttled (see pickTaskT above); skips straight to the fallthrough
        // idle behavior (replay / patrol, below) on ticks where it isn't due yet.
        pickTaskT -= dt;
        if (pickTaskT <= 0) {
        pickTaskT = 0.2; // 5Hz
        const validIds = new Set<string>();
        for (const r of removalQueue) if (r.id) validIds.add(r.id);
        for (const id of placeQueue) validIds.add(`place-${id}`);
        for (const l of linkQueue) validIds.add(l.id || `link-${l.key}`);
        for (const id of beaconQueue) validIds.add(`beacon-${id}`);
        for (const j of plannedMaintenance) validIds.add(`planned-maint-${j.targets[0]}`);

        const currentPlannedOrder = taskOrder.filter(id => validIds.has(id));

        if (currentPlannedOrder.length > 0) {
          const nextTaskId = currentPlannedOrder[0]!;
          const idx = taskOrder.indexOf(nextTaskId);
          if (idx !== -1) taskOrder.splice(idx, 1);
          
          if (nextTaskId.startsWith("removal-")) {
            const matchIdx = removalQueue.findIndex(r => r.id === nextTaskId);
            if (matchIdx !== -1) {
              const task = removalQueue.splice(matchIdx, 1)[0]!;
              activeRemoval = task;
              target = { x: task.x, y: task.y, z: task.z, label: "Discarded Memory", type: "system" } as any;
              
              const endpoint = new THREE.Vector3(0, 0, 0); // Sun is at origin
              const from = group.position.clone();
              const mid = from.clone().add(endpoint).multiplyScalar(0.5).add(new THREE.Vector3((Math.random() - 0.5) * 50, 40, (Math.random() - 0.5) * 50));
              curve = new THREE.QuadraticBezierCurve3(from, mid, endpoint);
              t = 0;
              speed = cruise(from.distanceTo(endpoint), 160, 0.7, 5.5);
              mode = "removeTravel";
              return;
            }
          } else if (nextTaskId.startsWith("place-")) {
            const id = Number(nextTaskId.replace("place-", ""));
            const matchIdx = placeQueue.indexOf(id);
            if (matchIdx !== -1) {
              placeQueue.splice(matchIdx, 1);
              activePlace = id;
              target = nodes.find((n) => n.id === id);
              if (target && target.x != null && curveTo(target)) {
                mode = "placePickup";
              } else {
                activePlace = null;
                mode = "idle";
              }
              return;
            }
          } else if (nextTaskId.startsWith("beacon-")) {
            const id = Number(nextTaskId.replace("beacon-", ""));
            const matchIdx = beaconQueue.indexOf(id);
            if (matchIdx !== -1) {
              beaconQueue.splice(matchIdx, 1);
              activeBeacon = id;
              target = nodes.find((n) => n.id === id);
              if (target && target.x != null && curveTo(target)) {
                mode = "beaconTravel";
              } else {
                activeBeacon = null;
                mode = "idle";
              }
              return;
            }
          } else if (nextTaskId.startsWith("link-") || linkQueue.some(l => l.id === nextTaskId)) {
            const matchIdx = linkQueue.findIndex(l => l.id === nextTaskId || `link-${l.key}` === nextTaskId);
            if (matchIdx !== -1) {
              const task = linkQueue.splice(matchIdx, 1)[0]!;
              activeLink = task;
              target = nodes.find((n) => n.id === task.source);
              if (target && target.x != null && curveTo(target)) {
                mode = "linkToSource";
              } else {
                activeLink = null;
                mode = "idle";
              }
              return;
            }
          } else if (nextTaskId.startsWith("planned-maint-")) {
            const matchIdx = plannedMaintenance.findIndex(j => `planned-maint-${j.targets[0]}` === nextTaskId);
            if (matchIdx !== -1) {
              const job = plannedMaintenance.splice(matchIdx, 1)[0]!;
              currentJob = job;
              planRoute(nodes);
              return;
            }
          }
        }
        } // end pickTaskT throttle
      }

      if (mode === "idle") {
        // A previous idle tick's acquireJob fetch may still be in flight — it
        // would overwrite currentJob when it resolves, eating a replay item.
        if (isFetching) return;
        // Night Replay first: re-enact her overnight work before new patrols.
        while (replayQueue.length > 0) {
          const it = replayQueue.shift()!;
          const node = nodes.find((n) => n.id === it.id);
          if (node && node.x != null) {
            // "replay" is client-side theater — the orbit-completion handler
            // skips complete-job for it (the work already ran server-side).
            currentJob = { type: "replay", targets: [it.id], description: it.label } as any;
            planRoute(nodes);
            return;
          }
          // Target no longer in the graph — drop it and try the next.
        }
        acquireJob(nodes);
        return;
      }

      // DOCKING: park by the station, pulse recharge beams, then resume patrol.
      if (mode === "docking") {
        dockTime -= dt;
        orbitAngle += dt * 0.4;
        const pos = stationLoc
          .clone()
          .add(new THREE.Vector3(Math.cos(orbitAngle) * 320, Math.sin(orbitAngle * 0.6) * 70, Math.sin(orbitAngle) * 320));
        group.position.copy(pos);
        group.lookAt(stationLoc);
        jobTimer -= dt;
        if (jobTimer <= 0) {
          onArrive(stationLoc.x, stationLoc.y, stationLoc.z, "synthesis"); // recharge beam
          jobTimer = 0.5;
        }
        if (dockTime <= 0) {
          jobsSinceDock = 0;
          mode = "idle";
        }
        return;
      }

      // DISTRESS MODES: Fly to screen and bob/hover asking for help
      if (mode === "distressTravel") {
        if (!curve) {
          mode = "idle";
          return;
        }
        t += dt * speed;
        if (t >= 1) {
          group.position.copy(curve.getPoint(1));
          curve = null;
          mode = "distressHover";
          jobTimer = 15; // Hover in view for 15 seconds
          orbitAngle = 0;
          currentVel = 0;
        } else {
          group.position.copy(curve.getPoint(smooth(t)));
          const tangent = curve.getTangent(smooth(t));
          group.lookAt(group.position.clone().add(tangent));
          currentVel = 35;
        }
      } else if (mode === "distressHover") {
        jobTimer -= dt;
        orbitAngle += dt * 1.5;
        const basePos = distressTarget || group.position.clone();
        group.position.copy(basePos).add(new THREE.Vector3(0, Math.sin(orbitAngle) * 2.2, 0));
        group.rotation.y += dt * 0.6; // slow dramatic spin
        currentVel = 0;
        if (jobTimer <= 0) {
          if (hailLabel) {
            hailLabel = null; // hail delivered — back to normal work
            mode = "idle";
          } else if (haveStation) {
            planDock();
          } else {
            mode = "idle";
          }
        }
        return;
      }

      // ORBIT: circle the body at a standoff radius
      if (mode === "orbit") {
        if (!target || target.x == null) {
          mode = "idle";
          return;
        }
        orbitTime -= dt;
        const speedMultiplier = 5 / (orbitRadius + 8);
        orbitAngle += dt * speedMultiplier;
        const tp = vecOf(target);
        const pos = tp
          .clone()
          .addScaledVector(ou, Math.cos(orbitAngle) * orbitRadius)
          .addScaledVector(ov, Math.sin(orbitAngle) * orbitRadius);
        const tangent = ou
          .clone()
          .multiplyScalar(-Math.sin(orbitAngle))
          .addScaledVector(ov, Math.cos(orbitAngle));
        
        currentVel = speedMultiplier * orbitRadius;
        
        group.position.copy(pos);
        group.lookAt(pos.clone().add(tangent));
        jobTimer -= dt;
        if (jobTimer <= 0) {
          onArrive(tp.x, tp.y, tp.z, currentJob?.type || "patrol");
          jobTimer = 1.3;
        }

        if (orbitTime <= 0) {
          if (currentJob) {
            // Demo patrols and Night-Replay re-enactments are visual only —
            // completing them against the backend would double-run real work
            // (or mutate the real brain with demo node ids).
            if (!demoMode && (currentJob.type as string) !== "replay") {
              completeMaintenanceJob(currentJob.type, currentJob.targets).catch(() => {});
            }
            pushCompleted("maintenance", currentJob.description || "Completed patrol", `patrol-${currentJob.targets[0]}`);
            currentJob = null;
          }
          jobsSinceDock++;
          if (jobsSinceDock >= DOCK_EVERY && haveStation) {
            planDock();
          } else {
            mode = "idle";
          }
        }
      } else if (mode === "placeCarry") {
        const slot = activePlace != null ? orbitApi?.slotOf(activePlace) ?? null : null;
        if (!target || activePlace == null || !slot) {
          if (activePlace != null) orbitApi?.release(activePlace);
          activePlace = null;
          mode = "idle";
        } else {
          const np = vecOf(target);
          const toSlot = slot.clone().sub(np);
          const dist = toSlot.length();
          const step = Math.min(dist, (40 + dist) * dt * 0.9 * pilotSpeed);
          if (dist < 5) {
            target.x = slot.x; target.y = slot.y; target.z = slot.z;
            target.fx = slot.x; target.fy = slot.y; target.fz = slot.z;
            orbitApi?.release(activePlace);
            onArrive(slot.x, slot.y, slot.z, "synthesis", activePlace);
            pushCompleted("placement", `Ferried new memory: ${target?.label ?? `#${activePlace}`}`, `place-${activePlace}`);
            activePlace = null;
            target = null;
            mode = "idle";
          } else {
            const nv = np.addScaledVector(toSlot.normalize(), step);
            target.x = nv.x; target.y = nv.y; target.z = nv.z;
            target.fx = nv.x; target.fy = nv.y; target.fz = nv.z;
            const shipPos = nv.clone().add(new THREE.Vector3(0, bodyRadius(target) + 6, 0));
            group.position.copy(shipPos);
            group.lookAt(slot);
            currentVel = step / Math.max(dt, 0.001);
          }
        }
      } else if (mode === "removeCarry") {
        const cargoPos = cargo.position.clone();
        const dist = cargoPos.length();
        if (!activeRemoval || dist <= SUN_RADIUS_MAX || cargoPos.lengthSq() < 1e-3) {
          onArrive(cargoPos.x, cargoPos.y, cargoPos.z, "consume");
          cargo.visible = false;
          if (activeRemoval) {
            pushCompleted("removal", "Discarded memory into the Sun", activeRemoval.id || "removal-active");
          }
          activeRemoval = null;
          mode = "idle";
          currentVel = 0;
        } else {
          const dirIn = cargoPos.clone().multiplyScalar(-1).normalize();
          const step = Math.min(dist - SUN_RADIUS_MAX, (70 + dist * 0.4) * dt * pilotSpeed);
          const nc = cargoPos.addScaledVector(dirIn, step);
          cargo.position.copy(nc);
          const standoff = Math.max(nc.length() + 50, SUN_RADIUS_MAX + 120);
          group.position.copy(nc.clone().normalize().multiplyScalar(standoff));
          group.lookAt(nc);
          currentVel = step / Math.max(dt, 0.001);
        }
      } else {
        if (!curve) {
          mode = "idle";
          return;
        }

        const prevT = t;
        t += speed * dt;

        if (t >= 1 && mode === "dockTravel") {
          mode = "docking";
          dockTime = 6;
          jobTimer = 0.2;
          orbitAngle = Math.random() * Math.PI * 2;
          curve = null;
          currentVel = 0;
        } else if (t >= 1 && mode === "linkToSource") {
          const p = vecOf(target);
          onArrive(p.x, p.y, p.z, "synthesis", target?.id);
          curve = null;
          currentVel = 0;
          if (linkTgtNode && curveTo(linkTgtNode)) {
            target = linkTgtNode;
            mode = "linkToTarget";
          } else {
            activeLink = null;
            mode = "idle";
          }
        } else if (t >= 1 && mode === "linkToTarget") {
          const p = vecOf(target);
          onArrive(p.x, p.y, p.z, "synthesis", target?.id);
          if (activeLink && onLinkConnectCb) onLinkConnectCb(activeLink.key);
          if (activeLink) {
            pushCompleted("link", "Forged connection", activeLink.id || `link-${activeLink.key}`);
          }
          activeLink = null;
          linkTgtNode = null;
          curve = null;
          currentVel = 0;
          mode = "idle";
        } else if (t >= 1 && mode === "placePickup") {
          curve = null;
          currentVel = 0;
          if (target && activePlace != null) {
            mode = "placeCarry";
          } else {
            if (activePlace != null) orbitApi?.release(activePlace);
            activePlace = null;
            mode = "idle";
          }
        } else if (t >= 1 && mode === "beaconTravel") {
          const p = vecOf(target);
          onArrive(p.x, p.y, p.z, "beacon_dispatch", target?.id);
          if (activeBeacon) {
            pushCompleted("beacon", `Deployed Aura beacon at ${target?.label ?? `#${activeBeacon}`}`, `beacon-${activeBeacon}`);
          }
          activeBeacon = null;
          curve = null;
          currentVel = 0;
          mode = "idle";
        } else if (t >= 1 && mode === "removeTravel") {
          curve = null;
          currentVel = 0;
          if (activeRemoval) {
            (cargo.material as THREE.MeshStandardMaterial).color.set(activeRemoval.color ?? "#cfe0ff");
            cargo.scale.setScalar(activeRemoval.size ?? 4);
            cargo.position.set(activeRemoval.x, activeRemoval.y, activeRemoval.z);
            cargo.visible = true;
            mode = "removeCarry";
          } else {
            mode = "idle";
          }
        } else if (t >= 1) {
          mode = "orbit";
          orbitRadius = bodyRadius(target) + 12;
          orbitTime = 11 + Math.random() * 8; // linger 11–19s at the body she's tending
          jobTimer = 0.2;
          orbitAngle = Math.random() * Math.PI * 2;
          const normal = new THREE.Vector3(Math.random() - 0.5, Math.random() + 0.3, Math.random() - 0.5).normalize();
          const ref = Math.abs(normal.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          ou = new THREE.Vector3().crossVectors(normal, ref).normalize();
          ov = new THREE.Vector3().crossVectors(normal, ou).normalize();
          curve = null;
          currentVel = 0;
        } else {
          const e = smooth(t);
          const ePrev = smooth(prevT);
          const p = curve.getPointAt(e, curvePosScratch);
          const pPrev = curve.getPointAt(ePrev, curvePrevPosScratch);
          currentVel = p.distanceTo(pPrev) / dt;

          group.position.copy(p);
          const tangent = curve.getTangentAt(Math.min(0.999, e), tangentScratch);
          group.lookAt(lookAtScratch.copy(p).add(tangent));

          const tanPrev = curve.getTangentAt(Math.min(0.999, Math.max(0, ePrev)), tangentPrevScratch);
          const turn = turnScratch.crossVectors(tanPrev, tangent);
          const up = upAxisScratch.set(0, 1, 0).applyQuaternion(group.quaternion);
          const signed = turn.dot(up);
          const targetBank = Math.max(-0.6, Math.min(0.6, -signed * 14));
          bank += (targetBank - bank) * Math.min(1, dt * 3);
          group.rotateZ(bank);
        }
      }

      // Dynamic Propulsion / Emotional Glow Color updates
      if (group.visible && glow && (glow.material as THREE.SpriteMaterial).color) {
        const mat = glow.material as THREE.SpriteMaterial;
        const isLowFuel = fuel && fuel.fuel < 20;
        
        if (mode === "distressTravel" || mode === "distressHover" || isLowFuel) {
          // Rapid red/orange emotional distress pulsation
          mat.color.setHex(0xff3c00);
          const p = 5.5 + Math.sin(performance.now() * 0.018) * 3.5;
          glow.scale.set(p, p, 1);
          mat.opacity = 0.4 + 0.6 * Math.sin(performance.now() * 0.018);
        } else if (mode === "docking" || mode === "dockTravel") {
          // Green recharge glow
          mat.color.setHex(0x32ff6a);
          const p = 4.5 + Math.sin(performance.now() * 0.005) * 1.5;
          glow.scale.set(p, p, 1);
          mat.opacity = 0.7;
        } else if (mode === "placeCarry" || mode === "placePickup") {
          // Cyan placement / ferrying glow
          mat.color.setHex(0x00f3ff);
          const p = 6.5 + Math.sin(performance.now() * 0.008) * 2;
          glow.scale.set(p, p, 1);
          mat.opacity = 0.8;
        } else if (mode === "linkToSource" || mode === "linkToTarget") {
          // Purple synthesis link connection glow
          mat.color.setHex(0xc27aff);
          const p = 6.5 + Math.sin(performance.now() * 0.008) * 2;
          glow.scale.set(p, p, 1);
          mat.opacity = 0.8;
        } else {
          // Standard cyan/white propulsion
          mat.color.setHex(0xb4e2ff);
          const vRatio = Math.min(1, currentVel / 40);
          const s = 2 + 10 * vRatio;
          glow.scale.set(s, s, 1);
          glow.position.z = -2.5 - (s * 0.1);
          mat.opacity = 0.3 + 0.7 * vRatio;
        }
      }
    } catch {
      /* skip this frame */
    } finally {
      // Top-speed fuel burn: only velocity ABOVE the free base rate costs Fuel, so
      // cruising fast / warping across the galaxy drains it while an idle drift is free.
      if (!lowFuelSpeed && currentVel > BURN_ABOVE_VEL) {
        fuelBurnAccum += (currentVel - BURN_ABOVE_VEL) * dt * SPEED_BURN_RATE;
      }
      try {
        // Hard safeguard: give the Sun a WIDE berth on all normal flight (matches the
        // bodies' clearance) so she never grazes or disappears into it. Exempt active
        // deletion — casting a memory into the Sun is the one time she's meant to close in.
        const SUN_CLEAR = SUN_RADIUS_MAX + 350; // 950 — comfortably around, not touching
        if (!activeRemoval && group.position.lengthSq() > 1 && group.position.length() < SUN_CLEAR) {
          group.position.setLength(SUN_CLEAR);
        }
        // Docking clamp cue (the continuous engine sound itself is the real recording
        // in engineAudio.ts, gated to focus — see Graph3D). Kept lightweight here.
        if (mode === "docking" && prevModeSfx !== "docking") playSfx("dock");
        prevModeSfx = mode;
        updatePlume(dt);
      } catch {
        /* fx are non-critical */
      }
      try {
        syncLabel(dt);
      } catch {
        /* non-critical */
      }
    }
  };

  /**
   * Engine plume: drop a soft additive puff at the exhaust as she moves; each puff
   * lives ~PLUME_LIFE seconds, expanding + fading where it was born (world-space) so
   * the trail reads as a thick cylinder that dissipates quickly. When she stops, no
   * new puffs spawn but the live ones finish fading — so it lingers a moment, then
   * clears (real exhaust behavior).
   */
  const updatePlume = (dt: number) => {
    // Spawn puffs at the exhaust when she's visible/moving. Crucially, INTERPOLATE:
    // at high speed she covers many PLUME_STEPs in one frame, so we drop a puff every
    // PLUME_STEP along the segment she just travelled — otherwise a single per-frame
    // puff leaves big gaps and the trail looks like scattered dots. Evenly-spaced +
    // overlapping puffs read as one continuous streak at any speed.
    if (group.visible && currentVel > 2) {
      const exhaust = group.position.clone().add(new THREE.Vector3(0, 0, -3.5).applyQuaternion(group.quaternion));
      if (!lastPuffPos) lastPuffPos = exhaust.clone();
      if (lastPuffPos.distanceTo(exhaust) > PLUME_STEP * 24) {
        // A teleport / big jump (mode reset, re-frame) — don't streak across the void.
        lastPuffPos = exhaust.clone();
      } else {
        const dir = new THREE.Vector3();
        let guard = 0;
        while (lastPuffPos.distanceTo(exhaust) >= PLUME_STEP && guard < PLUME_N) {
          guard++;
          dir.copy(exhaust).sub(lastPuffPos).setLength(PLUME_STEP);
          lastPuffPos.add(dir);
          const free = puffs.find((p) => p.life <= 0) ?? puffs.reduce((a, b) => (a.life < b.life ? a : b));
          free.life = PLUME_LIFE;
          free.sprite.position.copy(lastPuffPos);
          free.sprite.visible = true;
        }
      }
    }
    // Age every live puff: expand a bit + fade out as it dissipates.
    for (const p of puffs) {
      if (p.life <= 0) {
        if (p.sprite.visible) p.sprite.visible = false;
        continue;
      }
      p.life -= dt;
      const k = Math.max(0, p.life / PLUME_LIFE); // 1 = fresh → 0 = gone
      const mat = p.sprite.material as THREE.SpriteMaterial;
      mat.opacity = 0.7 * k;
      const sc = 7 + (1 - k) * 7; // bigger as it puffs out (cylinder-ish overlap)
      p.sprite.scale.set(sc, sc, 1);
      if (p.life <= 0) p.sprite.visible = false;
    }
  };

  const enqueueLinks = (tasks: LinkTask[]) => {
    for (const task of tasks) {
      if (!linkQueue.some((q) => q.key === task.key) && activeLink?.key !== task.key) {
        linkQueue.push(task);
        const id = task.id || `link-${task.key}`;
        if (!taskOrder.includes(id)) {
          taskOrder.push(id);
        }
      }
    }
  };

  const enqueuePlacements = (ids: number[]) => {
    for (const id of ids) {
      if (id !== activePlace && !placeQueue.includes(id)) {
        placeQueue.push(id);
        const key = `place-${id}`;
        if (!taskOrder.includes(key)) {
          taskOrder.push(key);
        }
      }
    }
  };

  const enqueueBeacons = (ids: number[]) => {
    for (const id of ids) {
      if (id !== activeBeacon && !beaconQueue.includes(id)) {
        beaconQueue.push(id);
        const key = `beacon-${id}`;
        if (!taskOrder.includes(key)) {
          taskOrder.push(key);
        }
      }
    }
  };

  const enqueueRemovals = (tasks: RemovalTask[]) => {
    for (const task of tasks) {
      if (!task.id) {
        task.id = `removal-${task.x}-${task.y}-${Date.now()}-${Math.random()}`;
      }
      if (!removalQueue.some(r => r.id === task.id) && activeRemoval?.id !== task.id) {
        removalQueue.push(task);
        if (!taskOrder.includes(task.id)) {
          taskOrder.push(task.id);
        }
      }
    }
  };

  const setTaskVisible = (v: boolean) => {
    taskEnabled = v;
    if (!v) taskLabel.sprite.visible = false;
  };

  const setPilotSpeed = (v: number) => {
    pilotSpeed = Number.isFinite(v) ? Math.max(0.6, Math.min(2.4, v)) : 1;
  };

  const hail = (message: string) => {
    hailPending = message.slice(0, 80);
  };

  const getTasks = (nodes: any[]) => {
    const now = Date.now();
    const activeCompleted = completedTasks.filter((t) => now - t.time < 12000);
    if (activeCompleted.length !== completedTasks.length) {
      completedTasks.length = 0;
      completedTasks.push(...activeCompleted);
    }

    const tasks: any[] = [];

    // 1. Add "doing" tasks
    const currentRemoval = activeRemoval;
    if (currentRemoval) {
      tasks.push({
        id: currentRemoval.id || "removal-active",
        type: "removal",
        label: "Casting a memory into the Sun",
        status: "doing",
      });
    }
    const currentPlace = activePlace;
    if (currentPlace != null) {
      const node = nodes.find((n) => n.id === currentPlace);
      tasks.push({
        id: `place-${currentPlace}`,
        type: "placement",
        label: `Ferrying new memory: ${node?.label ?? `#${currentPlace}`}`,
        status: "doing",
      });
    }
    const currentLink = activeLink;
    if (currentLink) {
      const s = nodes.find((n) => n.id === currentLink.source);
      const t = nodes.find((n) => n.id === currentLink.target);
      tasks.push({
        id: currentLink.id || `link-${currentLink.key}`,
        type: "link",
        label: `Forging connection: ${s?.label ?? `#${currentLink.source}`} ↔ ${t?.label ?? `#${currentLink.target}`}`,
        status: "doing",
      });
    }
    if (activeBeacon != null) {
      const node = nodes.find((n) => n.id === activeBeacon);
      tasks.push({
        id: `beacon-${activeBeacon}`,
        type: "beacon",
        label: `Deploying Aura beacon: ${node?.label ?? `#${activeBeacon}`}`,
        status: "doing",
      });
    }
    if (currentJob && (mode === "travel" || mode === "orbit" || mode === "docking" || mode === "dockTravel")) {
      const label = mode === "docking" || mode === "dockTravel"
        ? "Recharging at the space station"
        : currentJob.description || "Patrolling the galaxy";
      tasks.push({
        id: `patrol-${currentJob.targets[0] || "active"}`,
        type: "maintenance",
        label,
        status: "doing",
      });
    }

    // Ensure all items in queues are in taskOrder
    for (const r of removalQueue) {
      if (r.id && !taskOrder.includes(r.id)) taskOrder.push(r.id);
    }
    for (const id of placeQueue) {
      const key = `place-${id}`;
      if (!taskOrder.includes(key)) taskOrder.push(key);
    }
    for (const l of linkQueue) {
      const key = l.id || `link-${l.key}`;
      if (!taskOrder.includes(key)) taskOrder.push(key);
    }
    for (const id of beaconQueue) {
      const key = `beacon-${id}`;
      if (!taskOrder.includes(key)) taskOrder.push(key);
    }
    for (const j of plannedMaintenance) {
      const key = `planned-maint-${j.targets[0]}`;
      if (!taskOrder.includes(key)) taskOrder.push(key);
    }

    // 2. Add "planned" tasks in the order of taskOrder
    const plannedTasks: any[] = [];
    const rMap = new Map(removalQueue.map(r => [r.id!, r]));
    const pMap = new Set(placeQueue);
    const lMap = new Map(linkQueue.map(l => [l.id || `link-${l.key}`, l]));
    const bMap = new Set(beaconQueue);
    const mMap = new Map(plannedMaintenance.map(j => [`planned-maint-${j.targets[0]}`, j]));

    for (const id of taskOrder) {
      if (rMap.has(id)) {
        plannedTasks.push({
          id,
          type: "removal",
          label: "Casting a memory into the Sun",
          status: "planned",
        });
      } else if (id.startsWith("place-")) {
        const nodeId = Number(id.replace("place-", ""));
        if (pMap.has(nodeId)) {
          const node = nodes.find((n) => n.id === nodeId);
          plannedTasks.push({
            id,
            type: "placement",
            label: `Ferrying new memory: ${node?.label ?? `#${nodeId}`}`,
            status: "planned",
          });
        }
      } else if (lMap.has(id)) {
        const l = lMap.get(id)!;
        const s = nodes.find((n) => n.id === l.source);
        const t = nodes.find((n) => n.id === l.target);
        plannedTasks.push({
          id,
          type: "link",
          label: `Forging connection: ${s?.label ?? `#${l.source}`} ↔ ${t?.label ?? `#${l.target}`}`,
          status: "planned",
        });
      } else if (id.startsWith("beacon-")) {
        const nodeId = Number(id.replace("beacon-", ""));
        if (bMap.has(nodeId)) {
          const node = nodes.find((n) => n.id === nodeId);
          plannedTasks.push({
            id,
            type: "beacon",
            label: `Deploying Aura beacon: ${node?.label ?? `#${nodeId}`}`,
            status: "planned",
          });
        }
      } else if (mMap.has(id)) {
        const job = mMap.get(id)!;
        const targetNode = nodes.find(n => n.id === job.targets[0]);
        plannedTasks.push({
          id,
          type: "maintenance",
          label: job.description || `Patrolling memory: ${targetNode?.label ?? `#${job.targets[0]}`}`,
          status: "planned",
        });
      }
    }

    tasks.push(...plannedTasks);

    // 3. Add "done" tasks
    for (const t of completedTasks) {
      tasks.push({
        id: t.id,
        type: t.type,
        label: t.label,
        status: "done",
      });
    }

    return tasks;
  };

  const reorderTasks = (newOrder: { id: string; type: string; status?: "doing" | "planned" | "done" }[]) => {
    const newPlannedIds = newOrder.filter(t => t.status === "planned").map(t => t.id);
    
    taskOrder.length = 0;
    taskOrder.push(...newPlannedIds);
    
    const newPlaceQueue: number[] = [];
    const newRemovalQueue: RemovalTask[] = [];
    const newLinkQueue: LinkTask[] = [];
    const newBeaconQueue: number[] = [];
    const newPlannedMaintenance: MaintenanceJob[] = [];

    for (const id of taskOrder) {
      if (id.startsWith("removal-")) {
        const match = removalQueue.find(r => r.id === id);
        if (match) newRemovalQueue.push(match);
      } else if (id.startsWith("place-")) {
        const val = Number(id.replace("place-", ""));
        if (placeQueue.includes(val)) newPlaceQueue.push(val);
      } else if (id.startsWith("link-") || linkQueue.some(l => l.id === id)) {
        const match = linkQueue.find(l => l.id === id || `link-${l.key}` === id);
        if (match) newLinkQueue.push(match);
      } else if (id.startsWith("beacon-")) {
        const val = Number(id.replace("beacon-", ""));
        if (beaconQueue.includes(val)) newBeaconQueue.push(val);
      } else if (id.startsWith("planned-maint-")) {
        const match = plannedMaintenance.find(j => `planned-maint-${j.targets[0]}` === id);
        if (match) newPlannedMaintenance.push(match);
      }
    }

    placeQueue.length = 0;
    placeQueue.push(...newPlaceQueue);
    
    removalQueue.length = 0;
    removalQueue.push(...newRemovalQueue);
    
    linkQueue.length = 0;
    linkQueue.push(...newLinkQueue);
    
    beaconQueue.length = 0;
    beaconQueue.push(...newBeaconQueue);
    
    plannedMaintenance.length = 0;
    plannedMaintenance.push(...newPlannedMaintenance);
  };

  return {
    object: group,
    update,
    getAndResetFuelBurn: () => {
      const b = fuelBurnAccum;
      fuelBurnAccum = 0;
      return b;
    },
    enqueueLinks,
    enqueuePlacements,
    enqueueBeacons,
    enqueueRemovals,
    cargo,
    trail: plume,
    taskLabel: taskLabel.sprite,
    speechBubble: speechBubble.sprite,
    say,
    setTaskVisible,
    setPilotSpeed,
    hail,
    getTasks,
    reorderTasks,
    setShipSkin,
    setTrailColor,
    setDemoMode: (v: boolean) => {
      demoMode = v;
    },
    enqueueReplays: (items: { id: number; label: string }[]) => {
      for (const it of items) {
        if (!replayQueue.some((r) => r.id === it.id)) replayQueue.push(it);
      }
    },
  };
}
