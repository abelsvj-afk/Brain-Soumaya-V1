#!/usr/bin/env node
/**
 * Phase 1 rollback evidence (docs/specs/unified-discovery-architecture-2026-10-31.md §15, A6).
 *
 * 1. The CURRENT code makes a database that carries the new trust columns, with accepted, imported and NULL-trust rows.
 * 2. The PRE-Phase-1 code (a git worktree of the pinned baseline) opens a copy and uses it — reads, gates, a replay, a new find, a recall, a road.
 * 3. The CURRENT code does exactly the same on another copy. The two outputs must be identical, and the old code's new row must read back with NULL trust
 *    (it knows nothing of the new columns) while every other row keeps its trust metadata.
 * 4. A VACUUM INTO copy of the migrated database keeps the columns.
 *
 * Usage: node scripts/discovery-rollback-check.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { PINNED_BASELINE, withBaselineWorktree } from "./lib/baseline-worktree.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OPS = "packages/server/src/__tests__/fixtures/discoveryRollbackOps.ts";
const tsx = path.join(repo, "node_modules/.bin/tsx");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-rollback-"));
const fail = (m) => {
  console.error("FAIL:", m);
  process.exit(1);
};
const rows = (f) => {
  const db = new Database(f, { readonly: true });
  try {
    return db.prepare(`SELECT entry_id, found_at, source, trust, trust_at, trust_basis, recall_count FROM story_finds ORDER BY entry_id`).all();
  } finally {
    db.close();
  }
};

try {
  const base = path.join(tmp, "migrated.db");
  const forOld = path.join(tmp, "for-old.db");
  const forNew = path.join(tmp, "for-new.db");

  // 1. The current code prepares the migrated volume.
  const prep = path.join(repo, "packages/server/rollback-prep.tmp.ts");
  fs.writeFileSync(prep, `import { prepareMigratedDb } from "./src/__tests__/fixtures/discoveryRollbackOps.ts";\nprepareMigratedDb(${JSON.stringify(base)});\n`);
  try {
    execFileSync(tsx, [prep], { cwd: path.join(repo, "packages/server"), stdio: ["ignore", "inherit", "inherit"] });
  } finally {
    fs.rmSync(prep, { force: true });
  }
  for (const f of [forOld, forNew]) fs.copyFileSync(base, f);
  const start = rows(base);
  const trusts = Object.fromEntries(start.map((r) => [r.entry_id, r.trust]));
  if (trusts["relic.harbor-nail"] !== "accepted" || trusts["relic.mooring-ring"] !== "imported" || trusts["sight.second-seam"] !== null) fail(`prepared volume has the wrong trust mix: ${JSON.stringify(trusts)}`);

  // 2. The OLD code opens and uses it.
  const oldOut = withBaselineWorktree(repo, PINNED_BASELINE, [OPS], ({ baselineCommit, runTsx }) => {
    console.log(`old code: ${baselineCommit.slice(0, 7)}`);
    return JSON.parse(runTsx("rollback-entry.ts", `import { runOps } from "./src/__tests__/fixtures/discoveryRollbackOps.ts";\nprocess.stdout.write(JSON.stringify(runOps(${JSON.stringify(forOld)})));\n`));
  });

  // 3. The NEW code does the same on its own copy.
  const entry = path.join(repo, "packages/server/rollback-new.tmp.ts");
  fs.writeFileSync(entry, `import { runOps } from "./src/__tests__/fixtures/discoveryRollbackOps.ts";\nprocess.stdout.write(JSON.stringify(runOps(${JSON.stringify(forNew)})));\n`);
  let newOut;
  try {
    newOut = JSON.parse(execFileSync(tsx, [entry], { cwd: path.join(repo, "packages/server"), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  } finally {
    fs.rmSync(entry, { force: true });
  }

  if (JSON.stringify(oldOut) !== JSON.stringify(newOut)) {
    console.error("old:", JSON.stringify(oldOut, null, 1));
    console.error("new:", JSON.stringify(newOut, null, 1));
    fail("the previous release behaves differently from the current code on the migrated volume");
  }
  console.log(`OK  old and new code give identical results on the migrated volume (${Object.keys(newOut).length} operation groups)`);

  // The old code's new row carries no trust metadata; nothing else was disturbed.
  const afterOld = Object.fromEntries(rows(forOld).map((r) => [r.entry_id, r]));
  const k = afterOld["companion.dock-1"];
  if (!k || k.trust !== null || k.trust_at !== null || k.trust_basis !== null) fail(`a row written by the old code should read back with NULL trust: ${JSON.stringify(k)}`);
  for (const id of ["relic.harbor-nail", "relic.mooring-ring"]) {
    const before = start.find((r) => r.entry_id === id);
    const after = afterOld[id];
    if (before.trust !== after.trust || before.trust_at !== after.trust_at || before.trust_basis !== after.trust_basis) fail(`the old code disturbed the trust metadata of ${id}`);
  }
  console.log("OK  a row written by the old code reads back with NULL trust; accepted and imported rows keep their metadata");

  // 4. VACUUM INTO keeps the columns.
  const snap = path.join(tmp, "snapshot.db");
  const src = new Database(base);
  src.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
  src.close();
  const colsOf = (f) => {
    const db = new Database(f, { readonly: true });
    try {
      return db.prepare(`PRAGMA table_info(story_finds)`).all().map((c) => c.name);
    } finally {
      db.close();
    }
  };
  for (const c of ["trust", "trust_at", "trust_basis"]) if (!colsOf(snap).includes(c)) fail(`the VACUUM INTO copy lost the column ${c}`);
  if (JSON.stringify(rows(snap)) !== JSON.stringify(start)) fail("the VACUUM INTO copy has different rows");
  console.log("OK  a VACUUM INTO copy keeps the columns and every row");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
