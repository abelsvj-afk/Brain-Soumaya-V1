import type { CaptainQuestionKind, CaptainState, CaptainWorld } from "@brain/shared";
import { useCaptains } from "../hooks/useCaptains.js";
import ChronicleFeed, { localTime } from "./ChronicleFeed.js";

/**
 * The Captains panel (NPC-Player Layer L1 — Presence; P1 —
 * Galaxy-Wide), mounted at the Great Station and at Scale. P1 flies
 * two captains — Bex, and Junia resident at the Growing Place; P2
 * wakes Veyra the Seeker, whose card also carries her stored plan
 * (goal, version, steps with expected outcomes), her gate progress
 * in plain words, and her own-pool relic count — all rendered from
 * the wire state the server derived from her stores. The
 * panel shows where each captain is (including honestly in
 * transit, with the leg's destination and kind), the home anchor
 * by its specific name, the captain's own ledgers, the three
 * questions, the owner's stop/resume and forget-our-meetings
 * controls, and the "why" log — every line the server's words,
 * rendered verbatim. The other six captains are listed honestly
 * as not flying yet, with their anchors named. At the Station the
 * panel also carries the Chronicle.
 *
 * Her ship flies the bob (an existing traffic hull) and moors at
 * her berth only while she is Present at the Station — the scene
 * host reads that from this same server state. At Scale, presence
 * is this panel and the Chronicle only (ship rendering at Scale is
 * later work, recorded in the L1 build record).
 */

const QUESTIONS: readonly { kind: CaptainQuestionKind; label: string }[] = [
  { kind: "doing", label: "What are you doing?" },
  { kind: "met", label: "Have we met?" },
  { kind: "headed", label: "Where are you headed?" },
] as const;

const KIND_VERB: Record<string, string> = {
  speak: "Said",
  greet: "Said hello",
  arrive: "Arrived",
  depart: "Departed",
  travel: "Travelled",
  wait: "Waited",
  deed: "Did a deed",
  search: "Searched",
  plan: "Planned",
  commission: "Commission",
  "gate-check": "Asked the gate",
  "gate-passage": "Gate passage",
  gather: "Gathered",
  sell: "Sold",
  refine: "Refined",
};

const GOOD_LABEL: Record<string, string> = {
  ore: "Ore",
  salvage: "Salvage",
  data: "Data",
  component: "Component",
  circuit: "Circuit",
};

const WORLD_PLAIN: Record<string, string> = {
  "great-station": "the Great Station",
  scale: "Scale",
  "growing-place": "the Growing Place",
  "deep-past": "the Deep Past",
  "quiet-archive": "the Quiet Archive",
};

function worldPlain(key: string | null): string {
  if (!key) return "away from the public worlds";
  return WORLD_PLAIN[key] ?? key;
}

