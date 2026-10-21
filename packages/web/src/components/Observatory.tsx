import { useEffect, useMemo, useState } from "react";
import type { AwayDigest, GraphNode, Constellation, Insight } from "@brain/shared";
import {
  getConstellations,
  getDigest,
  getDailyContact,
  answerDailyContact,
  getDueReviews,
  type DailyContact,
  type DueReview,
} from "../api/client.js";
import {
  allQuestsDone,
  loadQuestDayState,
  questDayStorageKey,
  resolveDailyQuests,
  saveQuestDayState,
} from "./quests.js";
import { playSfx } from "../graph/sfx.js";
import { pushToast } from "./Toasts.js";
import { SoumayaEye } from "./SoumayaEye.js";
import type { Journey } from "@brain/shared";
import { getFinanceSummary, type FinanceSummary } from "../api/finance.js";
import { getJourneys } from "../api/journeys.js";
import { isReminderDue } from "../utils/dueReminders.js";

/** Why she's asking — the icon that frames her daily question. */
const CONTACT_ICON: Record<string, string> = {
  research: "🔬",
  contradiction: "⚡",
  cooling: "❄️",
  heavy: "🖤",
};

/**
 * IM-124: truthful per-source load state for the Observatory's six fetches.
 *
 * State is modelled PER FETCH SOURCE, not per card: one source can feed
 * several cards (the Daily Contact alone drives the question, answered,
 * foresight and discovery cards), so per-card state would duplicate the
 * same fetch's status — and its Retry — across siblings.
 *
 * A source is "error" when its fetch rejects, or — for the helpers whose
 * contract is "null on ANY failure" (`getDailyContact`, `getFinanceSummary`,
 * `getJourneys`; the same rule JourneysPanel applies to `getJourneys`) —
 * when it resolves null. The server's success responses for those three are
 * always an object/array, so null can only mean failure, never "empty".
 * The array helpers (`getDigest`, `getConstellations`, `getDueReviews`)
 * resolve [] for a genuine empty result; [] is therefore success-empty.
 */
type SourceKey = "digest" | "constellations" | "contact" | "finance" | "journeys" | "reviews";
type SourceStatus = "loading" | "ok" | "error";

const SOURCE_LABEL: Record<SourceKey, string> = {
  digest: "her observations",
  constellations: "your constellations",
  contact: "her daily question",
  finance: "your money glance",
  journeys: "your journeys",
  reviews: "your recall pick",
};

