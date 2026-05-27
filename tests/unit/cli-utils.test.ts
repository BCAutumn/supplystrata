import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DueSourceCheckRow } from "@supplystrata/source-monitor";
import { formatCliError, parseJsonObject, parseTradeDirections } from "../../apps/cli/src/cli-utils.js";
import { buildSourceCheckTargetIdsFromSourcePlanFile } from "../../apps/cli/src/source-check-options.js";
import { renderDueSources } from "../../apps/cli/src/source-render.js";

describe("CLI error formatting", () => {
  it("turns nested connection refusal into an actionable message", () => {
    const message = formatCliError({
      errors: [
        {
          code: "ECONNREFUSED",
          address: "127.0.0.1",
          port: 5432
        }
      ]
    });

    expect(message).toContain("A local database service is not reachable.");
    expect(message).toContain("POSTGRES_URL");
    expect(message).toContain("NEO4J_URI");
    expect(message).toContain("pnpm cli preview sec-edgar --cik <cik> --entity <entity-id> --format json");
  });

  it("preserves ordinary error messages", () => {
    expect(formatCliError(new Error("bad input"))).toBe("bad input");
  });
});

describe("CLI option parsing", () => {
  it("parses trade directions through one shared parser", () => {
    expect(parseTradeDirections("imports,exports,imports")).toEqual(["exports", "imports"]);
  });

  it("rejects non-object JSON config without type assertions", () => {
    expect(() => parseJsonObject("[]", "--config")).toThrow("--config must be a JSON object");
  });

  it("prefers embedded check target ids when a source-plan batch targets already-synced rows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "supplystrata-source-plan-"));
    const sourcePlanPath = join(dir, "batch.json");
    await writeFile(
      sourcePlanPath,
      JSON.stringify({
        schema_version: "1.0.0",
        check_target_ids: [
          "plan:gate1-db-monitoring-config-check:micron-ir:official-html-disclosure:64939e541a7ec958",
          "plan:nvidia-memory-2025:sec-edgar:sec-company-facts:5c40fc865f66f81f"
        ],
        source_plan: []
      })
    );

    await expect(buildSourceCheckTargetIdsFromSourcePlanFile({ sourcePlan: sourcePlanPath })).resolves.toEqual([
      "plan:gate1-db-monitoring-config-check:micron-ir:official-html-disclosure:64939e541a7ec958",
      "plan:nvidia-memory-2025:sec-edgar:sec-company-facts:5c40fc865f66f81f"
    ]);
    await expect(buildSourceCheckTargetIdsFromSourcePlanFile({ sourcePlan: sourcePlanPath, sourceAdapterIds: ["micron-ir"] })).resolves.toEqual([
      "plan:gate1-db-monitoring-config-check:micron-ir:official-html-disclosure:64939e541a7ec958"
    ]);
    await expect(
      buildSourceCheckTargetIdsFromSourcePlanFile({
        sourcePlan: sourcePlanPath,
        checkTargetIds: ["plan:nvidia-memory-2025:sec-edgar:sec-company-facts:5c40fc865f66f81f"]
      })
    ).resolves.toEqual(["plan:nvidia-memory-2025:sec-edgar:sec-company-facts:5c40fc865f66f81f"]);
  });
});

describe("CLI source rendering", () => {
  it("renders effective target-level cadence for due source checks", () => {
    const row: DueSourceCheckRow = {
      check_target_id: "target-1",
      source_adapter_id: "sec-edgar",
      target_kind: "sec-company-filings",
      subject_entity_id: "ENT-NVIDIA",
      target_config: {},
      target_enabled: true,
      target_priority: 10,
      target_config_source: "source-plan.json",
      target_notes: null,
      policy_enabled: true,
      check_cadence_minutes: 720,
      jitter_minutes: 0,
      effective_check_cadence_minutes: 10_080,
      effective_jitter_minutes: 120,
      effective_max_attempts: 3,
      effective_backoff_base_minutes: 2,
      effective_backoff_max_minutes: 120,
      policy_priority: 10,
      policy_config_source: "source-policy.json",
      next_check_at: new Date("2026-05-24T00:00:00.000Z"),
      policy_notes: null
    };

    const markdown = renderDueSources([row], "markdown");

    expect(markdown).toContain("cadence: 7d");
    expect(markdown).not.toContain("cadence: 12h");
  });
});