function CaptainCard({
  captain,
  others,
  answer,
  ask,
  stop,
  resume,
  wipeMeetings,
  reset,
}: {
  captain: CaptainState;
  others: CaptainState[];
  answer: string | null;
  ask: (id: string, q: CaptainQuestionKind, about?: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  wipeMeetings: (id: string) => Promise<void>;
  reset: (id: string) => Promise<void>;
}) {
  const c = captain;
  return (
    <article className="captains-card" aria-label={`${c.name}, ${c.role}`}>
      <h4>
        {c.name} — {c.role}
      </h4>
      <p>
        {c.personality} {c.ageBand}, {c.pronouns}. {c.traits.join(" · ")}.
      </p>
      {!c.active && <p>Not flying yet — runs begin in a later increment. Home: {c.homeAnchor}.</p>}
      {c.active && (
        <>
          <p>
            {c.present
              ? `Here now — visiting ${worldPlain(c.currentWorld)}.`
              : c.stopped
                ? "Stopped by the owner."
                : c.transitState !== "none"
                  ? `In transit — bound for ${worldPlain(c.legTo)} (${c.legKind ?? "drift"}).`
                  : `Away just now — home is ${c.homeAnchor}.`}
          </p>
          <p>{c.doingLine}</p>
          <p>
            Home anchor: {c.homeAnchor}. Own ledgers: {Math.floor(c.fuel)} fuel · {Math.floor(c.credits)}{" "}
            credits. Meetings remembered: {c.meetingsRemembered}
            {c.firstMetAt ? ` (first met ${localTime(c.firstMetAt)})` : ""}. Today: {c.actsToday} acts,{" "}
            {c.speaksToday} spoken.
          </p>

          {c.cargo !== undefined && (
            <p>
              Hold:{" "}
              {c.cargo.length === 0
                ? "empty"
                : c.cargo.map((g) => `${g.qty} ${GOOD_LABEL[g.good] ?? g.good}`).join(" · ")}{" "}
              ({c.holdUsed ?? 0} of {c.holdCapacity ?? 20} units) — visible cargo, from her own hold.
              {c.savingsGoal && (
                <>
                  {" "}
                  Saving for {c.savingsGoal.label}: {c.savingsGoal.distance > 0
                    ? `${c.savingsGoal.distance} Credits to the ${c.savingsGoal.target} mark.`
                    : `the ${c.savingsGoal.target} mark is funded.`}
                </>
              )}
            </p>
          )}

          {c.affinities && c.affinities.length > 0 && (
            <p>
              Her regard, as the market and the road have written it:{" "}
              {c.affinities
                .map((a) => `${others.find((o) => o.id === a.captainId)?.name ?? a.captainId} ${a.value > 0 ? "+" : ""}${a.value}`)
                .join(" · ")}
              .
            </p>
          )}

          {(c.plan || c.gateView) && (
            <>
              {c.gateView && <p>{c.gateView.line}</p>}
              {c.relicsHeld && <p>Relics held from her own pool: {c.relicsHeld.length}</p>}
              {c.plan && (
                <>
                  <p>
                    Plan v{c.plan.version} — {c.plan.goalText} ({c.plan.state}).
                  </p>
                  <ul className="captains-plan">
                    {c.plan.steps.map((s, i) => (
                      <li key={i}>
                        {s.label} — expected: {s.expected} [{s.state}
                        {s.observed ? `: ${s.observed}` : ""}]
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {answer && <p className="captains-answer">{answer}</p>}

          <div className="captains-questions">
            {QUESTIONS.map((q) => (
              <button key={q.kind} type="button" disabled={c.stopped} onClick={() => void ask(c.id, q.kind)}>
                {q.label}
              </button>
            ))}
            {c.cargo !== undefined &&
              others
                .filter((o) => o.active)
                .map((o) => (
                  <button
                    key={`about-${o.id}`}
                    type="button"
                    disabled={c.stopped}
                    onClick={() => void ask(c.id, "about", o.id)}
                  >
                    Tell me about {o.name}
                  </button>
                ))}
          </div>

          {c.stopped ? (
            <p>
              Stopped — nothing happens while stopped.{" "}
              <button type="button" onClick={() => void resume(c.id)}>
                Start again
              </button>
            </p>
          ) : (
            <p>
              <button type="button" onClick={() => void stop(c.id)}>
                Stop {c.name}
              </button>{" "}
              <button type="button" onClick={() => void wipeMeetings(c.id)}>
                Forget our meetings
              </button>{" "}
              {(c.plan || c.gateView) && (
                <button type="button" onClick={() => void reset(c.id)}>
                  Reset {c.name} entirely
                </button>
              )}
            </p>
          )}

          {c.recentLog.length > 0 && (
            <>
              <h5>Why {c.name} did what {c.name} did</h5>
              <ul className="captains-log">
                {c.recentLog.map((e) => (
                  <li key={e.id}>
                    <strong>{KIND_VERB[e.kind] ?? "Acted"}</strong> — {e.act} <em>{e.cause}</em>{" "}
                    <time dateTime={e.createdAt}>{localTime(e.createdAt)}</time>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </article>
  );
}

export default function CaptainsPanel({
  world,
  enabled = true,
  onClose,
}: {
  /** The public world the panel is mounted in. */
  world: CaptainWorld;
  enabled?: boolean;
  onClose?: () => void;
}) {
  const atStation = world === "great-station";
  const {
    captains, chronicle, answers, loading, failed, error, refresh, ask, stop, resume, wipeMeetings, reset,
    toggleDirector,
  } = useCaptains(enabled, atStation);
  const directorEnabled = captains?.find((c) => c.directorEnabled !== undefined)?.directorEnabled;

  return (
    <section className="captains" aria-label="Captains">
      <header className="captains-bar">
        <h3>Captains</h3>
        {onClose && (
          <button type="button" onClick={onClose}>
            Close
          </button>
        )}
      </header>

      {loading && !captains && <p>Checking in with the captains…</p>}
      {failed && !captains && (
        <p>
          The captains couldn&apos;t be reached — your journeys are unaffected.{" "}
          <button type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}

      {captains && (
        <>
          <p>
            The captains are this world&apos;s own people — not other players, and they&apos;ll never
            pretend to be. They keep to the public worlds, live on their own ledgers, and everything
            they do is logged where you can read it.
          </p>
          {atStation && directorEnabled !== undefined && (
            <p>
              Director-lite is {directorEnabled ? "on" : "off"} — it stages small market-and-lane moments
              while you are here, and touches nothing of yours.{" "}
              <button type="button" onClick={() => void toggleDirector(!directorEnabled)}>
                Turn the Director {directorEnabled ? "off" : "on"}
              </button>
            </p>
          )}
          {captains.map((c) => (
            <CaptainCard
              key={c.id}
              captain={c}
              others={captains.filter((o) => o.id !== c.id)}
              answer={answers.get(c.id) ?? null}
              ask={ask}
              stop={stop}
              resume={resume}
              wipeMeetings={wipeMeetings}
              reset={reset}
            />
          ))}
          {error && <p className="captains-error">{error}</p>}
          {atStation && <ChronicleFeed lines={chronicle} />}
        </>
      )}
    </section>
  );
}
