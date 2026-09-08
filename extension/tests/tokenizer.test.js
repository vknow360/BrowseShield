import { describe, it, expect, beforeEach, vi } from "vitest";
import { PIITokenizer, maskValue } from "../src/core/tokenizer/tokenizer.js";
import { DEFAULT_PRIVACY_POLICY } from "../src/core/tokenizer/privacy-policy.js";

// Mock chrome API
global.chrome = {
  storage: {
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(),
      remove: vi.fn().mockResolvedValue(),
    },
  },
};

describe("PIITokenizer", () => {
  let tokenizer;

  beforeEach(() => {
    vi.clearAllMocks();
    tokenizer = new PIITokenizer(DEFAULT_PRIVACY_POLICY);
  });

  it("tokenizes nodes and returns a sanitized deep copy", async () => {
    const nodes = [
      {
        id: "1",
        value: "Rahul",
        selector: "#name",
        box: { x: 0, y: 0 },
        pii: {
          isPII: true,
          entityType: "PERSON",
          confidence: 0.95,
          source: "ner",
        },
      },
      { id: "2", value: "Ignore", selector: "#ignore", box: { x: 0, y: 0 } }, // no PII
    ];

    const candidates = PIITokenizer.extractNodeCandidates(nodes, DEFAULT_PRIVACY_POLICY.confidenceThreshold);
    tokenizer.assignTokens(candidates);
    const sanitizedNodes = tokenizer.sanitizeNodes(nodes);
    const tokenMap = tokenizer.tokenMap;

    expect(sanitizedNodes[0].value).toBe("[[PERSON_1]]");
    expect(sanitizedNodes[0].pii).toBeUndefined(); // should be stripped
    expect(sanitizedNodes[1].value).toBe("Ignore"); // unchanged

    expect(tokenMap["[[PERSON_1]]"]).toEqual(
      expect.objectContaining({
        realValue: "Rahul",
        entityType: "PERSON",
        selector: "#name",
      }),
    );
  });

  it("deduplicates tokens by realValue", async () => {
    const nodes = [
      {
        id: "1",
        value: "test@example.com",
        selector: "#e1",
        pii: { isPII: true, entityType: "EMAIL", confidence: 0.9 },
      },
      {
        id: "2",
        value: "test@example.com",
        selector: "#e2",
        pii: { isPII: true, entityType: "EMAIL", confidence: 0.9 },
      },
    ];

    const candidates = PIITokenizer.extractNodeCandidates(nodes, DEFAULT_PRIVACY_POLICY.confidenceThreshold);
    tokenizer.assignTokens(candidates);
    const sanitizedNodes = tokenizer.sanitizeNodes(nodes);
    const tokenMap = tokenizer.tokenMap;

    expect(sanitizedNodes[0].value).toBe("[[EMAIL_1]]");
    expect(sanitizedNodes[1].value).toBe("[[EMAIL_1]]");
    expect(Object.keys(tokenMap).length).toBe(1);
  });

  it("respects opaque token categories (MEDICAL -> VALUE)", async () => {
    const nodes = [
      {
        id: "1",
        value: "Asthma",
        selector: "#med",
        pii: { isPII: true, entityType: "MEDICAL", confidence: 0.9 },
      },
    ];

    const candidates = PIITokenizer.extractNodeCandidates(nodes, DEFAULT_PRIVACY_POLICY.confidenceThreshold);
    tokenizer.assignTokens(candidates);
    const sanitizedNodes = tokenizer.sanitizeNodes(nodes);
    const tokenMap = tokenizer.tokenMap;

    expect(sanitizedNodes[0].value).toBe("[[VALUE_1]]");
    expect(tokenMap["[[VALUE_1]]"].entityType).toBe("MEDICAL");
  });

  it("respects confidence threshold", async () => {
    const policy = { ...DEFAULT_PRIVACY_POLICY, confidenceThreshold: 0.9 };
    const strictTokenizer = new PIITokenizer(policy);

    const nodes = [
      {
        id: "1",
        value: "MaybeName",
        selector: "#name",
        pii: { isPII: true, entityType: "PERSON", confidence: 0.85 },
      },
    ];

    const candidates = PIITokenizer.extractNodeCandidates(nodes, policy.confidenceThreshold);
    strictTokenizer.assignTokens(candidates);
    const sanitizedNodes = strictTokenizer.sanitizeNodes(nodes);
    expect(sanitizedNodes[0].value).toBe("MaybeName"); // Not tokenized due to low confidence
  });

  it("rehydrates strings correctly", async () => {
    const nodes = [
      {
        id: "1",
        value: "Rahul",
        selector: "#n",
        pii: { isPII: true, entityType: "PERSON", confidence: 1 },
      },
      {
        id: "2",
        value: "01/01/1990",
        selector: "#d",
        pii: { isPII: true, entityType: "DATE_OF_BIRTH", confidence: 1 },
      },
      {
        id: "3",
        value: "Diabetic",
        selector: "#m",
        pii: { isPII: true, entityType: "MEDICAL", confidence: 1 },
      },
    ];
    const candidates = PIITokenizer.extractNodeCandidates(nodes, DEFAULT_PRIVACY_POLICY.confidenceThreshold);
    tokenizer.assignTokens(candidates);

    expect(tokenizer.rehydrateString("Type [[PERSON_1]] into name")).toBe(
      "Type Rahul into name",
    );
    expect(tokenizer.rehydrateString("DOB is [[DATE_OF_BIRTH_1]]")).toBe(
      "DOB is 01/01/1990",
    );
    expect(tokenizer.rehydrateString("Diagnosis: [[VALUE_1]]")).toBe(
      "Diagnosis: Diabetic",
    );
  });
});

describe("maskValue", () => {
  it("masks passwords completely", () => {
    expect(maskValue("mypass123", "PASSWORD")).toBe("••••••••");
  });

  it("masks short strings correctly", () => {
    expect(maskValue("123", "PERSON")).toBe("••••");
  });

  it("partially masks longer strings", () => {
    expect(maskValue("rahul@example.com", "EMAIL")).toBe("ra•••••••••••••om");
  });
});
