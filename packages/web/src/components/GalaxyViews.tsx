import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphNode } from "@brain/shared";
import { getMoneySky } from "../api/finance.js";
import { getJourneys } from "../api/journeys.js";
import { createLens } from "../api/lenses.js";
import { getCategoryCounts, getCategoryIds, type CategoryKey } from "../api/views.js";
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

import { Icon, type IconName } from "./icons/Icon.js";
interface ViewDef { key: string; label: string; icon: string; /** what is DRAWN (the emoji stays as the lens's identity string) */ svg: IconName; pred: (n: GraphNode) => boolean; kinds: string[] }

const VIEWS: ViewDef[] = [
  { key: "people", label: "People", icon: "👤", svg: "people", pred: (n) => n.type === "person", kinds: ["person"] },
  { key: "projects", label: "Projects", icon: "🚀", svg: "rocket", pred: (n) => n.type === "project" || n.type === "company", kinds: ["project", "company"] },
  { key: "goals", label: "Goals", icon: "🎯", svg: "focus", pred: (n) => n.kind === "goal", kinds: ["goal"] },
  { key: "ideas", label: "Ideas", icon: "💡", svg: "insights", pred: (n) => n.kind === "idea", kinds: ["idea"] },
  { key: "beliefs", label: "Beliefs", icon: "🌟", svg: "sun", pred: (n) => n.kind === "belief", kinds: ["belief"] },
  { key: "knowledge", label: "Knowledge", icon: "📚", svg: "browse", pred: (n) => n.type === "knowledge" || n.type === "concept", kinds: ["knowledge", "concept"] },
  { key: "meetings", label: "Meetings", icon: "🗓️", svg: "timeline", pred: (n) => n.type === "meeting", kinds: ["meeting"] },
  { key: "notes", label: "Notes", icon: "📝", svg: "notes", pred: (n) => n.type === "daily", kinds: ["daily"] },
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
  /** Isolate the galaxy to these ids under this view/lens name. `total` is the
   *  view's true match count (Batch H, REG-207/208) — the banner states it. */
  onOpen: (ids: number[], name: string, total?: number) => void;
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
  // Batch H (REG-207 / CN-08): full-set member counts per category, from
  // GET /api/graph/categories — the chips used to count from the loaded
  // payload, so a category whose members all sat off-payload vanished. Null
  // until the fetch lands (or when it fails — then the chips fall back to the
  // payload-only counts they always had).
  const [catCounts, setCatCounts] = useState<Record<string, number> | null>(null);
  // Batch I (REG-067 / GH-05): a failed layer load is a visible state,
  // not a silently absent chip. Which layers failed to load — null when
  // everything loaded (or nothing has been attempted yet).
  const [layerError, setLayerError] = useState<"money" | "journeys" | "both" | null>(null);

  // These are separate render layers (not graph nodes), so we count them directly.
  const loadLayers = useCallback(async () => {
    const [money, journeys] = await Promise.allSettled([getMoneySky(), getJourneys()]);
    if (money.status === "fulfilled") {
      setMoneyCount(money.value?.length ?? 0);
    }
    if (journeys.status === "fulfilled") {
      setJourneyCount((journeys.value ?? []).filter((x) => x.status !== "done").length);
    }
    setLayerError(
      money.status === "rejected" && journeys.status === "rejected"
        ? "both"
        : money.status === "rejected"
          ? "money"
          : journeys.status === "rejected"
            ? "journeys"
            : null,
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadLayers();
    getCategoryCounts().then((c) => { if (c) setCatCounts(c); }).catch(() => {});
  }, [open, loadLayers]);

  // Which categories actually have bodies, with their ids. `ids` is the
  // loaded payload's intersection; `total` is the full-set count — a category
  // renders whenever its TOTAL is > 0, so members sitting off-payload can no
  // longer make the whole category disappear from Views. `shown` is the
  // count the chip displays: the full-set total, but never less than the
  // bodies actually in hand (a stale-low count must not hide loaded members).
  const cats = useMemo(() => {
    return VIEWS.map((v) => {
      const ids = nodes.filter((n) => n.kind !== "action" && v.pred(n)).map((n) => n.id);
      const total = catCounts?.[v.key] ?? null;
      return { ...v, ids, total, shown: Math.max(total ?? 0, ids.length) };
    }).filter((v) => v.shown > 0);
  }, [nodes, catCounts]);

  // Keep an active CATEGORY view in sync with the galaxy: when you dump a new memory (or
  // Soumaya places one) that matches the active category, the graph updates → recompute this
  // category's ids and re-isolate so the new body populates INSIDE the current view.
  const lastSig = useRef<string>("");
  useEffect(() => {
    if (!activeView) { lastSig.current = ""; return; }
    const cat = cats.find((c) => `${c.icon} ${c.label}` === activeView);
    if (!cat) { lastSig.current = ""; return; } // active view is a lens/layer, not our category
    // Batch H (REG-207): never re-isolate a partial category — re-isolating
    // to the payload's intersection would shrink an open full view back to
    // its subset the moment a new memory lands.
    if (cat.total != null && cat.total > cat.ids.length) { lastSig.current = ""; return; }
    const sig = cat.ids.join(",");
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    onOpen(cat.ids, activeView);
  }, [cats, activeView, onOpen]);

  if (hidden || (cats.length === 0 && nodes.length === 0)) return null;

  const tap = async (v: (typeof cats)[number]) => {
    const name = `${v.icon} ${v.label}`;
    if (activeView === name) { onExit(); return; }
    // Batch H (REG-207): when members sit off-payload, fetch the full id list
    // first — isolating to the payload's intersection would silently show a
    // subset as the whole category.
    if (v.total != null && v.total > v.ids.length) {
      const all = await getCategoryIds(v.key as CategoryKey);
      if (!all) {
        pushToast(`Couldn't load all ${v.label} — try again.`, "⚠️", 3500);
        return;
      }
      onOpen(all, name, v.total);
      return;
    }
    if (v.ids.length > 0) onOpen(v.ids, name, v.total ?? v.ids.length);
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
          the beacon box. The word "Views" was visually-hidden text through
          Package B; HUD round 3 un-hides it as the circle's in-button
          caption (.fab-cap), like every other HUD button's name. */}
      <button className={`gv-toggle ${open ? "open" : ""}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}
        aria-label="Galaxy views"
        title="Views — view one category at a time (lighter on your phone)">
        <Icon name="views" />
        <span className="gv-toggle-text fab-cap">Views</span>
        <span className="gv-toggle-chev" aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="gv-sheet">
        <div className="gv-chips" role="toolbar" aria-label="Galaxy category views">
          {cats.map((v) => {
            const name = `${v.icon} ${v.label}`;
            const on = activeView === name;
            return (
              <button key={v.key} className={`gv-chip ${on ? "on" : ""}`} onClick={() => void tap(v)} aria-pressed={on}
                title={on ? `Show everything again` : `View only ${v.label} (renders fewer bodies)`}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name={v.svg} size={16} /> {v.label}</span>
                {/* Batch H (REG-207): the count is the full-set total, not the
                    payload's intersection — a category never understates itself. */}
                <span className="gv-count">{on ? "✕" : v.shown}</span>
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
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="journeys" size={16} /> Journeys</span><span className="gv-count">{on ? "✕" : journeyCount}</span></button>;
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
          {/* Batch I (REG-067 / GH-05): a failed layer load leaves a
              visible trace — which layer failed, and a retry — instead
              of its chip silently vanishing from the sheet. */}
          {layerError && (
            <div className="gv-layer-error" role="alert">
              <span>
                Couldn&apos;t load the{" "}
                {layerError === "both" ? "Money sky and Journeys" : layerError === "money" ? "Money sky" : "Journeys"}
                {" "}— those views are hidden for now.
              </span>
              <button type="button" className="gv-chip" onClick={() => void loadLayers()}>
                Retry
              </button>
            </div>
          )}
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
