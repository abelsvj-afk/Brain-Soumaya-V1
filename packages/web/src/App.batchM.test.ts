import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same cwd-relative reader App.batchB.test.ts uses (vitest's
 *  import.meta.url is not a file URL in this harness). */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

/**
 * Batch M — REG-159 (JN-01): the armed journey must die on brain switch.
 * App.tsx is not mounted by any harness in this repo, so the wiring is
 * pinned at the source seam (the App.batchB.test.ts pattern). The two
 * handlers that leave the current space — the switch-brain button and the
 * brain-deleted callback — must each disarm the chat: setShowChat(false)
 * (which also fires the existing showChat-false effect that clears the
 * pending journey) plus explicit pending-journey clears, so the dock can
 * never remount on the next login with the old journey armed and its stale
 * id resolving in the NEW space. The cleared-props ⇒ no-banner half of
 * the chain is proven behaviorally in ChatDock.batchM.test.tsx.
 */

const appSrc = readRepoFile("src/App.tsx");

function window_(src: string, from: string, len: number): string {
  const a = src.indexOf(from);
  expect(a, `anchor ${from}`).toBeGreaterThan(-1);
  return src.slice(a, a + len);
}

describe("REG-159 (JN-01) — brain switch disarms the armed journey", () => {
  it("the switch-brain button handler closes the chat and clears the pending journey", () => {
    const w = window_(appSrc, "— switch brain", 1100);
    expect(w).toContain("setShowChat(false)");
    expect(w).toContain("setPendingJourneyId(null)");
    expect(w).toContain("setPendingJourneyTitle(null)");
  });

  it("the brain-deleted handler closes the chat and clears the pending journey", () => {
    const w = window_(appSrc, "onBrainDeleted={() => {", 800);
    expect(w).toContain("setShowChat(false)");
    expect(w).toContain("setPendingJourneyId(null)");
    expect(w).toContain("setPendingJourneyTitle(null)");
  });
});
