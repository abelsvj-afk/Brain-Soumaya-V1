/**
 * W2 user model (wisdom layer): Soumaya's inspectable, evidence-backed
 * representation of the user's mental life (first-order theory of mind).
 *
 * See docs/wisdom/w2-design-canonical.md §§4, 6, 8.3 for the full design.
 *
 * Critical invariants enforced here:
 * - INV-EV-1:  reject empty evidence_ids (recordStated / updateUserModel).
 * - INV-ST-1:  stated beats inferred — recordStated() invalidates contradicted
 *              inferred/consolidated entries in the same slot before inserting.
 * - INV-CORR-1: corrections supersede, never delete (correctUserModel sets
 *              invalid_at + replaced_by; no DELETE anywhere in this module).
 * - INV-TOM-1: reject higher-order ToM content at write time.
 * - INV-PERSONA-1: never auto-convert the user_persona blob to stated entries.
 * - INV-ENRICH-1: no `generated`-labeled enrichment content in evidence.
 * - INV-KC-1:  knowledgeCheck() NEVER mutates user_model — judgment only.
 *              (No INSERT/UPDATE/DELETE against user_model exists anywhere in
 *              the knowledge-check path; an opt-in byte-identical assertion
 *              exists for tests.)
 *
 * Placement note: when merged, this file lives at
 * `packages/server/src/agent/userModel.ts`, hence the `../db/*` imports.
 */

import type { DbHandle } from "../db/client.js";
import type { RawDb } from "../db/vec.js";
import { captureEpisode } from "./episodic.js";
import {
  applyConsolidationMutation,
  type ConsolidationRunContext,
} from "./consolidation/boundary.js";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type Slot =
  | "belief"
  | "desire"
  | "intention"
  | "emotion_state"
  | "knowledge"
  | "constraint";

export const SLOTS: readonly Slot[] = [
  "belief",
  "desire",
  "intention",
  "emotion_state",
  "knowledge",
  "constraint",
];

export type Origin = "stated" | "inferred" | "consolidated";

export type EvidenceType = "episode" | "node" | "correction" | "enrichment";

export interface EvidenceRef {
  type: EvidenceType;
  id: number;
}

export type EvidenceStatus = "ok" | "stale" | "withdrawn";

export interface AnnotatedEvidenceRef extends EvidenceRef {
  status: EvidenceStatus;
}

export interface EvidenceInput extends EvidenceRef {
  /**
   * True when this evidence item is a direct user statement (e.g. the
   * conversation episode in which he stated the entry, or a W1 correction
   * row). Drives the stated_bonus term of evidence_strength.
   * `correction`-type refs are always treated as user statements.
   */
  isUserStatement?: boolean;
  /** When the evidence was observed (canonical ISO UTC). Drives recency. */
  occurredAt?: string | null;
  /**
   * Independence metadata for assessIndependence() / independentSourceCount().
   * episodeId: the conversation episode this evidence belongs to (for nodes:
   * the episode it was distilled from — set derivedFromEpisodeId instead).
   */
  episodeId?: number | null;
  derivedFromEpisodeId?: number | null;
  signalType?: string | null;
}

/** Metadata consumed by assessIndependence() (pure function). */
export interface EvidenceMeta {
  ref: EvidenceRef;
  episodeId?: number | null;
  derivedFromEpisodeId?: number | null;
  occurredAt?: string | null;
  signalType?: string | null;
}

export type InvalidReason =
  | "superseded"
  | "corrected_false_belief"
  | "evidence_withdrawn"
  | "expired"
  | "user_override";

/** A user_model row with JSON columns parsed and evidence annotated. */
export interface UserModelEntry {
  id: number;
  spaceId: string;
  slot: Slot;
  content: string;
  confidence: number;
  evidenceStrength: number;
  evidence: AnnotatedEvidenceRef[];
  /** True when every evidence ref is 'withdrawn'. */
  evidenceAllWithdrawn: boolean;
  topicLabels: string[];
  /** True when topic_labels is empty — reads widen rather than narrow. */
  topicUncertain: boolean;
  validAt: string;
  invalidAt: string | null;
  invalidReason: InvalidReason | null;
  replacedBy: number | null;
  origin: Origin;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Thrown for every write-time validation failure. `code` names the violated
 * rule so callers (and tests) can distinguish trigger-boundary rejections
 * from evidence problems from ceiling violations.
 */
export class ValidationError extends Error {
  readonly code:
    | "empty_evidence"
    | "malformed_evidence"
    | "missing_reference"
    | "wrong_space"
    | "multi_proposition"
    | "trigger_boundary"
    | "higher_order_tom"
    | "origin_ceiling"
    | "origin_forbidden"
    | "quarantine_generated"
    | "quarantine_inferred_label"
    | "persona_backfill"
    | "entry_not_found"
    | "entry_not_current"
    | "bad_slot"
    | "bad_confidence"
    | "already_superseded";
  readonly field?: string;
  readonly referencedId?: number;

