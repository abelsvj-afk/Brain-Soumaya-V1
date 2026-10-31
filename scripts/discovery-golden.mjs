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
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/** The commit the code was at before Phase 1 (docs-only commits after it do not change code). */
const PINNED_BASELINE = "257cdd244d0f6695d2bd9a2d03cbe211af3f1000";
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

const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

function generate() {
  const baselineCommit = git("rev-parse", "--verify", `${commit}^{commit}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-golden-"));
  const tree = path.join(tmp, "tree");
  git("worktree", "add", "--detach", tree, baselineCommit);
  try {
    // Third-party modules from the repo's node_modules; the workspace packages from the WORKTREE.
    const nm = path.join(tree, "node_modules");
    fs.mkdirSync(nm);
    for (const entry of fs.readdirSync(path.join(repo, "node_modules"))) {
      if (entry === "@brain") continue;
      fs.symlinkSync(path.join(repo, "node_modules", entry), path.join(nm, entry));
    }
    fs.mkdirSync(path.join(nm, "@brain"));
    for (const pkg of ["server", "shared", "web"]) fs.symlinkSync(path.join(tree, "packages", pkg), path.join(nm, "@brain", pkg));

    // The runner is copied in unchanged; the baseline does not have it.
    const dest = path.join(tree, RUNNER);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repo, RUNNER), dest);

    const entry = path.join(tree, "packages/server/golden-entry.ts");
    fs.writeFileSync(
      entry,
      `import { runParityFixtures } from "./src/__tests__/fixtures/discoveryParity.ts";\nprocess.stdout.write(JSON.stringify(runParityFixtures()));\n`,
    );
    const env = { ...process.env };
    delete env.OWNER_SPACE_IDS;
    const stdout = execFileSync(path.join(repo, "node_modules/.bin/tsx"), [entry], {
      cwd: path.join(tree, "packages/server"),
      env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "inherit"],
    });
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
  } finally {
    try {
      git("worktree", "remove", "--force", tree);
    } catch {
      /* the temp directory is removed below either way */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    try {
      git("worktree", "prune");
    } catch {
      /* nothing to prune */
    }
  }
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
