import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { buildContext, type AppContext } from "../context.js";
import { createApp } from "../api/server.js";
import { HashEmbeddingProvider } from "../embeddings/hash.js";
import { HeuristicProvider } from "../llm/heuristic.js";
import { EMBED_DIM } from "../db/vec.js";
import { reminderTool } from "../agent/tools/reminder.js";
import type { ToolContext } from "../agent/tools/types.js";

let ctx: AppContext; let server: Server; let base: string; let spaceId: string;
beforeAll(async () => {
  ctx = await buildContext({ dbPath: ":memory:", embeddings: new HashEmbeddingProvider(EMBED_DIM), llm: new HeuristicProvider() });
  const app = createApp(ctx);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const auth = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: "agenda", passcode: "secret123", name: "agenda" }) });
  spaceId = ((await auth.json()) as { id: string }).id;
});
afterAll(() => { server?.close(); ctx.handle.sqlite.close(); });
/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", "x-space-id": spaceId }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function makeAction(text = "buy the milk please"): Promise<number> {
  const { body } = await req("POST", "/api/ingest", { text, kind: "action", ttlHours: 24 });
  return body.nodes[0].id as number;
}

describe("IM-51 PATCH /api/nodes/:id/agenda", () => {
  it("reschedules an action's expiresAt and edits its label/content", async () => {
    const id = await makeAction();
    const when = new Date(Date.now() + 3 * 86400_000).toISOString();
    const { status, body } = await req("PATCH", `/api/nodes/${id}/agenda`, { label: "Buy oat milk", content: "from the shop", expiresAt: when });
    expect(status).toBe(200);
    expect(body.label).toBe("Buy oat milk");
    expect(body.content).toBe("from the shop");
    expect(body.expiresAt).toBe(when);
    const got = await req("GET", `/api/nodes/${id}`);
    expect(got.body.expiresAt).toBe(when);
  });
  it("snoozes a reminder by moving remindAt, and clears it with null", async () => {
    const { body: made } = await req("POST", "/api/ingest", { text: "remember to call the dentist", remindAt: new Date(Date.now() - 60_000).toISOString() });
    const id = made.nodes[0].id as number;
    const later = new Date(Date.now() + 3600_000).toISOString();
    const snoozed = await req("PATCH", `/api/nodes/${id}/agenda`, { remindAt: later });
    expect(snoozed.status).toBe(200);
    expect(snoozed.body.remindAt).toBe(later);
    const cleared = await req("PATCH", `/api/nodes/${id}/agenda`, { remindAt: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.remindAt ?? null).toBeNull();
  });
  it("rejects an empty patch and 404s an unknown node", async () => {
    const id = await makeAction("another task here");
    expect((await req("PATCH", `/api/nodes/${id}/agenda`, {})).status).toBe(400);
    expect((await req("PATCH", `/api/nodes/999999/agenda`, { label: "x" })).status).toBe(404);
  });
  it("is space-scoped: another space cannot reschedule this node", async () => {
    const id = await makeAction("private task here");
    const auth = await fetch(`${base}/api/space/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gamerTag: "otheragenda", passcode: "secret123", name: "other" }) });
    const other = ((await auth.json()) as { id: string }).id;
    const res = await fetch(`${base}/api/nodes/${id}/agenda`, { method: "PATCH", headers: { "Content-Type": "application/json", "x-space-id": other }, body: JSON.stringify({ label: "hijacked" }) });
    expect(res.status).toBe(404);
  });
});

// REG-140 (AG-01): a reminder that already fired must re-fire when snoozed
// or rescheduled — the firing tool only proposes reminder_fired_at IS NULL
// rows, so moving remind_at without clearing the fired state silently voids
// the reschedule. The web also surfaces the fired state (reminderFiredAt).
describe("REG-140 fired reminders re-arm on reschedule", () => {
  function makeFiredReminder(label = "fired reminder"): number {
    const info = ctx.handle.sqlite
      .prepare(
        `INSERT INTO nodes (space_id, label, type, content, remind_at, reminder_fired_at, fired_by_approval)
         VALUES (?, ?, 'event', ?, ?, ?, ?)`,
      )
      .run(
        spaceId,
        label,
        label,
        new Date(Date.now() - 3600_000).toISOString(),
        new Date(Date.now() - 3500_000).toISOString(),
        7,
      );
    return Number(info.lastInsertRowid);
  }
  const firedState = (id: number) =>
    ctx.handle.sqlite
      .prepare(`SELECT reminder_fired_at AS f, fired_by_approval AS a FROM nodes WHERE id = ?`)
      .get(id) as { f: string | null; a: number | null };
  const toolCtx = (now: number): ToolContext => ({ ctx, spaceId, now, notify: async () => {} });

  it("snoozing a fired reminder clears the fired state so detect() proposes it again", async () => {
    const id = makeFiredReminder();
    // A fired reminder is invisible to the firing tool before the fix.
    expect(reminderTool.detect(toolCtx(Date.now())).some((i) => i.args.nodeId === id)).toBe(false);
    const later = new Date(Date.now() + 3600_000).toISOString();
    const { status, body } = await req("PATCH", `/api/nodes/${id}/agenda`, { remindAt: later });
    expect(status).toBe(200);
    expect(body.remindAt).toBe(later);
    expect(body.reminderFiredAt ?? null).toBeNull();
    const st = firedState(id);
    expect(st.f).toBeNull();
    expect(st.a).toBeNull();
    // At the new time the firing tool proposes it again.
    expect(reminderTool.detect(toolCtx(Date.now() + 3600_000 + 1000)).some((i) => i.args.nodeId === id)).toBe(true);
  });

  it("editing a fired reminder's label without moving remindAt leaves the fired state alone", async () => {
    const id = makeFiredReminder();
    const { status } = await req("PATCH", `/api/nodes/${id}/agenda`, { label: "renamed fired reminder" });
    expect(status).toBe(200);
    expect(firedState(id).f).not.toBeNull();
    expect(reminderTool.detect(toolCtx(Date.now())).some((i) => i.args.nodeId === id)).toBe(false);
  });

  it("pre-fire snooze still works and leaves the fired state clear", async () => {
    const { body: made } = await req("POST", "/api/ingest", { text: "remember to call the dentist soon", remindAt: new Date(Date.now() + 3600_000).toISOString() });
    const id = made.nodes[0].id as number;
    const later = new Date(Date.now() + 7200_000).toISOString();
    const { status, body } = await req("PATCH", `/api/nodes/${id}/agenda`, { remindAt: later });
    expect(status).toBe(200);
    expect(body.remindAt).toBe(later);
    expect(firedState(id).f).toBeNull();
  });

  it("acknowledging a fired reminder clears its fired state", async () => {
    const id = makeFiredReminder();
    const { status } = await req("POST", `/api/nodes/${id}/ack-reminder`);
    expect(status).toBe(200);
    expect(firedState(id).f).toBeNull();
    expect(firedState(id).a).toBeNull();
  });

  it("clearing remindAt on a fired reminder also clears the fired state", async () => {
    const id = makeFiredReminder();
    const { status } = await req("PATCH", `/api/nodes/${id}/agenda`, { remindAt: null });
    expect(status).toBe(200);
    expect(firedState(id).f).toBeNull();
    expect(firedState(id).a).toBeNull();
  });
});
