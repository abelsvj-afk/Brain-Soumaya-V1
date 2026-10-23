/**
 * Race-test child process (spawned in pairs by travel.test.ts): opens its
 * OWN connection to a file-backed DB, signals readiness, then waits at a
 * go-file barrier so both children fire together, then performs ONE
 * travel act through the real TravelRepo. The barrier is deterministic
 * (review 23): the parent releases the children only after BOTH ready
 * files exist — no fixed sleeps. Prints a single JSON line with the
 * outcome. Test tooling only — not imported by the application.
 */
import { existsSync, writeFileSync } from "node:fs";
import { createDb } from "../db/client.js";
import { TravelRepo } from "../repositories/travel.repo.js";

const [dbPath, spaceId, journeyId, action, goFile, readyFile, nowStr] = process.argv.slice(2);
const nowMs = Number(nowStr);

const handle = createDb(dbPath);
handle.sqlite.pragma("busy_timeout = 10000");

// Ready: connection open, about to wait. The parent confirms BOTH
// children's ready files before writing the go-file.
writeFileSync(readyFile, "ready");

const deadline = Date.now() + 30_000;
const spin = new Int32Array(new SharedArrayBuffer(4));
while (!existsSync(goFile)) {
  if (Date.now() > deadline) {
    console.log(JSON.stringify({ ok: false, error: "go-file timeout" }));
    process.exit(2);
  }
  Atomics.wait(spin, 0, 0, 5);
}

try {
  const repo = new TravelRepo(handle, spaceId);
  const j =
    action === "arrive"
      ? repo.arrive(journeyId, nowMs)
      : action === "turnBack"
        ? repo.turnBack(journeyId, nowMs)
        : repo.cancel(journeyId, nowMs);
  console.log(JSON.stringify({ ok: true, state: j?.state ?? null }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String(e) }));
}
handle.sqlite.close();