/** "13 hours" / "2 days" from an away duration. */
function humanAway(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "a little while";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"}`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"}`;
}

/**
 * The Observatory — a calm home that fades in *after* the cinematic fly-in settles
 * (it never touches the intro). A handful of live, click-through cards orient the
 * owner in one glance instead of dropping them into the full galaxy. Progressive
 * disclosure: essentials here, detail one click deeper. Every card degrades to
 * nothing if its data genuinely isn't there — but since IM-124 a fetch that
 * FAILED says so (error card + Retry) and one still in flight shows a skeleton,
 * so "nothing to report" is never confused with "server down"; the galaxy is
 * always reachable via "Enter the galaxy".
 *
 * This is the ONE arrival screen: the "while you were away" report renders as its
 * top card (a separate welcome-back overlay used to stack on top of this — two
 * pop-ups both saying "welcome back" with their own Enter buttons).
 */
export function Observatory({
  spaceName,
  spaceId,
  memories,
  streak,
  fedToday,
  away,
  onCapture,
  onFocus,
  onOpenInsights,
  onEnter,
  onOpenTab,
  onSearch,
  actionCount = 0,
}: {
  spaceName: string;
  /** Brain id — scopes the persisted quest day state (per-brain localStorage). */
  spaceId?: string;
  memories: GraphNode[]; // non-action nodes
  streak: number;
  fedToday: boolean;
  /** "While you were away" digest (null/undefined = nothing to report). */
  away?: AwayDigest | null;
  onCapture: () => void;
  onFocus: (id: number) => void;
  onOpenInsights: () => void;
  onEnter: () => void;
  /** Open a dock tab (Mission Control cards route here — money, journeys, …). */
  onOpenTab?: (tab: string) => void;
  /** Open the search box — the floating 🔍 tool sits behind this full-screen
   *  overlay (z-index), so without this, search is unreachable from the very
   *  first screen a returning user sees (OPTIMIZATION_ROADMAP.md Problem 4). */
  onSearch?: () => void;
  /** Open "action item" count — actions aren't in `memories`, so it's passed separately. */
  actionCount?: number;
}) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [constellations, setConstellations] = useState<Constellation[]>([]);
  // The Daily Contact — she initiates; answering right here feeds the brain.
  const [contact, setContact] = useState<DailyContact | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  // Mission Control daily-loop data: the money glance + active journeys.
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [journeys, setJourneys] = useState<Journey[]>([]);
  // "Worth a moment" — the spaced-repetition system's pick, distinct from the
  // dormant-list resurfacing above (`away.resurfaced`): one answers "what have
  // you used to care about and stopped," the other "what's due for active recall."
  const [dueReview, setDueReview] = useState<DueReview | null>(null);

  // IM-124: per-source status (see SourceKey note above). Every source starts
  // "loading"; a card's absence now has three distinct meanings the UI keeps
  // apart — still loading (skeleton), failed (error card + Retry), or loaded
  // and genuinely empty (no card, exactly as designed).
  const [sourceStatus, setSourceStatus] = useState<Record<SourceKey, SourceStatus>>({
    digest: "loading",
    constellations: "loading",
    contact: "loading",
    finance: "loading",
    journeys: "loading",
    reviews: "loading",
  });
  const markSource = (key: SourceKey, status: SourceStatus) =>
    setSourceStatus((prev) => (prev[key] === status ? prev : { ...prev, [key]: status }));

  const loadDigest = async () => {
    markSource("digest", "loading");
    try {
      const items = await getDigest();
      setInsights(items.slice(0, 3));
      markSource("digest", "ok");
    } catch {
      markSource("digest", "error");
    }
  };
  const loadConstellations = async () => {
    markSource("constellations", "loading");
    try {
      const c = await getConstellations();
      setConstellations(c.slice(0, 3));
      markSource("constellations", "ok");
    } catch {
      markSource("constellations", "error");
    }
  };
  const loadContact = async () => {
    markSource("contact", "loading");
    try {
      const c = await getDailyContact();
      // Null here is the helper's failure signal, not an empty day — the
      // server always answers with a DailyContact object on success.
      if (c === null) {
        markSource("contact", "error");
        return;
      }
      setContact(c);
      markSource("contact", "ok");
    } catch {
      markSource("contact", "error");
    }
  };
  const loadFinance = async () => {
    markSource("finance", "loading");
    try {
      const f = await getFinanceSummary();
      if (f === null) {
        markSource("finance", "error");
        return;
      }
      setFinance(f);
      markSource("finance", "ok");
    } catch {
      markSource("finance", "error");
    }
  };
  const loadJourneys = async () => {
    markSource("journeys", "loading");
    try {
      const j = await getJourneys();
      // Same null-means-failure contract JourneysPanel relies on.
      if (j === null) {
        markSource("journeys", "error");
        return;
      }
      setJourneys(j.filter((x) => x.status === "active").slice(0, 3));
      markSource("journeys", "ok");
    } catch {
      markSource("journeys", "error");
    }
  };
  const loadReviews = async () => {
    markSource("reviews", "loading");
    try {
      const d = await getDueReviews();
      setDueReview(d[0] ?? null);
      markSource("reviews", "ok");
    } catch {
      markSource("reviews", "error");
    }
  };

  const LOADERS: Record<SourceKey, () => Promise<void>> = {
    digest: loadDigest,
    constellations: loadConstellations,
    contact: loadContact,
    finance: loadFinance,
    journeys: loadJourneys,
    reviews: loadReviews,
  };

  useEffect(() => {
    void loadDigest();
    void loadConstellations();
    void loadContact();
    void loadFinance();
    void loadJourneys();
    void loadReviews();
    // Mount-only: the loaders are stable setters + imported fetchers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Today's tending (CL1): the day's quest targets are baselined once per
  // space-local day and persisted per brain, so a quest can truthfully show
  // itself complete (see quests.ts) instead of vanishing or treadmilling.
  const questKey = questDayStorageKey(spaceId ?? spaceName);
  const questResult = useMemo(
    () => resolveDailyQuests(memories, fedToday, { dayState: loadQuestDayState(questKey) }),
    [memories, fedToday, questKey],
  );
  useEffect(() => {
    saveQuestDayState(questKey, questResult.dayState);
  }, [questKey, questResult.dayState]);

  const failedSources = (Object.keys(sourceStatus) as SourceKey[]).filter((k) => sourceStatus[k] === "error");
  const anyLoading = (Object.keys(sourceStatus) as SourceKey[]).some((k) => sourceStatus[k] === "loading");
  /** Re-run ONLY the fetches that failed — successful sections are untouched. */
  const retryFailed = () => {
    for (const k of failedSources) void LOADERS[k]();
  };

  // IM-124 loading treatment: a shimmer skeleton in the fetched-cards zone,
  // following the app's DigestPanel skeleton idiom (`.loading-shimmer`).
  const loadingCard = anyLoading ? (
    <div className="obs-card obs-loading loading-shimmer" aria-live="polite" data-testid="observatory-loading">
      <span className="obs-ic">🛰️</span>
      <span className="obs-body skeleton-section">
        <span className="obs-skel-bar" style={{ width: "55%" }} />
        <span className="obs-skel-bar" style={{ width: "85%" }} />
        <span className="obs-line">Gathering your arrival briefing…</span>
      </span>
    </div>
  ) : null;

  // IM-124 error treatment: a failed section is visibly NOT an empty one.
  const errorCard =
    failedSources.length > 0 ? (
      <div className="obs-card obs-error" role="alert">
        <span className="obs-ic">⚠️</span>
        <span className="obs-body">
          <span className="obs-title">Couldn't load everything</span>
          <span className="obs-line">
            {failedSources.map((k) => SOURCE_LABEL[k]).join(", ")} didn't answer — that's a loading problem, not an
            empty galaxy.
          </span>
          <span>
            <button className="obs-retry" onClick={retryFailed}>
              Retry
            </button>
          </span>
        </span>
      </div>
    ) : null;
  // The welcome-home motif used to play from the separate away card.
  useEffect(() => {
    if (away) playSfx("welcome");
  }, [away]);

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await answerDailyContact(text);
      if (r) {
        setContact((c) => (c ? { ...c, answered: true } : c));
        setReply("");
        playSfx("achievement");
        pushToast(
          `She's weaving your answer into the galaxy ✦ +${Math.round(r.fuelEarned * 10) / 10} ⛽${r.streakAdvanced ? " · 🔥 streak fed" : ""}`,
          "🛰️",
          6500,
        );
      } else {
        pushToast("Couldn't reach her — try again in a moment.", "⚠️", 4500);
      }
    } finally {
      setSending(false);
    }
  };

  const count = memories.length;
  // Most-recent memories ("jump back in") — newest first by created time.
  const recent = [...memories]
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, 3);
  // Today's agenda — due reminders (memories carry remind_at; actions never do,
  // isReminderDue already excludes them) plus the open action-item count passed
  // in separately, since actions aren't part of `memories`.
  const dueReminders = memories.filter((n) => isReminderDue(n));

  // New brain: a single calm hero, not an empty card grid. (IM-124: if a fetch
  // failed, the error treatment still shows — "server down" must never read
  // as just the empty-galaxy hero. No skeleton here: the hero renders no
  // fetched sections, so there is no fetched section to be "loading".)
  if (count === 0) {
    return (
      <div className="observatory" role="dialog" aria-label="Welcome">
        <div className="obs-stack">
          <div className="obs-card obs-hero">
            <h2>Welcome, {spaceName}.</h2>
            <p>Your galaxy is empty. Drop your first thought and watch it become a star.</p>
            <button className="obs-primary" onClick={onCapture}>
              ✍️ Drop your first thought
            </button>
            <button className="obs-enter" onClick={onEnter}>
              Enter the galaxy →
            </button>
          </div>
          {errorCard}
        </div>
      </div>
    );
  }

  return (
    <div className="observatory" role="dialog" aria-label="Observatory home">
      <div className="obs-stack">
        <header className="obs-head">
          <h2>Welcome back, {spaceName}.</h2>
          <span className="obs-sub">
            {count} {count === 1 ? "memory" : "memories"}
            {streak > 0 ? ` · 🔥 ${streak}-day streak` : ""}
            {away ? ` · away ${humanAway(away.awayMs)}` : ""}
          </span>
          {onSearch && (
            <button className="obs-search" onClick={onSearch} aria-label="Search your memories" title="Search">
              🔍
            </button>
          )}
          <button className="obs-close" onClick={onEnter} aria-label="Close and enter the galaxy">
            ×
          </button>
        </header>

        {/* IM-124: fetched sections announce themselves while loading / on
            failure instead of silently never appearing. Prop-derived cards
            (away, agenda, capture, quests, recent) render immediately. */}
        {loadingCard}
        {errorCard}

        {away && (
          <div className="obs-card obs-away">
            <span className="obs-ic">🛰️</span>
            <span className="obs-body">
              <span className="obs-title">While you were away</span>
              {away.agentActions.length > 0 && (
                <span className="obs-line">
                  ✦ She {away.agentActions.map((a) => a.label).join(", ")}.
                </span>
              )}
              {(away.newContradictions > 0 || away.expiredActions > 0 || away.cooling > 0) && (
                <span className="obs-line">
                  {[
                    away.newContradictions > 0
                      ? `⚡ ${away.newContradictions} contradiction${away.newContradictions === 1 ? "" : "s"} to reconcile`
                      : null,
                    away.expiredActions > 0
                      ? `⏰ ${away.expiredActions} action${away.expiredActions === 1 ? "" : "s"} expired`
                      : null,
                    away.cooling > 0 ? `❄️ ${away.cooling} cooling` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
              {(away.dueReminders.length > 0 || away.resurfaced) && (
                <span className="obs-chips">
                  {away.dueReminders.map((r) => (
                    <button key={r.id} className="obs-chip" onClick={() => onFocus(r.id)} title="Reminder due — fly to it">
                      🔔 {r.label.length > 24 ? `${r.label.slice(0, 24)}…` : r.label}
                    </button>
                  ))}
                  {away.resurfaced && (
                    <button
                      className="obs-chip"
                      onClick={() => onFocus(away.resurfaced!.id)}
                      title={`Resurfaced from ${away.resurfaced.dormantDays} days ago`}
                    >
                      💤 {away.resurfaced.label.length > 24 ? `${away.resurfaced.label.slice(0, 24)}…` : away.resurfaced.label}
                    </button>
                  )}
                </span>
              )}
            </span>
          </div>
        )}

        {(dueReminders.length > 0 || actionCount > 0) && (
          <button
            className="obs-card obs-agenda"
            onClick={() => (onOpenTab ? onOpenTab("actions") : onEnter())}
            title="Open Agenda"
          >
            <span className="obs-ic">📌</span>
            <span className="obs-body">
              <span className="obs-title">Today's agenda</span>
              <span className="obs-line">
                {[
                  dueReminders.length > 0
                    ? `🔔 ${dueReminders.length} reminder${dueReminders.length === 1 ? "" : "s"} due`
                    : null,
                  actionCount > 0 ? `📌 ${actionCount} open action${actionCount === 1 ? "" : "s"}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {dueReminders.length > 0 && (
                <span className="obs-chips">
                  {dueReminders.slice(0, 2).map((n) => (
                    <span key={n.id} className="obs-chip-static">
                      {n.label.length > 24 ? `${n.label.slice(0, 24)}…` : n.label}
                    </span>
                  ))}
                </span>
              )}
            </span>
          </button>
        )}

        {dueReview && (
          <button className="obs-card obs-recall" onClick={() => onFocus(dueReview.id)} title="Worth a moment — active recall">
            <span className="obs-ic">🌱</span>
            <span className="obs-body">
              <span className="obs-title">Worth a moment</span>
              <span className="obs-line obs-clamp">{dueReview.label}</span>
            </span>
          </button>
        )}

        {/* Her Daily Contact — the reason to come back: SHE has something for you. */}
        {contact?.question && !contact.answered && (
          <div className="obs-card obs-contact">
            <span className="obs-ic">
              <SoumayaEye state="idle" mood="thoughtful" size={26} />
            </span>
            <span className="obs-body">
              <span className="obs-title">
                {CONTACT_ICON[contact.question.source] ?? "🪞"} She has a question for you
              </span>
              <span className="obs-line">{contact.question.text}</span>
              {contact.question.nodeId != null && (
                <button
                  className="obs-chip"
                  onClick={() => onFocus(contact.question!.nodeId!)}
                  title="Fly to the memory she's asking about"
                >
                  ✦ {contact.question.nodeLabel}
                </button>
              )}
              <span className="obs-answer">
                <textarea
                  rows={2}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Answer her — it becomes a memory…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void sendReply();
                    }
                  }}
                />
                <button className="obs-answer-send" onClick={() => void sendReply()} disabled={sending || !reply.trim()}>
                  {sending ? "…" : "➤"}
                </button>
              </span>
            </span>
          </div>
        )}
        {contact?.question && contact.answered && (
          <div className="obs-card obs-contact answered">
            <span className="obs-ic">✓</span>
            <span className="obs-body">
              <span className="obs-title">You answered her today</span>
              <span className="obs-line">She's weaving it in — come back tomorrow, she'll have a new one.</span>
            </span>
          </div>
        )}
        {contact?.foresight && (
          <div className="obs-card obs-foresight">
            <span className="obs-ic">🔮</span>
            <span className="obs-body">
              <span className="obs-title">She sees a pattern coming</span>
              <span className="obs-line">{contact.foresight.text}</span>
            </span>
          </div>
        )}
        {contact?.discovery && (
          <button
            className="obs-card"
            onClick={() => contact.discovery!.nodeId != null && onFocus(contact.discovery!.nodeId!)}
            title="Her best recent find"
          >
            <span className="obs-ic">🔭</span>
            <span className="obs-body">
              <span className="obs-title">Her discovery of the day</span>
              <span className="obs-line obs-clamp">{contact.discovery.text}</span>
            </span>
          </button>
        )}

        {finance && (finance.budget.balanceCents !== 0 || finance.upcoming.length > 0) && (
          <button className="obs-card obs-money" onClick={() => (onOpenTab ? onOpenTab("money") : onEnter())} title="Open Money">
            <span className="obs-ic">💵</span>
            <span className="obs-body">
              <span className="obs-title">Safe to spend</span>
              <span className="obs-money-amt">${Math.round(finance.budget.safeToSpendCents / 100)}</span>
              <span className="obs-line">
                {finance.budget.shortfallCents > 0
                  ? `⚠️ short $${Math.round(finance.budget.shortfallCents / 100)} before ${finance.budget.nextIncomeDate}`
                  : `${finance.upcoming.length} bill${finance.upcoming.length === 1 ? "" : "s"} coming up`}
              </span>
            </span>
          </button>
        )}

        {journeys.length > 0 && (
          <button className="obs-card obs-journeys" onClick={() => (onOpenTab ? onOpenTab("journeys") : onEnter())} title="Open Journeys">
            <span className="obs-ic">🧭</span>
            <span className="obs-body">
              <span className="obs-title">Your journeys</span>
              {journeys.map((j) => (
                <span key={j.id} className="obs-jn">
                  <span className="obs-jn-name">{j.icon ?? "🧭"} {j.title}</span>
                  <span className="obs-jn-bar"><span className="obs-jn-fill" style={{ width: `${Math.round((j.progress ?? 0) * 100)}%` }} /></span>
                </span>
              ))}
            </span>
          </button>
        )}

        <button className="obs-card obs-action" onClick={onCapture}>
          <span className="obs-ic">✍️</span>
          <span className="obs-body">
            <span className="obs-title">Capture a thought</span>
            <span className="obs-line">Add to your galaxy — it links itself.</span>
          </span>
        </button>

        {(() => {
          const quests = questResult.quests;
          const doneCount = quests.filter((q) => q.done).length;
          const allDone = allQuestsDone(quests);
          return (
            <div className="obs-card obs-quests">
              <span className="obs-ic">🎯</span>
              <span className="obs-body">
                <span className="obs-title">Today's tending</span>
                {quests.length > 0 && (
                  <span className="obs-line obs-quest-progress">{`${doneCount}/${quests.length} done`}</span>
                )}
                {quests.length === 0 ? (
                  <span className="obs-line">Nothing needs tending right now.</span>
                ) : (
                  <span className="obs-questlist">
                    {quests.map((q) => (
                      <button
                        key={q.id}
                        className={`obs-quest ${q.done ? "done" : ""}`}
                        onClick={() => (q.action === "capture" ? onCapture() : q.focusId != null ? onFocus(q.focusId) : onOpenInsights())}
                        disabled={q.done}
                      >
                        <span className="obs-quest-ic">{q.done ? "✓" : q.icon}</span>
                        {q.text}
                      </button>
                    ))}
                  </span>
                )}
                {allDone && <span className="obs-line obs-quests-done">All tended for today ✓</span>}
              </span>
            </div>
          );
        })()}

        {/* (The old "surfaced a connection" card merged into "Her discovery of the
            day" above — same data.) Shows up to 3 — previously only ever the first,
            even though the digest already had more to say. */}
        {!contact?.discovery && insights.length > 0 && (
          <div className="obs-card obs-observations">
            <span className="obs-ic">🔭</span>
            <span className="obs-body">
              <span className="obs-title">{insights.length > 1 ? "AI observations" : "Her discovery of the day"}</span>
              {insights.map((ins) => (
                <button
                  key={ins.id}
                  className="obs-observation-row"
                  onClick={() => (ins.nodes[0] ? onFocus(ins.nodes[0].id) : onOpenInsights())}
                  title="See the connection"
                >
                  <span className="obs-line obs-clamp">{ins.text}</span>
                </button>
              ))}
            </span>
          </div>
        )}

        {constellations.length > 0 && (
          <div className="obs-card obs-constellations">
            <span className="obs-ic">✦</span>
            <span className="obs-body">
              <span className="obs-title">Your constellations</span>
              <span className="obs-chips">
                {constellations.map((c) => (
                  <button
                    key={c.id}
                    className="obs-chip"
                    onClick={() => c.nodes[0] && onFocus(c.nodes[0].id)}
                    title={`${c.nodes.length} memories`}
                  >
                    {c.name}
                  </button>
                ))}
              </span>
            </span>
          </div>
        )}

        {recent.length > 0 && (
          <div className="obs-card obs-recent">
            <span className="obs-ic">🛰️</span>
            <span className="obs-body">
              <span className="obs-title">Jump back in</span>
              <span className="obs-chips">
                {recent.map((n) => (
                  <button key={n.id} className="obs-chip" onClick={() => onFocus(n.id)}>
                    {n.label.length > 28 ? `${n.label.slice(0, 28)}…` : n.label}
                  </button>
                ))}
              </span>
            </span>
          </div>
        )}

        <button className="obs-enter" onClick={onEnter}>
          Enter the galaxy →
        </button>
      </div>
    </div>
  );
}
