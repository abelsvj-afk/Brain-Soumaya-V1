#!/usr/bin/env node
/**
 * Discovery parity golden master (docs/specs/unified-discovery-architecture-2026-10-31.md §15, P1-PAR).
 *
 * Checks out the PINNED baseline commit into a separate git worktree, runs the parity fixtures
 * (packages/server/src/__tests__/fixtures/discoveryParity.ts) against the OLD code, and writes the
 * outputs to a JSON golden file together with the commit hash and a checksum. The parity test then
 * recomputes the same outputs with the CURRENT code and compares them to this file — so the
 * comparison is never between two versions of the same changed logic.
 *
 * Usage:
 *   node scripts/discovery-golden.mjs            # (re)write the golden file from the pinned baseline
 *   node scripts/discovery-golden.mjs --check    # regenerate in a fresh worktree and confirm the committed file is byte-identical
 *   node scripts/discovery-golden.mjs --commit <sha> --out <file>
 *
 * The worktree gets its OWN packages/ (so the baseline's @brain/shared is used, not the current one);
 * only third-party modules are symlinked from the repo's node_modules. Nothing in the repo is modified
 * except the output file, and the worktree is removed afterwards.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_BASELINE, withBaselineWorktree } from "./lib/baseline-worktree.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = path.join(repo, "packages/server/src/__tests__/golden/discovery-parity.golden.json");
const RUNNER = "packages/server/src/__tests__/fixtures/discoveryParity.ts";

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const check = argv.includes("--check");
const commit = flag("--commit") ?? PINNED_BASELINE;
const out = path.resolve(flag("--out") ?? DEFAULT_OUT);

function generate() {
  return withBaselineWorktree(repo, commit, [RUNNER], ({ tree, baselineCommit, runTsx }) => {
    const stdout = runTsx(
      "golden-entry.ts",
      `import { runParityFixtures } from "./src/__tests__/fixtures/discoveryParity.ts";\nprocess.stdout.write(JSON.stringify(runParityFixtures()));\n`,
    );
    const payload = JSON.parse(stdout);
    const payloadSha256 = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    // Read statements the baseline issues against story_finds, extracted from the baseline's own source (used by the P1-SQL check).
    const readSql = new Set();
    for (const file of ["story/story.ts", "story/flavor.ts", "story/roads.ts", "repositories/travel.repo.ts"]) {
      const src = fs.readFileSync(path.join(tree, "packages/server/src", file), "utf8");
      for (const m of src.matchAll(/`([^`]*\bstory_finds\b[^`]*)`/g)) {
        const sql = m[1].replace(/\s+/g, " ").trim();
        if (/^SELECT\b/i.test(sql)) readSql.add(sql);
      }
    }
    return { baselineCommit, payloadSha256, baselineReadSql: [...readSql].sort(), payload };
  });
}

/** One fixture per line so a diff of the golden file is readable. */
function serialise(g) {
  const lines = Object.entries(g.payload).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return (
    `{\n "schema": 1,\n "generatedBy": "scripts/discovery-golden.mjs",\n "baselineCommit": ${JSON.stringify(g.baselineCommit)},\n "payloadSha256": ${JSON.stringify(g.payloadSha256)},\n` +
    ` "baselineReadSql": ${JSON.stringify(g.baselineReadSql, null, 1).replace(/\n/g, "\n ")},\n "payload": {\n${lines.join(",\n")}\n }\n}\n`
  );
}

const golden = generate();
const text = serialise(golden);
if (check) {
  const committed = fs.readFileSync(out, "utf8");
  if (committed !== text) {
    console.error(`NOT reproducible: a fresh worktree of ${golden.baselineCommit} produced different output than ${path.relative(repo, out)}`);
    process.exit(1);
  }
  console.log(`reproducible: byte-identical to ${path.relative(repo, out)} (baseline ${golden.baselineCommit}, sha256 ${golden.payloadSha256.slice(0, 12)}…)`);
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`wrote ${path.relative(repo, out)} from baseline ${golden.baselineCommit} (${Object.keys(golden.payload).length} fixtures, sha256 ${golden.payloadSha256.slice(0, 12)}…)`);
}
