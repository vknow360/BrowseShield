import { aggregateNERTokens } from "./ner-pipeline.js";
import assert from "assert";

function runTests() {
  console.log("Running NER Aggregator Unit Tests...");

  const input = "Rahul Sharma works at Indian Space Research Organisation in Bengaluru.";
  // We mock the output of Transformers.js `token-classification`
  // Tokens: [Rahul, Sharma, works, at, Indian, Space, Research, Organisation, in, Bengaluru]
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

  assert.strictEqual(entities.length, 3, "Should detect 3 entities");
  
  assert.strictEqual(entities[0].entityType, "PERSON");
  assert.strictEqual(entities[0].value, "Rahul Sharma");
  assert.ok(entities[0].confidence > 0.98);

  assert.strictEqual(entities[1].entityType, "ORGANIZATION");
  assert.strictEqual(entities[1].value, "Indian Space Research Organisation");

  assert.strictEqual(entities[2].entityType, "ADDRESS");
  assert.strictEqual(entities[2].value, "Bengaluru");

  // Subword test
  const input2 = "Ashutosh";
  const mockResults2 = [
    { entity: "B-PER", score: 0.9, word: "Ash", start: 0, end: 3 },
    { entity: "I-PER", score: 0.9, word: "##uto", start: 3, end: 6 },
    { entity: "I-PER", score: 0.9, word: "##sh", start: 6, end: 8 },
  ];
  const entities2 = aggregateNERTokens(mockResults2, input2);
  assert.strictEqual(entities2.length, 1);
  assert.strictEqual(entities2[0].value, "Ashutosh");

  console.log("All tests passed!");
}

runTests();
