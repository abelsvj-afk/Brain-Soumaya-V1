import * as THREE from "three";
import { disposeObject3D } from "./graph3dHelpers.js";
import { loadSoumayaShip } from "./soumayaShip.js";
import {
  FIGURE_MODEL,
  VISITOR_MODELS,
  fitShip,
  loadEternityAsset,
  splitFigure,
} from "./eternityAssets.js";
import {
  DYE_CLOUD_COUNT,
  ETERNITY_COMET_MS,
  ETERNITY_GESTURES,
  ETERNITY_METEOR_COUNT,
  ETERNITY_PALETTE,
  ETERNITY_SEED,
  ETERNITY_SHIELD_MS,
  ETERNITY_STAGES,
  FAR_SHELL_MAX,
  FAR_SHELL_MIN,
  FAR_VEIL_COUNT,
  GOD_SCALE,
  HALO_RING_CENTER_Y,
  HALO_RING_RADIUS,
  MOTE_COUNT,
  SPEECH_FADE_IN_MS,
  SPEECH_FADE_OUT_MS,
  SPEECH_HOLD_MS,
  SPEECH_SHAKE_MS,
  SPEECH_TABLET_POSITION,
  SPEECH_TABLET_SIZE,
  isEternityGestureName,
  isEternityToolName,
  rngFromSeed,
  visitorSlots,
  type EternityGestureName,
  type EternityToolName,
  type VisitorSlot,
} from "./eternityLayout.js";

/**
 * Eternity's world (Phase 3, Eternity app world) — three.js wiring
 * over the pure layout in eternityLayout.ts. Ported from the v3.4
 * mockup (`~/workspace/worlds-vision/mockups/man-god/index.html`),
 * not redesigned: the figure is the owner's GLB at cosmic scale in
 * the white void; the far neon can never be reached; his gestures
 * move the whole figure and drive light/halo/far colour; his words
 * appear IN THE WORLD on a floating tablet just below his chin —
 * never a screen panel — and when he speaks the heavens shake and a
 * deep cosmic rumble sounds (Web Audio, synthesized live, no audio
 * files; a blocked audio context can never break the scene).
 *
 * Every real asset loads asynchronously through the shared loader
 * with the honest fallback: a load that fails leaves that piece out
 * and registers a diagnostics note — never a crash, never a blank
 * world, never a silent missing piece presented as complete. A hull
 * that fails to load is left out and named — never replaced by a
 * procedural stand-in. The visitor fleet are real agents, not
 * cosmetics: they orbit him, leave and come back (their orbits carry
 * them around the far side), and each one needs the right relics to
 * find the gate — that gate is server-side (B-01), shared with the
 * relic increment's wiring.
 *
 * The host owns the renderer, camera, and fog (palette-matched white
 * FogExp2, per the mockup); this module owns the world group and its
 * per-frame motion. The camera shake lives here as a number
 * (`shakeAt`) for the host to apply — the host owns the camera, so
 * the scene reports the shudder instead of moving a camera it does
 * not own. Ambient motion freezes under reduced motion (same scene,
 * same information, no motion); a gesture or a tool the visitor asked
 * for still answers, because the answer is the point.
 *
 * Budget (measured, see eternityLayout.ts): ~51 draw calls / ~276k
 * visible tris worst case — inside the internal targets (≤64 / ≤500k).
 */

export interface EternityScene {
  group: THREE.Group;
  update: (elapsedMs: number, opts?: { reducedMotion?: boolean }) => void;
  dispose: () => void;
  /** Name a gesture: he turns, bows, rises, or sinks, and speaks his
   *  personal line for it in the world. Unknown names are ignored. */
  setGesture: (name: EternityGestureName | string) => void;
  /** Use one of his tools (reorder / part-veil / shield / comet).
   *  Unknown names are ignored. */
  useTool: (name: EternityToolName | string) => void;
  /** The heavens-shake amount at an elapsed time, 0–1 — the host
   *  applies it to its own camera after lookAt. Zero under reduced
   *  motion and whenever he is not speaking. */
  shakeAt: (elapsedMs: number) => number;
  /** The gesture he is holding now (for the host's own labels). */
  currentGesture: () => EternityGestureName;
}

