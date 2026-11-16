import { useCallback, useEffect, useRef, useState } from "react";
import { getVoiceConsole, putVoiceChoice, testVoice, type VoiceConsoleData } from "../api/story.js";
import { STORY_ART } from "../lib/storyArt.js";

const ROLE_LABEL: Record<string, string> = {
  narrator: "The Narrator (everything not spoken by a person)",
  eternity: "Eternity",
  calend: "Calend, the Doorkeeper",
  ysmerel: "Ysmerel, the Choirmaster",
  dorrow: "Dorrow Quint",
  dissenter: "The Dissenter",
  surveyor: "The Surveyor",
  archivist: "The Archivist",
  keeper: "The Keeper",
  hesk: "Hesk, the Warden-General",
  tamsin: "Tamsin of the Open Hand",
  ossian: "Ossian Reed, the Last Honest Liar",
  ilsabet: "Ilsabet Marrow, the Cartographer",
  pell: "Pell, the Follower",
  wim: "Wim Ostler, Brannoch's clerk",
};

/**
 * Who each role IS, so a voice is chosen for a person, not a name (the owner's standing rule: wherever a voice is assigned, the character's sex, age and personality
 * show at that spot). Sourced from the Continuity Bible's identity table and the cast's voice notes — and, where the Bible's table is silent, from the locked drafts,
 * which pin the Dissenter (he/him), Surveyor (she/her), Archivist (she/her) and Keeper (she/her). Where canon has pinned neither a sex nor an age, the line says
 * so plainly rather than guessing. Seven ages still have no canon source (Ysmerel, Dorrow, Dissenter, Surveyor, Archivist, Keeper, Hesk) — they stay blank
 * until the owner rules on them.
 */
const ROLE_WHO: Record<string, string> = {
  narrator: "Not a person — reads every entry, and any line whose speaker has no voice of their own.",
  eternity: "He/him · ageless · the Maker: vast, calm, radiant; brief, warm words with cosmic weight.",
  calend: "He/him · older — grey, lined, never young · the Doorkeeper: wiry, travel-worn, wry, ancient-eyed.",
  ysmerel: "She/her · age not yet pinned in the Bible · tall and weathered · the Last Choirmaster: grave and precise; a voice caught mid-breath.",
  dorrow: "He/him · age not yet pinned in the Bible · heavy, impeccably dressed · the Ledger's Grandmaster: shrewd and smooth, a smile that doesn't reach his eyes.",
  dissenter: "He/him · age not yet pinned in the Bible · sharp, dry, restless; honest to the point of rudeness, never cruel.",
  surveyor: "She/her · age not yet pinned in the Bible · Sethane's apprentice: precise, curious, quietly delighted by numbers.",
  archivist: "She/her · age not yet pinned in the Bible · Vesh's penitent: quiet, exact, a touch wistful; never rushes a thought.",
  keeper: "She/her · age not yet pinned in the Bible · Maren's heir at the Growing Place: patient, gentle, a little earthy.",
  hesk: "He/him · age not yet pinned in the Bible · big and stern · the Warden-General: guarding, not enforcing; keeps the Faded's belongings.",
  tamsin: "She/her · middle-aged · healer of the Open Hand: patient, warm, unhurried.",
  ossian: "He/him · middle-aged — dark untidy hair, short stubble · the Last Honest Liar: a storyteller's grin with truth underneath.",
  ilsabet: "She/her · middle-aged — dark hair in a loose bun · the Cartographer: patient, ink-stained, exact.",
  pell: "She/her · young and slight · the Follower: always a little behind; her face is never seen.",
  wim: "He/him · young and tidy · Brannoch's clerk: careful, by-the-book, painfully neat.",
};

