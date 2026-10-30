import { useMemo, useRef, useState } from "react";
import { castMember, NPC_TALK_BY_ID, openSteps, pointerFor, STORY_ROADS, roadView, rumourFor } from "@brain/shared";
import { getSpaceId } from "../api/http.js";
import { useDialogA11y } from "../hooks/useDialogA11y.js";
import { useStoryBook } from "../hooks/useStoryBook.js";
import { useStoryRoads } from "../hooks/useStoryRoads.js";
import { markHeard, readHeard } from "../graph/npcTalk.js";
import { getNarrationMode, playNarration } from "../lib/narration.js";

/**
 * Talking to a person (docs/specs/living-worlds-dialogue-2026-10-31.md, S3). Authored choices, never free text. While this is open the person stops where they are and turns to
 * you (the scene does that); closing it lets them go on. Nothing is spent, scored or gated: you may stop at any step and the thread simply rests.
 * Placed in the lower part of the screen, clear of the header and the dock; Escape closes; every choice is a 44 px button.
 */
export default function NpcTalk({ npc, world, meetings, onClose }: { npc: string; world: string | null; meetings: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
  const member = castMember(npc);
  const talk = NPC_TALK_BY_ID.get(npc);
  const { book } = useStoryBook(true);
  const found = useMemo(() => new Set(book.finds.map((f) => f.entryId)), [book.finds]);
  const [heard, setHeard] = useState(() => readHeard(getSpaceId(), npc));
  // They open with a line of their own: the introduction at a first meeting, otherwise one of their greetings.
  const [said, setSaid] = useState(() => (member ? (meetings <= 1 ? member.intro : member.greetings[Math.floor(Date.now() / 60_000) % member.greetings.length]!) : ""));
  const [bye, setBye] = useState(false);
  const { states: roadStates, set: setRoad } = useStoryRoads(true);
  /** The road being spoken of, if any: offered, or already taken and waiting at a line. */
  const [roadId, setRoadId] = useState<string | null>(null);
  if (!member || !talk) return null;

  const atHome = world === member.home;
  const steps = openSteps(talk, { meetings, heard });
  const point = pointerFor(talk, found);
  /** Show the words; with narration on ("whenever I find something") the person's own voice reads the same line (the server names the canon line from `key`). */
  const say = (text: string, key?: string) => {
    setSaid(text);
    setBye(false);
    if (key && getNarrationMode() === "on") void playNarration({ entryId: key, register: "plain", text, say: { npc, key } });
  };
  // A road this person can give, walked by what the Book and meetings already show — never a counter. A finished road is recorded once and just keeps its gift.
  const roadCtx = { found, meetings: { [npc]: meetings } };
  const roads = STORY_ROADS.filter((r) => r.giver === npc);
  const road = roads.find((r) => roadStates[r.id] !== "done") ?? roads[0];
  const view = road ? roadView(road, roadCtx) : null;
  const roadState = road ? roadStates[road.id] : undefined;
  const talkRoad = () => {
    if (!road || !view) return;
    setRoadId(road.id);
    if (roadState === "done" || (view.done && roadState === "taken")) {
      if (roadState !== "done") void setRoad(road.id, "done");
      say(road.gift, `road:${road.id}:gift`);
    } else if (roadState === "taken") say(view.current ? `You said you would. ${view.current}` : road.offer);
    else say(road.offer, `road:${road.id}:offer`);
  };
  // A rumour pointing at one of the silences the story walks past (a seed for a later expansion); said once they know you a little, never required.
  const rumour = rumourFor(npc, meetings);
  const choices: { id: string; label: string; run: () => void }[] = [
    { id: "who", label: "Who are you?", run: () => say(talk.who, "who") },
    { id: "place", label: "What is this place to you?", run: () => say(atHome ? talk.placeHome : talk.placeAway, atHome ? "place-home" : "place-away") },
    { id: "job", label: "What do you do?", run: () => say(talk.job, "job") },
    ...steps.map((s) => ({
      id: s.id,
      label: s.ask,
      run: () => {
        say(s.say, `step:${s.id}`);
        setHeard(markHeard(getSpaceId(), npc, s.id));
      },
    })),
    ...(road ? [{ id: "road", label: "Is there something I can do for you?", run: talkRoad }] : []),
    ...(rumour ? [{ id: "rumour", label: "Heard anything lately?", run: () => say(rumour.line, "rumour") }] : []),
    { id: "look", label: "Is there something I should look for?", run: () => say(point ? point.say : talk.allFound, point ? `point:${point.entryId}` : "allfound") },
  ];

  return (
    <div className="npc-talk" role="dialog" aria-label={`Talking with ${member.name}`} ref={ref}>
      <header className="npc-talk-head">
        <strong>{member.name}</strong>
        <span className="npc-talk-role">{member.job.split(".")[0]}</span>
      </header>
      <p className="npc-talk-say" aria-live="polite">
        {bye ? talk.farewell : `“${said}”`}
      </p>
      {!bye && road && roadId === road.id && roadState !== "done" && !(view?.done && roadState === "taken") && (
        <div className="npc-talk-road" role="group" aria-label={road.title}>
          <strong>{road.title}</strong>
          {roadState === "taken" ? (
            <button type="button" onClick={() => void setRoad(road.id, "rested").then(() => say("Then let it rest. It will keep."))}>
              Let it rest for now
            </button>
          ) : (
            <>
              <button type="button" onClick={() => void setRoad(road.id, "taken").then(() => say(view?.current ?? road.offer))}>
                {roadState === "rested" ? "Take it up again" : "I will"}
              </button>
              {roadState !== "rested" && (
                <button type="button" onClick={() => say("Of course. Another day.")}>
                  Not now
                </button>
              )}
            </>
          )}
        </div>
      )}
      {!bye && (
        <ul className="npc-talk-choices">
          {choices.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={c.run}>
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="npc-talk-bye"
        onClick={() => {
          if (bye) onClose();
          else setBye(true);
        }}
      >
        {bye ? "Close" : "Goodbye"}
      </button>
    </div>
  );
}