const NEON_HEX = [0x7c5cff, 0x2dd4bf, 0xf472b6, 0xfbbf24, 0x38bdf8, 0xa78bfa, 0x34d399] as const;
const NEON_RGBA = [
  "rgba(124,92,255,0.85)",
  "rgba(45,212,191,0.85)",
  "rgba(244,114,182,0.85)",
  "rgba(251,191,36,0.85)",
  "rgba(56,189,248,0.85)",
  "rgba(167,139,250,0.85)",
  "rgba(52,211,153,0.85)",
] as const;
const DYE_COLORS = ["#7c5cff", "#2dd4bf", "#f472b6", "#fbbf24", "#38bdf8", "#a78bfa", "#34d399", "#fb7185"];

function glowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, inner);
    gr.addColorStop(1, outer);
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  }
  // No 2d context (headless tests) → a blank canvas texture: the
  // scene still constructs and the glow simply reads flat.
  return new THREE.CanvasTexture(c);
}

/** Liquid dye clouds — water with drops of dye that never mix:
 *  marbled, flowing, glowing. Distinct cores, soft blended edges,
 *  elliptical fade so no hard rectangle. Ported from the mockup. */
function dyeTexture(seed: number): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return new THREE.CanvasTexture(c); // headless: blank, no crash
  let s = (seed * 2654435761) >>> 0;
  const rr = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = 0; i < 110; i++) {
    const col = DYE_COLORS[Math.floor(rr() * DYE_COLORS.length)]!;
    const x = rr() * W;
    const y = rr() * H;
    const r = 50 + rr() * 170;
    const sx = 0.6 + rr() * 1.6;
    const sy = 0.5 + rr() * 1.0;
    g.save();
    g.translate(x, y);
    g.scale(sx, sy);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, col + "cc");
    gr.addColorStop(0.55, col + "88");
    gr.addColorStop(1, col + "00");
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    const col = DYE_COLORS[Math.floor(rr() * DYE_COLORS.length)]!;
    g.strokeStyle = col + "59";
    g.lineWidth = 14 + rr() * 44;
    g.beginPath();
    const x0 = rr() * W;
    const y0 = rr() * H;
    g.moveTo(x0, y0);
    g.quadraticCurveTo(
      x0 + (rr() - 0.5) * 500,
      y0 + (rr() - 0.5) * 300,
      x0 + (rr() - 0.5) * 700,
      y0 + (rr() - 0.5) * 260,
    );
    g.stroke();
  }
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(1, H / W);
  g.globalCompositeOperation = "destination-in";
  const fade = g.createRadialGradient(0, 0, 0, 0, 0, W * 0.52);
  fade.addColorStop(0, "rgba(255,255,255,1)");
  fade.addColorStop(0.7, "rgba(255,255,255,0.55)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = fade;
  g.fillRect(-W / 2, -W / 2, W, W);
  g.restore();
  g.globalCompositeOperation = "source-over";
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createEternityScene(): EternityScene {
  const group = new THREE.Group();
  group.name = "eternity-world";

  const goldGlow = glowTexture("rgba(255,220,140,0.95)", "rgba(255,190,70,0)");
  const whiteGlow = glowTexture("rgba(255,253,244,0.95)", "rgba(255,246,220,0)");
  const neonTex = NEON_RGBA.map((rgba) => glowTexture(rgba, rgba.replace(/[\d.]+\)$/, "0)")));

  // --- lights: the void is bright; he carries his own warm light ---
  const hemi = new THREE.HemisphereLight(0xffffff, 0xe8ddc8, 1.1);
  group.add(hemi);
  const keyLight = new THREE.DirectionalLight(0xfff2d8, 2.0);
  keyLight.position.set(300, 500, 600);
  group.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xdfe8ff, 1.4);
  rimLight.position.set(-400, 200, -500);
  group.add(rimLight);

  // --- far background: veils + dye clouds + motes, never reachable ---
  const farGroup = new THREE.Group();
  farGroup.name = "eternity-far";
  group.add(farGroup);
  const veils: THREE.Sprite[] = [];
  {
    const rnd = rngFromSeed(`${ETERNITY_SEED}:veils`);
    for (let i = 0; i < FAR_VEIL_COUNT; i++) {
      const n = i % NEON_HEX.length;
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: neonTex[n],
          transparent: true,
          opacity: 0.5 + rnd() * 0.2,
          depthWrite: false,
          fog: false,
        }),
      );
      const th = rnd() * Math.PI * 2;
      const ph = (rnd() - 0.5) * Math.PI * 1.1;
      const r = FAR_SHELL_MIN + rnd() * (FAR_SHELL_MAX - FAR_SHELL_MIN);
      sp.position.set(
        Math.cos(th) * Math.cos(ph) * r,
        Math.sin(ph) * r,
        Math.sin(th) * Math.cos(ph) * r,
      );
      const sc = 2200 + rnd() * 2000;
      sp.scale.set(sc, sc * (0.55 + rnd() * 0.5), 1);
      sp.userData = {
        baseOp: sp.material.opacity,
        phase: rnd() * Math.PI * 2,
        home: sp.position.clone(),
      };
      farGroup.add(sp);
      veils.push(sp);
    }
  }
  const dyeClouds: THREE.Mesh[] = [];
  for (let i = 0; i < DYE_CLOUD_COUNT; i++) {
    const tex = dyeTexture(11 + i * 7);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4200, 2100), mat);
    const th = (i / DYE_CLOUD_COUNT) * Math.PI * 2 + 0.5;
    const r = 4000;
    plane.position.set(Math.cos(th) * r, i % 2 ? 700 : -500, Math.sin(th) * r);
    plane.lookAt(0, 0, 0);
    plane.userData = { spin: (i % 2 ? -1 : 1) * (0.004 + i * 0.001), drift: 0.002 + i * 0.001, mat };
    farGroup.add(plane);
    dyeClouds.push(plane);
  }
  const motes = (() => {
    const rnd = rngFromSeed(`${ETERNITY_SEED}:motes`);
    const pos = new Float32Array(MOTE_COUNT * 3);
    for (let i = 0; i < MOTE_COUNT; i++) {
      const th = rnd() * Math.PI * 2;
      const ph = (rnd() - 0.5) * Math.PI;
      const r = 600 + rnd() * 2600;
      pos[i * 3] = Math.cos(th) * Math.cos(ph) * r;
      pos[i * 3 + 1] = Math.sin(ph) * r;
      pos[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xffd98a, size: 7, transparent: true, opacity: 0.55, sizeAttenuation: true }),
    );
    points.name = "eternity-motes";
    group.add(points);
    return points;
  })();

  // --- the figure: his GLB, at cosmic scale; the group holds him ---
  const god = new THREE.Group();
  god.name = "eternity-figure";
  group.add(god);
  const godLight = new THREE.PointLight(ETERNITY_PALETTE.gold, 2.4, 1600, 1.1);
  godLight.position.set(0, 60, 120);
  god.add(godLight);
  const porcelain = new THREE.MeshStandardMaterial({
    color: ETERNITY_PALETTE.porcelain,
    emissive: ETERNITY_PALETTE.porcelainEmissive,
    emissiveIntensity: 0.28,
    roughness: 0.5,
    metalness: 0.0,
  });
  const haloMat = new THREE.MeshBasicMaterial({ color: ETERNITY_PALETTE.haloGold });
  const haloBase = new THREE.Color(ETERNITY_PALETTE.haloGold);
  const haloFlare = new THREE.Color(ETERNITY_PALETTE.haloFlare);
  let disposed = false;
  void loadEternityAsset(FIGURE_MODEL.url).then((loaded) => {
    if (!loaded || disposed) {
      if (loaded) disposeObject3D(loaded);
      return;
    }
    const box = new THREE.Box3().setFromObject(loaded);
    const c = box.getCenter(new THREE.Vector3());
    loaded.position.sub(c);
    loaded.scale.setScalar(GOD_SCALE);
    const { body, halo } = splitFigure(loaded);
    for (const mesh of body) {
      mesh.material = porcelain;
      mesh.castShadow = false;
    }
    if (halo) {
      halo.material = haloMat;
      halo.castShadow = false;
    }
    god.add(loaded);
  });

  // His own soft glow so the white figure reads against the white void.
  const godAura = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: whiteGlow, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  godAura.scale.set(760, 900, 1);
  god.add(godAura);

  // Energy veils around HIS halo: violet, teal, gold on the ring's
  // borders — a veil of energy, not a second halo.
  const veilSprites: THREE.Sprite[] = [];
  for (let i = 0; i < 3; i++) {
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: neonTex[[0, 1, 3][i]!]!, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    sp.scale.set(100, 100, 1);
    sp.userData = { phase: i * (Math.PI * 2) / 3, speed: 0.1 + i * 0.03, baseOp: 0.45 };
    god.add(sp);
    veilSprites.push(sp);
  }

  // --- his voice, in the world: the speech tablet ---
  const speechCanvas = document.createElement("canvas");
  speechCanvas.width = 1024;
  speechCanvas.height = 512;
  const sctx = speechCanvas.getContext("2d");
  const speechTex = new THREE.CanvasTexture(speechCanvas);
  const speechSprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: speechTex, transparent: true, opacity: 0, depthWrite: false }),
  );
  speechSprite.scale.set(SPEECH_TABLET_SIZE[0], SPEECH_TABLET_SIZE[1], 1);
  speechSprite.position.set(SPEECH_TABLET_POSITION[0], SPEECH_TABLET_POSITION[1], SPEECH_TABLET_POSITION[2]);
  speechSprite.name = "eternity-speech-tablet";
  god.add(speechSprite);

  function drawSpeech(text: string): void {
    const g = sctx;
    if (!g) return; // headless: no 2d context — the tablet stays blank, no crash
    g.clearRect(0, 0, 1024, 512);
    g.fillStyle = "rgba(12,10,28,0.82)";
    g.beginPath();
    if (typeof g.roundRect === "function") g.roundRect(24, 24, 976, 464, 36);
    else g.rect(24, 24, 976, 464);
    g.fill();
    g.strokeStyle = "rgba(255,217,119,0.55)";
    g.lineWidth = 3;
    g.beginPath();
    if (typeof g.roundRect === "function") g.roundRect(24, 24, 976, 464, 36);
    else g.rect(24, 24, 976, 464);
    g.stroke();
    g.fillStyle = "#ffd977";
    g.fillRect(24, 60, 10, 392);
    g.fillStyle = "#ffd977";
    g.font = "800 30px system-ui, sans-serif";
    g.fillText("E T E R N I T Y", 64, 92);
    g.fillStyle = "#fffbef";
    let fontPx = 46;
    const wrap = (px: number) => {
      g.font = `600 ${px}px system-ui, sans-serif`;
      const words = text.split(" ");
      const out: string[] = [];
      let cur = "";
      for (const w of words) {
        const t = cur ? cur + " " + w : w;
        if (g.measureText(t).width > 860 && cur) {
          out.push(cur);
          cur = w;
        } else cur = t;
      }
      if (cur) out.push(cur);
      return out;
    };
    let lines = wrap(fontPx);
    if (lines.length > 4) {
      fontPx = 38;
      lines = wrap(fontPx);
    }
    const lh = fontPx + 16;
    const y0 = 150 + (4 - Math.min(lines.length, 4)) * lh * 0.25;
    lines.slice(0, 4).forEach((ln, i) => g.fillText(ln, 64, y0 + i * lh));
    speechTex.needsUpdate = true;
  }

  // Deep cosmic rumble: sub sines + a falling boom + shaken air, all
  // synthesized live (no audio files). Audio is a garnish — a blocked
  // context must never break the scene.
  let audioCtx: AudioContext | null = null;
  function rumble(): void {
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") void audioCtx.resume();
      const t0 = audioCtx.currentTime + 0.02;
      const dur = 2.0;
      const master = audioCtx.createGain();
      master.gain.setValueAtTime(0.0001, t0);
      master.gain.exponentialRampToValueAtTime(0.5, t0 + 0.12);
      master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      master.connect(audioCtx.destination);
      [42, 47.5].forEach((f, i) => {
        const o = audioCtx!.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        const og = audioCtx!.createGain();
        og.gain.value = i ? 0.5 : 0.8;
        o.connect(og);
        og.connect(master);
        o.start(t0);
        o.stop(t0 + dur);
      });
      const boom = audioCtx.createOscillator();
      boom.type = "sine";
      boom.frequency.setValueAtTime(90, t0);
      boom.frequency.exponentialRampToValueAtTime(34, t0 + 0.6);
      const bg = audioCtx.createGain();
      bg.gain.setValueAtTime(0.9, t0);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      boom.connect(bg);
      bg.connect(master);
      boom.start(t0);
      boom.stop(t0 + 1.0);
      const len = Math.floor(audioCtx.sampleRate * dur);
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = buf;
      const lp = audioCtx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 140;
      const ng = audioCtx.createGain();
      ng.gain.value = 0.7;
      noise.connect(lp);
      lp.connect(ng);
      ng.connect(master);
      noise.start(t0);
      noise.stop(t0 + dur);
    } catch {
      /* audio is a garnish — never break the scene */
    }
  }

  // --- gesture + speech state (elapsedMs domain, wall-clock timed) ---
  let gestureName: EternityGestureName = "stillness";
  // The pose is numbers, not the gesture table's literal types — it
  // lerps toward the target every frame.
  let pose: {
    faceCam: number;
    pitch: number;
    lift: number;
    halo: number;
    light: number;
    lightIntensity: number;
    veil: number;
  } = { ...ETERNITY_GESTURES.stillness };
  let speechStartMs = -1;
  let lastElapsedMs = 0;
  let lastReducedMotion = false;

  function speak(text: string): void {
    drawSpeech(text);
    speechStartMs = lastElapsedMs;
    rumble();
  }

  function setGesture(name: EternityGestureName | string): void {
    if (!isEternityGestureName(name)) return;
    gestureName = name;
    // The app is one visitor's own view: he speaks his personal line.
    // (The mockup's Broadcast toggle — the same words for everyone —
    // is a fixture console concern, not the app's.)
    speak(ETERNITY_GESTURES[name].personal);
  }

  // --- the shield + meteors (protection, never destruction) ---
  const shield = new THREE.Mesh(
    new THREE.SphereGeometry(330, 40, 28),
    new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  shield.position.y = 10;
  shield.name = "eternity-shield";
  group.add(shield);
  let shieldUntilMs = -1;
  const meteors: {
    line: THREE.Line;
    t: number;
    from: THREE.Vector3;
    vel: THREE.Vector3;
  }[] = [];
  const meteorMat = new THREE.LineBasicMaterial({ color: 0xd9a441, transparent: true, opacity: 0.95 });
  for (let i = 0; i < ETERNITY_METEOR_COUNT; i++) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -26, 0)]);
    const line = new THREE.Line(geo, meteorMat);
    line.visible = false;
    group.add(line);
    meteors.push({ line, t: 1e9, from: new THREE.Vector3(), vel: new THREE.Vector3() });
  }
  function meteorShower(): void {
    const rnd = rngFromSeed(`${ETERNITY_SEED}:shower-${Math.floor(lastElapsedMs)}`);
    meteors.forEach((m, i) => {
      m.t = -i * 0.55;
      m.from.set(-700 + rnd() * 500, 700 + rnd() * 200, -500 + rnd() * 500);
      m.vel.set(150 + rnd() * 80, -300 - rnd() * 90, 60);
    });
  }

  // --- comet (wonder) ---
  const comet = new THREE.Group();
  comet.name = "eternity-comet";
  const cometHead = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: whiteGlow, transparent: true, opacity: 0, depthWrite: false }),
  );
  cometHead.scale.set(120, 120, 1);
  comet.add(cometHead);
  group.add(comet);
  let cometT = 1e9;
  const cometFrom = new THREE.Vector3(-2600, 900, -1800);
  const cometTo = new THREE.Vector3(2600, -300, -1500);

  // --- visitor fleet: 12 real ships on their orbits ---
  const slots = visitorSlots(VISITOR_MODELS.length);
  const visitors: { g: THREE.Group; slot: VisitorSlot }[] = [];
  VISITOR_MODELS.forEach((model, i) => {
    const slot = slots[i]!;
    const s = new THREE.Group();
    s.name = `eternity-visitor-${model.key}`;
    group.add(s);
    visitors.push({ g: s, slot });
    void loadEternityAsset(model.url).then((loaded) => {
      if (!loaded || disposed) {
        if (loaded) disposeObject3D(loaded);
        return;
      }
      s.add(fitShip(loaded, 11, model.flip));
    });
  });

  // --- the player's ship: her own ship, at the presence anchor ---
  const playerShip = new THREE.Group();
  playerShip.name = "eternity-player-ship";
  playerShip.scale.setScalar(1.5);
  playerShip.position.set(
    ETERNITY_STAGES.presence.ship[0],
    ETERNITY_STAGES.presence.ship[1],
    ETERNITY_STAGES.presence.ship[2],
  );
  group.add(playerShip);
  void loadSoumayaShip().then((hero) => {
    if (!hero || disposed) {
      if (hero) disposeObject3D(hero);
      return;
    }
    playerShip.add(fitShip(hero, 11, false));
  });

  // --- his tools ---
  let veilParted = false;
  function useTool(name: EternityToolName | string): void {
    if (!isEternityToolName(name)) return;
    const rnd = rngFromSeed(`${ETERNITY_SEED}:reorder-${Math.floor(lastElapsedMs)}`);
    if (name === "reorder") {
      for (const v of veils) {
        const a = rnd() * Math.PI * 2;
        const r = FAR_SHELL_MIN + rnd() * (FAR_SHELL_MAX - FAR_SHELL_MIN);
        (v.userData.home as THREE.Vector3).set(Math.cos(a) * r, (rnd() - 0.5) * 2800, Math.sin(a) * r);
      }
      farGroup.rotation.y += 0.6;
    } else if (name === "part-veil") {
      veilParted = !veilParted;
      veils.forEach((v, i) => {
        const dir = i % 2 ? 1 : -1;
        (v.userData.home as THREE.Vector3).x += dir * (veilParted ? 700 : -700);
      });
    } else if (name === "shield") {
      shieldUntilMs = lastElapsedMs + ETERNITY_SHIELD_MS;
      meteorShower();
    } else if (name === "comet") {
      cometT = 0;
    }
  }

  function shakeAt(elapsedMs: number): number {
    if (lastReducedMotion || speechStartMs < 0) return 0;
    return Math.max(0, 1 - (elapsedMs - speechStartMs) / SPEECH_SHAKE_MS);
  }

  let prevElapsedMs = 0;
  const update = (elapsedMs: number, uopts?: { reducedMotion?: boolean }) => {
    const rm = uopts?.reducedMotion ?? false;
    lastReducedMotion = rm;
    const dt = Math.min(Math.max(0, (elapsedMs - prevElapsedMs) / 1000), 0.05);
    prevElapsedMs = elapsedMs;
    lastElapsedMs = elapsedMs;
    const t = rm ? 0 : elapsedMs / 1000;

    // Gesture pose — slow, monumental. Reduced motion snaps to it.
    const target = ETERNITY_GESTURES[gestureName];
    const k = rm ? 1 : Math.min(1, dt * 0.55);
    const L = (a: number, b: number) => a + (b - a) * k;
    pose = {
      ...pose,
      faceCam: L(pose.faceCam, target.faceCam),
      pitch: L(pose.pitch, target.pitch),
      lift: L(pose.lift, target.lift),
      halo: L(pose.halo, target.halo),
      lightIntensity: L(pose.lightIntensity, target.lightIntensity),
      veil: L(pose.veil, target.veil),
    };
    // The figure faces the camera only as far as the gesture turns
    // him; the host's orbit angle is not visible here, so the face
    // turn is a fraction of the gesture's own facing (the mockup
    // turned him toward its camera — the app's camera orbits, so the
    // turn is gentle and never chases the orbit).
    const idleYaw = rm ? 0 : Math.sin(t * 0.1) * 0.05;
    god.rotation.y = idleYaw + pose.faceCam * 0.35;
    god.rotation.x = pose.pitch;
    god.position.y = pose.lift + (rm ? 0 : Math.sin(t * 0.35) * 4);
    godLight.intensity = pose.lightIntensity;
    godLight.color.setHex(target.light);
    const speakPulse =
      speechStartMs >= 0 ? Math.max(0, 1 - (elapsedMs - speechStartMs) / 1600) : 0;
    haloMat.color.lerpColors(
      haloBase,
      haloFlare,
      Math.max(0, Math.min(1, (pose.halo - 0.85) / 0.65 + speakPulse * 0.25)),
    );
    for (const v of veilSprites) {
      const a = (rm ? 0 : t * (v.userData.speed as number)) + (v.userData.phase as number);
      v.position.set(Math.cos(a) * HALO_RING_RADIUS, HALO_RING_CENTER_Y + Math.sin(a) * HALO_RING_RADIUS, -14);
      (v.material as THREE.SpriteMaterial).opacity =
        (v.userData.baseOp as number) *
        (rm ? 1 : 0.75 + 0.25 * Math.sin(t * 1.1 + (v.userData.phase as number))) *
        (0.7 + (0.3 * pose.halo) / 1.5);
    }
    (godAura.material as THREE.SpriteMaterial).opacity = 0.45 + pose.veil * 0.08;

    // Speech tablet: fade in 0.4 s, hold 7 s, fade out 1 s (wall-clock
    // from the elapsed domain — the same on every device).
    let speechTarget = 0;
    if (speechStartMs >= 0) {
      const sinceSpeak = elapsedMs - speechStartMs;
      if (sinceSpeak < SPEECH_HOLD_MS) speechTarget = Math.min(0.95, sinceSpeak / SPEECH_FADE_IN_MS);
      else speechTarget = Math.max(0, 0.95 - (sinceSpeak - SPEECH_HOLD_MS) / SPEECH_FADE_OUT_MS);
    }
    (speechSprite.material as THREE.SpriteMaterial).opacity = speechTarget;

    // Far background: alive — veils breathe and drift, dye clouds flow.
    farGroup.rotation.y += rm ? 0 : dt * 0.006;
    for (const v of veils) {
      const mat = v.material as THREE.SpriteMaterial;
      mat.opacity =
        (v.userData.baseOp as number) *
        pose.veil *
        (0.85 + (rm ? 0 : Math.sin(t * 0.5 + (v.userData.phase as number)) * 0.15));
      const home = v.userData.home as THREE.Vector3;
      v.position.x += (home.x - v.position.x) * Math.min(1, dt * 0.4);
      v.position.z += (home.z - v.position.z) * Math.min(1, dt * 0.4);
      v.position.y = home.y + (rm ? 0 : Math.sin(t * 0.22 + (v.userData.phase as number)) * 120);
    }
    for (const d of dyeClouds) {
      d.rotateZ(rm ? 0 : dt * (d.userData.spin as number));
      ((d.userData.mat as THREE.MeshBasicMaterial).map as THREE.CanvasTexture).offset.x +=
        rm ? 0 : dt * (d.userData.drift as number);
    }
    motes.rotation.y += rm ? 0 : dt * 0.008;

    // Player ship rides the presence anchor with a lag.
    const anchor = ETERNITY_STAGES.presence.ship;
    playerShip.position.x += (anchor[0] - playerShip.position.x) * (rm ? 1 : Math.min(1, dt * 1.4));
    playerShip.position.y += (anchor[1] - playerShip.position.y) * (rm ? 1 : Math.min(1, dt * 1.4));
    playerShip.position.z += (anchor[2] - playerShip.position.z) * (rm ? 1 : Math.min(1, dt * 1.4));
    playerShip.position.y += rm ? 0 : Math.sin(t * 1.7) * 0.6;
    playerShip.lookAt(0, 60, 0);

    // Visitor ships orbit him slowly — they leave around the far side
    // and come back, like real visitors.
    for (const v of visitors) {
      if (!rm) v.slot.angle += v.slot.speed * dt * 10;
      v.g.position.set(
        Math.cos(v.slot.angle) * v.slot.radius,
        v.slot.height + (rm ? 0 : Math.sin(t * 0.8 + v.slot.bobPhase) * 4),
        Math.sin(v.slot.angle) * v.slot.radius,
      );
      v.g.lookAt(0, v.slot.height, 0);
    }

    // Shield + meteors: stones break on the light.
    const shieldOn = elapsedMs < shieldUntilMs;
    const shieldMat = shield.material as THREE.MeshBasicMaterial;
    shieldMat.opacity += ((shieldOn ? 0.14 : 0) - shieldMat.opacity) * Math.min(1, dt * 2);
    for (const m of meteors) {
      m.t += dt;
      if (m.t < 0) {
        m.line.visible = false;
        continue;
      }
      const p = m.from.clone().addScaledVector(m.vel, m.t);
      const d = Math.hypot(p.x, p.y - 10, p.z);
      if (shieldOn && d < 345) {
        m.line.visible = false;
        m.t = 1e9;
        continue;
      }
      if (p.y < -400) {
        m.line.visible = false;
        m.t = 1e9;
        continue;
      }
      m.line.visible = true;
      m.line.position.copy(p);
      m.line.rotation.z = Math.atan2(m.vel.y, m.vel.x) + Math.PI / 2;
    }

    // Comet: 7 s across the sky.
    if (cometT < ETERNITY_COMET_MS / 1000) {
      cometT += dt;
      const e = cometT / (ETERNITY_COMET_MS / 1000);
      comet.position.lerpVectors(cometFrom, cometTo, Math.min(e, 1));
      (cometHead.material as THREE.SpriteMaterial).opacity = Math.sin(Math.min(e, 1) * Math.PI) * 0.95;
    } else {
      (cometHead.material as THREE.SpriteMaterial).opacity = 0;
    }
  };
  update(0);

  return {
    group,
    update,
    dispose: () => {
      disposed = true;
      try {
        void audioCtx?.close();
      } catch {
        /* ignore */
      }
      disposeObject3D(group);
    },
    setGesture,
    useTool,
    shakeAt,
    currentGesture: () => gestureName,
  };
}
