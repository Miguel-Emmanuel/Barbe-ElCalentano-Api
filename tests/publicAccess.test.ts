import { describe, expect, it } from "vitest";
import {
  PUBLIC_CODE_ALPHABET,
  makePublicCode,
  makePublicToken,
  normalizePublicCode,
} from "../src/domain/publicAccess";
import { assertLookupAllowed, resetLookupLimits } from "../src/lib/lookupLimit";
import { AppError } from "../src/lib/errors";

describe("public appointment codes", () => {
  it("builds a 6 character code without ambiguous glyphs", () => {
    const code = makePublicCode(Uint8Array.from([0, 1, 2, 3, 4, 5]));
    expect(code).toHaveLength(6);
    for (const char of code) {
      expect(PUBLIC_CODE_ALPHABET.includes(char)).toBe(true);
      expect("01OI".includes(char)).toBe(false);
    }
  });

  it("normalizes spoken codes", () => {
    expect(normalizePublicCode(" ab-cd 23 ")).toBe("ABCD23");
  });

  it("creates an unguessable token", () => {
    const a = makePublicToken();
    const b = makePublicToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});

describe("lookup rate limit", () => {
  it("blocks after too many tries from the same caller", () => {
    resetLookupLimits();
    for (let i = 0; i < 10; i += 1) assertLookupAllowed("test-ip", 1_000);
    expect(() => assertLookupAllowed("test-ip", 1_000)).toThrow(AppError);
    expect(() => assertLookupAllowed("other-ip", 1_000)).not.toThrow();
  });
});
