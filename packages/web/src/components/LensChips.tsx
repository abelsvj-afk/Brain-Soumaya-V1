import { useEffect, useState, useCallback } from "react";
import type { Lens } from "@brain/shared";
import { getLenses, lensNodes } from "../api/lenses.js";
import { pushToast } from "./Toasts.js";

/**
 * PINNED Smart Lenses — one-tap switching between your saved views without opening the
 * full Lenses panel. The active lens is highlighted; tapping it again exits. Live counts
 * re-sync on ingest and whenever lenses change in the panel. Renders nothing when there
 * are no pinned lenses (so it never adds chrome you didn't ask for).
 *
 * Rendered as a plain in-flow LIST inside the Views dropdown (`GalaxyViews.tsx`), not as
 * its own floating overlay — a real, on-device bug report showed this previously as an
 * independently `position:absolute`-anchored row that could visually collide with the
 * Views toggle (see `.gv-wrap`'s CSS comment for the root cause) whenever the two floating
 * elements' unrelated anchor math didn't line up on a given device. Living inside the SAME
 * dropdown as Views removes that whole class of collision — there is only one floating
 * element now, not two independently-positioned ones.
 */
export function LensChips({
  activeLens,
  onOpen,
  onExit,
  hidden,
}: {
  activeLens: string | null;
  /** Isolate the galaxy to these ids under this lens name. `total` is the
   *  lens's true match count (Batch H, REG-207/208) — the banner states it,
   *  and the shown subset when the match list itself was capped. */
  onOpen: (ids: number[], name: string, total?: number) => void;
  onExit: () => void;
  hidden?: boolean;
}) {
  const [pinned, setPinned] = useState<Lens[]>([]);
  // Batch H (REG-205 / CN-06): a failed pinned-list fetch is an error state
  // with a retry — the chips used to silently render nothing, so a user with
  // pinned lenses saw an empty dropdown on exactly the days the server was
  // unreachable, with no signal at all.
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const ls = await getLenses();
      setPinned(ls.filter((l) => l.pinned));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    // While hidden (the Views dropdown is collapsed, or a full panel/chat/Observatory is
    // open), there's no reason to keep fetching on every memory add. Re-running this
    // effect when `hidden` flips back to false refreshes once on the way back in, so it's
    // never stale when it reappears.
    if (hidden) return;
    refresh();
    const on = () => refresh();
    window.addEventListener("brain-memory-added", on);
    window.addEventListener("brain-lenses-changed", on);
    return () => {
      window.removeEventListener("brain-memory-added", on);
      window.removeEventListener("brain-lenses-changed", on);
    };
  }, [refresh, hidden]);

  if (hidden) return null;
  if (failed && pinned.length === 0) {
    return (
      <div className="lens-list" role="list" aria-label="Pinned lenses">
        <div className="lens-list-label">📌 Pinned Lenses</div>
        <div className="lens-list-error" role="alert">
          Couldn't load pinned lenses.{" "}
          <button className="mini ghost" onClick={() => void refresh()}>Try again</button>
        </div>
      </div>
    );
  }
  if (pinned.length === 0) return null;

  const tap = async (l: Lens) => {
    if (activeLens === l.name) {
      onExit();
      return;
    }
    // Batch H (REG-214 / CN-16): a broken lens never opens as everything.
    if (l.broken) {
      pushToast(`"${l.name}" couldn't be read — its saved query is damaged.`, "⚠️", 4000);
      return;
    }
    // Batch H (REG-206 / CN-07): a failed node load reports the failure on
    // this door too — the chip used to silently do nothing, while the panel
    // asserted "no matches" for the same failure. Batch H (REG-208 / CN-09):
    // a capped lens says so before isolating.
    let ev;
    try {
      ev = await lensNodes(l.id);
    } catch {
      pushToast(`Couldn't load "${l.name}" — try again.`, "⚠️", 3500);
      return;
    }
    if (ev.ids.length === 0) {
      pushToast(`"${l.name}" has no matches right now.`, "⧉", 3000);
      return;
    }
    if (ev.capped) {
      pushToast(
        `Showing the first ${ev.shown.toLocaleString()} of ${ev.total.toLocaleString()} matches for "${l.name}".`,
        "⧉",
        4000,
      );
    }
    onOpen(ev.ids, l.name, ev.total);
  };

  return (
    <div className="lens-list" role="list" aria-label="Pinned lenses">
      <div className="lens-list-label">📌 Pinned Lenses</div>
      {pinned.map((l) => {
        const on = activeLens === l.name;
        return (
          <button
            key={l.id}
            className={`lens-list-item ${on ? "on" : ""}`}
            onClick={() => void tap(l)}
            aria-pressed={on}
            role="listitem"
            title={on ? `Exit “${l.name}”` : `View “${l.name}”`}
          >
            <span className="lens-list-name">{l.name}</span>
            <span className="lens-list-count" title={l.broken ? "This lens's saved query couldn't be read." : l.capped ? `Showing the first ${(l.shown ?? l.count ?? 0).toLocaleString()} of ${(l.count ?? 0).toLocaleString()} matches` : undefined}>
              {on ? "✕" : l.broken ? "?" : `${(l.count ?? 0).toLocaleString()}${l.totalIsLowerBound ? "+" : ""}`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
