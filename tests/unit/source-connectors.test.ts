import { describe, expect, it } from "vitest";
import {
  connectorKey,
  listSourceCheckConnectorCapabilities,
  optionalConfigPositiveInteger,
  requireConfigString,
  requireConfigStringArray,
  runSourceCheckConnector,
  unsupportedSourceCheckTargetMessage,
  type SourceCheckConnector,
  type SourceCheckTargetRow
} from "@supplystrata/source-connectors";

interface TestStore {
  readonly label: string;
}

interface TestSummary {
  readonly task_id: string;
}

describe("source-connectors", () => {
  it("runs a registered source check connector by source adapter and target kind", async () => {
    const connector: SourceCheckConnector<TestStore, TestSummary> = {
      source_adapter_id: "example-source",
      target_kind: "example-target",
      async run(store, target) {
        return [{ task_id: `${store.label}:${target.check_target_id}` }];
      }
    };

    const result = await runSourceCheckConnector({ label: "store" }, targetRow("example-source", "example-target"), [connector], connectorContext());

    expect(result).toEqual([{ task_id: "store:target-1" }]);
  });

  it("reports supported connector keys for unsupported targets", async () => {
    const connectors: SourceCheckConnector<TestStore, TestSummary>[] = [
      {
        source_adapter_id: "sec-edgar",
        target_kind: "sec-company-filings",
        credential_requirements: [{ env_key: "SEC_TEST_KEY", required: true, description: "Fixture key." }],
        async run() {
          return [];
        }
      }
    ];

    await expect(runSourceCheckConnector({ label: "store" }, targetRow("dart-kr", "company-filings"), connectors, connectorContext())).rejects.toThrow(
      "Unsupported due source target: dart-kr/company-filings"
    );
    expect(unsupportedSourceCheckTargetMessage(targetRow("dart-kr", "company-filings"), connectors)).toContain("supported: sec-edgar/sec-company-filings");
    expect(listSourceCheckConnectorCapabilities(connectors)).toEqual([
      {
        source_adapter_id: "sec-edgar",
        target_kind: "sec-company-filings",
        key: "sec-edgar/sec-company-filings",
        credential_requirements: [{ env_key: "SEC_TEST_KEY", required: true, description: "Fixture key." }]
      }
    ]);
  });

  it("validates target config fields without source-specific casts", () => {
    const config = { cik: "0001045810", form_types: ["10-K", "10-Q"], limit: 2 };

    expect(requireConfigString(config, "cik", "SEC target")).toBe("0001045810");
    expect(requireConfigStringArray(config, "form_types", "SEC target")).toEqual(["10-K", "10-Q"]);
    expect(optionalConfigPositiveInteger(config, "limit", "SEC target")).toBe(2);
    expect(connectorKey({ source_adapter_id: "sec-edgar", target_kind: "sec-company-filings" })).toBe("sec-edgar/sec-company-filings");
  });
});

function targetRow(sourceAdapterId: string, targetKind: string): SourceCheckTargetRow {
  return {
    check_target_id: "target-1",
    source_adapter_id: sourceAdapterId,
    target_kind: targetKind,
    target_config: {}
  };
}

function connectorContext() {
  return {
    adapter_context_input: {
      userAgent: "SupplyStrata test contact@example.com",
      objectStoreBase: "./data/raw"
    }
  };
}
