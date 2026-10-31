/**
 * Runs code against the PRE-Phase-1 baseline commit in an isolated git worktree
 * (docs/specs/unified-discovery-architecture-2026-10-31.md §15). The worktree gets its OWN packages/
 * (so the baseline's @brain/shared is used, not the current one); only third-party modules are
 * symlinked from the repo's node_modules. Nothing in the repo is modified; the worktree is removed afterwards.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The commit the code was at before Phase 1 (docs-only commits after it do not change code). */
export const PINNED_BASELINE = "257cdd244d0f6695d2bd9a2d03cbe211af3f1000";

export function git(repo, ...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

/**
 * @param {string} repo repo root
 * @param {string} commit commit to check out
 * @param {string[]} copyFiles repo-relative files to copy into the worktree unchanged (they do not exist at the baseline)
 * @param {(ctx: { tree: string, baselineCommit: string, runTsx: (entryName: string, code: string, opts?: { env?: Record<string,string|undefined>, args?: string[] }) => string }) => T} fn
 */
export function withBaselineWorktree(repo, commit, copyFiles, fn) {
  const baselineCommit = git(repo, "rev-parse", "--verify", `${commit}^{commit}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "discovery-baseline-"));
  const tree = path.join(tmp, "tree");
  git(repo, "worktree", "add", "--detach", tree, baselineCommit);
  try {
    const nm = path.join(tree, "node_modules");
    fs.mkdirSync(nm);
    for (const entry of fs.readdirSync(path.join(repo, "node_modules"))) {
      if (entry === "@brain") continue;
      fs.symlinkSync(path.join(repo, "node_modules", entry), path.join(nm, entry));
    }
    fs.mkdirSync(path.join(nm, "@brain"));
    for (const pkg of ["server", "shared", "web"]) fs.symlinkSync(path.join(tree, "packages", pkg), path.join(nm, "@brain", pkg));
    for (const f of copyFiles) {
      const dest = path.join(tree, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(repo, f), dest);
    }
    const runTsx = (entryName, code, opts = {}) => {
      const entry = path.join(tree, "packages/server", entryName);
      fs.writeFileSync(entry, code);
      const env = { ...process.env, ...(opts.env ?? {}) };
      delete env.OWNER_SPACE_IDS;
      return execFileSync(path.join(repo, "node_modules/.bin/tsx"), [entry, ...(opts.args ?? [])], {
        cwd: path.join(tree, "packages/server"),
        env,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "inherit"],
      });
    };
    return fn({ tree, baselineCommit, runTsx });
  } finally {
    try {
      git(repo, "worktree", "remove", "--force", tree);
    } catch {
      /* the temp directory is removed below either way */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    try {
      git(repo, "worktree", "prune");
    } catch {
      /* nothing to prune */
    }
  }
}
