import { useCallback, useEffect, useRef, useState } from "react";
import { getVoiceConsole, putVoiceChoice, testVoice, type VoiceConsoleData } from "../api/story.js";

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
};

/**
 * The owner's Voices console (docs/specs/lore-narration-2026-10-30.md). Pick who reads the lore without touching any server setting: see every voice on the ElevenLabs account,
 * hear it, give it to the Narrator or to a character, and test it. A role with no voice of its own is read by the Narrator. The server shows this to the owner's brain only.
 */
export default function VoiceConsole() {
  const [data, setData] = useState<VoiceConsoleData | null | undefined>(undefined);
  const [pick, setPick] = useState<Record<string, string>>({});
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

  return (
    <section className="voice-console" aria-label="Voices (owner)">
      <h3>Voices (owner)</h3>
      <p className="voice-note">
        {data.status.on ? "The studio voice is on." : `The studio voice is not on yet — ${data.status.issue ?? "unknown reason"}.`} Pick a voice below and give it to the Narrator or to a character. Anyone without a voice of their
        own is read by the Narrator.
      </p>
      <ul className="voice-assigned">
        {data.roles.map((role) => (
          <li key={role}>
            <span>
              <b>{ROLE_LABEL[role] ?? role}</b>
              <br />
              <small>{data.assigned[role] ? nameOf(data.assigned[role]!) : role === "narrator" ? "not chosen yet" : "the Narrator"}</small>
            </span>
            <span className="voice-btns">
              <button type="button" onClick={() => void test(role)}>Test</button>
              {data.assigned[role] && (
                <button type="button" onClick={() => void assign(role, null)}>
                  Clear
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {data.available === null ? (
        <p className="voice-note">The voice list could not be read{data.status.issue ? ` — ${data.status.issue}` : ""}. The ElevenLabs API key must be set first (LORE_TTS_API_KEY).</p>
      ) : (
        <>
          <h4>Voices on your ElevenLabs account</h4>
          <ul className="voice-list">
            {data.available.map((v) => (
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
                  <select aria-label={`Give ${v.name} to…`} value={pick[v.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [v.id]: e.target.value }))}>
                    <option value="">Give to…</option>
                    {data.roles.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABEL[role] ?? role}
                      </option>
                    ))}
                  </select>
                  <button type="button" disabled={!pick[v.id]} onClick={() => void assign(pick[v.id]!, v.id, v.name)}>
                    Use
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="voice-note" role="status">{note}</p>
    </section>
  );
}
