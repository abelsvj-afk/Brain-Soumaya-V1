import { STORY_ROADS, castMember, roadView } from "@brain/shared";
import { getSpaceId } from "../api/http.js";
import { readMet } from "../graph/npcPresence.js";
import { useStoryRoads } from "../hooks/useStoryRoads.js";

/**
 * The roads this brain has taken (docs/specs/story-roads-2026-10-31.md): a quiet list under the sky. A walking road shows only the line it waits at; a resting road
 * says it will keep; a finished one keeps its gift. No counts, no "locked", nothing missed — a road you never took simply isn't here. Rest / take up again are 44 px
 * buttons and the state is always in words.
 */
export default function BookRoads({ found }: { found: ReadonlySet<string> }) {
  const { states, set } = useStoryRoads(true);
  const met = readMet(getSpaceId());
  const meetings = Object.fromEntries(Object.entries(met).map(([k, v]) => [k, v?.count ?? 0]));
  const roads = STORY_ROADS.filter((r) => states[r.id]);
  if (roads.length === 0) return null;
  const order = { taken: 0, rested: 1, done: 2 } as const;
  roads.sort((a, b) => order[states[a.id]!] - order[states[b.id]!]);
  return (
    <section className="book-roads" aria-label="Roads you have taken">
      <h3>Roads</h3>
      <ul>
        {roads.map((r) => {
          const state = states[r.id]!;
          const view = roadView(r, { found, meetings });
          const finished = state === "done" || view.done;
          return (
            <li key={r.id} className={`book-road is-${finished ? "done" : state}`}>
              <strong>{r.title}</strong>
              <span className="book-road-from">{castMember(r.giver)?.name ?? "someone"} · {finished ? "finished" : state === "rested" ? "resting" : "walking"}</span>
              <p>{finished ? r.gift : state === "rested" ? "It is resting. It will keep." : (view.current ?? r.offer)}</p>
              {!finished && (
                <button type="button" onClick={() => void set(r.id, state === "rested" ? "taken" : "rested")}>
                  {state === "rested" ? "Take it up again" : "Let it rest for now"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
