import { describe, it, expect } from "vitest";
import { aggregateNERTokens } from "./ner-pipeline.js";

describe("NER Aggregator", () => {
  it("aggregates standard tokens correctly", () => {
    const input = "Rahul Sharma works at Indian Space Research Organisation in Bengaluru.";
    const mockResults = [
      { entity: "B-PER", score: 0.99, word: "Rahul", start: 0, end: 5 },
      { entity: "I-PER", score: 0.98, word: "Sharma", start: 6, end: 12 },
      { entity: "O", score: 0.99, word: "works", start: 13, end: 18 },
      { entity: "O", score: 0.99, word: "at", start: 19, end: 21 },
      { entity: "B-ORG", score: 0.95, word: "Indian", start: 22, end: 28 },
      { entity: "I-ORG", score: 0.97, word: "Space", start: 29, end: 34 },
      { entity: "I-ORG", score: 0.96, word: "Research", start: 35, end: 43 },
      { entity: "I-ORG", score: 0.98, word: "Organisation", start: 44, end: 56 },
      { entity: "O", score: 0.99, word: "in", start: 57, end: 59 },
      { entity: "B-LOC", score: 0.99, word: "Bengaluru", start: 60, end: 69 },
      { entity: "O", score: 0.99, word: ".", start: 69, end: 70 },
    ];

    const entities = aggregateNERTokens(mockResults, input);

    expect(entities.length).toBe(3);
    
    expect(entities[0].entityType).toBe("PERSON");
    expect(entities[0].value).toBe("Rahul Sharma");
    expect(entities[0].confidence).toBeGreaterThan(0.98);

    expect(entities[1].entityType).toBe("ORGANIZATION");
    expect(entities[1].value).toBe("Indian Space Research Organisation");

    expect(entities[2].entityType).toBe("ADDRESS");
    expect(entities[2].value).toBe("Bengaluru");
  });

  it("handles subword tokens with ## prefix", () => {
    const input2 = "Ashutosh";
    const mockResults2 = [
      { entity: "B-PER", score: 0.9, word: "Ash", start: 0, end: 3 },
      { entity: "I-PER", score: 0.9, word: "##uto", start: 3, end: 6 },
      { entity: "I-PER", score: 0.9, word: "##sh", start: 6, end: 8 },
    ];
    const entities2 = aggregateNERTokens(mockResults2, input2);
    
    expect(entities2.length).toBe(1);
    expect(entities2[0].value).toBe("Ashutosh");
  });
});
