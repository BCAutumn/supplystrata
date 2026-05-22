import { describe, expect, it } from "vitest";
import {
  listSourceCheckConnectorIds,
  listSourcePlanSmokeRunnerIds,
  runSourcePlanConnectivitySmoke,
  selectSourcePlanSmokeTargets,
  type SourcePlanSmokeTarget
} from "@supplystrata/source-workflows";

const TARGETS: SourcePlanSmokeTarget[] = [
  {
    check_target_id: "plan:test:sec",
    source_adapter_id: "sec-edgar",
    target_kind: "sec-company-filings",
    target_config: {
      cik: "0001045810",
      entity_id: "ENT-NVIDIA",
      form_types: ["10-K"],
      limit: 1
    }
  },
  {
    check_target_id: "plan:test:dart",
    source_adapter_id: "dart-kr",
    target_kind: "company-filings",
    target_config: {
      corp_code: "00164779",
      entity_id: "ENT-SKHYNIX",
      disclosure_types: ["A"],
      year: 2025
    }
  },
  {
    check_target_id: "plan:test:unknown",
    source_adapter_id: "unknown-official-source",
    target_kind: "company-filings",
    target_config: {}
  },
  {
    check_target_id: "plan:test:edinet",
    source_adapter_id: "edinet",
    target_kind: "daily-filings",
    target_config: {
      date: "2026-01-01",
      type: "2",
      scope_kind: "component",
      scope_id: "COMP-SILICON-WAFER"
    }
  }
];

describe("source-plan connectivity smoke", () => {
  it("keeps smoke runner coverage aligned with source check connectors", () => {
    expect(listSourcePlanSmokeRunnerIds()).toEqual(listSourceCheckConnectorIds());
  });

  it("selects source-plan smoke targets with source filters and limit before network work", () => {
    const selected = selectSourcePlanSmokeTargets({
      targets: TARGETS,
      source_adapter_ids: ["dart-kr", "unknown-official-source"],
      limit: 1
    });

    expect(selected.map((target) => target.check_target_id)).toEqual(["plan:test:dart"]);
  });

  it("reports unsupported generated targets as skipped without crashing the smoke report", async () => {
    const report = await runSourcePlanConnectivitySmoke({
      targets: TARGETS,
      source_adapter_ids: ["unknown-official-source"]
    });

    expect(report.summary).toMatchObject({
      requested_targets: 4,
      selected_targets: 1,
      checked_targets: 0,
      failed_targets: 0,
      skipped_targets: 1,
      planned_tasks: 0,
      fetched_documents: 0,
      normalized_documents: 0
    });
    expect(report.summary.by_source_status["unknown-official-source"]).toEqual({
      selected_targets: 1,
      checked_targets: 0,
      failed_targets: 0,
      skipped_targets: 1,
      planned_tasks: 0,
      fetched_documents: 0,
      normalized_documents: 0,
      degraded_documents: 0,
      target_kinds: { "company-filings": 1 },
      issue_kinds: { connector_unsupported: 1 }
    });
    const [item] = report.items;
    expect(item?.check_target_id).toBe("plan:test:unknown");
    expect(item?.status).toBe("skipped");
    expect(item?.issue_kind).toBe("connector_unsupported");
    expect(item?.error_message).toContain("Unsupported source-plan smoke target");
  });

  it("keeps target config failures inside the per-target smoke report", async () => {
    const report = await runSourcePlanConnectivitySmoke({
      targets: [
        {
          check_target_id: "plan:test:bad-sec",
          source_adapter_id: "sec-edgar",
          target_kind: "sec-company-filings",
          target_config: {
            cik: "0001045810",
            entity_id: "ENT-NVIDIA",
            form_types: ["10-X"]
          }
        }
      ]
    });

    expect(report.summary.failed_targets).toBe(1);
    expect(report.summary.by_source_status["sec-edgar"]?.issue_kinds).toEqual({ target_config_invalid: 1 });
    const [item] = report.items;
    expect(item?.status).toBe("failed");
    expect(item?.issue_kind).toBe("target_config_invalid");
    expect(item?.error_message).toContain("Unsupported SEC source check form type");
  });

  it("classifies missing connector credentials before network work", async () => {
    const previous = process.env["EDINET_API_KEY"];
    process.env["EDINET_API_KEY"] = "";
    try {
      const report = await runSourcePlanConnectivitySmoke({
        targets: TARGETS,
        source_adapter_ids: ["edinet"]
      });

      expect(report.summary.failed_targets).toBe(1);
      expect(report.summary.by_source_status["edinet"]?.issue_kinds).toEqual({ missing_credentials: 1 });
      const [item] = report.items;
      expect(item?.issue_kind).toBe("missing_credentials");
      expect(item?.planned_tasks).toBe(0);
      expect(item?.missing_credentials).toEqual([
        { env_key: "EDINET_API_KEY", required: true, description: "Japan FSA EDINET API v2 key used for documents.json daily filing list monitoring." }
      ]);
      expect(item?.error_message).toContain("Missing required source credentials: EDINET_API_KEY");
    } finally {
      if (previous === undefined) delete process.env["EDINET_API_KEY"];
      else process.env["EDINET_API_KEY"] = previous;
    }
  });
});
