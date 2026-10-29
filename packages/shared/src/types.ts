/**
 * Core domain types shared between server and web.
 * These describe the knowledge graph as the frontend (react-force-graph-3d)
 * and the API consume it.
 */

/**
 * The "Wire the Brain" taxonomy — what a memory IS. CRM-flavored + link-first
 * (see docs/SECOND_BRAIN_ALIGNMENT.md). Legacy values (business_idea,
 * relationship_reflection, random_thought) are mapped onto these via
 * LEGACY_NODE_TYPE_ALIASES + normalizeNodeType, so existing galaxies stay
 * coherent without a data migration (node.type is free TEXT).
 */
export type NodeType =
  | "person"
  | "project"
  | "decision"
  | "company"
  | "meeting"
  | "daily"
  | "knowledge"
  | "concept"
  | "other"
  | "moc"; // a constellation hub (Map of Content) — structural, not LLM-extracted

/** Old stored type values → their canonical kind (display/classification only). */
export const LEGACY_NODE_TYPE_ALIASES: Record<string, NodeType> = {
  business_idea: "project",
  relationship_reflection: "person",
  random_thought: "daily",
};

/** Human label per kind (UI chips, legend). */
export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  person: "Person",
  project: "Project",
  decision: "Decision",
  company: "Company",
  meeting: "Meeting",
  daily: "Daily",
  knowledge: "Knowledge",
  concept: "Concept",
  other: "Other",
  moc: "Constellation",
};

/** One-line guidance per kind — fed to the extraction prompt for classification. */
export const NODE_TYPE_GUIDE: Record<NodeType, string> = {
  person: "an individual — someone you know, met, or mentioned",
  company: "an organization, business, team, or institution",
  project: "an initiative or effort with an outcome (a venture, build, plan)",
  decision: "a choice made or being weighed, with its rationale",
  meeting: "a conversation, call, or sync at a point in time, involving people",
  daily: "a day-to-day note, journal entry, to-do, or fleeting thought",
  knowledge: "a reference fact, concept explainer, or learning worth keeping",
  concept: "an abstract idea, theme, or principle",
  other: "anything that fits none of the above",
  moc: "(structural hub — created by promotion, never extracted)",
};

/** Normalize any stored/raw type string to a canonical kind (legacy-tolerant). */
export function normalizeNodeType(raw: string | null | undefined): NodeType {
  if (!raw) return "other";
  if ((NODE_TYPES as readonly string[]).includes(raw)) return raw as NodeType;
  return LEGACY_NODE_TYPE_ALIASES[raw] ?? "other";
}

export type RelationshipType =
  | "resolves"
  | "complicates"
  | "is_analogous_to"
  | "builds_on"
  | "relates_to"
  | "contradicts"
  | "caused_by"
  | "documentation"
  | "summarizes" // a constellation hub → one of its member memories
  | "supports"; // a memory/idea → a cognitive anchor (goal/identity/skill)

/** Convenience runtime lists (also exercised by the seed script). */
export const NODE_TYPES: readonly NodeType[] = [
  "person",
  "project",
  "decision",
  "company",
  "meeting",
  "daily",
  "knowledge",
  "concept",
  "other",
  "moc",
];

/** Kinds the extraction LLM may assign (excludes the structural `moc` hub). */
export const EXTRACTABLE_NODE_TYPES: readonly NodeType[] = NODE_TYPES.filter((t) => t !== "moc");

export const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  "resolves",
  "complicates",
  "is_analogous_to",
  "builds_on",
  "relates_to",
  "contradicts",
  "caused_by",
  "documentation",
];

export interface GraphNode {
  id: number;
  label: string;
  celestialTitle?: string;
  type: NodeType;
  content: string;
  /** -1 (negative) .. 1 (positive); optional, set by the LLM in Phase II. */
  emotionalWeight?: number;
  /** Hex or CSS color suggestion based on emotional resonance. */
  color?: string;
  /** Who authored this node: "agent" = Soumaya (e.g. a constellation hub), else yours. */
  origin?: "user" | "agent";
  /** Which autonomous agent last worked this node (e.g. "soumaya", "scout"). */
  agent?: string;
  /** 0..1 significance/seriousness/life-impact, rated at ingestion. */
  importance?: number;
  /** Connection count — enriched by the graph service on read. */
  degree?: number;
  /** 0..1 derived gravitational mass (deriveMass of the signals above). */
  mass?: number;
  /** Body class derived from mass — drives rendering (star/planet/moon). */
  celestial?: import("./celestial.js").CelestialClass;
  /** react-force-graph node size hint (mirrors mass). */
  val?: number;
  /** "action" = a transient to-do; "moc" = a constellation hub; "belief" = a
   *  consolidated understanding she distilled from a cluster (dream cycles); a
   *  CognitiveKind ("goal"/"idea"/"skill"/… — the cognitive layer, see
   *  docs/COGNITIVE_LAYER.md); else a normal memory. */
  kind?: "memory" | "action" | "moc" | "belief" | import("./celestial.js").CognitiveKind;
  /** Lifecycle: "archived" rests out of the galaxy + retrieval (kept, not deleted). */
  status?: "active" | "archived";
  /** 0..1 progress — goal completion / skill level (cognitive layer). */
  progress?: number;
  /** Cognitive layer: other names for this entry ("girlfriend", "my girl") so vague
   *  memories link to it without the exact label. */
  aliases?: string[];
  /** For a `moc` hub: how many member memories it consolidates (enriched on read). */
  memberCount?: number;
  /** 0..1 spaced-repetition memory strength (enriched on read). Low = faded, the
   *  "come review me" cue; drives the star's brightness. See NEURO_ALIGNMENT #1. */
  reviewStrength?: number;
  /** ISO timestamp when an action item times out (only for kind === "action"). */
  expiresAt?: string;
  /** ISO timestamp this memory was last "tended" (created/visited/edited/linked). */
  lastTendedAt?: string;
  /** 0..1 "coolness" from neglect — enriched on read (0 = freshly tended). */
  entropy?: number;
  /** Optional user-set date/time the memory's event actually happened (may be backdated). */
  occurredAt?: string;
  /** Optional user-set future reminder date/time to resurface this memory. */
  remindAt?: string;
  /** ISO timestamp this reminder was last delivered (fired); undefined =
   *  never fired / pending. A reschedule re-arms the reminder by clearing
   *  this (REG-140) — the web shows it wherever the time can be changed. */
  reminderFiredAt?: string;
  /** Free + curated labels for filtering/context (e.g. "Work", "Idea", "Anxious"). */
  tags?: string[];
  researchQuestions?: string[];
  researchAnswers?: Record<string, string>;
  createdAt: string;
  /**
   * Verbatim-Recall V1 provenance plumbing (design section 12D): true
   * when this node carries at least one ACTIVE `origin` link to a
   * preserved source in node_sources — i.e. it was extracted from the
   * owner's own captured words. Absent/false for machine-made nodes
   * (research expansions, dream output) and all pre-V1 legacy nodes.
   * Enriched on read by the server; never stored on the node row.
   */
  hasOriginSource?: boolean;
}

