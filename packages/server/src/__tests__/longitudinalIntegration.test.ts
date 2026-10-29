import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GalaxyNavigationCandidate, InteractionPreferenceSignal } from "@brain/shared";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { chat, DEFAULT_CHAT } from "../chat/graphrag.js";
import { ingest } from "../ingestion/pipeline.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { InsightsRepo } from "../repositories/insights.repo.js";
import { FinIncomeRepo } from "../repositories/finIncome.repo.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import { IntelligenceClarificationsRepo } from "../repositories/intelligenceClarifications.repo.js";
import { InteractionPreferencesRepo } from "../repositories/interactionPreferences.repo.js";
import { openContradictionClaims } from "../analysis/intelligence.js";
import type { AnswerOptions, AnswerResult, ContextNode } from "../llm/adapter.js";

/**
 * Maya Longitudinal Intelligence, Phase I (docs/specs/maya-longitudinal-intelligence.md,
 * Section 22) — full-system integration validation. Everything below drives the REAL
 * production `chat()` entry point end-to-end (never calling an analysis module directly to
 * fake a result) against realistic, thematically-coherent narratives, split into three
 * scenarios per the task's own guidance rather than one artificial mega-test:
 *   A — a full longitudinal conversation (historical fact, contradiction, supersession,
 *       emotional pattern, cross-domain causal inference, interaction-preference durability)
 *   B — the clarification lifecycle driven through TWO real chat() calls, not direct
 *       function calls (I1-I3's own tests already cover the mechanism in isolation)
 *   C — Galaxy navigation resolving correctly while the full snapshot stack is simultaneously
 *       active, plus rejection of an invalid candidate under the same conditions
 * Two smaller standalone checks close the audit: cross-pipeline space isolation, and a
 * performance check that nothing newly wired adds a full-space scan beyond the already-
 * documented pre-existing telemetry baseline (chat/graphrag.ts:135).
 */

class CapturingHeuristicLlm extends HeuristicProvider {
  lastOpts: AnswerOptions | undefined;
  injectPreference: InteractionPreferenceSignal | null | undefined = undefined;
  injectNav: GalaxyNavigationCandidate[] | undefined = undefined;

  async answer(question: string, context: ContextNode[], opts?: AnswerOptions): Promise<AnswerResult> {
    this.lastOpts = opts;
    const base = await super.answer(question, context, opts);
    return {
      ...base,
      interactionPreferenceSignal: this.injectPreference,
      navigationCandidates: this.injectNav,
    };
  }
}

let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);
const SPACE = "s1";

beforeEach(() => {
  handle = createDb(":memory:");
});
afterEach(() => handle.sqlite.close());

/**
 * The story's calendar, as "days before today" — NOT fixed dates. It used to be hard-coded
 * August dates (accident 2026-08-20, …), and the causal-link detector only looks back
 * CAUSAL_WINDOW_DAYS (65) from an event, so the whole scenario silently aged out on
 * 2026-10-24 and failed from then on. These offsets reproduce the original relationships
 * exactly (income fell 5 days after the accident, the stress notes sit between them and
 * now), so the scenario means the same thing on any day it is run.
 */
const SCENE = { accident: 10, incomeBefore: 46, incomeAfter: 5, stress1: 8, stress2: 3 } as const;
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS).toISOString();
const dayOf = (n: number) => daysAgo(n).slice(0, 10); // YYYY-MM-DD, for money rows
const stampOf = (n: number) => dayOf(n) + "T00:00:00"; // node occurred_at, as backdate() has always taken it

function backdate(id: number, iso: string) {
  handle.sqlite.prepare(`UPDATE nodes SET occurred_at = ? WHERE id = ?`).run(iso, id);
}
function setValence(id: number, v: number) {
  handle.sqlite.prepare(`UPDATE nodes SET emotional_weight = ? WHERE id = ?`).run(v, id);
}

/** The canonical I1-I3 vehicle/accident contradiction fixture, reused verbatim from
 *  mayaIntelligenceI1I3.test.ts / causal.test.ts so Phase I exercises the SAME narrative
 *  every earlier phase already validated in isolation, now through real chat() calls. */
