/**
 * Race-test child for relicSampling.test.ts (Relics I-4, §8.1 #1 on the
 * sampling path): opens its OWN connection to a file DB, seeds its own
 * claim-start sample (server-stamp format, 6 s in the past — a completed
 * dwell), signals readiness, waits at a go-file barrier (deterministic —
 * no fixed sleeps), then claims through the real sampled claim service.
 */
import { existsSync, writeFileSync } from "node:fs";
import { createDb } from "../db/client.js";
import { RelicClaimService } from "../relics/claims.js";

const [dbPath, spaceId, relicId, world, anchorJson, goFile, readyFile, claimIdArg] = process.argv.slice(2);
const anchor = JSON.parse(anchorJson!) as [number, number, number];
const handle = createDb(dbPath!);
handle.sqlite.pragma("busy_timeout = 10000");
handle.sqlite
  .prepare(`INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES (?, ?, ?, ?, ?, 'claim-start', ?)`)
  .run(spaceId!, world!, anchor[0], anchor[1], anchor[2], new Date(Date.now() - 6000).toISOString());
writeFileSync(readyFile!, "ready");
const deadline = Date.now() + 30_000;
const spin = new Int32Array(new SharedArrayBuffer(4));
while (!existsSync(goFile!)) {
  if (Date.now() > deadline) { console.log(JSON.stringify({ ok: false, error: "go-file timeout" })); process.exit(2); }
  Atomics.wait(spin, 0, 0, 5);
}
try {
  const svc = new RelicClaimService(handle);
  const result = svc.claim(spaceId!, relicId!, claimIdArg ?? `race-${spaceId}`, anchor, world!);
  console.log(JSON.stringify(result.ok
    ? { ok: true, awarded: result.awarded, replayed: result.replayed, copyId: result.copyId }
    : { ok: false, kind: result.kind ?? "refused", replayed: result.replayed }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
}
handle.sqlite.close();
