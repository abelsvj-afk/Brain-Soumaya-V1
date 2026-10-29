import type { GraphData } from "@brain/shared";
import type { InteriorRoomId } from "../graph/stationInteriorLayout.js";
import type { FleetStatus } from "../graph/Graph3D.js";
import { HangarPanel } from "./HangarPanel.js";
import { FleetPanel } from "./FleetPanel.js";
import FleetMissionsPanel from "./FleetMissionsPanel.js";
import FleetDefensePanel from "./FleetDefensePanel.js";
import CommissionBoardPanel from "./CommissionBoardPanel.js";

/**
 * The Station Interior's room panels (Wave 2, settled design
 * 2026-10-28) — what each room HOLDS. The 3D hall is the rooms'
 * backdrop; these panels are the rooms' work. Wiring, not
 * rebuilding: every panel here already shipped somewhere else in
 * the app, and each mounts with the same props its home surface
 * uses (standalone defaults where the surface cannot supply them —
 * HangarPanel's own standalone pattern, FleetPanel's unknown-status
 * line when the galaxy has not reported yet).
 *
 * - Hangar bay: the Batch O HangarPanel (pick and change ships) +
 *   the FleetPanel roster (the fleet roster and the ships you have
 *   used). Equipping a ship also rebuilds the bay's docked ship via
 *   onEquipChanged, which the surface wires to its bay-ship nonce.
 * - Commission board: the CommissionBoardPanel — four settled kinds,
 *   each routed to the surface where that work already lives.
 * - Fleet deck: the shipped FleetPanel + FleetDefensePanel +
 *   FleetMissionsPanel, the same three the Soumaya tab's Fleet
 *   sections mount (PRs #122–#124 plus Batch O).
 * - Observation deck: nothing. A quiet place to be — the surface
 *   renders only its quiet line, no panel, no task, no counter,
 *   nothing to earn.
 *
 * No market, no trading, no fuel exchange anywhere here: none of
 * these panels buys, sells, or spends.
 */

export interface StationInteriorRoomPanelProps {
  room: InteriorRoomId;
  /** The graph the app already holds (may be null before it loads). */
  graph: GraphData | null;
  spaceId: string;
  /** Live fleet status from the galaxy scene, when the host supplies it. */
  getFleetStatus?: () => FleetStatus | undefined;
  /** Focus a memory in the galaxy, when the host supplies it. */
  onFocus?: (id: number) => void;
  /** Fired when the hangar pick changes (ship equip). */
  onEquipChanged?: () => void;
}

export default function StationInteriorRoomPanel({
  room,
  graph,
  spaceId,
  getFleetStatus,
  onFocus,
  onEquipChanged,
}: StationInteriorRoomPanelProps) {
  const nodes = graph?.nodes ?? [];
  const memoriesCount = nodes.filter((n) => n.kind !== "action").length;

  if (room === "hangar-bay") {
    return (
      <div className="station-interior-room">
        <HangarPanel
          spaceId={spaceId}
          memoriesCount={memoriesCount}
          onEquipChanged={() => onEquipChanged?.()}
        />
        <FleetPanel getStatus={getFleetStatus ?? (() => undefined)} onFocus={onFocus ?? (() => {})} />
      </div>
    );
  }

  if (room === "commission-board") {
    return (
      <div className="station-interior-room">
        <CommissionBoardPanel spaceId={spaceId} />
      </div>
    );
  }

  if (room === "fleet-deck") {
    return (
      <div className="station-interior-room">
        <FleetPanel getStatus={getFleetStatus ?? (() => undefined)} onFocus={onFocus ?? (() => {})} />
        <FleetMissionsPanel />
        <FleetDefensePanel nodes={nodes} />
      </div>
    );
  }

  // Observation deck: deliberately nothing. Quiet is the feature.
  return null;
}
