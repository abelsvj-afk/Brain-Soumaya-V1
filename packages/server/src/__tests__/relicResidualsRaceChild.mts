/**
 * Race-test child for relicResiduals.test.ts (residuals sweep,
 * I-4 review P2-A/P2-B): opens its OWN connection to a file DB,
 * signals readiness, waits at a go-file barrier (deterministic —
 * no fixed sleeps), then acts in one mode:
 *   mode=award  → seeds its own claim-start (server stamp 6 s in
 *                 the past — a completed dwell) and performs ONE
 *                 valid sampled claim under the shared race key.
 *   mode=refuse → loops wrong-world claims under the SAME key:
 *                 every iteration walks recordOutcome's
 *                 read-check-replace path. If a racing award
 *                 commits inside that window, an unserialized
 *                 recordOutcome deletes the COMMITTED receipt and
 *                 installs its non-committed refusal instead.
 *   mode=prune  → floods scan samples for the claim space's world
 *                 (insert + prune-to-newest-20, exactly the shape
 *                 of the service's own insertSample), churning the
 *                 presence evidence window as hard as it can.
 *   mode=claim  → ONE sampled claim under the race key, relying on
 *                 the claim-start the parent seeded before the
 *                 barrier.
 */
import { existsSync, writeFileSync } from "node:fs";
import { createDb } from "../db/client.js";
import { RelicClaimService } from "../relics/claims.js";

const [dbPath, mode, spaceId, goFile, readyFile, anchorJson] = process.argv.slice(2);
const handle = createDb(dbPath!);
handle.sqlite.pragma("busy_timeout = 10000");
const anchor = JSON.parse(anchorJson!) as [number, number, number];
const KEY = "race-key";
if (mode === "award") {
  handle.sqlite
    .prepare(`INSERT INTO relic_position_samples (space_id, world, x, y, z, kind, received_at) VALUES (?, 'great-station', ?, ?, ?, 'claim-start', ?)`)
    .run(spaceId!, anchor[0], anchor[1], anchor[2], new Date(Date.now() - 6000).toISOString());
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
  if (mode === "award" || mode === "claim") {
    const result = svc.claim(spaceId!, "harbor-nail", KEY, anchor, "great-station");
    console.log(JSON.stringify(result.ok
      ? { ok: true, copyId: result.copyId }
      : { ok: false, kind: result.kind ?? "refused" }));
  } else if (mode === "refuse") {
    for (let i = 0; i < 400; i++) svc.claim(spaceId!, "harbor-nail", KEY, anchor, "deep-past");
    console.log(JSON.stringify({ done: true }));
  } else if (mode === "prune") {
    const ins = handle.sqlite.prepare(
      `INSERT INTO relic_position_samples (space_id, world, x, y, z, kind) VALUES (?, 'great-station', 0, 0, 0, 'scan')`,
    );
    const prune = handle.sqlite.prepare(
      `DELETE FROM relic_position_samples WHERE space_id = ? AND world = 'great-station' AND id NOT IN (
         SELECT id FROM relic_position_samples WHERE space_id = ? AND world = 'great-station' ORDER BY id DESC LIMIT 20)`,
    );
    const flood = handle.sqlite.transaction(() => {
      for (let i = 0; i < 50; i++) ins.run(spaceId!);
      prune.run(spaceId!, spaceId!);
    });
    const end = Date.now() + 3000;
    let n = 0;
    while (Date.now() < end) { flood(); n += 50; }
    console.log(JSON.stringify({ inserted: n }));
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
}
handle.sqlite.close();
