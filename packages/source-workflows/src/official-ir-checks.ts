import type { DatabaseStore } from "@supplystrata/db";
import { optionalConfigPositiveInteger, requireConfigString, type SourceCheckConfigSchema, type SourceCheckConnector } from "@supplystrata/source-connectors";
import {
  asmlIrAdapter,
  createOfficialIrAdapterContext,
  samsungIrAdapter,
  skHynixIrAdapter,
  tsmcIrAdapter,
  type AsmlIrInput,
  type SamsungIrInput,
  type SkHynixIrInput,
  type TsmcIrInput
} from "./official-ir-adapters.js";
import { runSourceAdapterCheck, type SourceCheckSummary } from "./source-check-runner.js";

export const officialIrSourceCheckConnectors: readonly SourceCheckConnector<DatabaseStore, SourceCheckSummary>[] = [
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
  }
];

function officialIrConfigSchema(entityId: string): SourceCheckConfigSchema {
  return {
    fields: [
      { key: "year", type: "positive_integer", required: true, description: "Disclosure year to fetch." },
      { key: "entity_id", type: "string", required: true, description: "Expected official disclosure entity id.", allowed_values: [entityId] }
    ]
  };
}

function tsmcIrInputFromConfig(config: Record<string, unknown>): TsmcIrInput {
  return { year: requireYear(config, "TSMC IR source check target"), entityId: requireLiteralEntity(config, "ENT-TSMC", "TSMC IR source check target") };
}

function samsungIrInputFromConfig(config: Record<string, unknown>): SamsungIrInput {
  return {
    year: requireYear(config, "Samsung IR source check target"),
    entityId: requireLiteralEntity(config, "ENT-SAMSUNG-ELECTRONICS", "Samsung IR source check target")
  };
}

function skHynixIrInputFromConfig(config: Record<string, unknown>): SkHynixIrInput {
  return {
    year: requireYear(config, "SK hynix IR source check target"),
    entityId: requireLiteralEntity(config, "ENT-SKHYNIX", "SK hynix IR source check target")
  };
}

function asmlIrInputFromConfig(config: Record<string, unknown>): AsmlIrInput {
  return { year: requireYear(config, "ASML IR source check target"), entityId: requireLiteralEntity(config, "ENT-ASML", "ASML IR source check target") };
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