/** Curated starter tags offered in the dump UI: a blend of life-areas + moods. */
export const SUGGESTED_TAGS: readonly string[] = [
  "Work",
  "Health",
  "Ideas",
  "People",
  "Money",
  "Learning",
  "Excited",
  "Anxious",
  "Grateful",
  "Urgent",
];

/** What a piece of lore is about: a memory body, or one of the agents/objects. */
export type LoreSubjectType = "memory" | "ship" | "station" | "beacon";

/**
 * A single saved "chapter" of an object's evolving lore. Lore is append-only and
 * versioned: v1 is the immutable genesis, later versions extend/mutate it as the
 * galaxy changes — so you can read how a memory's story grew over time.
 */
export interface LoreEntry {
  id: number;
  subjectType: LoreSubjectType;
  subjectId: string;
  version: number;
  text: string;
  /** What prompted this chapter: genesis | evolved | linked | merged | cooled | warmed | manual. */
  trigger: string;
  createdAt: string;
}

/** The brain's "fuel" — a free in-app energy that powers Soumaya's autonomy. */
export interface Fuel {
  /** Current fuel for this brain. */
  fuel: number;
  /** Soft ceiling fuel saturates at. */
  capacity: number;
  /** Cost the agent pays per autonomous LLM job. */
  jobCost: number;
  /** Cost the user pays per warp between spaces (Worlds travel, Phase 2). */
  warpCost: number;
}

/** How a travel journey moves (Worlds travel, Phase 2). */
export type TravelKind = "warp" | "drift";

/** Lifecycle of one travel journey, as recorded by the server's ledger. */
export type TravelJourneyState =
  | "arming"
  | "in_transit"
  | "returning"
  | "arrived"
  | "returned"
  | "cancelled";

/** One journey between worlds, as the server reports it (P2-2). */
export interface TravelJourney {
  id: string;
  kind: TravelKind;
  /** World key the journey started from — always server-derived. */
  origin: string;
  /** World key the journey is headed to. */
  destination: string;
  state: TravelJourneyState;
  /** Fuel actually debited (0 until the cancel window closes; always 0 for drift). */
  fuelCharged: number;
  /** True while the journey can still be cancelled free of charge. */
  cancellable: boolean;
  createdAt: string;
  cancelDeadline: string;
  departedAt?: string;
  arrivedAt?: string;
  endedAt?: string;
}

/** Daily-tending streak — consecutive days the brain was fed a memory. */
export interface Streak {
  /** Current live streak in days (0 if it has lapsed). */
  current: number;
  /** Best streak ever reached for this brain. */
  best: number;
  /** Whether the brain has already been tended today. */
  today: boolean;
  /** "Nebula shields" left — each forgives one missed day so a streak isn't lost. */
  shields?: number;
  /** Space-local day (YYYY-MM-DD) the brain was last tended, or null if never. (IM-64) */
  lastActiveDate?: string | null;
  /**
   * Per-day tending record for the last 14 space-local days, oldest first (IM-64).
   * `tended: true` = the brain was tended that day; `false` = it was not (only
   * asserted for days inside the recorded era — see server StreakRepo.history);
   * `null` = no record (before day-tracking began and not derivable from the
   * current streak) — UIs must render this distinctly from a missed day.
   */
  history?: { date: string; tended: boolean | null }[];
}

export interface GraphEdge {
  id: number;
  source: number;
  target: number;
  relationship: RelationshipType;
  /** 0..1 link strength (e.g. derived from cosine similarity). */
  weight: number;
  createdAt: string;
}

/** Shape consumed directly by react-force-graph-3d. */
export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}

/** A lightweight node reference used in insights and chat citations. */
export interface NodeRef {
  id: number;
  label: string;
  type: NodeType;
}

/**
 * A "constellation" — a group of memories that an unsupervised model (k-means
 * over the embedding vectors) found to be naturally close in meaning. This is
 * the machine-learning organization layer: no labels, no API — the structure is
 * learned from the vectors themselves.
 */
