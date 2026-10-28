import type { GraphNode, LifeArea, LifeAreaCount } from "@brain/shared";
import { LIFE_AREAS } from "@brain/shared";
import type { DbHandle } from "../db/client.js";
import { DEFAULT_SPACE } from "../db/schema.js";
import { NodesRepo } from "../repositories/nodes.repo.js";

/**
 * Life-area lens (research-agent add-on #6) — adopted as an OPTIONAL OVERLAY, not a
 * storage model. The galaxy still clusters by association (emergent constellations);
 * this just classifies each memory into a broad area of life so you can see roughly
 * which themes your memories fall into. Heuristic over tags + type + language; fully
 * offline. It measures keyword-sorted memory counts, NOT attention — the system has
 * no attention/engagement signal in this builder (REG-155 / INS-08).
 */

const RULES: { area: LifeArea; tags: string[]; types: string[]; re: RegExp }[] = [
  {
    area: "Health",
    tags: ["health"],
    types: [],
    re: /\b(health|sleep|exercise|gym|workout|body|sick|illness|doctor|therapy|anxiety|stress|burnout|mental|diet|nutrition|weight)\b/i,
  },
  {
    area: "Money",
    tags: ["money"],
    types: [],
    re: /\b(money|finance|financial|budget|debt|loan|salary|income|invest|savings|rent|mortgage|pay|cost|price|expense|bill)\b/i,
  },
  {
    area: "Relationships",
    tags: ["people"],
    types: ["person"],
    re: /\b(friend|family|partner|wife|husband|girlfriend|boyfriend|relationship|mother|father|sister|brother|colleague|date|love)\b/i,
  },
  {
    area: "Work & Projects",
    tags: ["work"],
    types: ["project", "company", "meeting", "decision"],
    re: /\b(work|job|career|project|business|startup|client|deadline|launch|product|company|team|meeting|promotion|interview)\b/i,
  },
  {
    area: "Identity & Growth",
    tags: ["learning", "ideas"],
    types: ["concept"],
    re: /\b(learn|learning|study|skill|grow(th)?|goal|dream|future|identity|who i am|values?|belief|purpose|meaning|habit|aspire)\b/i,
  },
];

/** Classify a single memory into a life-area (first matching rule wins; else "Other"). */
export function lifeAreaOf(n: GraphNode): LifeArea {
  const tags = (n.tags ?? []).map((t) => t.toLowerCase());
  const text = `${n.label} ${n.content}`;
  for (const rule of RULES) {
    if (rule.types.includes(n.type)) return rule.area;
    if (tags.some((t) => rule.tags.includes(t))) return rule.area;
    if (rule.re.test(text)) return rule.area;
  }
  return "Other";
}

/** Distribution of memories across life-areas (ordered by the canonical area list). */
export function buildLifeAreaCounts(h: DbHandle, spaceId: string = DEFAULT_SPACE): LifeAreaCount[] {
  const counts = new Map<LifeArea, number>(LIFE_AREAS.map((a) => [a, 0]));
  for (const n of new NodesRepo(h, spaceId).all()) {
    if (n.kind === "action" || n.kind === "moc") continue;
    // REG-155 / INS-08: machine-authored belief nodes are her distillations,
    // not the user's memories — counting them would let her own summaries
    // inflate the areas their wording happens to match.
    if (n.kind === "belief") continue;
    const area = lifeAreaOf(n);
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return LIFE_AREAS.map((area) => ({ area, count: counts.get(area) ?? 0 })).filter((c) => c.count > 0);
}
