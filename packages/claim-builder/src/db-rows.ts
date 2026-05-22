import type pg from "pg";
import type { DocumentType } from "@supplystrata/core";
import type { ClaimStatus } from "@supplystrata/db";
import type { ClaimableFactEdge } from "./claim-drafts.js";
import type { ClaimFusionEvidence } from "./claim-fusion.js";

export interface ClaimableFactEdgeRow extends pg.QueryResultRow, ClaimableFactEdge {}

export interface ClaimFusionEvidenceRow extends pg.QueryResultRow, ClaimFusionEvidence {}

export interface MatchingActiveClaimRow extends pg.QueryResultRow {
  claim_id: string;
  edge_id: string | null;
}

export interface ClaimConflictTargetRow extends pg.QueryResultRow {
  claim_id: string;
  claim_text: string;
  status: string;
  edge_id: string | null;
}

export interface ClaimConflictEvidenceRow extends pg.QueryResultRow {
  evidence_id: string;
  doc_id: string;
  cite_locator: string | null;
  source_adapter_id: string;
  document_type: DocumentType;
}

export interface ClaimUnknownLinkRow extends pg.QueryResultRow {
  claim_id: string;
}

export interface ClaimConflictReviewScanRow extends pg.QueryResultRow {
  claim_id: string;
  claim_text: string;
  status: "draft" | "active";
  edge_id: string | null;
}

export interface ClaimLifecycleStatusUpdateRow extends pg.QueryResultRow {
  claim_id: string;
  status: ClaimStatus;
}

export interface ClaimLifecycleSourceRefRow extends pg.QueryResultRow {
  id: string;
}
