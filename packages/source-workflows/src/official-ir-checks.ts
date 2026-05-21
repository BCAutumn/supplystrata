import type { DatabaseStore } from "@supplystrata/db";
import { optionalConfigPositiveInteger, requireConfigString, type SourceCheckConfigSchema, type SourceCheckConnector } from "@supplystrata/source-connectors";
import {
  asmlIrAdapter,
  companyIrExplicitUrlAdapter,
  createOfficialIrAdapterContext,
  micronIrAdapter,
  samsungIrAdapter,
  skHynixIrAdapter,
  tsmcIrAdapter,
  type AsmlIrInput,
  type CompanyIrExplicitUrlInput,
  type MicronIrInput,
  type SamsungIrInput,
  type SkHynixIrInput,
  type TsmcIrInput
} from "./official-ir-adapters.js";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";

export const officialIrSourceCheckConnectors: readonly SourceCheckConnector<DatabaseStore, SourceCheckSummary>[] = [
  {
    source_adapter_id: "company-ir",
    target_kind: "official-html-disclosure",
    config_schema: companyIrConfigSchema(),
    run(store, target) {
      return runSourceAdapterCheck(store, {
        adapter: companyIrExplicitUrlAdapter,
        adapterInput: companyIrExplicitUrlInputFromConfig(target.target_config),
        context: createOfficialIrAdapterContext(),
        options: { checkTargetId: target.check_target_id, failureCausedBy: "source-check.company-ir" }
      });
    }
  },
  {
    source_adapter_id: "tsmc-ir",
    target_kind: "official-html-disclosure",
    config_schema: officialIrConfigSchema("ENT-TSMC"),
    run(store, target) {
      return runSourceAdapterCheck(store, {
        adapter: tsmcIrAdapter,
        adapterInput: tsmcIrInputFromConfig(target.target_config),
        context: createOfficialIrAdapterContext(),
        options: { checkTargetId: target.check_target_id, failureCausedBy: "source-check.tsmc-ir" }
      });
    }
  },
  {
    source_adapter_id: "samsung-ir",
    target_kind: "official-html-disclosure",
    config_schema: officialIrConfigSchema("ENT-SAMSUNG-ELECTRONICS"),
    run(store, target) {
      return runSourceAdapterCheck(store, {
        adapter: samsungIrAdapter,
        adapterInput: samsungIrInputFromConfig(target.target_config),
        context: createOfficialIrAdapterContext(),
        options: { checkTargetId: target.check_target_id, failureCausedBy: "source-check.samsung-ir" }
      });
    }
  },
  {
    source_adapter_id: "skhynix-ir",
    target_kind: "official-html-disclosure",
    config_schema: officialIrConfigSchema("ENT-SKHYNIX"),
    run(store, target) {
      return runSourceAdapterCheck(store, {
        adapter: skHynixIrAdapter,
        adapterInput: skHynixIrInputFromConfig(target.target_config),
        context: createOfficialIrAdapterContext(),
        options: { checkTargetId: target.check_target_id, failureCausedBy: "source-check.skhynix-ir" }
      });
    }
  },
  {
    source_adapter_id: "asml-ir",
    target_kind: "official-html-disclosure",
    config_schema: officialIrConfigSchema("ENT-ASML"),
    run(store, target) {
      return runSourceAdapterCheck(store, {
        adapter: asmlIrAdapter,
        adapterInput: asmlIrInputFromConfig(target.target_config),
        context: createOfficialIrAdapterContext(),
        options: { checkTargetId: target.check_target_id, failureCausedBy: "source-check.asml-ir" }
      });
    }
  },
  {
    source_adapter_id: "micron-ir",
    target_kind: "official-html-disclosure",
    config_schema: officialIrConfigSchema("ENT-MICRON"),
    run(store, target) {
      return runSourceAdapterCheck(store, {
        adapter: micronIrAdapter,
        adapterInput: micronIrInputFromConfig(target.target_config),
        context: createOfficialIrAdapterContext(),
        options: { checkTargetId: target.check_target_id, failureCausedBy: "source-check.micron-ir" }
      });
    }
  }
];

function companyIrConfigSchema(): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "year", type: "positive_integer", required: true, description: "Disclosure year to fetch." },
      { key: "entity_id", type: "string", required: true, description: "SupplyStrata entity id for the official IR page owner." },
      { key: "url", type: "string", required: true, description: "Explicit audited HTTPS URL for the official company IR disclosure page." }
    ]
  };
}

function officialIrConfigSchema(entityId: string): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "year", type: "positive_integer", required: true, description: "Disclosure year to fetch." },
      { key: "entity_id", type: "string", required: true, description: "Expected official disclosure entity id.", allowed_values: [entityId] }
    ]
  };
}

export function tsmcIrInputFromConfig(config: Record<string, unknown>): TsmcIrInput {
  return { year: requireYear(config, "TSMC IR source check target"), entityId: requireLiteralEntity(config, "ENT-TSMC", "TSMC IR source check target") };
}

export function samsungIrInputFromConfig(config: Record<string, unknown>): SamsungIrInput {
  return {
    year: requireYear(config, "Samsung IR source check target"),
    entityId: requireLiteralEntity(config, "ENT-SAMSUNG-ELECTRONICS", "Samsung IR source check target")
  };
}

export function skHynixIrInputFromConfig(config: Record<string, unknown>): SkHynixIrInput {
  return {
    year: requireYear(config, "SK hynix IR source check target"),
    entityId: requireLiteralEntity(config, "ENT-SKHYNIX", "SK hynix IR source check target")
  };
}

export function asmlIrInputFromConfig(config: Record<string, unknown>): AsmlIrInput {
  return { year: requireYear(config, "ASML IR source check target"), entityId: requireLiteralEntity(config, "ENT-ASML", "ASML IR source check target") };
}

export function micronIrInputFromConfig(config: Record<string, unknown>): MicronIrInput {
  return { year: requireYear(config, "Micron IR source check target"), entityId: requireLiteralEntity(config, "ENT-MICRON", "Micron IR source check target") };
}

export function companyIrExplicitUrlInputFromConfig(config: Record<string, unknown>): CompanyIrExplicitUrlInput {
  const label = "Company IR source check target";
  return {
    year: requireYear(config, label),
    entityId: requireConfigString(config, "entity_id", label),
    url: requireHttpsUrl(config, "url", label)
  };
}

function requireYear(config: Record<string, unknown>, label: string): number {
  const year = optionalConfigPositiveInteger(config, "year", label);
  if (year === undefined) throw new Error(`${label} year must be a positive integer`);
  if (year < 2000 || year > 2100) throw new Error(`${label} year is outside supported range: ${year}`);
  return year;
}

function requireLiteralEntity<TExpected extends string>(config: Record<string, unknown>, expected: TExpected, label: string): TExpected {
  const value = requireConfigString(config, "entity_id", label);
  if (value !== expected) throw new Error(`${label} entity_id must be ${expected}`);
  return expected;
}

function requireHttpsUrl(config: Record<string, unknown>, key: string, label: string): string {
  const value = requireConfigString(config, key, label);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} ${key} must be a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} ${key} must use https`);
  return value;
}
