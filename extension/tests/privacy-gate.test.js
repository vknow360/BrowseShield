import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateOutboundPayload,
  privacyGate,
} from "../src/core/tokenizer/privacy-gate.js";

describe("Privacy Gate (validateOutboundPayload)", () => {
  it("allows payload when token map is empty or payload is sanitized", () => {
    const payload = { nodes: [{ value: "[[AADHAAR_1]]" }] };
    const tokenMap = {
      "[[AADHAAR_1]]": { realValue: "1234 5678 9012", entityType: "AADHAAR" },
    };

    const result = validateOutboundPayload(payload, tokenMap);
    expect(result.allowed).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it("blocks payload if structured data (Aadhaar) leaks", () => {
    // 1234 5678 9012 is present in the payload string
    const payload = {
      nodes: [{ value: "[[AADHAAR_1]]" }, { value: "1234 5678 9012" }],
    };
    const tokenMap = {
      "[[AADHAAR_1]]": { realValue: "1234 5678 9012", entityType: "AADHAAR" },
    };

    const result = validateOutboundPayload(payload, tokenMap);
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0].token).toBe("[[AADHAAR_1]]");
  });

  it("blocks payload if unstructured data (PERSON) leaks using case-insensitive match", () => {
    const payload = { textContent: "Welcome rahul sharma" }; // lowercase in payload
    const tokenMap = {
      "[[PERSON_1]]": { realValue: "Rahul Sharma", entityType: "PERSON" }, // uppercase in map
    };

    const result = validateOutboundPayload(payload, tokenMap);
    expect(result.allowed).toBe(false);
    expect(result.violations.length).toBe(1);
  });

  it("skips short values (<= 2 chars) to prevent false positives", () => {
    const payload = { textContent: "He is in UK" };
    const tokenMap = {
      "[[STATE_1]]": { realValue: "UK", entityType: "STATE" },
    };

    const result = validateOutboundPayload(payload, tokenMap);
    expect(result.allowed).toBe(true); // 'UK' is <= 2 chars, should be skipped
  });
});

describe("Privacy Gate (enforcement wrapper)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("respects enforcement mode", () => {
    const payload = { textContent: "Secret" };
    const map = {
      "[[VALUE_1]]": { realValue: "Secret", entityType: "MEDICAL" },
    };

    // Default (block)
    const blockResult = privacyGate(payload, map, "block");
    expect(blockResult.allowed).toBe(false);
    expect(console.error).toHaveBeenCalled();

    // Warn mode (used for local dev, still reports allowed: false but we can choose to handle it differently)
    const warnResult = privacyGate(payload, map, "warn");
    expect(warnResult.allowed).toBe(false); // The payload is still invalid
    // console.error is skipped in 'warn' mode based on the code implementation
  });
});
