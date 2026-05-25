import { describe, expect, it } from "vitest";
import { buildSourceTargetObservationReview } from "@supplystrata/research-pack";

describe("research-pack source target observation review", () => {
  it("turns source target metric coverage into deterministic observation review seeds", () => {
    const review = buildSourceTargetObservationReview([
      {
        expected_target: {
          check_target_id: "plan:nvidia-memory-2025:sec-edgar:companyfacts:abc",
          source_adapter_id: "sec-edgar",
          target_kind: "sec-company-facts",
          enabled: true,
          subject_entity_id: "ENT-NVIDIA",
          target_config: { cik: "0001045810" }
        },
        synced: true,
        match_kind: "check_target_id",
        matched_check_target_id: "plan:nvidia-memory-2025:sec-edgar:companyfacts:abc",
        state: "succeeded",
        target_enabled: true,
        policy_enabled: true,
        next_check_at: null,
        effective_check_cadence_minutes: 10080,
        effective_jitter_minutes: 120,
        latest_job: null,
        latest_event: null,
        observations: 7,
        observations_by_metric: {
          purchase_obligations: 2,
          revenue: 5
        },
        observation_samples: [
          {
            observation_id: "OBS-PO-1",
            observation_type: "FINANCIAL_METRIC_OBSERVATION",
            metric_name: "purchase_obligations",
            metric_value: "42",
            metric_unit: "USD",
            baseline_value: "21",
            change_percent: 100,
            scope_kind: "company",
            scope_id: "ENT-NVIDIA",
            doc_id: "DOC-PO-1",
            source_item_id: "SRCITEM-PO-1",
            source_url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json",
            time_window_start: "2025-01-01",
            time_window_end: "2025-12-31",
            confidence: 0.95
          }
        ],
        latest_observation_at: "2026-01-01T00:00:00.000Z"
      }
    ]);

    expect(review.summary).toEqual({
      review_items: 2,
      calibration_candidates: 1,
      labeled_calibration_candidates: 0,
      unlabeled_calibration_candidates: 1,
      next_labeling_batch_candidates: 1,
      p0: 1,
      p1: 0,
      p2: 1,
      by_category: {
        supply_chain_signal: 1,
        financial_context: 1,
        metric_mapping_gap: 0
      },
      by_recommended_label: {
        useful_signal: 1,
        background_context: 0,
        needs_context: 0,
        not_useful: 0
      },
      by_persisted_label: {
        useful_signal: 0,
        background_context: 0,
        needs_context: 0,
        not_useful: 0
      },
      next_labeling_batch_by_priority: { P0: 1, P1: 0, P2: 0 },
      next_labeling_batch_by_metric: { purchase_obligations: 1 }
    });
    expect(review.items[0]).toMatchObject({
      metric_name: "purchase_obligations",
      priority: "P0",
      category: "supply_chain_signal",
      review_policy: "review_only_no_fact_mutation"
    });
    expect(review.items[0]?.sample_observations).toEqual([
      expect.objectContaining({
        observation_id: "OBS-PO-1",
        doc_id: "DOC-PO-1",
        source_item_id: "SRCITEM-PO-1"
      })
    ]);
    expect(review.calibration_candidates).toEqual([
      expect.objectContaining({
        candidate_id: "observation-calibration:purchase_obligations:OBS-PO-1",
        observation_id: "OBS-PO-1",
        metric_name: "purchase_obligations",
        priority: "P0",
        category: "supply_chain_signal",
        recommended_label: "useful_signal",
        allowed_labels: ["useful_signal", "background_context", "needs_context", "not_useful"],
        review_policy: "review_only_no_fact_mutation",
        review_status: "unlabeled",
        latest_label: null,
        existing_labels: [],
        doc_id: "DOC-PO-1",
        source_item_id: "SRCITEM-PO-1",
        source_url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json"
      })
    ]);
    expect(review.items[1]).toMatchObject({
      metric_name: "revenue",
      priority: "P2",
      category: "financial_context"
    });
    expect(review.labeling_plan).toMatchObject({
      strategy: "stratified_unlabeled_by_priority_metric",
      review_policy: "review_only_no_fact_mutation",
      batch_size: 12,
      candidates: [
        expect.objectContaining({
          candidate_id: "observation-calibration:purchase_obligations:OBS-PO-1",
          observation_id: "OBS-PO-1",
          recommended_label: "useful_signal"
        })
      ]
    });
  });

  it("feeds persisted observation calibration labels back into review output", () => {
    const review = buildSourceTargetObservationReview(
      [
        {
          expected_target: {
            check_target_id: "plan:nvidia-memory-2025:sec-edgar:companyfacts:abc",
            source_adapter_id: "sec-edgar",
            target_kind: "sec-company-facts",
            enabled: true,
            subject_entity_id: "ENT-NVIDIA",
            target_config: { cik: "0001045810" }
          },
          synced: true,
          match_kind: "check_target_id",
          matched_check_target_id: "plan:nvidia-memory-2025:sec-edgar:companyfacts:abc",
          state: "succeeded",
          target_enabled: true,
          policy_enabled: true,
          next_check_at: null,
          effective_check_cadence_minutes: 10080,
          effective_jitter_minutes: 120,
          latest_job: null,
          latest_event: null,
          observations: 1,
          observations_by_metric: { purchase_obligations: 1 },
          observation_samples: [
            {
              observation_id: "OBS-PO-1",
              observation_type: "FINANCIAL_METRIC_OBSERVATION",
              metric_name: "purchase_obligations",
              metric_value: "42",
              metric_unit: "USD",
              baseline_value: "21",
              change_percent: 100,
              scope_kind: "company",
              scope_id: "ENT-NVIDIA",
              doc_id: "DOC-PO-1",
              source_item_id: "SRCITEM-PO-1",
              source_url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0001045810.json",
              time_window_start: "2025-01-01",
              time_window_end: "2025-12-31",
              confidence: 0.95
            }
          ],
          latest_observation_at: "2026-01-01T00:00:00.000Z"
        }
      ],
      [
        {
          label_id: "OBS-CAL-LABEL-1",
          observation_id: "OBS-PO-1",
          candidate_id: "observation-calibration:purchase_obligations:OBS-PO-1",
          label: "useful_signal",
          reviewer: "unit-test",
          reviewed_at: "2026-05-25T00:00:00.000Z",
          rationale: "Useful purchase-obligation calibration seed."
        }
      ]
    );

    expect(review.summary.labeled_calibration_candidates).toBe(1);
    expect(review.summary.unlabeled_calibration_candidates).toBe(0);
    expect(review.summary.next_labeling_batch_candidates).toBe(0);
    expect(review.summary.by_persisted_label.useful_signal).toBe(1);
    expect(review.labeling_plan.candidates).toEqual([]);
    expect(review.calibration_candidates[0]).toMatchObject({
      review_status: "labeled",
      latest_label: {
        label_id: "OBS-CAL-LABEL-1",
        label: "useful_signal",
        reviewer: "unit-test"
      },
      existing_labels: [
        expect.objectContaining({
          label_id: "OBS-CAL-LABEL-1",
          observation_id: "OBS-PO-1"
        })
      ]
    });
  });
});
