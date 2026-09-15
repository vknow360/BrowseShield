import { describe, it, expect } from "vitest";
import {
  isValidAadharNumber,
  isValidPan,
  isValidPhoneNumber,
  isValidEmail,
  isValidCreditCard,
  isValidIFSC
} from "../src/core/detector/regex.js";
import { detectFieldPII } from "../src/core/detector/index.js";

describe("PII Detector Regex & Checksums", () => {
  it("validates Aadhaar numbers with Verhoeff checksum", () => {
    // These should pass checksum
    expect(isValidAadharNumber("730248408375")).toBe(true);
    // These should fail checksum
    expect(isValidAadharNumber("730248408374")).toBe(false);
    expect(isValidAadharNumber("123456789012")).toBe(false);
  });

  it("validates PAN numbers format", () => {
    expect(isValidPan("ABCDE1234F")).toBe(true);
    expect(isValidPan("ABCDE12345")).toBe(false); // Last char must be letter
    expect(isValidPan("1BCDE1234F")).toBe(false); // First 5 must be letters
  });

  it("validates Phone numbers", () => {
    expect(isValidPhoneNumber("+919876543210")).toBe(true);
    expect(isValidPhoneNumber("9876543210")).toBe(true);
    expect(isValidPhoneNumber("1234567890")).toBe(false); // Must start with 6-9 in India
  });

  it("validates Credit Cards with Luhn checksum", () => {
    // Valid test card
    expect(isValidCreditCard("49927398716")).toBe(true); 
    // Invalid
    expect(isValidCreditCard("49927398717")).toBe(false);
  });
});

describe("PII Detector (detectFieldPII)", () => {
  it("detects Aadhaar as high confidence PII", async () => {
    const node = { value: "730248408375", type: "text", label: "Enter ID" };
    const result = await detectFieldPII(node);
    
    expect(result).not.toBeNull();
    expect(result.isPII).toBe(true);
    expect(result.entityType).toBe("AADHAAR");
    expect(result.source).toBe("checksum-verhoeff");
    expect(result.confidence).toBe(1.0);
  });

  it("detects emails with regex", async () => {
    const node = { value: "test@example.com", type: "email" };
    const result = await detectFieldPII(node);
    
    expect(result).not.toBeNull();
    expect(result.entityType).toBe("EMAIL");
    expect(result.source).toBe("regex-email");
  });

  it("detects passwords via DOM heuristics even without value", async () => {
    const node = { value: "", type: "password" };
    const result = await detectFieldPII(node);
    
    expect(result).not.toBeNull();
    expect(result.entityType).toBe("PASSWORD");
    expect(result.source).toBe("dom-type");
  });

  it("ignores generic short numbers", async () => {
    const node = { value: "12345", type: "text" };
    const result = await detectFieldPII(node);
    
    // Might be caught by something else, but shouldn't be PAN/Aadhaar/etc.
    // If it's not caught, it returns null
    if (result) {
      expect(result.entityType).not.toBe("AADHAAR");
      expect(result.entityType).not.toBe("PAN");
      expect(result.entityType).not.toBe("CREDIT_CARD");
    } else {
      expect(result).toBeNull();
    }
  });

  it("filters hard negatives (e.g. Founded in 1923)", async () => {
    const node = { value: "Founded in 1923", type: "text" };
    const result = await detectFieldPII(node);
    expect(result).toBeNull();
  });
});
