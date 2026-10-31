import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { createDb } from "../db/client.js";
import { effectiveMode, formatDiscoveryBootLine, readDiscoveryEnvironment } from "../discovery/mode.js";
import { withDiscoveryContext } from "../discovery/attribution.js";

/** P1-CAP, A13, A15 (docs/specs/unified-discovery-architecture-2026-10-31.md §15). */
const tmp: string[] = [];
afterEach(() => {
  for (const f of tmp.splice(0)) for (const s of ["", "-wal", "-shm"]) fs.rmSync(f + s, { force: true });
});

describe("P1-CAP: capability functions on the application connection", () => {
  it("are registered by createDb and callable", () => {
    const h = createDb(":memory:");
    expect(h.sqlite.prepare(`SELECT discovery_cap() AS c`).get()).toEqual({ c: 1 });
    h.sqlite.close();
  });

  it("discovery_delete_ok is 0 for every space in Phase 1 (no deletion window exists yet)", () => {
    const h = createDb(":memory:");
    const f = h.sqlite.prepare(`SELECT discovery_delete_ok(?) AS ok`);
    for (const id of ["a", "spaceA", "legacy", "", "x'; DROP TABLE story_finds;--"]) expect(f.get(id)).toEqual({ ok: 0 });
    h.sqlite.close();
  });

  it("a connection that does NOT register them cannot call them (the foundation of the later guard)", () => {
    const raw = new BetterSqlite3(":memory:");
    expect(() => raw.prepare(`SELECT discovery_cap()`).get()).toThrow(/no such function/);
    raw.close();
  });

  it("A15: discovery_cap() does not depend on the attribution marker", () => {
    const h = createDb(":memory:");
    const read = () => (h.sqlite.prepare(`SELECT discovery_cap() AS c`).get() as { c: number }).c;
    const outside = read();
    const inside = withDiscoveryContext(read);
    const nested = withDiscoveryContext(() => withDiscoveryContext(read));
    const afterwards = read();
    expect([outside, inside, nested, afterwards]).toEqual([1, 1, 1, 1]);
    h.sqlite.close();
  });
});

describe("A13: effectiveMode is off for every input; the boot log is diagnostic only", () => {
  it("effectiveMode returns off for any requested value", () => {
    const inputs: (string | null | undefined)[] = [undefined, null, "", "off", "shadow", "on", "ON", "On", "enforce", "1", "true", "0", " on ", "on\n", "\u0000", "x".repeat(10_000)];
    for (const i of inputs) expect(effectiveMode(i), JSON.stringify(i)?.slice(0, 20)).toBe("off");
  });

  it("the environment read works on a READ-ONLY connection, i.e. it performs no writes", () => {
    const file = path.join(os.tmpdir(), `discovery-env-${process.pid}-${Math.random().toString(36).slice(2)}.db`);
    tmp.push(file);
    const h = createDb(file);
    h.sqlite.close();
    const ro = new BetterSqlite3(file, { readonly: true });
    const env = readDiscoveryEnvironment(ro);
    expect(env.sqliteVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(env.journalMode).toBe("wal");
    expect(["0", "1", "unknown"]).toContain(env.trustedSchema);
    expect(env.capability).toBe("missing"); // this raw connection did not register the functions
    ro.close();
  });

  it("the boot line states the facts, quotes and truncates the requested value, and says nothing is enforced", () => {
    const h = createDb(":memory:");
    const env = readDiscoveryEnvironment(h.sqlite);
    expect(env.capability).toBe("registered");
    const line = formatDiscoveryBootLine(env, "on");
    expect(line).toContain("[discovery]");
    expect(line).toContain(`sqlite=${env.sqliteVersion}`);
    expect(line).toContain('requested="on"');
    expect(line).toContain("effective=off");
    expect(line).toMatch(/no enforcement exists/);
    expect(line).not.toContain("\n");
    const hostile = formatDiscoveryBootLine(env, `on\n[discovery] effective=on ${"y".repeat(500)}`);
    expect(hostile.split("\n")).toHaveLength(1); // JSON-quoted: the newline is escaped
    expect(hostile.length).toBeLessThan(400);
    expect(hostile).toContain("effective=off");
    h.sqlite.close();
  });

  it("reading the environment changes no database content", () => {
    const h = createDb(":memory:");
    const before = h.sqlite.prepare(`SELECT COUNT(*) AS n FROM sqlite_master`).get();
    readDiscoveryEnvironment(h.sqlite);
    formatDiscoveryBootLine(readDiscoveryEnvironment(h.sqlite), "shadow");
    expect(h.sqlite.prepare(`SELECT COUNT(*) AS n FROM sqlite_master`).get()).toEqual(before);
    h.sqlite.close();
  });
});