export interface Constellation {
  id: number;
  /** Auto-derived name from the cluster's most distinctive vocabulary. */
  name: string;
  nodes: NodeRef[];
  /** Cohesion 0..1 (avg cosine of members to their centroid). */
  cohesion: number;
}

/** A synthesized cross-cluster insight (the "compounding memory" feature). */
/** What an insight represents: a latent *connection* (default) or a *contradiction*
 *  (conflicting beliefs/goals/identity statements across memories over time). */
export type InsightKind = "synthesis" | "contradiction";

export interface Insight {
  id: number;
  text: string;
  /** 0..1 — how strong/surprising the latent connection (or how sharp the conflict) is. */
  score: number;
  createdAt: string;
  nodes: NodeRef[];
  /** Defaults to "synthesis" for pre-existing rows. */
  kind?: InsightKind;
  /** Significance tier (#10): 1 = identity-shaping, 2 = behavioral pattern, 3 = situational.
   *  Derived on read from the involved memories; lower number = surfaced first. */
  tier?: 1 | 2 | 3;
}

/** Where a server-backed Inbox notification came from (IM-74). Each value is a
 *  real server-side event that produced the notification while the user may
 *  have been away: a delivered daily digest, a synthesized insight, a charted
 *  Codex discovery, a bill-risk warning, or a system notice (fix round 2:
 *  a saved note that could not be processed — the permanent-failure item). */
export type NotificationSource = "digest" | "insight" | "discovery" | "bill-risk" | "system";

/** A notification in the server-backed Inbox store (IM-74). Unlike the local
 *  toast log (device-only, capped at 100), these persist server-side per space
 *  until the user clears them, subject to a disclosed high count cap.
 *  Retention (Q7 interim default): keep until cleared; oldest dropped only
 *  past the cap, and the panel copy says so. */
export interface ServerNotification {
  id: number;
  source: NotificationSource;
  text: string;
  icon: string;
  priority: "low" | "normal" | "high";
  /** Stable per-event key; a second record attempt for the same event is a no-op. */
  dedupeKey: string | null;
  seen: boolean;
  seenAt: string | null;
  /** ISO instant until which the item is snoozed (hidden from Unseen), or null. */
  snoozedUntil: string | null;
  createdAt: string;
}

/** One point on the emotional trajectory: a time bucket's average valence (−1..1). */
export interface EmotionalPoint {
  /** ISO date (day bucket). */
  date: string;
  /** Average emotional valence in this bucket: −1 (heavy) … +1 (bright). */
  valence: number;
  /** How many memories fell in this bucket. */
  count: number;
}

/** A detected emotional pattern (stress cycle, upswing, burnout risk, volatility…). */
export interface EmotionalPattern {
  /** Human label, e.g. "Stress cycle", "Upswing", "Burnout risk", "Volatile stretch". */
  type: string;
  /** The tag/type most associated with the low points, or "" if none stands out. */
  trigger: string;
  /** How many times the pattern repeats in the history. */
  repeats: number;
  /** A gentle, heuristic suggestion. */
  intervention: string;
  /**
   * REG-153 / INS-06: the pattern's evidence basis, in plain words — how
   * many days/memories it rests on and over what window (e.g. "3 heavy days
   * among the last 5 day-buckets (2026-03-01–2026-03-05)"). Rendered beside
   * the label so a health-flavored heading never stands without its
   * evidence; the chat renderer carries the same hedge in words.
   */
  basis?: string;
}

/** Emotional trajectory analysis over time (research-agent add-on #5). Heuristic + offline. */
export interface EmotionalTrajectory {
  /** Time-ordered, day-bucketed valence series for a sparkline. */
  points: EmotionalPoint[];
  /** Overall direction of mood over the window. */
  trend: "rising" | "falling" | "steady";
  /** Mean valence across all dated, emotionally-charged memories (−1..1). */
  average: number;
  /** 0..1 — how much mood swings (normalized stddev). */
  volatility: number;
  /** Detected patterns, most salient first. */
  patterns: EmotionalPattern[];
  /** How many memories carried usable emotional + time data. */
  sampleSize: number;
}

/** Broad areas of life used by the optional life-area lens (#6). An overlay over the
 *  emergent galaxy — NOT a storage model (memories still cluster by association). */
export const LIFE_AREAS = [
  "Identity & Growth",
  "Relationships",
  "Work & Projects",
  "Health",
  "Money",
  "Other",
] as const;
export type LifeArea = (typeof LIFE_AREAS)[number];

/** A count of memories mapped to one life-area (#6). */
export interface LifeAreaCount {
  area: LifeArea;
  count: number;
}

/** One line of Soumaya's read-only coverage self-check (#12): something she may be
 *  missing or that's worth your attention. Informational — she never self-modifies. */
export interface SelfReviewItem {
  title: string;
  detail: string;
  count: number;
}

/** A temporal evolution link (research-agent add-on #8): an older memory and a newer
 *  one on the same theme, showing how a thread of thinking moved over time. */
export interface EvolutionLink {
  fromId: number;
  fromLabel: string;
  toId: number;
  toLabel: string;
  /** Semantic closeness banded for display. */
  strength: "weak" | "medium" | "strong";
  /** Days between the two memories (older → newer). */
  temporalDistanceDays: number;
  /** One-line reason: theme + time gap + any emotional drift. */
  reason: string;
}

/** A dormant memory worth reviving (research-agent add-on #4): a skill/goal/project
 *  you once invested in but haven't touched in a while. */
