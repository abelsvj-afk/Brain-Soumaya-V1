import { useState } from "react";
import {
  MISSION_DESTINATIONS,
  MISSION_MAX_DURATION_MINUTES,
  MISSION_MAX_FLEET_SIZE,
  MISSION_MIN_DURATION_MINUTES,
  MISSION_MIN_FLEET_SIZE,
  missionDispatchCost,
  type Mission,
  type MissionKind,
} from "@brain/shared";
import { useFleetMissions } from "../hooks/useFleetMissions.js";
import { WORLD_CHART } from "../lib/routeBoard.js";

/**
 * The fleets, on automated missions. The dispatch form + send tap IS
 * propose-for-yes: nothing dispatches without the tap, and missions
 * are free — fuel never gates access.
 *
 * Everything here renders the server's state: missions are the
 * server's ledger, the log is the server's log, and the stop switch
 * is the owner's. The panel never decides anything itself. Mission
 * state is unmistakable in plain words — out, home, returned
 * empty-handed — never a silent or ambiguous state. Log times render
 * in the viewer's own local time — never UTC.
 */

const STATE_LABEL: Record<Mission["state"], string> = {
  outbound: "Out",
  arrived: "At the world",
  returning: "Returning home",
  completed: "Home",
  failed: "Returned empty-handed",
  recalled: "Returned without its outcome",
};

const KIND_LABEL: Record<MissionKind, string> = {
  journey: "Journey",
  scouting: "Scouting",
};

/** Local time, in the viewer's own timezone — the standing rule: no
 *  UTC in anything user-facing, ever. */
function localTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function worldName(key: string): string {
  return WORLD_CHART.find((w) => w.key === key)?.name ?? key;
}

const DESTINATIONS = MISSION_DESTINATIONS.map((key) => ({
  key,
  name: worldName(key),
}));

export default function FleetMissionsPanel({
  enabled = true,
  onClose,
}: {
  enabled?: boolean;
  onClose?: () => void;
}) {
  const { overview, loading, failed, error, refresh, dispatch, recall, stop, resume } =
    useFleetMissions(enabled);

  const [kind, setKind] = useState<MissionKind>("journey");
  const [destination, setDestination] = useState(DESTINATIONS[0]?.key ?? "great-station");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [fleetSize, setFleetSize] = useState(1);

  const active = overview?.missions.filter((m) => m.state === "outbound" || m.state === "arrived" || m.state === "returning") ?? [];
  const done = overview?.missions.filter((m) => m.state === "completed" || m.state === "failed" || m.state === "recalled") ?? [];

  return (
    <section className="fleet-missions" aria-label="Fleet missions">
      <header className="fleet-missions-bar">
        <h3>Fleet missions</h3>
        {onClose && (
          <button type="button" onClick={onClose}>
            Close
          </button>
        )}
      </header>

      {loading && !overview && <p>Checking in with the fleet…</p>}
      {failed && !overview && (
        <p>
          The fleet couldn&apos;t be reached — your journeys are unaffected.{" "}
          <button type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}

      {overview && (
        <>
          <p>
            Fleets fly from home to the worlds on automated missions — short voyages, 15 to 60
            minutes. A journey goes, arrives, and comes home. A scouting run goes, looks, and
            brings back a report of what it truly saw. Missions are free, and a mission that
            turns back costs nothing. Nothing the fleet does ever touches your brain.
          </p>
          <p>
            Fuel {Math.floor(overview.fuel.fuel)} / {overview.fuel.capacity} — missions are free,
            so fuel never gates a dispatch.
            {overview.fleetStopped
              ? " The fleet is stopped — it dispatches nothing while stopped."
              : ""}
          </p>

          {overview.fleetStopped ? (
            <p>
              <button type="button" onClick={() => void resume()}>
                Start the fleet again
              </button>
            </p>
          ) : (
            <p>
              <button type="button" onClick={() => void stop()}>
                Stop the fleet
              </button>
            </p>
          )}

          {error && <p className="fleet-missions-error">{error}</p>}

          <h4>Send the fleet</h4>
          <p>
            Sending is the yes: nothing leaves home without your tap. A journey logs its arrival
            in plain words; a scouting run logs its report.
          </p>
          <label>
            Mission{" "}
            <select value={kind} onChange={(e) => setKind(e.target.value as MissionKind)}>
              <option value="journey">Journey — go, arrive, come home</option>
              <option value="scouting">Scouting — go, look, report back</option>
            </select>
          </label>{" "}
          <label>
            To{" "}
            <select value={destination} onChange={(e) => setDestination(e.target.value)}>
              {DESTINATIONS.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            Minutes{" "}
            <input
              type="number"
              min={MISSION_MIN_DURATION_MINUTES}
              max={MISSION_MAX_DURATION_MINUTES}
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            />
          </label>{" "}
          <label>
            Ships{" "}
            <input
              type="number"
              min={MISSION_MIN_FLEET_SIZE}
              max={MISSION_MAX_FLEET_SIZE}
              value={fleetSize}
              onChange={(e) => setFleetSize(Number(e.target.value))}
            />
          </label>
          <p>
            {missionDispatchCost(fleetSize, durationMinutes) === 0 ? "Free" : `${missionDispatchCost(fleetSize, durationMinutes)} fuel`} — {fleetSize} ship
            {fleetSize === 1 ? "" : "s"}, {durationMinutes} minutes.
          </p>
          <button
            type="button"
            disabled={overview.fleetStopped}
            onClick={() =>
              void dispatch({
                kind,
                destination,
                durationMinutes,
                fleetSize,
              })
            }
          >
            Send the fleet
          </button>

          <h4>Out now</h4>
          {active.length === 0 ? (
            <p>No fleet is out — the ships are moored at home.</p>
          ) : (
            <ul className="fleet-missions-active">
              {active.map((m) => (
                <li key={m.id}>
                  <strong>
                    {KIND_LABEL[m.kind]} — {worldName(m.destination)}
                  </strong>{" "}
                  ({STATE_LABEL[m.state]}; {m.ships.join(", ")}; back {localTime(m.returnAt) || "—"})
                  <button type="button" onClick={() => void recall(m.id)}>
                    Recall
                  </button>
                  {m.outcome && <p>{m.outcome}</p>}
                  {m.report && <p>{m.report}</p>}
                </li>
              ))}
            </ul>
          )}

          <h4>Home again</h4>
          {done.length === 0 ? (
            <p>No mission has come home yet.</p>
          ) : (
            <ul className="fleet-missions-done">
              {done.map((m) => (
                <li key={m.id}>
                  <strong>
                    {KIND_LABEL[m.kind]} — {worldName(m.destination)}
                  </strong>{" "}
                  ({STATE_LABEL[m.state]}; {m.ships.join(", ")}; {localTime(m.completedAt) || "—"})
                  {m.outcome && <p>{m.outcome}</p>}
                  {m.report && <p>{m.report}</p>}
                </li>
              ))}
            </ul>
          )}

          <h4>The fleet&apos;s log</h4>
          {overview.log.length === 0 ? (
            <p>Nothing yet — every dispatch, arrival, and return will show here, with the reason for each.</p>
          ) : (
            <ul className="fleet-missions-log">
              {overview.log.map((e) => (
                <li key={e.id}>
                  {e.act} <span className="fleet-missions-cause">({e.cause})</span>{" "}
                  <time dateTime={e.createdAt}>{localTime(e.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
