/**
 * Race-test child for relicBuffsV2.test.ts: opens its OWN connection to a
 * file DB, signals readiness, waits at a go-file barrier (deterministic —
 * no fixed sleeps), then claims ONE relic find through the real store.
 */
import { existsSync, writeFileSync } from "node:fs";
import { createDb } from "../db/client.js";
import { RelicHoldingsStore } from "../relics/holdings.js";

const [dbPath, spaceId, relicId, world, goFile, readyFile] = process.argv.slice(2);
const handle = createDb(dbPath!);
handle.sqlite.pragma("busy_timeout = 10000");
writeFileSync(readyFile!, "ready");
const deadline = Date.now() + 30_000;
const spin = new Int32Array(new SharedArrayBuffer(4));
while (!existsSync(goFile!)) {
  if (Date.now() > deadline) { console.log(JSON.stringify({ ok: false, error: "go-file timeout" })); process.exit(2); }
  Atomics.wait(spin, 0, 0, 5);
}
try {
  const result = new RelicHoldingsStore(handle).claimFind(spaceId!, relicId!, world!);
  console.log(JSON.stringify(result.ok ? { ok: true } : { ok: false, kind: (result as { kind?: string }).kind ?? "refused" }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
}
handle.sqlite.close();