export interface DormantItem {
  nodeId: number;
  label: string;
  type: NodeType;
  /** Days since it was last tended/created. */
  dormantDays: number;
  /** Heuristic "why it disappeared". */
  hypothesis: string;
  /** A gentle reactivation nudge. */
  prompt: string;
}

/** One grouped line of autonomous work Soumaya did while you were away. */
export interface AwayAction {
  type: string;
  count: number;
  label: string;
}

/** The "while you were away" companion digest — what changed since your last visit. */
export interface AwayDigest {
  /** ISO timestamp of your previous visit (null on first ever visit). */
  since: string | null;
  /** Milliseconds since that visit. */
  awayMs: number;
  /** In-character summary line. */
  greeting: string;
  /** Grouped autonomous actions Soumaya took (connected/researched/merged…). */
  agentActions: AwayAction[];
  /** Contradictions surfaced while away. */
  newContradictions: number;
  /** Action items that expired while away. */
  expiredActions: number;
  /** Reminders that came due while away (click to fly to them). */
  dueReminders: { id: number; label: string }[];
  /** A dormant memory worth resurfacing today, if any. */
  resurfaced: { id: number; label: string; dormantDays: number } | null;
  /** Memories cooling from neglect. */
  cooling: number;
  /** True when there's nothing worth showing (first visit / quiet). */
  isEmpty: boolean;
}

/** Metadata for a file attached to a memory note (bytes fetched separately on download). */
export interface Attachment {
  id: number;
  nodeId: number;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}

/** How a life-chapter's period trended vs the one before it (the 3D Chronicle timeline). */
export type ChapterTrend = "growth" | "decline" | "neutral" | "mixed";

/** One named sub-current within a chapter (hybrid scope: whole-arc + parallel threads). */
export interface ChapterThread {
  name: string;
  trend: ChapterTrend;
}

/** A chapter of your life on the chronological Chronicle timeline. Written by Soumaya when
 *  there's real change (~1–3×/month) or added by you. See docs/TIMELINE_DESIGN.md. */
export interface TimelineChapter {
  id: number;
  title: string;
  summary: string;
  theme: string;
  trend: ChapterTrend;
  /** Blended change magnitude 0..1 (momentum + emotion delta + milestones). */
  score: number;
  periodStart: string;
  periodEnd: string;
  /** Driving memory ids (photo-bearing preferred) — listed in the chapter's detail card. */
  memoryIds: number[];
  /** The subset of memoryIds that carry a photo — shown as thumbnails in the detail card. */
  photoIds: number[];
  threads: ChapterThread[];
  origin: "auto" | "user";
  createdAt: string;
}

/** The emotional register of a chat reply — drives the avatar's eye + bubble accent. */
export const CHAT_MOODS = [
  "happy",
  "excited",
  "warm",
  "thoughtful",
  "concerned",
  "sad",
  "neutral",
] as const;
export type ChatMood = (typeof CHAT_MOODS)[number];

/** Why a chat reply was produced by the offline fallback instead of the cloud
 *  AI (Screenshot Fixes Package A, Finding 2). The first four mirror the
 *  server LLM layer's DegradeReason; "offline" = no cloud key is configured
 *  at all (the heuristic is the only provider); "error" = the cloud call
 *  failed in a way that fits none of the named categories. */
export type ChatDegradedReason = "auth" | "quota" | "timeout" | "budget" | "offline" | "error";

/** Answer from chat-with-your-brain (GraphRAG), with node citations. */
export interface ChatResponse {
  answer: string;
  citations: NodeRef[];
  /** Ids of the subgraph used as context (for camera/highlight). */
  contextIds: number[];
  /** Emotional delivery tone (drives her voice's prosody when speaking aloud). */
  tone?: import("./dramatize.js").EmotionalTone;
  /** How she's feeling about this reply (avatar eye colour / animation). */
  mood?: ChatMood;
  /** Interview instinct: ONE clarifying question she asks back — set when the
   *  topic is weighty/ambiguous and answering well needs context she lacks. */
  askBack?: string;
  /** Names of the custom-instruction roles that shaped this reply (visibility:
   *  users couldn't tell whether their Companion config was actually applied). */
  appliedRoles?: string[];
  /** Names of the knowledge documents retrieved into this reply's context. */
  appliedDocs?: string[];
  /** Maya Chat → Galaxy Navigation: a server-VALIDATED navigation target, present only when
   *  the model proposed a Galaxy entity (journey/bill/goal) that actually resolved in this
   *  space. Never built from the model's own words — `target`/`reason` both come from
   *  `resolveGalaxyEntity`/`navigationIntentFor`'s already-computed, real state. Absent when
   *  nothing was proposed or nothing the model proposed resolved. */
  navigation?: import("./intelligence.js").NavigationIntent;
  /** Present ONLY when this reply came from the offline fallback (Finding 2):
   *  the client renders it visibly as a limited-mode reply instead of dressing
   *  it up as a full answer. Absent = a normal cloud answer. Additive — older
   *  consumers that ignore it keep working. */
  degraded?: { reason: ChatDegradedReason };
}

export interface DailyLog {
  id: number;
  content: string;
  date: string;
  createdAt: string;
}

/** A short, link-carrying entry in Soumaya's daily digest. */
export interface DigestEntry {
  node: NodeRef;
  /** One-line snippet of the memory. */
  snippet: string;
  /** Soumaya's short, in-character take on why it matters. */
  take: string;
}

/** An action item that timed out (cleared from the galaxy). */
export interface ExpiredAction {
  label: string;
  /** ISO timestamp it cleared. */
  clearedAt: string;
}

