import { useMemo, useRef, useState } from "react";
import { castMember, NPC_TALK_BY_ID, openSteps, pointerFor } from "@brain/shared";
import { getSpaceId } from "../api/http.js";
import { useDialogA11y } from "../hooks/useDialogA11y.js";
import { useStoryBook } from "../hooks/useStoryBook.js";
import { markHeard, readHeard } from "../graph/npcTalk.js";

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
  if (!member || !talk) return null;

  const atHome = world === member.home;
  const steps = openSteps(talk, { meetings, heard });
  const point = pointerFor(talk, found);
  const say = (text: string) => {
    setSaid(text);
    setBye(false);
  };
  const choices: { id: string; label: string; run: () => void }[] = [
    { id: "who", label: "Who are you?", run: () => say(talk.who) },
    { id: "place", label: "What is this place to you?", run: () => say(atHome ? talk.placeHome : talk.placeAway) },
    { id: "job", label: "What do you do?", run: () => say(talk.job) },
    ...steps.map((s) => ({
      id: s.id,
      label: s.ask,
      run: () => {
        say(s.say);
        setHeard(markHeard(getSpaceId(), npc, s.id));
      },
    })),
    { id: "look", label: "Is there something I should look for?", run: () => say(point ? point.say : talk.allFound) },
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