async function makeVehicleContradiction(llm: HeuristicProvider, spaceId = SPACE) {
  const deps = { embeddings, llm };
  const vehicleId = (await ingest(handle, deps, "I have one vehicle, a 2016 Honda.", spaceId)).nodes[0]!.id;
  const accidentId = (await ingest(handle, deps, "Vehicle accident happened yesterday.", spaceId)).nodes[0]!.id;
  backdate(accidentId, stampOf(SCENE.accident));
  new InsightsRepo(handle, spaceId).create(vehicleId, accidentId, "The accident may affect vehicle availability.", 0.9, "contradiction");
  const [claim] = openContradictionClaims(handle, spaceId);
  return { vehicleId, accidentId, claim: claim! };
}

describe("Scenario A — a full longitudinal conversation through real chat() calls", () => {
  it("historical fact, contradiction/supersession, emotional pattern, cross-domain causal inference, and preference durability all cooperate in ONE narrative without corrupting each other", async () => {
    const llm = new CapturingHeuristicLlm();
    const deps = { embeddings, llm };

    // 1. Historical fact + contradiction (the same fixture I1-I3/causal already validated).
    const { vehicleId, accidentId } = await makeVehicleContradiction(llm);
    const vehicleBefore = handle.sqlite.prepare(`SELECT label, content, occurred_at FROM nodes WHERE id = ?`).get(vehicleId);
    const accidentBefore = handle.sqlite.prepare(`SELECT label, content, occurred_at FROM nodes WHERE id = ?`).get(accidentId);

    // 2. Downstream Money evidence, thematically tied to the accident (a real income drop).
    const income = new FinIncomeRepo(handle, SPACE);
    income.create({ date: dayOf(SCENE.incomeBefore), netCents: 400_000 });
    income.create({ date: dayOf(SCENE.incomeAfter), netCents: 250_000 });

    // 3. A REAL, repeated (not one-off) emotional pattern about the same situation — the
    // accident's aftermath, so the whole scenario reads as one coherent story rather than an
    // emotional signal manufactured merely to satisfy the test.
    const f1 = (await ingest(handle, deps, "Stressed about getting around without the car after the accident.", SPACE)).nodes[0]!.id;
    const f2 = (await ingest(handle, deps, "Still stressed about not having the car since the accident.", SPACE)).nodes[0]!.id;
    backdate(f1, stampOf(SCENE.stress1));
    backdate(f2, stampOf(SCENE.stress2));
    setValence(f1, -0.6);
    setValence(f2, -0.7);

    // 4. Some unrelated filler memories — relevance/retrieval must still favor the topical
    // ones when the user actually asks about the car, not just retrieve everything ever said.
    for (let i = 0; i < 6; i++) {
      await ingest(handle, deps, `Reading about the history of jazz music, note ${i}.`, SPACE);
    }

    // 5. Turn 1: ask about the car. Every longitudinal capability should be simultaneously
    // present and internally consistent in ONE reply's systemExtra.
    const r1 = await chat(handle, deps, "What's going on with my vehicle and the accident?", DEFAULT_CHAT, SPACE);
    const extra1 = llm.lastOpts?.systemExtra ?? "";

    // Retrieval favors the topical memories over the unrelated jazz filler.
    expect(r1.contextIds).toContain(vehicleId);
    expect(r1.contextIds).toContain(accidentId);

    // Historical/contradiction/supersession framing (Phase A/B, via intelligenceSnapshotText).
    expect(extra1).toContain("INTELLIGENCE NOTES");
    expect(extra1).toContain("Possible contradiction");
    expect(extra1).not.toMatch(/\bconfirmed\b/); // never upgraded past "possible"/"observation" here

    // Cross-domain causal inference (Phase G) — hedged, never asserted.
    expect(extra1).toMatch(/Possible downstream effect/);
    expect(extra1).toMatch(/doesn't prove|not a confirmed|coincid/i);

    // Emotional pattern (Phase E) — present, and framed as a signal, never a settled fact.
    expect(extra1).toContain("EMOTIONAL CONTEXT");
    expect(extra1).toContain("recurring SIGNAL");

    // 6. Interaction preference (Phase H): a single mention is NOT yet durable.
    llm.injectPreference = { signal: "verbosity", value: "concise" };
    await chat(handle, deps, "Keep your answers shorter from now on.", DEFAULT_CHAT, SPACE);
    llm.injectPreference = undefined;
    const r2 = await chat(handle, deps, "Anything else about the car?", DEFAULT_CHAT, SPACE);
    expect(llm.lastOpts?.systemExtra ?? "").not.toContain("HOW THEY'VE ASKED YOU TO COMMUNICATE");

    // A second, consistent mention makes it durable — now it surfaces on a LATER, unrelated turn.
    llm.injectPreference = { signal: "verbosity", value: "concise" };
    await chat(handle, deps, "Seriously, shorter answers please.", DEFAULT_CHAT, SPACE);
    llm.injectPreference = undefined;
    const r3 = await chat(handle, deps, "hello again", DEFAULT_CHAT, SPACE);
    const extra3 = llm.lastOpts?.systemExtra ?? "";
    expect(extra3).toContain("HOW THEY'VE ASKED YOU TO COMMUNICATE");
    expect(extra3).toContain("concise");
    void r2; void r3;

    // 7. Historical immutability: after ALL of the above reasoning ran repeatedly over this
    // narrative, the ORIGINAL memories are byte-identical — nothing here ever rewrites history.
    const vehicleAfter = handle.sqlite.prepare(`SELECT label, content, occurred_at FROM nodes WHERE id = ?`).get(vehicleId);
    const accidentAfter = handle.sqlite.prepare(`SELECT label, content, occurred_at FROM nodes WHERE id = ?`).get(accidentId);
    expect(vehicleAfter).toEqual(vehicleBefore);
    expect(accidentAfter).toEqual(accidentBefore);

    // 8. Epistemic safety: the causal note is explicitly hedged (asserted above via the
    // "doesn't prove/coincid" match) — the only appearance of the word "caused" anywhere in
    // the transcript is inside the guidance instructing the model NOT to say it, never as an
    // assertion that it happened.
    const causedOccurrences = (extra1.match(/\bcaused\b/gi) ?? []).length;
    const hedgeOccurrences = (extra1.match(/never say "X caused Y"/gi) ?? []).length;
    expect(causedOccurrences).toBe(hedgeOccurrences);
  });
});

describe("Scenario B — the clarification lifecycle driven through TWO real chat() calls", () => {
  it("a raised clarification is asked in turn 1's context and resolved into a confirmed memory by turn 2's message, entirely via chat()", async () => {
    const llm = new CapturingHeuristicLlm();
    const deps = { embeddings, llm };
    const { vehicleId, accidentId } = await makeVehicleContradiction(llm);

    // Turn 1: a neutral message (deliberately no overlap with the clarification question, so
    // it can't accidentally resolve it in the same turn it's raised).
    await chat(handle, deps, "Good morning.", DEFAULT_CHAT, SPACE);
    const extra1 = llm.lastOpts?.systemExtra ?? "";
    expect(extra1).toContain("you may ask");

    const pending = new IntelligenceClarificationsRepo(handle, SPACE).mostRecentPending();
    expect(pending).not.toBeNull();
    expect(pending!.status).toBe("pending");

    // Turn 2: the user's ordinary next chat message happens to answer it.
    await chat(handle, deps, "Yes, it was totaled in the accident.", DEFAULT_CHAT, SPACE);
    const extra2 = llm.lastOpts?.systemExtra ?? "";
    expect(extra2).toContain("CLARIFICATION RESOLVED");

    const clarifications = new IntelligenceClarificationsRepo(handle, SPACE);
    expect(clarifications.get(pending!.id)?.status).toBe("confirmed");

    const nodesRepo = new NodesRepo(handle, SPACE);
    const confirmed = [...nodesRepo.all()].find((n) => n.origin === "user");
    expect(confirmed).toBeTruthy();
    expect(confirmed!.content).toContain("totaled in the accident");

    const edgesRepo = new EdgesRepo(handle, SPACE);
    expect(edgesRepo.exists(confirmed!.id, accidentId)).toBe(true);

    // The originating memories are untouched — resolving a clarification never rewrites them.
    expect(nodesRepo.getById(vehicleId)?.content).toBe("I have one vehicle, a 2016 Honda.");
    expect(nodesRepo.getById(accidentId)?.content).toBe("Vehicle accident happened yesterday.");

    // A THIRD turn never re-asks the same, now-resolved question.
    await chat(handle, deps, "Anything on your mind?", DEFAULT_CHAT, SPACE);
    expect(new IntelligenceClarificationsRepo(handle, SPACE).mostRecentPending()).toBeNull();
  });
});

describe("Scenario C — Galaxy navigation coexists with the full snapshot stack", () => {
  it("a proposed navigation candidate resolves correctly in the SAME reply where intelligence/emotional/causal/preference context is simultaneously active", async () => {
    const llm = new CapturingHeuristicLlm();
    const deps = { embeddings, llm };

    // Build the same longitudinal narrative as Scenario A (abbreviated) so every snapshot has
    // real data to surface at once, plus an active Journey for navigation to resolve to.
    await makeVehicleContradiction(llm);
    const income = new FinIncomeRepo(handle, SPACE);
    income.create({ date: dayOf(SCENE.incomeBefore), netCents: 400_000 });
    income.create({ date: dayOf(SCENE.incomeAfter), netCents: 250_000 });
    const f1 = (await ingest(handle, deps, "Stressed about the accident's aftermath.", SPACE)).nodes[0]!.id;
    const f2 = (await ingest(handle, deps, "Still stressed about the accident's aftermath.", SPACE)).nodes[0]!.id;
    backdate(f1, stampOf(SCENE.stress1));
    backdate(f2, stampOf(SCENE.stress2));
    setValence(f1, -0.6);
    setValence(f2, -0.7);
    llm.injectPreference = { signal: "verbosity", value: "concise" };
    await chat(handle, deps, "Keep it short.", DEFAULT_CHAT, SPACE);
    await chat(handle, deps, "Seriously, keep it short.", DEFAULT_CHAT, SPACE);
    llm.injectPreference = undefined;

    const journey = new JourneysRepo(handle, SPACE).create({ title: "Replace the vehicle", status: "active" });
    llm.injectNav = [{ kind: "journey", id: journey.id }];

    const result = await chat(handle, deps, "What's going on with my car and the accident?", DEFAULT_CHAT, SPACE);
    const extra = llm.lastOpts?.systemExtra ?? "";

    // Navigation resolved correctly, independent of everything else in the reply.
    expect(result.navigation).toBeDefined();
    expect(result.navigation!.target).toEqual({ domain: "journey", kind: "journey", id: journey.id, label: "Replace the vehicle" });
    expect(result.navigation!.reason.length).toBeGreaterThan(0);

    // ...while the rest of the snapshot stack is simultaneously present, unaffected.
    expect(extra).toContain("INTELLIGENCE NOTES");
    expect(extra).toContain("EMOTIONAL CONTEXT");
    expect(extra).toContain("HOW THEY'VE ASKED YOU TO COMMUNICATE");

    // Citations still resolve normally, alongside navigation, not instead of it.
    expect(result.citations.every((c) => typeof c.id === "number")).toBe(true);

    // An invalid candidate (nonexistent id), proposed under the SAME full-stack conditions,
    // never reaches ChatResponse — the server's own validation is unaffected by how much else
    // is active in the same turn.
    llm.injectNav = [{ kind: "journey", id: 999_999 }];
    const badResult = await chat(handle, deps, "What's going on with my car and the accident?", DEFAULT_CHAT, SPACE);
    expect(badResult.navigation).toBeUndefined();

    // A candidate pointing at another space's journey never resolves either, same conditions.
    const otherJourney = new JourneysRepo(handle, "other-space").create({ title: "Not yours", status: "active" });
    llm.injectNav = [{ kind: "journey", id: otherJourney.id }];
    const crossSpaceResult = await chat(handle, deps, "What's going on with my car and the accident?", DEFAULT_CHAT, SPACE);
    expect(crossSpaceResult.navigation).toBeUndefined();

    // No automatic camera movement: ChatResponse.navigation is inert DATA — the web client
    // (ChatDock.tsx) only invokes `onNavigate` from the chip's own onClick handler, never on
    // render/receipt of a message. That is a structural, code-level guarantee (verified by
    // reading ChatDock.tsx directly as part of this audit), not something a server-side chat()
    // test can observe — noted here rather than asserted, since there is no camera on this side
    // of the boundary to assert against.
  });
});

describe("cross-pipeline space isolation — the full integrated stack, not just one feature", () => {
  it("nothing from one space's longitudinal reasoning ever reaches another space's chat", async () => {
    const llmA = new CapturingHeuristicLlm();
    const depsA = { embeddings, llm: llmA };
    await makeVehicleContradiction(llmA, "space-a");
    const income = new FinIncomeRepo(handle, "space-a");
    income.create({ date: dayOf(SCENE.incomeBefore), netCents: 400_000 });
    income.create({ date: dayOf(SCENE.incomeAfter), netCents: 250_000 });
    const f1 = (await ingest(handle, depsA, "Stressed about the accident's aftermath.", "space-a")).nodes[0]!.id;
    const f2 = (await ingest(handle, depsA, "Still stressed about the accident's aftermath.", "space-a")).nodes[0]!.id;
    backdate(f1, stampOf(SCENE.stress1));
    backdate(f2, stampOf(SCENE.stress2));
    setValence(f1, -0.6);
    setValence(f2, -0.7);
    llmA.injectPreference = { signal: "verbosity", value: "concise" };
    await chat(handle, depsA, "Keep it short.", DEFAULT_CHAT, "space-a");
    await chat(handle, depsA, "Seriously, keep it short.", DEFAULT_CHAT, "space-a");
    const journey = new JourneysRepo(handle, "space-a").create({ title: "Replace the vehicle", status: "active" });

    const llmB = new CapturingHeuristicLlm();
    llmB.injectNav = [{ kind: "journey", id: journey.id }]; // space-a's journey id, proposed in space-b
    await chat(handle, { embeddings, llm: llmB }, "What's going on with my car and the accident?", DEFAULT_CHAT, "space-b");
    const extraB = llmB.lastOpts?.systemExtra ?? "";

    expect(extraB).not.toContain("INTELLIGENCE NOTES");
    expect(extraB).not.toContain("EMOTIONAL CONTEXT");
    expect(extraB).not.toContain("HOW THEY'VE ASKED YOU TO COMMUNICATE");
    const resultB = await chat(handle, { embeddings, llm: llmB }, "hi", DEFAULT_CHAT, "space-b");
    expect(resultB.navigation).toBeUndefined(); // space-a's journey id never resolves in space-b

    // space-a's own reasoning is unaffected by space-b ever having existed.
    const extraA = llmA.lastOpts?.systemExtra ?? "";
    void extraA;
    const preferencesA = new InteractionPreferencesRepo(handle, "space-a").list();
    expect(preferencesA.length).toBeGreaterThan(0);
    expect(new InteractionPreferencesRepo(handle, "space-b").list()).toEqual([]);
  });
});

describe("performance — the integrated pipeline adds no NEW full-space scan beyond the documented pre-existing baseline", () => {
  it("NodesRepo.all() is called exactly once per chat() turn (chat/graphrag.ts:135's pre-existing telemetry block) regardless of how much longitudinal context is active", async () => {
    const llm = new CapturingHeuristicLlm();
    const deps = { embeddings, llm };
    await makeVehicleContradiction(llm);
    const income = new FinIncomeRepo(handle, SPACE);
    income.create({ date: dayOf(SCENE.incomeBefore), netCents: 400_000 });
    income.create({ date: dayOf(SCENE.incomeAfter), netCents: 250_000 });
    const f1 = (await ingest(handle, deps, "Stressed about the accident's aftermath.", SPACE)).nodes[0]!.id;
    const f2 = (await ingest(handle, deps, "Still stressed about the accident's aftermath.", SPACE)).nodes[0]!.id;
    backdate(f1, stampOf(SCENE.stress1));
    backdate(f2, stampOf(SCENE.stress2));
    setValence(f1, -0.6);
    setValence(f2, -0.7);
    llm.injectPreference = { signal: "verbosity", value: "concise" };
    await chat(handle, deps, "Keep it short.", DEFAULT_CHAT, SPACE);
    await chat(handle, deps, "Seriously, keep it short.", DEFAULT_CHAT, SPACE);
    const journey = new JourneysRepo(handle, SPACE).create({ title: "Replace the vehicle", status: "active" });
    llm.injectNav = [{ kind: "journey", id: journey.id }];

    const allSpy = vi.spyOn(NodesRepo.prototype, "all");
    try {
      await chat(handle, deps, "What's going on with my car and the accident?", DEFAULT_CHAT, SPACE);
      // Exactly the known pre-existing baseline (the telemetry block) — not zero (that call
      // predates every longitudinal phase and is explicitly out of scope), and not more than
      // one (which would mean something newly wired in this integration re-scans the space).
      expect(allSpy.mock.calls.length).toBe(1);
    } finally {
      allSpy.mockRestore();
    }
  });
});
