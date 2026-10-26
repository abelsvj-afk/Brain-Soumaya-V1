import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same cwd-relative reader App.batchB.test.ts uses (vitest's import.meta.url
 *  is not a file URL in this harness). */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

/**
 * Batch H — App-level items proven at the source seam (App.tsx is not mounted
 * by any harness in this repo; its wiring is pinned textually, the same pattern
 * App.batchB.test.ts uses):
 *  REG-207 openLens force-includes missing bodies via the existing
 *        getGraphWithCompletion/includeIds machinery before isolating, so an
 *        isolated lens/view shows all of its matches, not just the payload's
 *        intersection — and the banner states the match count (with the shown
 *        subset when the match list itself was capped).
 */
const appSrc = readRepoFile("src/App.tsx");

function window_(src: string, from: string, len: number): string {
  const a = src.indexOf(from);
  expect(a, `anchor ${from}`).toBeGreaterThan(-1);
  return src.slice(a, a + len);
}

describe("REG-207 — openLens force-includes missing bodies before isolating (CN-08)", () => {
  it("openLens fetches the ids missing from the loaded payload, then isolates", () => {
    const w = window_(appSrc, "const openLens = useCallback(", 1600);
    expect(w).toContain("getGraphWithCompletion");
    expect(w).toContain("isolateSet");
    // The force-include runs BEFORE the isolate — the bodies must exist in
    // the payload by the time the cluster is set.
    expect(w.indexOf("getGraphWithCompletion")).toBeLessThan(w.indexOf("isolateSet"));
    // Only the missing ids are fetched, not the whole match list again.
    expect(w).toMatch(/missing/i);
    // A failed force-include is disclosed, not swallowed into a partial view.
    expect(w).toMatch(/Couldn't load/i);
  });

  it("openLens carries the lens's true match total into the banner state", () => {
    const w = window_(appSrc, "const openLens = useCallback(", 1600);
    expect(w).toMatch(/total/);
    expect(w).toContain("setActiveLens");
  });

  it("the lens banner states the match count, and the shown subset when capped", () => {
    const w = window_(appSrc, "lens-banner", 900);
    expect(w).toContain("activeLens");
    expect(w).toMatch(/match/i);
    expect(w).toMatch(/showing first/i);
  });

  it("exitLens clears the banner's count state with the lens", () => {
    const w = window_(appSrc, "const exitLens = useCallback(", 600);
    expect(w).toContain("setActiveLens(null)");
    expect(w).toMatch(/setActiveLens(Count|Total|Shown)\(null\)/);
  });
});
