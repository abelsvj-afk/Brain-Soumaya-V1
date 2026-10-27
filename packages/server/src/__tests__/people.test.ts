import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { createCognitive } from "../analysis/cognitive.js";
import { personProfile, mergeDuplicatePeople, suggestPeople, dismissPersonSuggestion, peopleSnapshotText } from "../analysis/people.js";
import { chat, DEFAULT_CHAT } from "../chat/graphrag.js";
import type { AnswerOptions, ContextNode } from "../llm/adapter.js";

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

async function mem(label: string, content: string, emotion?: number) {
  const repo = new NodesRepo(handle, "legacy");
  const n = repo.create({ label, type: "daily", content, emotionalWeight: emotion } as never, await embeddings.embed(content));
  return n;
}

describe("people as entities (Cognitive Layer Phase 6)", () => {
  it("builds a CRM profile: interactions, recency, and warm tone", async () => {
    const id = await createCognitive(ctx, "legacy", "person_entity", "Maya", "");
    const edges = new EdgesRepo(handle, "legacy");
    const a = await mem("m1", "great coffee with Maya", 0.6);
    const b = await mem("m2", "Maya cheered me up", 0.5);
    edges.create({ source: a.id, target: id, relationship: "supports", weight: 0.7 });
    edges.create({ source: b.id, target: id, relationship: "supports", weight: 0.7 });

    const profile = personProfile(ctx, "legacy", id)!;
    expect(profile.count).toBe(2);
    expect(profile.tone).toBe("warm");
    expect(profile.interactions.map((i) => i.id)).toContain(a.id);
    // A non-person returns null.
    const goal = await createCognitive(ctx, "legacy", "goal", "Ship it", "");
    expect(personProfile(ctx, "legacy", goal)).toBeNull();
  });

  it("reports a mixed tone when interactions are both warm and heavy", async () => {
    const id = await createCognitive(ctx, "legacy", "person_entity", "Sam", "");
    const edges = new EdgesRepo(handle, "legacy");
    const a = await mem("m1", "fun day with Sam", 0.7);
    const b = await mem("m2", "a hard argument with Sam", -0.7);
    edges.create({ source: a.id, target: id, relationship: "supports", weight: 0.7 });
    edges.create({ source: b.id, target: id, relationship: "supports", weight: 0.7 });
    expect(personProfile(ctx, "legacy", id)!.tone).toBe("mixed");
  });

  it("merges duplicate person entities, folding their interactions onto one", async () => {
    const keep = await createCognitive(ctx, "legacy", "person_entity", "Danny", "");
    const dup = await createCognitive(ctx, "legacy", "person_entity", "Danny", "");
    const edges = new EdgesRepo(handle, "legacy");
    const a = await mem("m1", "hung out", 0.4);
    const b = await mem("m2", "called them", 0.4);
    edges.create({ source: a.id, target: keep, relationship: "supports", weight: 0.7 });
    edges.create({ source: b.id, target: dup, relationship: "supports", weight: 0.7 });

    expect(mergeDuplicatePeople(ctx, "legacy")).toBe(1);
    const remaining = handle.sqlite
      .prepare(`SELECT id FROM nodes WHERE space_id = 'legacy' AND kind = 'person_entity' AND deleted_at IS NULL`)
      .all() as { id: number }[];
    expect(remaining.length).toBe(1);
    // The survivor carries both interactions.
    expect(personProfile(ctx, "legacy", remaining[0]!.id)!.count).toBe(2);
  });

  it("NEVER merges people with different names — a person's name is sacred", async () => {
    await createCognitive(ctx, "legacy", "person_entity", "Danny", "");
    await createCognitive(ctx, "legacy", "person_entity", "Danny K", ""); // different person
    await createCognitive(ctx, "legacy", "person_entity", "Danny R", ""); // another one
    expect(mergeDuplicatePeople(ctx, "legacy")).toBe(0); // none folded — all distinct names
    const remaining = handle.sqlite
      .prepare(`SELECT label FROM nodes WHERE space_id = 'legacy' AND kind = 'person_entity' AND deleted_at IS NULL`)
      .all() as { label: string }[];
    expect(remaining.length).toBe(3);
  });

  it("suggests recurring names you mention but haven't added, ignoring noise + existing", async () => {
    await mem("m1", "lunch with Priya downtown");
    await mem("m2", "Priya sent me the notes");
    await mem("m3", "Priya and I planned the trip");
    await mem("m4", "solo walk on Monday morning"); // Monday = stopword, single mention
    // Already-added people are never suggested.
    await createCognitive(ctx, "legacy", "person_entity", "Carlos", "");
    await mem("m5", "Carlos joined too");
    await mem("m6", "Carlos again");

    const sugg = suggestPeople(ctx, "legacy");
    const names = sugg.map((s) => s.name);
    expect(names).toContain("Priya");
    expect(names).not.toContain("Monday");
    expect(names).not.toContain("Carlos"); // already an entity
  });

  it("never re-suggests someone already added, even under a name variant", async () => {
    await createCognitive(ctx, "legacy", "person_entity", "Danny K", ""); // added as a variant
    await mem("m1", "hung out with Danny again");
    await mem("m2", "Danny texted me about the plan");
    expect(suggestPeople(ctx, "legacy").map((s) => s.name)).not.toContain("Danny");
  });

  it("does NOT suggest places or titles — only words used in a person context", async () => {
    // Real name in a person context.
    await mem("m1", "grabbed food with Marcus");
    await mem("m2", "Marcus texted me later");
    // A PLACE and a TITLE that are proper nouns but never used like a person.
    await mem("m3", "worked at Palm Garden of Jacksonville today");
    await mem("m4", "back at Jacksonville for the shift");
    await mem("m5", "finished The Divine Odyssey chapter");
    await mem("m6", "more of the Divine Odyssey tonight");
    const names = suggestPeople(ctx, "legacy").map((s) => s.name);
    expect(names).toContain("Marcus");
    expect(names).not.toContain("Jacksonville");
    expect(names).not.toContain("Divine");
    expect(names).not.toContain("Odyssey");
    expect(names).not.toContain("Palm");
  });

  it("never re-suggests a name you dismissed as 'not a person'", async () => {
    await mem("m1", "met Quill at the shop");
    await mem("m2", "Quill texted me later");
    expect(suggestPeople(ctx, "legacy").map((s) => s.name)).toContain("Quill");
    dismissPersonSuggestion(ctx, "legacy", "Quill");
    expect(suggestPeople(ctx, "legacy").map((s) => s.name)).not.toContain("Quill");
  });

  it("ignores words only ever capitalised at a sentence start (not real names)", async () => {
    // "Blake" always appears mid-sentence → a real name. "Running" only ever starts
    // a sentence → capitalisation-by-position, not a person.
    await mem("m1", "went climbing with Blake");
    await mem("m2", "dinner with Blake afterwards");
    await mem("m3", "Running felt amazing today");
    await mem("m4", "Running is becoming a habit");
    const names = suggestPeople(ctx, "legacy").map((s) => s.name);
    expect(names).toContain("Blake");
    expect(names).not.toContain("Running");
  });
});