/**
 * Soumaya's daily digest — what she (the starpilot) thinks you should be caught
 * up on: fresh memories with her take + links, latent connections she surfaced,
 * and the day-to-day action items that timed out. Assembled server-side from
 * existing data with NO LLM call, so it's free and always available.
 */
export interface DailyDigest {
  date: string;
  /** In-character opening line. */
  greeting: string;
  /** Memories logged today (newest first), each with a link + her take. */
  fresh: DigestEntry[];
  /** Latent connections she surfaced (reuses the insight engine). */
  connections: Insight[];
  /** Action items that timed out, summarized. */
  expiredActions: ExpiredAction[];
  /** Memories cooling from neglect — revisit them to warm them back up. */
  cooling: { node: NodeRef; entropy: number }[];
  /** Memories whose user-set reminder time has come due (remind_at ≤ now). */
  reminders: { node: NodeRef; remindAt: string }[];
  /** Closing reflection in her voice. */
  closing: string;
}

/**
 * Smart Lenses — a saved query that renders as a live, self-updating constellation
 * (the briefing's "self-updating view"). The query is a flat AND-set of optional
 * predicates evaluated deterministically server-side (no LLM). Every field is
 * optional; an empty query matches all active memories.
 */
export interface LensQuery {
  /** Node kinds/types to include (any-of). */
  kinds?: string[];
  /** Tags to match (any-of). */
  tags?: string[];
  /** Emotional band. */
  emotion?: "positive" | "heavy" | "neutral";
  /** Minimum importance 0..1. */
  minImportance?: number;
  /** Created/occurred within the last N days. */
  withinDays?: number;
  /** Only memories linked to this node id. */
  linkedTo?: number;
  /** Lifecycle lens. */
  state?: "active" | "archived" | "due" | "orphan";
  /** Full-text keyword (FTS). */
  text?: string;
}

/** A persisted lens (with a live match count when listed). Batch H (REG-208 /
 *  REG-214): `count` is the TRUE total (uncapped); `capped` says the shown set
 *  was truncated at a cap, `totalIsLowerBound` says the total itself is only a
 *  lower bound (an inner FTS/due leg truncated first), `shown` is how many ids
 *  the isolate actually carries, and `broken` marks a lens whose stored query
 *  JSON could not be parsed at all — never an all-matching lens. */
export interface Lens {
  id: number;
  name: string;
  query: LensQuery;
  pinned: boolean;
  count?: number | null;
  /** True when the shown set was truncated at one of evalLens's caps. */
  capped?: boolean;
  /** True when `count` is a lower bound, not the exact total (an inner leg hit its cap). */
  totalIsLowerBound?: boolean;
  /** How many ids the isolate actually carries (<= count). */
  shown?: number;
  /** The stored query JSON is corrupt — the lens is unreadable, not broad. */
  broken?: boolean;
}

// ---- Investigator + typed research (docs/INVESTIGATOR_RESEARCH.md) ---------------------
// One generic "research" doesn't fit trauma AND a business model. Research is TYPED, and
// Investigator (an internal, cited deep-dive) runs first and feeds it.

export type ResearchType =
  | "emotional" // trauma / grief / relationship pain — gentle, non-clinical
  | "relationship"
  | "financial"
  | "health"
  | "learning"
  | "business"
  | "decision"
  | "general"; // the current default behaviour (fallback)

/** One cited item the investigator surfaced as relevant to the subject. */
export interface InvestigationEvidence {
  nodeId: number;
  label: string;
  /** Why it's relevant (e.g. "linked via relates_to", "shares tag Work"). */
  why: string;
}

/** The internal, cited deep-dive Soumaya runs BEFORE any outward research. */
export interface InvestigationReport {
  subjectId: number;
  subjectLabel: string;
  researchType: ResearchType;
  /** Grounded, falsifiable summary — notices patterns/origins, never diagnoses. */
  summary: string;
  evidence: InvestigationEvidence[];
  openQuestions: string[];
}

// ---- Journeys (Vision 2.0) ------------------------------------------------------------
// A Journey is a meaningful chapter of your life (Become an RN, Recover Financially, …).
// Everything can belong to one; we LINK objects to journeys (never copy them). See
// docs/VISION_2_JOURNEYS.md.

export type JourneyStatus = "active" | "paused" | "done";

/** The kinds of object a journey can link to (a ref into that object's own table). */
export type JourneyLinkKind =
  | "node" // a memory / goal / person / any graph node
  | "task" // an action item
  | "income" | "expense" | "bill" // Financial OS rows
  | "insight" // synthesis / belief
  | "doc" // a knowledge document
  | "chat" // a saved conversation
  | "achievement"
  | "goal"; // a Wealth goal (docs/specs/wealth-goals-allocation.md) — optional, never required for Goals/Buckets/Allocations to function

export interface Journey {
  id: number;
  title: string;
  description: string;
  status: JourneyStatus;
  /** Accent colour (hex) for its hub star + UI; optional. */
  color?: string;
  /** Emoji glyph for quick recognition; optional. */
  icon?: string;
  /** 0..1 progress (user-set or derived); drives the Living-Galaxy hub brightness. */
  progress: number;
  /** Count of linked missions completed (IM-140 auto-credit), enriched on read. */
  missionsCompleted?: number;
  createdAt: string;
  updatedAt: string;
  /** Count of linked objects (enriched on read). */
  linkCount?: number;
  /** Explicit span start (ISO/datetime), IM-132 hybrid span derivation: when set it
   *  overrides the link-inferred start. Migration-only column (migrateSchema). */
  startedAt?: string;
  /** Explicit span end; null/absent while the Journey is still unfolding. */
  endedAt?: string;
}

