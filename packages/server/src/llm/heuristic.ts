import { type ExtractionResult, type NodeType, type RelationshipType, type ClarificationInterpretation, analyzeSentiment } from "@brain/shared";
import type { AnswerOptions, AnswerResult, ContextNode, ContradictionResult, LinkCandidate, LinkValidation, LlmProvider } from "./adapter.js";

/** Lexical reversal/negation cues used by the offline contradiction heuristic. */
const NEGATIONS = ["not", "never", "no longer", "don't", "won't", "can't", "stopped", "quit", "gave up", "used to", "anymore"];
const OPPOSED_PAIRS: [string, string][] = [
  ["love", "hate"], ["want", "avoid"], ["always", "never"], ["start", "stop"],
  ["will", "won't"], ["should", "shouldn't"], ["can", "can't"], ["happy", "miserable"],
  ["confident", "afraid"], ["commit", "quit"], ["stay", "leave"], ["yes", "no"],
];

/** True when one memory carries an explicit reversal/opposition against the other.
 *  Deliberately conservative — same-topic pre-filtering is the caller's job. */
function hasReversalSignal(aRaw: string, bRaw: string): boolean {
  const a = ` ${aRaw.toLowerCase()} `;
  const b = ` ${bRaw.toLowerCase()} `;
  // A negation present in exactly one of the two same-topic memories.
  for (const n of NEGATIONS) {
    const inA = a.includes(` ${n} `) || a.includes(n);
    const inB = b.includes(` ${n} `) || b.includes(n);
    if (inA !== inB) return true;
  }
  // An opposed term appears on each side (one says X, the other its antonym).
  for (const [x, y] of OPPOSED_PAIRS) {
    if ((a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x))) return true;
  }
  return false;
}

/** Common words that carry no topical signal, so we don't "link" on them. */
const STOPWORDS = new Set(
  "the a an and or but if then so of to in on at for with from by about as is are was were be been being i me my we our you your he she it they them this that these those have has had do does did will would can could should not no yes just like about into over under again more most some any all".split(
    " ",
  ),
);

/** Meaningful lowercased word stems (len>=4, non-stopword) for overlap checks. */
function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue;
    out.add(raw.length > 6 ? raw.slice(0, 6) : raw); // crude stem so plurals/tenses match
  }
  return out;
}

/** Choose a relationship that fits the offline signal (default: relates_to). */
function pickRelationship(source: LinkCandidate, target: LinkCandidate): RelationshipType {
  const blob = `${source.label} ${source.content} ${target.label} ${target.content}`.toLowerCase();
  if (/\b(but|however|instead|versus|vs|contradic|conflict|opposite)\b/.test(blob)) return "contradicts";
  if (/\b(because|caused|due to|reason|led to|result)\b/.test(blob)) return "caused_by";
  if (/\b(like|similar|analog|reminds|same as)\b/.test(blob)) return "is_analogous_to";
  if (/\b(build|extend|continue|next step|expand|develop)\b/.test(blob)) return "builds_on";
  return "relates_to";
}

/**
 * Heuristic gravitational mass without an LLM: weighty life/identity/emotional
 * vocabulary and longer, more deliberate entries score higher. 0..1. Exported so
 * it also powers "reset to auto" weighting offline (no API credit needed).
 */
export function heuristicImportance(text: string): number {
  const t = text.toLowerCase();
  const heavy =
    /(death|dying|\bdied\b|sick|illness|cancer|divorce|breakup|broke up|fired|laid off|lawsuit|debt|money|career|future|dream|goal|purpose|identity|meaning|fear|afraid|anxiety|anxious|depress|marriage|married|wedding|baby|child|kids|god|faith|forever|always|never|life|health)/g;
  const emphasis = /(important|serious|crucial|critical|urgent|matters|real)/g;
  const heavyHits = (t.match(heavy) ?? []).length;
  const emphasisHits = (t.match(emphasis) ?? []).length;
  const lengthBoost = Math.min(0.2, text.trim().length / 1000); // deliberation
  const score = 0.35 + heavyHits * 0.11 + emphasisHits * 0.08 + lengthBoost;
  return Math.max(0, Math.min(1, score));
}

/**
 * No-key fallback. Keeps the brain fully functional without an LLM:
 * - extract(): treats the whole input as a single node, guessing the type from
 *   keywords. (No LLM-typed edges; associative similarity linking still runs.)
 * - validateLink(): approves links purely on cosine similarity.
 */
export class HeuristicProvider implements LlmProvider {
  readonly available = false;
  readonly model = "heuristic";

