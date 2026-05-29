import { describe, expect, it } from "vitest";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

const FORBIDDEN_SCBOM_KEYS = [
  "attention_id",
  "attention_queue",
  "automatic_fact_mutation_allowed",
  "claim_id",
  "conflict_adjudication",
  "conflict_review",
  "draft_claims",
  "fact_write_policy",
  "failure_count",
  "intelligence",
  "review_id",
  "review_queue",
  "risk_metric_id",
  "risk_view_id",
  "source_plan",
  "supplystrata_internal_state"
] as const;

describe("SCBOM private-field guard", () => {
  it("does not leak SupplyStrata runtime or review state keys", () => {
    const document = toScbomDocument(workbenchScbomFixture());
    const keys = collectKeys(document);

    for (const forbiddenKey of FORBIDDEN_SCBOM_KEYS) {
      expect(keys.has(forbiddenKey), `${forbiddenKey} leaked into SCBOM export`).toBe(false);
    }
  });
});

function collectKeys(value: unknown): Set<string> {
  const keys = new Set<string>();
  collectKeysInto(value, keys);
  return keys;
}

function collectKeysInto(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeysInto(item, keys);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeysInto(child, keys);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