/** One auto-detected Life Season (IM-132): an identity era derived from an
 *  auto-detected timeline chapter by the existing Chronicle heuristic
 *  (docs/specs/timeline-life-seasons.md — chapters are the detection INPUT,
 *  seasons are the band rendered behind Journey spans, never a competing
 *  timeline entry). Dates are SPACE-local calendar dates (YYYY-MM-DD): a
 *  season boundary is the calendar day of the stored period instant in the
 *  space's own timezone (derived server-side, lifeSeasons.repo) — the day
 *  the user actually lived it, per the owner's no-UTC rule (2026-10-21). */
export interface LifeSeason {
  /** The source auto chapter's id ( seasons are derived, not separately stored). */
  id: number;
  chapterId: number;
  /** Era label, e.g. "Recovery Era" (from the chapter theme) or the chapter title. */
  label: string;
  theme: string;
  trend: ChapterTrend;
  /** Detection confidence = the source chapter's blended change score (0..1). */
  confidence: number;
  /** Raw stored period instants of the source chapter. */
  periodStart: string;
  periodEnd: string;
  /** Space-local calendar dates (YYYY-MM-DD) of periodStart / periodEnd —
   *  the band's fixed-calendar-date boundaries. */
  startDate: string;
  endDate: string;
}

/** A Journey plotted on the real time axis (IM-132, hybrid derivation):
 *  explicit startedAt/endedAt win; otherwise the span is inferred from the
 *  dates of linked items; a link-less, dateless Journey falls back to its
 *  createdAt (start) and, when done, its updatedAt (end). */
export interface JourneySpan {
  journey: Journey;
  /** Effective span start (stored instant string). */
  start: string;
  /** Effective span end, or null while ongoing (status != done, no explicit end). */
  end: string | null;
  ongoing: boolean;
  /** Space-local calendar dates (YYYY-MM-DD) of start / end (end null when ongoing). */
  startDate: string;
  endDate: string | null;
  startSource: "explicit" | "links" | "created";
  endSource: "explicit" | "links" | "updated" | "open";
}

/** Response of GET /api/timeline/seasons (IM-132). Windowed via limit/offset. */
export interface LifeSeasonsTimeline {
  seasons: LifeSeason[];
  journeySpans: JourneySpan[];
  totalSeasons: number;
  totalJourneySpans: number;
}

export interface JourneyLink {
  id: number;
  journeyId: number;
  kind: JourneyLinkKind;
  refId: number;
  createdAt: string;
}

/** A journey_link row, hydrated with enough of the linked object's own data to render it
 *  (label, and an amount for money kinds) without the client joining anything itself. */
export interface JourneyLinkSummary {
  kind: JourneyLinkKind;
  refId: number;
  label: string;
  /** Cents, for income/expense/bill links only. */
  amount?: number;
  /** The linked item's own date where it has one (a transaction's date; a task
   *  node's occurred/created date). Absent for a bill link (a recurring schedule,
   *  not a dated transaction) and for kinds with no dated source row. */
  occurredAt?: string;
  /** When this link itself was created (the journey_link row's created_at) —
   *  the one date every link kind truthfully has (IM-86 remainder / IM-88). */
  linkedAt?: string;
  /** For a `task` link that resolved to its action node (tasks ARE nodes rows —
   *  see docs/specs/journeys-connective-tissue.md), the node id the row can fly
   *  to. Absent on the generic fallback row for an unresolvable task link. */
  nodeRefId?: number;
}

/** Response of GET /journeys/:id/links — the detail view's data (IM-87/IM-86).
 *  `links` is DISPLAY-capped (see `displayLimit`); `totalCount`, `earnedCents` and
 *  `spentCents` are always computed over ALL of the journey's links, never over the
 *  displayed subset — the totals a user reads are the journey's true totals.
 *  `unshownByKind` counts linked items (within the display window) that exist but
 *  produced no displayable summary — after the IM-86 remainder work that is only
 *  dangling refs of the hydratable kinds whose target row is gone (task/chat/
 *  achievement now always produce a summary: a real label when a source row
 *  resolves, otherwise a generic per-link row carrying the link's own date) —
 *  so the UI can say they are linked instead of claiming nothing is. */
export interface JourneyLinksDetail {
  links: JourneyLinkSummary[];
  /** Every journey_link row for this journey (matches the header's linkCount). */
  totalCount: number;
  /** True total over ALL linked income rows, in cents. */
  earnedCents: number;
  /** True total over ALL linked expense rows, in cents. */
  spentCents: number;
  /** Max number of raw links hydrated into `links` for display. */
  displayLimit: number;
  unshownByKind: Partial<Record<JourneyLinkKind, number>>;
}

/** One candidate Journey to link a captured object to, with the confidence tier that
 *  decides whether it's silently auto-linked or offered as a one-tap suggestion. */
export interface JourneySuggestion {
  journey: Journey;
  score: number;
  tier: "auto" | "suggested";
}

export interface JourneySuggestions {
  autoLink: JourneySuggestion[];
  suggested: JourneySuggestion[];
}

// ---- Financial OS (Stage 1a) ----------------------------------------------------------
// All money is stored + computed in INTEGER MINOR UNITS (cents) to avoid float drift.
// See docs/financial-os/ for the design. These are the domain types shared by the
// server repos/engines and (later) the web client.

export type BillFrequency = "weekly" | "biweekly" | "monthly" | "custom";
export type ExpenseDirection = "out" | "in";
export type FinSourceKind = "image" | "pdf" | "paste" | "manual";
export type BillOccurrenceStatus = "upcoming" | "paid" | "skipped";

