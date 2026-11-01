import type { ChronicleLine } from "@brain/shared";

/**
 * The Chronicle (NPC-Player Layer L1, design §8.1): the world's
 * radio — harbor and captain acts as plain lines with their causes,
 * newest first. A pure render of the server's read model over the
 * shared NPC log; it computes nothing. Times render in the
 * viewer's own local time — never UTC.
 */

const KIND_VERB: Record<string, string> = {
  speak: "Said",
  greet: "Said hello",
  arrive: "Arrived",
  depart: "Departed",
  travel: "Travelled",
  wait: "Waited",
  "announce-route": "Announced a route",
  explore: "Looked",
  gesture: "Gestured",
  move: "Moved",
  "reorder-light": "Reordered the light",
  "summon-ship": "Summoned a ship",
  "dismiss-ship": "Dismissed a ship",
};

/** Local time, in the viewer's own timezone — the standing rule:
 *  no UTC in anything user-facing, ever. */
export function localTime(iso: string): string {
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

export default function ChronicleFeed({ lines }: { lines: ChronicleLine[] | null }) {
  return (
    <section className="chronicle-feed" aria-label="The Chronicle">
      <h4>The Chronicle — the world&apos;s radio</h4>
      {lines === null && <p>The Chronicle couldn&apos;t be reached just now.</p>}
      {lines !== null && lines.length === 0 && (
        <p>Nothing on the radio yet — the captains and the harbor controller will fill it as they live.</p>
      )}
      {lines !== null && lines.length > 0 && (
        <ul>
          {lines.map((l) => (
            <li key={l.id}>
              <strong>
                {l.npcName} — {KIND_VERB[l.kind] ?? "Acted"}
              </strong>{" "}
              — {l.line} <em>{l.cause}</em>{" "}
              <time dateTime={l.createdAt}>{localTime(l.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
