import type { CaptainQuestionKind, CaptainState, CaptainWorld } from "@brain/shared";
import { useCaptains } from "../hooks/useCaptains.js";
import ChronicleFeed, { localTime } from "./ChronicleFeed.js";

/**
 * The Captains panel (NPC-Player Layer L1 — Presence; P1 —
 * Galaxy-Wide), mounted at the Great Station and at Scale. P1 flies
 * two captains — Bex, and Junia resident at the Growing Place: the
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
  answer,
  ask,
  stop,
  resume,
  wipeMeetings,
}: {
  captain: CaptainState;
  answer: string | null;
  ask: (id: string, q: CaptainQuestionKind) => Promise<void>;
  stop: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  wipeMeetings: (id: string) => Promise<void>;
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

          {answer && <p className="captains-answer">{answer}</p>}

          <div className="captains-questions">
            {QUESTIONS.map((q) => (
              <button key={q.kind} type="button" disabled={c.stopped} onClick={() => void ask(c.id, q.kind)}>
                {q.label}
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
              </button>
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
  const { captains, chronicle, answers, loading, failed, error, refresh, ask, stop, resume, wipeMeetings } =
    useCaptains(enabled, atStation);

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
          {captains.map((c) => (
            <CaptainCard
              key={c.id}
              captain={c}
              answer={answers.get(c.id) ?? null}
              ask={ask}
              stop={stop}
              resume={resume}
              wipeMeetings={wipeMeetings}
            />
          ))}
          {error && <p className="captains-error">{error}</p>}
          {atStation && <ChronicleFeed lines={chronicle} />}
        </>
      )}
    </section>
  );
}
