import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { setPreference } from "../agent/notify/policy.js";
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
    // +3 calendar days in the space zone: 72 h is only that when no DST change falls in the window (it read 2
    // across the US fall-back), so shift by the zone's offset change.
    const offsetMin = (t: number) => {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" }).formatToParts(t).find((x) => x.type === "timeZoneName")!.value;
      const m = /GMT([+-])(\d{2}):(\d{2})/.exec(p);
      return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
    };
    const t3 = Date.now() + 3 * 86_400_000;
    const soon = new Date(t3 - (offsetMin(t3) - offsetMin(Date.now())) * 60_000).toISOString();
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const a = await createCognitive(ctx, "legacy", "future_event", "Dentist", "", { date: soon });
    const b = await createCognitive(ctx, "legacy", "future_event", "Deadline", "", { date: past });

    const up = upcomingEvents(ctx, "legacy");
    expect(up.map((e) => e.id)).toEqual([b, a]); // soonest (past) first
    // Exactly +3 calendar days: the old elapsed-24h truncation also gave 3
    // here, so this pins the value instead of tolerating it (>= 2 let the
    // bug hide — a calendar-correct +3d 10h fixture would have read 3).
    expect(up.find((e) => e.id === a)!.inDays).toBe(3);

    expect(rollPastEvents(ctx, "legacy")).toBe(1);
    expect(kindOf(b)).toBe("memory"); // the past-due event became history
    expect(kindOf(a)).toBe("future_event"); // the upcoming one is untouched
  });

  it("inDays is the space-local calendar-day difference, not elapsed 24h blocks (CHR-02)", async () => {
    // Space zone: America/New_York. Freeze at Sat 2026-10-24 15:00 EDT.
    handle.sqlite.prepare(`INSERT OR IGNORE INTO space_meta (space_id) VALUES (?)`).run("legacy");
    setPreference(handle.sqlite, "legacy", "timezone", "America/New_York");
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-24T19:00:00.000Z"));
      const tomorrowMorning = await createCognitive(ctx, "legacy", "future_event", "Dentist tomorrow 9am", "", {
        date: "2026-10-25T13:00:00.000Z", // 09:00 EDT Oct 25 — only 18h away
      });
      const yesterdayEvening = await createCognitive(ctx, "legacy", "future_event", "Call yesterday evening", "", {
        date: "2026-10-23T23:00:00.000Z", // 19:00 EDT Oct 23 — only 20h ago
      });
      const tonight = await createCognitive(ctx, "legacy", "future_event", "Tonight", "", {
        date: "2026-10-25T00:00:00.000Z", // 20:00 EDT Oct 24 — same local day
      });
      const threeDaysTenHours = await createCognitive(ctx, "legacy", "future_event", "In 3d 10h", "", {
        date: "2026-10-28T05:00:00.000Z", // 01:00 EDT Oct 28 — 3d 10h away
      });
      const bareDate = await createCognitive(ctx, "legacy", "future_event", "Bare date tomorrow", "", {
        date: "2026-10-25", // a bare date IS that space-local date, never re-zoned
      });
      const up = upcomingEvents(ctx, "legacy");
      const inDays = (id: number) => up.find((e) => e.id === id)!.inDays;
      // The old elapsed-24h truncation gave 0, 0, 0, 3, 0 for these fixtures.
      expect(inDays(tomorrowMorning)).toBe(1);
      expect(inDays(yesterdayEvening)).toBe(-1);
      expect(inDays(tonight)).toBe(0);
      expect(inDays(threeDaysTenHours)).toBe(4);
      expect(inDays(bareDate)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
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