/** The single adjustable balance for a space (Stage 1: one currency, one account). */
export interface FinAccount {
  id: number;
  name: string;
  currency: string; // ISO-4217, e.g. "USD"
  balanceCents: number;
  bufferCents: number; // "always keep $X untouched"
  updatedAt: string;
}

/** A recurring bill, entered once. */
export interface FinBill {
  id: number;
  name: string;
  amountCents: number;
  frequency: BillFrequency;
  /** Anchor for the schedule (ISO date). For monthly, its day-of-month drives recurrence. */
  anchorDate: string;
  /** For `custom`: days between occurrences. */
  everyDays?: number;
  autopay: boolean;
  category: string;
  graceDays?: number;
  lateFeeCents?: number;
  payee?: string;
  accountLast4?: string; // last 4 only — never a full number
  active: boolean;
}

/** A materialized instance of a bill (one due date). */
export interface FinBillOccurrence {
  id: number;
  billId: number;
  dueDate: string;
  amountCents: number;
  status: BillOccurrenceStatus;
  paidExpenseId?: number | null;
  paidAt?: string | null;
}

/** A recorded income event. */
export interface FinIncome {
  id: number;
  sourceId?: number | null;
  date: string;
  grossCents?: number | null;
  netCents: number;
  taxCents?: number | null;
  hours?: number | null;
  platform?: string | null;
  confidence?: number | null;
  createdAt: string;
  /** ADR-019 settlement marker (I9): set iff this entry's amount is currently
   *  reflected in the tracked balance; NULL = scheduled, not yet settled. */
  balanceAppliedAt?: string | null;
}

/** A recorded expense (or a non-income inflow). */
export interface FinExpense {
  id: number;
  sourceId?: number | null;
  date: string;
  amountCents: number;
  merchant?: string | null;
  category: string;
  direction: ExpenseDirection;
  confidence?: number | null;
  createdAt: string;
  /** ADR-019 settlement marker (I9): set iff this entry's amount is currently
   *  reflected in the tracked balance; NULL = scheduled, not yet settled. */
  balanceAppliedAt?: string | null;
}

/** One line of the itemized Reserved breakdown. */
export interface ReservedLine {
  billId: number;
  name: string;
  amountCents: number;
  dueDate: string;
}

// ---- Ingestion / extraction (Stage 1b) ----
// A "candidate" is a DRAFT the user confirms before it commits — never trusted silently.

export interface ExtractedIncome {
  date?: string;
  netCents: number;
  platform?: string;
  confidence: number; // 0..1
  duplicate?: boolean; // likely already recorded (same net + date)
}
export interface ExtractedExpense {
  date?: string;
  amountCents: number;
  merchant?: string;
  category?: string;
  direction: ExpenseDirection;
  confidence: number; // 0..1
  duplicate?: boolean; // likely already recorded (same amount + date + merchant)
}
/** Output of an OcrProvider: structured drafts extracted from a raw source. */
export interface FinExtractionResult {
  incomes: ExtractedIncome[];
  expenses: ExtractedExpense[];
  /** Provider that produced this (for the confidence hint + debugging). */
  provider: "heuristic" | "vision";
}

// ---- Pay stubs (docs/specs/paystub-ingestion.md) -------------------------------------------
// A pay stub is a richer record than a plain income row: employer, pay period, an itemized
// earnings/deductions breakdown, and often YTD totals. It always produces exactly one
// FinIncome row (the net pay) but its full detail + the original document live in fin_paystub.

/** One earnings or deduction line item, verbatim from the document. */
export interface PaystubLineItem {
  label: string;
  amountCents: number;
  /** Earnings only: e.g. hours or miles, when the stub shows a quantity. */
  quantity?: number;
  /** Earnings only: e.g. an hourly or per-mile rate, when the stub shows one. */
  rateCents?: number;
  /** Deductions only: the year-to-date total for this line, when shown. */
  ytdCents?: number;
}

/**
 * Comprehensive, not curated: `earnings` generalizes beyond hourly/salary so a pay structure
 * like a company truck driver's (per-mile line-haul pay, flat day-rate training pay, per diem)
 * is captured verbatim alongside the common hourly/salary convenience fields, which stay
 * populated too when the stub genuinely is hourly/salary.
 */
export interface PaystubExtractionResult {
  employer?: string;
  payDate?: string; // ISO date
  periodStart?: string;
  periodEnd?: string;
  grossCents?: number;
  netCents: number; // required — this becomes the FinIncome row
  hours?: number;
  hourlyRateCents?: number;
  overtimeHours?: number;
  overtimeRateCents?: number;
  earnings: PaystubLineItem[];
  deductions: PaystubLineItem[];
  ytdGrossCents?: number;
  ytdNetCents?: number;
  confidence: number; // 0..1
}

/** A saved pay stub: the confirmed extraction + the original document, viewable again later. */
export interface FinPaystub {
  id: number;
  incomeId?: number | null;
  employer?: string | null;
  payDate?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  grossCents?: number | null;
  netCents: number;
  hours?: number | null;
  hourlyRateCents?: number | null;
  earnings: PaystubLineItem[];
  deductions: PaystubLineItem[];
  ytdGrossCents?: number | null;
  ytdNetCents?: number | null;
  sourceFilename?: string | null;
  sourceMime?: string | null;
  /** True when the original document is retained and viewable (not sent to the list view). */
  hasSource: boolean;
  createdAt: string;
}

