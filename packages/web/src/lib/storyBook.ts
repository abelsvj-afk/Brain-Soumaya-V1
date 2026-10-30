import { STORY_ENTRIES, storySecondReading, type StoryEntry, type StoryKind } from "@brain/shared";
import type { StoryFindRow } from "../api/story.js";

/**
 * Pure helpers for the Sixteenth's Book. No numbers are ever derived for display: the sky shows lights and silhouettes, and there is no total, ratio or "locked".
 */

export const BOOK_W = 360;
export const BOOK_H = 440;
const SECTORS = ["great-station", "growing-place", "quiet-archive", "deep-past", "scale", "people", "eternity"];

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return (x >>> 0) / 4294967295;
}

export interface SkyPoint {
  id: string;
  x: number;
  y: number;
}

/**
 * A stable place in the sky for every entry (the same for everyone, so it can be learned): each world has a sector of the ring, doors sit on the rim, entries that
 * can be found anywhere sit near the middle. A few relaxation passes keep points from touching.
 */
export function skyLayout(entries: readonly StoryEntry[] = STORY_ENTRIES): SkyPoint[] {
  const cx = BOOK_W / 2;
  const cy = BOOK_H / 2;
  const pts = entries.map((e) => {
    const sector = SECTORS.indexOf(e.world);
    const j = hash(e.id);
    const j2 = hash(`${e.id}:r`);
    let r: number;
    let a: number;
    if (sector < 0) {
      // "anywhere": the middle of the web
      r = 28 + j2 * 70;
      a = j * Math.PI * 2;
    } else {
      const span = (Math.PI * 2) / SECTORS.length;
      a = sector * span + (0.12 + 0.76 * j) * span - Math.PI / 2;
      r = e.door ? 150 + j2 * 30 : 80 + j2 * 70;
    }
    return { id: e.id, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 1.12 };
  });
  const MIN = 30;
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 0; i < pts.length; i++) {
      for (let k = i + 1; k < pts.length; k++) {
        const dx = pts[k]!.x - pts[i]!.x;
        const dy = pts[k]!.y - pts[i]!.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < MIN) {
          const push = (MIN - d) / 2;
          pts[i]!.x -= (dx / d) * push;
          pts[i]!.y -= (dy / d) * push;
          pts[k]!.x += (dx / d) * push;
          pts[k]!.y += (dy / d) * push;
        }
      }
    }
    for (const p of pts) {
      p.x = Math.min(BOOK_W - 20, Math.max(20, p.x));
      p.y = Math.min(BOOK_H - 20, Math.max(20, p.y));
    }
  }
  return pts;
}

/** The kind's word, spoken plainly: it names what sort of thing a silhouette is without saying where it is. */
export const KIND_WORD: Readonly<Record<StoryKind, string>> = {
  object: "something to hold",
  account: "something told",
  sight: "something to notice",
  echo: "something to hear",
  companion: "someone who walked beside",
};

/** A light fades if it is not recalled — a visual cue only. Nothing is ever removed or locked. Returns 0.4 (faint) … 1 (bright). */
export function brightness(find: Pick<StoryFindRow, "foundAt" | "lastRecalledAt">, nowMs: number): number {
  const last = Date.parse(find.lastRecalledAt ?? find.foundAt);
  const days = Number.isFinite(last) ? Math.max(0, (nowMs - last) / 86_400_000) : 0;
  return Math.max(0.4, Math.exp(-days / 21));
}

/** What a found entry shows: its words (plain until Flavour lands) plus a Second Reading if a partner is held. Knowledge decides; nothing is ever hidden by taste. */
export function entryWords(entry: StoryEntry, found: ReadonlySet<string>): { text: string | null; second: string | null } {
  return { text: entry.text?.plain ?? null, second: storySecondReading(entry.id, found) };
}
