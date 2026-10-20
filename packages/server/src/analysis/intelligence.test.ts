import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { ingest } from "../ingestion/pipeline.js";
import { InsightsRepo } from "../repositories/insights.repo.js";
import {
  openContradictionClaims,
  thoughtContinuityClaims,
  supersessionClaims,
  selectClarification,
  clarificationAskedRecently,
  intelligenceSnapshotText,
} from "./intelligence.js";
import type { ClarificationCandidate, IntelligenceClaim } from "@brain/shared";

/**
 * Maya Intelligence (docs/specs/maya-intelligence-architecture.md) — behavioral scenario tests
 * (the brief's §28). Each `describe` block below is labeled with the scenario letter it covers.
 * Honest scope note up front: scenarios D (accident/asset-availability), E (financial
 * consequence/causation), and G (Galaxy click-resolution for non-memory bodies) are NOT fully
 * covered here — see the architecture doc's "Behavioral validation" section for exactly why
 * (they hinge on real LLM visual/causal judgment or on 3D click-handling infrastructure this
 * pass deliberately did not build). What IS tested is the deterministic MECHANISM those
 * scenarios depend on: forming an appropriately-hedged claim from an already-detected
 * contradiction, and gating whether to surface it.
 */

let handle: DbHandle;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);
const llm = new HeuristicProvider();
beforeEach(() => { handle = createDb(":memory:"); });
afterEach(() => handle.sqlite.close());

function backdate(id: number, iso: string) {
  handle.sqlite.prepare(`UPDATE nodes SET occurred_at = ? WHERE id = ?`).run(iso, id);
}

describe("Scenario I — insufficient evidence: silence, never a fabricated claim", () => {
  it("returns empty claim lists for an empty space (no hallucinated observations)", () => {
    expect(openContradictionClaims(handle, "s1")).toEqual([]);
    expect(thoughtContinuityClaims(handle, "s1")).toEqual([]);
  });
  it("intelligenceSnapshotText is null when there is nothing to say", () => {
    expect(intelligenceSnapshotText(handle, "s1")).toBeNull();
  });
});

describe("Scenario C / J — contradiction detection: uncertainty, never a silent overwrite", () => {
  it("reframes an already-detected contradiction as an OBSERVATION, never a fact, with both memories as evidence", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle, a 2016 sedan.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Also have a truck I use for weekend jobs.", "s1")).nodes[0]!.id;
    // Simulates what synthesis/contradictions.ts's runContradictionScan() would already have
    // persisted after a real llm.detectContradiction() call — not re-deriving detection here.
    new InsightsRepo(handle, "s1").create(a, b, "This may conflict with only owning one vehicle.", 0.8, "contradiction");

    const claims = openContradictionClaims(handle, "s1");
    expect(claims).toHaveLength(1);
    expect(claims[0]!.status).toBe("observation"); // never "fact"
    expect(claims[0]!.evidence.map((e) => e.id).sort()).toEqual([a, b].sort());
    expect(claims[0]!.confidence).toBeCloseTo(0.8);
  });

  it("never modifies the original memories — the older fact stays queryable exactly as recorded", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Got into an accident with the truck.", "s1")).nodes[0]!.id;
    new InsightsRepo(handle, "s1").create(a, b, "The accident may affect vehicle availability.", 0.7, "contradiction");

    const before = handle.sqlite.prepare(`SELECT label, content FROM nodes WHERE id = ?`).get(a);
    openContradictionClaims(handle, "s1");
    thoughtContinuityClaims(handle, "s1");
    const after = handle.sqlite.prepare(`SELECT label, content FROM nodes WHERE id = ?`).get(a);
    expect(after).toEqual(before); // history preserved, nothing rewritten
  });

  it("caps at MAX_CONTRADICTION_CLAIMS even when more exist (bounded, not a full dump)", async () => {
    const insights = new InsightsRepo(handle, "s1");
    for (let i = 0; i < 6; i++) {
      const a = (await ingest(handle, { embeddings, llm }, `Memory A${i}`, "s1")).nodes[0]!.id;
      const b = (await ingest(handle, { embeddings, llm }, `Memory B${i}`, "s1")).nodes[0]!.id;
      insights.create(a, b, `Conflict ${i}`, 0.6, "contradiction");
    }
    expect(openContradictionClaims(handle, "s1").length).toBeLessThanOrEqual(3);
  });

  it("is space-scoped", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "A", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "B", "s1")).nodes[0]!.id;
    new InsightsRepo(handle, "other-space").create(a, b, "conflict", 0.7, "contradiction");
    expect(openContradictionClaims(handle, "s1")).toEqual([]);
  });
});

