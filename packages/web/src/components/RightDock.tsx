import { useEffect, useState } from "react";
import type { GraphData, GraphNode } from "@brain/shared";
import { NodeInspector } from "./NodeInspector.js";
import { NodeList } from "./NodeList.js";
import { ActionsPanel } from "./ActionsPanel.js";
import { SectorView } from "./SectorView.js";
import { DigestPanel } from "./DigestPanel.js";
import { SoumayaPanel } from "./SoumayaPanel.js";
import { FleetPanel } from "./FleetPanel.js";
import { AchievementsPanel } from "./AchievementsPanel.js";
import { HangarPanel, type HangarViewTarget } from "./HangarPanel.js";
import type { UnlockStats } from "@brain/shared";
import { InboxPanel } from "./InboxPanel.js";
import { LibraryPanel } from "./LibraryPanel.js";
import { CodexPanel } from "./CodexPanel.js";
import { DailyQuests } from "./DailyQuests.js";
import { questDayStorageKey } from "./quests.js";
import { MindPanel } from "./MindPanel.js";
import { FinancePanel } from "./FinancePanel.js";
import { JourneysPanel } from "./JourneysPanel.js";
import { SoumayaEye } from "./SoumayaEye.js";
import type { FleetStatus } from "../graph/Graph3D.js";
import type { Fuel, Streak } from "@brain/shared";

// The dock was 13 icon tabs — it overflowed off-screen on phones and several
// tabs were near-duplicates. Consolidated: Browse absorbs List/Library/Sectors
// (view modes), Progress absorbs Awards/Codex (chips), Fleet folds into the
// Soumaya tab as a section, and the Companion controls live inside the chat
// (💬 → 🎭) where they configure who you're talking to. 8 tabs fit a 360px
// dock without scrolling.
//
// Progressive Discovery (OPTIMIZATION_ROADMAP.md Problem 1 / VISION_2_JOURNEYS.md):
// a brand-new brain sees the core loop (Details/Browse/Mind/Agenda/Soumaya/Inbox/
// Money) without also being handed Insights/Progress/Hangar before there's
// anything in them — same tabs, same code, just not all 11 thrown at a day-1
// user at once. Deliberately NOT gating Journeys, despite the roadmap's own
// illustrative wording naming it: JourneyChips' own empty state says "Create a
// journey in the 🧭 tab first" — hiding that tab until a journey exists would be
// an unbreakable chicken-and-egg lock, since nothing else in the app can create
// one. Gates are checked once per dock mount (not live-reactive) — a newly
// earned tab appears the next time the dock opens, which is an acceptable
// cadence for a reveal, not a correctness-critical path.
export type DockTab =
  | "details"
  | "list"
  | "mind"
  | "actions"
  | "insights"
  | "soumaya"
  | "inbox"
  | "awards"
  | "money"
  | "journeys"
  | "hangar";

