import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode } from "@brain/shared";
import { getMoneySky } from "../api/finance.js";
import { getJourneys } from "../api/journeys.js";
import { createLens } from "../api/lenses.js";
import { getSpaceId } from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { LensChips } from "./LensChips.js";

/**
 * Galaxy Views (mobile performance pivot) — view ONE category of the galaxy at a time instead
 * of rendering every body at once. Reuses the Smart-Lens isolate machinery (isolateSet), which
 * stops rendering the other bodies — the single biggest win on a cheap phone (you feel it when a
 * lens/isolate is active). Collapsible so it adds no chrome until you want it.
 *
 * Views vs. Lens: two legitimate, complementary tools, not overlap. Views is fixed and instant —
 * zero setup, built originally to solve a real performance problem (rendering every name/label
 * live at once bogged down weaker phones; showing one category at a time fixed it) — reach for it
 * for a quick glance or to lighten the scene. Lens is saved, custom, and LIVE — build your own
 * criteria once and it keeps matching new memories forever. "Save as Lens" below is the bridge
 * between them: the same relationship "recent files" has to "saved searches" elsewhere.
 */

interface ViewDef { key: string; label: string; icon: string; pred: (n: GraphNode) => boolean; kinds: string[] }

const VIEWS: ViewDef[] = [
  { key: "people", label: "People", icon: "👤", pred: (n) => n.type === "person", kinds: ["person"] },
  { key: "projects", label: "Projects", icon: "🚀", pred: (n) => n.type === "project" || n.type === "company", kinds: ["project", "company"] },
  { key: "goals", label: "Goals", icon: "🎯", pred: (n) => n.kind === "goal", kinds: ["goal"] },
  { key: "ideas", label: "Ideas", icon: "💡", pred: (n) => n.kind === "idea", kinds: ["idea"] },
  { key: "beliefs", label: "Beliefs", icon: "🌟", pred: (n) => n.kind === "belief", kinds: ["belief"] },
  { key: "knowledge", label: "Knowledge", icon: "📚", pred: (n) => n.type === "knowledge" || n.type === "concept", kinds: ["knowledge", "concept"] },
  { key: "meetings", label: "Meetings", icon: "🗓️", pred: (n) => n.type === "meeting", kinds: ["meeting"] },
  { key: "notes", label: "Notes", icon: "📝", pred: (n) => n.type === "daily", kinds: ["daily"] },
];

