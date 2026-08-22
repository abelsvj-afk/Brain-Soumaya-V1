import { useEffect, useState } from "react";
import type { Journey } from "@brain/shared";
import { getJourneys, createJourney, patchJourney, deleteJourney } from "../api/journeys.js";

/**
 * Journeys (Vision 2.0) — the highest-level organizer: a life chapter everything can belong to
 * (Become an RN, Recover Financially, Buy My First Home…). This panel is the home for creating +
 * tending them; linking objects to a journey happens from those objects (a memory's inspector, a
 * transaction, etc.). Mobile-first. See docs/VISION_2_JOURNEYS.md.
 */

const SUGGESTED = [
  { title: "Recover Financially", icon: "💵" },
  { title: "Get Healthy", icon: "💪" },
  { title: "Build My Business", icon: "🚀" },
  { title: "Learn Something New", icon: "📚" },
];

export function JourneysPanel() {
  const [journeys, setJourneys] = useState<Journey[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("🧭");

  const refresh = async () => setJourneys(await getJourneys());
  useEffect(() => { void refresh(); }, []);

  const add = async (t: string, ic: string) => {
    if (!t.trim()) return;
    await createJourney({ title: t.trim(), icon: ic });
    setTitle(""); setAdding(false);
    await refresh();
  };

  if (!journeys) return <div className="jn-panel"><p className="jn-empty">Loading your journeys…</p></div>;

  const active = journeys.filter((j) => j.status !== "done");
  const done = journeys.filter((j) => j.status === "done");

  return (
    <div className="jn-panel">
      <div className="jn-intro">
        A <strong>Journey</strong> is a meaningful chapter of your life. Memories, money, tasks and goals
        all connect through it — so instead of "where do I save this?", the question becomes
        "<em>what Journey does this move forward?</em>"
      </div>

      {journeys.length === 0 && (
        <div className="jn-suggest">
          <div className="jn-empty">Start with one that fits your life right now:</div>
          <div className="jn-suggest-row">
            {SUGGESTED.map((s) => (
              <button key={s.title} className="jn-chip" onClick={() => add(s.title, s.icon)}>{s.icon} {s.title}</button>
            ))}
          </div>
        </div>
      )}

      {active.map((j) => <JourneyCard key={j.id} j={j} onChanged={refresh} />)}

      {adding ? (
        <div className="jn-form">
          <div className="jn-form-row">
            <input className="jn-icon-in" value={icon} onChange={(e) => setIcon(e.target.value.slice(0, 2))} aria-label="Icon" />
            <input className="jn-title-in" placeholder="Name your journey (e.g. Become an RN)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Journey title" />
          </div>
          <div className="jn-form-actions">
            <button className="jn-primary" onClick={() => add(title, icon)}>Create</button>
            <button className="jn-secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="jn-primary jn-add" onClick={() => setAdding(true)}>＋ New Journey</button>
      )}

      {done.length > 0 && (
        <details className="jn-done">
          <summary>Completed ({done.length})</summary>
          {done.map((j) => <JourneyCard key={j.id} j={j} onChanged={refresh} />)}
        </details>
      )}
    </div>
  );
}

function JourneyCard({ j, onChanged }: { j: Journey; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const pct = Math.round((j.progress ?? 0) * 100);

  const setProgress = async (p: number) => { await patchJourney(j.id, { progress: Math.max(0, Math.min(1, p)) }); onChanged(); };
  const setStatus = async (status: "active" | "paused" | "done") => { await patchJourney(j.id, { status }); onChanged(); };

  return (
    <div className={`jn-card ${j.status}`}>
      <button className="jn-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="jn-icon">{j.icon ?? "🧭"}</span>
        <span className="jn-name">{j.title}</span>
        <span className="jn-links">{j.linkCount ?? 0} linked</span>
      </button>
      <div className="jn-bar" aria-label={`${pct}% progress`}><div className="jn-bar-fill" style={{ width: `${pct}%` }} /></div>
      {open && (
        <div className="jn-detail">
          {j.description && <p className="jn-desc">{j.description}</p>}
          <div className="jn-progress-row">
            <span>Progress</span>
            <input type="range" min={0} max={100} value={pct} onChange={(e) => void setProgress(Number(e.target.value) / 100)} aria-label="Progress" />
            <strong>{pct}%</strong>
          </div>
          <div className="jn-detail-actions">
            {j.status !== "done" ? (
              <button className="jn-secondary" onClick={() => void setStatus("done")}>Mark complete</button>
            ) : (
              <button className="jn-secondary" onClick={() => void setStatus("active")}>Reopen</button>
            )}
            {j.status === "active" ? (
              <button className="jn-secondary" onClick={() => void setStatus("paused")}>Pause</button>
            ) : j.status === "paused" ? (
              <button className="jn-secondary" onClick={() => void setStatus("active")}>Resume</button>
            ) : null}
            <button className="jn-danger" onClick={async () => { if (confirm(`Delete "${j.title}"? Its links are removed (the memories/items stay).`)) { await deleteJourney(j.id); onChanged(); } }}>Delete</button>
          </div>
          <p className="jn-hint">Link memories, money, and tasks to this journey from their own cards — this is where the chapter comes together.</p>
        </div>
      )}
    </div>
  );
}
