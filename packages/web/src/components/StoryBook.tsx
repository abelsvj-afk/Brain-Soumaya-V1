import { useMemo, useRef, useState } from "react";
import { FIRST_DOOR, STORY, WORLD_NAMES, storyNeighbours, type StoryEntry } from "@brain/shared";
import { Icon } from "./icons/Icon.js";
import { useDialogA11y } from "../hooks/useDialogA11y.js";
import { useStoryBook } from "../hooks/useStoryBook.js";
import { useStoryFlavor } from "../hooks/useStoryFlavor.js";
import { BOOK_H, BOOK_W, KIND_WORD, brightness, entryWords, skyLayout } from "../lib/storyBook.js";
import { getNarrationMode, playNarration, setNarrationMode, stopNarration, type NarrationMode } from "../lib/narration.js";
import { useEffect } from "react";
import VoiceConsole from "./VoiceConsole.js";
import { getNarrationStatus } from "../api/story.js";
import { sentenceAt, splitCaptionSentences } from "../lib/captions.js";

const BY_ID = new Map(STORY.entries.map((e) => [e.id, e]));
const worldWord = (w: string) => (w === "anywhere" ? "anywhere" : (WORLD_NAMES[w] ?? w));

/** One mark per kind, so no meaning rides on colour alone: object ● · account ◆ · sight ◎ · echo ○ (dashed) · companion ✦. */
function Mark({ kind, found, glow }: { kind: StoryEntry["kind"]; found: boolean; glow: number }) {
  const stroke = found ? "#ffe9a8" : "rgba(180,200,235,0.5)";
  const fill = found ? "#ffe9a8" : "none";
  const dash = found ? undefined : "3 3";
  const o = found ? glow : 1;
  switch (kind) {
    case "object":
      return <circle r={6} fill={fill} stroke={stroke} strokeDasharray={dash} opacity={o} />;
    case "account":
      return <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" fill={fill} stroke={stroke} strokeDasharray={dash} opacity={o} />;
    case "sight":
      return (
        <g opacity={o} fill="none" stroke={stroke} strokeDasharray={dash}>
          <circle r={8} />
          <circle r={3} fill={found ? "#ffe9a8" : "none"} />
        </g>
      );
    case "echo":
      return <circle r={7} fill="none" stroke={stroke} strokeWidth={found ? 2.2 : 1.2} strokeDasharray={found ? "2 3" : dash} opacity={o} />;
    case "companion":
      return <path d="M0 -9 L2.6 -2.6 L9 0 L2.6 2.6 L0 9 L-2.6 2.6 L-9 0 L-2.6 -2.6z" fill={fill} stroke={stroke} strokeDasharray={dash} opacity={o} />;
  }
}

/**
 * The Sixteenth's Book (docs/lore/DRAFT_4_THE_DEEP_READING.md §10, docs/specs/lore-storage-2026-10-30.md). A night sky, not a list: what you have found is a light, what you
 * have not is only a shape. NO counts, percentages or "locked" anywhere. Nothing here can be lost; fading is only a cue to recall. Lay two lights beside each other and,
 * if the story joins them, a thread appears — otherwise nothing happens (and nothing is lost).
 */
