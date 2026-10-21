import * as THREE from "three";

/**
 * Pure helpers extracted from the large soumaya.ts (Post-MVP D4 refactor): vector
 * conversion, the eased smoothstep, the marquee task-label sprite factory, and body
 * radius. No ship state — pure functions.
 */

export const vecOf = (n: any): THREE.Vector3 => new THREE.Vector3(n.x ?? 0, n.y ?? 0, n.z ?? 0);

/** Smoothstep ease (slow start + slow finish) — gives accel/decel along a path. */
export const smooth = (x: number): number => {
  const c = x < 0 ? 0 : x > 1 ? 1 : x;
  return c * c * (3 - 2 * c);
};

/**
 * A billboard "task" label that floats above the ship and shows what she's doing.
 * Long text marquee-scrolls. Kept as a standalone object (added to the scene by
 * Graph3D) so the ship's banking/roll never tilts or swings it.
 */
export function makeTaskLabel() {
  const canvas = document.createElement("canvas");
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  // Enable depthTest so the label sorts correctly in 3D space instead of drawing on top of the ship
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.visible = false;
  const H = 56; // canvas px height
  const HU = 7.5; // world height (smaller from 11)
  const MAXW = 85; // world width before it marquees (smaller from 120)
  let scroll = false;
  let off = 0;
  let widthUnits = HU;

  const draw = (text: string) => {
    const ctx = canvas.getContext("2d")!;
    const FS = 32;
    const pad = 22;
    ctx.font = `600 ${FS}px system-ui, -apple-system, sans-serif`;
    const textWidth = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const baseWidthUnits = (textWidth / H) * HU;
    const needScroll = baseWidthUnits > MAXW;
    
    // Add gap space at the end if scrolling so it doesn't loop-clump immediately
    const gap = needScroll ? 140 : 0;
    const w = Math.max(64, textWidth + gap);
    
    canvas.width = w;
    canvas.height = H;
    const c = canvas.getContext("2d")!;
    c.clearRect(0, 0, w, H);
    c.font = `600 ${FS}px system-ui, -apple-system, sans-serif`;
    c.textBaseline = "middle";
    // translucent pill
    c.fillStyle = "rgba(8,5,20,0.65)";
    c.fillRect(0, 0, w, H);
    c.fillStyle = "#cfe0ff";
    c.fillText(text, pad, H / 2 + 1);
    tex.needsUpdate = true;
    
    widthUnits = (w / H) * HU;
    if (needScroll) {
      scroll = true;
      tex.repeat.x = MAXW / widthUnits;
      sprite.scale.set(MAXW, HU, 1);
    } else {
      scroll = false;
      tex.repeat.x = 1;
      tex.offset.x = 0;
      sprite.scale.set(widthUnits, HU, 1);
    }
  };

  const tick = (dt: number) => {
    if (scroll) {
      off = (off + dt * 0.08) % 1; // scroll slightly faster for cool effect
      tex.offset.x = off;
    }
  };

  return { sprite, draw, tick };
}

/** Wrap text for the speech bubble: greedy word wrap at `maxChars`, hard-split
 *  for over-long words, capped at `maxLines` with an ellipsis. Pure (IM-139). */
export function wrapBubbleText(text: string, maxChars = 34, maxLines = 3): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const word = w.length > maxChars ? `${w.slice(0, maxChars - 1)}…` : w;
    if (!cur) cur = word;
    else if ((cur + " " + word).length <= maxChars) cur += " " + word;
    else {
      lines.push(cur);
      cur = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur && (lines.length === 0 || lines[lines.length - 1] !== cur)) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  // If we stopped early, mark the truncation on the last visible line.
  const joined = lines.join(" ");
  if (joined.replace(/…$/, "") !== words.join(" ") && lines.length > 0) {
    const last = lines[lines.length - 1]!;
    lines[lines.length - 1] = last.endsWith("…") ? last : `${last.slice(0, maxChars - 1)}…`;
  }
  return lines;
}

/**
 * An in-world SPEECH BUBBLE (IM-139) — a rounded bubble with a little tail,
 * billboarded above Soumaya's ship (added to the scene by Graph3D like the
 * task label, so the ship's banking never tilts it). This is her reaction
 * surface in the world itself, distinct from the flat "current task" pill:
 * connection reactions and the mass-cooling concern are spoken here.
 */
export function makeSpeechBubble() {
  const canvas = document.createElement("canvas");
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true });
  const sprite = new THREE.Sprite(mat);
  sprite.visible = false;
  const HU = 11; // world height for a 1-line bubble; grows per line

  const draw = (text: string) => {
    const lines = wrapBubbleText(text);
    const FS = 30;
    const padX = 26;
    const padY = 18;
    const lineH = 38;
    const tail = 16;
    const ctx0 = canvas.getContext("2d")!;
    ctx0.font = `600 ${FS}px system-ui, -apple-system, sans-serif`;
    const textW = Math.max(...lines.map((l) => ctx0.measureText(l).width), 40);
    const w = Math.ceil(textW) + padX * 2;
    const h = lines.length * lineH + padY * 2 + tail;
    canvas.width = Math.max(64, w);
    canvas.height = h;
    const c = canvas.getContext("2d")!;
    c.clearRect(0, 0, canvas.width, h);
    // Bubble body (rounded rect) + tail pointing down toward the ship.
    const r = 22;
    const bw = canvas.width;
    const bh = h - tail;
    c.beginPath();
    c.moveTo(r, 2);
    c.lineTo(bw - r, 2);
    c.arcTo(bw - 2, 2, bw - 2, r, r);
    c.lineTo(bw - 2, bh - r);
    c.arcTo(bw - 2, bh - 2, bw - r, bh - 2, r);
    c.lineTo(bw / 2 + 14, bh - 2);
    c.lineTo(bw / 2, h - 2); // tail tip
    c.lineTo(bw / 2 - 14, bh - 2);
    c.lineTo(r, bh - 2);
    c.arcTo(2, bh - 2, 2, bh - r, r);
    c.lineTo(2, r);
    c.arcTo(2, 2, r, 2, r);
    c.closePath();
    c.fillStyle = "rgba(16,20,44,0.92)";
    c.fill();
    c.strokeStyle = "rgba(150,190,255,0.85)";
    c.lineWidth = 2.5;
    c.stroke();
    c.font = `600 ${FS}px system-ui, -apple-system, sans-serif`;
    c.textBaseline = "middle";
    c.fillStyle = "#eaf2ff";
    lines.forEach((l, i) => c.fillText(l, padX, padY + lineH * (i + 0.5)));
    tex.needsUpdate = true;
    const worldH = HU * (h / 120);
    sprite.scale.set((canvas.width / h) * worldH, worldH, 1);
  };

  return { sprite, draw };
}

/** Approximate a body's visual radius (mirrors nodeObject sizing) for standoff. */
export const bodyRadius = (n: any): number => {
  const m = n.mass ?? 0.3;
  switch (n.celestial) {
    case "supergiant":
      return 9 + m * 7;
    case "star":
      return 6 + m * 6;
    case "giant":
      return 6.5 + m * 5;
    case "gas_giant":
      return 5.5 + m * 4.5;
    case "planet":
      return 4 + m * 4;
    case "moon":
      return 3 + m * 2.5;
    default:
      return 2.2 + m * 2;
  }
};