// ---- Money in the galaxy (Stage 4 — bills/goals as STARS) ----
// Meaning is carried by state → colour/glyph/glow (never colour alone). Cooling = blue.
export type MoneyStarState =
  | "calm" // funded, not due soon
  | "approaching" // due soon, funded
  | "cooling" // overspend pace / short — the user's blue
  | "overdue" // past due, unpaid
  | "paid" // settled recently
  | "goal_filling"
  | "goal_reached";

export interface MoneyStar {
  kind: "bill" | "goal";
  id: number;
  label: string;
  amountCents: number;
  state: MoneyStarState;
  /** The on-focus status icon (good/bad/in-between at a glance). */
  glyph: string;
  /** 0..1 — urgency (bills) or fill (goals); drives brightness/pulse. */
  intensity: number;
  dueInDays?: number;
  fillPct?: number;
}

/** The live budget the home screen renders + the AI cites. All cents. */
export interface BudgetSummary {
  balanceCents: number;
  bufferCents: number;
  reservedCents: number;
  reserved: ReservedLine[];
  /** balance − reserved − buffer, floored at 0 for display. */
  safeToSpendCents: number;
  /** How much reserved+buffer exceeds the balance (0 if none). Shown explicitly. */
  shortfallCents: number;
  /** Net income recorded so far this week (Mon-anchored). */
  weekEarnedCents: number;
  /** The date used as the "next income" horizon for Reserved. */
  nextIncomeDate: string;
  /** Rough weekly average of net income over up to the last 4 weeks (fewer if the
   *  account is newer than that) — the pace scenario questions ("how many weeks to
   *  afford X") are computed from. */
  avgWeeklyIncomeCents: number;
}

/**
 * Wealth (docs/specs/wealth-goals-allocation.md): financial INTENTION layered on top of
 * Money's reality. A Bucket owns no money — it's a grouping only. A Goal's current amount
 * is always computed as SUM(allocations), never stored on the goal itself. An Allocation is
 * a record of intent, never a real transfer — see the spec's vocabulary discipline (never
 * "saved"/"balance"/"deposited"/"invested" for any of these).
 */
export interface FinBucket {
  id: number;
  name: string;
  /** Free text, user-defined (e.g. "emergency", "retirement", "trucking") — not a fixed enum. */
  category: string;
  archived: boolean;
  createdAt: string;
}

export interface FinGoal {
  id: number;
  bucketId: number;
  name: string;
  /** Absent = open-ended goal; never reaches "goal_reached". */
  targetCents?: number | null;
  targetDate?: string | null;
  archived: boolean;
  createdAt: string;
  /**
   * Life Vision (docs/specs/life-vision.md): optional link to the `life_vision` node
   * this Goal helps fund. Nullable, one-to-many (a Vision may have many Goals; a Goal
   * has at most one Vision). Never cascades either direction on archive.
   */
  visionNodeId?: number | null;
}

export interface FinAllocation {
  id: number;
  goalId: number;
  /** Signed: positive = allocate, negative = de-allocate/withdraw. This single signed
   *  ledger is the entire de-allocation model — never a separate "reversal" record type. */
  amountCents: number;
  note?: string | null;
  createdAt: string;
}

/** One Goal with its computed (never stored) totals, for the Wealth summary and UI. */
export interface FinGoalWithProgress extends FinGoal {
  /** SUM of this goal's allocation ledger. */
  totalCents: number;
  /** null when the goal has no target (open-ended). */
  fillPct: number | null;
  state: "goal_filling" | "goal_reached";
}

export type ReconciliationStatus = "ok" | "over_committed";

/**
 * The Wealth-layer summary: Deployable and Reconciliation are computed fresh on every read,
 * exactly like BudgetSummary's own fields — never stored, never cached. safeToSpendCents here
 * is read as-is from Money's BudgetSummary, never recomputed.
 */
export interface WealthSummary {
  buckets: FinBucket[];
  goals: FinGoalWithProgress[];
  /** Sum of every active goal's computed total. */
  allocatedCents: number;
  /** safeToSpendCents − allocatedCents. Wealth's primary planning concept — always named,
   *  never folded silently into Safe-to-Spend. May be negative. */
  deployableCents: number;
  reconciliation: ReconciliationStatus;
}

// ---- Income & Net Worth Growth Trend (docs/specs/income-net-worth-trend.md) ----------------
// Deliberately separate from Wealth's Buckets/Goals (which never represent a real balance) and
// from fin_account (the single spendable cash balance) — an Asset is a manually-tracked
// savings/investment/retirement account, tracked purely for the net-worth line.

export type FinAssetKind = "savings" | "investment" | "retirement" | "other";

export interface FinAsset {
  id: number;
  kind: FinAssetKind;
  label: string;
  archived: boolean;
  createdAt: string;
}

export interface FinAssetSnapshot {
  id: number;
  assetId: number;
  amountCents: number;
  /** ISO date this balance was true as of. */
  asOf: string;
  createdAt: string;
}

/** One point on the income trend chart — a calendar month's total net income. */
export interface IncomePoint {
  /** ISO date, first of the month. */
  periodStart: string;
  totalCents: number;
  /** Rough source split for the nice-to-have breakdown (see spec Decision #2) — a
   *  platform-text heuristic, not a hard categorization. */
  bySource: { paycheck: number; selfEmployed: number };
}

/** One point on the net-worth trend chart. */
export interface NetWorthPoint {
  /** ISO date, month-end. */
  asOf: string;
  totalCents: number;
  /** True when the cash portion of this point is today's balance projected backward
   *  (fin_account has no history yet) rather than a real historical figure — the chart
   *  renders this segment visually distinct (spec Decision #3), never as fact. */
  cashIsProjected: boolean;
}
