import { describe, it, expect } from "vitest";
import { HeuristicProvider } from "./heuristic.js";

const llm = new HeuristicProvider();

describe("HeuristicProvider.answer — Finding 2: the limitation leads, and never misdiagnoses the cause", () => {
  const ctx = [{ id: 1, label: "Car fund", type: "daily", content: "Saving for a car." }];

  it("leads with the offline limitation when it has memories to show", async () => {
    const r = await llm.answer("what about my car?", ctx);
    expect(r.answer.startsWith("I'm answering with my offline mind")).toBe(true);
    // The old closing line blamed a missing key even for quota/timeout/budget
    // fallbacks — it must never appear; reason copy lives in the client banner.
    expect(r.answer).not.toContain("Connect an OpenAI or Gemini key");
    expect(r.answer).not.toContain("fuller story");
    expect(r.answer).toContain("Car fund");
  });

  it("leads with the offline limitation on a heavy question with no memories", async () => {
    const r = await llm.answer("I'm scared about losing everything", []);
    expect(r.answer.startsWith("I'm answering with my offline mind")).toBe(true);
  });
});

describe("HeuristicProvider.interpretClarificationAnswer (I2)", () => {
  it("recognizes an explicit affirmative reply as answering the question", async () => {
    const r = await llm.interpretClarificationAnswer(
      "Is this the same 2016 vehicle you mentioned before?",
      "Yes. It was totaled in an accident.",
    );
    expect(r.answers).toBe(true);
    expect(r.confirmedStatement).toBe("It was totaled in an accident.");
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("recognizes an explicit negative reply as answering the question", async () => {
    const r = await llm.interpretClarificationAnswer(
      "Is this the same 2016 vehicle you mentioned before?",
      "No, this is a different car entirely.",
    );
    expect(r.answers).toBe(true);
    expect(r.confirmedStatement.length).toBeGreaterThan(0);
  });

  it("recognizes a substantive reply with topical overlap even without yes/no", async () => {
    const r = await llm.interpretClarificationAnswer(
      "Is this the same 2016 vehicle you mentioned before?",
      "That vehicle was actually totaled last month.",
    );
    expect(r.answers).toBe(true);
    expect(r.confirmedStatement).toContain("totaled");
  });

  it("does NOT treat an unrelated new topic as an answer", async () => {
    const r = await llm.interpretClarificationAnswer(
      "Is this the same 2016 vehicle you mentioned before?",
      "I had pizza for lunch today.",
    );
    expect(r.answers).toBe(false);
    expect(r.confirmedStatement).toBe("");
    expect(r.confidence).toBe(0);
  });

  it("does NOT treat empty/whitespace-only input as an answer", async () => {
    const r = await llm.interpretClarificationAnswer("Is this the same vehicle?", "   ");
    expect(r.answers).toBe(false);
  });

  it("strips a leading yes/no acknowledgement so the stored fact reads as a statement", async () => {
    const r = await llm.interpretClarificationAnswer(
      "Did you change jobs recently?",
      "Yes, I started a new job last week.",
    );
    expect(r.confirmedStatement).toBe("I started a new job last week.");
  });
});

describe("HeuristicProvider.extract — offline labels don't end mid-phrase (UX review #5)", () => {
  const labelOf = async (t: string) => (await llm.extract(t, [])).nodes[0]!.label;
  it("drops a dangling connector left by the six-word cut", async () => {
    expect(await labelOf("I want to learn guitar this year")).toBe("I want to learn guitar");
  });
  it("keeps short memories whole", async () => {
    expect(await labelOf("Call mom about the trip")).toBe("Call mom about the trip");
  });
  it("labels from the first sentence only", async () => {
    expect(await labelOf("Met Sara today. She is moving to Austin next month")).toBe("Met Sara today.");
  });
  it("falls back to 'Thought' for blank text", async () => {
    expect(await labelOf("   ")).toBe("Thought");
  });
});

describe("HeuristicProvider.extract — labels survive abbreviations and short openers", () => {
  const labelOf = async (t: string) => (await llm.extract(t, [])).nodes[0]!.label;
  it("doesn't stop at a title abbreviation", async () => {
    expect(await labelOf("Dr. Patel moved my appointment to Friday")).toBe("Dr. Patel moved my appointment");
  });
  it("doesn't stop at a place abbreviation", async () => {
    expect(await labelOf("St. Louis trip planning for next spring")).toBe("St. Louis trip planning for next");
  });
  it("keeps going past a one-word exclamation", async () => {
    expect(await labelOf("Wow! Got the job offer today")).toBe("Wow! Got the job offer today");
  });
  it("skips Mr./Mrs./Ms./Jr./Sr./vs./etc./e.g./i.e.", async () => {
    expect(await labelOf("Mr. Smith vs. Mrs. Jones")).toBe("Mr. Smith vs. Mrs. Jones");
    expect(await labelOf("Ms. Lee and Sr. Diaz met")).toBe("Ms. Lee and Sr. Diaz met");
    expect(await labelOf("Bob Jr. called me")).toBe("Bob Jr. called me");
    expect(await labelOf("Buy fruit, e.g. apples")).toBe("Buy fruit, e.g. apples");
    expect(await labelOf("Pack snacks, cables, etc. tonight")).toBe("Pack snacks, cables, etc. tonight");
    expect(await labelOf("One task i.e. laundry")).toBe("One task i.e. laundry");
  });
  it("still trims a dangling tail and stops at a real sentence end", async () => {
    expect(await labelOf("I want to learn guitar this year")).toBe("I want to learn guitar");
    expect(await labelOf("Met Sara today. She is moving to Austin next month")).toBe("Met Sara today.");
  });
  it("stops at a line break once it has three words", async () => {
    expect(await labelOf("Grocery list for Sunday\nmilk eggs bread")).toBe("Grocery list for Sunday");
  });
});
