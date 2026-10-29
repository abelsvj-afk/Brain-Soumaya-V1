import { useEffect, useState } from "react";
import { FLEET } from "../graph/fleet.js";
import type { FleetStatus } from "../graph/Graph3D.js";

/**
 * The Fleet roster: Soumaya and every agent that reports to her — ship, station,
 * Aura beacons, Scout, Defender. Each shows what it's doing RIGHT NOW in plain
 * language, a live activity pulse, and fly-to chips for the memories it's working —
 * so the fleet reads as a living crew, not a static list. Lore is tucked behind a
 * disclosure so the "what is this?" answer is one tap away without walls of text.
 */
export function FleetPanel({
  getStatus,
  onFocus,
}: {
  getStatus: () => FleetStatus | undefined;
  onFocus: (id: number) => void;
}) {
  const [status, setStatus] = useState<FleetStatus>({});
  // REG-169/SF-04: whether ANY status source has ever reported. The scene
  // getter is undefined until the 3D scene mounts (the Lite/no-WebGL path
  // may never mount it) — until a first report arrives, the panel must not
  // claim an idle fleet. `hasSource` only ever flips false → true.
  const [hasSource, setHasSource] = useState(false);
  const [openLore, setOpenLore] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => {
      const next = getStatus();
      if (next !== undefined) setHasSource(true);
      setStatus(next ?? {});
    };
    tick();
    const iv = window.setInterval(tick, 1500);
    return () => window.clearInterval(iv);
  }, [getStatus]);

  const activeCount = FLEET.filter((u) => status[u.id]?.active).length;

  return (
    <div className="dock-body">
      <div className="fleet-summary">
        <span className="fleet-summary-dot" />
        {hasSource ? (
          <>{activeCount} of {FLEET.length} units active · she coordinates them for you</>
        ) : (
          <>Fleet status unavailable — the galaxy hasn't reported yet, so this isn't an idle fleet, it's an unknown one.</>
        )}
      </div>
      <ul className="fleet-list">
        {FLEET.map((u) => {
          const st = status[u.id];
          const active = st?.active ?? false;
          const dispatching = (st?.pending ?? 0) > 0;
          const targets = st?.targets ?? [];
          return (
            <li key={u.id} className={`fleet-card ${active ? "active" : ""}`}>
              <div className="fleet-head">
                <span className={`fleet-icon ${dispatching ? "dispatching" : active ? "pulse" : ""}`}>{u.icon}</span>
                <div className="fleet-headtext">
                  <span className="fleet-name">{u.name}</span>
                  <span className="fleet-role">{u.role}</span>
                </div>
                <span className={`fleet-dot ${dispatching ? "dispatch" : active ? "on" : ""}`} title={hasSource ? (active ? "active" : "idle") : "status unavailable"} />
              </div>
              <div className={`fleet-status ${dispatching ? "dispatching" : ""}`}>
                {!hasSource ? (
                  "Status unavailable"
                ) : (
                  <>
                    {dispatching ? "🚀 " : active ? "" : "💤 "}
                    {st?.detail ?? "Standing by"}
                  </>
                )}
              </div>
              {targets.length > 0 && (
                <div className="fleet-targets">
                  {targets.slice(0, 4).map((t) => (
                    <button key={t.id} className="fleet-target-chip" onClick={() => onFocus(t.id)} title="Fly to it">
                      {t.label}
                    </button>
                  ))}
                  {/* REG-170/SF-05: a truncated list states its full count —
                      the tab's own disclosure pattern (cf. the log list's
                      "Showing X of Y entries"). */}
                  {targets.length > 4 && (
                    <span className="fleet-targets-more">
                      Showing 4 of {targets.length} targets
                    </span>
                  )}
                </div>
              )}
              <button
                className="fleet-lore-toggle"
                onClick={() => setOpenLore(openLore === u.id ? null : u.id)}
              >
                {openLore === u.id ? "▾ What is this?" : "▸ What is this?"}
              </button>
              {openLore === u.id && <p className="fleet-lore">{u.lore}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
