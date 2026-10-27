import type { NpcQuestionKind } from "@brain/shared";
import { useHarborController } from "../hooks/useHarborController.js";

/**
 * The harbor controller, at the Great Station (Wave 2, NPC autonomy).
 * Roster #1: one job — help you arrive. Routes, arrivals, traffic.
 * Answers when asked; never directs.
 *
 * Everything here renders the server's state: the controller's words
 * are the server's words, its log is the server's log, and its stop
 * switch is the owner's kill switch. The panel never decides anything
 * itself. Log times render in the viewer's own local time — never UTC.
 */

const QUESTIONS: readonly { kind: NpcQuestionKind; label: string }[] = [
  { kind: "routes", label: "Routes from here" },
  { kind: "arrivals", label: "Arrivals" },
  { kind: "traffic", label: "Traffic" },
  { kind: "fuel", label: "Fuel" },
  { kind: "gate", label: "The gate" },
] as const;

const KIND_VERB: Record<string, string> = {
  speak: "Said",
  "announce-route": "Announced a route",
  explore: "Looked",
  wait: "Waited",
  gesture: "Gestured",
  move: "Moved",
  "reorder-light": "Reordered the light",
  "summon-ship": "Summoned a ship",
  "dismiss-ship": "Dismissed a ship",
};

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

export default function HarborControllerPanel({
  enabled = true,
  onClose,
}: {
  enabled?: boolean;
  onClose?: () => void;
}) {
  const { npc, answer, loading, failed, error, refresh, ask, stop, resume } =
    useHarborController(enabled);

  return (
    <section className="harbor-controller" aria-label="Harbor controller">
      <header className="harbor-controller-bar">
        <h3>Harbor controller</h3>
        {onClose && (
          <button type="button" onClick={onClose}>
            Close
          </button>
        )}
      </header>

      {loading && !npc && <p>Checking in with the controller…</p>}
      {failed && !npc && (
        <p>
          The controller couldn&apos;t be reached — your journeys are unaffected.{" "}
          <button type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </p>
      )}

      {npc && (
        <>
          <p>Help you arrive — routes, arrivals, traffic. Answers when asked; never directs.</p>
          <p>
            Its ship — the dispatcher — is moored at the berth between arms 1 and 2. It flies no
            lane; it waits here, the way a harbor controller waits.
          </p>
          <p>
            {npc.gateOpen
              ? "The way to Eternity is open for it — it opened once, and it stays open."
              : npc.relicsHeld === 0
                ? "The way to Eternity is not open for it yet — it holds no relics, and the way needs the Witness Without a Name plus two others."
                : `The way to Eternity is not open for it yet — it holds ${npc.relicsHeld} relic${npc.relicsHeld === 1 ? "" : "s"}, and the way needs the Witness Without a Name plus two others.`}
          </p>

          {answer && <p className="harbor-controller-answer">{answer}</p>}

          <div className="harbor-controller-questions">
            {QUESTIONS.map((q) => (
              <button key={q.kind} type="button" disabled={npc.stopped} onClick={() => void ask(q.kind)}>
                {q.label}
              </button>
            ))}
          </div>

          {npc.stopped ? (
            <p>
              Stopped — it does nothing while stopped.{" "}
              <button type="button" onClick={() => void resume()}>
                Start it again
              </button>
            </p>
          ) : (
            <p>
              <button type="button" onClick={() => void stop()}>
                Stop the controller
              </button>
            </p>
          )}

          {error && <p className="harbor-controller-error">{error}</p>}

          <h4>Why did it do that?</h4>
          {npc.recentLog.length === 0 ? (
            <p>Nothing yet — its acts will show here, with the reason for each.</p>
          ) : (
            <ul className="harbor-controller-log">
              {npc.recentLog.map((e) => (
                <li key={e.id}>
                  <strong>{KIND_VERB[e.kind] ?? "Acted"}</strong> — {e.act}{" "}
                  <span className="harbor-controller-cause">({e.cause})</span>{" "}
                  <time dateTime={e.createdAt}>{localTime(e.createdAt)}</time>
                </li>
              ))}
            </ul>
          )}
          <p>
            {npc.actsToday} act{npc.actsToday === 1 ? "" : "s"} today, {npc.speaksToday} spoken.
          </p>
        </>
      )}
    </section>
  );
}
