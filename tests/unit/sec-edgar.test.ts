import { describe, expect, it } from "vitest";
import { normalizeCik } from "@supplystrata/sources-sec-edgar";

describe("SEC EDGAR adapter helpers", () => {
  it("normalizes CIK to SEC 10 digit format", () => {
    expect(normalizeCik("1045810")).toBe("0001045810");
    expect(normalizeCik("0001045810")).toBe("0001045810");
  });

  it("rejects invalid CIKs", () => {
    expect(() => normalizeCik("not-a-cik")).toThrow("Invalid CIK");
  });
});
