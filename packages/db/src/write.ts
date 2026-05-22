export type { DatabaseStore, DbClient, DbTxClient, DbRow } from "./client.js";
export { createDatabaseStore, dbTxClientBrand } from "./client.js";
export { updateAlertCandidateStatus, upsertAlertCandidate, type UpsertAlertCandidateInput } from "./alerts.js";
export { replaceEdgeCalibrationRun, upsertEdgeCalibrationLabel, type UpsertEdgeCalibrationLabelInput } from "./calibration.js";
export { insertChainSegment, insertChainSegments, insertChainView, type NewChainSegmentInput, type NewChainViewInput } from "./chain-views.js";
export {
  insertClaim,
  linkClaimEvidence,
  linkClaimUnknown,
  upsertClaim,
  type ClaimEvidenceRole,
  type ClaimStatus,
  type ClaimUnknownRole,
  type NewClaimInput
} from "./claims.js";
export { saveNormalizedDocument, saveNormalizedDocumentTx, type SavedDocumentRef } from "./documents.js";
export { deprecateEdge, type DeprecateEdgeInput, type EdgeDeprecationSourceRef } from "./edges.js";
export {
  claimDueGraphProjectionJobs,
  recordGraphProjectionFailure,
  markGraphProjectionJobFailed,
  markGraphProjectionJobSucceeded,
  markGraphProjectionJobsSucceeded,
  type GraphProjectionOperation
} from "./graph-projection-jobs.js";
export { refreshEdgeFreshness, upsertEdgeStrengthEstimate, type UpsertEdgeStrengthEstimateInput } from "./intelligence.js";
export {
  insertLeadObservation,
  insertObservation,
  correctObservationMeasurement,
  markLeadObservationInReview,
  markLeadObservationPromoted,
  patchObservationMetadata,
  upsertLeadObservation,
  upsertObservation,
  type LeadStatus,
  type NewLeadObservationInput,
  type NewObservationInput,
  type CorrectObservationMeasurementInput,
  type PatchObservationMetadataInput
} from "./observations.js";
export { recordPendingEntity } from "./pending.js";
export { recordSemanticChange, type SemanticChangeInput } from "./changes.js";
export { replaceRiskView, type ReplaceRiskViewInput } from "./risk.js";
export { resolveUnknownItem, upsertUnknownItem, type NewUnknownItemInput } from "./unknowns.js";
