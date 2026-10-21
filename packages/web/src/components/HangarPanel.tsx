import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  EMPTY_UNLOCK_STATS,
  isUnlocked,
  unlockProgress,
  unlockablesByCategory,
  type UnlockStats,
  type UnlockableItem,
} from "@brain/shared";
import { loadUnlocked } from "./achievements.js";
import { readDevUnlockAll } from "./unlockables.js";
import { TRACKS } from "../graph/audio.js";
import { getFigurineIcon } from "../App.helpers.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";

/**
 * HangarPanel — the visual-customization tab (CL-12: IM-96..102 + the
 * IM-133 Hangar migration).
 *
 * Gating truth: the SHARED unlockables system (packages/shared/src/
 * unlockables.ts) — the catalog decides what exists and `isUnlocked`
 * decides what this brain has earned. App assembles the UnlockStats and
 * passes them down (RightDock → here); the dev-unlock-all flag applies
 * here exactly as it does to music. When no stats are supplied
 * (standalone use), stats are derived from the panel's own props — the
 * memory count plus the persisted achievement set — and evaluated by
 * the same evaluator, so there is still only one gating rule.
 *
 * The panel is a real control surface (IM-98): equip state lives in its
 * own React state, loaded from / written to the per-space localStorage
 * keys App + Graph3D already consume (`brain.hangar.*.<spaceId>`).
 * Equipping updates this panel immediately; `onEquipChanged` remains
 * the notification App uses to refresh its own copies for the scene.
 */

export type HangarViewTarget = "ship" | "station" | "fig1" | "fig2";

export interface HangarPanelProps {
  spaceId: string;
  memoriesCount: number;
  onEquipChanged: () => void;
  /** Full shared-system stats from App (one gating truth, IM-133). */
  unlockStats?: UnlockStats | null;
  /** Dev-unlock-all override (docs/UNLOCKABLES.md — dev-only). Defaults to the stored flag. */
  devUnlockAll?: boolean;
  /** IM-96: close the dock and focus this in the galaxy (implemented by App). */
  onViewInGalaxy?: (target: HangarViewTarget) => void;
  /** IM-102: play a playlist track by index — App's gated playSong. */
  onPlayTrack?: (index: number) => void;
  /** Index into TRACKS of the track the player last reported, if any. */
  currentTrackIndex?: number | null;
  musicPlaying?: boolean;
}

/**
 * IM-99: the figurine options one slot may offer — every catalog
 * figurine EXCEPT the one the other slot already holds (the same
 * monument twice is not a loadout). The slot's own current pick and
 * `none` are always offerable.
 */
export function figurineOptionsForSlot(
  items: readonly UnlockableItem[],
  otherEquipped: string,
  ownEquipped: string,
): UnlockableItem[] {
  return items.filter(
    (i) => i.equipValue === "none" || i.equipValue === ownEquipped || i.equipValue !== otherEquipped,
  );
}

/** Ship preview glyphs (lightweight stand-ins for the hulls the scene loads). */
const SHIP_ICONS: Record<string, string> = {
  default: "🛸",
  organic: "🧬",
  fusion_core: "☀️",
  holographic: "🔷",
};

/**
 * Trail swatches — CSS gradients in the scene's own trail colours
 * (graph/soumaya.ts setTrailColor: neon = hot pink, gold = solar gold,
 * purple = violet, blue = the standard nebula blue).
 */
export const TRAIL_SWATCHES: Record<string, string> = {
  blue: "linear-gradient(90deg, #7af9ff, #2f6bff)",
  neon: "linear-gradient(90deg, #ff4081, #22d3ee)",
  gold: "linear-gradient(90deg, #ffe27a, #f59e0b)",
  purple: "linear-gradient(90deg, #c09aff, #7c4dff)",
};

const rowStyle = (active: boolean, locked: boolean): CSSProperties => ({
  padding: "0.75rem",
  borderRadius: "6px",
  border: "1px solid " + (active ? "var(--accent)" : "rgba(255, 255, 255, 0.1)"),
  background: active ? "rgba(122, 249, 255, 0.08)" : "rgba(10, 12, 28, 0.4)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "0.75rem",
  opacity: locked ? 0.6 : 1,
  width: "100%",
  textAlign: "left",
  color: "inherit",
  font: "inherit",
});

/** "112/150"-style hint for numeric gates; null when there is no numeric scale worth showing. */
function progressHint(item: UnlockableItem, stats: UnlockStats, devUnlockAll: boolean): string | null {
  if (devUnlockAll || isUnlocked(item, stats, { devUnlockAll })) return null;
  const p = unlockProgress(item, stats);
  if (!p || p.target <= 1) return null;
  return `${p.cur}/${p.target}`;
}

