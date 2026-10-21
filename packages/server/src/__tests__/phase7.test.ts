import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDb, type DbHandle } from "../db/client.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { AppContext } from "../context.js";
import { UsageTracker } from "../usage.js";
import { NodesRepo } from "../repositories/nodes.repo.js";
import { EdgesRepo } from "../repositories/edges.repo.js";
import { GraphService } from "../graph/service.js";
import { createCognitive } from "../analysis/cognitive.js";
import { upcomingEvents, rollPastEvents } from "../analysis/future.js";
import { stepDrives } from "../analysis/drives.js";
import { COGNITIVE_META } from "@brain/shared";

let handle: DbHandle;
let ctx: AppContext;
const embeddings = new HashEmbeddingProvider(EMBED_DIM);

beforeEach(() => {
  handle = createDb(":memory:");
  ctx = { handle, embeddings, llm: new HeuristicProvider(), usage: new UsageTracker(handle) } as AppContext;
});
afterEach(() => handle.sqlite.close());

const kindOf = (id: number) => new GraphService(handle, "legacy").getNode(id)?.kind;

describe("Cognitive Layer Phase 7 — future events, intentions, motivations", () => {
  it("lists upcoming events by date and rolls a past-due one into memory", async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const a = await createCognitive(ctx, "legacy", "future_event", "Dentist", "", { date: soon });
    const b = await createCognitive(ctx, "legacy", "future_event", "Deadline", "", { date: past });

    const up = upcomingEvents(ctx, "legacy");
    expect(up.map((e) => e.id)).toEqual([b, a]); // soonest (past) first
    expect(up.find((e) => e.id === a)!.inDays).toBeGreaterThanOrEqual(2);

    expect(rollPastEvents(ctx, "legacy")).toBe(1);
    expect(kindOf(b)).toBe("memory"); // the past-due event became history
    expect(kindOf(a)).toBe("future_event"); // the upcoming one is untouched
  });

  it("excludes a future event whose remind_at is unparseable (never a null inDays)", async () => {
    const ok = await createCognitive(ctx, "legacy", "future_event", "Dentist", "", {
      date: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    const bad = await createCognitive(ctx, "legacy", "future_event", "Mystery", "", {
      date: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });
    // Corrupt the stored date: julianday() of this is NULL, so the row used to
    // surface with inDays = NULL — rendered by the Mind panel as "in nulld".
    handle.sqlite.prepare(`UPDATE nodes SET remind_at = 'not a date' WHERE id = ?`).run(bad);

    const up = upcomingEvents(ctx, "legacy");
    expect(up.map((e) => e.id)).toEqual([ok]);
    expect(up.every((e) => Number.isInteger(e.inDays))).toBe(true);
  });

  it("fulfils an intention that gets acted on, and expires one that doesn't", async () => {
    const acted = await createCognitive(ctx, "legacy", "intention", "Call the plumber", "");
    const ignored = await createCognitive(ctx, "legacy", "intention", "Reorganise the garage", "");
    // "acted" gets a supporting memory; "ignored" is left old and unsupported.
    const m = new NodesRepo(handle, "legacy").create({ label: "did it", type: "daily", content: "called the plumber" } as never, await embeddings.embed("called the plumber"));
    new EdgesRepo(handle, "legacy").create({ source: m.id, target: acted, relationship: "supports", weight: 0.7 });
    handle.sqlite.prepare(`UPDATE nodes SET created_at = datetime('now','-20 days') WHERE id = ?`).run(ignored);

    const res = stepDrives(ctx, "legacy");
    expect(res.fulfilled).toBe(1);
    expect(res.expired).toBe(1);
    expect(kindOf(acted)).toBe("memory"); // fulfilled → settled into memory
    expect(new GraphService(handle, "legacy").getNode(ignored)).toBeUndefined(); // expired
  });

  it("brightens a motivation as memories align with it", async () => {
    const id = await createCognitive(ctx, "legacy", "motivation", "Provide for my family", "");
    const base = new GraphService(handle, "legacy").getNode(id)?.importance ?? 0;
    const edges = new EdgesRepo(handle, "legacy");
    for (let i = 0; i < 3; i++) {
      const m = new NodesRepo(handle, "legacy").create({ label: `a${i}`, type: "daily", content: `aligned ${i}` } as never, await embeddings.embed(`aligned ${i}`));
      edges.create({ source: m.id, target: id, relationship: "supports", weight: 0.7 });
    }
    stepDrives(ctx, "legacy");
    const node = new GraphService(handle, "legacy").getNode(id);
    expect(node?.importance ?? 0).toBeGreaterThan(base);
    expect(node?.importance ?? 0).toBeGreaterThan(COGNITIVE_META.motivation.importance);
  });
});