export default function StoryBook({ onClose, openId = null }: { onClose: () => void; openId?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
  const { book, loaded, reload, link, unlink, saveNote, recall } = useStoryBook(true);
  const { flavor, on: flavorOn, setOn: setFlavorOn } = useStoryFlavor(true);
  const [selected, setSelected] = useState<string | null>(openId);
  const [laying, setLaying] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // Which voice you are getting, and why — so "it used my phone's voice" is never a mystery.
  const [studio, setStudio] = useState<{ on: boolean; issue: string | null } | null>(null);
  const [fallbackWhy, setFallbackWhy] = useState<string | null>(null);
  useEffect(() => {
    void getNarrationStatus().then(setStudio);
  }, []);
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const now = Date.now();

  const layout = useMemo(() => new Map(skyLayout().map((p) => [p.id, p])), []);
  const foundById = useMemo(() => new Map(book.finds.map((f) => [f.entryId, f])), [book.finds]);
  const foundSet = useMemo(() => new Set(book.finds.map((f) => f.entryId)), [book.finds]);
  const latest = book.finds.length ? [...book.finds].sort((a, b) => b.foundAt.localeCompare(a.foundAt))[0]!.entryId : null;
  // The tremor: neighbours of the newest find give a faint shimmer — never an arrow.
  const tremor = useMemo(() => {
    // Emphasis, not a hint: with nothing found yet, the door this brain's tide surfaces first gives the faint shimmer. Every door is still equally there.
    if (!latest) return new Set([FIRST_DOOR[flavor.tide.first]]);
    return new Set(storyNeighbours(STORY, latest).filter((n) => !foundSet.has(n)));
  }, [latest, foundSet, flavor.tide.first]);
  const sel = selected ? BY_ID.get(selected) : undefined;
  const selFind = selected ? foundById.get(selected) : undefined;
  const noteOf = (id: string) => book.notes.find((n) => n.entryId === id)?.note ?? "";

  const tap = async (id: string) => {
    if (laying && laying !== id && foundSet.has(id)) {
      const r = await link(laying, id);
      setSaid(r?.lit ? "A thread of light joins them." : "");
      setLaying(null);
      setSelected(id);
      return;
    }
    setLaying(null);
    setSaid("");
    setSelected(id);
  };
  const [mode, setMode] = useState<NarrationMode>(() => getNarrationMode());
  // A reveal while the Book is already open: show that card and re-read the Book so the new light is there.
  useEffect(() => {
    if (!openId) return;
    setSelected(openId);
    void reload();
  }, [openId, reload]);
  const listen = (entry: StoryEntry, text: string) => {
    if (speaking) {
      stopNarration();
      setSpeaking(false);
      setProgress(null);
      return;
    }
    setSpeaking(true);
    void playNarration({ entryId: entry.id, register: flavor.register, tide: flavor.tide.first, text, onProgress: setProgress, onFallback: setFallbackWhy, onEnd: () => { setSpeaking(false); setProgress(null); } }).then((how) => {
      if (how === "none") { setSpeaking(false); setProgress(null); }
    });
  };
  // A find that opened the Book (narration "on") begins reading as soon as its words are ready. Leaving the Book stops it.
  const autoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openId || mode !== "on" || autoRef.current === openId || !foundSet.has(openId)) return;
    const e = BY_ID.get(openId);
    const w = e ? entryWords(e, foundSet, flavor) : null;
    if (!e || !w?.text) return;
    autoRef.current = openId;
    listen(e, [w.text, w.second].filter(Boolean).join(" "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, mode, foundSet, flavor]);
  useEffect(() => () => stopNarration(), []);

  return (
    <div className="book-scrim" onClick={onClose}>
      <div className="book-panel" role="dialog" aria-label="The Sixteenth's Book" ref={ref} onClick={(e) => e.stopPropagation()}>
        <header className="book-head">
          <h2>The Sixteenth’s Book</h2>
          <button type="button" className="book-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
            <span>Close</span>
          </button>
        </header>
        <p className="book-lede">
          What you notice in the worlds is kept here as a light. What you have not found is only a shape. Nothing here is counted, and nothing here can be lost.
        </p>
        {loaded && book.finds.length === 0 && (
          <p className="book-empty">Nothing is kept here yet. Stand still where something feels wrong, or listen where a hymn catches. It will be here when you do.</p>
        )}

        <svg className="book-sky" viewBox={`0 0 ${BOOK_W} ${BOOK_H}`} role="group" aria-label="The sky of what is kept">
          {book.links
            .filter((l) => l.lit)
            .map((l) => {
              const a = layout.get(l.a);
              const b = layout.get(l.b);
              return a && b ? <line key={`${l.a}|${l.b}`} className="book-thread" x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null;
            })}
          {STORY.entries
            .filter((e) => !e.retired)
            .map((e) => {
              const p = layout.get(e.id)!;
              const f = foundById.get(e.id);
              const glow = f ? brightness(f, now) : 1;
              const fading = !!f && glow < 0.7;
              const label = f ? `${e.title}, ${KIND_WORD[e.kind]}${fading ? ", fading — recall it to relight" : ""}` : `Not found yet, ${KIND_WORD[e.kind]}`;
              return (
                <g
                  key={e.id}
                  transform={`translate(${p.x} ${p.y})`}
                  className={`book-point${f ? " is-found" : ""}${selected === e.id ? " is-selected" : ""}${tremor.has(e.id) ? " is-tremor" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={selected === e.id}
                  onClick={() => void tap(e.id)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      void tap(e.id);
                    }
                  }}
                >
                  <circle r={22} fill="transparent" />
                  <Mark kind={e.kind} found={!!f} glow={glow} />
                  {selected === e.id && <circle r={13} className="book-ring" fill="none" />}
                </g>
              );
            })}
        </svg>
        <p className="book-legend" aria-hidden="true">● held · ◆ told · ◎ noticed · ○ heard · ✦ walked beside</p>
        <div className="book-said" role="status" aria-live="polite">{said}</div>

        {sel && (
          <section className="book-card" aria-label={selFind ? sel.title : "A shape waiting"}>
            {selFind ? (
              <FoundCard
                entry={sel}
                words={entryWords(sel, foundSet, flavor)}
                note={draft?.id === sel.id ? draft.text : noteOf(sel.id)}
                laid={book.links.filter((l) => l.a === sel.id || l.b === sel.id).map((l) => (l.a === sel.id ? l.b : l.a))}
                speaking={speaking}
                progress={progress}
                canListen={mode !== "off"}
                laying={laying === sel.id}
                onListen={() => listen(sel, [entryWords(sel, foundSet, flavor).text, entryWords(sel, foundSet, flavor).second].filter(Boolean).join(" "))}
                onRecall={() => void recall(sel.id)}
                onLay={() => setLaying(laying === sel.id ? null : sel.id)}
                onUnlay={(other) => void unlink(sel.id, other)}
                onNote={(t) => setDraft({ id: sel.id, text: t })}
                onSaveNote={async () => {
                  if (draft && (await saveNote(sel.id, draft.text))) setDraft(null);
                }}
              />
            ) : (
              <p>
                A shape waits here — <em>{KIND_WORD[sel.kind]}</em>. It will light when you find it.
              </p>
            )}
          </section>
        )}
        <VoiceConsole />
        <p className="book-voice" role="status">
          {studio === null
            ? ""
            : studio.on
              ? fallbackWhy
                ? `Narrator: this device’s voice just now — ${fallbackWhy}.`
                : "Narrator: the studio voice."
              : `Narrator: this device’s voice — ${studio.issue ?? "the studio voice is unavailable"}.`}
        </p>
        <fieldset className="book-narration">
          <legend>Read the lore to me</legend>
          {(["ask", "on", "off"] as const).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="book-narration"
                checked={mode === m}
                onChange={() => {
                  setNarrationMode(m);
                  setMode(m);
                }}
              />
              <span>{m === "ask" ? "When I ask" : m === "on" ? "Whenever I find something" : "Never"}</span>
            </label>
          ))}
        </fieldset>
        <label className="book-flavor">
          <input type="checkbox" checked={flavorOn} onChange={(e) => void setFlavorOn(e.target.checked)} />
          <span>
            Let the telling lean toward me. It colours how the story speaks to you — its voice and which door shows first. It never changes the story, and nothing of yours is read for it.
          </span>
        </label>
      </div>
    </div>
  );
}

function FoundCard(p: {
  entry: StoryEntry;
  words: { text: string | null; second: string | null };
  note: string;
  laid: string[];
  speaking: boolean;
  progress: number | null;
  canListen: boolean;
  laying: boolean;
  onListen: () => void;
  onRecall: () => void;
  onLay: () => void;
  onUnlay: (other: string) => void;
  onNote: (t: string) => void;
  onSaveNote: () => void;
}) {
  const { entry, words } = p;
  return (
    <>
      <h3>{entry.title}</h3>
      <p className="book-meta">
        {KIND_WORD[entry.kind]} · {worldWord(entry.world)}
      </p>
      <Caption text={words.text ?? "It is here. The words for it have not come yet."} second={words.second} progress={p.speaking ? p.progress : null} />
      <div className="book-actions">
        {p.canListen && words.text && (
          <button type="button" onClick={p.onListen}>
            {p.speaking ? "Stop" : "Listen"}
          </button>
        )}
        <button type="button" onClick={p.onRecall}>
          Recall this
        </button>
        <button type="button" onClick={p.onLay} aria-pressed={p.laying}>
          {p.laying ? "Choose another light…" : "Lay beside another"}
        </button>
      </div>
      {p.laid.length > 0 && (
        <ul className="book-laid" aria-label="Laid beside">
          {p.laid.map((id) => (
            <li key={id}>
              <span>{BY_ID.get(id)?.title ?? id}</span>
              <button type="button" onClick={() => p.onUnlay(id)} aria-label={`Take ${BY_ID.get(id)?.title ?? id} away`}>
                Take away
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="book-note">
        <span>Your note (only you see this)</span>
        <textarea value={p.note} maxLength={2000} rows={3} onChange={(e) => p.onNote(e.target.value)} />
      </label>
      <button type="button" className="book-save" onClick={p.onSaveNote}>
        Keep the note
      </button>
    </>
  );
}

/** The words, with the sentence being read marked (underlined and heavier — never colour alone). With no voice playing it is just the text. */
function Caption({ text, second, progress }: { text: string; second: string | null; progress: number | null }) {
  const a = splitCaptionSentences(text);
  const b = second ? splitCaptionSentences(second) : [];
  const now = sentenceAt([...a, ...b], progress);
  const render = (list: string[], offset: number) =>
    list.map((s, i) => (
      <span key={i} className={now === offset + i ? "book-now" : undefined} aria-current={now === offset + i ? "true" : undefined}>
        {s}{" "}
      </span>
    ));
  return (
    <>
      <p className="book-text">{render(a, 0)}</p>
      {b.length > 0 && <p className="book-text book-second">{render(b, a.length)}</p>}
    </>
  );
}
