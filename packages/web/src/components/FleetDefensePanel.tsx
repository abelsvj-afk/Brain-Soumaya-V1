import { useState } from "react";
import {
  FLEET_DEFENSE_DEFENDERS,
  FLEET_DEFENSE_INVADERS_BY_SIZE,
  FLEET_DEFENSE_KIND_LABELS,
  FLEET_DEFENSE_LANES,
  FLEET_DEFENSE_RELEASE_KINDS,
  FLEET_DEFENSE_RELEASE_SIZES,
  FLEET_DEFENSE_SIZE_LABELS,
  type FleetDefenseReleaseKind,
  type FleetDefenseReleaseSize,
} from "@brain/shared";
import { useFleetDefense } from "../hooks/useFleetDefense.js";
import {
  practiceOutcomeLine,
  useFleetDefensePractice,
} from "../hooks/useFleetDefensePractice.js";

/**
 * Fleet defense, in the Soumaya tab beside the Fleet roster (Wave 2).
 * Something the user already chose to release draws a purge fleet
 * from another world; Soumaya and her fleet defend the galaxy —
 * Space Invaders at its simplest — on her own, or with the player
 * at the helm.
 *
 * Everything here renders the server's state: the releases, the
 * board, the win and the loss are the server's, and the panel never
 * decides anything itself. The board is a calm turn-based
 * presentation — three lanes, positions as steps out from the
 * charge — so the reduced-motion form is the same board, not a
 * lesser one. Log times render in the viewer's own local time —
 * never UTC.
 *
 * The never-punish invariant, in the panel's own words: defending
 * your own galaxy is free; losing costs nothing — the fleet
 * disperses, the charge stays, and the defense can be tried again
 * later. A purge never deletes brain data: the fleet takes only
 * what was offered, and the linked memory is never touched.
 */

/** Local time, in the viewer's own timezone — the standing rule: no
 *  UTC in anything user-facing, ever. */
