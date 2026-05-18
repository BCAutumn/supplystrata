import { describe, expect, it } from "vitest";
import {
  assertValidSourceManagementConfig,
  buildSourceManagementCatalog,
  validateSourceManagementConfig,
  type SourceManagementConfig
} from "@supplystrata/source-management";
import type { SourceCheckConnectorCapability } from "@supplystrata/source-connectors";

const CONNECTORS: SourceCheckConnectorCapability[] = [
  {
    source_adapter_id: "sec-edgar",
    target_kind: "sec-company-filings",
    key: "sec-edgar/sec-company-filings",
    config_schema: {
      fields: [
        { key: "cik", type: "string", required: true, description: "SEC CIK." },
        { key: "entity_id", type: "string", required: true, description: "Entity id." },
        { key: "form_types", type: "string_array", required: true, description: "Form types.", allowed_values: ["10-K", "10-Q", "20-F", "8-K"] },
        { key: "limit", type: "positive_integer", required: false, description: "Limit." }
      ]
    }
  },
  {
    source_adapter_id: "osh",
    target_kind: "facility-search",
    key: "osh/facility-search"
  }
];

describe("source-management", () => {
  it("builds a unified catalog from registry sources and connector capabilities", () => {
    const catalog = buildSourceManagementCatalog({ connector_capabilities: CONNECTORS });
    const sec = catalog.sources.find((item) => item.source.id === "sec-edgar");
    const importYeti = catalog.sources.find((item) => item.source.id === "import-yeti");

    expect(sec?.config_mode).toBe("runnable");
    expect(sec?.connector_keys).toContain("sec-edgar/sec-company-filings");
    expect(sec?.target_config_schemas["sec-company-filings"]?.fields.map((field) => field.key)).toEqual(["cik", "entity_id", "form_types", "limit"]);
    expect(importYeti?.config_mode).toBe("manual_only");
    expect(catalog.unregistered_connector_keys).toEqual([]);
  });

  it("validates target config fields from connector capabilities", () => {
    const config: SourceManagementConfig = {
      schema_version: "1.0.0",
      policies: [{ source_adapter_id: "sec-edgar", enabled: true }],
      check_targets: [
        {
          check_target_id: "sec-edgar:nvidia",
          source_adapter_id: "sec-edgar",
          target_kind: "sec-company-filings",
          enabled: true,
          target_config: {
            cik: "0001045810",
            entity_id: "ENT-NVIDIA",
            form_types: ["10-X"]
          }
        }
      ]
    };

    const result = validateSourceManagementConfig(config, { connector_capabilities: CONNECTORS });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "INVALID_TARGET_CONFIG",
        message: "Source check target sec-edgar:nvidia form_types item must be one of: 10-K, 10-Q, 20-F, 8-K"
      })
    ]);
  });

  it("rejects user source configs that reference unsupported targets before writing policy rows", () => {
    const config: SourceManagementConfig = {
      schema_version: "1.0.0",
      policies: [{ source_adapter_id: "sec-edgar", enabled: true }],
      check_targets: [
        {
          check_target_id: "sec-edgar:nvidia",
          source_adapter_id: "sec-edgar",
          target_kind: "unknown-target",
          enabled: true,
          target_config: {}
        }
      ]
    };

    const result = validateSourceManagementConfig(config, { connector_capabilities: CONNECTORS });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "UNSUPPORTED_TARGET_CONNECTOR",
        source_adapter_id: "sec-edgar",
        target_kind: "unknown-target"
      })
    ]);
    expect(() => assertValidSourceManagementConfig(config, { connector_capabilities: CONNECTORS })).toThrow(
      "connector sec-edgar/unknown-target is not registered"
    );
  });

  it("keeps manual-only sources out of enabled automation targets", () => {
    const config: SourceManagementConfig = {
      schema_version: "1.0.0",
      policies: [{ source_adapter_id: "import-yeti", enabled: true }],
      check_targets: [
        {
          check_target_id: "import-yeti:manual",
          source_adapter_id: "import-yeti",
          target_kind: "manual-bol",
          enabled: true,
          target_config: {}
        }
      ]
    };

    const result = validateSourceManagementConfig(config, { connector_capabilities: CONNECTORS });

    expect(result.ok).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toContain("MANUAL_ONLY_TARGET_ENABLED");
  });

  it("warns when enabled targets require credentials", () => {
    const config: SourceManagementConfig = {
      schema_version: "1.0.0",
      policies: [{ source_adapter_id: "osh", enabled: true }],
      check_targets: [
        {
          check_target_id: "osh:test",
          source_adapter_id: "osh",
          target_kind: "facility-search",
          enabled: true,
          target_config: { query: "3M" }
        }
      ]
    };

    const result = validateSourceManagementConfig(config, { connector_capabilities: CONNECTORS });

    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "SOURCE_REQUIRES_KEY",
        source_adapter_id: "osh"
      })
    ]);
  });
});
