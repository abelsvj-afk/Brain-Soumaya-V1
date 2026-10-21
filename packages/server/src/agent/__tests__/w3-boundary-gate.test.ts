/**
 * W3 Milestone 2 — Phase F mechanical grep gate (§6.1 / plan Phase F),
 * encoded as a test so it cannot regress silently.
 *
 * Rule: after normalizing whitespace and stripping comments, no
 * `UPDATE user_model` / `INSERT INTO user_model` statement may appear
 *   (a) anywhere in packages/server/src/agent/consolidation/ outside the
 *       marked write zones of boundary.ts (the zones hold the small
 *       applier bodies that only applyConsolidationMutation calls), or
 *   (b) in userModel.ts outside the authorized non-W3 writers
 *       (recordStated, correctUserModel + its writeExplicitConstraint
 *       helper, updateUserModel) — in particular NOT in
 *       sweepStaleEmotions / sweepWithdrawnEvidence or any helper they
 *       could hide behind (any other function appearing with a write
 *       fails this test by name), or
 *   (c) in episodic.ts outside the §8.6-sanctioned forget flow
 *       (Package E6, 2026-10-21: the W3 design sanctions THREE writers —
 *       the consolidation boundary, the validated W2 APIs, and the forget
 *       flow in episodic.ts; the gate originally scanned only the first
 *       two scopes, so the forget flow held by discipline, not
 *       enforcement). episodic.ts writes must appear ONLY inside
 *       applyForgetRequest AND match one of the two vetted statement
 *       shapes exactly (suspension on sole-evidence withdrawal; evidence
 *       pruning) — the scope's scan also covers DELETE FROM user_model,
 *       so any new UPDATE/INSERT/DELETE shape fails by name.
 *
 * Implementation: the TypeScript compiler AST is used instead of raw
 * text regex, which makes the scan immune to comments (a comment
 * mentioning the SQL cannot false-positive) and to formatting; string
 * and template literals are matched with whitespace collapsed, so
 * line-wrapping a statement cannot evade it.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const agentDir = path.resolve(here, "..");
const consolidationDir = path.join(agentDir, "consolidation");
const boundaryFile = path.join(consolidationDir, "boundary.ts");
const userModelFile = path.join(agentDir, "userModel.ts");
const episodicFile = path.join(agentDir, "episodic.ts");

const WRITE_RE = /\b(update\s+user_model|insert\s+into\s+user_model)\b/i;
/** The episodic scope additionally covers DELETE (E6): the forget flow is
 *  a sanctioned writer, so a user_model DELETE appearing there must fail
 *  exactly like an unvetted UPDATE/INSERT would. */
const WRITE_OR_DELETE_RE = /\b(update\s+user_model|insert\s+into\s+user_model|delete\s+from\s+user_model)\b/i;

interface WriteSite {
  file: string;
  /** Enclosing TOP-LEVEL function name, or null for module scope. */
  fn: string | null;
  /** Character offset of the literal in the source. */
  pos: number;
  snippet: string;
  /** Full whitespace-collapsed literal text (for exact-shape matching). */
  normalized: string;
}

function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) out += " ? " + span.literal.text;
    return out;
  }
  return null;
}

