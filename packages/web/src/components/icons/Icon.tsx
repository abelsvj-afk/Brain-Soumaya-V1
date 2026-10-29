import type { ReactNode } from "react";

/**
 * The HUD's icon set (docs/specs/persistent-hud-2026-10-30.md): one consistent stroke style, drawn as code — 24×24 grid,
 * 1.8 stroke, round caps and joins, `currentColor` so a button's state tints its icon. Crisp at any size, ~100 bytes each,
 * no image requests. Icons are decorative (`aria-hidden`): every button keeps its visible word / accessible name.
 * Where data carries an icon as a string, write `i:<name>`; anything else (an emoji) renders as text, so content can mix.
 */
const circle = (cx: number, cy: number, r: number) => <circle cx={cx} cy={cy} r={r} />;
const d = (path: string) => <path d={path} />;

const ICONS = {
  // --- the rails and the top row ---
  search: <>{circle(10.5, 10.5, 6.5)}{d("M15.5 15.5 21 21")}</>,
  panels: d("M4 7h16M4 12h16M4 17h16"),
  settings: <>{d("M10.3 5.0 L10.5 2.3 L13.5 2.3 L13.7 5.0 L15.7 5.8 L17.8 4.1 L19.9 6.2 L18.2 8.3 L19.0 10.3 L21.7 10.5 L21.7 13.5 L19.0 13.7 L18.2 15.7 L19.9 17.8 L17.8 19.9 L15.7 18.2 L13.7 19.0 L13.5 21.7 L10.5 21.7 L10.3 19.0 L8.3 18.2 L6.2 19.9 L4.1 17.8 L5.8 15.7 L5.0 13.7 L2.3 13.5 L2.3 10.5 L5.0 10.3 L5.8 8.3 L4.1 6.2 L6.2 4.1 L8.3 5.8z")}{circle(12, 12, 3)}</>,
  chat: d("M4 5h16v11H10l-5 4v-4H4z"),
  observatory: d("M3 14.5 15 8.5l2 4-12 6zM15 8.5l3-1.5 2 4-3 1.5M11 16.5 8 22M11 16.5 14 22"),
  add: <>{circle(12, 12, 9)}{d("M12 8v8M8 12h8")}</>,
  music: d("M4 10v4h4l5 4V6l-5 4zM16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11"),
  "music-off": d("M4 10v4h4l5 4V6l-5 4zM17 9l5 6M22 9l-5 6"),
  tools: d("M3 8h18v12H3zM9 8V5h6v3M3 13h18"),
  focus: <>{circle(12, 12, 9)}{circle(12, 12, 4.5)}{circle(12, 12, 0.8)}</>,
  views: d("M12 3l9 4.5-9 4.5L3 7.5zM3 12l9 4.5 9-4.5M3 16.5 12 21l9-4.5"),
  recenter: <>{circle(12, 12, 6)}{d("M12 2v4M12 18v4M2 12h4M18 12h4")}</>,
  "zoom-in": <>{circle(10.5, 10.5, 6.5)}{d("M15.5 15.5 21 21M8 10.5h5M10.5 8v5")}</>,
  "zoom-out": <>{circle(10.5, 10.5, 6.5)}{d("M15.5 15.5 21 21M8 10.5h5")}</>,
  calm: d("M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"),
  sun: <>{circle(12, 12, 4)}{d("M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8")}</>,
  notices: d("M4 5h16v11H10l-5 4v-4H4zM8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"),
  drop: d("M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"),
  // --- panels and menus ---
  details: <>{circle(12, 12, 9)}{d("M12 11v6M12 7.5h.01")}</>,
  browse: d("M4 4h5v16H4zM9 4h5v16H9zM15 5.5l5 1.2-3.4 13.8-5-1.2z"),
  mind: d("M9.5 4a3 3 0 0 0-3 3 3 3 0 0 0-2.3 3 3 3 0 0 0 1.6 2.6A3 3 0 0 0 9 17a3 3 0 0 0 3 3V4.5A3 3 0 0 0 9.5 4zM14.5 4a3 3 0 0 1 3 3 3 3 0 0 1 2.3 3 3 3 0 0 1-1.6 2.6A3 3 0 0 1 15 17a3 3 0 0 1-3 3"),
  agenda: d("M4 4h16v16H4zM8 12.5l3 3L16.5 9"),
  insights: d("M10.5 3 12.7 8.3 18 10.5l-5.3 2.2L10.5 18 8.3 12.7 3 10.5l5.3-2.2zM19 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"),
  soumaya: d("M9 4.5 13 8.5l-4 4-4-4zM15 11.5l4 4-4 4-4-4zM12 11l-3 3M7 17l-3 3M17 7l3-3"),
  inbox: d("M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20.5a2 2 0 0 0 4 0"),
  progress: d("M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v2a4 4 0 0 0 4 4M16 6h4v2a4 4 0 0 1-4 4M12 13v4M8 20h8M10 17h4"),
  journeys: <>{circle(12, 12, 9)}{d("M15.7 8.3l-2.2 5.2-5.2 2.2 2.2-5.2z")}</>,
  money: <>{circle(12, 12, 9)}{d("M14.8 9.3a3.2 2.3 0 0 0-2.8-1.3c-1.8 0-3.2 1-3.2 2.2 0 1.4 1.5 1.8 3.2 2.1 1.7.3 3.2.7 3.2 2.1 0 1.2-1.4 2.2-3.2 2.2a3.2 2.3 0 0 1-2.8-1.3M12 6v2M12 16v2")}</>,
  hangar: d("M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.6 2.6-2.4-.6-.6-2.4z"),
  people: <>{circle(9, 8, 3)}{d("M3 20a6 6 0 0 1 12 0")}{circle(17, 9, 2.5)}{d("M16 14a5 5 0 0 1 5 5")}</>,
  notes: d("M5 3h11l3 3v15H5zM8 9h8M8 13h8M8 17h5"),
  lenses: d("M12 3l9 4.5-9 4.5L3 7.5zM3 12l9 4.5 9-4.5"),
  connections: d("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"),
  recall: d("M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4"),
  timeline: <>{circle(12, 12, 9)}{d("M12 7v5l3 2")}</>,
  legend: d("M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"),
  planet: <>{circle(12, 12, 5)}<ellipse cx="12" cy="12" rx="10" ry="3.5" transform="rotate(-20 12 12)" /></>,
  rocket: d("M12 3c3 2 5 5 5 9l-2 3H9l-2-3c0-4 2-7 5-9zM9 15l-3 3M15 15l3 3M12 9.5h.01M10 18l2 3 2-3"),
  comet: <>{circle(16, 8, 3)}{d("M14 10 4 20M11 8 5 14M16 13l-6 6")}</>,
  help: <>{circle(12, 12, 9)}{d("M9.5 9.5a2.5 2.5 0 1 1 4 2c-1 .8-1.5 1.2-1.5 2.5M12 17h.01")}</>,
  close: d("M6 6l12 12M18 6 6 18"),
  // --- worlds ---
  door: d("M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18M14.5 12h.01"),
  groves: d("M12 21v-6M12 15c-4 0-6-3-6-6a6 6 0 0 1 12 0c0 3-2 6-6 6z"),
  meadow: d("M12 21V9M12 9c-2-1-3-3-3-5 2 0 3 2 3 5M12 9c2-1 3-3 3-5-2 0-3 2-3 5M12 14c-2-1-3-3-3-5M12 14c2-1 3-3 3-5"),
  descend: d("M12 4v14M6 12l6 6 6-6"),
  rise: d("M12 20V6M6 12l6-6 6 6"),
  harbor: d("M12 3v13M8 7h8M5 13a7 7 0 0 0 14 0M3 13h4M17 13h4"),
  // --- Eternity's gestures and tools ---
  stillness: d("M20 4c-8 0-14 5-14 12v4M20 4c0 8-5 14-12 14M6 20l8-8"),
  regard: <>{d("M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z")}{circle(12, 12, 3)}</>,
  warning: d("M7 12V6a1.5 1.5 0 0 1 3 0v4M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V6a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6 5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.5-1.5L7 13"),
  reorder: d("M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"),
  veil: d("M3 4h18M5 4c0 8 2 12 2 16M12 4v16M19 4c0 8-2 12-2 16"),
  shield: d("M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`hud-icon${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

/** `i:search` → the icon; anything else (an emoji) → the text itself. */
export function renderIcon(icon: string, size?: number): ReactNode {
  if (icon.startsWith("i:")) {
    const name = icon.slice(2) as IconName;
    return name in ICONS ? <Icon name={name} size={size} /> : icon;
  }
  return icon;
}
