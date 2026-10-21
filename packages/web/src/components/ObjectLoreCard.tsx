import type { GraphData } from "@brain/shared";
import { objectLoreFor, type LoreObjectKind } from "../graph/objectLore.js";

/**
 * A small glass card shown while a lore object (the station, the ship, a
 * beacon — and now visitor / fleet craft too) is focused. Its story is
 * generated live from the brain, so it mutates and grows as you add memories.
 *
 * IM-12: the computed numbers surface as their own stat chips instead of
 * being buried in prose; a named "coldest memory" is a fly-to button; the
 * card animates in like the other overlays.
 */
const KIND_ICON: Record<LoreObjectKind, string> = {
  ship: "🛸",
  satellite: "🛰️",
  station: "🌐",
  visitor: "👽",
  fleet: "🚀",
};

export function ObjectLoreCard({
  kind,
  graph,
  onClose,
  onFocus,
}: {
  kind: LoreObjectKind;
  graph: GraphData;
  onClose: () => void;
  /** Fly to a memory named in the lore (the coldest one). */
  onFocus?: (id: number) => void;
}) {
  const { title, log, stats } = objectLoreFor(kind, graph);
  return (
    <div className="object-lore object-lore-enter">
      <div className="object-lore-head">
        <span className="object-lore-title">
          {KIND_ICON[kind]} {title}
        </span>
        <button className="object-lore-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="object-lore-stats">
        <span className="ol-stat">{stats.memories} {stats.memories === 1 ? "memory" : "memories"}</span>
        <span className="ol-stat">{stats.links} {stats.links === 1 ? "link" : "links"}</span>
        <span className="ol-stat">{stats.cooling} cooling</span>
        {stats.coldest && stats.coldestId != null && onFocus ? (
          <button className="ol-stat ol-coldest" onClick={() => onFocus(stats.coldestId!)} title="Fly to the coldest memory">
            ❄ Coldest: “{stats.coldest}” →
          </button>
        ) : stats.coldest ? (
          <span className="ol-stat">❄ Coldest: “{stats.coldest}”</span>
        ) : null}
      </div>
      <p className="object-lore-log">✦ {log}</p>
    </div>
  );
}
