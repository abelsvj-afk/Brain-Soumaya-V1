import { useEffect, useState } from "react";
import { COGNITIVE_KINDS, COGNITIVE_META, skillTier, type CognitiveKind } from "@brain/shared";
import {
  getCognitive,
  createCognitive,
  getUpcomingEvents,
  type UpcomingEvent,
  setCognitiveProgress,
  updateCognitive,
  promoteIdea,
  unlinkCognitive,
  pruneCognitive,
  getCognitiveEvidence,
  getPersonProfile,
  getPersonSuggestions,
  dismissPersonSuggestion,
  type CognitiveEvidence,
  type PersonProfile,
  type CognitiveItem,
  getThoughts,
  addThought,
  reinforceThought,
  promoteThought,
  dismissThought,
  editThought,
  deleteNode,
  type Thought,
} from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { playSfx } from "../graph/sfx.js";
import { mindSpaceEnabled, setMindSpaceEnabled } from "./MindSpace.js";
import { MemoryAttachments } from "./MemoryAttachments.js";

/**
 * The Mind tab — the COGNITIVE LAYER. Beyond what you've remembered, this is what
 * you're pursuing and becoming: goals your memories drift toward, ideas, skills
 * that level up, the people you orbit, your identity, your mental models. Each is
 * a first-class body in the galaxy (colour/icon from the single-source
 * COGNITIVE_META). Create them here; Soumaya then pulls related memories into
 * their orbit over time.
 */
