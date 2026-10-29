import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Same cwd-relative reader App.batchB.test.ts uses. */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

/**
 * Batch J — App-shell pins for the SearchBox session + hatch carry-through:
 *  REG-187 (SP-04) App holds the search session above the panel switch, so
 *  choosing a hit (which unmounts SearchBox) no longer destroys the query
 *  and its result set;
 *  REG-188 (SP-05) the brain-toast-action bridge carries the hatch query —
 *  chat gets it as the seed question, ingest gets it as the capture seed.
 */
describe("REG-187 — App lifts the search session above the panel switch", () => {
  it("App holds searchSession state and passes it to SearchBox with its setter", () => {
    const app = readRepoFile("src/App.tsx");
    expect(app).toContain("searchSession");
    expect(app).toMatch(/initialSession=\{searchSession\}/);
    expect(app).toMatch(/onSessionChange=\{setSearchSession\}/);
  });
});

describe("REG-188 — App carries the hatch query to chat and to capture", () => {
  it("a chat-kind action with a plain-text value seeds the chat question", () => {
    const app = readRepoFile("src/App.tsx");
    expect(app).toContain("chatSeed");
    expect(app).toMatch(/seedQuestion=\{chatSeed\}/);
    // The seed is consumed once: closing the dock clears it, so a later
    // FAB-opened chat never replays an old hatch query.
    expect(app).toMatch(/setChatSeed\(null\)/);
  });

  it("a panel-kind ingest action with text seeds the capture box", () => {
    const app = readRepoFile("src/App.tsx");
    expect(app).toMatch(/setIngestSeed\(\{\s*text:\s*a\.text\.trim\(\)/);
  });
});