export function GalaxyViews({
  nodes,
  activeView,
  onOpen,
  onLayer,
  onExit,
  hidden,
}: {
  nodes: GraphNode[];
  /** The label of the active view/lens (so we can highlight + toggle). */
  activeView: string | null;
  onOpen: (ids: number[], name: string) => void;
  /** View only an overlay layer that physically populates the galaxy (money-sky / journeys). */
  onLayer?: (layer: "money" | "journeys", name: string) => void;
  onExit: () => void;
  hidden?: boolean;
}) {
  // Phase AC.1 (docs/specs/soumaya-connective-tissue-onboarding.md): the audit found this
  // collapsed-by-default with no first-run cue, despite the underlying Views/Lens split
  // already being resolved in-code (see the file header comment). Rather than adding a new
  // onboarding surface, this reuses the exact per-space localStorage pattern App.tsx already
  // uses for the one-time Welcome/Legend reveals — opened once, automatically, the very first
  // time a space's galaxy ever renders this control, then behaves exactly as before (a plain
  // toggle the user controls) for every session after.
  const [open, setOpen] = useState(() => {
    try {
      const key = `brain.viewsSeen.${getSpaceId() ?? "default"}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "1");
        return true;
      }
    } catch {
      /* storage unavailable — falls back to the prior collapsed-by-default behavior */
    }
    return false;
  });
  const [moneyCount, setMoneyCount] = useState(0);
  const [journeyCount, setJourneyCount] = useState(0);
  const [savingLens, setSavingLens] = useState(false);

  // These are separate render layers (not graph nodes), so we count them directly.
  useEffect(() => {
    if (!open) return;
    getMoneySky().then((s) => setMoneyCount(s?.length ?? 0)).catch(() => {});
    getJourneys().then((j) => setJourneyCount((j ?? []).filter((x) => x.status !== "done").length)).catch(() => {});
  }, [open]);

  // Which categories actually have bodies, with their ids (computed from the loaded graph).
  const cats = useMemo(() => {
    return VIEWS.map((v) => ({ ...v, ids: nodes.filter((n) => n.kind !== "action" && v.pred(n)).map((n) => n.id) }))
      .filter((v) => v.ids.length > 0);
  }, [nodes]);

  // Keep an active CATEGORY view in sync with the galaxy: when you dump a new memory (or
  // Soumaya places one) that matches the active category, the graph updates → recompute this
  // category's ids and re-isolate so the new body populates INSIDE the current view.
  const lastSig = useRef<string>("");
  useEffect(() => {
    if (!activeView) { lastSig.current = ""; return; }
    const cat = cats.find((c) => `${c.icon} ${c.label}` === activeView);
    if (!cat) { lastSig.current = ""; return; } // active view is a lens/layer, not our category
    const sig = cat.ids.join(",");
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    onOpen(cat.ids, activeView);
  }, [cats, activeView, onOpen]);

  if (hidden || (cats.length === 0 && nodes.length === 0)) return null;

  const tap = (v: (typeof cats)[number]) => {
    const name = `${v.icon} ${v.label}`;
    if (activeView === name) { onExit(); return; }
    if (v.ids.length > 0) onOpen(v.ids, name);
  };

  // Only a category View (not the money/journeys overlay layers) maps to a LensQuery —
  // those are separate render layers, not a `nodes` filter.
  const activeCat = cats.find((c) => `${c.icon} ${c.label}` === activeView);
  const saveAsLens = async () => {
    if (!activeCat || savingLens) return;
    setSavingLens(true);
    try {
      const lens = await createLens(activeCat.label, { kinds: activeCat.kinds }, false);
      pushToast(
        lens ? `⧉ Saved "${activeCat.label}" as a Lens — it'll keep matching new memories.` : "Couldn't save that Lens — try again.",
        lens ? "⧉" : "⚠️",
        4500,
      );
    } finally {
      setSavingLens(false);
    }
  };

  return (
    <div className="gv-wrap">
      {/* Package B (finding #6): the toggle is a 46px CIRCLE in the camera
          column (directly below the 🎯), like every neighbour — the old
          oval pill was the widest element in the column and reached under
          the beacon box. The word "Views" stays as visually-hidden text so
          the control keeps its name for assistive tech and tests. */}
      <button className={`gv-toggle ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}
        aria-label="Galaxy views"
        title="Views — view one category at a time (lighter on your phone)">
        <span aria-hidden="true">🌌</span>
        <span className="gv-toggle-text">Views</span>
        <span className="gv-toggle-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="gv-sheet">
        <div className="gv-chips" role="toolbar" aria-label="Galaxy category views">
          {cats.map((v) => {
            const name = `${v.icon} ${v.label}`;
            const on = activeView === name;
            return (
              <button key={v.key} className={`gv-chip ${on ? "on" : ""}`} onClick={() => tap(v)} aria-pressed={on}
                title={on ? `Show everything again` : `View only ${v.label} (renders fewer bodies)`}>
                <span>{v.icon} {v.label}</span>
                <span className="gv-count">{on ? "✕" : v.ids.length}</span>
              </button>
            );
          })}
          {/* Overlay layers that physically populate the galaxy get their own view too. */}
          {onLayer && moneyCount > 0 && (() => {
            const name = "💵 Money sky"; const on = activeView === name;
            return <button className={`gv-chip ${on ? "on" : ""}`} onClick={() => (on ? onExit() : onLayer("money", name))} aria-pressed={on} title="View only your money stars">
              <span>{name}</span><span className="gv-count">{on ? "✕" : moneyCount}</span></button>;
          })()}
          {onLayer && journeyCount > 0 && (() => {
            const name = "🧭 Journeys"; const on = activeView === name;
            return <button className={`gv-chip ${on ? "on" : ""}`} onClick={() => (on ? onExit() : onLayer("journeys", name))} aria-pressed={on} title="View only your journey hubs">
              <span>🧭 Journeys</span><span className="gv-count">{on ? "✕" : journeyCount}</span></button>;
          })()}
          {activeCat && (
            <button
              className="gv-chip gv-save-lens"
              onClick={() => void saveAsLens()}
              disabled={savingLens}
              title="Save this View as a Lens — a saved, self-updating filter you can reopen anytime"
            >
              💾 {savingLens ? "Saving…" : "Save as Lens"}
            </button>
          )}
          {activeView && <button className="gv-chip gv-all" onClick={onExit}>★ Show all</button>}
        </div>
      {/* Pinned Smart Lenses live in this SAME dropdown now, not their own floating overlay
          (see .lens-list's CSS comment) — Views and Lens are already "two legitimate,
          complementary tools" per this file's own header comment, so this is a real,
          coherent grouping rather than an arbitrary place to hide it. They render
          inside the same .gv-sheet as the category chips (Package B). */}
      <LensChips activeLens={activeView} onOpen={onOpen} onExit={onExit} hidden={!open} />
        </div>
      )}
    </div>
  );
}
