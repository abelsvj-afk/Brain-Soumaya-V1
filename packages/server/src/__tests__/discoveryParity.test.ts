import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runParityFixtures } from "./fixtures/discoveryParity.js";

/**
 * P1-PAR (docs/specs/unified-discovery-architecture-2026-10-31.md §15). The golden file was produced by scripts/discovery-golden.mjs from a git worktree of the PINNED baseline
 * commit — the code as it was BEFORE Phase 1 — so this is a comparison against the old behaviour, never between two versions of the same changed logic.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const goldenPath = path.join(here, "golden/discovery-parity.golden.json");
const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8")) as {
  schema: number;
  baselineCommit: string;
  payloadSha256: string;
  baselineReadSql: string[];
  payload: Record<string, unknown>;
};

describe("P1-PAR: behaviour parity against the pinned baseline", () => {
  it("the golden file is intact and names the commit it was made from", () => {
    expect(golden.schema).toBe(1);
    expect(golden.baselineCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(crypto.createHash("sha256").update(JSON.stringify(golden.payload)).digest("hex")).toBe(golden.payloadSha256);
    expect(Object.keys(golden.payload).length).toBeGreaterThan(30);
  });

  it("the fixtures cover what the spec lists (gates, sources, finds per world, roads, flavour, owner exemption)", () => {
    const names = Object.keys(golden.payload);
    for (const must of ["empty", "owner-exempt", "sources-and-unknown-ids", "recall-links-notes", "roads:none-found", "roads:all-finds", "flavor-counts", "finds:at-home"]) {
      expect(names, must).toContain(must);
    }
    expect(names.some((n) => n.startsWith("gate:the-long-morning:set1"))).toBe(true); // a multi-way set
    expect(names.some((n) => n.startsWith("gate:the-folded-letter:set1:one-short"))).toBe(true);
    expect(names.filter((n) => n.startsWith("finds:")).length).toBeGreaterThan(5);
  });

  it("the current code reproduces the baseline's outputs exactly, fixture by fixture", { timeout: 120_000 }, () => {
    const now = runParityFixtures() as Record<string, unknown>;
    expect(Object.keys(now)).toEqual(Object.keys(golden.payload));
    for (const name of Object.keys(golden.payload)) {
      expect(now[name], `fixture ${name}`).toEqual(golden.payload[name]);
    }
  });

  it("the fixtures runner and the generator are independent of the new discovery/ code", () => {
    const runner = fs.readFileSync(path.join(here, "fixtures/discoveryParity.ts"), "utf8");
    const generator = fs.readFileSync(path.join(here, "../../../../scripts/discovery-golden.mjs"), "utf8");
    // Only import specifiers count (comments may mention the folder).
    const imports = [...runner.matchAll(/^\s*import\b[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(3);
    for (const spec of imports) expect(spec, `runner imports ${spec}`).not.toMatch(/discovery\//);
    expect(generator).not.toMatch(/from\s+["'][^"']*discovery\//);
    // The generator runs the OLD code: it checks a commit out into a separate worktree.
    expect(generator).toMatch(/git",?\s*\(?\s*"worktree"|"worktree",\s*"add"/);
  });

  it("falsification: a difference in the output is actually detected", () => {
    const now = runParityFixtures() as Record<string, { bookA?: unknown[] }>;
    const tampered = structuredClone(now);
    const firstWithBook = Object.keys(tampered).find((k) => Array.isArray(tampered[k]!.bookA) && tampered[k]!.bookA!.length > 0)!;
    (tampered[firstWithBook]!.bookA as { foundAt: string }[])[0]!.foundAt = "1999-01-01T00:00:00.000Z";
    expect(tampered[firstWithBook]).not.toEqual(golden.payload[firstWithBook]);
  }, 120_000);
});
