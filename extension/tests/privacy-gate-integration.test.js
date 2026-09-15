import { describe, it, expect, vi, beforeEach } from "vitest";
import { privacyGate } from "../src/core/tokenizer/privacy-gate.js";
import { PIITokenizer } from "../src/core/tokenizer/tokenizer.js";
import { detectFieldPII } from "../src/core/detector/index.js";

// Mock the auditLogger since we don't want to actually write to chrome.storage during tests
vi.mock("../src/core/audit/audit-logger.js", () => {
  return {
    auditLogger: {
      log: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    }
  };
});

describe("Privacy Gate Integration End-to-End", () => {
  let tokenizer;

  beforeEach(() => {
    tokenizer = new PIITokenizer();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("successfully sanitizes and gates a complex payload without leaking", async () => {
    // 1. Simulate detection phase
    const rawData = [
      { type: "AADHAAR", value: "730248408375" },
      { type: "EMAIL", value: "test@example.com" }
    ];
    
    // 2. Tokenize
    tokenizer.assignTokens(rawData.map(d => ({ entityType: d.type, realValue: d.value })));
    
    const domPayload = {
      nodes: [
        { label: "ID", value: tokenizer.sanitizeString("730248408375") },
        { label: "Contact", value: tokenizer.sanitizeString("test@example.com") }
      ]
    };
    
    // 3. Gate
    const result = privacyGate(domPayload, tokenizer.getState().tokenMap, "block");
    
    expect(result.allowed).toBe(true);
    expect(result.violations.length).toBe(0);
    expect(result.serialized).toContain("[[AADHAAR_1]]");
    expect(result.serialized).toContain("[[EMAIL_1]]");
    expect(result.serialized).not.toContain("730248408375");
    expect(result.serialized).not.toContain("test@example.com");
  });

  it("blocks payload immediately if a raw value slips through", () => {
    // 1. Tokenize
    tokenizer.assignTokens([{ entityType: "PAN", realValue: "ABCDE1234F" }]);
    
    // 2. Malicious/Buggy payload where raw PAN was NOT sanitized
    const domPayload = {
      nodes: [
        { label: "PAN", value: "ABCDE1234F" } // Accidentally raw
      ]
    };
    
    // 3. Gate
    const result = privacyGate(domPayload, tokenizer.getState().tokenMap, "block");
    
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].entityType).toBe("PAN");
  });
});
