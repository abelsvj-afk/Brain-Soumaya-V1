import { useRef } from "react";
import {
  CURRENT_KEYS,
  CURRENT_LABELS,
  FACTIONS,
  NPC_CAST,
  WORLD_GOVERNORS,
  faithLabel,
  faction,
  ordinanceFor,
  worldLife,
  WORLD_NAMES,
} from "@brain/shared";
import { Icon } from "./icons/Icon.js";
import { useDialogA11y } from "../hooks/useDialogA11y.js";
import { useSociety } from "../hooks/useSociety.js";

const word = (v: number) => (v >= 0.7 ? "strong" : v >= 0.45 ? "present" : v >= 0.25 ? "faint" : "quiet");
const standingWord = (v: number) => (v >= 0.55 ? "high" : v >= 0.35 ? "middling" : "low");
const WORLD_ORDER = ["great-station", "growing-place", "quiet-archive", "deep-past", "scale", "people", "faded-ward", "road-to-the-seam", "the-village", "the-unmade-hour", "the-siege", "the-yard", "the-long-morning", "the-folded-letter", "eternity"];

/**
 * The Society (docs/specs/npc-hive-society-2026-10-30.md): what runs through your galaxy lately, how the factions lean on it, the day's callings and ordinances, and who is doing
 * what right now. A MIRROR, NOT A VERDICT — it never scores you. Optional: the switch at the bottom turns the reflection off (a neutral society; nothing is read).
 */
export default function SocietyPanel({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
  const { society, reflect, loaded, setReflect } = useSociety(true);
  const now = Date.now();
  const life = WORLD_ORDER.map((w) => ({ world: w, people: worldLife(w, now, society) })).filter((x) => x.people.length > 0);
  return (
    <div className="society-scrim" onClick={onClose}>
      <div className="society-panel" role="dialog" aria-label="Society" ref={ref} onClick={(e) => e.stopPropagation()}>
        <header className="society-head">
          <h2>Society</h2>
          <button type="button" className="society-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
            <span>Close</span>
          </button>
        </header>
        <p className="society-lede">
          The people of the worlds, and what moves them. It is a <strong>mirror, not a verdict</strong>: it shows what runs through your galaxy lately — never whether you are good or bad.
        </p>

        <section aria-label="What your galaxy is carrying">
          <h3>What your galaxy is carrying</h3>
          {society.reflects && society.confidence < 0.35 && <p className="society-note">Your galaxy hasn't said much on these themes yet, so the world leans on a fairly neutral day.</p>}
          {!society.reflects && <p className="society-note">{reflect ? (loaded ? "Not enough in your galaxy yet to read — the world runs on a neutral day." : "Reading…") : "Reflection is off — the world runs on a neutral day, and nothing of yours is read."}</p>}
          <div className="society-swatch-row">
            <span className="society-swatch" style={{ background: society.color.css }} role="img" aria-label={`Your galaxy's colour today: hue ${society.color.h}`} />
            <span>
              Your colour today. Faith in Eternity runs <strong>{society.belief >= 0.65 ? "high" : society.belief >= 0.45 ? "middling" : "low"}</strong> across the worlds.
            </span>
          </div>
          <ul className="society-currents">
            {CURRENT_KEYS.map((k) => (
              <li key={k}>
                <span className="society-current-name">
                  <i style={{ background: `hsl(${CURRENT_LABELS[k].hue} 70% 55%)` }} aria-hidden="true" /> {CURRENT_LABELS[k].name}
                </span>
                <span className="society-bar" aria-hidden="true">
                  <b style={{ width: `${Math.round(society.currents[k] * 100)}%`, background: `hsl(${CURRENT_LABELS[k].hue} 70% 55%)` }} />
                </span>
                <span className="society-word">{word(society.currents[k])}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Factions">
          <h3>The factions today</h3>
          <ul className="society-factions">
            {society.factions.map((f) => {
              const def = faction(f.id)!;
              const members = NPC_CAST.filter((m) => m.faction === f.id).map((m) => m.name.replace(/^The /, ""));
              return (
                <li key={f.id}>
                  <span className="society-faction-name">
                    <i style={{ background: def.color }} aria-hidden="true" /> {def.name}
                  </span>
                  <span className="society-faction-line">{def.tagline} Standing {standingWord(f.standing)}. Called today to: <em>{f.calling.text.toLowerCase()}</em>.</span>
                  <span className="society-faction-members">{members.join(", ")}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Ordinances">
          <h3>Who governs, and today's ordinance</h3>
          <ul className="society-ordinances">
            {WORLD_ORDER.map((w) => {
              const o = ordinanceFor(w, society.currents, society.dayKey);
              return (
                <li key={w}>
                  <strong>{WORLD_NAMES[w]}</strong> <span>({faction(WORLD_GOVERNORS[w])?.name ?? "—"})</span> — {o.text}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Who is doing what">
          <h3>Right now</h3>
          {life.map(({ world, people }) => (
            <div key={world} className="society-world">
              <strong>{WORLD_NAMES[world]}</strong>
              <ul>
                {people.map((p) => (
                  <li key={p.member.id}>
                    {p.member.name} — {p.doing.caption} <span className="society-faith">({faithLabel(p.faith)}{p.member.home !== world ? ", far from home" : ""})</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <details className="society-why">
          <summary>Why does it show this?</summary>
          <p>
            It counts plain words and their weight across your last 90 days of memories (up to 400), on the server, offline, and throws the text away — only small numbers and words ever leave it.
            It is a heuristic: it can be wrong, and a memory is not a deed. Shadow and light both show up as weather in the world, and the world answers heaviness with care.
          </p>
        </details>

        <label className="society-reflect">
          <input type="checkbox" checked={reflect} onChange={(e) => void setReflect(e.target.checked)} />
          <span>Let the society reflect my brain. Off = a neutral society; nothing of yours is read.</span>
        </label>
      </div>
    </div>
  );
}