/**
 * Face thumbnails reuse an existing STORY_ART image that already depicts the person — no new art, no replacements. Three roles stay faceless with a mark:
 * the Dissenter (only a chart and a hand exist — no face), the Surveyor (a tiny figure from behind — too weak to be a portrait), and the Keeper
 * (relic.dawn-leaf shows a young gardener but is UNCONFIRMED as the Keeper, so it is not labelled so). The Narrator is not a person and never gets a face.
 * Placement is not ratification: each mapping awaits the owner's eye.
 */
const ROLE_FACE: Record<string, string | null> = {
  narrator: null,
  eternity: "sight.unlooked-direction",
  calend: "relic.harbor-nail",
  ysmerel: "sight.ysmerel-at-the-edge",
  dorrow: "obj.dorrows-page",
  dissenter: null,
  surveyor: null,
  archivist: "relic.stillness-seal",
  keeper: null,
  hesk: "sight.locked-room",
  tamsin: "sight.tamsins-ward",
  ossian: "account.tall-tale",
  ilsabet: "sight.lane-to-nowhere",
  pell: "obj.follower-ribbon",
  wim: "obj.anonymous-payments",
};

/** The card face shows one identity line — sex · age-or-blank · one-phrase role — and the rest of the who-line sits behind a tap. */
function identityOf(role: string): { identity: string; rest: string } {
  const who = ROLE_WHO[role] ?? "";
  const parts = who.split(" · ");
  if (parts.length < 3) return { identity: who, rest: "" };
  return { identity: `${parts[0]} · ${parts[1]}`, rest: parts.slice(2).join(" · ") };
}

/**
 * The owner's Voices console (docs/specs/lore-narration-2026-10-30.md). Person-first: pick the person, then hear voices for them. A role with no voice of its own
 * is read by the Narrator. The server shows this to the owner's brain only. Same three endpoints as before (GET /narration/voices, PUT /narration/voice,
 * POST /narration/test) — no server change.
 */
