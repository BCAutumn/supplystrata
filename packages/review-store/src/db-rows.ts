import type pg from "pg";
import type { ReviewCandidateKind, ReviewCandidateStatus } from "@supplystrata/review-candidates";

export interface ReviewCandidateRow extends pg.QueryResultRow {
  review_id: string;
  candidate_key: string | null;
  kind: ReviewCandidateKind;
  status: ReviewCandidateStatus;
  candidate: unknown;
  reviewer: string | null;
  reviewed_at: Date | null;
  decision_reason: string | null;
  created_at: Date;
}

export interface OfficialDisclosureSignalDispositionRow extends pg.QueryResultRow {
  change_id: string;
  review_id: string;
  after: Record<string, unknown> | null;
  caused_by: string;
  detected_at: Date;
}

export interface EntityAffiliationDispositionRow extends pg.QueryResultRow {
  change_id: string;
  context_id: string;
  after: Record<string, unknown> | null;
  caused_by: string;
  detected_at: Date;
}

export interface ReviewStatsRow extends pg.QueryResultRow {
  status: ReviewCandidateStatus;
  count: string;
}
