/**
 * Race-test child for relicStirrings.test.ts (Relics I-5, §8.1 #1
 * re-proven on the UNIFIED claim core): opens its OWN connection to a
 * file DB, signals readiness, waits at a go-file barrier
 * (deterministic — no fixed sleeps), then claims harbor-nail through
 * the unified core in relics/claims.ts as one claimer kind:
 *   mode=npc    → RelicClaimService.claimForNpc (the NPC loop's entry)
 *   mode=player → RelicClaimService.claim (the sampled player claim;
 *                 the child seeds its own claim-start sample with a
 *                 server-stamp 6 s in the past — a completed dwell)
 * Exactly one racer may win the pool's last copy, whichever kind it is.
 */
import { existsSync, writeFileSync } from "node:fs";
import { createDb } from "../db/client.js";
import { RelicClaimService } from "../relics/claims.js";

const [dbPath, mode, spaceId, goFile, readyFile, anchorJson] = process.argv.slice(2);
const handle = createDb(dbPath!);
handle.sqlite.pragma("busy_timeout = 10000");
if (mode === "player") {
  const anchor = JSON.parse(anchorJson!) as [number, number, number];
  handle.sqlite
    .prepare(`INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES (?, ?, ?, ?, ?, 'claim-start', ?)`)
    .run(spaceId!, "great-station", anchor[0], anchor[1], anchor[2], new Date(Date.now() - 6000).toISOString());
}
writeFileSync(readyFile!, "ready");
const deadline = Date.now() + 30_000;
const spin = new Int32Array(new SharedArrayBuffer(4));
while (!existsSync(goFile!)) {
  if (Date.now() > deadline) { console.log(JSON.stringify({ ok: false, error: "go-file timeout" })); process.exit(2); }
  Atomics.wait(spin, 0, 0, 5);
}
try {
  const svc = new RelicClaimService(handle);
  if (mode === "npc") {
    const result = svc.claimForNpc(spaceId!, "harbor-controller", "great-station", "harbor-nail");
    console.log(JSON.stringify(result.status === "awarded"
      ? { ok: true, status: result.status, copyId: result.copyId }
      : { ok: false, status: result.status }));
  } else {
    const anchor = JSON.parse(anchorJson!) as [number, number, number];
    const result = svc.claim(spaceId!, "harbor-nail", `race-${spaceId}`, anchor, "great-station");
    console.log(JSON.stringify(result.ok
      ? { ok: true, status: "awarded", copyId: result.copyId }
      : { ok: false, status: result.kind ?? "refused" }));
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
}
handle.sqlite.close();
