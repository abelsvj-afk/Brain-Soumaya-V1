import { useEffect, useRef, useState } from "react";
import { extractFileText } from "../lib/extractFileText.js";
import {
  getPersonaStrict,
  refreshPersonaStrict,
  getInstructionsStrict,
  createInstruction,
  updateInstruction,
  deleteInstruction,
  getDocumentsStrict,
  uploadDocument,
  renameDocument,
  deleteDocument,
  getSoulStrict,
  setSoul,
  getGroundedInsightStrict,
  setGroundedInsight,
  type InstructionProfile,
  type KnowledgeDoc,
} from "../api/client.js";

/**
 * The three self-contained Companion sections (About Me, Instructions, Knowledge),
 * extracted from CompanionPanel.tsx (Post-MVP D4). Each owns its state + data; the
 * panel just composes them. Behaviour unchanged.
 */

/** Preset role names — pick one or type your own. */
const ROLE_PRESETS = [
  "Business Advisor",
  "Therapist",
  "Life Coach",
  "Creative Partner",
  "Strategic Council",
  "Fitness Coach",
  "Study Partner",
  "Mediator",
  "Career Coach",
  "Devil's Advocate",
];

/**
 * Ready-made "superpowers" — full instruction bodies that show what a rich role
 * can actually DO, so people grasp that this turns her into a genuinely
 * different mind on demand (not just a tone tweak). One tap fills the new-role
 * form. She adopts the fitting one when the topic calls for it.
 */
const ROLE_TEMPLATES: { name: string; blurb: string; body: string }[] = [
  {
    name: "IQ Examiner",
    blurb: "She literally runs you a real, scored aptitude test.",
    body: "You are a rigorous cognitive examiner. When I ask, administer a proper IQ-style test IN CHAT: present one question at a time across verbal, numerical, spatial, logical and pattern-recognition domains, escalating in difficulty. Wait for my answer before revealing whether it's right or moving on. Track my score, time pressure where relevant, and at the end give a banded estimate with a breakdown by domain and where I was strongest/weakest. Never hand me all the questions at once; make it feel like a real sitting.",
  },
  {
    name: "Socratic Tutor",
    blurb: "Never gives the answer — teaches by asking.",
    body: "You are a Socratic tutor. Never hand me the answer directly. Draw it out of me with one sharp question at a time, building on what I say, exposing gaps in my reasoning gently, and only confirming once I've reached it myself. Adapt the difficulty to how I'm doing.",
  },
  {
    name: "Structured Interviewer",
    blurb: "Runs a real mock interview and grades you.",
    body: "You are an expert interviewer. Run a realistic mock interview for the role I name — one question at a time (behavioral + technical), press for specifics with follow-ups, and don't let vague answers slide. At the end, score me on structure, substance and communication with concrete feedback and a stronger sample answer for the weakest one.",
  },
  {
    name: "Devil's Advocate",
    blurb: "Argues the other side, hard, to stress-test you.",
    body: "You are a sharp devil's advocate. Whatever I'm leaning toward, argue the strongest honest case AGAINST it — surface the risks, the counter-evidence, the failure modes and the thing I'm not letting myself see. Be respectful but do not soften it into agreement. End by naming the single strongest objection I have to answer.",
  },
  {
    name: "Decision Framework",
    blurb: "Walks you through a real decision, structured.",
    body: "You are a decision strategist. When I'm weighing something, walk me through it structurally: clarify the actual decision and my real constraints, surface the options (including ones I haven't named), weigh each against what I've told you matters to me, name the key uncertainty, and end with a clear recommendation and the one thing that would change it. Use MY memories and values, not generic advice.",
  },
];