describe("peopleSnapshotText — aggregated Mind-tab summary for chat context", () => {
  it("is null when nobody is tracked", () => {
    expect(peopleSnapshotText(handle, "legacy")).toBeNull();
  });

  it("summarizes count, recency, and tone for each tracked person, in ONE query", async () => {
    const id = await createCognitive(ctx, "legacy", "person_entity", "Maya", "");
    const edges = new EdgesRepo(handle, "legacy");
    const a = await mem("m1", "great coffee with Maya", 0.6);
    const b = await mem("m2", "Maya cheered me up", 0.5);
    edges.create({ source: a.id, target: id, relationship: "supports", weight: 0.7 });
    edges.create({ source: b.id, target: id, relationship: "supports", weight: 0.7 });

    const text = peopleSnapshotText(handle, "legacy")!;
    expect(text).toContain("Maya");
    expect(text).toContain("2 interactions");
    expect(text).toContain("tone: warm");
  });

  it("reports zero interactions honestly (not NaN/undefined) for a person with none", async () => {
    await createCognitive(ctx, "legacy", "person_entity", "Nobody Yet", "");
    const text = peopleSnapshotText(handle, "legacy")!;
    expect(text).toContain("Nobody Yet");
    expect(text).toContain("0 interactions");
    expect(text).toContain("tone: neutral");
  });

  it("is space-scoped", async () => {
    await createCognitive(ctx, "alice", "person_entity", "Alice's Friend", "");
    expect(peopleSnapshotText(handle, "bob")).toBeNull();
    expect(peopleSnapshotText(handle, "alice")).not.toBeNull();
  });

  it("is injected into chat's systemExtra, same as the finance snapshot", async () => {
    class CapturingLlm extends HeuristicProvider {
      lastOpts: AnswerOptions | undefined;
      async answer(question: string, context: ContextNode[], opts?: AnswerOptions) {
        this.lastOpts = opts;
        return super.answer(question, context, opts);
      }
    }
    const id = await createCognitive(ctx, "legacy", "person_entity", "Priya", "");
    const edges = new EdgesRepo(handle, "legacy");
    const a = await mem("m1", "lunch with Priya", 0.5);
    edges.create({ source: a.id, target: id, relationship: "supports", weight: 0.7 });

    const llm = new CapturingLlm();
    await chat(handle, { embeddings, llm }, "how's it going", DEFAULT_CHAT, "legacy");
    expect(llm.lastOpts?.systemExtra ?? "").toContain("PEOPLE YOU TRACK");
    expect(llm.lastOpts?.systemExtra ?? "").toContain("Priya");
  });
});

describe("Batch L — MIN-06: personProfile count is the true total", () => {
  it("reports 101 interactions with a 100-row page, not the cap", async () => {
    const id = await createCognitive(ctx, "legacy", "person_entity", "Maya", "");
    const edges = new EdgesRepo(handle, "legacy");
    for (let i = 0; i < 101; i++) {
      const m = await mem(`m${i}`, `coffee with Maya ${i}`, 0.5);
      edges.create({ source: m.id, target: id, relationship: "supports", weight: 0.7 });
    }
    const profile = personProfile(ctx, "legacy", id)!;
    expect(profile.count).toBe(101);
    expect(profile.interactions.length).toBe(100); // the page stays capped
    expect(profile.lastAt).not.toBeNull();
  });
});
