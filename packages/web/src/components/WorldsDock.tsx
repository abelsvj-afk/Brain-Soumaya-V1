/**
 * The worlds' control dock (docs/specs/worlds-controls-2026-10-29.md): one
 * horizontally scrollable row of icon-over-word tiles, grouped, under the
 * header. Pure presentation — each world decides its own tiles.
 */

export interface DockTile {
  id: string;
  /** Decorative glyph; the word below it carries the meaning (never icon-only). */
  icon: string;
  /** Short visible word. Must be contained in `name` (WCAG label-in-name). */
  label: string;
  /** Full accessible name, e.g. "Go to the Fleet Deck". */
  name: string;
  onClick: () => void;
  /** Toggle tiles (held gesture, current room, open list). Shown with a ✓ and a heavier outline. */
  active?: boolean;
  /** Tiles that open something (a list) report it to assistive tech; the badge is ▾ / ▴. */
  expanded?: boolean;
  disabled?: boolean;
}

export interface DockGroup {
  id: string;
  /** Small visible caption for the group ("Gestures"). Omit for a lone group. */
  label?: string;
  tiles: DockTile[];
}

export default function WorldsDock({ groups, label }: { groups: DockGroup[]; label: string }) {
  const shown = groups.filter((g) => g.tiles.length > 0);
  if (shown.length === 0) return null;
  return (
    <nav className="worlds-dock" aria-label={label}>
      {shown.map((g) => (
        <div key={g.id} className="worlds-dock-group" role="group" aria-label={g.label ?? label}>
          {g.label && <span className="worlds-dock-label">{g.label}</span>}
          {g.tiles.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`worlds-dock-tile${t.active ? " is-active" : ""}`}
              aria-label={t.name}
              aria-pressed={t.expanded === undefined && t.active !== undefined ? t.active : undefined}
              aria-expanded={t.expanded}
              disabled={t.disabled}
              onClick={t.onClick}
            >
              <span className="worlds-dock-icon" aria-hidden="true">
                {t.icon}
              </span>
              <span className="worlds-dock-word">{t.label}</span>
              {(t.active || t.expanded !== undefined) && (
                <span className="worlds-dock-badge" aria-hidden="true">
                  {t.expanded !== undefined ? (t.expanded ? "▴" : "▾") : "✓"}
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