export function MindPanel({
  onFocus,
  onChanged,
}: {
  onFocus: (id: number) => void;
  /** Refresh the galaxy after a new cognitive body is charted (so it appears). */
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<CognitiveItem[]>([]);
  const [kind, setKind] = useState<CognitiveKind>("goal");
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [aliasText, setAliasText] = useState(""); // comma-separated aliases (create)
  const [editAliases, setEditAliases] = useState(""); // comma-separated aliases (edit)
  const [showHelp, setShowHelp] = useState(false); // "how the Mind works" explainer
  const [eventDate, setEventDate] = useState(""); // for future_event
  const [events, setEvents] = useState<Record<number, UpcomingEvent>>({});
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  // Inline editing of a cognitive object (label + content).
  const [editId, setEditId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editContent, setEditContent] = useState("");
  // Working memory (the mind space): live thoughts you're holding right now.
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [thought, setThought] = useState("");
  const [ambient, setAmbient] = useState(mindSpaceEnabled());
  // Inline editing of a working-memory thought.
  const [editThoughtId, setEditThoughtId] = useState<number | null>(null);
  const [editThoughtText, setEditThoughtText] = useState("");
  // Identity evidence (Phase 5): lazy-loaded per identity when expanded.
  const [evidence, setEvidence] = useState<Record<number, CognitiveEvidence>>({});
  const [evidenceOpen, setEvidenceOpen] = useState<number | null>(null);
  // People (Phase 6): CRM profiles (lazy) + "people you mention" suggestions.
  const [profiles, setProfiles] = useState<Record<number, PersonProfile>>({});
  const [profileOpen, setProfileOpen] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<{ name: string; count: number }[]>([]);

  const refresh = () => getCognitive().then(setItems).catch(() => {});
  const refreshThoughts = () => getThoughts().then(setThoughts).catch(() => {});
  const refreshSuggestions = () => getPersonSuggestions().then(setSuggestions).catch(() => {});
  const refreshEvents = () =>
    getUpcomingEvents()
      .then((es) => setEvents(Object.fromEntries(es.map((e) => [e.id, e]))))
      .catch(() => {});
  useEffect(() => {
    refresh();
    refreshThoughts();
    refreshSuggestions();
    refreshEvents();
    // Thoughts decay server-side; poll gently so the mind space stays live.
    const t = setInterval(refreshThoughts, 20_000);
    return () => clearInterval(t);
  }, []);

  const add = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      const iso = kind === "future_event" && eventDate ? new Date(eventDate).toISOString() : undefined;
      const aliases = aliasText.split(",").map((t) => t.trim()).filter(Boolean);
      const r = await createCognitive(kind, label.trim(), content.trim() || undefined, iso, aliases.length ? aliases : undefined);
      if (r) {
        playSfx("achievement");
        pushToast(`${COGNITIVE_META[kind].icon} ${COGNITIVE_META[kind].label} added to your galaxy`, "🧠", 4500);
        setLabel("");
        setContent("");
        setAliasText("");
        setEventDate("");
        setAdding(false);
        await refresh();
        if (kind === "future_event") await refreshEvents();
        onChanged?.(); // reload the galaxy so the new body appears + is focusable
      } else {
        pushToast("Couldn't add that — try again.", "⚠️", 4000);
      }
    } finally {
      setBusy(false);
    }
  };

  const bumpProgress = async (it: CognitiveItem, delta: number) => {
    const next = Math.max(0, Math.min(1, (it.progress ?? 0) + delta));
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, progress: next } : x)));
    await setCognitiveProgress(it.id, next);
  };

  const startEdit = (it: CognitiveItem) => {
    setEditId(it.id);
    setEditLabel(it.label);
    setEditContent(it.content ?? "");
    setEditAliases((it.aliases ?? []).join(", "));
  };
  const saveEdit = async () => {
    if (editId == null || !editLabel.trim()) return;
    const aliases = editAliases.split(",").map((t) => t.trim()).filter(Boolean);
    const ok = await updateCognitive(editId, { label: editLabel.trim(), content: editContent.trim(), aliases });
    setEditId(null);
    if (ok) {
      playSfx("tap");
      await refresh();
      onChanged?.(); // label/links changed → refresh the galaxy
    } else {
      pushToast("Couldn't save that edit — try again.", "⚠️", 3500);
    }
  };

  // ── Working memory (mind space) handlers ──────────────────────────────────
  const think = async () => {
    const text = thought.trim();
    if (!text) return;
    setThought("");
    const r = await addThought(text);
    if (r) {
      playSfx("tap");
      await refreshThoughts();
    } else {
      pushToast("Couldn't hold that thought — try again.", "⚠️", 3500);
    }
  };
  const reinforce = async (t: Thought) => {
    const r = await reinforceThought(t.id);
    if (r?.promotedNodeId != null) {
      playSfx("achievement");
      pushToast(`💭 A recurring thought settled into memory`, "🧠", 4500);
      onChanged?.();
    }
    await refreshThoughts();
  };
  const promote = async (t: Thought) => {
    const r = await promoteThought(t.id);
    if (r) {
      playSfx("achievement");
      pushToast(`💭 Consolidated into your galaxy`, "🧠", 4000);
      onChanged?.();
    }
    await refreshThoughts();
  };
  const dismiss = async (t: Thought) => {
    setThoughts((xs) => xs.filter((x) => x.id !== t.id));
    await dismissThought(t.id);
  };
  const promoteToGoal = async (it: CognitiveItem) => {
    const ok = await promoteIdea(it.id);
    if (ok) {
      playSfx("achievement");
      pushToast(`💡→🎯 "${it.label}" is now a Goal you're committing to`, "🧠", 4500);
      await refresh();
      onChanged?.(); // kind/importance changed → refresh the galaxy
    } else {
      pushToast("Couldn't promote that — try again.", "⚠️", 3500);
    }
  };
  const toggleEvidence = async (it: CognitiveItem) => {
    if (evidenceOpen === it.id) {
      setEvidenceOpen(null);
      return;
    }
    setEvidenceOpen(it.id);
    if (!evidence[it.id]) {
      const ev = await getCognitiveEvidence(it.id);
      if (ev) setEvidence((m) => ({ ...m, [it.id]: ev }));
    }
  };
  const toggleProfile = async (it: CognitiveItem) => {
    if (profileOpen === it.id) {
      setProfileOpen(null);
      return;
    }
    setProfileOpen(it.id);
    if (!profiles[it.id]) {
      const p = await getPersonProfile(it.id);
      if (p) setProfiles((m) => ({ ...m, [it.id]: p }));
    }
  };
  const unlinkOne = async (anchorId: number, memoryId: number) => {
    setProfiles((m) => {
      const p = m[anchorId];
      if (!p) return m;
      return { ...m, [anchorId]: { ...p, interactions: p.interactions.filter((i) => i.id !== memoryId), count: Math.max(0, p.count - 1) } };
    });
    await unlinkCognitive(anchorId, memoryId);
    onChanged?.();
  };
  const pruneLinks = async (it: CognitiveItem) => {
    const n = await pruneCognitive(it.id);
    setProfiles((m) => ({ ...m })); // force re-fetch on next open
    setProfiles((m) => { const c = { ...m }; delete c[it.id]; return c; });
    pushToast(n > 0 ? `Cleaned up ${n} link${n === 1 ? "" : "s"} that didn't name ${it.label}.` : `Nothing to clean — every link names ${it.label}.`, "🧹", 4000);
    await refresh();
    onChanged?.();
  };
  const removeItem = async (it: CognitiveItem) => {
    if (!window.confirm(`Delete "${it.label}"? It leaves your galaxy — your memories stay, they just stop orbiting it.`)) return;
    setItems((xs) => xs.filter((x) => x.id !== it.id));
    await deleteNode(it.id);
    pushToast(`Removed "${it.label}"`, "🗑️", 3000);
    onChanged?.();
  };
  const addPerson = async (name: string) => {
    const r = await createCognitive("person_entity", name);
    if (r) {
      playSfx("achievement");
      pushToast(`❤️ Added ${name} — their memories will orbit them`, "🧠", 4000);
      setSuggestions((xs) => xs.filter((s) => s.name !== name));
      await refresh();
      onChanged?.();
    }
  };
  const notAPerson = async (name: string) => {
    setSuggestions((xs) => xs.filter((s) => s.name !== name));
    await dismissPersonSuggestion(name);
    pushToast(`Got it — "${name}" isn't a person. I won't suggest it again.`, "🚫", 3500);
  };
  const saveThoughtEdit = async () => {
    if (editThoughtId == null || !editThoughtText.trim()) return;
    const id = editThoughtId;
    const text = editThoughtText.trim();
    setThoughts((xs) => xs.map((x) => (x.id === id ? { ...x, text } : x)));
    setEditThoughtId(null);
    await editThought(id, text);
  };

  // Group by kind, in the canonical order.
  const byKind = new Map<CognitiveKind, CognitiveItem[]>();
  for (const it of items) {
    const k = it.kind as CognitiveKind;
    if (!COGNITIVE_META[k]) continue;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(it);
  }

  return (
    <div className="dock-body mind-panel">
      {/* ── Working memory: the ephemeral mind space (what you're thinking NOW) ── */}
      <section className="mind-ws">
        <div className="mind-ws-head">
          <h3>💭 Thinking now</h3>
          <button
            className={`mind-ws-toggle ${ambient ? "on" : ""}`}
            onClick={() => {
              const next = !ambient;
              setAmbient(next);
              setMindSpaceEnabled(next);
            }}
            title="Float these thoughts around the galaxy"
          >
            ✧ {ambient ? "In space" : "Show in space"}
          </button>
        </div>
        <p className="mind-ws-sub" style={{ textAlign: "left", marginBottom: 2 }}>
          A thought fades over a few days. Tap <b>↑ Keep</b> to reset its timer — keep returning to
          one (3×) and it becomes a permanent memory in your galaxy. <b>×</b> lets it go now.
        </p>
        <div className="mind-ws-input">
          <input
            className="tag-input wide"
            value={thought}
            onChange={(e) => setThought(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void think();
            }}
            placeholder="Hold a thought in your mind…"
          />
          <button className="mini" onClick={() => void think()} disabled={!thought.trim()}>
            Hold
          </button>
        </div>
        {thoughts.length === 0 ? (
          <p className="empty small">Your mind space is clear. Hold a thought and watch it glow — reinforce the ones that matter and Soumaya carries them into your galaxy.</p>
        ) : (
          <ul className="mind-ws-list">
            {thoughts.map((t) => (
              <li
                key={t.id}
                className="mind-mote"
                style={{ opacity: 0.4 + t.strength * 0.6 }}
                title={`Strength ${Math.round(t.strength * 100)}% · reinforced ${t.reinforceCount}×`}
              >
                <span
                  className="mind-mote-dot"
                  style={{ boxShadow: `0 0 ${4 + t.strength * 10}px rgba(143,220,255,${0.4 + t.strength * 0.5})` }}
                />
                {editThoughtId === t.id ? (
                  <input
                    className="tag-input wide"
                    autoFocus
                    value={editThoughtText}
                    onChange={(e) => setEditThoughtText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveThoughtEdit();
                      if (e.key === "Escape") setEditThoughtId(null);
                    }}
                    onBlur={() => void saveThoughtEdit()}
                  />
                ) : (
                  <span className="mind-mote-text">{t.text}</span>
                )}
                {editThoughtId !== t.id && (
                  <span className={`mind-mote-fade ${t.strength < 0.2 ? "low" : ""}`}>
                    {(() => {
                      const days = t.strength / 0.192; // matches the server decay (0.008/hr)
                      return days < 1 ? "fades today" : `~${Math.round(days)}d left`;
                    })()}
                  </span>
                )}
                <span className="mind-mote-actions">
                  <button
                    className="mini ghost"
                    onClick={() => {
                      setEditThoughtId(t.id);
                      setEditThoughtText(t.text);
                    }}
                    title="Edit"
                  >
                    ✎
                  </button>
                  <button className="mini ghost" onClick={() => void reinforce(t)} title="Keep it — resets the fade timer (3 keeps → becomes a memory)">↑ Keep</button>
                  <button className="mini ghost" onClick={() => void promote(t)} title="Make it a permanent memory now">★</button>
                  <button className="mini ghost" onClick={() => void dismiss(t)} title="Let it go">×</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="mind-explain-toggle" onClick={() => setShowHelp((v) => !v)}>
        {showHelp ? "▾" : "▸"} How does the Mind work?
      </button>
      {showHelp && (
        <div className="mind-explain">
          <p><b>The Mind is what you're pursuing and becoming</b> — separate from what you've just remembered.</p>
          <ul>
            <li><b>Add an entry</b> (a goal, a person, an idea, an identity…) and it becomes a body in your galaxy.</li>
            <li><b>Your memories connect to it automatically</b> — a memory that names a person, or is clearly about a goal, drifts into its orbit.</li>
            <li><b>Vague on purpose?</b> Add <b>aliases</b> (e.g. a person called "girlfriend, my girl") so memories that don't use the exact name still connect.</li>
            <li><b>She'll ask</b> when something seems related but she isn't sure — answer, connect it in one tap, or tell her it doesn't relate (she remembers).</li>
            <li><b>Goals</b> track progress · <b>skills</b> level up as you practice · <b>ideas</b> grow, merge or fade · <b>identities</b> brighten with evidence.</li>
          </ul>
        </div>
      )}
      <p className="companion-hint">
        Your mind, not just your memories: what you're <b>pursuing</b> and <b>becoming</b>. Add a
        goal, idea, skill, person, identity or mental model — Soumaya pulls related memories into its
        orbit over time.
      </p>

      {suggestions.length > 0 && (
        <div className="mind-suggest">
          <span className="mind-suggest-label">People you mention — add them?</span>
          <div className="mind-suggest-chips">
            {suggestions.map((s) => (
              <span key={s.name} className="mind-suggest-pair">
                <button className="mind-suggest-chip" onClick={() => void addPerson(s.name)} title={`Mentioned in ${s.count} memories`}>
                  ❤️ {s.name} <span className="mind-suggest-n">{s.count}</span>
                </button>
                <button
                  className="mind-suggest-x"
                  onClick={() => void notAPerson(s.name)}
                  title={`"${s.name}" isn't a person — don't suggest it again`}
                  aria-label={`Dismiss ${s.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {adding ? (
        <div className="companion-new">
          <div className="mind-kind-row">
            {COGNITIVE_KINDS.map((k) => (
              <button
                key={k}
                className={`mind-kind ${kind === k ? "on" : ""}`}
                onClick={() => setKind(k)}
                title={COGNITIVE_META[k].blurb}
              >
                {COGNITIVE_META[k].icon} {COGNITIVE_META[k].label}
              </button>
            ))}
          </div>
          <input
            className="tag-input wide"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={`Name this ${COGNITIVE_META[kind].label.toLowerCase()}…`}
          />
          <textarea
            className="companion-textarea"
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={COGNITIVE_META[kind].blurb}
          />
          {kind === "future_event" && (
            <label className="mind-date">
              <span>When?</span>
              <input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </label>
          )}
          <input
            className="tag-input wide"
            value={aliasText}
            onChange={(e) => setAliasText(e.target.value)}
            placeholder="Also called… (comma-separated — e.g. girlfriend, my girl)"
          />
          <div className="row">
            <button onClick={add} disabled={busy || !label.trim()}>
              {busy ? "Adding…" : `Add ${COGNITIVE_META[kind].label}`}
            </button>
            <button className="mini" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="companion-add-btn" onClick={() => setAdding(true)}>+ Map something in your mind</button>
      )}

      {items.length === 0 && !adding && (
        <p className="empty small">Nothing mapped yet. Start with a goal you're working toward.</p>
      )}

      {COGNITIVE_KINDS.filter((k) => byKind.has(k)).map((k) => (
        <section key={k} className="mind-section">
          <h3 style={{ color: COGNITIVE_META[k].color }}>
            {COGNITIVE_META[k].icon} {COGNITIVE_META[k].label}s
          </h3>
          <ul className="mind-list">
            {byKind.get(k)!.map((it) => (
              <li key={it.id} className="mind-card" style={{ borderLeftColor: COGNITIVE_META[k].color }}>
                {editId === it.id ? (
                  <div className="mind-edit">
                    <input
                      className="tag-input wide"
                      autoFocus
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Name"
                    />
                    <textarea
                      className="companion-textarea"
                      rows={2}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder={COGNITIVE_META[k].blurb}
                    />
                    <input
                      className="tag-input wide"
                      value={editAliases}
                      onChange={(e) => setEditAliases(e.target.value)}
                      placeholder="Also called… (comma-separated)"
                    />
                    <div className="row">
                      <button className="mini" onClick={() => void saveEdit()} disabled={!editLabel.trim()}>Save</button>
                      <button className="mini ghost" onClick={() => setEditId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mind-card-row">
                    <button className="mind-card-main" onClick={() => onFocus(it.id)} title="Fly to it">
                      <span className="mind-card-label">
                        {it.label}
                        {it.aliases && it.aliases.length > 0 && <span className="mind-card-aka"> · aka {it.aliases.join(", ")}</span>}
                      </span>
                      <span className="mind-card-sub">
                        {k === "future_event" && events[it.id]
                          ? events[it.id]!.inDays < 0
                            ? `overdue ${-events[it.id]!.inDays}d`
                            : events[it.id]!.inDays === 0
                              ? "today"
                              : `in ${events[it.id]!.inDays}d`
                          : `${it.degree} linked`}
                      </span>
                    </button>
                    <button className="mini ghost" onClick={() => startEdit(it)} title="Edit">✎</button>
                    <button className="mini ghost" onClick={() => void removeItem(it)} title="Delete">🗑️</button>
                  </div>
                )}
                {editId !== it.id && COGNITIVE_META[k].hasProgress && (
                  <div className="mind-progress">
                    {k === "skill" && (
                      <span className="mind-tier" title="Level — nudges up gently as related memories accrue; set your real mastery with – / +">
                        {skillTier(it.progress ?? 0)}
                      </span>
                    )}
                    <button className="mini" onClick={() => void bumpProgress(it, -0.1)} title="Less">–</button>
                    <span className="mind-bar">
                      <span style={{ width: `${Math.round((it.progress ?? 0) * 100)}%`, background: COGNITIVE_META[k].color }} />
                    </span>
                    <button className="mini" onClick={() => void bumpProgress(it, 0.1)} title="More">+</button>
                    <span className="mind-pct">{Math.round((it.progress ?? 0) * 100)}%</span>
                  </div>
                )}
                {editId !== it.id && k === "idea" && (
                  <button
                    className={`mind-promote ${it.degree >= 4 ? "ripe" : ""}`}
                    onClick={() => void promoteToGoal(it)}
                    title="Commit to this — turn it into a goal your memories orbit"
                  >
                    {it.degree >= 4 ? "✨ Ripe — promote to Goal" : "💡→🎯 Promote to Goal"}
                  </button>
                )}
                {editId !== it.id && k === "identity" && (
                  <div className="mind-evidence">
                    <button className="mind-ev-toggle" onClick={() => void toggleEvidence(it)}>
                      {evidenceOpen === it.id ? "▾" : "▸"} Evidence
                      {evidence[it.id] && (
                        <span className="mind-ev-counts">
                          <span className="ev-for">▲ {evidence[it.id]!.for.length}</span>
                          <span className="ev-against">▼ {evidence[it.id]!.against.length}</span>
                        </span>
                      )}
                    </button>
                    {evidenceOpen === it.id && evidence[it.id] && (
                      <div className="mind-ev-body">
                        <div className="mind-ev-bar" title="How affirmed this identity is">
                          <span style={{ width: `${Math.round(evidence[it.id]!.confidence * 100)}%` }} />
                        </div>
                        {evidence[it.id]!.for.length > 0 && (
                          <div className="mind-ev-group">
                            <span className="ev-for">▲ Affirming</span>
                            {evidence[it.id]!.for.slice(0, 8).map((n) => (
                              <button key={n.id} className="mind-ev-chip" onClick={() => onFocus(n.id)}>{n.label}</button>
                            ))}
                          </div>
                        )}
                        {evidence[it.id]!.against.length > 0 && (
                          <div className="mind-ev-group">
                            <span className="ev-against">▼ Contesting</span>
                            {evidence[it.id]!.against.slice(0, 8).map((n) => (
                              <button key={n.id} className="mind-ev-chip contra" onClick={() => onFocus(n.id)}>{n.label}</button>
                            ))}
                          </div>
                        )}
                        {evidence[it.id]!.for.length === 0 && evidence[it.id]!.against.length === 0 && (
                          <p className="empty small">No evidence yet — log memories that express (or challenge) who you are.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {editId !== it.id && (k === "mental_model" || k === "motivation") && it.degree > 0 && (
                  <div className="mind-evidence">
                    <button className="mind-ev-toggle" onClick={() => void toggleEvidence(it)}>
                      {evidenceOpen === it.id ? "▾" : "▸"} {k === "mental_model" ? "Applied to" : "Pulls on"}
                      {evidence[it.id] && <span className="mind-ev-counts"><span className="ev-for">{evidence[it.id]!.for.length}</span></span>}
                    </button>
                    {evidenceOpen === it.id && evidence[it.id] && (
                      <div className="mind-ev-body">
                        <div className="mind-ev-group">
                          {evidence[it.id]!.for.slice(0, 10).map((n) => (
                            <button key={n.id} className="mind-ev-chip" onClick={() => onFocus(n.id)}>{n.label}</button>
                          ))}
                          {evidence[it.id]!.for.length === 0 && <p className="empty small">Nothing linked yet.</p>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {editId !== it.id && k === "person_entity" && (
                  <div className="mind-evidence">
                    <button className="mind-ev-toggle" onClick={() => void toggleProfile(it)}>
                      {profileOpen === it.id ? "▾" : "▸"} Relationship
                      {profiles[it.id] && (
                        <span className="mind-ev-counts">
                          <span>{profiles[it.id]!.count} ×</span>
                          <span className={`person-tone tone-${profiles[it.id]!.tone}`}>{profiles[it.id]!.tone}</span>
                        </span>
                      )}
                    </button>
                    {profileOpen === it.id && profiles[it.id] && (
                      <div className="mind-ev-body">
                        <p className="person-meta">
                          {profiles[it.id]!.count} interaction{profiles[it.id]!.count === 1 ? "" : "s"}
                          {profiles[it.id]!.lastAt && ` · last ${new Date(profiles[it.id]!.lastAt!).toLocaleDateString()}`}
                          {" · "}<span className={`person-tone tone-${profiles[it.id]!.tone}`}>{profiles[it.id]!.tone}</span>
                        </p>
                        {profiles[it.id]!.interactions.length > 0 ? (
                          <>
                            <div className="mind-ev-group">
                              {profiles[it.id]!.interactions.slice(0, 12).map((n) => (
                                <span key={n.id} className="mind-ev-chip removable">
                                  <button className="mind-ev-chip-label" onClick={() => onFocus(n.id)}>{n.label}</button>
                                  <button className="mind-ev-chip-x" title="Not related — unlink" onClick={() => void unlinkOne(it.id, n.id)}>×</button>
                                </span>
                              ))}
                            </div>
                            <button className="mind-prune" onClick={() => void pruneLinks(it)} title="Sever every link that doesn't actually name this person">
                              🧹 Clean up links that don't name {it.label}
                            </button>
                          </>
                        ) : (
                          <p className="empty small">No interactions yet — memories that mention them (or an alias) will appear here.</p>
                        )}
                        {/* Profile photos for this person — tap a thumbnail to view full-screen. */}
                        <MemoryAttachments nodeId={it.id} label="📷 Photos" />
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