interface Props {
  tab: DockTab;
  setTab: (t: DockTab) => void;
  selected: GraphNode | null;
  graph: GraphData;
  onFocus: (id: number) => void;
  onChanged?: (id: number) => void;
  onDeleted?: () => void;
  onIsolate?: (id: number) => void;
  onClose?: () => void;
  onBack?: () => void;
  canBack?: boolean;
  /** Live fleet status getter (from the 3D scene) for the Fleet section. */
  getFleetStatus?: () => FleetStatus | undefined;
  /** Floating ship-task label preference + setter (Soumaya tab toggle). */
  showShipTask?: boolean;
  setShowShipTask?: (v: boolean) => void;
  shipViewMode?: "orbit" | "cockpit";
  setShipViewMode?: (v: "orbit" | "cockpit") => void;
  tasks?: any[];
  onReorderTasks?: (newOrder: any[]) => void;
  /** Live fuel + streak + brain id for the Progress tab. */
  fuel?: Fuel | null;
  streak?: Streak | null;
  spaceId?: string;
  spaceName?: string;
  /** Refresh the galaxy after a constellation hub is created (Insights tab). */
  onPromoted?: () => void;
  /** Galaxy entity detail focus (Phase O; Phase AC.1 adds Bill): a Journey/Goal/Bill
   *  clicked in the 3D galaxy, passed straight through to the tab that already
   *  renders its detail card. */
  focusJourney?: { id: number; nonce: number } | null;
  focusGoal?: { id: number; nonce: number } | null;
  focusBill?: { id: number; nonce: number } | null;
  /** Journey → Chat (Phase AC.1): "Ask Soumaya about this" from a JourneyCard. */
  onAskJourney?: (journey: { id: number; title: string }) => void;
  /** IM-90: open the capture/ingest panel (the daily quest "log a memory" action). */
  onCapture?: () => void;
  /** CL-12 (IM-96/102/133): the shared Unlockables stats + dev flag App
   *  assembled, the Hangar's "view in galaxy" action, and the gated music
   *  player's state/callback — all owned by App, passed through the dock. */
  unlockStats?: UnlockStats | null;
  devUnlockAll?: boolean;
  onViewInGalaxy?: (target: HangarViewTarget) => void;
  onPlayTrack?: (index: number) => void;
  currentTrackIndex?: number | null;
  musicPlaying?: boolean;
}

// Each tab carries a human `name` (tooltip + accessible label) so the icon row is
// debuggable and screen-reader friendly; `name` also maps 1:1 to the tab id/code.
// The tab name text is responsive (hidden on narrow screens, displayed side-by-side on wide screens).
/**
 * Progressive Discovery (OPTIMIZATION_ROADMAP.md Problem 1): which tabs a
 * brain-in-its-current-state has earned. Pure + exported so the gating rules
 * are unit-testable without rendering the whole dock. `activeTab` is always
 * included — switching data should never yank the tab you're looking at.
 * Journeys is deliberately NOT gated — see the file-header comment.
 */
export function visibleTabIds(
  allTabs: readonly { id: DockTab }[],
  activeTab: DockTab,
  signals: { hasRealMemory: boolean },
): DockTab[] {
  // IM-62: Insights used to gate on "an insight already exists" — but the
  // tab's own scans are how a first insight gets created, so a new user
  // could never reach them (the same chicken-and-egg the Journeys comment
  // below rejects). It now shares the has-memories gate with Progress/Hangar:
  // once there's a real memory to scan, the tab (and its scans) is reachable.
  const gated: Partial<Record<DockTab, boolean>> = {
    insights: signals.hasRealMemory,
    awards: signals.hasRealMemory,
    hangar: signals.hasRealMemory,
  };
  return allTabs.filter((t) => t.id === activeTab || gated[t.id] !== false).map((t) => t.id);
}

/**
 * IM-02: the dock ambient strip's content, derived ONLY from real state the
 * dock already receives (the graph's actual memory/link counts, the focused
 * memory's label) plus the real local clock. Pure + exported so it is
 * unit-testable. The previous strip FABRICATED telemetry — a sector number
 * derived from a sine of the current time, cycling a hard-coded list of
 * orbit names that correspond to nothing in the user's brain. No invented
 * numbers or place names may return here: if there is no real state to
 * show, say so honestly ("No memories yet").
 */
export function dockAmbientGreeting(now: Date): string {
  const hours = now.getHours();
  if (hours >= 5 && hours < 12) return "Good morning, traveller";
  if (hours >= 12 && hours < 17) return "Good afternoon, traveller";
  if (hours >= 17 && hours < 22) return "Good evening, traveller";
  return "Good night, traveller";
}