  constructor(
    code: ValidationError["code"],
    message: string,
    opts?: { field?: string; referencedId?: number },
  ) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.field = opts?.field;
    this.referencedId = opts?.referencedId;
  }
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function nowIso(): string {
  return new Date().toISOString();
}

function parseJsonArray<T>(raw: string | null | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

const STOPWORDS = new Set(
  "a,an,the,and,or,but,if,then,of,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,when,where,why,how,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,don,should,now,i,me,my,myself,we,our,ours,you,your,yours,he,him,his,she,her,hers,it,its,they,them,their,theirs,this,that,these,those,am,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i'm,you're,he's,she's,it's,we're,they're,i've,you've,we've,they've,i'll,you'll,he'll,she'll,we'll,they'll,isn't,aren't,wasn't,weren't,hasn't,haven't,hadn't,doesn't,don't,didn't,won't,wouldn't,shouldn't,couldn't,can't,cannot,must,might,may".split(
    ",",
  ),
);

/** Lowercased word tokens with stopwords removed and light stemming
 * (so "works"/"worked"/"working" match "work" in contradiction rules). */
export function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[''']/g, "'")
    .split(/[^a-z0-9$@&+#'-]+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stemToken);
}

/** Naive English stemmer for contradiction matching (not for display). */
function stemToken(t: string): string {
  if (t.length >= 6 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length >= 5 && t.endsWith("ied")) return `${t.slice(0, -3)}y`;
  if (t.length >= 5 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length >= 5 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length >= 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

export function tokenJaccard(a: string, b: string): number {
  const sa = new Set(contentTokens(a));
  const sb = new Set(contentTokens(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * W3 §8.6 stated_set_version write contract (canonical — design Rev 11):
 * `stated_set_version` increments in the SAME transaction as every write to
 * any user_model row with origin='stated' — every verb, every caller, no
 * exceptions. The writers in this module are recordStated(), correctUserModel(),
 * and updateUserModel(); agent/episodic.ts applyForgetRequest() carries its
 * own copy (no cross-import: this module imports episodic). The counter is
 * what makes the W3 reconciliation pair-level marker exact: any stated write
 * a marker didn't see invalidates the marker. `by` is the number of stated
 * rows written (per-row semantics); a no-op write performs no bump.
 */
function bumpStatedSetVersion(sqlite: RawDb, spaceId: string, by = 1): void {
  if (by <= 0) return;
  sqlite
    .prepare(
      `INSERT INTO space_meta (space_id, stated_set_version)
       VALUES (?, ?)
       ON CONFLICT (space_id) DO UPDATE
       SET stated_set_version = stated_set_version + excluded.stated_set_version`,
    )
    .run(spaceId, by);
}

/** Content-free audit helper: IDs and action names only, never user text. */
function auditLog(
  sqlite: RawDb,
  spaceId: string,
  action: string,
  description: string,
  targets: Record<string, unknown>,
  result: string,
): void {
  sqlite
    .prepare(
      `INSERT INTO agent_logs (space_id, agent, action, description, targets, result)
       VALUES (?, 'soumaya', ?, ?, ?, ?)`,
    )
    .run(spaceId, action, description, JSON.stringify(targets), result);
}

/* ------------------------------------------------------------------ */
/* Topic mapper (§6.2)                                                 */
/* ------------------------------------------------------------------ */

/** Controlled, versioned topic vocabulary. Grows only by explicit addition. */
export const TOPIC_VOCABULARY_VERSION = "v1";

export const TOPIC_VOCABULARY = [
  "employment",
  "finance",
  "housing",
  "transport",
  "health",
  "family",
  "legal",
  "education",
  "communication",
  "routine",
  "goals",
  "relationships",
] as const;

export type TopicLabel = (typeof TOPIC_VOCABULARY)[number];

/**
 * Curated synonym sets (§6.2 mapping rule 1). Tested by T-K11/T-K12:
 * "between gigs" → employment via `gig`; "jobless" → employment.
 */
const TOPIC_SYNONYMS: Record<TopicLabel, string[]> = {
  employment: [
    "job", "jobs", "work", "works", "worked", "working", "employed",
    "unemployed", "unemployment", "jobless", "hired", "hire", "fired",
    "laid off", "layoff", "gig", "gigs", "shift", "shifts", "warehouse",
    "samsonite", "boss", "paycheck", "overtime", "career", "interview",
    "resume", "staffing", "allegiance", "quit", "quits", "resigned",
    "resign", "promoted", "promotion", "coworker", "workplace", "salary",
    "wage", "wages", "employer", "employee", "full-time", "part-time",
    "second job", "clock in", "laid-off", "in between jobs", "between jobs",
  ],
  finance: [
    "money", "fee", "fees", "bank", "debt", "debts", "bill", "bills",
    "pay", "paid", "payment", "payments", "budget", "broke", "loan",
    "loans", "borrow", "borrowed", "tax", "taxes", "fine", "fines",
    "cost", "costs", "afford", "checking", "savings", "sofi", "plaid",
    "cash", "deposit", "overdraft", "credit", "collections", "collector",
    "owe", "owed", "owing", "balance", "venmo", "cashapp", "zelle",
    "emergency fund", "fundrise", "acorns", "m1", "coinbase", "crypto",
    "btc", "xrp", "income", "tip", "tips", "plasma", "octapharma",
    "shipt", "wonolo",
  ],
  housing: [
    "rent", "apartment", "house", "home", "roommate", "lease",
    "landlord", "evict", "eviction", "shelter", "move", "moving",
    "neighborhood", "staying",
  ],
  transport: [
    "bus", "buses", "car", "drive", "driving", "drove", "uber", "lyft",
    "ride", "rides", "route", "commute", "gas", "vehicle", "jta",
    "transit", "walk", "walking", "mileage", "bike", "train",
  ],
  health: [
    "health", "sick", "doctor", "hospital", "pain", "sleep", "tired",
    "anxiety", "anxious", "depressed", "depression", "therapy",
    "medication", "weed", "smoke", "smoking", "quit smoking", "workout",
    "gym", "diet", "fast", "fasting", "injury", "injured", "medical",
    "diagnosis", "sober", "sobriety", "relapse", "hlhs", "hospitalized",
  ],
  family: [
    "kids", "kid", "son", "sons", "daughter", "daughters", "child",
    "children", "baby", "babies", "mother", "mom", "father", "dad",
    "brother", "brothers", "sister", "sisters", "santonio", "sebastian",
    "syncere", "kehlani", "synova", "cyrus", "savior", "sevyn",
    "baby mother", "baby mama", "custody", "child support", "ex",
  ],
  legal: [
    "court", "jail", "arrested", "arrest", "conviction", "convicted",
    "speeding", "ticket", "bradford", "case", "lawyer", "probation",
    "record", "charge", "warrant", "suspended", "suspension",
    "suspended license",
  ],
  education: [
    "school", "class", "degree", "college", "study", "studying",
    "learn", "learning", "korean", "hangul", "cna", "cna license",
    "certification", "certified", "training", "course", "exam", "test",
    "tutor", "anki",
  ],
  communication: [
    "text", "texts", "texted", "call", "called", "calling", "message",
    "messages", "dm", "dms", "instagram", "facebook", "threads",
    "email", "phone", "at&t", "textnow", "voicemail", "reply",
    "replied", "ghost", "ghosted", "blocked", "unblock",
  ],
  routine: [
    "routine", "schedule", "scheduled", "alarm", "alarms", "morning",
    "night", "nightly", "daily", "habit", "habits", "bedtime", "wake",
    "woke", "checklist", "planner", "scripture", "word",
  ],
  goals: [
    "goal", "goals", "plan", "plans", "planning", "dream", "dreams",
    "future", "vision", "save", "saving", "roth", "business",
    "entrepreneur", "build", "building", "grow", "growing",
    "followers", "brand", "empire", "wealth", "invest", "investing",
    "10k", "$10k",
  ],
  relationships: [
    "shaqavia", "girlfriend", "boyfriend", "relationship",
    "relationships", "mediation", "trust", "toxic", "argue", "argued",
    "fight", "fought", "love", "dating", "partner", "breakup",
    "broke up", "cheating", "affair", "couple", "marriage", "married",
    "wife", "husband",
  ],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Deterministic topic mapping (§6.2 mapping rules 1–2; LLM fallback is rule 3
 * and is NOT available in this module — see DESIGN-GAP below).
 *
 * Returns labels + `topic_uncertain`. When no keyword rule fires, labels is
 * empty and topic_uncertain is true; callers must WIDEN, never narrow (§6.2).
 */
export function mapTopics(text: string): {
  labels: TopicLabel[];
  topic_uncertain: boolean;
} {
  const lower = ` ${text.toLowerCase()} `;
  const labels: TopicLabel[] = [];
  for (const topic of TOPIC_VOCABULARY) {
    const hit = TOPIC_SYNONYMS[topic].some((syn) =>
      new RegExp(`\\b${escapeRegExp(syn)}\\b`, "i").test(lower),
    );
    if (hit) labels.push(topic);
  }
  // DESIGN-GAP: §6.2 mapping rule 3 is an LLM fallback that constrains its
  // output to the controlled vocabulary. This module has no LLM access (the
  // judge is injectable only for knowledgeCheck, not for topic mapping), so
  // unmapped text is labeled topic_uncertain=true and consumers apply the
  // widen-not-narrow rule (§6.2). This is the conservative choice: a missed
  // label widens recall (safe) rather than narrowing it (unsafe).
  return { labels, topic_uncertain: labels.length === 0 };
}

/* ------------------------------------------------------------------ */
/* Evidence references (§3.8)                                         */
/* ------------------------------------------------------------------ */

const EVIDENCE_TABLES: Record<EvidenceType, string> = {
  episode: "episodes",
  node: "nodes",
  correction: "corrections",
  enrichment: "episode_enrichments",
};

/**
 * Validate typed evidence refs: shape + existence + same-space (§3.8, §8.5).
 * Every reference is checked inside the caller's transaction; failure rolls
 * the whole write back. INV-EV-1: empty arrays are rejected.
 *
 * DESIGN-GAP: the design's `validateEvidenceRefs(spaceId, evidenceIds)`
 * signature passes the db handle first in this module (validateEvidenceRefs
 * (handle, spaceId, evidenceIds)) to match the repo's agent-module convention
 * (handle, spaceId, ...) used throughout §8.3.
 */
export function validateEvidenceRefs(
  h: DbHandle,
  spaceId: string,
  evidenceIds: EvidenceRef[],
): void {
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
    throw new ValidationError("empty_evidence", "INV-EV-1: evidence_ids must be non-empty", {
      field: "evidence_ids",
    });
  }
  for (const ref of evidenceIds) {
    if (
      !ref ||
      typeof ref !== "object" ||
      !(ref.type in EVIDENCE_TABLES) ||
      !Number.isInteger(ref.id) ||
      ref.id <= 0
    ) {
      throw new ValidationError(
        "malformed_evidence",
        `Malformed evidence ref: expected {type: 'episode'|'node'|'correction'|'enrichment', id: positive int}, got ${JSON.stringify(ref)}`,
        { field: "evidence_ids" },
      );
    }
    const row = h.sqlite
      .prepare(`SELECT id, space_id FROM ${EVIDENCE_TABLES[ref.type]} WHERE id = ?`)
      .get(ref.id) as { id: number; space_id: string } | undefined;
    if (!row) {
      throw new ValidationError(
        "missing_reference",
        `Evidence ref ${ref.type}#${ref.id} does not exist`,
        { field: "evidence_ids", referencedId: ref.id },
      );
    }
    if (row.space_id !== spaceId) {
      throw new ValidationError(
        "wrong_space",
        `Evidence ref ${ref.type}#${ref.id} belongs to a different space (cross-space references rejected, §8.5)`,
        { field: "evidence_ids", referencedId: ref.id },
      );
    }
  }
}

/**
 * Read-time evidence status (§3.8): when a source record is corrected,
 * superseded, or forgotten, the ref is annotated 'stale'/'withdrawn' —
 * never deleted.
 * - node superseded_at set        → stale
 * - episode forgotten_at set      → withdrawn
 * - enrichment superseded_by set  → stale
 * - referenced row missing        → withdrawn
 * - correction rows are append-only (no invalidation) → ok if present
 */
export function annotateEvidence(
  h: DbHandle,
  spaceId: string,
  evidenceIds: EvidenceRef[],
): AnnotatedEvidenceRef[] {
  const out: AnnotatedEvidenceRef[] = [];
  for (const ref of evidenceIds) {
    let status: EvidenceStatus = "ok";
    if (ref.type === "node") {
      const row = h.sqlite
        .prepare(`SELECT superseded_at FROM nodes WHERE id = ? AND space_id = ?`)
        .get(ref.id, spaceId) as { superseded_at: string | null } | undefined;
      status = !row ? "withdrawn" : row.superseded_at ? "stale" : "ok";
    } else if (ref.type === "episode") {
      const row = h.sqlite
        .prepare(`SELECT forgotten_at FROM episodes WHERE id = ? AND space_id = ?`)
        .get(ref.id, spaceId) as { forgotten_at: string | null } | undefined;
      status = !row || row.forgotten_at ? "withdrawn" : "ok";
    } else if (ref.type === "enrichment") {
      const row = h.sqlite
        .prepare(
          `SELECT superseded_by FROM episode_enrichments WHERE id = ? AND space_id = ?`,
        )
        .get(ref.id, spaceId) as { superseded_by: number | null } | undefined;
      status = !row ? "withdrawn" : row.superseded_by != null ? "stale" : "ok";
    } else {
      // 'correction': W1 corrections are append-only events; presence = ok.
      const row = h.sqlite
        .prepare(`SELECT id FROM corrections WHERE id = ? AND space_id = ?`)
        .get(ref.id, spaceId) as { id: number } | undefined;
      status = row ? "ok" : "withdrawn";
    }
    out.push({ ...ref, status });
  }
  return out;
}

/**
 * INV-ENRICH-1 quarantine check: an enrichment cited as user-model evidence
 * must not carry `generated`-labeled interpretive content, and
 * `inferred`-labeled content may only feed `inferred`-origin entries
 * (§3.3 label table). Evaluated on the enrichment's CURRENT version.
 */
export function checkEnrichmentQuarantine(
  h: DbHandle,
  spaceId: string,
  enrichmentId: number,
  origin: Origin,
): void {
  const row = h.sqlite
    .prepare(
      `SELECT id, field_provenance, detail, emotion, emotional_weight, importance,
              participants, place, source_node_ids, embedding
       FROM episode_enrichments
       WHERE id = ? AND space_id = ? AND superseded_by IS NULL`,
    )
    .get(enrichmentId, spaceId) as
    | {
        id: number;
        field_provenance: string;
        detail: string | null;
        emotion: string | null;
        emotional_weight: number | null;
        importance: number;
        participants: string;
        place: string | null;
        source_node_ids: string;
        embedding: Buffer | null;
      }
    | undefined;
  if (!row) {
    throw new ValidationError(
      "missing_reference",
      `Enrichment #${enrichmentId} has no current version in this space`,
      { field: "evidence_ids", referencedId: enrichmentId },
    );
  }
  let labels: Record<string, string>;
  try {
    labels = JSON.parse(row.field_provenance || "{}");
  } catch {
    // Malformed provenance → fail closed in the loop below (unknown label).
    labels = {};
  }
  const populated: string[] = [];
  if (row.detail != null) populated.push("detail");
  if (row.emotion != null) populated.push("emotion");
  if (row.emotional_weight != null) populated.push("emotional_weight");
  if (row.importance !== 0.5) populated.push("importance");
  if (parseJsonArray<string>(row.participants, []).length > 0)
    populated.push("participants");
  if (row.place != null) populated.push("place");
  if (parseJsonArray<number>(row.source_node_ids, []).length > 0)
    populated.push("source_node_ids");
  if (row.embedding != null) populated.push("embedding");

  const EVIDENCE_ELIGIBLE = new Set(["direct_quote", "explicit", "inferred"]);
  for (const field of populated) {
    const label = labels[field];
    if (!label || !EVIDENCE_ELIGIBLE.has(label)) {
      // Missing or unknown label on a populated field → fail closed: the
      // field is quarantined (§3.3: fail-closed evidence selector).
      throw new ValidationError(
        "quarantine_generated",
        `INV-ENRICH-1: enrichment #${enrichmentId} field '${field}' has ${label ? `unknown provenance label '${label}'` : "no provenance label"} (fail-closed)`,
        { field: "evidence_ids", referencedId: enrichmentId },
      );
    }
    if (label === "inferred" && origin !== "inferred") {
      throw new ValidationError(
        "quarantine_inferred_label",
        `INV-ENRICH-1: enrichment #${enrichmentId} field '${field}' is 'inferred'-labeled and may only feed 'inferred'-origin entries (not '${origin}')`,
        { field: "evidence_ids", referencedId: enrichmentId },
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Write validation: one-proposition, trigger boundary, ToM            */
/* ------------------------------------------------------------------ */

/** Verb-ish tokens used by the conservative one-proposition heuristic. */
const VERB_HINTS = new Set(
  "is,are,was,were,am,be,been,being,have,has,had,having,do,does,did,doing,will,would,can,could,shall,should,must,may,might,want,wants,wanted,need,needs,needed,believe,believes,believed,think,thinks,thought,know,knows,knew,feel,feels,felt,intend,intends,intended,plan,plans,planned,trying,tried,started,start,starts,quit,quits,left,stop,stopped,going,go,goes,went,like,likes,love,loves,hate,hates,prefer,prefers,fear,fears,hope,hopes,expect,expects,assume,assumes,never,always,leave,leaves,left,arrive,arrives,arrived,come,comes,came,take,takes,took,get,gets,got,make,makes,made,say,says,said,tell,tells,told,give,gives,gave,put,puts,set,sets,run,runs,ran,drive,drives,drove,ride,rides,rode,cost,costs,pay,pays,paid,spend,spends,spent,buy,buys,bought,sell,sells,sold,send,sends,sent,bring,brings,brought,show,shows,showed,call,calls,called,text,texts,texted,ask,asks,asked,answer,answers,answered,open,opens,opened,close,closes,closed,end,ends,ended,change,changes,changed,move,moves,moved,live,lives,lived,stay,stays,stayed,sit,sits,sat,stand,stands,stood,walk,walks,walked,eat,eats,ate,drink,drinks,drank,sleep,sleeps,slept,wake,wakes,woke,work,works,play,plays,played,read,reads,write,writes,wrote,learn,learns,learned,teach,teaches,taught,help,helps,helped,try,tries,use,uses,used,find,finds,found,lose,loses,lost,win,wins,won,save,saves,saved,owe,owes,owed,mean,means,meant,last,lasts,lasted".split(
    ",",
  ),
);

const EMOTION_VOCAB = new Set([
  "anxious", "relieved", "proud", "frustrated", "hopeful", "overwhelmed",
  "grateful", "lonely", "determined", "ashamed", "content", "angry",
  "sad", "excited", "neutral",
  // Extended set for the one-proposition emotion check (§4.2's own example
  // uses "stressed", which is not in the §3.3 controlled vocabulary).
  // DESIGN-GAP: the §3.3 vocabulary governs enrichment; the user-model
  // emotion_state slot accepts dated free-text emotions, so the
  // multi-emotion guard uses this wider list.
  "stressed", "happy", "unhappy", "worried", "nervous", "calm", "relaxed",
  "tired", "exhausted", "bored", "confused", "surprised", "scared",
  "afraid", "jealous", "guilty", "embarrassed", "hopeless", "helpless",
  "motivated", "inspired", "focused", "distracted", "irritated", "annoyed",
  "disappointed", "satisfied", "confident", "insecure", "depressed",
  "okay", "fine", "great", "terrible", "awful", "good", "bad",
]);

function hasVerb(clause: string): boolean {
  return clause
    .toLowerCase()
    .split(/[^a-z']+/)
    .some((t) => VERB_HINTS.has(t));
}

/**
 * One-proposition rule (§4.2, B4): reject content expressing multiple
 * independent claims. Intentionally strict — merged claims are where
 * contradictions hide (T-U13).
 *
 * DESIGN-GAP: "different predicates about different subjects" is a semantic
 * judgment; this is a conservative syntactic heuristic. It rejects:
 *  - semicolons (always two statements),
 *  - `and`/`but` joining two clauses that each carry a verb,
 *  - (emotion_state) more than one emotion-vocabulary term.
 * It may false-positive on rhetorical repetition; the caller splits.
 */
export function validateOneProposition(content: string, slot: Slot): void {
  const text = content.trim();
  if (!text) {
    throw new ValidationError("multi_proposition", "Content must not be empty", {
      field: "content",
    });
  }
  if (/;/.test(text)) {
    throw new ValidationError(
      "multi_proposition",
      "One proposition per row (§4.2): content contains ';' — split into separate entries",
      { field: "content" },
    );
  }
  if (slot === "emotion_state") {
    const found = text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((t) => EMOTION_VOCAB.has(t));
    if (new Set(found).size > 1) {
      throw new ValidationError(
        "multi_proposition",
        `One emotion about one subject per emotion_state row (§4.2): found ${[...new Set(found)].join(", ")} — split into separate entries`,
        { field: "content" },
      );
    }
    return;
  }
  const clauses = text.split(/\b(?:and|but|however|whereas)\b/i);
  if (clauses.length > 1) {
    const withVerbs = clauses.filter((c) => hasVerb(c));
    if (withVerbs.length > 1) {
      throw new ValidationError(
        "multi_proposition",
        "One proposition per row (§4.2): content joins multiple independent clauses with 'and'/'but' — split into separate entries",
        { field: "content" },
      );
    }
  }
}

const TRIGGER_REJECTIONS: { pattern: RegExp; why: string }[] = [
  // Questions assert nothing.
  { pattern: /\?\s*$/, why: "question" },
  {
    pattern:
      /^(who|what|when|where|why|how|is|are|was|were|do|does|did|can|could|should|would|will|have|has)\b/i,
    why: "question",
  },
  // Hypotheticals.
  {
    pattern: /\b(what if|suppose|supposing|imagine|hypothetically)\b/i,
    why: "hypothetical",
  },
  { pattern: /\bif i (were|was|had|quit|moved|lost|got)\b/i, why: "hypothetical" },
  // Quotations of others: the claim is attributed to her, not his belief.
  {
    pattern: /\b(she|he|they)\s+(said|says|told me|thinks? i should|wants? me to)\b/i,
    why: "quote_of_other",
  },
  // Jokes / sarcasm markers: when in doubt, don't write.
  { pattern: /\b(lol|lmao|haha|rofl)\b/i, why: "joke" },
  // Third-person statements about NAMED OTHERS ("my brother thinks…" →
  // about his brother, not his state).
  // DESIGN-GAP: bare "he/she thinks|believes" is EXEMPT — the canonical
  // storage phrasing is third-person (§4.2: "believes the CNA fee is $85"),
  // so recordStated cannot distinguish "he believes X" (his belief,
  // normalized) from "he thinks X" (someone else's). The agent loop's
  // trigger applies to the raw utterance (first-person "I believe…");
  // recordStated's boundary is defense-in-depth for markers that survive
  // normalization (hypotheticals, quotes, jokes, questions). Higher-order
  // forms ("he thinks I think") are still caught by INV-TOM-1.
  {
    pattern:
      /^(my (brother|sister|mom|dad|mother|father|friend|girlfriend|baby mother|baby mama|ex|boss|coworker))\s+(thinks?|believes?|wants?|feels?|knows?|said|says)\b/i,
    why: "third_person",
  },
  // Negations of others' claims: about her meaning, not his state.
  {
    pattern: /\bnot what (she|he|they) (meant|said)\b/i,
    why: "negation_of_other",
  },
];

/**
 * Stated-write trigger boundary (§4.8). Conservative by design: false
 * negatives (missed statement, caught later by W3) beat false positives
 * (laundering a non-statement into 0.95 authority). T-U15.
 */
export function checkStatedTrigger(content: string): void {
  const text = content.trim();
  for (const { pattern, why } of TRIGGER_REJECTIONS) {
    if (pattern.test(text)) {
      throw new ValidationError(
        "trigger_boundary",
        `Stated-write trigger does not fire on ${why.replace(/_/g, " ")} (§4.8): no stated entry written`,
        { field: "content" },
      );
    }
  }
}

const HIGHER_ORDER_PATTERNS: RegExp[] = [
  // "he thinks I think …", "she believes I want …"
  /\b(thinks?|believes?|feels?|wants?|knows?|assumes?)\s+(i|me)\s+(think|believe|feel|want|know|assume)\b/i,
  // "she believes he wants …", "they think he knows …"
  /\b(thinks?|believes?|feels?|wants?|knows?|assumes?)\s+(he|she|they)\s+(think|believe|feel|want|know|assume)s?\b/i,
  // "I think he thinks …", "I know she believes …"
  /\bi\s+(think|believe|feel|know)\s+(he|she|they)\s+(think|believe|feel|want|know)s?\b/i,
];

/**
 * INV-TOM-1: first-order theory of mind only. The schema has no
 * representation for nested mental states; the write API rejects content
 * that asserts them. T-U11.
 */
export function checkFirstOrderOnly(content: string): void {
  for (const pattern of HIGHER_ORDER_PATTERNS) {
    if (pattern.test(content)) {
      throw new ValidationError(
        "higher_order_tom",
        "INV-TOM-1: higher-order theory-of-mind content rejected (first-order only: what the user believes/wants/knows/feels about the world)",
        { field: "content" },
      );
    }
  }
}

/* ------------------------------------------------------------------ */
/* Row mapping                                                        */
/* ------------------------------------------------------------------ */

interface UserModelRow {
  id: number;
  space_id: string;
  slot: string;
  content: string;
  confidence: number;
  evidence_strength: number;
  evidence_ids: string;
  topic_labels: string;
  valid_at: string;
  invalid_at: string | null;
  invalid_reason: string | null;
  replaced_by: number | null;
  origin: string;
  created_at: string;
}

function rowToEntry(
  h: DbHandle,
  spaceId: string,
  row: UserModelRow,
): UserModelEntry {
  const refs = parseJsonArray<EvidenceRef>(row.evidence_ids, []);
  const evidence = annotateEvidence(h, spaceId, refs);
  const labels = parseJsonArray<string>(row.topic_labels, []);
  return {
    id: row.id,
    spaceId: row.space_id,
    slot: row.slot as Slot,
    content: row.content,
    confidence: row.confidence,
    evidenceStrength: row.evidence_strength,
    evidence,
    evidenceAllWithdrawn:
      evidence.length > 0 && evidence.every((e) => e.status === "withdrawn"),
    topicLabels: labels,
    topicUncertain: labels.length === 0,
    validAt: row.valid_at,
    invalidAt: row.invalid_at,
    invalidReason: row.invalid_reason as InvalidReason | null,
    replacedBy: row.replaced_by,
    origin: row.origin as Origin,
    createdAt: row.created_at,
  };
}

/** Emotion expiry is enforced on reads, never by a sweep (gap 11, T-U8). */
const CURRENT_FILTER = `invalid_at IS NULL
  AND (slot != 'emotion_state' OR datetime(valid_at) > datetime('now', '-7 days'))`;

/* ------------------------------------------------------------------ */
/* Reads                                                              */
/* ------------------------------------------------------------------ */

export interface GetUserModelOpts {
  /** Slot filter (single slot or list). */
  slot?: Slot | Slot[];
  /** Max rows (by confidence desc). Undefined = no limit. */
  limit?: number;
}

/**
 * Current entries (invalid_at IS NULL), slot filter, read-time emotion
 * expiry, per-reference evidence_status annotation (§3.8). Read-only.
 */
export function getUserModel(
  h: DbHandle,
  spaceId: string,
  opts: GetUserModelOpts = {},
): UserModelEntry[] {
  const slots = opts.slot
    ? (Array.isArray(opts.slot) ? opts.slot : [opts.slot])
    : null;
  if (slots) {
    for (const s of slots) {
      if (!SLOTS.includes(s)) {
        throw new ValidationError("bad_slot", `Unknown slot '${s}'`, {
          field: "slot",
        });
      }
    }
  }
  const where = [`space_id = ?`, CURRENT_FILTER];
  const params: unknown[] = [spaceId];
  if (slots && slots.length > 0) {
    where.push(`slot IN (${slots.map(() => "?").join(",")})`);
    params.push(...slots);
  }
  let sql = `SELECT * FROM user_model WHERE ${where.join(" AND ")} ORDER BY confidence DESC`;
  if (opts.limit != null) {
    sql += ` LIMIT ?`;
    params.push(opts.limit);
  }
  const rows = h.sqlite.prepare(sql).all(...params) as UserModelRow[];
  return rows.map((r) => rowToEntry(h, spaceId, r));
}

/**
 * Full version chain via replaced_by links: walks backward to the oldest
 * ancestor (rows whose replaced_by points at the current node), then forward
 * through replaced_by, returning oldest → newest. Read-only.
 */
export function getUserModelHistory(
  h: DbHandle,
  spaceId: string,
  entryId: number,
): UserModelEntry[] {
  const start = h.sqlite
    .prepare(`SELECT * FROM user_model WHERE id = ? AND space_id = ?`)
    .get(entryId, spaceId) as UserModelRow | undefined;
  if (!start) {
    throw new ValidationError("entry_not_found", `user_model entry #${entryId} not found in this space`, {
      referencedId: entryId,
    });
  }
  // Walk backward: find rows this row replaced.
  let oldest = start;
  for (;;) {
    const prev = h.sqlite
      .prepare(
        `SELECT * FROM user_model WHERE space_id = ? AND replaced_by = ?`,
      )
      .get(spaceId, oldest.id) as UserModelRow | undefined;
    if (!prev) break;
    oldest = prev;
  }
  // Walk forward through replaced_by.
  const chain: UserModelRow[] = [oldest];
  let cursor = oldest;
  for (;;) {
    if (cursor.replaced_by == null) break;
    const next = h.sqlite
      .prepare(`SELECT * FROM user_model WHERE id = ? AND space_id = ?`)
      .get(cursor.replaced_by, spaceId) as UserModelRow | undefined;
    if (!next) break;
    chain.push(next);
    cursor = next;
  }
  return chain.map((r) => rowToEntry(h, spaceId, r));
}

/* ------------------------------------------------------------------ */
/* Deterministic contradiction detection (shared)                      */
/*                                                                     */
/* Used by recordStated() (INV-ST-1 invalidation targeting) and         */
/* knowledgeCheck() Stage 2 (deterministic rules first, §6.2).         */
/* Topic overlap is candidate-only — contradiction requires entity      */
/* identity + incompatible states (B3, Rev 4).                         */
/* ------------------------------------------------------------------ */

/** Extract entity-ish tokens: capitalized phrases, $-amounts, quoted spans. */
export function extractEntities(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g,
  )) {
    const t = m[1].toLowerCase();
    if (t.length > 2 && !STOPWORDS.has(t)) found.add(t);
  }
  for (const m of text.matchAll(/[""]([^""]{2,40})[""]/g)) {
    found.add(m[1].toLowerCase().trim());
  }
  for (const m of text.matchAll(/\$\s?[\d,]+(?:\.\d{1,2})?/g)) {
    found.add(m[0].toLowerCase().replace(/[\s,]+$/g, ""));
  }
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    if (m[0].length >= 2) found.add(m[0]);
  }
  return [...found];
}

const NEGATION_RE =
  /\b(don't|doesn't|didn't|never|no longer|not|n't|cannot|can't|won't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|doesn't|no)\b/i;

const TERMINATION_VERBS = /\b(quit|quits|left|stopped|no longer|ended|resigned)\b/i;
const INITIATION_VERBS =
  /\b(started|began|joined|hired|now (?:at|working)|switched to)\b/i;

const UNEMPLOYED_PATTERNS =
  /\b(in between jobs|unemployed|unemployment|jobless|between gigs|out of work|no job|lost (?:my|the|his) job)\b/i;
const EMPLOYED_PATTERNS =
  /\b(works? at|worked at|working at|started (?:at|working)|employed|has a job|got (?:the|a) job|hired at)\b/i;

const DAY_SETS: Record<string, string[]> = {
  monday: ["monday"], tuesday: ["tuesday"], wednesday: ["wednesday"],
  thursday: ["thursday"], friday: ["friday"], saturday: ["saturday"],
  sunday: ["sunday"],
  weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  weekends: ["saturday", "sunday"],
  weekend: ["saturday", "sunday"],
};

function mentionedDays(text: string): Set<string> {
  const days = new Set<string>();
  const lower = text.toLowerCase();
  for (const [key, members] of Object.entries(DAY_SETS)) {
    if (new RegExp(`\\b${key}s?\\b`, "i").test(lower)) {
      for (const d of members) days.add(d);
    }
  }
  return days;
}

const PAST_STATE_RE =
  /\b(used to|was|were|back then|previously)\b/i;
// DESIGN-GAP: past TIME adverbials ("last week", "before October") do NOT by
// themselves mark succession — "quit Samsonite last week" is a transition,
// not history. Only past-STATE verbs (was/were/used to) scope the claim to a
// prior period (T-K8). Transition language takes precedence over adverbials.

function extractNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/\$\s?[\d,]+(?:\.\d{1,2})?/g)) {
    found.add(m[0].replace(/\s+/g, ""));
  }
  for (const m of text.toLowerCase().matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    if (m[0].length >= 2) found.add(m[0]);
  }
  return [...found];
}

/**
 * Deterministic contradiction verdict between a candidate text and an entry.
 * Returns the rule that fired, or null. This is the B3 Rev 4 core:
 * - genuine_negation: same entity + A asserts P, B asserts ¬P (includes
 *   employment-status incompatibility and day-set negation).
 * - explicit_transition: candidate terminates the entry's entity state and/or
 *   begins a new state at a different entity (T-K18b, T-K17-adjacent).
 * - succession: candidate explicitly scopes to the past — not a contradiction.
 */
export function detectContradiction(
  candidateText: string,
  entry: { content: string; slot: Slot },
): "genuine_negation" | "explicit_transition" | "succession" | null {
  const cand = candidateText;
  const ent = entry.content;
  const candEnts = new Set(extractEntities(cand));
  const entEnts = new Set(extractEntities(ent));
  const shareEntity = [...candEnts].some((e) => entEnts.has(e));

  // 1. Temporal succession: past-STATE verbs scope the claim to a prior
  //    period — "I was in between jobs" describes history, not now (T-K8).
  //    Checked first, but only on past-state verbs (see PAST_STATE_RE note).
  if (PAST_STATE_RE.test(cand) && !PAST_STATE_RE.test(ent)) {
    return "succession";
  }

  // 2. Employment-status incompatibility (T-K5/K6/K11/K12): the user is the
  //    implicit entity; employed-state vs unemployed-state cannot both hold.
  const candUnemp = UNEMPLOYED_PATTERNS.test(cand);
  const candEmp = EMPLOYED_PATTERNS.test(cand);
  const entUnemp = UNEMPLOYED_PATTERNS.test(ent);
  const entEmp = EMPLOYED_PATTERNS.test(ent);
  if ((candUnemp && entEmp) || (candEmp && entUnemp)) return "genuine_negation";

  // 3. Day-set negation (T-K7): "don't work weekends" vs "works Saturdays".
  //    T-K13 guard: "free on weekdays" is availability, not a work negation —
  //    no polarity flip, no contradiction.
  const candDays = mentionedDays(cand);
  const entDays = mentionedDays(ent);
  if (candDays.size > 0 && entDays.size > 0) {
    const candNegWork =
      NEGATION_RE.test(cand) && /\bwork/i.test(cand);
    const entPosWork = /\bwork/i.test(ent) && !NEGATION_RE.test(ent);
    const entNegWork = NEGATION_RE.test(ent) && /\bwork/i.test(ent);
    const candPosWork = /\bwork/i.test(cand) && !NEGATION_RE.test(cand);
    const overlap = [...candDays].some((d) => entDays.has(d));
    if (overlap && ((candNegWork && entPosWork) || (entNegWork && candPosWork))) {
      return "genuine_negation";
    }
  }

  // 4. Explicit transition (T-K18b): candidate terminates the ENTRY's entity
  //    state ("quit Samsonite") and/or begins a new one at a different
  //    entity ("started at Amazon"). T-K14 guard: "quit the warehouse" does
  //    NOT name Samsonite — no entity identity, no fire.
  if (shareEntity && TERMINATION_VERBS.test(cand)) {
    return "explicit_transition";
  }
  if (
    shareEntity &&
    NEGATION_RE.test(cand) &&
    INITIATION_VERBS.test(cand) &&
    candEnts.size > 0 &&
    [...candEnts].some((e) => !entEnts.has(e))
  ) {
    return "explicit_transition";
  }

  // 5. Genuine negation: same entity, shared proposition, one side negated.
  if (shareEntity && NEGATION_RE.test(cand) !== NEGATION_RE.test(ent)) {
    if (tokenJaccard(cand, ent) >= 0.35) return "genuine_negation";
  }

  // 6. Incompatible values: same subject, different numeric claims —
  //    "the fee is $85" vs "the fee is $100" (T-U2 write-path invalidation).
  const candNums = new Set(extractNumbers(cand));
  const entNums = new Set(extractNumbers(ent));
  if (candNums.size > 0 && entNums.size > 0) {
    const shareNumber = [...candNums].some((n) => entNums.has(n));
    if (!shareNumber) {
      const stripNums = (t: string) =>
        t.replace(/\$\s?[\d,]+(?:\.\d{1,2})?/g, " ").replace(/\b\d+(?:\.\d+)?\b/g, " ");
      if (tokenJaccard(stripNums(cand), stripNums(ent)) >= 0.4) {
        return "genuine_negation";
      }
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Independence + evidence strength                                    */
/* ------------------------------------------------------------------ */

/**
 * INV-IND-1 (§4.4): confidence rises only from INDEPENDENT evidence.
 * - Two mentions in the same conversation (same episode) = 1 observation.
 * - A node distilled from an episode is not independent of that episode.
 * - Restatements on different days = independent.
 * W2 defines the function + rule; W3 implements the job.
 */
export function assessIndependence(
  a: EvidenceMeta,
  b: EvidenceMeta,
): boolean {
  if (a.ref.type === b.ref.type && a.ref.id === b.ref.id) return false;
  const epOf = (m: EvidenceMeta): number | null => {
    if (m.ref.type === "episode") return m.ref.id;
    return m.derivedFromEpisodeId ?? m.episodeId ?? null;
  };
  const aEp = epOf(a);
  const bEp = epOf(b);
  if (aEp != null && bEp != null && aEp === bEp) return false;
  // Node derived from the cited episode (or vice versa).
  if (
    a.ref.type === "node" &&
    b.ref.type === "episode" &&
    a.derivedFromEpisodeId === b.ref.id
  )
    return false;
  if (
    b.ref.type === "node" &&
    a.ref.type === "episode" &&
    b.derivedFromEpisodeId === a.ref.id
  )
    return false;
  // DESIGN-GAP: "different days = independent" is approximated from
  // occurredAt when both are present; when timestamps are unknown the pair
  // is conservatively treated as independent ONLY if neither shares an
  // episode (handled above) — the caller should supply occurredAt for
  // same-day same-conversation dedup beyond episode linkage.
  return true;
}

/** Count independent observation clusters (union-find over dependent pairs). */
export function independentSourceCount(metas: EvidenceMeta[]): number {
  const n = metas.length;
  if (n === 0) return 0;
  const parent = metas.map((_, i) => i);
  const find = (x: number): number =>
    parent[x] === x ? x : (parent[x] = find(parent[x]));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!assessIndependence(metas[i], metas[j])) {
        parent[find(i)] = find(j);
      }
    }
  }
  return new Set(metas.map((_, i) => find(i))).size;
}

export interface EvidenceStrengthInput {
  independentSources: number;
  /** Canonical ISO UTC of the newest evidence; null/unknown → neutral. */
  newestEvidenceAt?: string | null;
  statedBonus: boolean;
  /** Number of distinct evidence types (episode/node/correction/enrichment). */
  distinctTypes: number;
  now?: string;
}

/**
 * evidence_strength (§4.2):
 * min(1, 0.35·independent_sources + 0.25·recency_factor + 0.20·stated_bonus + 0.20·diversity)
 * - independent_sources capped at 3 for the term
 * - recency_factor = 0.5^(days_since_newest_evidence / 30)
 * - diversity = distinct types / 3 (capped at 1)
 */
export function computeEvidenceStrength(
  input: EvidenceStrengthInput,
): number {
  const independent = 0.35 * Math.min(3, Math.max(0, input.independentSources));
  let recency = 0.5;
  // DESIGN-GAP: when the newest-evidence timestamp is unknown, recency is
  // neutral (0.5) rather than optimistic (1.0) or punitive (0.0) — it
  // contributes, but neither inflates nor tanks, the score.
  if (input.newestEvidenceAt) {
    const nowMs = input.now ? Date.parse(input.now) : Date.now();
    const evMs = Date.parse(input.newestEvidenceAt);
    if (!Number.isNaN(evMs)) {
      const days = Math.max(0, (nowMs - evMs) / 86_400_000);
      recency = Math.pow(0.5, days / 30);
    }
  }
  const stated = input.statedBonus ? 0.2 : 0;
  const diversity = 0.2 * Math.min(1, Math.max(0, input.distinctTypes) / 3);
  return Math.min(1, independent + 0.25 * recency + stated + diversity);
}

/** Build the EvidenceStrengthInput from evidence metadata at write time. */
export function evidenceStrengthFromMeta(
  evidence: EvidenceInput[],
  origin: Origin,
  now: string,
): number {
  const metas: EvidenceMeta[] = evidence.map((e) => ({
    ref: { type: e.type, id: e.id },
    episodeId: e.episodeId ?? null,
    derivedFromEpisodeId: e.derivedFromEpisodeId ?? null,
    occurredAt: e.occurredAt ?? null,
    signalType: e.signalType ?? null,
  }));
  const independentSources = independentSourceCount(metas);
  const times = evidence
    .map((e) => e.occurredAt)
    .filter((t): t is string => !!t && !Number.isNaN(Date.parse(t)));
  // DESIGN-GAP: for `stated` entries the evidence is typically the live
  // statement itself; when the caller supplies no timestamps we fall back to
  // the write time (evidence observed now) rather than neutral 0.5 — stated
  // evidence is fresh by construction.
  const newest =
    times.length > 0
      ? times.reduce((a, b) => (a > b ? a : b))
      : origin === "stated"
        ? now
        : null;
  const statedBonus =
    origin === "stated" ||
    evidence.some((e) => e.type === "correction" || e.isUserStatement === true);
  const distinctTypes = new Set(evidence.map((e) => e.type)).size;
  return computeEvidenceStrength({
    independentSources,
    newestEvidenceAt: newest,
    statedBonus,
    distinctTypes,
    now,
  });
}

/* ------------------------------------------------------------------ */
/* recordStated — the `stated` write path (§4.5.1)                      */
/* ------------------------------------------------------------------ */

export interface RecordStatedOpts {
  /**
   * Where the content came from. INV-PERSONA-1: content derived from the
   * user_persona blob requires explicit user confirmation (T-U12).
   */
  source?: string;
  userConfirmed?: boolean;
}

export interface RecordStatedResult {
  id: number;
  entry: UserModelEntry;
  /** Ids of inferred/consolidated entries invalidated via INV-ST-1. */
  invalidatedIds: number[];
  /** Current stated entries in the same slot that conflict (not invalidated). */
  conflictingStatedIds: number[];
}

/**
 * Write a `stated` entry at 0.95 (T-U1). The agent loop calls this only when
 * the §4.8 trigger fires; the function re-validates the boundary itself so a
 * misfiring caller cannot launder non-statements into 0.95 authority.
 *
 * - one-proposition rule (§4.2) — multi-claim content rejected
 * - stated-trigger boundary (§4.8) — hypotheticals/quotes/jokes/third-person/
 *   questions rejected
 * - INV-TOM-1 — higher-order content rejected
 * - INV-EV-1 — empty evidence rejected; refs validated (§3.8)
 * - INV-ENRICH-1 — generated-labeled enrichment content rejected
 * - INV-PERSONA-1 — persona-blob content without user confirmation rejected
 * - INV-ST-1 — contradicted inferred/consolidated entries in the same slot
 *   are invalidated (invalid_at, invalid_reason='superseded', replaced_by)
 *   BEFORE the insert (T-U2, T-U14).
 */
export function recordStated(
  h: DbHandle,
  spaceId: string,
  slot: Slot,
  content: string,
  evidence: EvidenceInput[],
  opts: RecordStatedOpts = {},
): RecordStatedResult {
  if (!SLOTS.includes(slot)) {
    throw new ValidationError("bad_slot", `Unknown slot '${slot}'`, {
      field: "slot",
    });
  }
  // INV-PERSONA-1: the user_persona blob is never auto-converted to stated.
  if (
    opts.source === "user_persona_blob" ||
    opts.source === "persona_backfill"
  ) {
    if (opts.userConfirmed !== true) {
      throw new ValidationError(
        "persona_backfill",
        "INV-PERSONA-1: content derived from the user_persona blob requires explicit user confirmation before it can become a stated entry (T-U12)",
        { field: "content" },
      );
    }
  }
  validateOneProposition(content, slot);
  // INV-TOM-1 before the trigger boundary: "he thinks I think …" is
  // higher-order ToM (rejected as such), not merely third-person.
  checkFirstOrderOnly(content);
  checkStatedTrigger(content);
  validateEvidenceRefs(h, spaceId, evidence);
  for (const e of evidence) {
    if (e.type === "enrichment") {
      checkEnrichmentQuarantine(h, spaceId, e.id, "stated");
    }
  }

  const now = nowIso();
  const { labels } = mapTopics(content);
  const evidenceStrength = evidenceStrengthFromMeta(evidence, "stated", now);
  const sqlite = h.sqlite;

  const contradicted = findContradictedEntries(
    sqlite,
    spaceId,
    slot,
    labels,
    content,
    now,
    ["inferred", "consolidated"],
  );
  const conflictingStated = findContradictedEntries(
    sqlite,
    spaceId,
    slot,
    labels,
    content,
    now,
    ["stated"],
  );

  return sqlite.transaction((): RecordStatedResult => {
    const insert = sqlite.prepare(
      `INSERT INTO user_model
         (space_id, slot, content, confidence, evidence_strength, evidence_ids,
          topic_labels, valid_at, invalid_at, invalid_reason, replaced_by, origin)
       VALUES (?, ?, ?, 0.95, ?, ?, ?, ?, NULL, NULL, NULL, 'stated')`,
    );
    const info = insert.run(
      spaceId,
      slot,
      content.trim(),
      evidenceStrength,
      JSON.stringify(evidence.map((e) => ({ type: e.type, id: e.id }))),
      JSON.stringify(labels),
      now,
    );
    const newId = Number(info.lastInsertRowid);

    const invalidate = sqlite.prepare(
      `UPDATE user_model
       SET invalid_at = ?, invalid_reason = 'superseded', replaced_by = ?
       WHERE id = ? AND invalid_at IS NULL`,
    );
    const invalidatedIds: number[] = [];
    for (const row of contradicted) {
      invalidate.run(now, newId, row.id);
      invalidatedIds.push(row.id);
    }

    // W3 §8.6: one stated row written (the insert above) — bump in this
    // same transaction. The invalidations here target inferred/consolidated
    // rows only (see the finder origins above), so the count is exactly 1.
    bumpStatedSetVersion(sqlite, spaceId, 1);

    auditLog(
      sqlite,
      spaceId,
      "stated_recorded",
      `stated_recorded entry_id=${newId} slot=${slot}`,
      {
        entry_id: newId,
        slot,
        origin: "stated",
        invalidated_ids: invalidatedIds,
        conflicting_stated_ids: conflictingStated.map((r) => r.id),
      },
      "ok",
    );

    const row = sqlite
      .prepare(`SELECT * FROM user_model WHERE id = ?`)
      .get(newId) as UserModelRow;
    return {
      id: newId,
      entry: rowToEntry(h, spaceId, row),
      invalidatedIds,
      conflictingStatedIds: conflictingStated.map((r) => r.id),
    };
  })();
}

/* ------------------------------------------------------------------ */
/* updateUserModel — W3's `consolidated` write API (§4.5.3)             */
/* ------------------------------------------------------------------ */

export interface UpdateUserModelInput {
  slot: Slot;
  content: string;
  /** Report confidence: P(user holds this state | evidence). */
  confidence: number;
  evidence: EvidenceInput[];
  /** If omitted, assigned via the topic mapper at write time. */
  topicLabels?: string[];
  /** When this entry became the model's belief. Defaults to now. */
  validAt?: string;
  source?: string;
  userConfirmed?: boolean;
}

export interface UpdateUserModelResult {
  id: number;
  entry: UserModelEntry;
  invalidatedIds: number[];
}

/**
 * W3's write API for `consolidated` entries (and future `inferred` rules —
 * W2 ships zero hot-path inference rules per §4.5.2).
 *
 * - origin must be 'inferred' | 'consolidated' ('stated' → use recordStated)
 * - origin ceiling: inferred ≤ 0.69 (T-U4); consolidated ≤ 0.94
 *   (0.95–1.0 reserved for stated, §4.4)
 * - confidence ≥ 0.10 floor (below the noise floor: not stored)
 * - INV-EV-1: non-empty, validated evidence
 * - INV-ENRICH-1: provenance quarantine on enrichment evidence
 * - one-proposition rule + INV-TOM-1 apply to all origins
 * - contradicted current entries in the same slot are invalidated
 *   (contradiction does not average, §4.4 rule 5)
 */
export function updateUserModel(
  h: DbHandle,
  spaceId: string,
  origin: Origin,
  entry: UpdateUserModelInput,
): UpdateUserModelResult {
  if (!SLOTS.includes(entry.slot)) {
    throw new ValidationError("bad_slot", `Unknown slot '${entry.slot}'`, {
      field: "slot",
    });
  }
  if (origin === "stated") {
    throw new ValidationError(
      "origin_forbidden",
      "Use recordStated() for 'stated' entries — updateUserModel() is for 'inferred' | 'consolidated' only",
      { field: "origin" },
    );
  }
  if (
    entry.source === "user_persona_blob" ||
    entry.source === "persona_backfill"
  ) {
    if (entry.userConfirmed !== true) {
      throw new ValidationError(
        "persona_backfill",
        "INV-PERSONA-1: content derived from the user_persona blob requires explicit user confirmation (T-U12)",
        { field: "content" },
      );
    }
  }
  if (
    typeof entry.confidence !== "number" ||
    Number.isNaN(entry.confidence) ||
    entry.confidence < 0.1 ||
    entry.confidence > 1
  ) {
    throw new ValidationError(
      "bad_confidence",
      `Confidence must be in [0.10, 1.00] (below 0.10 is not stored, §4.4); got ${entry.confidence}`,
      { field: "confidence" },
    );
  }
  if (origin === "inferred" && entry.confidence > 0.69) {
    throw new ValidationError(
      "origin_ceiling",
      `Origin ceiling (§4.4): 'inferred' entries cap at 0.69; got ${entry.confidence} (T-U4)`,
      { field: "confidence" },
    );
  }
  if (origin === "consolidated" && entry.confidence > 0.94) {
    // DESIGN-GAP: §4.4 reserves 0.95–1.00 for stated entries ("Certain that
    // he holds this state ... Reserved for stated entries"). The band table
    // gives consolidation 0.70–0.94 as "Probable"; no explicit consolidated
    // ceiling is stated, so 0.94 is the conservative cap that keeps the
    // stated band exclusive.
    throw new ValidationError(
      "origin_ceiling",
      `Origin ceiling (§4.4): 0.95–1.00 is reserved for 'stated' entries; 'consolidated' caps at 0.94; got ${entry.confidence}`,
      { field: "confidence" },
    );
  }
  validateOneProposition(entry.content, entry.slot);
  checkFirstOrderOnly(entry.content);
  validateEvidenceRefs(h, spaceId, entry.evidence);
  for (const e of entry.evidence) {
    if (e.type === "enrichment") {
      checkEnrichmentQuarantine(h, spaceId, e.id, origin);
    }
  }

  const now = nowIso();
  const labels =
    entry.topicLabels && entry.topicLabels.length > 0
      ? entry.topicLabels.filter((l) =>
          (TOPIC_VOCABULARY as readonly string[]).includes(l),
        )
      : mapTopics(entry.content).labels;
  const validAt = entry.validAt ?? now;
  const evidenceStrength = evidenceStrengthFromMeta(entry.evidence, origin, now);
  const sqlite = h.sqlite;

  const contradicted = findContradictedEntries(
    sqlite,
    spaceId,
    entry.slot,
    labels,
    entry.content,
    validAt,
    ["inferred", "consolidated", "stated"],
  ).filter((r) => r.origin !== "stated");
  // W3 §1.2 hardening (was a DESIGN-GAP): stated entries are excluded
  // UNCONDITIONALLY — at ANY confidence. A stated row is the user's own
  // word; only the correction path (correctUserModel) or a newer statement
  // (recordStated) may touch it. The earlier 0.95 carve-out let a
  // consolidated/inferred write invalidate a stated entry at 0.90 (T-C23).
  // Stated-vs-stated conflicts still surface via recordStated's
  // conflictingStatedIds for the correction path.

  return sqlite.transaction((): UpdateUserModelResult => {
    const info = sqlite
      .prepare(
        `INSERT INTO user_model
           (space_id, slot, content, confidence, evidence_strength, evidence_ids,
            topic_labels, valid_at, invalid_at, invalid_reason, replaced_by, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
      )
      .run(
        spaceId,
        entry.slot,
        entry.content.trim(),
        entry.confidence,
        evidenceStrength,
        JSON.stringify(entry.evidence.map((e) => ({ type: e.type, id: e.id }))),
        JSON.stringify(labels),
        validAt,
        origin,
      );
    const newId = Number(info.lastInsertRowid);

    const invalidate = sqlite.prepare(
      `UPDATE user_model
       SET invalid_at = ?, invalid_reason = 'superseded', replaced_by = ?
       WHERE id = ? AND invalid_at IS NULL`,
    );
    const invalidatedIds: number[] = [];
    let statedRowsWritten = 0;
    for (const row of contradicted) {
      invalidate.run(now, newId, row.id);
      invalidatedIds.push(row.id);
      if (row.origin === "stated") statedRowsWritten++;
    }
    // W3 §8.6: bump for any stated-row write this call performs, same
    // transaction. Post-hardening the count is always 0 (stated rows are
    // excluded above); the wiring stays so the contract holds in any form.
    bumpStatedSetVersion(sqlite, spaceId, statedRowsWritten);

    auditLog(
      sqlite,
      spaceId,
      "user_model_updated",
      `user_model_updated entry_id=${newId} origin=${origin} slot=${entry.slot}`,
      {
        entry_id: newId,
        origin,
        slot: entry.slot,
        invalidated_ids: invalidatedIds,
      },
      "ok",
    );

    const row = sqlite
      .prepare(`SELECT * FROM user_model WHERE id = ?`)
      .get(newId) as UserModelRow;
    return {
      id: newId,
      entry: rowToEntry(h, spaceId, row),
      invalidatedIds,
    };
  })();
}

/**
 * Contradiction identification (§4.2): same slot + topic overlap + temporal
 * overlap (the candidate's [validAt, ...) window covers the entry's window)
 * + a deterministic contradiction rule fires (entity identity + incompatible
 * states, B3 Rev 4 — topic overlap alone never invalidates).
 */
function findContradictedEntries(
  sqlite: RawDb,
  spaceId: string,
  slot: Slot,
  topicLabels: string[],
  content: string,
  validAt: string,
  origins: Origin[],
): UserModelRow[] {
  const rows = sqlite
    .prepare(
      `SELECT * FROM user_model
       WHERE space_id = ? AND slot = ? AND invalid_at IS NULL
         AND origin IN (${origins.map(() => "?").join(",")})`,
    )
    .all(spaceId, slot, ...origins) as UserModelRow[];
  return rows.filter((row) => {
    const rowLabels = new Set(parseJsonArray<string>(row.topic_labels, []));
    const overlap =
      topicLabels.length === 0 || // topic-uncertain candidate: temporal+rule only
      topicLabels.some((l) => rowLabels.has(l));
    if (!overlap) return false;
    // Temporal overlap: the new claim's valid_at falls inside the entry's
    // current window (entry is current → [valid_at, now)).
    if (row.valid_at > validAt) return false;
    const verdict = detectContradiction(content, {
      content: row.content,
      slot: row.slot as Slot,
    });
    return verdict === "genuine_negation" || verdict === "explicit_transition";
  });
}

/* ------------------------------------------------------------------ */
/* correctUserModel — correction semantics (§4.6)                       */
/* ------------------------------------------------------------------ */

export type CorrectionType =
  | "false_belief" // "That's wrong, I don't believe X"
  | "factual_update" // "I used to want X, now I want Y"
  | "preference_override"; // "Stop assuming X about me"

const CORRECTION_INVALID_REASON: Record<CorrectionType, InvalidReason> = {
  false_belief: "corrected_false_belief",
  factual_update: "superseded",
  preference_override: "user_override",
};

export interface CorrectionInput {
  /** The user's correction text (e.g. "that's wrong about the fee"). */
  text: string;
  type: CorrectionType;
  /**
   * For factual_update: the replacement belief the user stated
   * (e.g. "the fee is $90"). Written as a new stated entry at 0.95 with a
   * replaced_by link. Requires `evidence` (the correction's own evidence).
   */
  newContent?: string;
  evidence?: EvidenceInput[];
  /**
   * For preference_override: a constraint the user EXPLICITLY stated
   * (e.g. "never infer that I'm broke"). Written only when provided —
   * a constraint is NEVER inferred from the correction itself (T-U7).
   */
  constraintContent?: string;
  constraintEvidence?: EvidenceInput[];
}

export interface CorrectUserModelResult {
  status: "applied" | "abstained";
  /** The entry that was invalidated (null when abstained). */
  entryId: number | null;
  /** New stated entry id for factual_update replacements (null otherwise). */
  newEntryId: number | null;
  /**
   * Stated constraint entry id, when the user explicitly stated one
   * (preference_override). Written even when targeting abstains — the
   * constraint was explicitly stated, not inferred (T-U7).
   */
  constraintEntryId?: number | null;
  /** Inquiry text when abstained — surface to the user. */
  inquiry?: string;
  /** Candidate scores when abstained (debuggable, content-free ids). */
  candidateScores?: { id: number; score: number }[];
}

/** Score a correction's match to a candidate target entry (§4.6 step 2). */
function scoreCorrectionTarget(
  correctionText: string,
  entry: UserModelRow,
  now: string,
): number {
  const { labels: corrLabels } = mapTopics(correctionText);
  const entryLabels = parseJsonArray<string>(entry.topic_labels, []);
  const union = new Set([...corrLabels, ...entryLabels]);
  const topicOverlap =
    union.size === 0
      ? 0
      : corrLabels.filter((l) => entryLabels.includes(l)).length / union.size;
  const corrEnts = new Set(extractEntities(correctionText));
  const entryEnts = new Set(extractEntities(entry.content));
  let lexical: number;
  if (corrEnts.size === 0 && entryEnts.size === 0) {
    // No entities on either side (e.g. "the bus is reliable"): fall back to
    // proposition containment — the entry's full claim inside the correction
    // is a strong target signal (T-U18).
    const entryToks = new Set(contentTokens(entry.content));
    const corrToks = new Set(contentTokens(correctionText));
    lexical =
      entryToks.size === 0
        ? 0
        : [...entryToks].filter((t) => corrToks.has(t)).length / entryToks.size;
  } else {
    lexical =
      entryEnts.size === 0
        ? 0
        : [...entryEnts].filter((e) => corrEnts.has(e)).length / entryEnts.size;
  }
  let temporal = 0;
  const validMs = Date.parse(entry.valid_at);
  if (!Number.isNaN(validMs)) {
    const days = Math.max(0, (Date.parse(now) - validMs) / 86_400_000);
    temporal = 1 - Math.min(1, days / 30);
  }
  // DESIGN-GAP: §4.6 names the three signals (topic overlap depth, entity
  // match, temporal proximity) but not their weights. Entity identity is the
  // discriminator per B3 Rev 4 (topic overlap alone is candidate-only), so it
  // carries the weight; the topic+temporal floor is kept low enough that a
  // same-topic non-matching entry cannot reach the 0.40 next-best ceiling
  // (T-U16 abstains, T-U17 targets). When neither side yields entities, the
  // lexical term falls back to proposition containment (T-U18).
  return 0.25 * topicOverlap + 0.65 * lexical + 0.1 * temporal;
}

/**
 * Correction semantics (§4.6). INV-CORR-1: corrections supersede, never
 * delete — invalid_at + invalid_reason + replaced_by; no DELETE.
 *
 * Targeting with abstain-on-ambiguity: candidates = current entries in the
 * same slot with topic overlap. If exactly one candidate scores ≥ 0.70 and
 * the next-best scores < 0.40 → invalidate it. Otherwise → abstain: log
 * `correction_ambiguous`, surface an inquiry, change NOTHING (T-U16).
 *
 * - false_belief → corrected_false_belief; no replacement unless newContent
 *   is given. Belief withdrawal without replacement leaves replaced_by NULL
 *   (T-U18).
 * - factual_update → superseded + new stated entry (replaced_by link).
 * - preference_override → user_override; NO replacement; a constraint entry
 *   is written ONLY from explicit constraintContent — never inferred from
 *   the correction itself (T-U7).
 */
export function correctUserModel(
  h: DbHandle,
  spaceId: string,
  entryId: number | null,
  correction: CorrectionInput,
): CorrectUserModelResult {
  const sqlite = h.sqlite;
  const now = nowIso();

  const explicit = entryId != null
    ? (sqlite
        .prepare(`SELECT * FROM user_model WHERE id = ? AND space_id = ?`)
        .get(entryId, spaceId) as UserModelRow | undefined)
    : undefined;
  if (entryId != null && !explicit) {
    throw new ValidationError(
      "entry_not_found",
      `user_model entry #${entryId} not found in this space`,
      { referencedId: entryId },
    );
  }
  if (explicit && explicit.invalid_at != null) {
    throw new ValidationError(
      "entry_not_current",
      `user_model entry #${entryId} is already invalidated (invalid_reason=${explicit.invalid_at ? explicit.invalid_reason : "?"})`,
      { referencedId: entryId ?? undefined },
    );
  }

  // Candidate set: same slot as the explicit target (or, when entryId is
  // null, all current entries) + topic overlap with the correction.
  const slotFilter = explicit ? `AND slot = ?` : "";
  const slotParams: unknown[] = explicit ? [explicit.slot] : [];
  const pool = sqlite
    .prepare(
      `SELECT * FROM user_model WHERE space_id = ? AND invalid_at IS NULL ${slotFilter}`,
    )
    .all(spaceId, ...slotParams) as UserModelRow[];

  const { labels: corrLabels } = mapTopics(correction.text);
  const candidates = pool.filter((row) => {
    const rowLabels = parseJsonArray<string>(row.topic_labels, []);
    return (
      corrLabels.length === 0 || corrLabels.some((l) => rowLabels.includes(l))
    );
  });

  const scored = candidates
    .map((row) => ({ row, score: scoreCorrectionTarget(correction.text, row, now) }))
    .sort((a, b) => b.score - a.score);

  const candidateScores = scored.map((s) => ({ id: s.row.id, score: s.score }));
  const best = scored[0] as { row: UserModelRow; score: number } | undefined;
  const nextBest = scored[1] as { row: UserModelRow; score: number } | undefined;

  const hasUniqueWinner =
    best !== undefined &&
    best.score >= 0.7 &&
    (nextBest === undefined || nextBest.score < 0.4);

  // If the caller named an explicit entry, the winner must BE that entry —
  // invalidating a different entry than the user pointed at is exactly the
  // failure the humility rule exists to prevent.
  const winnerMatchesExplicit =
    !explicit || (hasUniqueWinner && best!.row.id === explicit.id);

  if (!hasUniqueWinner || !winnerMatchesExplicit) {
    // ABSTAIN on the invalidation — but an explicitly stated constraint is
    // still written: it was stated, not inferred (T-U7). The invalidation is
    // what was ambiguous, not the constraint.
    let constraintEntryId: number | null = null;
    if (correction.type === "preference_override" && correction.constraintContent) {
      constraintEntryId = writeExplicitConstraint(
        h, spaceId, correction, now,
      );
      auditLog(
        sqlite,
        spaceId,
        "correction_applied",
        `correction_applied entry_id=null type=${correction.type} constraint_id=${constraintEntryId} (targeting abstained)`,
        {
          entry_id: null,
          correction_type: correction.type,
          constraint_entry_id: constraintEntryId,
          targeting: "abstained",
        },
        "ok",
      );
    }
    // ABSTAIN: log + inquiry, change nothing else.
    auditLog(
      sqlite,
      spaceId,
      "correction_ambiguous",
      `correction_ambiguous candidates=${scored.length}`,
      {
        // §4.6 Rev 3: the log carries the correction text so the inquiry can
        // be reconstructed by the review path.
        // DESIGN-GAP: this deliberately carries user text, unlike the
        // content-free audit convention elsewhere — sanctioned by the §4.6
        // contract ("log correction_ambiguous with {correction_text, ...}").
        correction_text: correction.text,
        candidate_ids: candidateScores.map((c) => c.id),
        scores: Object.fromEntries(
          candidateScores.map((c) => [c.id, Number(c.score.toFixed(3))]),
        ),
        explicit_entry_id: entryId,
        correction_type: correction.type,
      },
      "abstained",
    );
    const options = scored
      .slice(0, 5)
      .map((s) => `  - "${s.row.content}" (${s.row.slot})`)
      .join("\n");
    return {
      status: "abstained",
      entryId: null,
      newEntryId: null,
      constraintEntryId,
      inquiry:
        `You said "${correction.text}" — which of these did you mean?\n${options}` ||
        `You said "${correction.text}" — I couldn't tell which entry you meant.`,
      candidateScores,
    };
  }

  // Past the abstain guard: hasUniqueWinner is true and best is defined.
  const target = best!.row;
  const invalidReason = CORRECTION_INVALID_REASON[correction.type];

  return sqlite.transaction((): CorrectUserModelResult => {
    let newEntryId: number | null = null;

    // factual_update with a stated replacement: write the new stated entry
    // first so replaced_by can link to it.
    if (correction.type === "factual_update" && correction.newContent) {
      if (!correction.evidence || correction.evidence.length === 0) {
        throw new ValidationError(
          "empty_evidence",
          "INV-EV-1: a factual_update replacement requires evidence",
          { field: "evidence" },
        );
      }
      const { labels } = mapTopics(correction.newContent);
      validateOneProposition(correction.newContent, target.slot as Slot);
      checkFirstOrderOnly(correction.newContent);
      checkStatedTrigger(correction.newContent);
      validateEvidenceRefs(h, spaceId, correction.evidence);
      const strength = evidenceStrengthFromMeta(
        correction.evidence,
        "stated",
        now,
      );
      const info = sqlite
        .prepare(
          `INSERT INTO user_model
             (space_id, slot, content, confidence, evidence_strength, evidence_ids,
              topic_labels, valid_at, invalid_at, invalid_reason, replaced_by, origin)
           VALUES (?, ?, ?, 0.95, ?, ?, ?, ?, NULL, NULL, NULL, 'stated')`,
        )
        .run(
          spaceId,
          target.slot,
          correction.newContent.trim(),
          strength,
          JSON.stringify(
            correction.evidence.map((e) => ({ type: e.type, id: e.id })),
          ),
          JSON.stringify(labels),
          now,
        );
      newEntryId = Number(info.lastInsertRowid);
    }

    // preference_override: constraint entries ONLY from explicit statement —
    // never inferred from the correction itself (T-U7).
    let constraintEntryId: number | null = null;
    if (correction.type === "preference_override" && correction.constraintContent) {
      constraintEntryId = writeExplicitConstraint(h, spaceId, correction, now);
    }

    sqlite
      .prepare(
        `UPDATE user_model
         SET invalid_at = ?, invalid_reason = ?, replaced_by = ?,
             review_flag = NULL, review_flagged_at = NULL
         WHERE id = ? AND invalid_at IS NULL`,
      )
      .run(now, invalidReason, newEntryId, target.id);
    // (W3 §6.4: the correction path clears the row's review flag — the user
    // has addressed the underlying issue. Clearing rides the invalidation
    // UPDATE above; the review_flag columns are migration-only, §8.6.)

    // W3 §8.6: bump once per stated row written in this transaction, same
    // transaction — the stated replacement insert, the explicit stated
    // constraint insert, and the target invalidation when the target is a
    // stated row.
    let statedRowsWritten = 0;
    if (newEntryId != null) statedRowsWritten++;
    if (constraintEntryId != null) statedRowsWritten++;
    if (target.origin === "stated") statedRowsWritten++;
    bumpStatedSetVersion(sqlite, spaceId, statedRowsWritten);

    auditLog(
      sqlite,
      spaceId,
      "correction_applied",
      `correction_applied entry_id=${target.id} type=${correction.type} new_id=${newEntryId ?? "null"}`,
      {
        entry_id: target.id,
        correction_type: correction.type,
        invalid_reason: invalidReason,
        new_entry_id: newEntryId,
        constraint_entry_id: constraintEntryId,
        slot: target.slot,
      },
      "ok",
    );

    return { status: "applied", entryId: target.id, newEntryId, constraintEntryId };
  })();
}

/**
 * Write a user-EXPLICITLY-stated constraint entry (0.95, origin 'stated').
 * Called only when the caller supplies constraintContent — never inferred
 * from a correction (T-U7).
 */
function writeExplicitConstraint(
  h: DbHandle,
  spaceId: string,
  correction: CorrectionInput,
  now: string,
): number {
  const content = correction.constraintContent!;
  const evidence = correction.constraintEvidence;
  if (!evidence || evidence.length === 0) {
    throw new ValidationError(
      "empty_evidence",
      "INV-EV-1: an explicit constraint requires evidence",
      { field: "constraintEvidence" },
    );
  }
  const { labels } = mapTopics(content);
  validateOneProposition(content, "constraint");
  checkFirstOrderOnly(content);
  validateEvidenceRefs(h, spaceId, evidence);
  const info = h.sqlite
    .prepare(
      `INSERT INTO user_model
         (space_id, slot, content, confidence, evidence_strength, evidence_ids,
          topic_labels, valid_at, invalid_at, invalid_reason, replaced_by, origin)
       VALUES (?, 'constraint', ?, 0.95, ?, ?, ?, ?, NULL, NULL, NULL, 'stated')`,
    )
    .run(
      spaceId,
      content.trim(),
      evidenceStrengthFromMeta(evidence, "stated", now),
      JSON.stringify(evidence.map((e) => ({ type: e.type, id: e.id }))),
      JSON.stringify(labels),
      now,
    );
  return Number(info.lastInsertRowid);
}

/* ------------------------------------------------------------------ */
/* knowledgeCheck — §6 (judgment only; INV-KC-1)                        */
/* ------------------------------------------------------------------ */

export interface KnowledgeCheckCandidate {
  content: string;
  /** Known slot of the candidate; unknown = check belief+knowledge. */
  slot?: Slot;
  /**
   * Respectful disagreement is not blocked: when the bot's disagreement is
   * the point (user asked for a correction, factual correction with cited
   * evidence, explicit "I see it differently"), suppress paths are bypassed.
   */
  intentionalCorrection?: boolean;
  /** Proactive = fail-closed; conversational = fail-open (§6.3). */
  path?: "proactive" | "conversational";
}

export type KnowledgeCheckVerdict =
  | "ok"
  | "contradicts_belief"
  | "already_known"
  | "uncertain"
  | "check_failed";

export type SuggestedAction =
  | "proceed"
  | "rephrase_as_question"
  | "suppress"
  | "flag_for_review"
  | "defer";

/** LLM judgment input for one ambiguous (candidate, entry) pair. */
export interface LlmJudgeInput {
  candidate: string;
  entry: { id: number; slot: Slot; content: string; confidence: number };
}

export type LlmJudgment =
  | "contradiction"
  | "compatible"
  | "restatement"
  | "uncertain"
  | "transition";

/**
 * Injectable LLM judge (bounded: ≤5 calls per check). Only consulted for
 * pairs that survive the deterministic rules without a verdict (§6.2
 * Stage 2 step 3). Deterministic rules must never need the LLM.
 */
export type LlmJudge = (input: LlmJudgeInput) => Promise<LlmJudgment>;

export interface KnowledgeCheckOpts {
  timeoutMs?: number;
  maxLlmCalls?: number;
  llmJudge?: LlmJudge;
  /**
   * Test hook (T-K18b): snapshot user_model before/after and assert
   * byte-identical. Default false (the function performs zero writes by
   * construction — no INSERT/UPDATE/DELETE against user_model exists in
   * this code path, INV-KC-1).
   */
  assertReadOnly?: boolean;
}

export interface KnowledgeCheckResult {
  verdict: KnowledgeCheckVerdict;
  /** Specific rows that fired, with evidence + evidence_status. */
  conflictingEntries: UserModelEntry[];
  suggestedAction: SuggestedAction;
  latencyMs: number;
  llmCallsUsed: number;
  /** True when topic mapping failed and recall was widened (§6.2). */
  recall_uncertain: boolean;
}

const KC_TOTAL_BUDGET_MS = 15_000;
const KC_MAX_LLM_CALLS = 5;
const KC_CANDIDATE_CAP = 25;

class CheckBudgetExceeded extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckBudgetExceeded";
  }
}

/** Byte-identical snapshot of user_model for INV-KC-1 test assertions. */
function snapshotUserModel(sqlite: RawDb, spaceId: string): string {
  const rows = sqlite
    .prepare(
      `SELECT id, space_id, slot, content, confidence, evidence_strength,
              evidence_ids, topic_labels, valid_at, invalid_at,
              invalid_reason, replaced_by, origin, created_at
       FROM user_model WHERE space_id = ? ORDER BY id`,
    )
    .all(spaceId);
  return JSON.stringify(rows);
}

/** Strip a "never / do not / don't" prohibition prefix from a constraint. */
function constraintProposition(content: string): string {
  return content
    .trim()
    .replace(/^(never|do not|don't|no|stop)\s+/i, "")
    .replace(/^suggest(ing)?\s+/i, "")
    .trim();
}

/**
 * Deterministic constraint-violation check: does the candidate propose what
 * the constraint prohibits? The constraint's stripped proposition must be
 * substantially contained in the candidate (T-K4, T-K20).
 */
function violatesConstraint(candidate: string, constraintContent: string): boolean {
  const proposition = constraintProposition(constraintContent);
  if (!proposition) return false;
  const sim = tokenJaccard(candidate, proposition);
  const candLower = ` ${candidate.toLowerCase()} `;
  const propLower = proposition.toLowerCase();
  return sim >= 0.5 || (propLower.length > 12 && candLower.includes(` ${propLower} `));
}

/**
 * knowledgeCheck() — §6 full contract.
 *
 * INV-KC-1: this is a JUDGMENT operation. It takes only read operations on
 * user_model: SELECTs and in-memory analysis. It never inserts, invalidates,
 * or changes confidence. A state change the judgment recommends must be
 * effected through an explicitly authorized write path (recordStated(),
 * correctUserModel(), updateUserModel()).
 *
 * Stage 1 — recall-oriented candidate generation (no similarity threshold):
 *   1. mapTopics(candidate) (+ topic_uncertain flag)
 *   2. constraints pulled in a SEPARATE, UNCAPPED query (B8 Rev 4)
 *   3. belief/knowledge rows matching topic overlap / state-change verbs /
 *      negation patterns; uncertain recall widens to slot-wide
 *   4. cap 25 non-constraint candidates, confidence desc
 * Stage 2 — deterministic rules first, LLM only for ambiguity (≤5 calls).
 */
export async function knowledgeCheck(
  h: DbHandle,
  spaceId: string,
  candidate: KnowledgeCheckCandidate,
  opts: KnowledgeCheckOpts = {},
): Promise<KnowledgeCheckResult> {
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? KC_TOTAL_BUDGET_MS;
  const maxLlmCalls = opts.maxLlmCalls ?? KC_MAX_LLM_CALLS;
  const path = candidate.path ?? "proactive";
  let llmCallsUsed = 0;

  const before = opts.assertReadOnly
    ? snapshotUserModel(h.sqlite, spaceId)
    : null;

  const fail = (
    reason: string,
  ): KnowledgeCheckResult => {
    // §6.3: proactive fails closed (defer), conversational fails open.
    const latencyMs = Date.now() - started;
    auditLog(
      h.sqlite,
      spaceId,
      "knowledge_check",
      `knowledge_check verdict=check_failed path=${path} reason=${reason}`,
      { path, reason, llm_calls: llmCallsUsed },
      "check_failed",
    );
    if (opts.assertReadOnly) assertReadOnlyUnchanged(h, spaceId, before);
    return path === "proactive"
      ? {
          verdict: "check_failed",
          conflictingEntries: [],
          suggestedAction: "defer",
          latencyMs,
          llmCallsUsed,
          recall_uncertain: false,
        }
      : {
          verdict: "ok",
          conflictingEntries: [],
          suggestedAction: "proceed",
          latencyMs,
          llmCallsUsed,
          recall_uncertain: false,
        };
  };

  const finish = (r: Omit<KnowledgeCheckResult, "latencyMs" | "llmCallsUsed">): KnowledgeCheckResult => {
    const latencyMs = Date.now() - started;
    auditLog(
      h.sqlite,
      spaceId,
      "knowledge_check",
      `knowledge_check verdict=${r.verdict} path=${path} candidates=${r.conflictingEntries.length}`,
      {
        path,
        verdict: r.verdict,
        suggested_action: r.suggestedAction,
        conflicting_ids: r.conflictingEntries.map((e) => e.id),
        recall_uncertain: r.recall_uncertain,
        llm_calls: llmCallsUsed,
      },
      r.verdict,
    );
    if (opts.assertReadOnly) assertReadOnlyUnchanged(h, spaceId, before);
    return { ...r, latencyMs, llmCallsUsed };
  };

  try {
    // ---- Stage 1: candidate generation ----
    const { labels: candLabels, topic_uncertain } = mapTopics(candidate.content);
    const recall_uncertain = topic_uncertain;

    // Constraints first, separate query, NO cap (B8 Rev 4 — safety-critical).
    const constraintRows = h.sqlite
      .prepare(
        `SELECT * FROM user_model
         WHERE space_id = ? AND slot = 'constraint' AND ${CURRENT_FILTER}
         ORDER BY confidence DESC`,
      )
      .all(spaceId) as UserModelRow[];

    // Non-constraint pool: current belief/knowledge entries.
    const pool = h.sqlite
      .prepare(
        `SELECT * FROM user_model
         WHERE space_id = ? AND slot IN ('belief','knowledge') AND ${CURRENT_FILTER}`,
      )
      .all(spaceId) as UserModelRow[];

    let filtered: UserModelRow[];
    if (topic_uncertain) {
      // Widen, never narrow: all current entries from the candidate's slot
      // (or all slots when the slot is unknown), capped at 25 by confidence.
      // §6.2: the verdict 'ok' is never returned on this widened set.
      const widePool = (
        candidate.slot
          ? (h.sqlite
              .prepare(
                `SELECT * FROM user_model WHERE space_id = ? AND slot = ? AND ${CURRENT_FILTER}`,
              )
              .all(spaceId, candidate.slot) as UserModelRow[])
          : (h.sqlite
              .prepare(
                `SELECT * FROM user_model WHERE space_id = ? AND ${CURRENT_FILTER}`,
              )
              .all(spaceId) as UserModelRow[])
      ).filter((r) => r.slot !== "constraint"); // constraints already pulled
      filtered = widePool;
    } else {
      filtered = pool.filter((row) => {
        const rowLabels = new Set(parseJsonArray<string>(row.topic_labels, []));
        // Shared topic label generates a candidate (B3 Rev 4: candidate-only —
        // contradiction requires entity identity + incompatible states).
        // State-change / negation verbs do not widen beyond topic overlap
        // (T-K15: "quit smoking" must not pull employment entries).
        return candLabels.some((l) => rowLabels.has(l));
      });
    }
    filtered.sort((a, b) => b.confidence - a.confidence);
    const capped = filtered.slice(0, KC_CANDIDATE_CAP);

    // ---- Stage 2: deterministic rules first ----
    const checkBudget = () => {
      if (Date.now() - started > timeoutMs) {
        throw new CheckBudgetExceeded(`check budget ${timeoutMs}ms exceeded`);
      }
    };

    const contradictions: UserModelRow[] = [];
    const restatements: UserModelRow[] = [];
    const ambiguous: UserModelRow[] = [];

    // Constraint violations (deterministic, always evaluated — T-K20).
    for (const row of constraintRows) {
      if (violatesConstraint(candidate.content, row.content)) {
        contradictions.push(row);
      }
    }

    for (const row of capped) {
      checkBudget();
      const rule = detectContradiction(candidate.content, {
        content: row.content,
        slot: row.slot as Slot,
      });
      if (rule === "genuine_negation" || rule === "explicit_transition") {
        contradictions.push(row);
        continue;
      }
      if (rule === "succession") continue; // not a contradiction (T-K8)
      // already_known: restatement of a knowledge/belief entry.
      if (tokenJaccard(candidate.content, row.content) >= 0.65) {
        restatements.push(row);
        continue;
      }
      // Survived deterministic rules without a verdict → ambiguous.
      ambiguous.push(row);
    }

    // ---- Stage 2 step 3: LLM judgment only for ambiguity (≤5 calls) ----
    const judge = opts.llmJudge;
    for (const row of ambiguous) {
      if (llmCallsUsed >= maxLlmCalls) break;
      checkBudget();
      if (!judge) break; // no judge → pairs stay ambiguous
      llmCallsUsed++;
      let judgment: LlmJudgment;
      try {
        judgment = await judge({
          candidate: candidate.content,
          entry: {
            id: row.id,
            slot: row.slot as Slot,
            content: row.content,
            confidence: row.confidence,
          },
        });
      } catch {
        throw new CheckBudgetExceeded("LLM judge failed");
      }
      checkBudget();
      if (judgment === "contradiction") contradictions.push(row);
      else if (judgment === "restatement") restatements.push(row);
      // 'compatible', 'transition', 'uncertain' → no contradiction recorded
    }

    // ---- Verdict aggregation ----
    const toEntry = (r: UserModelRow) => rowToEntry(h, spaceId, r);
    const intentional = candidate.intentionalCorrection === true;

    if (contradictions.length > 0) {
      const maxConf = Math.max(...contradictions.map((r) => r.confidence));
      const entries = contradictions.map(toEntry);
      if (intentional) {
        return finish({
          verdict: "contradicts_belief",
          conflictingEntries: entries,
          suggestedAction: "proceed",
          recall_uncertain,
        });
      }
      return finish({
        verdict: "contradicts_belief",
        conflictingEntries: entries,
        suggestedAction: maxConf >= 0.7 ? "suppress" : "rephrase_as_question",
        recall_uncertain,
      });
    }

    if (restatements.length > 0) {
      const entries = restatements.map(toEntry);
      if (intentional) {
        return finish({
          verdict: "already_known",
          conflictingEntries: entries,
          suggestedAction: "proceed",
          recall_uncertain,
        });
      }
      return finish({
        verdict: "already_known",
        conflictingEntries: entries,
        suggestedAction: "suppress",
        recall_uncertain,
      });
    }

    // §6.2: the verdict 'ok' is NEVER returned on a narrowed candidate set
    // when recall is uncertain — worst case is uncertain → flag_for_review.
    if (recall_uncertain) {
      return finish({
        verdict: "uncertain",
        conflictingEntries: [],
        suggestedAction: "flag_for_review",
        recall_uncertain,
      });
    }

    if (ambiguous.length > 0 && !judge) {
      // Pairs survived deterministic rules and no LLM was available to
      // resolve them: genuinely ambiguous, not safe to call 'ok'.
      // DESIGN-GAP: with a judge available these would be adjudicated; without
      // one the conservative verdict is uncertain, since a contradiction may
      // hide behind phrasing the deterministic rules cannot see.
      return finish({
        verdict: "uncertain",
        conflictingEntries: [],
        suggestedAction: "flag_for_review",
        recall_uncertain,
      });
    }

    return finish({
      verdict: "ok",
      conflictingEntries: [],
      suggestedAction: "proceed",
      recall_uncertain,
    });
  } catch (err) {
    if (err instanceof CheckBudgetExceeded) {
      return fail("budget_exceeded");
    }
    return fail(err instanceof Error ? err.message : "unknown_error");
  }
}

/** INV-KC-1 test assertion: user_model must be byte-identical. */
function assertReadOnlyUnchanged(
  h: DbHandle,
  spaceId: string,
  before: string | null,
): void {
  if (before == null) return;
  const after = snapshotUserModel(h.sqlite, spaceId);
  if (before !== after) {
    throw new Error(
      "INV-KC-1 VIOLATION: knowledgeCheck() mutated user_model",
    );
  }
}

/* ------------------------------------------------------------------ */
/* composeUserModelBlock — §7.2                                        */
/* ------------------------------------------------------------------ */

const SLOT_LINE_LABEL: Record<Slot, string> = {
  belief: "Believes",
  desire: "Wants",
  intention: "Intends",
  emotion_state: "Feels",
  knowledge: "Knows",
  constraint: "Constraints",
};

const BLOCK_TOKEN_CAP = 400;
const CHARS_PER_TOKEN = 4;

function entryRecencyFactor(validAt: string, nowMs: number): number {
  const ms = Date.parse(validAt);
  if (Number.isNaN(ms)) return 0.5;
  const days = Math.max(0, (nowMs - ms) / 86_400_000);
  return Math.pow(0.5, days / 30);
}

function formatBlockDate(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : iso;
}

/**
 * Compose the agent-loop prompt block (§7.2). Read-only.
 *
 * - Only entries with confidence ≥ 0.40.
 * - Each line cites origin; emotion lines are always dated.
 * - Cap ~400 tokens, top by confidence × recency.
 * - The header says "what I believe about you" — never "what is true".
 */
export function composeUserModelBlock(
  h: DbHandle,
  spaceId: string,
): string {
  const entries = getUserModel(h, spaceId).filter((e) => e.confidence >= 0.4);
  const nowMs = Date.now();
  const ranked = entries
    .map((e) => ({
      e,
      rank: e.confidence * entryRecencyFactor(e.validAt, nowMs),
    }))
    .sort((a, b) => b.rank - a.rank);

  const slotOrder: Slot[] = [
    "belief",
    "desire",
    "intention",
    "knowledge",
    "constraint",
    "emotion_state",
  ];
  const bySlot = new Map<Slot, string[]>();
  for (const s of slotOrder) bySlot.set(s, []);

  let usedTokens = 0;
  const header =
    "## What I believe about you (confidence = how sure I am you hold this view)";
  usedTokens += Math.ceil(header.length / CHARS_PER_TOKEN);

  for (const { e } of ranked) {
    let line: string;
    if (e.slot === "emotion_state") {
      // Emotion lines are always dated — emotions are weather, not traits.
      line = `${e.content} (${formatBlockDate(e.validAt)})`;
    } else {
      line = `${e.content} (${e.confidence.toFixed(2)}, ${e.origin})`;
    }
    const lineTokens = Math.ceil(line.length / CHARS_PER_TOKEN) + 2;
    if (usedTokens + lineTokens > BLOCK_TOKEN_CAP) continue;
    usedTokens += lineTokens;
    bySlot.get(e.slot)!.push(line);
  }

  const out: string[] = [header];
  for (const slot of slotOrder) {
    const lines = bySlot.get(slot)!;
    if (lines.length === 0) continue;
    const label =
      slot === "emotion_state" ? "Current state" : SLOT_LINE_LABEL[slot];
    if (slot === "emotion_state") {
      out.push(`${label}: ${lines.join("; ")}`);
    } else if (lines.length === 1) {
      out.push(`${label}: ${lines[0]}`);
    } else {
      out.push(`${label}:`);
      for (const l of lines) out.push(`- ${l}`);
    }
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ */
/* Sweeps                                                             */
/* ------------------------------------------------------------------ */

/**
 * Cleanup hygiene for emotion_state (W3 schedules). Correctness lives in the
 * read filter (CURRENT_FILTER) — this only reclaims rows. Sets invalid_at /
 * invalid_reason='expired'; replaced_by stays NULL (nothing replaces an
 * expired emotion). W3 §6.3: stated rows are exempt from expiry — they are
 * flagged for review ('stale_emotion') instead of invalidated.
 *
 * W3 Milestone 2 (Phase F): every write goes through the guarded boundary
 * (InvalidateEntry for non-stated expiry, SetReviewFlag for stated rows) —
 * no direct user_model SQL remains in this function. The function is async
 * because the boundary is async (its insert path may await an LLM judge);
 * there are no production callers yet (the W3 scheduler is Milestone 3),
 * only tests. Eligibility is re-verified inside the boundary's transaction
 * against each row's CURRENT state, so a correction that lands first wins.
 */
export async function sweepStaleEmotions(
  h: DbHandle,
  spaceId: string,
): Promise<{ expiredCount: number; flaggedStatedCount: number }> {
  const sqlite = h.sqlite;
  const ctx: ConsolidationRunContext = { spaceId };
  const candidates = sqlite
    .prepare(
      `SELECT id, origin FROM user_model
       WHERE space_id = ?
         AND slot = 'emotion_state'
         AND invalid_at IS NULL
         AND datetime(valid_at) <= datetime('now', '-7 days')`,
    )
    .all(spaceId) as { id: number; origin: string }[];
  let expiredCount = 0;
  let flaggedStatedCount = 0;
  for (const row of candidates) {
    if (row.origin === "stated") {
      const res = await applyConsolidationMutation(sqlite, ctx, {
        kind: "SetReviewFlag",
        entryId: row.id,
        flag: "stale_emotion",
      });
      if (res.status === "applied") flaggedStatedCount++;
    } else {
      const res = await applyConsolidationMutation(sqlite, ctx, {
        kind: "InvalidateEntry",
        entryId: row.id,
        reason: "expired",
      });
      if (res.status === "applied") expiredCount++;
    }
  }
  if (expiredCount > 0) {
    auditLog(
      sqlite,
      spaceId,
      "emotions_swept",
      `emotions_swept count=${expiredCount}`,
      { count: expiredCount },
      "ok",
    );
  }
  if (flaggedStatedCount > 0) {
    auditLog(
      sqlite,
      spaceId,
      "stale_emotions_flagged",
      `stale_emotions_flagged count=${flaggedStatedCount}`,
      { count: flaggedStatedCount },
      "ok",
    );
  }
  return { expiredCount, flaggedStatedCount };
}

/**
 * §3.8 withdrawn-evidence handling, per the W3 §6.3 sweep matrix. For
 * current inferred/consolidated entries whose evidence is ENTIRELY
 * withdrawn: auto-invalidate (invalid_at = now,
 * invalid_reason='evidence_withdrawn') — they have no standing without
 * their evidence. Stated entries are only flagged (returned, not
 * invalidated). PARTIAL withdrawal on a non-stated entry withdraws the
 * dead episode evidence through the boundary, which recomputes
 * evidence_strength over the survivors (new in W3 — W2 ignored partial
 * withdrawal); partial withdrawal on a stated entry does nothing (§6.3).
 *
 * DESIGN-GAP: §3.8 describes this as "auto-invalidated" in the read-time
 * annotation context, but executing writes inside getUserModel() would make
 * knowledgeCheck()'s read path mutate user_model and break INV-KC-1's
 * byte-identical guarantee. The invalidation therefore lives in this explicit
 * maintenance function (W3-scheduled), never on the read path.
 *
 * W3 Milestone 2 (Phase F): every write goes through the guarded boundary —
 * no direct user_model SQL remains in this function — and each row's
 * eligibility is re-derived from a FRESH read + annotation at mutation
 * time (and re-verified inside the boundary's own transaction), so a user
 * correction that lands first is seen and respected (§6.3, T-C52). Async
 * because the boundary is async; no production callers exist yet.
 */
export async function sweepWithdrawnEvidence(
  h: DbHandle,
  spaceId: string,
): Promise<{ invalidatedIds: number[]; flaggedStatedIds: number[] }> {
  const sqlite = h.sqlite;
  const ctx: ConsolidationRunContext = { spaceId };
  const candidateIds = sqlite
    .prepare(
      `SELECT id FROM user_model
       WHERE space_id = ? AND invalid_at IS NULL
         AND origin IN ('inferred', 'consolidated', 'stated')`,
    )
    .all(spaceId) as { id: number }[];
  const invalidatedIds: number[] = [];
  const flaggedStatedIds: number[] = [];

  for (const { id } of candidateIds) {
    const row = sqlite
      .prepare(`SELECT * FROM user_model WHERE id = ?`)
      .get(id) as UserModelRow | undefined;
    if (!row || row.invalid_at !== null) continue;
    const refs = parseJsonArray<EvidenceRef>(row.evidence_ids, []);
    if (refs.length === 0) continue;
    const annotated = annotateEvidence(h, spaceId, refs);
    const withdrawn = annotated.filter((a) => a.status === "withdrawn");
    if (withdrawn.length === 0) continue;

    if (row.origin === "stated") {
      // Stated rows: flag only, and only when ALL evidence is withdrawn
      // (§6.3). The flag write itself goes through the boundary — the
      // one stated-row operation it permits — and is set-once there.
      if (withdrawn.length === refs.length) {
        const res = await applyConsolidationMutation(sqlite, ctx, {
          kind: "SetReviewFlag",
          entryId: row.id,
          flag: "evidence_withdrawn",
        });
        if (res.status === "applied") flaggedStatedIds.push(row.id);
      }
      continue;
    }
    if (withdrawn.length === refs.length) {
      const res = await applyConsolidationMutation(sqlite, ctx, {
        kind: "InvalidateEntry",
        entryId: row.id,
        reason: "evidence_withdrawn",
      });
      if (res.status === "applied") invalidatedIds.push(row.id);
    } else {
      // §6.3 partial-withdrawal cell: withdraw the dead EPISODE evidence;
      // the boundary recomputes strength over the survivors atomically.
      // Withdrawn non-episode refs (missing nodes/enrichments) cannot be
      // named in a WithdrawEvidence payload (§6.1 step 4 is episode-
      // keyed) and remain in the evidence set.
      const episodeIds = withdrawn
        .filter((a) => a.type === "episode")
        .map((a) => a.id);
      if (episodeIds.length > 0) {
        await applyConsolidationMutation(sqlite, ctx, {
          kind: "WithdrawEvidence",
          entryId: row.id,
          episodeIds,
        });
      }
    }
  }
  if (invalidatedIds.length > 0 || flaggedStatedIds.length > 0) {
    auditLog(
      sqlite,
      spaceId,
      "withdrawn_evidence_sweep",
      `withdrawn_evidence_sweep invalidated=${invalidatedIds.length} flagged_stated=${flaggedStatedIds.length}`,
      {
        invalidated_ids: invalidatedIds,
        flagged_stated_ids: flaggedStatedIds,
      },
      "ok",
    );
  }

  return { invalidatedIds, flaggedStatedIds };
}

/* ------------------------------------------------------------------ */
/* maybeRecordStated — W2 §4.8 stated-write trigger (integration)      */
/* ------------------------------------------------------------------ */

/**
 * W2 §4.8: the stated-write trigger. Called by the agent loop on the user's
 * raw message at turn start. Conservative by design: false negatives (missed
 * statement, catchable by W3 consolidation) beat false positives (laundering
 * a non-statement into 0.95-confidence authority).
 *
 * Fires ONLY on clear first-person assertions about his own mental state or
 * life. Does NOT fire on: questions, hypotheticals ("what if"), quotations
 * of others, jokes/sarcasm, third-person statements, higher-order ToM.
 *
 * When it fires, it captures an episode synchronously (for INV-EV-1 evidence)
 * and calls recordStated(). Returns the episode ID so the caller can avoid
 * double-capture, or null when it abstains.
 *
 * Never throws — all failures are swallowed (the loop must never break).
 */
export function maybeRecordStated(
  h: DbHandle,
  spaceId: string,
  userMessage: string,
): number | null {
  try {
    return maybeRecordStatedInner(h, spaceId, userMessage);
  } catch {
    return null;
  }
}

interface StatedMatch {
  slot: Slot;
  content: string;
}

// Positive patterns: clear first-person assertions. Each maps to a slot.
// Ordered by specificity — first match wins.
const STATED_PATTERNS: { pattern: RegExp; slot: Slot }[] = [
  // Desires: "I want...", "I need...", "I wish..."
  { pattern: /\bi\s+(want|need|wish)\b/i, slot: "desire" },
  // Intentions: "I will...", "I'm going to...", "my plan is...", "I intend..."
  { pattern: /\bi\s+(will|intend)\b|\bi'm\s+going\s+to\b|\bmy\s+plan\s+is\b/i, slot: "intention" },
  // Beliefs: "I believe...", "I think (that)..."
  { pattern: /\bi\s+(believe|think)\s+(that\b)?/i, slot: "belief" },
  // Knowledge: "I know..."
  { pattern: /\bi\s+know\b/i, slot: "knowledge" },
  // Constraints: "don't ever...", "never..." (directed at the bot about preferences)
  { pattern: /\bdon't\s+ever\b|\bnever\s+(mention|bring\s+up|talk\s+about)\b/i, slot: "constraint" },
  // Factual life claims: "I started...", "I work at...", "I live..."
  { pattern: /\bi\s+(started|work\s+at|live\s+in|live\s+at)\b/i, slot: "belief" },
  // Emotion states: "I'm feeling...", "I feel...", "I'm [emotion]"
  { pattern: /\bi('m|\s+am)\s+feeling\b|\bi\s+feel\b/i, slot: "emotion_state" },
];

// Rejection patterns: things that look like assertions but aren't.
const STATED_REJECTIONS: RegExp[] = [
  /\?$/, // questions
  /\bwhat\s+if\b/i, // hypotheticals
  /\bif\s+i\s+(were|was|quit|left)\b/i, // hypotheticals
  /\b(she|he|they)\s+said\b/i, // quotations of others
  /\bmy\s+(brother|sister|mom|dad|friend)\s+(thinks|believes|says)\b/i, // third-person
  /\b(jk|lol|lmao)\b/i, // jokes/sarcasm markers
];

function maybeRecordStatedInner(
  h: DbHandle,
  spaceId: string,
  userMessage: string,
): number | null {
  const text = userMessage.trim();
  if (text.length < 10 || text.length > 500) return null; // too short/long for a clean assertion

  // Rejections first: abstain on anything ambiguous.
  for (const pattern of STATED_REJECTIONS) {
    if (pattern.test(text)) return null;
  }

  // Higher-order ToM check (INV-TOM-1).
  try {
    checkFirstOrderOnly(text);
  } catch {
    return null;
  }

  // Trigger boundary check (hypotheticals, quotes, etc.).
  try {
    checkStatedTrigger(text);
  } catch {
    return null;
  }

  // Positive match: must be a clear first-person assertion.
  let matchedSlot: Slot | null = null;
  for (const { pattern, slot } of STATED_PATTERNS) {
    if (pattern.test(text)) {
      matchedSlot = slot;
      break;
    }
  }
  if (!matchedSlot) return null;

  // One-proposition rule: reject multi-claim content.
  try {
    validateOneProposition(text, matchedSlot);
  } catch {
    return null;
  }

  // Capture an episode synchronously for INV-EV-1 evidence.
  let episodeId: number | null = null;
  try {
    const captured = captureEpisode(h, spaceId, {
      kind: "conversation",
      userExcerpt: text.slice(0, 200),
      outcome: "stated_trigger",
    });
    episodeId = captured?.episodeId ?? null;
  } catch {
    return null; // No episode = no evidence = abstain (INV-EV-1).
  }
  if (!episodeId) return null;

  // Write the stated entry.
  try {
    recordStated(h, spaceId, matchedSlot, text, [
      { type: "episode", id: episodeId, isUserStatement: true },
    ]);
  } catch {
    return null; // recordStated re-validates; any rejection = abstain.
  }

  return episodeId;
}
