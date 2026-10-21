import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { JourneysRepo } from "../repositories/journeys.repo.js";
import type { JourneyLinksDetail } from "@brain/shared";

/**
 * IM-87 (Round 1 honesty): GET /journeys/:id/links used to hydrate only the first
 * 20 links and the panel computed earned/spent over that truncated subset while
 * presenting them as the journey's totals. The endpoint must now report TRUE
 * totals (server aggregate over ALL links) plus the total count, while the
 * displayed list stays capped — and says so.
 */

let ctx: AppContext;
let server: Server;
let base: string;
let spaceId: string;

beforeAll(async () => {
  ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
  const app = createApp(ctx);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = await fetch(`${base}/api/space/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gamerTag: "linktotals", passcode: "secret123", name: "linktotals" }),
  });
  spaceId = ((await auth.json()) as { id: string }).id;
});
afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });

const getLinks = async (journeyId: number): Promise<JourneyLinksDetail> => {
  const res = await fetch(`${base}/api/journeys/${journeyId}/links`, { headers: { "x-space-id": spaceId } });
  expect(res.status).toBe(200);
  return (await res.json()) as JourneyLinksDetail;
};

function makeIncome(cents: number): number {
  return Number(
    ctx.handle.sqlite
      .prepare(`INSERT INTO fin_income (space_id, date, net_cents, platform) VALUES (?, '2026-01-01', ?, 'Gig')`)
      .run(spaceId, cents).lastInsertRowid,
  );
}
function makeExpense(cents: number): number {
  return Number(
    ctx.handle.sqlite
      .prepare(`INSERT INTO fin_expense (space_id, date, amount_cents, merchant) VALUES (?, '2026-01-01', ?, 'Shop')`)
      .run(spaceId, cents).lastInsertRowid,
  );
}

describe("GET /journeys/:id/links — IM-87 true totals", () => {
  it("reports earned/spent over ALL links when a journey has more than the 20-link display cap", async () => {
    const repo = new JourneysRepo(ctx.handle, spaceId);
    const journey = repo.create({ title: "Busy Journey" });
    // 15 income × $10.00 + 10 expense × $7.00 = 25 links — 5 past the display cap.
    for (let i = 0; i < 15; i++) repo.link(journey.id, "income", makeIncome(1000));
    for (let i = 0; i < 10; i++) repo.link(journey.id, "expense", makeExpense(700));

    const detail = await getLinks(journey.id);
    expect(detail.totalCount).toBe(25);
    // TRUE totals over all 25 links — pre-fix, totals were summed client-side over
    // the 20 shown rows and necessarily came out short of these numbers.
    expect(detail.earnedCents).toBe(15_000);
    expect(detail.spentCents).toBe(7_000);
    // Display stays capped, and the cap is disclosed via the payload itself.
    expect(detail.displayLimit).toBe(20);
    expect(detail.links.length).toBe(20);
  });

  it("totals are space-scoped and a deleted target stops contributing", async () => {
    const repo = new JourneysRepo(ctx.handle, spaceId);
    const journey = repo.create({ title: "Scoped Journey" });
    const keep = makeIncome(2500);
    const gone = makeIncome(9900);
    repo.link(journey.id, "income", keep);
    repo.link(journey.id, "income", gone);
    ctx.handle.sqlite.prepare(`DELETE FROM fin_income WHERE id = ?`).run(gone);

    const detail = await getLinks(journey.id);
    expect(detail.earnedCents).toBe(2500);
    expect(detail.totalCount).toBe(2); // the link row still exists; its money doesn't
  });
});
