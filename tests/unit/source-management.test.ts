import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertValidSourceManagementConfig,
  buildSourceCheckTargetIdsFromPlan,
  buildSourceManagementCatalog,
  buildSourcePolicyConfigFromPlanTargets,
  parseManagedSourcePlanDocument,
  previewSourceCheckTargetsFromPlan,
  validateSourceManagementConfig,
  type SourceManagementConfig
} from "@supplystrata/source-management";
import type { SourceCheckConnectorCapability } from "@supplystrata/source-connectors";
import { parseSourcePolicyConfig } from "@supplystrata/source-monitor";
import { planSourcesForComponents } from "@supplystrata/source-plan";
import { listRegisteredSourceCheckConnectorCapabilities } from "@supplystrata/source-workflows";

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
    key: "osh/facility-search",
    credential_requirements: [{ env_key: "OSH_API_TOKEN", required: true, description: "Open Supply Hub token." }]
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
    expect(catalog.sources.find((item) => item.source.id === "opencorporates")?.source_credential_requirements).toEqual([
      {
        env_key: "OPEN_CORPORATES_API_TOKEN",
        required: true,
        description: "OpenCorporates API token used for entity resolution candidates."
      }
    ]);
    expect(catalog.sources.find((item) => item.source.id === "companies-house")?.source_credential_requirements).toEqual([
      {
        env_key: "COMPANIES_HOUSE_API_KEY",
        required: true,
        description: "UK Companies House API key used for official entity registry lookup."
      }
    ]);
    expect(catalog.sources.find((item) => item.source.id === "osh")?.target_credential_requirements["facility-search"]).toEqual([
      { env_key: "OSH_API_TOKEN", required: true, description: "Open Supply Hub token." }
    ]);
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
    expect(result.warnings[0]?.message).toContain("OSH_API_TOKEN");
  });

  it("keeps the example source policy runnable and covers five SEC company facts targets", () => {
    const config = parseSourcePolicyConfig(readFileSync(new URL("../../config/source-policies.example.json", import.meta.url), "utf8"));
    const result = assertValidSourceManagementConfig(config, {
      connector_capabilities: listRegisteredSourceCheckConnectorCapabilities()
    });
    const companyFactTargets = config.check_targets.filter((target) => target.source_adapter_id === "sec-edgar" && target.target_kind === "sec-company-facts");

    expect(result.errors).toEqual([]);
    expect(companyFactTargets.map((target) => target.subject_entity_id).sort()).toEqual(["ENT-AMD", "ENT-INTEL", "ENT-MICRON", "ENT-MICROSOFT", "ENT-NVIDIA"]);
    expect(companyFactTargets.every((target) => target.enabled && target.target_config["max_periods"] === 12)).toBe(true);
  });

  it("turns runnable research source-plan suggestions into disabled monitor targets by default", () => {
    const sourcePlan = planSourcesForComponents({
      component_ids: ["COMP-MEMORY"],
      maxTierDepth: 3,
      officialDisclosureYear: "2025"
    });

    const config = buildSourcePolicyConfigFromPlanTargets({
      source_plan: sourcePlan,
      namespace: "NVIDIA Memory 2025"
    });

    expect(config.policies).toEqual([]);
    expect(config.check_targets.map((target) => target.source_adapter_id).sort()).toEqual(["micron-ir", "samsung-ir", "skhynix-ir"]);
    expect(config.check_targets.every((target) => target.enabled === false)).toBe(true);
    expect(buildSourceCheckTargetIdsFromPlan({ source_plan: sourcePlan, namespace: "NVIDIA Memory 2025" })).toEqual(
      config.check_targets.map((target) => target.check_target_id)
    );
    expect(config.check_targets.every((target) => target.check_target_id.startsWith("plan:nvidia-memory-2025:"))).toBe(true);
    expect(config.check_targets.find((target) => target.source_adapter_id === "samsung-ir")).toEqual(
      expect.objectContaining({
        target_kind: "official-html-disclosure",
        priority: 10,
        subject_entity_id: "ENT-SAMSUNG-ELECTRONICS",
        target_config: { entity_id: "ENT-SAMSUNG-ELECTRONICS", year: 2025 }
      })
    );
    expect(config.check_targets.find((target) => target.source_adapter_id === "micron-ir")).toEqual(
      expect.objectContaining({
        target_kind: "official-html-disclosure",
        priority: 30,
        subject_entity_id: "ENT-MICRON",
        target_config: { entity_id: "ENT-MICRON", year: 2025 }
      })
    );
    expect(assertValidSourceManagementConfig(config, { connector_capabilities: listRegisteredSourceCheckConnectorCapabilities() }).errors).toEqual([]);
  });

  it("parses source-plan JSON and preserves explicit scheduling overrides for generated monitor targets", () => {
    const document = parseManagedSourcePlanDocument(
      JSON.stringify({
        schema_version: "1.0.0",
        source_plan: [
          {
            source_id: "census-trade",
            priority: "P1",
            reasons: ["COMP-MEMORY has HS proxy coverage"],
            suggested_check_targets: [
              {
                source_adapter_id: "census-trade",
                target_kind: "trade-flow-observation",
                runnable: true,
                target_config: {
                  direction: "imports",
                  time: "2025-12",
                  commodity_code: "854232",
                  component_id: "COMP-MEMORY",
                  scope_kind: "component",
                  scope_id: "COMP-MEMORY"
                },
                reason: "COMP-MEMORY uses HS 854232 as an observation-only trade proxy"
              }
            ]
          }
        ]
      })
    );

    const config = buildSourcePolicyConfigFromPlanTargets({
      source_plan: document.source_plan,
      namespace: "memory-trade",
      enabled: true,
      next_check_at: "2026-01-01T00:00:00Z",
      check_cadence_minutes: 1440,
      jitter_minutes: 60,
      max_attempts: 4
    });

    expect(config.check_targets).toEqual([
      expect.objectContaining({
        source_adapter_id: "census-trade",
        target_kind: "trade-flow-observation",
        enabled: true,
        priority: 30,
        next_check_at: "2026-01-01T00:00:00.000Z",
        check_cadence_minutes: 1440,
        jitter_minutes: 60,
        max_attempts: 4,
        target_config: {
          commodity_code: "854232",
          component_id: "COMP-MEMORY",
          direction: "imports",
          scope_id: "COMP-MEMORY",
          scope_kind: "component",
          time: "2025-12"
        }
      })
    ]);
  });

  it("parses executable source-plan batches with audited check target ids", () => {
    const document = parseManagedSourcePlanDocument(
      JSON.stringify({
        schema_version: "1.0.0",
        check_target_ids: ["plan:gate1-db-monitoring-config-check:micron-ir:official-html-disclosure:64939e541a7ec958"],
        source_plan: [
          {
            source_id: "micron-ir",
            priority: "P1",
            reasons: ["Micron IR target was matched from source target coverage."],
            suggested_check_targets: [
              {
                source_adapter_id: "micron-ir",
                target_kind: "official-html-disclosure",
                runnable: true,
                target_config: { entity_id: "ENT-MICRON", year: 2025 },
                reason: "Enable the already-synced Micron IR target."
              }
            ]
          }
        ]
      })
    );

    expect(document.check_target_ids).toEqual(["plan:gate1-db-monitoring-config-check:micron-ir:official-html-disclosure:64939e541a7ec958"]);
    expect(document.source_plan[0]?.suggested_check_targets[0]?.source_adapter_id).toBe("micron-ir");
  });

  it("filters generated source-plan targets by source adapter", () => {
    const document = parseManagedSourcePlanDocument(
      JSON.stringify({
        schema_version: "1.0.0",
        source_plan: [
          {
            source_id: "sec-edgar",
            priority: "P0",
            reasons: ["SEC and DART targets share the same research loop."],
            suggested_check_targets: [
              {
                source_adapter_id: "sec-edgar",
                target_kind: "sec-company-facts",
                runnable: true,
                target_config: {
                  cik: "0001045810",
                  entity_id: "ENT-NVIDIA",
                  metrics: ["revenue"],
                  max_periods: 12
                },
                reason: "Monitor SEC company facts."
              },
              {
                source_adapter_id: "dart-kr",
                target_kind: "company-filings",
                runnable: true,
                target_config: {
                  corp_code: "00164779",
                  entity_id: "ENT-SKHYNIX",
                  disclosure_types: ["A"],
                  year: 2025,
                  final_reports_only: "Y"
                },
                reason: "Monitor Korean filings."
              }
            ]
          }
        ]
      })
    );

    const config = buildSourcePolicyConfigFromPlanTargets({
      source_plan: document.source_plan,
      namespace: "Gate 1 filtered",
      enabled: true,
      source_adapter_ids: ["sec-edgar"]
    });

    expect(config.check_targets.map((target) => target.source_adapter_id)).toEqual(["sec-edgar"]);
    expect(buildSourceCheckTargetIdsFromPlan({ source_plan: document.source_plan, namespace: "Gate 1 filtered", source_adapter_ids: ["sec-edgar"] })).toEqual(
      config.check_targets.map((target) => target.check_target_id)
    );

    const report = previewSourceCheckTargetsFromPlan({
      source_plan: document.source_plan,
      namespace: "Gate 1 filtered",
      source_adapter_ids: ["sec-edgar"],
      connector_capabilities: listRegisteredSourceCheckConnectorCapabilities()
    });
    expect(report.summary.runnable_suggestions).toBe(1);
    expect(report.summary.generated_targets).toBe(1);
    expect(report.summary.duplicate_targets_skipped).toBe(0);
    expect(report.summary.by_source).toEqual({ "sec-edgar": 1 });
  });

  it("previews source-plan target sync without writing policy rows", () => {
    const document = parseManagedSourcePlanDocument(
      JSON.stringify({
        schema_version: "1.0.0",
        source_plan: [
          {
            source_id: "dart-kr",
            priority: "P0",
            reasons: ["SK Hynix needs Korean regulatory disclosure coverage"],
            suggested_check_targets: [
              {
                source_adapter_id: "dart-kr",
                target_kind: "company-filings",
                runnable: true,
                target_config: {
                  corp_code: "00164779",
                  entity_id: "ENT-SKHYNIX",
                  disclosure_types: ["A", "B"],
                  year: 2025,
                  final_reports_only: "Y"
                },
                reason: "Monitor OpenDART company filings."
              },
              {
                source_adapter_id: "dart-kr",
                target_kind: "company-filings",
                runnable: true,
                target_config: {
                  corp_code: "00164779",
                  entity_id: "ENT-SKHYNIX",
                  disclosure_types: ["A", "B"],
                  year: 2025,
                  final_reports_only: "Y"
                },
                reason: "Duplicate suggestion should collapse to the same stable target id."
              }
            ]
          }
        ]
      })
    );

    const report = previewSourceCheckTargetsFromPlan({
      source_plan: document.source_plan,
      namespace: "Gate 1 DART",
      enabled: true,
      connector_capabilities: listRegisteredSourceCheckConnectorCapabilities()
    });

    expect(report.namespace).toBe("gate-1-dart");
    expect(report.validation.ok).toBe(true);
    expect(report.summary).toMatchObject({
      source_plan_items: 1,
      runnable_suggestions: 2,
      generated_targets: 1,
      duplicate_targets_skipped: 1,
      enabled_targets: 1,
      targets_requiring_credentials: 1,
      validation_errors: 0,
      validation_warnings: 1,
      by_source: { "dart-kr": 1 },
      by_target_kind: { "dart-kr/company-filings": 1 },
      by_priority: { "10": 1 }
    });
    expect(report.validation.warnings).toEqual([expect.objectContaining({ code: "SOURCE_REQUIRES_KEY", source_adapter_id: "dart-kr" })]);
    expect(report.validation.warnings[0]?.message).toContain("OPENDART_API_KEY");
    const [target] = report.config.check_targets;
    expect(target?.check_target_id).toContain("plan:gate-1-dart:dart-kr:company-filings:");
    expect(target).toEqual(
      expect.objectContaining({
        enabled: true,
        priority: 10,
        subject_entity_id: "ENT-SKHYNIX"
      })
    );
  });
});