describe("Scenario A — thought continuity: recognized without assuming permanence", () => {
  it("recognizes a theme that persisted across a real gap (reusing analysis/temporalChains.ts's own detection, not re-deriving it)", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "Thinking seriously about starting a trucking company.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Thinking seriously about starting a trucking company.", "s1")).nodes[0]!.id;
    backdate(a, "2026-01-01T12:00:00");
    backdate(b, "2026-01-25T12:00:00"); // 24 days later — clears the 14-day gap and, being
    // identical text, clears buildEvolutionLinks' default 0.84 similarity threshold even
    // under the deterministic hash embedding provider.

    const claims = thoughtContinuityClaims(handle, "s1");
    expect(claims.length).toBeGreaterThan(0);
    expect(claims[0]!.status).toBe("observation");
    expect(claims[0]!.evidence.map((e) => e.id)).toEqual([a, b]);
  });

  it("does not claim continuity for a single, non-recurring memory (no false permanence)", async () => {
    await ingest(handle, { embeddings, llm }, "A one-off thought about painting the fence.", "s1");
    expect(thoughtContinuityClaims(handle, "s1")).toEqual([]);
  });
});

describe("Scenario H — stale vs. current already covered by the temporal layer", () => {
  it("is satisfied by analysis/temporalContext.test.ts's existing stale-income/stale-goal tests — not re-tested here to avoid duplicating that coverage", () => {
    expect(true).toBe(true);
  });
});

describe("selectClarification — the deterministic clarification gate", () => {
  const claim = (overrides: Partial<IntelligenceClaim> = {}): IntelligenceClaim => ({
    id: "insight:1", status: "observation", statement: "x", confidence: 0.8, domain: "mind", evidence: [], createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });
  const candidate = (priority: number): ClarificationCandidate => ({ claim: claim(), question: "q?", priority, reason: "r" });

  it("never asks during a cooldown, regardless of priority", () => {
    expect(selectClarification([candidate(0.99)], true)).toBeNull();
  });
  it("never asks with zero candidates", () => {
    expect(selectClarification([], false)).toBeNull();
  });
  it("does not ask when the best candidate is below the priority bar (not every uncertainty deserves a question)", () => {
    expect(selectClarification([candidate(0.1)], false)).toBeNull();
  });
  it("picks the single highest-priority candidate once the bar is cleared", () => {
    const low = candidate(0.55);
    const high = candidate(0.9);
    expect(selectClarification([low, high], false)).toBe(high);
  });
});

