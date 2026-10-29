import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import type { GraphData } from "@brain/shared";

let ctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;

beforeAll(async () => {
  ctx = await buildContext({
    dbPath: ":memory:",
    embeddings: new HashEmbeddingProvider(EMBED_DIM),
    llm: new HeuristicProvider(),
  });
  const app = createApp(ctx);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Open a private brain; every data request carries its id.
  const auth = await fetch(`${base}/api/space/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag: "tester", passcode: "secret123", name: "tester" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});

afterAll(() => {
  server?.close();
  ctx.handle.sqlite.close();
});

/* eslint-disable @typescript-eslint/no-explicit-any */
async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-space-id": spaceId },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function get(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { headers: { "x-space-id": spaceId } });
  return { status: res.status, body: await res.json() };
}
async function patchReq(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-space-id": spaceId },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe("REST API", () => {
  it("reports health with a real DB probe + uptime + provider info", async () => {
    const { status, body } = await get("/api/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.db.ok).toBe(true); // the SQLite handle was probed live
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.embeddings.dim).toBe(EMBED_DIM);
    expect(body.llm.available).toBe(false); // heuristic fallback
  });

  it("rejects data requests without a valid space", async () => {
    const res = await fetch(`${base}/api/graph`);
    expect(res.status).toBe(401);
  });

  it("creates separate brains and keeps their data isolated", async () => {
    const other = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "relative", passcode: "different", name: "relative" }),
    });
    const otherId = ((await other.json()) as { id: string }).id;
    expect(otherId).not.toBe(spaceId);
    // A brand-new brain opens with exactly its own seeded welcome star (#1c endowed
    // progress) and none of `tester`'s memories — proving isolation, not emptiness.
    const g = await fetch(`${base}/api/graph`, { headers: { "x-space-id": otherId } });
    const graph = (await g.json()) as GraphData;
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.label).toBe("The first light");
  });

  it("ingests thoughts and returns them as graph data", async () => {
    const a = await post("/api/ingest", {
      text: "I want to start a coffee subscription business with local roasters",
    });
    expect(a.status).toBe(200);
    expect(a.body.nodes.length).toBeGreaterThanOrEqual(1);

    await post("/api/ingest", {
      text: "I want to start a coffee subscription company with local roasters",
    });

    const graph = (await get("/api/graph")).body as GraphData;
    expect(graph.nodes.length).toBeGreaterThanOrEqual(2);
    // GraphData is directly react-force-graph-3d shaped.
    expect(graph.nodes[0]).toHaveProperty("id");
    expect(graph).toHaveProperty("links");
  });

  it("rejects empty ingest body", async () => {
    const { status } = await post("/api/ingest", { text: "" });
    expect(status).toBe(400);
  });

  it("distills a conversation into memory-worthy notes (heuristic offline)", async () => {
    const { status, body } = await post("/api/chat/distill", {
      messages: [
        { role: "you", text: "I decided to move the product launch to the third quarter for safety." },
        { role: "soumaya", text: "Noted — a careful call." },
        { role: "you", text: "ok?" },
      ],
    });
    expect(status).toBe(200);
    expect(Array.isArray(body.summaries)).toBe(true);
    // The substantive line is kept; the trivial "ok?" question is dropped.
    expect(body.summaries.some((s: string) => s.includes("third quarter"))).toBe(true);
    expect(body.summaries.some((s: string) => s.trim() === "ok?")).toBe(false);
  });

  it("updates the profile name freely and keeps the gamer tag unique", async () => {
    const patch = (id: string, body: unknown) =>
      fetch(`${base}/api/space/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-space-id": id },
        body: JSON.stringify(body),
      });
    // Name can be anything.
    const r1 = await patch(spaceId, { name: "Renamed Brain" });
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { name: string }).name).toBe("Renamed Brain");
    // A second brain, then try to steal its gamer tag → 409.
    const other = await fetch(`${base}/api/space/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gamerTag: "takenTag", passcode: "pw123456", name: "Other" }),
    });
    expect(((await other.json()) as { id: string }).id).toBeTruthy();
    const conflict = await patch(spaceId, { gamerTag: "takenTag" });
    expect(conflict.status).toBe(409);
    // A free tag works.
    const ok = await patch(spaceId, { gamerTag: "myFreshTag" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { gamerTag: string }).gamerTag).toBe("myFreshTag");
  });

  it("promotes a cluster into a constellation hub (MOC) with member links", async () => {
    const a = await post("/api/ingest", { text: "Notes on espresso extraction and grind size" });
    const b = await post("/api/ingest", { text: "Tasting log for a new single-origin roast" });
    const ids = [a.body.nodes[0].id as number, b.body.nodes[0].id as number];

    const { status, body } = await post("/api/constellations/promote", {
      name: "Coffee Craft",
      nodeIds: ids,
    });
    expect(status).toBe(200);
    expect(body.kind).toBe("moc");
    expect(body.type).toBe("moc");
    expect(body.label).toBe("Coffee Craft");
    expect(body.memberCount).toBe(2);
    expect(body.origin).toBe("agent"); // Soumaya authored the hub

    // The hub now exists in the graph and links to both members.
    const graph = (await get("/api/graph")).body as GraphData;
    const hub = graph.nodes.find((n) => n.label === "Coffee Craft");
    expect(hub?.kind).toBe("moc");
    const memberLinks = graph.links.filter(
      (l: any) => (typeof l.source === "object" ? l.source.id : l.source) === hub!.id,
    );
    expect(memberLinks.length).toBe(2);
  });

  it("rejects a constellation with fewer than two members", async () => {
    const a = await post("/api/ingest", { text: "a lone thought" });
    const { status } = await post("/api/constellations/promote", {
      name: "Too small",
      nodeIds: [a.body.nodes[0].id],
    });
    expect(status).toBe(400);
  });

  it("semantic search returns the relevant node with a similarity score", async () => {
    const { status, body } = await get(`/api/search?q=${encodeURIComponent("coffee subscription")}`);
    expect(status).toBe(200);
    // REG-186: the route returns the { hits, total, hasMore, totalCapped }
    // envelope now, not a bare array — the page is top-k and the envelope
    // says whether more matches exist.
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.hits.length).toBeGreaterThanOrEqual(1);
    expect(body.hits[0]).toHaveProperty("similarity");
    expect(body.hits[0].content.toLowerCase()).toContain("coffee");
    expect(typeof body.total).toBe("number");
    expect(typeof body.hasMore).toBe("boolean");
    expect(body.total).toBeGreaterThanOrEqual(body.hits.length);
  });

  it("returns a node's neighborhood subgraph", async () => {
    const graph = (await get("/api/graph")).body as GraphData;
    const id = graph.nodes[0]!.id;
    const { status, body } = await get(`/api/nodes/${id}/neighbors?depth=2`);
    expect(status).toBe(200);
    expect(body.nodes.some((n: { id: number }) => n.id === id)).toBe(true);
  });

  it("404s for an unknown node", async () => {
    const { status } = await get("/api/nodes/999999");
    expect(status).toBe(404);
  });

  it("earns fuel on ingest and exposes it", async () => {
    const before = (await get("/api/maintenance/fuel")).body.fuel as number;
    const r = await post("/api/ingest", { text: "a brand new reflection worth keeping" });
    expect(r.body.fuelEarned).toBeGreaterThan(0);
    const after = (await get("/api/maintenance/fuel")).body.fuel as number;
    expect(after).toBeGreaterThan(before);
  });

  it("a tend call resets a memory's entropy clock", async () => {
    const graph = (await get("/api/graph")).body as GraphData;
    const id = graph.nodes[0]!.id;
    const { status, body } = await post(`/api/nodes/${id}/tend`, {});
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("only discretionary expansion jobs burn fuel; core duties are free", async () => {
    const a = (await post("/api/ingest", { text: "fuel split memory alpha" })).body.nodes[0].id;
    const b = (await post("/api/ingest", { text: "fuel split memory beta" })).body.nodes[0].id;
    // Paid jobs require Research Mode on (complete-job re-checks the maintenance gate).
    await post("/api/maintenance/settings", { key: "research_enabled", value: "true" });

    // A CORE job (synthesis) must not spend fuel.
    const f0 = (await get("/api/maintenance/fuel")).body.fuel as number;
    await post("/api/maintenance/complete-job", { type: "synthesis", targets: [a, b] });
    const f1 = (await get("/api/maintenance/fuel")).body.fuel as number;
    expect(f1).toBe(f0);

    // An EXPANSION job (research) spends one job's worth of fuel.
    const rr = await post("/api/maintenance/complete-job", { type: "research", targets: [a] });
    expect(rr.status).toBe(200);
    const f2 = (await get("/api/maintenance/fuel")).body.fuel as number;
    expect(f2).toBeLessThan(f1);
  });

  it("complete-job can't drain the budget with Research Mode off (paid jobs are no-ops)", async () => {
    const a = (await post("/api/ingest", { text: "gate guard alpha" })).body.nodes[0].id;
    await post("/api/ingest", { text: "gate guard beta" });
    // Force Research Mode OFF (a prior test may have enabled this global toggle).
    await post("/api/maintenance/settings", { key: "research_enabled", value: "false" });
    // A crafted research call must not spend fuel or mutate.
    const f0 = (await get("/api/maintenance/fuel")).body.fuel as number;
    const rr = await post("/api/maintenance/complete-job", { type: "research", targets: [a] });
    expect(rr.status).toBe(200);
    expect(rr.body.ok).toBe(false); // no-op
    const f1 = (await get("/api/maintenance/fuel")).body.fuel as number;
    expect(f1).toBe(f0);
    // And the global settings route rejects any key other than research_enabled.
    const bad = await post("/api/maintenance/settings", { key: "usage_budget_usd", value: "0" });
    expect(bad.status).toBe(400);
  });

  it("codex-claim awards fuel once per key (idempotent, can't be farmed)", async () => {
    const f0 = (await get("/api/maintenance/fuel")).body.fuel as number;
    const first = await post("/api/maintenance/codex-claim", { key: "sector-person" });
    expect(first.status).toBe(200);
    expect(first.body.awarded).toBe(true);
    const f1 = (await get("/api/maintenance/fuel")).body.fuel as number;
    expect(f1).toBeGreaterThan(f0);
    // Claiming the same entry again is a no-op — no double reward.
    const again = await post("/api/maintenance/codex-claim", { key: "sector-person" });
    expect(again.body.awarded).toBe(false);
    const f2 = (await get("/api/maintenance/fuel")).body.fuel as number;
    expect(f2).toBe(f1);
    // Missing key and client-invented keys are rejected (no fuel-farming namespace).
    const bad = await post("/api/maintenance/codex-claim", {});
    expect(bad.status).toBe(400);
    const fake = await post("/api/maintenance/codex-claim", { key: "sector-invented-42" });
    expect(fake.status).toBe(400);
    // A constellation key must reference a real MOC hub in this space.
    const ghost = await post("/api/maintenance/codex-claim", { key: "constellation-999999" });
    expect(ghost.status).toBe(400);
  });

  it("earns fuel for building your Mind and capturing a manual thought", async () => {
    // Drain so the earn is observable under the higher earn rates (shared app near cap).
    ctx.handle.sqlite.prepare(`UPDATE space_meta SET fuel = 10`).run();
    const f0 = (await get("/api/maintenance/fuel")).body.fuel as number;
    const mind = await post("/api/cognitive", { kind: "goal", label: "Launch the studio" });
    expect(mind.status).toBe(200);
    expect(mind.body.fuelEarned).toBeGreaterThan(0);
    const f1 = (await get("/api/maintenance/fuel")).body.fuel as number;
    expect(f1).toBeGreaterThan(f0);

    // A manually captured thought earns a little; a system-seeded one does not.
    const t = await post("/api/working", { text: "remember to call the landlord", source: "manual" });
    expect(t.body.fuelEarned).toBeGreaterThan(0);
    const f2 = (await get("/api/maintenance/fuel")).body.fuel as number;
    expect(f2).toBeGreaterThan(f1);
    const sys = await post("/api/working", { text: "auto seeded", source: "emotion" });
    expect(sys.body.fuelEarned).toBe(0);
  });

  it("chat carries the thread and reads the emotional register (offline too)", async () => {
    // History is accepted alongside the question (she sees the recent turns).
    const r = await post("/api/chat", {
      question: "I'm scared about the repossession, it keeps me up at night",
      history: [
        { role: "you", text: "money has been tight lately" },
        { role: "soumaya", text: "I hear you — your Finance sector has been busy." },
      ],
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.answer).toBe("string");
    // The offline heuristic reads the heavy register: a concerned mood, and the
    // interview instinct asks back instead of bluffing on a weighty, thin topic.
    expect(r.body.mood).toBe("concerned");
    if (r.body.askBack !== undefined) expect(typeof r.body.askBack).toBe("string");
    // Malformed history is rejected by validation.
    const bad = await post("/api/chat", { question: "hi", history: [{ role: "them", text: "x" }] });
    expect(bad.status).toBe(400);
  });

  it("she never asks two turns in a row (no interrogation loop)", async () => {
    // Her previous turn already ended in a question → this reply MUST NOT ask
    // again, no matter how heavy/thin the topic (the loop the user hit).
    const r = await post("/api/chat", {
      question: "the repossession, losing the house, all of it",
      history: [
        { role: "you", text: "everything feels like it's falling apart" },
        { role: "soumaya", text: "What's the part of this that sits heaviest right now?" },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.askBack ?? "").toBe(""); // suppressed because she just asked
  });

  it("contradiction scan works OFFLINE (provider-aware similarity gate)", async () => {
    // The old flat 0.86 gate was unreachable with hash embeddings (measured
    // ~0.69 for this exact planted pair) — the scan silently found nothing.
    await post("/api/ingest", { text: "I love my job at the studio, it gives me purpose" });
    await post("/api/ingest", { text: "I hate my job at the studio and want to quit" });
    const r = await post("/api/digest/contradictions", {});
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body.length).toBeGreaterThan(0);
    expect(r.body[0].kind).toBe("contradiction");
    // The reconcile affordance clears it and warms both memories.
    const resolved = await post(`/api/digest/insights/${r.body[0].id}/resolve`, {});
    expect(resolved.status).toBe(200);
    const remaining = (await get("/api/digest")).body as { id: number }[];
    expect(remaining.some((i) => i.id === r.body[0].id)).toBe(false);
  });

  it("acknowledging a due reminder clears it from every digest surface", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const made = await post("/api/ingest", { text: "remember to renew the passport", remindAt: past });
    const id = made.body.nodes[0].id as number;
    let daily = (await get("/api/digest/daily")).body;
    expect(daily.reminders.some((r: any) => r.node.id === id)).toBe(true);
    const ack = await post(`/api/nodes/${id}/ack-reminder`, {});
    expect(ack.status).toBe(200);
    daily = (await get("/api/digest/daily")).body;
    expect(daily.reminders.some((r: any) => r.node.id === id)).toBe(false);
  });

  // Life Vision (docs/specs/life-vision.md, C2.1/C3.2-locked): a Vision's target date
  // must never enter the daily digest's due-reminders list — regression against the
  // exact spurious-reminder bug C2.1's remind_at audit flagged.
  it("a life_vision's target date never appears in the daily digest's due reminders", async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const vision = await post("/api/cognitive", { kind: "life_vision", label: "Our first house" });
    const id = vision.body.id as number;
    const patched = await patchReq(`/api/cognitive/${id}`, { date: past });
    expect(patched.status).toBe(200);

    const daily = (await get("/api/digest/daily")).body;
    expect(daily.reminders.some((r: any) => r.node.id === id)).toBe(false);
  });

  it("daily contact: she asks about a cooling important memory; answering feeds the brain", async () => {
    // Seed an important memory and backdate its tend clock so the ladder picks it.
    const seeded = await post("/api/ingest", { text: "my long-term dream of opening the studio" });
    const seedId = seeded.body.nodes[0].id as number;
    ctx.handle.sqlite
      .prepare(
        `UPDATE nodes SET importance = 0.8, last_tended_at = datetime('now','-20 days') WHERE id = ?`,
      )
      .run(seedId);
    // Force a rebuild of today's contact (it may have been built by an earlier test).
    ctx.handle.sqlite.prepare(`DELETE FROM daily_contact`).run();

    const c = await get("/api/contact");
    expect(c.status).toBe(200);
    expect(c.body.question).toBeTruthy();
    expect(c.body.answered).toBe(false);
    // Same question on a second read (persisted per day, not reshuffled).
    const c2 = await get("/api/contact");
    expect(c2.body.question.text).toBe(c.body.question.text);

    // This shared app has accrued fuel toward the cap across earlier tests (the higher
    // earn rates fill the 120 tank fast); drain it so answering's earn is observable.
    ctx.handle.sqlite.prepare(`UPDATE space_meta SET fuel = 10`).run();
    const f0 = (await get("/api/maintenance/fuel")).body.fuel as number;
    const a = await post("/api/contact/answer", { text: "still true — I signed the studio lease last week" });
    expect(a.status).toBe(200);
    expect(a.body.nodeIds.length).toBeGreaterThan(0);
    expect(a.body.fuelEarned).toBeGreaterThan(0);
    const f1 = (await get("/api/maintenance/fuel")).body.fuel as number;
    expect(f1).toBeGreaterThan(f0);
    // Marked answered for the rest of the day.
    const after = await get("/api/contact");
    expect(after.body.answered).toBe(true);
    // ROTATION: answering consumed the question (the cooling memory was tended),
    // so tomorrow's rebuild must NOT re-ask the same thing. Simulate the new day
    // by clearing today's row and rebuilding.
    ctx.handle.sqlite.prepare(`DELETE FROM daily_contact`).run();
    const tomorrow = await get("/api/contact");
    expect(tomorrow.body.question?.text ?? "").not.toBe(c.body.question.text);
  });
  // IM-26: the node PATCH route also edits label + body (the Details tab's
  // edit flow), not just importance.
  it("PATCH /api/nodes/:id edits label and content, and search finds the new text", async () => {
    // Use an existing node (this shared suite's ingest extractor dedupes fresh
    // seed texts unpredictably late in the run — the graph is the stable source).
    const graph = (await get("/api/graph")).body as GraphData;
    const id = graph.nodes[0]!.id;
    const patched = await patchReq(`/api/nodes/${id}`, { label: "Renamed by edit", content: "a body about zebrafish taxonomy" });
    expect(patched.status).toBe(200);
    expect(patched.body.label).toBe("Renamed by edit");
    expect(patched.body.content).toBe("a body about zebrafish taxonomy");
    // The stored row really changed (not just the response echo).
    const fetched = await get(`/api/nodes/${id}`);
    expect(fetched.body.label).toBe("Renamed by edit");
    // FTS was refreshed: the new body text is searchable, the old isn't the hit.
    const hits = await get(`/api/search?q=${encodeURIComponent("zebrafish")}`);
    expect(hits.body.hits.some((n: { id: number }) => n.id === id)).toBe(true);
  });

  it("PATCH /api/nodes/:id still adjusts importance alone, and rejects an empty patch", async () => {
    const graph = (await get("/api/graph")).body as GraphData;
    const id = graph.nodes[0]!.id;
    const patched = await patchReq(`/api/nodes/${id}`, { importance: 0.9 });
    expect(patched.status).toBe(200);
    expect(patched.body.importance).toBe(0.9);
    const empty = await patchReq(`/api/nodes/${id}`, {});
    expect(empty.status).toBe(400);
    const missing = await patchReq(`/api/nodes/999999`, { label: "nope" });
    expect(missing.status).toBe(404);
  });

});

describe("Batch L — MIN-01/MIN-06: cognitive route date-only writes and total shape", () => {
  it("POST life_vision with a date-only target stores it verbatim (no UTC-midnight instant)", async () => {
    const created = await post("/api/cognitive", { kind: "life_vision", label: "Sail the world", date: "2030-06-01" });
    expect(created.status).toBe(200);
    expect(created.body.remindAt).toBe("2030-06-01");
  });

  it("PATCH life_vision with a date-only target stores it verbatim", async () => {
    const created = await post("/api/cognitive", { kind: "life_vision", label: "Build the studio", date: "2030-06-01" });
    expect(created.status).toBe(200);
    const patched = await patchReq(`/api/cognitive/${created.body.id}`, { date: "2031-07-04" });
    expect(patched.status).toBe(200);
    expect(patched.body.remindAt).toBe("2031-07-04");
  });

  it("POST future_event still accepts a full ISO datetime", async () => {
    const created = await post("/api/cognitive", { kind: "future_event", label: "Launch party", date: "2030-06-01T10:00:00.000Z" });
    expect(created.status).toBe(200);
    expect(created.body.remindAt).toBe("2030-06-01T10:00:00.000Z");
  });

  it("POST rejects an unparseable date", async () => {
    const bad = await post("/api/cognitive", { kind: "life_vision", label: "Bad date", date: "not-a-date" });
    expect(bad.status).toBe(400);
  });

  it("GET /api/cognitive returns {items, total} with the total past the page", async () => {
    const listed = await get("/api/cognitive");
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.body.items)).toBe(true);
    expect(typeof listed.body.total).toBe("number");
    expect(listed.body.total).toBeGreaterThanOrEqual(listed.body.items.length);
    const goals = await get("/api/cognitive?kind=goal");
    expect(goals.body.items.every((i: { kind: string }) => i.kind === "goal")).toBe(true);
  });
});