function enclosingTopLevelFunction(node: ts.Node, sf: ts.SourceFile): string | null {
  let cur: ts.Node | undefined = node.parent;
  while (cur && cur !== sf) {
    if (ts.isFunctionDeclaration(cur) && cur.parent === sf && cur.name) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return null;
}

function collectWriteSites(file: string, writeRe: RegExp = WRITE_RE): WriteSite[] {
  const source = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const sites: WriteSite[] = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text !== null) {
      const normalized = text.replace(/\s+/g, " ");
      if (writeRe.test(normalized)) {
        sites.push({
          file,
          fn: enclosingTopLevelFunction(node, sf),
          pos: node.getStart(sf),
          snippet: normalized.slice(0, 60),
          normalized,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function writeZoneRanges(file: string): [number, number][] {
  const source = fs.readFileSync(file, "utf8");
  const ranges: [number, number][] = [];
  let from = 0;
  for (;;) {
    const begin = source.indexOf("BOUNDARY WRITE ZONE BEGIN", from);
    if (begin < 0) break;
    const end = source.indexOf("BOUNDARY WRITE ZONE END", begin);
    if (end < 0) break;
    ranges.push([begin, end]);
    from = end + 1;
  }
  return ranges;
}

describe("Phase F grep gate: user_model writes live only behind the boundary", () => {
  it("consolidation/: boundary.ts is the only file with writes, and every write is inside a marked write zone", () => {
    const files = fs
      .readdirSync(consolidationDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => path.join(consolidationDir, f));
    expect(files).toContain(boundaryFile);
    const ranges = writeZoneRanges(boundaryFile);
    expect(ranges.length).toBeGreaterThanOrEqual(2);

    for (const file of files) {
      const sites = collectWriteSites(file);
      if (file !== boundaryFile) {
        expect(sites, `${path.basename(file)} must contain no user_model writes`).toEqual([]);
        continue;
      }
      // Sanity: the gate is not vacuous — the boundary really writes.
      expect(sites.length).toBeGreaterThanOrEqual(5);
      for (const site of sites) {
        const inZone = ranges.some(([b, e]) => site.pos > b && site.pos < e);
        expect(
          inZone,
          `write outside a marked zone in boundary.ts (fn=${site.fn}): ${site.snippet}`,
        ).toBe(true);
      }
    }
  });

  it("userModel.ts: writes exist only in the authorized non-W3 writers — never in the sweeps or any other function", () => {
    const AUTHORIZED = new Set([
      "recordStated",
      "correctUserModel",
      "writeExplicitConstraint",
      "updateUserModel",
    ]);
    const sites = collectWriteSites(userModelFile);
    expect(sites.length).toBeGreaterThanOrEqual(5);
    for (const site of sites) {
      expect(
        site.fn !== null && AUTHORIZED.has(site.fn),
        `user_model write in unauthorized function '${site.fn}': ${site.snippet}`,
      ).toBe(true);
    }
    const fns = new Set(sites.map((s) => s.fn));
    expect(fns.has("sweepStaleEmotions")).toBe(false);
    expect(fns.has("sweepWithdrawnEvidence")).toBe(false);
    // Sanity: the known writers are actually found (scan is not vacuous).
    expect(fns.has("recordStated")).toBe(true);
    expect(fns.has("updateUserModel")).toBe(true);
    expect(fns.has("correctUserModel")).toBe(true);
  });

  it("episodic.ts: user_model writes exist ONLY as the two vetted forget-flow shapes inside applyForgetRequest (§8.6 third sanctioned writer, E6)", () => {
    // The vetted write shapes of applyForgetRequest's evidence propagation
    // (episodic.ts §5 of the flow) — exact statements after the scan's
    // whitespace normalization. Anything else (a new column set, an INSERT,
    // a DELETE, the same statement moved to another function) fails below.
    const VETTED_SHAPES = new Set([
      // Sole evidence withdrawn → suspend the claim (never delete it).
      "UPDATE user_model SET invalid_at = ?, invalid_reason = 'evidence_withdrawn' WHERE id = ?",
      // Independent evidence remains → prune only the forgotten refs.
      "UPDATE user_model SET evidence_ids = ? WHERE id = ?",
    ]);
    const sites = collectWriteSites(episodicFile, WRITE_OR_DELETE_RE);
    // Sanity: the gate is not vacuous — the forget flow really writes, and
    // both vetted shapes are actually present (a shape silently vanishing
    // from the flow is a behavior change the gate should surface here).
    expect(sites.length).toBe(2);
    expect(new Set(sites.map((s) => s.normalized))).toEqual(VETTED_SHAPES);
    for (const site of sites) {
      expect(
        site.fn === "applyForgetRequest",
        `user_model write outside applyForgetRequest in episodic.ts (fn=${site.fn}): ${site.snippet}`,
      ).toBe(true);
      expect(
        VETTED_SHAPES.has(site.normalized),
        `unvetted user_model write shape in episodic.ts: ${site.normalized}`,
      ).toBe(true);
    }
  });

  it("the boundary exports the single entry point", () => {
    const source = fs.readFileSync(boundaryFile, "utf8");
    expect(source).toContain("export async function applyConsolidationMutation");
  });
});