function localTime(iso: string): string {
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

const KIND_PLACEHOLDERS: Record<FleetDefenseReleaseKind, string> = {
  emotion: "e.g. the anger from that argument",
  "archived-memory": "e.g. the winter that still stings",
  debt: "e.g. the card balance I'm paying down",
};

/** Practice size labels are deliberately worded as PRACTICE fleets, so
 *  no practice label can ever be read as a real release's fleet — and
 *  so the real-defense copy ("3 ships will come") stays unique to a
 *  real offered release. */
const PRACTICE_SIZE_LABELS: Record<FleetDefenseReleaseSize, string> = {
  small: "Small — a light practice fleet, 3 ships",
  steady: "Steady — a mid-size practice fleet, 4 ships",
  big: "Big — a heavy practice fleet, 5 ships",
};

export default function FleetDefensePanel({
  nodes = [],
  enabled = true,
}: {
  /** Memories the offer form can link, for the emotion kind. */
  nodes?: readonly { id: number; label: string }[];
  enabled?: boolean;
}) {
  const { overview, loading, failed, error, autoPlay, setAutoPlay, refresh, offer, start, tick } =
    useFleetDefense(enabled);
  const {
    practice,
    autoPlay: practiceAutoPlay,
    setAutoPlay: setPracticeAutoPlay,
    start: startPractice,
    tick: tickPractice,
    end: endPractice,
  } = useFleetDefensePractice();
  const [practiceSize, setPracticeSize] = useState<FleetDefenseReleaseSize>("small");
  const [practiceHelmLane, setPracticeHelmLane] = useState<number | null>(null);
  const [showOffer, setShowOffer] = useState(false);
  const [kind, setKind] = useState<FleetDefenseReleaseKind>("emotion");
  const [size, setSize] = useState<FleetDefenseReleaseSize>("small");
  const [label, setLabel] = useState("");
  const [nodeId, setNodeId] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [helmLane, setHelmLane] = useState<number | null>(null);

  const activeDefense = overview?.activeDefense ?? null;
  const activeRelease = overview?.activeRelease ?? null;
  const releases = overview?.releases ?? [];
  const offered = releases.filter((r) => r.status === "offered");
  const cleared = releases.filter((r) => r.status === "cleared");
  const lastResolved = overview?.history[0] ?? null;
  const lastResolvedRelease = lastResolved
    ? releases.find((r) => r.id === lastResolved.releaseId)
    : null;

  async function submitOffer() {
    await offer({
      kind,
      size,
      label: label.trim(),
      nodeId: kind === "emotion" ? nodeId : null,
    });
    setLabel("");
    setNodeId(null);
    setConfirming(false);
    setShowOffer(false);
  }

  return (
    <section className="fleet-defense" aria-label="Fleet defense">
      <header className="fleet-defense-bar">
        <h3>Fleet defense</h3>
      </header>

      <p>
        When something you already chose to let go of draws a purge fleet, Soumaya and her fleet
        defend your galaxy — she plays it on her own, or you take the helm. Defending your own
        galaxy is free. Losing costs nothing: the fleet disperses, the charge stays, and you can
        try again later. The fleet takes only what was offered — your memories are never touched.
        Eternity watches; he does not step in.
      </p>

      {loading && !overview && <p>Checking the skies…</p>}
      {failed && !overview && (
        <p>
          The defense couldn&apos;t be reached — your galaxy is unaffected.{" "}
          <button type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}

      {overview && (
        <>
          {activeDefense && activeRelease && (
            <div className="fleet-defense-board" aria-label="Active defense">
              <h4>Defending: {activeRelease.label}</h4>
              <p>
                {activeDefense.invaders.filter((i) => !i.dispersed).length} of{" "}
                {activeDefense.invaders.length} ships still closing in · round{" "}
                {activeDefense.tickCount + 1}
              </p>
              <p>
                Defenders: {FLEET_DEFENSE_DEFENDERS.map((d) => d.name).join(" · ")} — Kenney
                hulls and her own ship, against Quaternius fighters.
              </p>
              {[1, 2, 3].map((lane) => {
                const inLane = activeDefense.invaders.filter((i) => i.lane === lane);
                return (
                  <div key={lane} className="fleet-defense-lane">
                    <strong>Lane {lane}</strong>
                    <ul>
                      {inLane.map((inv) => (
                        <li key={inv.shipKey}>
                          {inv.shipName} —{" "}
                          {inv.dispersed ? "dispersed" : `${inv.distance} step${inv.distance === 1 ? "" : "s"} out`}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              {activeDefense.lastLine && <p className="fleet-defense-line">{activeDefense.lastLine}</p>}
              <div className="fleet-defense-controls">
                <button
                  type="button"
                  onClick={() => void tick("autonomous")}
                  disabled={activeDefense.status !== "active"}
                >
                  Let Soumaya take this round
                </button>
                <label>
                  <input
                    type="checkbox"
                    checked={autoPlay}
                    onChange={(e) => setAutoPlay(e.target.checked)}
                  />{" "}
                  She plays on her own
                </label>
              </div>
              <div className="fleet-defense-helm">
                <span>Take the helm — fire down a lane:</span>{" "}
                {Array.from({ length: FLEET_DEFENSE_LANES }, (_, i) => i + 1).map((lane) => (
                  <button
                    key={lane}
                    type="button"
                    disabled={activeDefense.status !== "active"}
                    onClick={() => {
                      setHelmLane(lane);
                      void tick("helm", lane);
                    }}
                  >
                    Fire lane {lane}
                  </button>
                ))}
                {helmLane !== null && <span> Last helm shot: lane {helmLane}.</span>}
              </div>
            </div>
          )}

          {lastResolved && lastResolved.status !== "active" && (
            <p className="fleet-defense-outcome">
              {lastResolved.outcomeLine ?? ""}{" "}
              {lastResolvedRelease && lastResolved.status === "lost" && (
                <>({lastResolvedRelease.label} is offered again below.)</>
              )}
            </p>
          )}

          <h4>Offered for release</h4>
          {offered.length === 0 ? (
            <p>Nothing offered yet — when you mark something for release, it waits here.</p>
          ) : (
            <ul className="fleet-defense-releases">
              {offered.map((r) => (
                <li key={r.id}>
                  <strong>{r.label}</strong> — {FLEET_DEFENSE_KIND_LABELS[r.kind].toLowerCase()} ·{" "}
                  {r.size} — {FLEET_DEFENSE_INVADERS_BY_SIZE[r.size]} ships will come ·{" "}
                  <button type="button" onClick={() => void start(r.id)}>
                    Summon the fleet
                  </button>
                </li>
              ))}
            </ul>
          )}

          {cleared.length > 0 && (
            <>
              <h4>Cleared</h4>
              <ul className="fleet-defense-releases">
                {cleared.map((r) => (
                  <li key={r.id}>
                    {r.label} — let go <time dateTime={r.updatedAt}>{localTime(r.updatedAt)}</time>
                  </li>
                ))}
              </ul>
            </>
          )}

          {!showOffer ? (
            <p>
              <button type="button" onClick={() => setShowOffer(true)}>
                Offer something for release
              </button>
            </p>
          ) : (
            <form
              className="fleet-defense-offer"
              onSubmit={(e) => {
                e.preventDefault();
                if (!label.trim()) return;
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                void submitOffer();
              }}
            >
              <label>
                What kind of thing is this?
                <select value={kind} onChange={(e) => setKind(e.target.value as FleetDefenseReleaseKind)}>
                  {FLEET_DEFENSE_RELEASE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {FLEET_DEFENSE_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset>
                <legend>How big does it feel?</legend>
                {FLEET_DEFENSE_RELEASE_SIZES.map((s) => (
                  <label key={s}>
                    <input
                      type="radio"
                      name="defense-size"
                      checked={size === s}
                      onChange={() => setSize(s)}
                    />{" "}
                    {FLEET_DEFENSE_SIZE_LABELS[s]}
                  </label>
                ))}
              </fieldset>
              <label>
                Name it, in your own words
                <input
                  type="text"
                  value={label}
                  maxLength={200}
                  placeholder={KIND_PLACEHOLDERS[kind]}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              {kind === "emotion" && nodes.length > 0 && (
                <label>
                  The memory it belongs to (optional)
                  <select
                    value={nodeId ?? ""}
                    onChange={(e) => setNodeId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">No single memory — just the feeling</option>
                    {nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p>
                Offering it does not summon the fleet — that is a second, separate step. The
                memory itself is never changed; only the charge is released.
              </p>
              <button type="submit" disabled={!label.trim()}>
                {confirming ? "Yes, offer it for release" : "Offer this for release"}
              </button>{" "}
              <button
                type="button"
                onClick={() => {
                  setShowOffer(false);
                  setConfirming(false);
                }}
              >
                Not now
              </button>
            </form>
          )}

          {error && <p className="fleet-defense-error">{error}</p>}

          {overview.history.length > 0 && (
            <>
              <h4>Past defenses</h4>
              <ul className="fleet-defense-history">
                {overview.history.map((d) => {
                  const rel = releases.find((r) => r.id === d.releaseId);
                  return (
                    <li key={d.id}>
                      {d.status === "won" ? "Cleared" : "Dispersed"} — {rel?.label ?? "a charge"} ·{" "}
                      {d.tickCount} round{d.tickCount === 1 ? "" : "s"} ·{" "}
                      <time dateTime={d.updatedAt}>{localTime(d.updatedAt)}</time>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {/* Scale practice — a clearly separated mode, NOT a real defense.
          It needs no server and no release, so it renders even when
          the real defense couldn't be reached: practice is always
          available, and it can never be mistaken for a defense of
          something you chose to let go of. */}
      <div className="fleet-defense-practice" aria-label="Practice in Scale Space">
        <h4>Practice in Scale Space</h4>
        <p>
          PRACTICE — this is only practice, in Scale Space. Nothing is at stake here: no
          release is offered, nothing is cleared, nothing is saved, and nothing you
          worked on is touched. It is the same defense loop — the same ships, the same
          three lanes, one short round, one wave — so you can learn how it plays before
          a real defense, or just play it for its own sake. Practice is free, and
          practice earns nothing: no score, no reward, no record kept.
        </p>

        {!practice && (
          <>
            <fieldset>
              <legend>How big a practice fleet?</legend>
              {FLEET_DEFENSE_RELEASE_SIZES.map((s) => (
                <label key={s}>
                  <input
                    type="radio"
                    name="practice-size"
                    checked={practiceSize === s}
                    onChange={() => setPracticeSize(s)}
                  />{" "}
                  {PRACTICE_SIZE_LABELS[s]}
                </label>
              ))}
            </fieldset>
            <p>
              <button type="button" onClick={() => startPractice(practiceSize)}>
                Start a practice round
              </button>
            </p>
          </>
        )}

        {practice && (
          <div className="fleet-defense-board" aria-label="Practice round">
            <h4>
              PRACTICE round — {practice.size} fleet,{" "}
              {practice.status === "active"
                ? "in progress"
                : practice.status === "won"
                  ? "practice fleet dispersed"
                  : "practice fleet got through"}
            </h4>
            <p>
              {practice.invaders.filter((i) => !i.dispersed).length} of{" "}
              {practice.invaders.length} practice ships still closing in · round{" "}
              {practice.tickCount + 1}
            </p>
            <p>
              Defenders: {FLEET_DEFENSE_DEFENDERS.map((d) => d.name).join(" · ")} — Kenney
              hulls and her own ship, against Quaternius fighters.
            </p>
            {[1, 2, 3].map((lane) => {
              const inLane = practice.invaders.filter((i) => i.lane === lane);
              return (
                <div key={lane} className="fleet-defense-lane">
                  <strong>Lane {lane}</strong>
                  <ul>
                    {inLane.map((inv) => (
                      <li key={inv.shipKey}>
                        {inv.shipName} —{" "}
                        {inv.dispersed ? "dispersed" : `${inv.distance} step${inv.distance === 1 ? "" : "s"} out`}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {practice.lastLine && <p className="fleet-defense-line">{practice.lastLine}</p>}
            {practice.status !== "active" && (
              <p className="fleet-defense-outcome">{practiceOutcomeLine(practice.status)}</p>
            )}
            <div className="fleet-defense-controls">
              <button
                type="button"
                onClick={() => tickPractice("autonomous")}
                disabled={practice.status !== "active"}
              >
                Let Soumaya take this round
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={practiceAutoPlay}
                  onChange={(e) => setPracticeAutoPlay(e.target.checked)}
                />{" "}
                She plays on her own
              </label>
            </div>
            <div className="fleet-defense-helm">
              <span>Take the helm — fire down a lane:</span>{" "}
              {Array.from({ length: FLEET_DEFENSE_LANES }, (_, i) => i + 1).map((lane) => (
                <button
                  key={lane}
                  type="button"
                  disabled={practice.status !== "active"}
                  onClick={() => {
                    setPracticeHelmLane(lane);
                    tickPractice("helm", lane);
                  }}
                >
                  Fire lane {lane}
                </button>
              ))}
              {practiceHelmLane !== null && <span> Last practice helm shot: lane {practiceHelmLane}.</span>}
            </div>
            <p>
              <button type="button" onClick={() => endPractice()}>
                End practice
              </button>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
