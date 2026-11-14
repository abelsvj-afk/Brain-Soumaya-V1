import { defineConfig } from "vitest/config";

// Reviewer r2: agent.test.ts (idempotency) and a telemetry hook hit vitest's
// default 5 s/10 s limits only when the box was under heavy load (several
// worktrees building at once). They are CPU-only and pass in well under a
// second normally; the higher ceilings stop load spikes reading as failures
// without hiding a real hang (one still fails at 20 s / 30 s).
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