  private guessType(text: string): Exclude<NodeType, "moc"> {
    const t = text.toLowerCase();
    // Ordered substring rules (no word boundaries) so "arguing", "meeting",
    // "deciding" etc. are caught. First match wins; falls through to "daily".
    if (/(met with|meeting|call with|spoke with|spoke to|sync|stand-?up|1:1|interview|zoom call|caught up with|chatted with)/.test(t))
      return "meeting";
    if (/(decided|decision|going with|i'?ll go with|chose|choosing|opted|made up my mind|pros and cons|weigh(ing)? the options)/.test(t))
      return "decision";
    if (/(\binc\b|\bllc\b|\bcorp\b|\bltd\b|\bco\.\b|\bcompany\b|the firm|organization|organisation|\bemployer\b|\bvendor\b|\bclient\b)/.test(t))
      return "company";
    if (/(sister|brother|mother|father|\bmom\b|\bdad\b|wife|husband|girlfriend|boyfriend|relationship|friend|family|partner|colleague|co-?worker|\blove\b|argu|anxious|lonely)/.test(t))
      return "person";
    if (/(business|startup|idea|product|market|revenue|customer|saas|launch|venture|profit|project|build(ing)?|shipping|roadmap|milestone|initiative)/.test(t))
      return "project";
    if (/(definition|concept|means that|how to|learned|reference|principle|framework|theory|\bfact\b|note on)/.test(t))
      return "knowledge";
    return "daily";
  }

  private deriveLabel(text: string): string {
    const words = text.trim().split(/\s+/).slice(0, 6).join(" ");
    return words.length > 0 ? words : "Thought";
  }

  async extract(text: string, _context: ContextNode[]): Promise<ExtractionResult> {
    // Offline emotion: derive a -1..1 charge from the wording so the galaxy still
    // colours by feeling, harmonization works, visitors pick a variant, and the
    // chat voice has a tone — all without a cloud key (reuses the shared filter).
    const { valence } = analyzeSentiment(text);
    return {
      nodes: [
        {
          label: this.deriveLabel(text),
          type: this.guessType(text),
          content: text.trim(),
          importance: heuristicImportance(text),
          emotionalWeight: Math.round(valence * 100) / 100,
        },
      ],
      edges: [],
    };
  }

  async validateLink(
    source: LinkCandidate,
    target: LinkCandidate,
    similarity: number,
    // D4: accepted for interface conformance; ignored — the heuristic is pure
    // synchronous CPU work with no I/O to abort.
    _opts?: { signal?: AbortSignal },
  ): Promise<LinkValidation> {
    // Smarter offline linking: embeddings alone occasionally pull together
    // superficially-similar-but-unrelated thoughts. Without an LLM to reason
    // about it, we confirm with a cheap lexical signal — a very strong cosine
    // match links on its own, otherwise we require some shared meaningful
    // vocabulary. This cuts the "linked to things with no real relation" noise.
    const a = keywords(`${source.label} ${source.content}`);
    const b = keywords(`${target.label} ${target.content}`);
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    const overlap = shared / Math.max(1, Math.min(a.size, b.size)); // 0..1 Szymkiewicz–Simpson

    const strong = similarity >= 0.9; // semantics are unambiguous
    const confirmed = shared >= 1 && overlap >= 0.12; // topical common ground
    if (!strong && !confirmed) return { linked: false };

    // Blend cosine with lexical overlap so confidently-related pairs weigh more.
    const weight = Math.min(1, similarity * 0.7 + overlap * 0.3);
    const relationship = pickRelationship(source, target);
    return { linked: true, relationship, weight };
  }

  async synthesize(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<{ text: string; score: number }> {
    return {
      text: `"${a.label}" and "${b.label}" seem related (${Math.round(
        similarity * 100,
      )}% similar) but aren't connected yet — worth a closer look.`,
      score: similarity,
    };
  }

  async detectContradiction(
    a: LinkCandidate,
    b: LinkCandidate,
    similarity: number,
  ): Promise<ContradictionResult> {
    // The caller pre-filters to same-topic (high-similarity) pairs, so the offline
    // heuristic only needs to spot REVERSAL language: an explicit negation/opposition
    // signal in one memory against the other. Conservative on purpose — better to miss
    // a soft contradiction than to cry wolf. The cloud provider does the nuanced judging.
    const conflict = hasReversalSignal(a.content, b.content);
    return {
      conflict,
      text: conflict
        ? `"${a.label}" and "${b.label}" look like they pull in opposite directions — you may have changed your mind, or these are two sides of the same tension worth reconciling.`
        : "",
      // Same-topic + a reversal cue → a moderately sharp conflict.
      score: conflict ? Math.min(1, 0.5 + similarity * 0.4) : 0,
    };
  }

  async interpretClarificationAnswer(question: string, userMessage: string): Promise<ClarificationInterpretation> {
    const trimmed = userMessage.trim();
    if (!trimmed) return { answers: false, confirmedStatement: "", confidence: 0 };

    // Conservative offline signal: an explicit yes/no cue, OR real topical word-overlap
    // with the question (reusing the same `keywords()` helper the link/mass heuristics
    // already use) — a bare chitchat reply or an unrelated new topic never counts.
    const affirmative = /\b(yes|yeah|yep|yup|correct|that'?s right|exactly|confirmed|right)\b/i.test(trimmed);
    const negative = /\b(no|nope|not really|incorrect|wrong)\b/i.test(trimmed);
    const qWords = keywords(question);
    const mWords = keywords(trimmed);
    let overlap = 0;
    for (const w of mWords) if (qWords.has(w)) overlap++;

    // A message that is ITSELF a question is never a confirmed statement of fact — the same
    // "a trailing '?' means a question, not an answer" reasoning `chat/graphrag.ts`'s `justAsked`
    // already applies to Soumaya's own turns. Without this, a user proactively asking about the
    // very topic that just raised a clarification (topical word-overlap, no real answer given)
    // would otherwise be misread as confirming their own question's wording as fact.
    const isQuestion = trimmed.endsWith("?");
    const answers = !isQuestion && (affirmative || negative || overlap >= 1) && trimmed.length >= 4;
    if (!answers) return { answers: false, confirmedStatement: "", confidence: 0 };

    // Strip a leading "yes,"/"no," acknowledgement so the stored fact reads as a
    // statement, not a reply — never invent content beyond what the user actually said.
    const confirmedStatement = trimmed.replace(/^(yes|yeah|yep|yup|no|nope)[,.\s]*/i, "").trim() || trimmed;
    return { answers: true, confirmedStatement, confidence: affirmative || negative ? 0.7 : 0.45 };
  }

  async answer(question: string, context: ContextNode[], opts?: AnswerOptions): Promise<AnswerResult> {
    // In-character (Soumaya) even offline — never impersonate the user.
    const chitchat = /\b(how are you|how's it going|what'?s up|you doing|hi|hello|hey)\b/i.test(
      question,
    );
    // Read the emotional register from the question wording so even the offline
    // fallback doesn't answer heartbreak with a chipper bullet list.
    const heavy =
      /\b(sad|scared|afraid|fear|anxious|worried|grief|loss|lost|died|death|break ?up|heartbro|depress|cry|lonely|hurt|stress)\b/i.test(
        question,
      );
    const bright = /\b(happy|excited|proud|great news|amazing|celebrat|won|love(d)?)\b/i.test(question);
    const mood = heavy ? "concerned" : bright ? "warm" : chitchat ? "warm" : "thoughtful";
    // Offline, we can't truly reason over the persona/instructions, but we surface
    // any retrieved knowledge so doc-RAG is observably working without a key.
    const kb = opts?.knowledge ? `\n\nFrom your documents:\n${firstLines(opts.knowledge, 4)}` : "";
    if (context.length === 0) {
      const line = chitchat
        ? "Cruising the quiet outer reaches of your galaxy — calm out here, just starlight and a little drift. Ask me about a memory and I'll plot a course to it."
        : heavy
          ? "That sounds like it carries real weight, and I don't have memories charted on it yet — I don't want to guess at something that matters."
          : "I'm not picking up any memories on that heading yet. Log a few related thoughts and I'll chart the connections.";
      // Interview instinct (offline): only when weighty AND she hasn't just asked,
      // so the offline path can't interrogate in a loop either.
      const askBack =
        heavy && !opts?.justAsked
          ? "Tell me a little more — what's the part of this that sits heaviest right now?"
          : undefined;
      return { answer: line + kb, citations: [], mood, askBack };
    }
    const top = context.slice(0, 5);
    const preface = heavy
      ? "I hear the weight in that. Here's what your own galaxy holds on this heading:\n"
      : "From up here I can see a cluster on that heading:\n";
    // Honesty over silence: offline she can't reason over custom roles — say so
    // instead of letting the user think their Companion config is being ignored.
    const rolesNote = opts?.systemExtra?.includes("ACTIVE CUSTOM INSTRUCTIONS")
      ? " Your custom roles are set — they fully shape my voice once my deep mind is back online."
      : "";
    const answer =
      preface +
      top.map((c) => `• ${c.label}: ${c.content}`).join("\n") +
      kb +
      `\n\n— I'd plot a course between them. (Connect an OpenAI or Gemini key and I can tell you the fuller story.${rolesNote})`;
    // Thin coverage on a weighty topic → one genuine ask-back (never twice running).
    const askBack =
      heavy && context.length < 3 && !opts?.justAsked
        ? "What would help most here — talking it through, or charting the facts around it?"
        : undefined;
    return { answer, citations: top.map((c) => c.id), mood, askBack };
  }

  async research(
    node: LinkCandidate,
    userAnswers?: string,
  ): Promise<{ label: string; content: string; questions?: string[] }> {
    return {
      label: `Draft Research: ${node.label}`,
      content: `Preliminary observations on ${node.label}: ${node.content.slice(0, 100)}... (Research mode requires an active LLM key for full deep-dives.)${
        userAnswers ? `\n\nUser Answers: ${userAnswers}` : ""
      }`,
    };
  }

  async summarizeSector(nodes: LinkCandidate[]): Promise<string> {
    return `This sector contains ${nodes.length} closely related memories, humming with un-synthesized potential.`;
  }

  async generateDailyLog(newNodes: LinkCandidate[], actions: string[], _persona?: string, _soul?: string): Promise<string> {
    return `Stardate: ${new Date().toLocaleDateString()}. Added ${newNodes.length} new memories and performed ${actions.length} maintenance actions.`;
  }
}

/** First N non-empty lines of a block (for the offline knowledge excerpt). */
function firstLines(text: string, n: number): string {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, n)
    .join("\n");
}