export function dockAmbientDetail(
  input: { memoryCount: number; linkCount: number; selectedLabel?: string | null },
  now: Date,
): string {
  const timeStr = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (input.memoryCount <= 0) return `No memories yet · ${timeStr}`;
  const counts =
    `${input.memoryCount} ${input.memoryCount === 1 ? "memory" : "memories"} · ` +
    `${input.linkCount} ${input.linkCount === 1 ? "link" : "links"}`;
  const viewing = input.selectedLabel ? ` · Viewing “${input.selectedLabel}”` : "";
  return `${counts}${viewing} · ${timeStr}`;
}

const TABS: { id: DockTab; label: string; name: string }[] = [
  { id: "details", label: "ⓘ", name: "Details" },
  { id: "list", label: "📚", name: "Browse" },
  { id: "mind", label: "🧠", name: "Mind" },
  { id: "actions", label: "✅", name: "Agenda" },
  { id: "insights", label: "✨", name: "Insights" },
  { id: "soumaya", label: "🛰️", name: "Soumaya" },
  { id: "inbox", label: "🔔", name: "Inbox" },
  { id: "awards", label: "🏆", name: "Progress" },
  { id: "journeys", label: "🧭", name: "Journeys" },
  { id: "money", label: "💵", name: "Money" },
  { id: "hangar", label: "🛠️", name: "Hangar" },
];

/** Browse = one place to read your memories, three lenses over the same data. */
type BrowseView = "all" | "folders" | "hubs";
/** Progress = one progression surface: the Codex (discoveries) + Awards (feats). */
type ProgressView = "codex" | "awards";

