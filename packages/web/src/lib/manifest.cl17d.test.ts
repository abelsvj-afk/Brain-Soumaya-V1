import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Locate the shipped manifest whether vitest's cwd is the repo root or the web package. */
function readManifest(): string {
  const candidates = [
    join(process.cwd(), "public", "manifest.webmanifest"),
    join(process.cwd(), "packages", "web", "public", "manifest.webmanifest"),
  ];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c, "utf8");
  throw new Error(`manifest.webmanifest not found from cwd ${process.cwd()}`);
}

/**
 * IM-141 — the PWA manifest is the contract Android/Chrome read for the share
 * sheet and home-screen long-press shortcuts. Before this cluster it had
 * NEITHER `share_target` NOR `shortcuts` (audit part E #11), so there was no
 * OS-level path into capture at all. This test reads the real shipped file —
 * it fails until the entries exist and breaks if they're ever removed.
 */
const manifest = JSON.parse(readManifest()) as {
  share_target?: { action?: string; method?: string; params?: Record<string, string> };
  shortcuts?: { name?: string; url?: string }[];
  start_url?: string;
};

describe("manifest.webmanifest — IM-141", () => {
  it("declares a GET share_target landing on /share with title/text/url params", () => {
    expect(manifest.share_target).toBeDefined();
    expect(manifest.share_target!.action).toBe("/share");
    expect(manifest.share_target!.method).toBe("GET");
    expect(manifest.share_target!.params).toMatchObject({ title: "title", text: "text", url: "url" });
  });

  it("declares a capture shortcut that opens the share/capture route", () => {
    expect(Array.isArray(manifest.shortcuts)).toBe(true);
    expect(manifest.shortcuts!.length).toBeGreaterThan(0);
    expect(manifest.shortcuts![0]!.url).toContain("/share");
  });

  it("keeps the existing PWA identity intact", () => {
    expect(manifest.start_url).toBe("/");
  });
});