export default function VoiceConsole() {
  const [data, setData] = useState<VoiceConsoleData | null | undefined>(undefined);
  const [sheet, setSheet] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterGender, setFilterGender] = useState("");
  const [filterAge, setFilterAge] = useState("");
  const [filterAccent, setFilterAccent] = useState("");
  const [note, setNote] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  const load = useCallback(async () => setData(await getVoiceConsole()), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (data === undefined) return <p className="voice-note">Looking at the voices…</p>;
  if (data === null) return null; // not the owner (or unreachable): the console simply is not there

  const play = (url: string) => {
    audio.current?.pause();
    audio.current = new Audio(url);
    void audio.current.play().catch(() => setNote("This device would not start the audio — tap again."));
  };
  const nameOf = (id: string) => data.available?.find((v) => v.id === id)?.name ?? id;
  const assign = async (role: string, voiceId: string | null, label = "") => {
    const r = await putVoiceChoice(role, voiceId, label);
    setNote(r ? (voiceId ? `${ROLE_LABEL[role] ?? role} now speaks in ${label || "that voice"}.` : `${ROLE_LABEL[role] ?? role} goes back to the Narrator’s voice.`) : "That did not save.");
    await load();
  };
  const test = async (role: string) => {
    setNote("Speaking a test line…");
    const r = await testVoice(role);
    if ("url" in r) {
      setNote("Playing the test line.");
      play(r.url);
    } else setNote(r.error);
  };

  const sheetRole = sheet ? data.roles.find((r) => r === sheet) ?? null : null;
  const filterOptions = (key: "gender" | "age" | "accent") =>
    [...new Set((data.available ?? []).map((v) => v.labels[key]).filter((x): x is string => Boolean(x)))].sort();
  const sheetVoices = (data.available ?? []).filter((v) => {
    if (query && !v.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (filterGender && (v.labels.gender ?? "").toLowerCase() !== filterGender.toLowerCase()) return false;
    if (filterAge && (v.labels.age ?? "").toLowerCase() !== filterAge.toLowerCase()) return false;
    if (filterAccent && (v.labels.accent ?? "").toLowerCase() !== filterAccent.toLowerCase()) return false;
    return true;
  });

  return (
    <section className="voice-console" aria-label="Voices (owner)">
      <h3>Voices (owner)</h3>
      <p className="voice-note">
        {data.status.on ? "The studio voice is on." : `The studio voice is not on yet — ${data.status.issue ?? "unknown reason"}.`} Pick a person below, then hear voices for them. Anyone without a voice of
        their own is read by the Narrator.
      </p>
      <ul className="voice-people">
        {data.roles.map((role) => {
          const { identity, rest } = identityOf(role);
          const faceKey = ROLE_FACE[role] ?? null;
          const face = faceKey ? STORY_ART[faceKey] : undefined;
          return (
            <li key={role} className="voice-person">
              {face ? (
                <img className="voice-face" src={face.src} alt={face.alt} loading="lazy" decoding="async" />
              ) : (
                <span className="voice-face voice-face-mark" aria-hidden="true">✦</span>
              )}
              <div className="voice-person-main">
                <b>{ROLE_LABEL[role] ?? role}</b>
                <span className="voice-identity">{identity}</span>
                <small>{data.assigned[role] ? nameOf(data.assigned[role]!) : role === "narrator" ? "not chosen yet" : "the Narrator"}</small>
                {rest && (
                  <details className="voice-who">
                    <summary>Who is this?</summary>
                    {rest}
                  </details>
                )}
                <span className="voice-btns">
                  <button type="button" onClick={() => void test(role)}>Test</button>
                  {data.assigned[role] && (
                    <button type="button" onClick={() => void assign(role, null)}>
                      Clear
                    </button>
                  )}
                  <button type="button" onClick={() => { setSheet(role); setQuery(""); setFilterGender(""); setFilterAge(""); setFilterAccent(""); }}>
                    Change voice
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {data.available === null && (
        <p className="voice-note">The voice list could not be read{data.status.issue ? ` — ${data.status.issue}` : ""}. The ElevenLabs API key must be set first (LORE_TTS_API_KEY).</p>
      )}
      {sheetRole && (
        <section className="voice-sheet" aria-label={`Voices for ${ROLE_LABEL[sheetRole] ?? sheetRole}`}>
          <h4>Voices for {ROLE_LABEL[sheetRole] ?? sheetRole}</h4>
          <button type="button" onClick={() => setSheet(null)}>
            Back to people
          </button>
          {data.available === null ? (
            <p className="voice-note">Open a card's sheet once the key is set — the list could not be read.</p>
          ) : (
            <>
              <label className="voice-search">
                <span>Search voices by name</span>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search voices by name" />
              </label>
              <div className="voice-filters">
                <label>
                  <span>Gender</span>
                  <select aria-label="Filter by gender" value={filterGender} onChange={(e) => setFilterGender(e.target.value)}>
                    <option value="">Any gender</option>
                    {filterOptions("gender").map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Age</span>
                  <select aria-label="Filter by age" value={filterAge} onChange={(e) => setFilterAge(e.target.value)}>
                    <option value="">Any age</option>
                    {filterOptions("age").map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Accent</span>
                  <select aria-label="Filter by accent" value={filterAccent} onChange={(e) => setFilterAccent(e.target.value)}>
                    <option value="">Any accent</option>
                    {filterOptions("accent").map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </label>
              </div>
              {sheetVoices.length === 0 ? (
                <p className="voice-note">No voices match that search.</p>
              ) : (
                <ul className="voice-list">
                  {sheetVoices.map((v) => (
                    <li key={v.id}>
                      <span>
                        <b>{v.name}</b> <small>{[v.labels.gender, v.labels.age, v.labels.accent, v.labels.description].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="voice-btns">
                        {v.preview && (
                          <button type="button" onClick={() => play(v.preview!)} aria-label={`Hear ${v.name}`}>
                            Hear
                          </button>
                        )}
                        <button type="button" onClick={() => void assign(sheetRole, v.id, v.name)}>
                          Use this voice
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
      <p className="voice-note" role="status">{note}</p>
    </section>
  );
}
