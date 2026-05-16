import { describe, expect, it } from "vitest";
import { classifyDocumentChange, parseSourcePolicyConfig } from "@supplystrata/source-monitor";

describe("source monitor", () => {
  it("classifies first seen, unchanged, and changed documents", () => {
    expect(classifyDocumentChange(null, "sha-a")).toBe("DOCUMENT_NEW");
    expect(classifyDocumentChange("sha-a", "sha-a")).toBe("DOCUMENT_UNCHANGED");
    expect(classifyDocumentChange("sha-a", "sha-b")).toBe("DOCUMENT_CHANGED");
  });

  it("parses external source monitoring policies", () => {
    const config = parseSourcePolicyConfig(
      JSON.stringify({
        schema_version: "1.0.0",
        policies: [
          {
            source_adapter_id: "sec-edgar",
            enabled: true,
            check_cadence_minutes: 720,
            jitter_minutes: 60,
            priority: 10,
            notes: "twice daily"
          }
        ]
      })
    );

    expect(config.policies[0]).toEqual({
      source_adapter_id: "sec-edgar",
      enabled: true,
      check_cadence_minutes: 720,
      jitter_minutes: 60,
      priority: 10,
      notes: "twice daily"
    });
  });
});
