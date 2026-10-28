import { useEffect, useMemo, useState } from "react";
import { type Fuel, type Streak } from "@brain/shared";
import {
  getAgentLogsStrict,
  getFuel,
  getUndertaking,
  getUndertakingHistory,
  getStreak,
  getSettings,
  updateSetting,
  getUsage,
  setBudget as apiSetBudget,
  resetUsage,
  getAdminToken,
  setAdminToken,
  getSpaceId,
  getHealth,
  describeLlmStatus,
  getToolHealth,
  type AgentLog,
  type JobRationale,
  type Usage,
  type Undertaking,
  type Health,
  type ToolHealth,
  commissionWarm,
} from "../api/client.js";
import { pushToast } from "./Toasts.js";
import { SoumayaEye } from "./SoumayaEye.js";
import {
  constellationCells,
  derivePresence,
  filterLogs,
  groupLogsByDay,
  humanizeLogAction,
  logDateTime,
  LOG_PAGE_SIZE,
} from "../lib/soumayaPanel.js";

/** Naive SQLite timestamps ("YYYY-MM-DD HH:MM:SS", no zone) must be read as UTC — same
 *  bug class already fixed for remindAt/expiresAt/Timeline chapters elsewhere in the app. */
function normalizeDate(raw: string): Date {
  const iso = raw.includes("Z") || raw.includes("+") ? raw : raw.replace(" ", "T") + "Z";
  return new Date(iso);
}
function timeAgo(iso: string | null): string {
  if (!iso) return "never yet";
  const ms = Date.now() - normalizeDate(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
/** Friendly icon/label per tool — an unlisted future tool still renders (🛰️ + its raw
 *  name) rather than being silently dropped. */
const TOOL_LABELS: Record<string, { icon: string; label: string }> = {
  fire_reminder: { icon: "⏰", label: "Reminders" },
  create_task: { icon: "✅", label: "Task creation" },
  surface_orphan: { icon: "🌟", label: "Orphan surfacing" },
  review_nudge: { icon: "🧠", label: "Recall nudges" },
  check_in: { icon: "💙", label: "Check-ins" },
  web_lookup: { icon: "🔎", label: "Web lookups" },
  weekly_review: { icon: "🗓️", label: "Weekly review" },
  chart_discovery: { icon: "✦", label: "Codex charting" },
  bill_risk: { icon: "💸", label: "Bill-risk warnings" },
};

/* eslint-disable @typescript-eslint/no-explicit-any */

export function SoumayaPanel({
  spaceName = "Soumaya",
  onFocus,
  showShipTask,
  setShowShipTask,
  shipViewMode,
  setShipViewMode,
  tasks,
  onReorderTasks,
  nodes,
}: {
  spaceName?: string;
  onFocus: (id: number) => void;
  showShipTask?: boolean;
  setShowShipTask?: (v: boolean) => void;
  shipViewMode?: "orbit" | "cockpit";
  setShipViewMode?: (v: "orbit" | "cockpit") => void;
  tasks?: any[];
  onReorderTasks?: (newOrder: any[]) => void;
  /** Graph nodes for memory-label lookups (IM-70 target pills). */
  nodes?: { id: number; label: string }[];
}) {
  // Telemetry & Logs state
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [logsError, setLogsError] = useState(false);
  const [researchEnabled, setResearchEnabled] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [toolHealth, setToolHealth] = useState<ToolHealth[]>([]);
  const [undertaking, setUndertaking] = useState<Undertaking | null>(null);
  const [undertakingHistory, setUndertakingHistory] = useState<Undertaking[]>([]);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [fuel, setFuel] = useState<Fuel | null>(null);
  const [commissioning, setCommissioning] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // IM-66 log browsing state
  const [logQuery, setLogQuery] = useState("");
  const [logAction, setLogAction] = useState("all");
  const [logVisible, setLogVisible] = useState(LOG_PAGE_SIZE);
  // IM-71: in-app admin-token dialog (never window.prompt). Holds the action
  // to run once a token has been entered.
  const [tokenRequest, setTokenRequest] = useState<{ onReady: () => void } | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");

  // Budget mutations are admin-gated server-side (shared deployment cap). Ask for
  // the ADMIN_TOKEN once (in-app dialog, IM-71), remember it, and surface a clear
  // message on refusal.
  const ensureAdminToken = (onReady: () => void): void => {
    if (getAdminToken()) {
      onReady();
      return;
    }
    setTokenDraft("");
    setTokenRequest({ onReady });
  };

  /** IM-70: a target pill reads the memory's label, like FleetPanel's labelOf. */
  const labelOf = useMemo(() => {
    const byId = new Map((nodes ?? []).map((n) => [n.id, n.label]));
    return (id: number) => byId.get(id) ?? `Memory #${id}`;
  }, [nodes]);

  const moveTask = (index: number, direction: "up" | "down") => {
    if (!tasks || !onReorderTasks || !tasks[index]) return;
    const plannedTasks = tasks.filter((t) => t.status === "planned");
    const targetPlannedIndex = plannedTasks.findIndex(t => t.id === tasks[index]!.id);
    if (targetPlannedIndex === -1) return;
    
    const nextPlannedIndex = direction === "up" ? targetPlannedIndex - 1 : targetPlannedIndex + 1;
    if (nextPlannedIndex < 0 || nextPlannedIndex >= plannedTasks.length) return;
    
    const newPlanned = [...plannedTasks];
    const temp = newPlanned[targetPlannedIndex]!;
    newPlanned[targetPlannedIndex] = newPlanned[nextPlannedIndex]!;
    newPlanned[nextPlannedIndex] = temp;
    
    const doing = tasks.filter((t) => t.status === "doing");
    const done = tasks.filter((t) => t.status === "done");
    
    const newOrder = [...doing, ...newPlanned, ...done];
    onReorderTasks(newOrder);
  };

  // Fetch telemetry/logs. Logs load through the STRICT variant (IM-66): a
  // failed load sets logsError so the panel shows a real error state instead
  // of rendering a dead server as a legitimately empty brain.
  const fetchData = async () => {
    try {
      const logsData = await getAgentLogsStrict();
      setLogs(logsData);
      setLogsError(false);
    } catch (err) {
      console.error("Failed to fetch Soumaya logs", err);
      setLogsError(true);
    }
    try {
      const [settings, usageData, fuelData, arc, arcHistory, streakData, healthData, toolHealthData] = await Promise.all([
        getSettings(),
        getUsage(),
        getFuel(),
        getUndertaking(),
        getUndertakingHistory(),
        getStreak(),
        getHealth().catch(() => null), // diagnostics-only — never block the rest of the panel
        getToolHealth().catch(() => []), // diagnostics-only — never block the rest of the panel
      ]);
      setResearchEnabled(settings.research_enabled === "true");
      if (usageData) setUsage(usageData);
      if (fuelData) setFuel(fuelData);
      setUndertaking(arc);
      setUndertakingHistory(arcHistory);
      if (streakData) setStreak(streakData);
      setHealth(healthData);
      setToolHealth(toolHealthData);
    } catch (err) {
      console.error("Failed to fetch Soumaya data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 10000); // refresh logs every 10s
    return () => clearInterval(timer);
  }, []);

  // IM-72: honour the write result — flip optimistically, but on failure roll
  // back and toast instead of lying until the next poll silently flips it.
  const toggleResearch = async () => {
    const prev = researchEnabled;
    const newVal = !prev;
    setResearchEnabled(newVal);
    try {
      const r = await updateSetting("research_enabled", String(newVal));
      if (!r || r.ok !== true) throw new Error("setting rejected");
    } catch {
      setResearchEnabled(prev);
      pushToast("Couldn't save Research Mode — it's still " + (prev ? "on." : "off."), "⚠️", 4000);
    }
  };


  if (loading) {
    return (
      <div className="dock-body" aria-busy="true">
        <p className="empty">Initializing {spaceName} link...</p>
        <div className="loading-shimmer" aria-hidden="true">
          <div className="skeleton-section">
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
            <div className="skeleton-line" />
          </div>
        </div>
      </div>
    );
  }

  // IM-65 presence + IM-67 history derivations (real state only).
  const latestCompleted = undertakingHistory.find((u) => u.status === "done") ?? null;
  const presence = derivePresence({
    tasks,
    undertaking,
    latestLog: logs[0] ?? null,
    latestCompleted: undertaking && undertaking.status === "active" ? null : latestCompleted,
    fuel,
  });
  const pastUndertakings = undertakingHistory.filter(
    (u) => u.id !== undertaking?.id && (undertaking ? true : u.id !== latestCompleted?.id),
  );

  return (
    <div className="dock-body">
      <div className="dock-head">
        <h3>{spaceName}</h3>
        <div className="head-tools">
          {setShipViewMode && (
            <button
              className={`link-btn ${shipViewMode === "cockpit" ? "active" : ""}`}
              title={shipViewMode === "cockpit" ? "Camera Mode: Cockpit Lock" : "Camera Mode: Orbit Follow"}
              onClick={() => setShipViewMode(shipViewMode === "cockpit" ? "orbit" : "cockpit")}
              style={{ fontSize: "1.1rem" }}
            >
              {shipViewMode === "cockpit" ? "🎥 Lock" : "🎥 Free"}
            </button>
          )}
          {setShowShipTask && (
            <button
              className={`link-btn ${showShipTask ? "active" : ""}`}
              title={showShipTask ? "Hide ship task label" : "Show ship task label"}
              onClick={() => setShowShipTask(!showShipTask)}
              style={{ fontSize: "1.1rem" }}
            >
              🏷️
            </button>
          )}
        </div>
      </div>

      {/* IM-65: her identity header — the eye, what she's doing NOW, and her
          current mode/mood, all derived from live panel state (derivePresence). */}
      <div className="soumaya-identity">
        <SoumayaEye state={presence.eyeState} mood={presence.mood} size={44} />
        <div className="soumaya-identity-text">
          <p className="soumaya-now">{presence.sentence}</p>
          <p className="soumaya-mood">
            {presence.moodLabel}
            {researchEnabled ? " · Research Mode on" : ""}
            {streak ? ` · 🔥 ${streak.current}-day streak` : ""}
          </p>
        </div>
      </div>

      {/* Her multi-day undertaking — autonomy with a narrative arc. */}
      {undertaking && undertaking.status === "active" && (
        <div className="undertaking-card">
          <div className="undertaking-head">
            <span>🎯 {undertaking.title}</span>
            <span className="undertaking-day">Day {undertaking.done} of {undertaking.total}</span>
          </div>
          <div className="undertaking-bar">
            <span style={{ width: `${Math.round((undertaking.done / undertaking.total) * 100)}%` }} />
          </div>
        </div>
      )}

      {/* IM-67: no active undertaking is a state, not a disappearance — and a
          finished arc is celebrated, with past arcs kept as history. */}
      {!undertaking && latestCompleted && (
        <div className="undertaking-card undertaking-done">
          <div className="undertaking-head">
            <span>🎉 Completed: {latestCompleted.title}</span>
            <span className="undertaking-day">{latestCompleted.done} of {latestCompleted.total} days</span>
          </div>
          <p className="budget-note" style={{ fontSize: "11px", marginTop: "4px" }}>
            She finished this arc — a new one begins when there's enough to work on.
          </p>
        </div>
      )}
      {pastUndertakings.length > 0 && (
        <div className="undertaking-history">
          <h5 className="undertaking-history-title">Past undertakings</h5>
          <ul className="undertaking-history-list">
            {pastUndertakings.map((u) => (
              <li key={u.id} className="undertaking-history-item">
                <span>{u.status === "done" ? "🎉" : "🎯"} {u.title}</span>
                <span className="undertaking-day">
                  {u.status === "done" ? "Completed" : `${u.done} of ${u.total} days`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 1. Active Flight Tasks (At the top) */}
      <div className="ship-tasks-section" style={{ marginTop: "10px", paddingTop: "5px", borderTop: "none" }}>
        <h4 style={{ margin: "0 0 10px 0", fontSize: "13px", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Active Flight Tasks
        </h4>
        {tasks && tasks.length > 0 ? (
          <ul className="ship-tasks-list">
            {tasks.map((task, idx) => {
              const isPlanned = task.status === "planned";
              const isDoing = task.status === "doing";
              const isDone = task.status === "done";
              
              const plannedTasks = tasks.filter((t) => t.status === "planned");
              const pIdx = plannedTasks.findIndex(t => t.id === task.id);
              
              return (
                <li key={task.id} className={`ship-task-item ${task.status}`}>
                  <span className={`status-indicator ${task.status}`}>
                    {isDoing && <span className="pulse-dot" />}
                    {isDone && "✓"}
                    {isPlanned && "○"}
                  </span>
                  <span className="task-label">{task.label}</span>
                  {isPlanned && (
                    <div className="task-controls">
                      <button
                        className="task-btn"
                        disabled={pIdx === 0}
                        onClick={() => moveTask(idx, "up")}
                        title="Move task up in priority"
                      >
                        ▲
                      </button>
                      <button
                        className="task-btn"
                        disabled={pIdx === plannedTasks.length - 1}
                        onClick={() => moveTask(idx, "down")}
                        title="Move task down in priority"
                      >
                        ▼
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="empty" style={{ margin: "5px 0", fontSize: "0.8rem", opacity: 0.6 }}>
            Idle at space station — no active flight tasks.
          </p>
        )}
      </div>

      {/* Operations & Telemetry */}
      <div className="operations-section" style={{ marginTop: "20px", borderTop: "1px solid var(--glass-border)", paddingTop: "15px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h4 style={{ margin: 0, fontSize: "13px", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Operations & Telemetry
          </h4>
          <div className="toggle-box" style={{ margin: 0 }}>
            <span className="mini-label" style={{ fontSize: "11px", opacity: 0.7 }}>Research Mode</span>
            <button 
              className={`mini ${researchEnabled ? 'active' : ''}`} 
              onClick={toggleResearch}
              style={{ 
                backgroundColor: researchEnabled ? 'rgba(100,200,255,0.2)' : 'transparent',
                borderColor: researchEnabled ? '#64c8ff' : 'rgba(255,255,255,0.2)',
                fontSize: "10px",
                padding: "2px 6px"
              }}
            >
              {researchEnabled ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        {fuel && (
          <div className="budget-box" style={{ marginTop: "10px" }}>
            <div className="budget-head">
              <span>⛽ Fuel (earned by tending)</span>
              <span className={fuel.fuel < fuel.jobCost ? "budget-over" : ""}>
                {fuel.fuel.toFixed(1)} / {fuel.capacity}
              </span>
            </div>
            <div className="budget-bar">
              <div
                className="budget-fill"
                style={{
                  width: `${Math.round(Math.min(1, fuel.fuel / fuel.capacity) * 100)}%`,
                  background: fuel.fuel < fuel.jobCost ? "#ff6b6b" : "#8be9a0",
                }}
              />
            </div>
            <p className="budget-note" style={{ fontSize: "11px", marginTop: "6px" }}>
              {fuel.fuel < fuel.jobCost
                ? "Out of fuel — Research Mode research paused. Add memories, forge links, or clear action items to refuel."
                : "Powers Research Mode research + sector charting. Earn it by adding memories or forging links."}
            </p>
            {/* A player-controlled SINK so Fuel isn't just a number that pins at the cap:
                spend it to have Soumaya warm your coldest memories on demand, right now. */}
            <button
              className="commission-btn"
              disabled={commissioning || fuel.fuel < 25}
              onClick={async () => {
                setCommissioning(true);
                const r = await commissionWarm();
                setCommissioning(false);
                if (r.ok) {
                  pushToast(`Soumaya warmed ${r.warmed} cold memories (−${r.cost}⛽) ✦`, "🔥", 4500);
                  try {
                    const sid = localStorage.getItem("brain.spaceId") || "default";
                    const key = `stat.commissions.${sid}`;
                    localStorage.setItem(key, String((parseInt(localStorage.getItem(key) || "0", 10) || 0) + 1));
                  } catch { /* ignore */ }
                  window.dispatchEvent(new Event("brain-memory-added")); // refresh fuel + galaxy + achievements
                } else {
                  pushToast(r.error ?? "Couldn't commission that.", "⚠️", 3500);
                }
              }}
              title="Spend 25 Fuel to instantly warm your coldest memories"
            >
              {commissioning ? "Warming…" : "⚡ Commission: warm the cold belt (−25⛽)"}
            </button>
          </div>
        )}
      </div>

      {/* (The Captain's Log moved to the Insights tab — it's her narrative read on
          the day, same job as the daily digest, so they live together now.) */}

      {/* 5. Consistency Constellation — IM-64: rebuilt on the real streak
          endpoint (GET /maintenance/streak), NOT the agent-log feed. Lit =
          you tended your brain that day; hollow outline = no record (before
          day-tracking began); dim = not tended. */}
      <div className="constellation-grid" style={{ marginTop: "20px", borderTop: "1px solid var(--glass-border)", paddingTop: "15px" }}>
        <h4 style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Consistency Constellation
        </h4>
        {streak ? (
          <>
            <p className="streak-summary">
              🔥 <strong>{streak.current}-day streak</strong>
              {streak.best > 0 ? ` · best ${streak.best}` : ""}
              {typeof streak.shields === "number" ? ` · 🛡️ ${streak.shields} shield${streak.shields === 1 ? "" : "s"}` : ""}
              {streak.today ? " · tended today ✓" : " · not tended yet today"}
            </p>
            {(() => {
              const cells = constellationCells(streak);
              if (!cells) return <p className="empty">No day-by-day record yet — it builds as you tend.</p>;
              return (
                <>
                  <div className="constellation-cells" role="img" aria-label={`Your last 14 days: ${cells.filter((c) => c.tended).length} tended`}>
                    {cells.map((c) => (
                      <div key={c.date} className="constellation-cell-wrap">
                        <div
                          title={c.tended === true ? `Tended on ${c.date}` : c.tended === false ? `Not tended on ${c.date}` : `No record for ${c.date}`}
                          className={`constellation-cell ${c.tended === true ? "lit" : c.tended === false ? "missed" : "unknown"} ${c.isToday ? "today" : ""}`}
                        />
                        <span className="constellation-axis">{c.axis}</span>
                      </div>
                    ))}
                  </div>
                  <p className="constellation-legend">
                    <span className="legend-swatch lit" /> tended · <span className="legend-swatch missed" /> not tended · <span className="legend-swatch unknown" /> no record · outlined = today. Oldest → newest, left to right.
                  </p>
                </>
              );
            })()}
          </>
        ) : (
          <p className="empty">Streak unavailable right now.</p>
        )}
      </div>

      {/* 6. Recent Activity — IM-66 (search/filter/day groups/pagination,
          full dates, honest error) + IM-70 (humanized actions, memory labels) */}
      <div className="log-container" style={{ marginTop: "20px", borderTop: "1px solid var(--glass-border)", paddingTop: "15px" }}>
        <h4 style={{ marginBottom: "10px", fontSize: "13px", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Recent Activity
        </h4>
        {logsError ? (
          <div className="logs-error" role="alert">
            <p className="empty">Couldn't load her activity — this isn't an empty brain, it's a failed connection.</p>
            <button className="mini" onClick={() => fetchData()}>Try again</button>
          </div>
        ) : (
          <>
            <div className="log-controls">
              <input
                type="search"
                className="log-search"
                placeholder="Search her activity…"
                value={logQuery}
                onChange={(e) => { setLogQuery(e.target.value); setLogVisible(LOG_PAGE_SIZE); }}
                aria-label="Search activity logs"
              />
              <select
                className="log-filter"
                value={logAction}
                onChange={(e) => { setLogAction(e.target.value); setLogVisible(LOG_PAGE_SIZE); }}
                aria-label="Filter activity by kind"
              >
                <option value="all">All kinds</option>
                {[...new Set(logs.map((l) => l.action))].sort().map((a) => (
                  <option key={a} value={a}>{humanizeLogAction(a)}</option>
                ))}
              </select>
            </div>
            {(() => {
              const filtered = filterLogs(logs, logQuery, logAction);
              if (logs.length === 0) return <p className="empty">No recent logs recorded.</p>;
              if (filtered.length === 0) return <p className="empty">No activity matches that search.</p>;
              const visible = filtered.slice(0, logVisible);
              const groups = groupLogsByDay(visible);
              return (
                <>
                  {groups.map((g) => (
                    <div key={g.key} className="log-day-group">
                      <h5 className="log-day-head">{g.label}</h5>
                      <ul className="agent-logs" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {g.logs.map((log) => {
                          let targets: number[] = [];
                          try {
                            const parsed = JSON.parse(log.targets);
                            if (Array.isArray(parsed)) targets = parsed;
                          } catch {
                            /* ignore malformed targets */
                          }
                          let rationale: JobRationale | null = null;
                          try {
                            if (log.result) {
                              const r = JSON.parse(log.result);
                              if (r && r.objective) rationale = r as JobRationale;
                            }
                          } catch {
                            /* ignore malformed rationale */
                          }
                          return (
                            <li key={log.id} style={{
                              marginBottom: '0.8rem',
                              padding: '0.6rem',
                              backgroundColor: 'rgba(255,255,255,0.03)',
                              borderRadius: '4px',
                              fontSize: '0.85rem'
                            }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', opacity: 0.6, fontSize: '0.7rem' }}>
                                <span>{humanizeLogAction(log.action)}</span>
                                <span>{logDateTime(log.createdAt)}</span>
                              </div>
                              <p style={{ margin: '0.3rem 0' }}>{log.description}</p>
                              {rationale && (
                                <div
                                  style={{
                                    margin: '0.4rem 0',
                                    padding: '0.45rem 0.55rem',
                                    borderLeft: '2px solid rgba(100,200,255,0.5)',
                                    background: 'rgba(100,200,255,0.06)',
                                    borderRadius: '3px',
                                    fontSize: '0.78rem',
                                    lineHeight: 1.45,
                                  }}
                                >
                                  <div><span style={{ opacity: 0.55 }}>Objective · </span>{rationale.objective}</div>
                                  <div><span style={{ opacity: 0.55 }}>Why now · </span>{rationale.why}</div>
                                  <div><span style={{ opacity: 0.55 }}>Benefit · </span>{rationale.benefit}</div>
                                </div>
                              )}
                              <div className="pills">
                                {targets.map((id) => (
                                  <button
                                    key={id}
                                    className="pill mini"
                                    onClick={() => onFocus(id)}
                                  >
                                    {labelOf(id)}
                                  </button>
                                ))}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                  <p className="log-count">Showing {visible.length} of {filtered.length} entries{filtered.length !== logs.length ? ` (${logs.length} loaded)` : ""}</p>
                  {logVisible < filtered.length && (
                    <button className="mini log-more" onClick={() => setLogVisible((v) => v + LOG_PAGE_SIZE)}>
                      Show more
                    </button>
                  )}
                </>
              );
            })()}
          </>
        )}
      </div>

      {/* 7. Expandable Advanced Settings (Telegram Bot + API Budget) */}
      <details className="advanced-settings" style={{ marginTop: "20px", borderTop: "1px solid var(--glass-border)", paddingTop: "12px" }}>
        <summary style={{ cursor: "pointer", color: "var(--muted)", fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em", padding: "4px 0" }}>
          Advanced connection & budget
        </summary>
        <div style={{ padding: "10px 0 0 0" }}>
          {getSpaceId() && (
            <div className="budget-box" style={{ marginBottom: "14px" }}>
              <div className="budget-head">
                <span>🛰️ Talk to me on Telegram</span>
              </div>
              <p className="budget-note" style={{ fontSize: "11px" }}>
                Message the bot, then connect this brain with your login:
              </p>
              <code
                className="brain-id"
                title="Tap to copy"
                onClick={() => navigator.clipboard?.writeText("/link <name> <passcode>")}
                style={{ cursor: "pointer", display: "block", margin: "6px 0", padding: "4.5px", background: "rgba(0,0,0,0.35)", borderRadius: "4px", fontSize: "11px" }}
              >
                /link &lt;name&gt; &lt;passcode&gt;
              </code>
              <p className="budget-note" style={{ fontSize: "11px" }}>
                Use the same name + passcode you signed in with. After that I'll answer
                from this brain, log what you send, and bring you a daily digest.
              </p>
            </div>
          )}

          {health && (() => {
            const status = describeLlmStatus(health);
            return (
              <div className="budget-box" style={{ marginBottom: "14px" }}>
                <div className="budget-head">
                  <span>🔌 Cloud AI connection</span>
                </div>
                <p
                  className={`budget-note ${status.tone === "error" ? "budget-over" : status.tone === "warning" ? "budget-low" : ""}`}
                  style={{ fontSize: "11px" }}
                >
                  {status.icon} {status.text}
                </p>
              </div>
            );
          })()}

          {toolHealth.length > 0 && (
            <div className="budget-box" style={{ marginBottom: "14px" }}>
              <div className="budget-head">
                <span>🔧 Autonomous systems</span>
              </div>
              <p className="budget-note" style={{ fontSize: "11px", marginBottom: "6px" }}>
                When each of my background tools last actually ran — a real fact, not a guess.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                {toolHealth.map((t) => {
                  const meta = TOOL_LABELS[t.tool] ?? { icon: "🛰️", label: t.tool };
                  return (
                    <div key={t.tool} style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", opacity: 0.85 }}>
                      <span>{meta.icon} {meta.label}</span>
                      <span style={{ opacity: 0.6 }}>{timeAgo(t.lastRanAt)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {usage && (
            <div className="budget-box">
              <div className="budget-head">
                <span>API budget (estimated)</span>
                <span className={usage.overBudget ? "budget-over" : usage.low ? "budget-low" : ""}>
                  ${usage.estCostUsd.toFixed(3)} / ${usage.budgetUsd.toFixed(2)}
                </span>
              </div>
              <div className="budget-bar">
                <div
                  className="budget-fill"
                  style={{
                    width: `${Math.round(usage.fractionUsed * 100)}%`,
                    background: usage.overBudget ? "#ff6b6b" : usage.low ? "#ffd166" : "var(--accent)",
                  }}
                />
              </div>
              {usage.overBudget ? (
                <p className="budget-note budget-over">
                  Budget reached — AI is paused. Recharge at platform.openai.com, then raise budget.
                </p>
              ) : usage.low ? (
                <p className="budget-note budget-low">Running low — ~${usage.remainingUsd.toFixed(2)} left.</p>
              ) : (
                <p className="budget-note">
                  ~${usage.remainingUsd.toFixed(2)} of estimated spend left.
                </p>
              )}
              <div className="budget-actions" style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                <input
                  type="number"
                  min={0}
                  step={1}
                  placeholder={`$${usage.budgetUsd}`}
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  style={{
                    width: "60px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid var(--glass-border)",
                    color: "var(--text)",
                    padding: "4px 6px",
                    borderRadius: "4px",
                    font: "inherit",
                    fontSize: "11px"
                  }}
                />
                <button
                  className="mini"
                  onClick={() => {
                    const v = Number(budgetInput);
                    if (!Number.isFinite(v) || v < 0) return;
                    ensureAdminToken(async () => {
                      const u = await apiSetBudget(v);
                      if (u) {
                        setUsage(u);
                        setBudgetError(null);
                        setBudgetInput("");
                      } else {
                        setAdminToken(""); // forget a bad token so the next click re-asks
                        setBudgetError("Rejected — check the admin token and try again.");
                      }
                    });
                  }}
                  style={{ padding: "4px 8px", fontSize: "11px" }}
                >
                  Set budget
                </button>
                <button
                  className="mini"
                  onClick={() => {
                    ensureAdminToken(async () => {
                      const u = await resetUsage();
                      if (u) {
                        setUsage(u);
                        setBudgetError(null);
                      } else {
                        setAdminToken(""); // forget a bad token so the next click re-asks
                        setBudgetError("Rejected — check the admin token and try again.");
                      }
                    });
                  }}
                  style={{ padding: "4px 8px", fontSize: "11px" }}
                >
                  Reset
                </button>
              </div>
              {budgetError && (
                <p className="budget-note budget-over" style={{ marginTop: "6px" }}>{budgetError}</p>
              )}
            </div>
          )}
        </div>
      </details>

      {/* IM-71: in-app admin-token dialog — same overlay/card pattern as
          ConfirmDialog, with a password input; never window.prompt. */}
      {tokenRequest && (
        <div className="confirm-overlay" onClick={() => setTokenRequest(null)}>
          <div
            className="confirm-card"
            role="dialog"
            aria-modal="true"
            aria-label="Admin token needed"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="confirm-title">Admin token needed</h3>
            <p className="confirm-message">
              Budget changes need the deployment admin token (the ADMIN_TOKEN secret). It's remembered on this device after a successful use.
            </p>
            <input
              type="password"
              className="admin-token-input"
              placeholder="Admin token"
              value={tokenDraft}
              autoFocus
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setTokenRequest(null);
                if (e.key === "Enter" && tokenDraft.trim()) {
                  const req = tokenRequest;
                  setAdminToken(tokenDraft.trim());
                  setTokenRequest(null);
                  req.onReady();
                }
              }}
            />
            <div className="confirm-actions" style={{ marginTop: "12px" }}>
              <button className="mini" onClick={() => setTokenRequest(null)}>
                Cancel
              </button>
              <button
                className="mini"
                disabled={!tokenDraft.trim()}
                onClick={() => {
                  const req = tokenRequest;
                  setAdminToken(tokenDraft.trim());
                  setTokenRequest(null);
                  req.onReady();
                }}
              >
                Save token & continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
