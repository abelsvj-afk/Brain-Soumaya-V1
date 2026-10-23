import { useEffect, useMemo, useState } from "react";
import type { AwayDigest, GraphNode, Constellation, Insight } from "@brain/shared";
import {
  getConstellationsResult,
  getDigestResult,
  getDailyContact,
  answerDailyContact,
  getDueReviewsResult,
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
import { useSpaceTimeZone } from "../utils/spaceTimezone.js";

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
 * The array sources use the strict Result variants (`getDigestResult`,
 * `getConstellationsResult`, `getDueReviewsResult` — IM-124 residual): the
 * legacy fail-soft helpers resolve [] for BOTH failure and genuine empty,
 * which made this error state unreachable for those three sources; the
 * Result variants return `{ ok: false }` on failure and `{ ok: true, … }`
 * (possibly empty) only on a real success. The legacy helpers keep their
 * contract for every other consumer.
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
 * IM-126: Observatory showed NO timestamps anywhere (createdAt was only a
 * sort key) while sibling panels localise dates, and the money card pasted
 * the raw `nextIncomeDate` string ("2026-11-03") into copy. These helpers
 * format for display: a bare date-only string ("YYYY-MM-DD") is formatted
 * in UTC so the day never shifts under the viewer's timezone; anything
 * with a time component localises like the sibling panels do. Returns null
 * for missing/unparseable input so callers can omit the fragment instead
 * of printing a raw or "Invalid Date" string.
 */
export function formatObsDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(
    undefined,
    dateOnly
      ? { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" },
  );
}

export function formatObsDateTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Naive SQLite timestamps ("YYYY-MM-DD HH:MM:SS", no zone) are UTC on the
  // server — normalise before parsing, like TimelineView.normalizeDate, or
  // the localised time is off by the viewer's offset.
  const s = raw.trim();
  const naive = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s);
  const d = new Date(naive ? s.replace(" ", "T") + "Z" : s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** "$42" for whole dollars, "$42.50" otherwise — bill amounts keep their cents. */
export function formatCents(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** "today" / "tomorrow" / "in N days" / "N days ago" for a day offset. */
export function inDaysLabel(inDays: number): string {
  if (inDays === 0) return "today";
  if (inDays === 1) return "tomorrow";
  if (inDays > 1) return `in ${inDays} days`;
  if (inDays === -1) return "yesterday";
  return `${-inDays} days ago`;
}

const INSIGHT_TIER_LABEL: Record<number, string> = {
  1: "identity-level",
  2: "pattern",
  3: "situational",
};

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
      const r = await getDigestResult();
      if (!r.ok) {
        markSource("digest", "error");
        return;
      }
      setInsights(r.insights.slice(0, 3));
      markSource("digest", "ok");
    } catch {
      markSource("digest", "error");
    }
  };
  const loadConstellations = async () => {
    markSource("constellations", "loading");
    try {
      const r = await getConstellationsResult();
      if (!r.ok) {
        markSource("constellations", "error");
        return;
      }
      setConstellations(r.constellations.slice(0, 3));
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
      const r = await getDueReviewsResult();
      if (!r.ok) {
        markSource("reviews", "error");
        return;
      }
      setDueReview(r.reviews[0] ?? null);
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
  // Audit-2 item 2: the quest day boundary, per-day state key and
  // tendedOnDay checks all follow the SPACE's configured timezone (the
  // hook re-renders us once it loads, and the memo re-derives).
  const spaceTimeZone = useSpaceTimeZone();
  const questResult = useMemo(
    () => resolveDailyQuests(memories, fedToday, { dayState: loadQuestDayState(questKey), timeZone: spaceTimeZone }),
    [memories, fedToday, questKey, spaceTimeZone],
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
              {/* IM-125: the digest's own greeting + the moment the absence
                  began were fetched but never rendered. */}
              {away.greeting && <span className="obs-line">{away.greeting}</span>}
              {formatObsDateTime(away.since) && (
                <span className="obs-meta">Away since {formatObsDateTime(away.since)}</span>
              )}
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
                    <button key={r.id} className="obs-chip" onClick={() => onFocus(r.id)} title={`${r.label} — reminder due, fly to it`}>
                      🔔 {r.label.length > 24 ? `${r.label.slice(0, 24)}…` : r.label}
                    </button>
                  ))}
                  {away.resurfaced && (
                    <button
                      className="obs-chip"
                      onClick={() => onFocus(away.resurfaced!.id)}
                      title={`${away.resurfaced.label} — resurfaced from ${away.resurfaced.dormantDays} days ago`}
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
                    <span key={n.id} className="obs-chip-static" title={n.label}>
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
              {/* IM-125: how faded this memory is + how often it's been
                  recalled were fetched but never shown. */}
              <span className="obs-meta">
                memory strength {Math.round(dueReview.strength * 100)}% ·{" "}
                {dueReview.reviewCount === 0
                  ? "first recall"
                  : `recalled ${dueReview.reviewCount} time${dueReview.reviewCount === 1 ? "" : "s"} before`}
              </span>
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
              {/* IM-125: when she expects it — fetched, never rendered. */}
              <span className="obs-meta">expected {inDaysLabel(contact.foresight.inDays)}</span>
            </span>
          </div>
        )}
        {contact?.discovery && (
          <button
            className="obs-card"
            onClick={() => {
              // IM-126: nodeId: null is a type-allowed server answer; the
              // old handler silently no-opped, so the button looked broken.
              // Say so, and land the user where discoveries live instead.
              if (contact.discovery!.nodeId != null) {
                onFocus(contact.discovery!.nodeId!);
              } else {
                pushToast("That discovery isn't tied to one memory — opening her observations instead.", "🔭", 4500);
                onOpenInsights();
              }
            }}
            title={contact.discovery.text}
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
                  ? // IM-126: nextIncomeDate was interpolated RAW ("…before
                    // 2026-11-03") — format it, and drop the clause entirely
                    // when there's no parseable date rather than print one.
                    `⚠️ short $${Math.round(finance.budget.shortfallCents / 100)}${formatObsDate(finance.budget.nextIncomeDate) ? ` before ${formatObsDate(finance.budget.nextIncomeDate)}` : " before your next income"}`
                  : `${finance.upcomingTotal} bill${finance.upcomingTotal === 1 ? "" : "s"} coming up`}
              </span>
              {/* IM-125: the bills themselves — names, due dates, amounts —
                  were fetched but the card only ever counted them. */}
              {finance.upcoming.slice(0, 3).map((b) => (
                <span key={b.id} className="obs-bill">
                  <span className="obs-bill-name">{b.name}</span>
                  <span className="obs-bill-meta">
                    {formatObsDate(b.dueDate) ?? b.dueDate} · {formatCents(b.amountCents)}
                  </span>
                </span>
              ))}
              {finance.upcomingTotal > 3 && (
                <span className="obs-meta">+{finance.upcomingTotal - 3} more in Money</span>
              )}
              {finance.budget.weekEarnedCents > 0 && (
                <span className="obs-meta">Earned this week {formatCents(finance.budget.weekEarnedCents)}</span>
              )}
              {/* IM-125: what the balance is already holding for named bills. */}
              {(finance.budget.reserved ?? []).slice(0, 3).map((r) => (
                <span key={r.billId} className="obs-bill">
                  <span className="obs-bill-name">Reserved for {r.name}</span>
                  <span className="obs-bill-meta">
                    {formatObsDate(r.dueDate) ?? r.dueDate} · {formatCents(r.amountCents)}
                  </span>
                </span>
              ))}
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
                  <span className="obs-jn-name">
                    {/* IM-125: the journey's own accent colour, fetched but unused. */}
                    {j.color && <span className="obs-jn-dot" style={{ background: j.color }} aria-hidden="true" />}
                    {j.icon ?? "🧭"} {j.title}
                    {typeof j.linkCount === "number" && <span className="obs-meta"> · {j.linkCount} linked</span>}
                  </span>
                  {/* IM-125: what the journey IS — its description never rendered here. */}
                  {j.description && <span className="obs-line obs-clamp">{j.description}</span>}
                  <span className="obs-jn-bar"><span className="obs-jn-fill" style={{ width: `${Math.round((j.progress ?? 0) * 100)}%` }} /></span>
                  {formatObsDate(j.updatedAt) && <span className="obs-meta">updated {formatObsDate(j.updatedAt)}</span>}
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
                  title={ins.text}
                >
                  <span className="obs-line obs-clamp">{ins.text}</span>
                  {/* IM-125/IM-126: kind, tier, strength (score) and WHEN she
                      saw it were all fetched and none rendered — createdAt
                      was only ever a sort key. */}
                  <span className="obs-meta">
                    {[
                      ins.kind === "contradiction" ? "⚡ contradiction" : "✦ connection",
                      ins.tier ? INSIGHT_TIER_LABEL[ins.tier] ?? null : null,
                      `strength ${Math.round(ins.score * 100)}%`,
                      formatObsDateTime(ins.createdAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
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
                    title={`${c.name} — ${c.nodes.length} memories, cohesion ${Math.round(c.cohesion * 100)}%`}
                  >
                    {c.name}
                    {/* IM-125: how tightly the cluster holds together. */}
                    <span className="obs-chip-sub"> · {Math.round(c.cohesion * 100)}%</span>
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
                  <button
                    key={n.id}
                    className="obs-chip"
                    onClick={() => onFocus(n.id)}
                    // IM-126: labels truncate at 28 chars — the full text
                    // (and when it was captured, IM-126's timestamp) must be
                    // reachable, incl. on touch via the visible date.
                    title={formatObsDateTime(n.createdAt) ? `${n.label} — ${formatObsDateTime(n.createdAt)}` : n.label}
                  >
                    {n.label.length > 28 ? `${n.label.slice(0, 28)}…` : n.label}
                    {formatObsDate(n.createdAt) && <span className="obs-chip-sub"> · {formatObsDate(n.createdAt)}</span>}
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