export function RightDock({
  tab,
  setTab,
  selected,
  graph,
  onFocus,
  onChanged,
  onDeleted,
  onIsolate,
  onClose,
  onBack,
  canBack,
  getFleetStatus,
  showShipTask,
  setShowShipTask,
  shipViewMode,
  setShipViewMode,
  tasks,
  onReorderTasks,
  fuel,
  streak,
  spaceId,
  spaceName = "Soumaya",
  onPromoted,
  focusJourney,
  focusGoal,
  focusBill,
  onAskJourney,
  onCapture,
  unlockStats,
  devUnlockAll,
  onViewInGalaxy,
  onPlayTrack,
  currentTrackIndex,
  musicPlaying,
}: Props) {
  const [unseenCount, setUnseenCount] = useState(0);
  // Progressive Discovery: no server fetch needed for gating. Codex entries
  // (Progress's other half) unlock from the first real memory, well before
  // any Achievement, so "at least one real memory exists" — already available
  // via `graph` below — is the earlier, correct signal for Progress/Hangar.
  // IM-62: Insights shares that same signal (see visibleTabIds) — gating it
  // on an existing insight hid the very scans that create the first one.
  const [browseView, setBrowseView] = useState<BrowseView>("all");
  const [progressView, setProgressView] = useState<ProgressView>("codex");
  const [fleetOpen, setFleetOpen] = useState(true); // IM-68: Fleet starts open/prominent
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // IM-02: the ambient strip shows REAL state only (see dockAmbientDetail).
  // The clock ticks so the greeting/time stay current; everything else is
  // derived during render from the graph + selection props, so the strip
  // updates the moment the brain changes — no fabricated telemetry.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);
  const ambientInfo = {
    greeting: dockAmbientGreeting(now),
    location: dockAmbientDetail(
      {
        memoryCount: graph.nodes.filter((n) => n.kind !== "action").length,
        linkCount: graph.links.length,
        selectedLabel: selected?.label ?? null,
      },
      now,
    ),
  };

  useEffect(() => {
    const updateCount = () => {
      const key = `brain.notifications.${spaceId || "default"}`;
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const list = JSON.parse(raw);
          const count = list.filter((n: any) => !n.seen).length;
          setUnseenCount(count);
        } else {
          setUnseenCount(0);
        }
      } catch {
        setUnseenCount(0);
      }
    };
    updateCount();
    window.addEventListener("brain-notifications-updated", updateCount);
    return () => window.removeEventListener("brain-notifications-updated", updateCount);
  }, [spaceId]);

  const hasRealMemory = graph.nodes.some((n) => n.kind !== "action");
  const shownIds = new Set(visibleTabIds(TABS, tab, { hasRealMemory }));
  const dynamicTabs = TABS.filter((t) => shownIds.has(t.id)).map((t) => {
    if (t.id === "soumaya") return { ...t, name: spaceName, badge: 0 };
    if (t.id === "inbox") return { ...t, badge: unseenCount };
    return { ...t, badge: 0 };
  });

  return (
    <div className="panel dock">
      <div className="tabs">
        {canBack && onBack && (
          <button className="tab-back" onClick={onBack} aria-label="Back to previous memory">
            ←
          </button>
        )}
        {dynamicTabs.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "on" : ""}
            onClick={() => setTab(t.id)}
            title={t.name}
            aria-label={t.name}
            aria-current={tab === t.id ? "page" : undefined}
            style={{ position: "relative" }}
          >
            <span className="tab-ic" style={{ position: "relative" }}>
              {t.label}
              {t.badge > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-6px",
                    right: "-8px",
                    background: "#ef4444",
                    color: "white",
                    borderRadius: "50%",
                    fontSize: "8px",
                    padding: "1px 4px",
                    lineHeight: 1,
                    fontWeight: "bold",
                    pointerEvents: "none"
                  }}
                >
                  {t.badge}
                </span>
              )}
            </span>
            <span className="tab-name">{t.name}</span>
          </button>
        ))}
        {onClose && (
          <button className="panel-close tab-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>
      {/* Persistent ambient status strip — real graph state + local time only (IM-02) */}
      <div className="dock-ambient-strip" style={{
        padding: "6px 16px",
        background: "rgba(10, 12, 28, 0.4)",
        borderBottom: "1px solid var(--glass-border)",
        fontSize: "11px",
        color: "#7ac8ff",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontFamily: "monospace",
        opacity: 0.85
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}><SoumayaEye state="idle" mood="thoughtful" size={22} />{ambientInfo.greeting}</span>
        <span>{ambientInfo.location}</span>
      </div>
      <div className="dock-content">
        {tab === "details" && (
          <NodeInspector
            node={selected}
            graph={graph}
            onFocus={onFocus}
            onChanged={onChanged}
            onDeleted={onDeleted}
            onIsolate={onIsolate}
            onTagClick={(t) => {
              setSelectedTag(t);
              setTab("list");
              setBrowseView("all");
            }}
          />
        )}
        {tab === "list" && (
          <div className="subtab-wrap">
            <div className="subtabs" role="tablist" aria-label="Browse view">
              <button className={browseView === "all" ? "on" : ""} onClick={() => setBrowseView("all")}>
                📋 All
              </button>
              <button className={browseView === "folders" ? "on" : ""} onClick={() => setBrowseView("folders")}>
                📁 Folders
              </button>
              <button className={browseView === "hubs" ? "on" : ""} onClick={() => setBrowseView("hubs")}>
                🪐 Hubs
              </button>
            </div>
            {/* IM-43: subtab swaps used to replace each other synchronously
                with no transition. The keyed wrapper re-mounts per view so the
                browse-view-enter animation runs on every swap. (No fake
                skeleton: all three views derive synchronously from the
                already-loaded graph — there is no fetch to skeleton against.) */}
            <div key={browseView} className="browse-view-enter">
              {browseView === "all" && (
                <NodeList
                  nodes={graph.nodes}
                  onFocus={onFocus}
                  initialTag={selectedTag}
                  onTagChange={setSelectedTag}
                />
              )}
              {browseView === "folders" && (
                <LibraryPanel graph={graph} onFocus={onFocus} spaceName={spaceName} />
              )}
              {browseView === "hubs" && (
                <SectorView graph={graph} onFocus={onFocus} onIsolate={(id) => onIsolate?.(id)} />
              )}
            </div>
          </div>
        )}
        {tab === "mind" && <MindPanel onFocus={onFocus} onChanged={() => onChanged?.(-1)} />}
        {tab === "actions" && (
          <ActionsPanel nodes={graph.nodes} onFocus={onFocus} onChanged={onDeleted} />
        )}
        {tab === "insights" && <DigestPanel onFocus={onFocus} onPromoted={onPromoted} />}
        {tab === "soumaya" && (
          <div className="subtab-wrap">
            <SoumayaPanel
              spaceName={spaceName}
              onFocus={onFocus}
              showShipTask={showShipTask}
              setShowShipTask={setShowShipTask}
              shipViewMode={shipViewMode}
              setShipViewMode={setShipViewMode}
              tasks={tasks}
              onReorderTasks={onReorderTasks}
              nodes={graph.nodes}
            />
            {/* IM-68: the Fleet is the most immersive element in this tab —
                surface it OPEN and prominent, not buried behind a closed
                <details> below the whole panel. It stays collapsible. */}
            <details
              className="dock-section fleet-section"
              open={fleetOpen}
              onToggle={(e) => setFleetOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary>🚀 Fleet — her support craft</summary>
              {fleetOpen && (
                <FleetPanel getStatus={getFleetStatus ?? (() => undefined)} onFocus={onFocus} />
              )}
            </details>
          </div>
        )}
        {tab === "inbox" && <InboxPanel spaceId={spaceId ?? "default"} />}
        {tab === "money" && <FinancePanel focusGoal={focusGoal} focusBill={focusBill} />}
        {tab === "journeys" && <JourneysPanel onFocus={onFocus} focusJourney={focusJourney} onAskJourney={onAskJourney} />}
        {tab === "awards" && (
          <div className="subtab-wrap">
            {/* IM-90: today's tending quests live in Progress (the "what do I
                do next" tab), above the Codex/Awards switch so they're visible
                from either half — previously only the Observatory showed them. */}
            <DailyQuests
              graph={graph}
              fedToday={!!streak?.today}
              onFocus={onFocus}
              onCapture={onCapture}
              onOpenInsights={() => setTab("insights")}
              // REG-045 (PG-01): the same persisted dayState key the Observatory
              // uses (`questDayStorageKey(spaceId)`), so both surfaces render
              // the same quests, targets, and done states for the day.
              questKey={questDayStorageKey(spaceId || spaceName || "default")}
            />
            <div className="subtabs" role="tablist" aria-label="Progress view">
              <button className={progressView === "codex" ? "on" : ""} onClick={() => setProgressView("codex")}>
                📖 Codex
              </button>
              <button className={progressView === "awards" ? "on" : ""} onClick={() => setProgressView("awards")}>
                🏆 Awards
              </button>
              <button className="subtab-link" onClick={() => setTab("hangar")} title="Spend your unlocks">
                🛠️ Hangar →
              </button>
            </div>
            {progressView === "codex" && (
              <CodexPanel
                graph={graph}
                onFocus={onFocus}
                spaceId={spaceId}
                onReward={() => onChanged?.(-1)}
                onNavigate={(t) => setTab(t as DockTab)}
              />
            )}
            {progressView === "awards" && (
              <AchievementsPanel graph={graph} fuel={fuel ?? null} streak={streak ?? null} spaceId={spaceId ?? ""} />
            )}
          </div>
        )}
        {tab === "hangar" && (
          <HangarPanel
            spaceId={spaceId ?? ""}
            memoriesCount={graph.nodes.filter((n) => n.kind !== "action").length}
            onEquipChanged={() => onChanged?.(-1)}
            unlockStats={unlockStats}
            devUnlockAll={devUnlockAll}
            onViewInGalaxy={onViewInGalaxy}
            onPlayTrack={onPlayTrack}
            currentTrackIndex={currentTrackIndex}
            musicPlaying={musicPlaying}
          />
        )}
      </div>
    </div>
  );
}