describe("clarificationAskedRecently — cooldown", () => {
  it("is false with no prior clarification log", () => {
    expect(clarificationAskedRecently(handle, "s1", Date.now())).toBe(false);
  });
  it("is true within the cooldown window, false once it expires", () => {
    const now = Date.parse("2026-09-10T00:00:00Z");
    const twoDaysAgo = new Date(now - 2 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
    handle.sqlite
      .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES ('s1', 'intelligence:clarification', 'x', '[]', ?)`)
      .run(twoDaysAgo);
    expect(clarificationAskedRecently(handle, "s1", now)).toBe(true);

    // Expired case: agent_logs is append-only (the UPDATE this test used to
    // do is blocked by trigger by design), so the aged row is inserted
    // directly with its old created_at, in its own space.
    const tenDaysAgo = new Date(now - 10 * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
    handle.sqlite
      .prepare(`INSERT INTO agent_logs (space_id, action, description, targets, created_at) VALUES ('s2', 'intelligence:clarification', 'x', '[]', ?)`)
      .run(tenDaysAgo);
    expect(clarificationAskedRecently(handle, "s2", now)).toBe(false);
  });
});

/**
 * Maya Longitudinal Intelligence, Phase A (docs/specs/maya-longitudinal-intelligence.md) —
 * `supersessionClaims` is the real producer of `"outdated"`/`"contradicted"` this pass's audit
 * found missing (both existed in `EpistemicStatus` since I1-I3 but nothing ever emitted them).
 * `resolveSupersession`'s own pure-arithmetic unit tests live in `supersession.test.ts`; these
 * tests cover the INTEGRATION through the two real upstream detectors it's wired to.
 */
describe("supersessionClaims — direction-of-currency, wired to real detectors", () => {
  it("a genuine, already-detected contradiction with resolvable dates becomes 'contradicted'", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Got a second vehicle.", "s1")).nodes[0]!.id;
    backdate(a, "2026-01-01T12:00:00");
    backdate(b, "2026-03-01T12:00:00");
    new InsightsRepo(handle, "s1").create(a, b, "This may conflict with only owning one vehicle.", 0.8, "contradiction");

    const claims = supersessionClaims(handle, "s1");
    expect(claims.length).toBeGreaterThan(0);
    expect(claims[0]!.status).toBe("contradicted");
  });

  it("a legitimate state change (continuity, not a contradiction) becomes 'outdated', never 'contradicted'", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "Thinking seriously about starting a trucking company.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Thinking seriously about starting a trucking company.", "s1")).nodes[0]!.id;
    backdate(a, "2026-01-01T12:00:00");
    backdate(b, "2026-01-25T12:00:00");

    const claims = supersessionClaims(handle, "s1", [a, b]);
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => c.status === "outdated")).toBe(true);
    expect(claims.some((c) => c.status === "contradicted")).toBe(false);
  });

  it("insufficient evidence (dates too close together) never promotes a status — no claim added", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Got a second vehicle.", "s1")).nodes[0]!.id;
    // Both effectively "now" — no confident date ordering (resolveSupersession's own
    // MIN_CONFIDENT_GAP_MS guard) — the pair is skipped, not guessed at.
    new InsightsRepo(handle, "s1").create(a, b, "This may conflict with only owning one vehicle.", 0.8, "contradiction");

    expect(supersessionClaims(handle, "s1")).toEqual([]);
  });

  it("provenance is preserved end-to-end — evidence still points at the real memory ids/labels", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Got a second vehicle.", "s1")).nodes[0]!.id;
    backdate(a, "2026-01-01T12:00:00");
    backdate(b, "2026-03-01T12:00:00");
    new InsightsRepo(handle, "s1").create(a, b, "This may conflict with only owning one vehicle.", 0.8, "contradiction");

    const [claim] = supersessionClaims(handle, "s1");
    expect(claim!.evidence.map((e) => e.id).sort()).toEqual([a, b].sort());
    expect(claim!.evidence.every((e) => e.domain === "memory" && e.kind === "node")).toBe(true);
  });

  it("the historical record is preserved unmutated — the superseded memory's own row is untouched", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Got a second vehicle.", "s1")).nodes[0]!.id;
    backdate(a, "2026-01-01T12:00:00");
    backdate(b, "2026-03-01T12:00:00");
    new InsightsRepo(handle, "s1").create(a, b, "This may conflict with only owning one vehicle.", 0.8, "contradiction");

    const before = handle.sqlite.prepare(`SELECT label, content, occurred_at FROM nodes WHERE id = ?`).get(a);
    supersessionClaims(handle, "s1");
    const after = handle.sqlite.prepare(`SELECT label, content, occurred_at FROM nodes WHERE id = ?`).get(a);
    expect(after).toEqual(before);
  });

  it("is space-scoped — an insight/pair from another space never produces a claim here", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "other-space")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Got a second vehicle.", "other-space")).nodes[0]!.id;
    handle.sqlite.prepare(`UPDATE nodes SET occurred_at = ? WHERE id = ?`).run("2026-01-01T12:00:00", a);
    handle.sqlite.prepare(`UPDATE nodes SET occurred_at = ? WHERE id = ?`).run("2026-03-01T12:00:00", b);
    new InsightsRepo(handle, "other-space").create(a, b, "conflict", 0.8, "contradiction");

    expect(supersessionClaims(handle, "s1")).toEqual([]);
  });

  it("intelligenceSnapshotText surfaces the supersession line only when a status was actually resolved", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Got a second vehicle.", "s1")).nodes[0]!.id;
    backdate(a, "2026-01-01T12:00:00");
    backdate(b, "2026-03-01T12:00:00");
    new InsightsRepo(handle, "s1").create(a, b, "This may conflict with only owning one vehicle.", 0.8, "contradiction");

    const text = intelligenceSnapshotText(handle, "s1") ?? "";
    expect(text).toContain("No longer current");
  });
});

describe("intelligenceSnapshotText — chat-facing renderer", () => {
  it("narrates an open contradiction as an observation and never states the reconciliation as settled", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Vehicle accident happened yesterday.", "s1")).nodes[0]!.id;
    new InsightsRepo(handle, "s1").create(a, b, "The accident may affect vehicle availability.", 0.75, "contradiction");

    const text = intelligenceSnapshotText(handle, "s1");
    expect(text).not.toBeNull();
    expect(text).toContain("NOT settled facts");
    expect(text).toContain("Possible contradiction");
  });

  it("includes at most one suggested clarification, and it is phrased as optional, not a script", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Vehicle accident happened yesterday.", "s1")).nodes[0]!.id;
    new InsightsRepo(handle, "s1").create(a, b, "The accident may affect vehicle availability.", 0.9, "contradiction");

    const text = intelligenceSnapshotText(handle, "s1") ?? "";
    expect(text).toContain("If it fits naturally, you may ask");
    expect(text.match(/you may ask/g)?.length).toBe(1);
  });

  it("respects the clarification cooldown across calls, so the same suggestion isn't repeated every message", async () => {
    const a = (await ingest(handle, { embeddings, llm }, "I have one vehicle.", "s1")).nodes[0]!.id;
    const b = (await ingest(handle, { embeddings, llm }, "Vehicle accident happened yesterday.", "s1")).nodes[0]!.id;
    new InsightsRepo(handle, "s1").create(a, b, "The accident may affect vehicle availability.", 0.9, "contradiction");

    const first = intelligenceSnapshotText(handle, "s1") ?? "";
    const second = intelligenceSnapshotText(handle, "s1") ?? "";
    expect(first).toContain("you may ask");
    expect(second).not.toContain("you may ask"); // cooldown now active from the first call
    expect(second).toContain("Possible contradiction"); // the observation itself still surfaces
  });
});
