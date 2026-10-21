import { useEffect } from "react";
import type { UnlockableItem } from "@brain/shared";

/**
 * UnlockCelebration — the reusable "🔓 Unlocked!" moment (IM-133;
 * docs/UNLOCKABLES.md rollout step 4: "reuse the rank-up celebration
 * surface"). It deliberately mirrors the rank-up moment's structure and
 * classes (plus its own `unlock-*` hooks) so the two celebrations feel
 * like one family. Fire it with the item from useUnlockWatcher /
 * newlyUnlocked(); it auto-dismisses after ~4.6s or on click.
 */
const CATEGORY_LABEL: Record<UnlockableItem["category"], string> = {
  music: "Music",
  ship: "Ship",
  trail: "Trail",
  figurine: "Figurine",
  scenery: "Scenery",
};

export function UnlockCelebration({
  item,
  onDismiss,
}: {
  item: UnlockableItem | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!item) return;
    const t = window.setTimeout(onDismiss, 4600);
    return () => window.clearTimeout(t);
  }, [item, onDismiss]);

  if (!item) return null;
  return (
    <div className="rankup-moment unlock-moment" role="alert" onClick={onDismiss} data-unlock-id={item.id}>
      <div className="rankup-card unlock-card">
        <span className="rankup-ring" aria-hidden />
        <span className="rankup-kicker unlock-kicker">🔓 Unlocked!</span>
        <span className="rankup-star unlock-icon" aria-hidden>
          {item.category === "music" ? "🎵" : "🔓"}
        </span>
        <span className="rankup-title unlock-title">{item.label}</span>
        <span className="rankup-lvl unlock-sub">
          {CATEGORY_LABEL[item.category]} · {item.description}
        </span>
      </div>
    </div>
  );
}
