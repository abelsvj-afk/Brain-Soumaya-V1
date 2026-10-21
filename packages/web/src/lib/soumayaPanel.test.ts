import { describe, it, expect } from "vitest";
import { humanizeLogAction, derivePresence } from "./soumayaPanel.js";

/** IM-70 + IM-65 pure-helper pins. */
describe("humanizeLogAction (IM-70)", () => {
  it("maps tool: and intelligence: tokens to friendly labels", () => {
    expect(humanizeLogAction("tool:bill_risk")).toBe("Bill-risk warning");
    expect(humanizeLogAction("tool:fire_reminder")).toBe("Reminder fired");
    expect(humanizeLogAction("intelligence:clarification")).toBe("Asked for clarification");
  });
  it("maps lifecycle words and job types", () => {
    expect(humanizeLogAction("goal_completed")).toBe("Goal completed");
    expect(humanizeLogAction("dream")).toBe("Dream cycle");
    expect(humanizeLogAction("synthesis")).toBe("Connecting threads");
  });
  it("never returns a raw plumbing token", () => {
    const out = humanizeLogAction("some_new_action");
    expect(out).not.toContain("_");
    expect(out).not.toContain(":");
    expect(humanizeLogAction("")).toBe("Activity");
  });
});

describe("derivePresence (IM-65)", () => {
  it("doing task wins and reads as focused/thinking", () => {
    const p = derivePresence({ tasks: [{ label: "Patrolling", status: "doing" }], latestLog: null });
    expect(p.sentence).toContain("Patrolling");
    expect(p.eyeState).toBe("thinking");
    expect(p.moodLabel).toBe("Focused");
  });
  it("low fuel overrides the mood honestly", () => {
    const p = derivePresence({
      tasks: [],
      latestLog: null,
      fuel: { fuel: 1, capacity: 100, jobCost: 5 },
    });
    expect(p.mood).toBe("concerned");
    expect(p.moodLabel).toContain("Low on fuel");
  });
  it("empty state makes no invented claims", () => {
    const p = derivePresence({ tasks: [], latestLog: null });
    expect(p.sentence).toContain("no active tasks");
  });
});
