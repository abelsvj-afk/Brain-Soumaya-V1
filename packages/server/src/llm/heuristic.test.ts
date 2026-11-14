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
