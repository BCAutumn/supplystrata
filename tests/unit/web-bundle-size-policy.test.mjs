import { describe, expect, it } from "vitest";
import { evaluateBundleSizeGate } from "../../scripts/browser-bundle-policy.mjs";

describe("web bundle size policy", () => {
  it("fails when gzipped bytes exceed the configured limit", () => {
    const result = evaluateBundleSizeGate({
      path: "dist/components.iife.js",
      content: "x".repeat(256),
      maxGzipBytes: 10
    });

    expect(result.ok).toBe(false);
    expect(result.gzipBytes).toBeGreaterThan(result.maxGzipBytes);
  });
});