export function AboutMe() {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  // IM-110: truthful load state — a failed fetch must not pose as "she's
  // still getting to know you" (the fail-soft getPersona made a dead server,
  // a slow load, and a genuinely new user indistinguishable).
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [refreshError, setRefreshError] = useState(false);
  const load = async () => {
    setLoadState("loading");
    try {
      setBody(await getPersonaStrict());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const refresh = async () => {
    setBusy(true);
    setRefreshError(false);
    try {
      setBody(await refreshPersonaStrict());
      setLoadState("ready");
    } catch {
      setRefreshError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="companion-section">
      <h3>🪪 About Me</h3>
      <p className="companion-hint">
        What Soumaya has learned about you from your galaxy. She keeps this current on her own
        and stays aware of it when she talks to you — it isn't edited by hand.
      </p>
      {loadState === "error" ? (
        <div className="companion-error" role="alert">
          <span>⚠️ Couldn't load what she's learned about you — this isn't an empty profile, it's a failed connection.</span>
          <button className="mini" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="companion-persona">
          {loadState === "loading"
            ? "Loading what she's learned…"
            : body
              ? body
              : "Soumaya is still getting to know you — add a few more memories."}
        </div>
      )}
      {refreshError && (
        <p className="companion-hint" role="alert" style={{ margin: "6px 0 0" }}>
          ⚠️ Couldn't update just now — what's shown above is the last version she had.
        </p>
      )}
      <div className="row">
        <button onClick={refresh} disabled={busy || loadState !== "ready"} title="Re-derive from your latest memories">
          {busy ? "Updating…" : "↻ Update now"}
        </button>
      </div>
    </section>
  );
}

export function Soul() {
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = async () => {
    setLoadError(false);
    try {
      // IM-110: strict load — a failed fetch used to leave an EMPTY editor
      // that looked exactly like "no custom soul set", one Save away from
      // wiping the real one.
      setBody(await getSoulStrict());
      setLoaded(true);
    } catch {
      setLoadError(true);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async () => {
    setBusy(true);
    setMsg("");
    const ok = await setSoul(body);
    setBusy(false);
    setMsg(ok ? "Saved — her soul is updated." : "Couldn't save.");
  };
  return (
    <section className="companion-section">
      <h4>✨ Soumaya's soul</h4>
      <p className="companion-hint">
        Her deeper character — voice, values, the way she carries herself. This refines who she is to
        YOU (it never overrides her safety rules). Leave it empty to use her default soul.
      </p>
      {loadError && (
        <div className="companion-error" role="alert">
          <span>⚠️ Couldn't load her current soul — editing is paused so a failed load can't overwrite it.</span>
          <button className="mini" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      <textarea
        className="companion-textarea"
        rows={6}
        value={body}
        disabled={!loaded}
        onChange={(e) => setBody(e.target.value)}
        placeholder="e.g. Warm but never saccharine. Speaks plainly, notices the unsaid thing, and holds hope without denying the hard parts…"
      />
      <div className="row">
        <button onClick={() => void save()} disabled={busy || !loaded}>
          {busy ? "Saving…" : "Save soul"}
        </button>
        {msg && <span className="companion-hint" style={{ margin: 0 }}>{msg}</span>}
      </div>
    </section>
  );
}

export function GroundedInsight() {
  const [on, setOn] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const load = async () => {
    setLoadError(false);
    try {
      // IM-110: strict load — the fail-soft default (ON) used to render even
      // when the fetch died, presenting a guessed state as her real setting.
      setOn(await getGroundedInsightStrict());
      setLoaded(true);
    } catch {
      setLoadError(true);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    const ok = await setGroundedInsight(next);
    if (!ok) setOn(!next); // revert on failure
  };
  return (
    <section className="companion-section">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1 }}>
          <h4 style={{ margin: "0 0 4px" }}>🔬 Grounded insight</h4>
          <p className="companion-hint" style={{ margin: 0 }}>
            When ON, anything she tells you about <em>yourself</em> stays specific and checkable —
            tied to real memories, said so you can confirm or correct it ("does that land?"), never
            vague horoscope-style flattery. Turn OFF for a looser, warmer read.
          </p>
        </div>
        <button
          className={`switch ${on ? "on" : ""}`}
          onClick={() => void toggle()}
          aria-pressed={on}
          disabled={!loaded}
          aria-label="Grounded insight"
          style={{ flex: "0 0 auto", marginLeft: 12 }}
        >
          <span className="knob" />
        </button>
      </div>
      {loadError && (
        <div className="companion-error" role="alert">
          <span>⚠️ Couldn't check this setting — the switch above isn't showing her real state.</span>
          <button className="mini" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
    </section>
  );
}

export function Instructions() {
  const [list, setList] = useState<InstructionProfile[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"always" | "auto">("always");
  const [priority, setPriority] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false); // the "new profile" form is collapsed by default
  const [expandedId, setExpandedId] = useState<number | null>(null); // which item shows its full body
  // IM-110: truthful load state — "No profiles yet" may only render after a
  // SUCCESSFUL empty load, never while loading or after a failure.
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  // Inline edit state.
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editMode, setEditMode] = useState<"always" | "auto">("always");
  const [editPriority, setEditPriority] = useState(0);

  const refresh = async () => {
    try {
      setList(await getInstructionsStrict());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const add = async () => {
    if (!name.trim() || !body.trim()) {
      setMsg("Add a name and the instructions before saving.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      await createInstruction({ name: name.trim(), body: body.trim(), mode, priority });
      setName("");
      setBody("");
      setMode("always");
      setPriority(0);
      setAdding(false);
      await refresh();
      setMsg("Added.");
      setTimeout(() => setMsg(""), 1500);
    } catch (err) {
      setMsg((err as Error).message || "Couldn't add that profile.");
    } finally {
      setBusy(false);
    }
  };
  const beginEdit = (p: InstructionProfile) => {
    setEditId(p.id);
    setEditName(p.name);
    setEditBody(p.body);
    setEditMode(p.mode === "auto" ? "auto" : "always");
    setEditPriority(p.priority ?? 0);
  };
  const saveEdit = async () => {
    if (editId == null) return;
    try {
      await updateInstruction(editId, { name: editName.trim(), body: editBody.trim(), mode: editMode, priority: editPriority });
      setEditId(null);
      void refresh();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const toggle = (p: InstructionProfile) =>
    updateInstruction(p.id, { enabled: !p.enabled }).then(() => void refresh()).catch(() => setMsg("Couldn't update that — try again."));
  const remove = (p: InstructionProfile) =>
    deleteInstruction(p.id).then(() => void refresh()).catch(() => setMsg("Couldn't remove that — try again."));

  const useTemplate = (t: { name: string; body: string }) => {
    setName(t.name);
    setBody(t.body);
    setMode("auto"); // she brings it in when the topic fits — no need to force it on
    setAdding(true);
    setExpandedId(null);
  };

  return (
    <section className="companion-section">
      <h3>🎭 Custom Instructions</h3>
      <p className="companion-hint">
        Give her a role — a coach, an examiner, a strategist — and she becomes it when the
        topic fits. Not a tone tweak: a whole different mind on demand. <b>Always</b> = every
        message; <b>Auto</b> = she brings it in when relevant (recommended). Tap a role to expand.
      </p>

      {/* Showcase — one tap loads a full, capability-demonstrating role. */}
      <div className="role-showcase">
        <div className="role-showcase-h">✨ What she can become — tap to load one:</div>
        <div className="role-showcase-cards">
          {ROLE_TEMPLATES.map((t) => (
            <button key={t.name} className="role-template" onClick={() => useTemplate(t)} title={t.body}>
              <span className="role-template-name">{t.name}</span>
              <span className="role-template-blurb">{t.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <datalist id="role-presets">
        {ROLE_PRESETS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <ul className="companion-list">
        {list.map((p) =>
          editId === p.id ? (
            <li key={p.id} className="companion-item">
              <input
                className="tag-input wide"
                list="role-presets"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
              <textarea
                className="companion-textarea"
                rows={5}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
              />
              <div className="row">
                <select value={editMode} onChange={(e) => setEditMode(e.target.value as "always" | "auto")}>
                  <option value="always">always on</option>
                  <option value="auto">auto (route by topic)</option>
                </select>
                <label className="companion-priority" title="When several roles fit, higher priority shapes her reply first (0–100)">
                  Priority
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={editPriority}
                    onChange={(e) => setEditPriority(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  />
                </label>
                <button onClick={saveEdit}>Save</button>
                <button className="mini" onClick={() => setEditId(null)}>
                  Cancel
                </button>
              </div>
            </li>
          ) : (
            <li key={p.id} className={`companion-item ${expandedId === p.id ? "open" : ""}`}>
              <div className="companion-item-head">
                <button
                  className="companion-expand"
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  aria-label={expandedId === p.id ? "Collapse" : "Expand"}
                  title={expandedId === p.id ? "Collapse" : "Expand"}
                >
                  {expandedId === p.id ? "▾" : "▸"}
                </button>
                <button
                  className={`tag-chip ${p.enabled ? "on" : ""}`}
                  onClick={() => toggle(p)}
                  title={p.enabled ? "Enabled — tap to disable" : "Disabled — tap to enable"}
                >
                  {p.enabled ? "●" : "○"} {p.name}
                </button>
                <span className="companion-mode-tag" title={`${p.mode} mode`}>{p.mode}</span>
                {/* IM-109: priority was accepted by the API but invisible —
                    it's what orders her roles when several fit a message. */}
                <span className="companion-mode-tag" title="Priority — when several roles fit, higher applies first">
                  ⇡ {p.priority ?? 0}
                </span>
                <button className="companion-edit" onClick={() => beginEdit(p)} aria-label="Edit">
                  ✎
                </button>
                <button className="companion-del" onClick={() => remove(p)} aria-label="Delete">
                  ×
                </button>
              </div>
              <p className={`companion-body ${expandedId === p.id ? "" : "clamp"}`} onClick={() => setExpandedId(p.id)}>
                {p.body}
              </p>
            </li>
          ),
        )}
        {loadState === "loading" && <li className="empty small">Loading your roles…</li>}
        {loadState === "error" && (
          <li className="companion-error" role="alert">
            <span>⚠️ Couldn't load your roles — this isn't an empty list, it's a failed connection.</span>
            <button className="mini" onClick={() => void refresh()}>
              Retry
            </button>
          </li>
        )}
        {loadState === "ready" && list.length === 0 && <li className="empty small">No profiles yet — add one below.</li>}
      </ul>

      {adding ? (
        <div className="companion-new">
          <input
            className="tag-input wide"
            list="role-presets"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Role name (pick a preset or type your own)"
          />
          <textarea
            className="companion-textarea"
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="How should she behave in this role? Frameworks, tone, decision rules, an entire operating manual — as much as you want…"
          />
          <div className="row">
            <select value={mode} onChange={(e) => setMode(e.target.value as "always" | "auto")}>
              <option value="always">always on</option>
              <option value="auto">auto (route by topic)</option>
            </select>
            <label className="companion-priority" title="When several roles fit, higher priority shapes her reply first (0–100)">
              Priority
              <input
                type="number"
                min={0}
                max={100}
                value={priority}
                onChange={(e) => setPriority(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              />
            </label>
            <button onClick={add} disabled={busy}>
              {busy ? "Adding…" : "Save profile"}
            </button>
            <button className="mini" onClick={() => { setAdding(false); setMsg(""); }}>
              Cancel
            </button>
            <span className="msg">{msg}</span>
          </div>
        </div>
      ) : (
        <button className="companion-add-btn" onClick={() => setAdding(true)}>
          + New role
        </button>
      )}
    </section>
  );
}

export function Knowledge() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  // IM-110: truthful load state — "No documents yet" only after a successful
  // empty load.
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const refresh = async () => {
    try {
      setDocs(await getDocumentsStrict());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const onFile = async (file: File) => {
    setMsg("Reading file…");
    try {
      const { text: extracted, name: suggested } = await extractFileText(file);
      setText(extracted);
      setName(suggested); // populate the name from the chosen file (extension stripped)
      setMsg(`Loaded "${file.name}" (${extracted.length.toLocaleString()} chars). Review + name it, then Add.`);
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const upload = async () => {
    if (!text.trim() || !name.trim()) {
      setMsg("Pick a file (or paste text) and give it a name.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const doc = await uploadDocument(name.trim(), text);
      setMsg(`Added "${doc.name}" (${doc.chunks ?? 0} chunks)`);
      setName("");
      setText("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const saveRename = async (d: KnowledgeDoc) => {
    const next = renameVal.trim();
    if (next && next !== d.name) {
      await renameDocument(d.id, next);
      await refresh();
    }
    setRenameId(null);
  };
  const remove = (d: KnowledgeDoc) => deleteDocument(d.id).then(() => void refresh());

  return (
    <section className="companion-section">
      <h3>📚 Knowledge</h3>
      <p className="companion-hint">
        Reference docs she draws from when answering (frameworks, notes, research). Text, Markdown,
        PDF &amp; Word (.docx) — or paste text directly.
      </p>
      <ul className="companion-list">
        {docs.map((d) => (
          <li key={d.id} className="companion-item">
            {renameId === d.id ? (
              <div className="companion-item-head">
                <input
                  className="tag-input wide"
                  value={renameVal}
                  autoFocus
                  onChange={(e) => setRenameVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveRename(d)}
                />
                <button className="mini" onClick={() => saveRename(d)}>Save</button>
                <button className="mini ghost" onClick={() => setRenameId(null)}>Cancel</button>
              </div>
            ) : (
              <div className="companion-item-head">
                <span className="companion-doc-name">📄 {d.name}</span>
                {/* IM-109: charCount/mime/createdAt were fetched all along
                    but never shown — surface the doc's real metadata. */}
                <span className="companion-doc-meta">
                  {d.chunks ?? 0} chunks · {(d.charCount ?? 0).toLocaleString()} chars
                  {d.mime ? ` · ${d.mime}` : ""}
                  {d.createdAt
                    ? ` · added ${new Date(d.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`
                    : ""}
                </span>
                <button
                  className="companion-edit"
                  onClick={() => { setRenameId(d.id); setRenameVal(d.name); }}
                  aria-label="Rename"
                >
                  ✎
                </button>
                <button className="companion-del" onClick={() => remove(d)} aria-label="Delete">
                  ×
                </button>
              </div>
            )}
          </li>
        ))}
        {loadState === "loading" && <li className="empty small">Loading your documents…</li>}
        {loadState === "error" && (
          <li className="companion-error" role="alert">
            <span>⚠️ Couldn't load your documents — this isn't an empty library, it's a failed connection.</span>
            <button className="mini" onClick={() => void refresh()}>
              Retry
            </button>
          </li>
        )}
        {loadState === "ready" && docs.length === 0 && <li className="empty small">No documents yet.</li>}
      </ul>
      <div className="companion-new">
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.markdown,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
        />
        <input
          className="tag-input wide"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Document name"
        />
        <textarea
          className="companion-textarea"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="…or paste text directly"
        />
        <div className="row">
          <button onClick={upload} disabled={busy}>
            {busy ? "Embedding…" : "Add document"}
          </button>
          <span className="msg">{msg}</span>
        </div>
      </div>
    </section>
  );
}

