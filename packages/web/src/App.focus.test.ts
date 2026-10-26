import { describe, it, expect, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { GraphData, GraphNode } from "@brain/shared";
import { mergeGraphData } from "./App.helpers.js";
// Namespace access for the new helper: on the pre-fix tree it is absent
// (undefined), so the tests below fail individually instead of taking the
// whole file down at import — the same pattern App.helpers.test.ts uses.
import * as helpers from "./App.helpers.js";

/** Same cwd-relative reader App.batchB.test.ts uses (vitest's
 *  import.meta.url is not a file URL in this harness). */
function readRepoFile(rel: string): string {
  const candidates = [resolve(process.cwd(), rel), resolve(process.cwd(), "packages/web", rel)];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`cannot find ${rel}`);
}

/**
 * SP-01 / REG-184 — Search (and the palette, Recall, Observatory, and
 * NoticingCard chips) presents ids from the FULL node set, but `goTo`
 * searched only the loaded top-300-by-degree overview payload and silently
 * returned for anything outside it. The fix resolves the target through
 * the existing getGraph(limit, includeIds) machinery at the shared
 * goTo/focus level, and says so visibly when the node cannot be loaded.
 *
 * Fixture mirrors the hunt's reproduction (deploy-tip-hunt §3.5): a
 * >300-node brain where the overview cut drops the target orphan.
 */
function makeNode(id: number, label: string, degree = 0): GraphNode {
  return { id, label, type: "concept", content: label, kind: "memory", degree, createdAt: "2026-01-01T00:00:00.000Z" };
}

function makePayload(): GraphNode[] {
  // 300 nodes in the loaded overview: 290 chained hubs + the 10
  // highest-id orphans — the top-300 by degree, as overview(300) ships.
  const nodes: GraphNode[] = [];
  for (let i = 1; i <= 290; i++) nodes.push(makeNode(i, `Hub memory ${i}`, 5));
  for (let i = 291; i <= 300; i++) nodes.push(makeNode(i, `Orphan ${i}`, 0));
  return nodes;
}

const ORPHAN_ID = 301;
const ORPHAN_LABEL = "ZebraQuixotic Orphan";

describe("resolveFocusNode — SP-01 focus force-include", () => {
  it("returns the in-payload node with no fetch", async () => {
    const payload = makePayload();
    const fetchIncluding = vi.fn(async (_ids: number[]): Promise<GraphData> => ({ nodes: [], links: [] }));
    const { node, fetched } = await helpers.resolveFocusNode(payload, 42, fetchIncluding);
    expect(node).toBe(payload.find((n) => n.id === 42));
    expect(fetched).toBeNull();
    expect(fetchIncluding).not.toHaveBeenCalled();
  });

  it("force-includes an off-payload orphan via the include-ids fetch", async () => {
    const payload = makePayload();
    const orphan = makeNode(ORPHAN_ID, ORPHAN_LABEL, 0);
    const fetchIncluding = vi.fn(async (ids: number[]): Promise<GraphData> => {
      // The server side of the contract: overview(limit, includeIds) unions
      // the top-300 with byIds(includeIds) — the requested id comes back
      // even though it is outside the degree-ordered cut.
      expect(ids).toEqual([ORPHAN_ID]);
      return { nodes: [...payload, orphan], links: [] };
    });
    const { node, fetched } = await helpers.resolveFocusNode(payload, ORPHAN_ID, fetchIncluding);
    expect(fetchIncluding).toHaveBeenCalledTimes(1);
    expect(node).toBe(orphan);
    expect(fetched).not.toBeNull();
    // The goTo merge step lands the fetched node in the payload, so the
    // very next focus of the same id needs no second fetch.
    const merged = mergeGraphData({ nodes: payload, links: [] }, fetched!);
    expect(merged.nodes.find((n) => n.id === ORPHAN_ID)?.label).toBe(ORPHAN_LABEL);
    const again = await helpers.resolveFocusNode(merged.nodes, ORPHAN_ID, fetchIncluding);
    expect(again.node?.id).toBe(ORPHAN_ID);
    expect(fetchIncluding).toHaveBeenCalledTimes(1);
  });

  it("returns null when the server cannot produce the id (deleted / archived / foreign space)", async () => {
    const payload = makePayload();
    const fetchIncluding = vi.fn(async (_ids: number[]): Promise<GraphData> => {
      // overview() skips unknown ids silently — the id simply is not there.
      return { nodes: payload, links: [] };
    });
    const { node, fetched } = await helpers.resolveFocusNode(payload, 999, fetchIncluding);
    expect(fetchIncluding).toHaveBeenCalledWith([999]);
    expect(node).toBeNull();
    expect(fetched).toBeNull();
  });

  it("propagates a fetch failure so the caller can distinguish 'couldn't load' from 'doesn't exist'", async () => {
    const payload = makePayload();
    const fetchIncluding = vi.fn(async (_ids: number[]): Promise<GraphData> => {
      throw new Error("galaxy didn't load");
    });
    await expect(helpers.resolveFocusNode(payload, ORPHAN_ID, fetchIncluding)).rejects.toThrow(
      "galaxy didn't load",
    );
  });
});

describe("App.tsx goTo wiring — SP-01 (textual pins; App is not mounted by any harness)", () => {
  const appSrc = readRepoFile("src/App.tsx");

  it("goTo resolves through resolveFocusNode instead of the silent early return", () => {
    const start = appSrc.indexOf("const goTo = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const w = appSrc.slice(start, start + 5000);
    expect(w).toContain("resolveFocusNode(view.nodes, id");
    expect(w).toContain("getGraphWithCompletion(ids)");
    // The defect, verbatim: a bare find + silent return must be gone.
    expect(w).not.toContain("if (!n) return;");
    expect(w).toContain("return true;");
    expect(w).toContain("return false;");
  });

  it("an unrecoverable focus says so visibly instead of no-op-ing", () => {
    const start = appSrc.indexOf("const goTo = useCallback(");
    const w = appSrc.slice(start, start + 5000);
    expect(w).toContain("Couldn't open that memory — it may have been deleted or archived.");
    expect(w).toContain("Couldn't open that memory — the galaxy didn't load. Try again.");
  });

  it("the palette closes only once the jump actually landed", () => {
    const start = appSrc.indexOf("<CommandPalette");
    expect(start).toBeGreaterThan(-1);
    const w = appSrc.slice(start, start + 800);
    expect(w).toContain("void focus(id).then((ok) => {");
    expect(w).toContain("if (ok) setShowPalette(false);");
    // No unconditional close-before-focus remains on this handler.
    expect(w).not.toMatch(/setShowPalette\(false\);\s*\n\s*focus\(id\);/);
  });
});