export function HangarPanel({
  spaceId,
  memoriesCount,
  onEquipChanged,
  unlockStats,
  devUnlockAll,
  onViewInGalaxy,
  onPlayTrack,
  currentTrackIndex,
  musicPlaying,
}: HangarPanelProps) {
  const shipKey = `brain.hangar.ship.${spaceId}`;
  const trailKey = `brain.hangar.trail.${spaceId}`;
  const fig1Key = `brain.hangar.fig1.${spaceId}`;
  const fig2Key = `brain.hangar.fig2.${spaceId}`;
  const focusFig1Key = `brain.hangar.focusFig1.${spaceId}`;
  const focusFig2Key = `brain.hangar.focusFig2.${spaceId}`;

  // IM-98: the panel's own state — no more reading localStorage mid-render
  // and waiting on an ancestor re-render to reflect an equip.
  const [ship, setShipState] = useState(() => localStorage.getItem(shipKey) || "default");
  const [trail, setTrailState] = useState(() => localStorage.getItem(trailKey) || "blue");
  const [fig1, setFig1State] = useState(() => localStorage.getItem(fig1Key) || "none");
  const [fig2, setFig2State] = useState(() => localStorage.getItem(fig2Key) || "none");
  const [focusFig1, setFocusFig1State] = useState(() => localStorage.getItem(focusFig1Key) !== "false");
  const [focusFig2, setFocusFig2State] = useState(() => localStorage.getItem(focusFig2Key) !== "false");
  const [feedback, setFeedback] = useState<string | null>(null);

  // A different brain = a different loadout: reload this panel's state.
  useEffect(() => {
    setShipState(localStorage.getItem(shipKey) || "default");
    setTrailState(localStorage.getItem(trailKey) || "blue");
    setFig1State(localStorage.getItem(fig1Key) || "none");
    setFig2State(localStorage.getItem(fig2Key) || "none");
    setFocusFig1State(localStorage.getItem(focusFig1Key) !== "false");
    setFocusFig2State(localStorage.getItem(focusFig2Key) !== "false");
    setFeedback(null);
    // Keys are derived from spaceId; depending on them covers the switch.
  }, [shipKey, trailKey, fig1Key, fig2Key, focusFig1Key, focusFig2Key]);

  const devAll = devUnlockAll ?? readDevUnlockAll();
  const stats: UnlockStats = useMemo(
    () =>
      unlockStats ?? {
        ...EMPTY_UNLOCK_STATS,
        memoriesCount,
        achievementIds: [...loadUnlocked(spaceId)],
      },
    [unlockStats, memoriesCount, spaceId],
  );
  const opts = { devUnlockAll: devAll };
  const unlocked = (item: UnlockableItem) => isUnlocked(item, stats, opts);

  const ships = unlockablesByCategory("ship");
  const trails = unlockablesByCategory("trail");
  const figurines = unlockablesByCategory("figurine");
  const musicItems = unlockablesByCategory("music");

  // IM-97: overall unlock progress across the categories this tab equips
  // (scenery twins share their figurines' assets + rules, so they are not
  // double-counted here).
  const hangarItems = [...ships, ...trails, ...figurines, ...musicItems];
  const unlockedCount = hangarItems.filter((i) => unlocked(i)).length;

  const labelOf = (items: readonly UnlockableItem[], equipValue: string) =>
    items.find((i) => i.equipValue === equipValue)?.label ?? equipValue;
  const currentTrack = currentTrackIndex != null ? TRACKS[currentTrackIndex] : undefined;

  // IM-97: equip feedback — panel status line + toast + SFX, the app's
  // established feedback vocabulary (ActionsPanel et al.).
  const announceEquip = (label: string) => {
    setFeedback(`Equipped ${label}`);
    pushToast(`Equipped ${label}`, "🛠️", 3500);
    playSfx("select");
  };

  const equip = (
    key: string,
    value: string,
    setState: (v: string) => void,
    item: UnlockableItem,
  ) => {
    if (!unlocked(item)) return;
    localStorage.setItem(key, value);
    setState(value);
    onEquipChanged();
    announceEquip(item.label);
  };

  const setFocusFig = (slot: 1 | 2, on: boolean) => {
    localStorage.setItem(slot === 1 ? focusFig1Key : focusFig2Key, on ? "true" : "false");
    if (slot === 1) setFocusFig1State(on);
    else setFocusFig2State(on);
    onEquipChanged();
  };

  const renderOption = (
    item: UnlockableItem,
    active: boolean,
    onEquip: () => void,
    preview: ReactNode,
  ) => {
    const isLocked = !unlocked(item);
    const hint = progressHint(item, stats, devAll);
    return (
      <div key={item.id} style={rowStyle(active, isLocked)}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0 }}>
          {preview}
          <div>
            <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>
              {item.label} {isLocked && "🔒"}
            </div>
            <div style={{ fontSize: "0.74rem", opacity: 0.7 }}>
              {isLocked ? item.requirementText : item.description}
              {hint ? ` — ${hint}` : ""}
            </div>
          </div>
        </div>
        <button
          className="mini"
          disabled={isLocked || active}
          onClick={onEquip}
          aria-label={active ? `${item.label} (equipped)` : isLocked ? `${item.label} (locked)` : `Equip ${item.label}`}
        >
          {active ? "Equipped" : isLocked ? "Locked" : "Equip"}
        </button>
      </div>
    );
  };

  const renderFigSlot = (slot: 1 | 2) => {
    const own = slot === 1 ? fig1 : fig2;
    const other = slot === 1 ? fig2 : fig1;
    const focusOn = slot === 1 ? focusFig1 : focusFig2;
    const options = figurineOptionsForSlot(figurines, other, own);
    return (
      <div style={{ marginBottom: "1.25rem" }} data-testid={`hangar-fig-slot-${slot}`}>
        <div style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "0.35rem" }}>
          Background Slot {slot}
          {own !== "none" && onViewInGalaxy && (
            <button
              className="mini"
              style={{ marginLeft: "0.5rem" }}
              data-testid={`hangar-view-fig${slot}`}
              onClick={() => onViewInGalaxy(slot === 1 ? "fig1" : "fig2")}
            >
              👁 View in galaxy
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }} role="radiogroup" aria-label={`Background monument, slot ${slot}`}>
          {options.map((item) =>
            renderOption(
              item,
              own === item.equipValue,
              () =>
                equip(
                  slot === 1 ? fig1Key : fig2Key,
                  item.equipValue,
                  slot === 1 ? setFig1State : setFig2State,
                  item,
                ),
              <span
                data-testid={`hangar-preview-figurine-${item.equipValue}`}
                aria-hidden
                style={{ fontSize: "1.5rem", lineHeight: 1 }}
              >
                {item.equipValue === "none" ? "🌌" : getFigurineIcon(item.equipValue)}
              </span>,
            ),
          )}
        </div>
        {/* IM-99: the focus toggle exists only when there is something to
            focus — under a `none` slot it was a dead control. */}
        {own !== "none" && (
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", marginTop: "0.45rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={focusOn}
              onChange={(e) => setFocusFig(slot, e.target.checked)}
              aria-label={`Show camera focus button on HUD for Slot ${slot}`}
            />
            Show camera focus button on HUD
          </label>
        )}
      </div>
    );
  };

  return (
    <div className="dock-body hangar" style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto", paddingRight: "4px" }}>
      <div className="awards-head">
        <h3 className="awards-title">🛠️ Hangar</h3>
      </div>
      <p style={{ fontSize: "0.82rem", opacity: 0.8, margin: "0 0 1.25rem 0" }}>
        Customize Soumaya's spaceship hull, adjust her cosmic engine trail, choose the ambient
        music loop, and mount colossal, civilization-scale monuments in the deep space background.
      </p>

      {/* IM-97: equipped-loadout summary + overall unlock progress. */}
      <div
        data-testid="hangar-loadout"
        style={{
          padding: "0.75rem",
          borderRadius: "6px",
          border: "1px solid rgba(122, 249, 255, 0.25)",
          background: "rgba(10, 12, 28, 0.5)",
          marginBottom: "1rem",
          fontSize: "0.8rem",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>
          Current loadout · {unlockedCount}/{hangarItems.length} unlocked
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 0.9rem", opacity: 0.9 }}>
          <span>🛸 {labelOf(ships, ship)}</span>
          <span>✨ {labelOf(trails, trail)}</span>
          <span>🪐 {labelOf(figurines, fig1)}</span>
          <span>🪐 {labelOf(figurines, fig2)}</span>
          <span>🎵 {currentTrack ? currentTrack.title : "—"}</span>
        </div>
        <div
          aria-hidden
          style={{ height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.12)", marginTop: "0.5rem" }}
        >
          <div
            style={{
              height: "100%",
              width: `${hangarItems.length ? Math.round((unlockedCount / hangarItems.length) * 100) : 0}%`,
              borderRadius: "2px",
              background: "var(--accent)",
            }}
          />
        </div>
        {feedback && (
          <div role="status" style={{ marginTop: "0.5rem", color: "var(--accent)" }}>
            ✓ {feedback}
          </div>
        )}
        {onViewInGalaxy && (
          <button className="mini" style={{ marginTop: "0.5rem" }} data-testid="hangar-view-ship" onClick={() => onViewInGalaxy("ship")}>
            👁 View ship in galaxy
          </button>
        )}
      </div>

      {/* SECTION: Ship Skins (IM-96 previews, IM-101 styled controls) */}
      <h4 style={{ margin: "1rem 0 0.5rem 0", color: "var(--accent)" }}>🛸 Spaceship Hull</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }} role="radiogroup" aria-label="Spaceship hull">
        {ships.map((item) =>
          renderOption(
            item,
            ship === item.equipValue,
            () => equip(shipKey, item.equipValue, setShipState, item),
            <span
              data-testid={`hangar-preview-ship-${item.equipValue}`}
              aria-hidden
              style={{
                fontSize: "1.6rem",
                lineHeight: 1,
                padding: "0.45rem",
                borderRadius: "6px",
                background: "radial-gradient(circle at 50% 40%, rgba(122,249,255,0.18), rgba(10,12,28,0.6))",
              }}
            >
              {SHIP_ICONS[item.equipValue] ?? "🛸"}
            </span>,
          ),
        )}
      </div>

      {/* SECTION: Engine Trails (IM-101: styled option list, no native select) */}
      <h4 style={{ margin: "1rem 0 0.5rem 0", color: "var(--accent)" }}>✨ Cosmic Trails</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }} role="radiogroup" aria-label="Cosmic trail">
        {trails.map((item) =>
          renderOption(
            item,
            trail === item.equipValue,
            () => equip(trailKey, item.equipValue, setTrailState, item),
            <span
              data-testid={`hangar-swatch-trail-${item.equipValue}`}
              aria-hidden
              style={{
                width: "52px",
                height: "12px",
                borderRadius: "6px",
                flexShrink: 0,
                background: TRAIL_SWATCHES[item.equipValue] ?? TRAIL_SWATCHES.blue,
              }}
            />,
          ),
        )}
      </div>

      {/* SECTION: Music (IM-102: the docs' music category, gated by the shared system) */}
      <h4 style={{ margin: "1rem 0 0.5rem 0", color: "var(--accent)" }}>🎵 Ambient Music</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }} data-testid="hangar-music">
        {musicItems.map((item) => {
          const trackIdx = TRACKS.findIndex((t) => t.id === item.equipValue);
          const isLocked = !unlocked(item);
          const hint = progressHint(item, stats, devAll);
          const isCurrent = trackIdx >= 0 && currentTrackIndex === trackIdx;
          return (
            <div key={item.id} style={rowStyle(isCurrent, isLocked)}>
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.86rem" }}>
                  🎵 {item.label} {isLocked && "🔒"}
                </div>
                <div style={{ fontSize: "0.74rem", opacity: 0.7 }}>
                  {isLocked ? item.requirementText : item.description}
                  {hint ? ` — ${hint}` : ""}
                  {isCurrent && musicPlaying ? " · Now playing" : isCurrent ? " · Selected" : ""}
                </div>
              </div>
              {onPlayTrack && trackIdx >= 0 && (
                <button
                  className="mini"
                  disabled={isLocked}
                  onClick={() => onPlayTrack(trackIdx)}
                  aria-label={isLocked ? `${item.label} (locked)` : `Play ${item.label}`}
                >
                  {isCurrent && musicPlaying ? "Playing" : "Play"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* SECTION: Background Figurines — deep space background monuments
          (IM-100 terminology: the scene mounts these far in the background;
          they are NOT cockpit companions). */}
      <h4 style={{ margin: "1rem 0 0.5rem 0", color: "var(--accent)" }}>🪐 Deep Space Figurines</h4>
      <p style={{ fontSize: "0.76rem", opacity: 0.7, margin: "0 0 1rem 0" }}>
        Select monuments to mount in the distant starry background. Each monument can be
        mounted in only one slot.
      </p>
      {renderFigSlot(1)}
      {renderFigSlot(2)}

      {/* IM-102 scenery finding, surfaced honestly: the doc's scenery
          category is these same two capstone monuments rendered as distant
          background scenery; the nebula backdrop is a fixed galaxy layer
          with no user-facing controls, so none are invented here. */}
      <p style={{ fontSize: "0.76rem", opacity: 0.7, margin: "0.5rem 0 1rem 0" }}>
        🌌 Scenery: the black hole and Dyson sphere above are the galaxy's background scenery —
        the same monuments, seen from far away. The nebula backdrop is part of the galaxy
        itself and has no separate controls.
      </p>
    </div>
  );
}
