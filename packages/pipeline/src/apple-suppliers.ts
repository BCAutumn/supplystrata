import { saveNormalizedDocument, type DatabaseStore } from "@supplystrata/db";
import { buildSupplierListReviewCandidate } from "@supplystrata/review-candidates";
import { enqueueReviewCandidates } from "@supplystrata/review-store";
import {
  appleSuppliersAdapter,
  createAppleSuppliersAdapterContext,
  extractAppleSupplierCandidates,
  type AppleSuppliersInput
} from "@supplystrata/sources-apple-suppliers";
import { recordSavedDocumentObservation } from "./document-observations.js";
import { fetchAndNormalizeFirstTask } from "./source-documents.js";
import type { ReviewEnqueueSummary } from "./types.js";

export async function enqueueAppleSupplierReviewCandidates(
  store: DatabaseStore,
  input: AppleSuppliersInput = { fiscalYear: 2022, entityId: "ENT-APPLE" }
): Promise<ReviewEnqueueSummary> {
  const { raw, normalized, sourceDate } = await fetchAndNormalizeFirstTask({
    adapter: appleSuppliersAdapter,
    input,
    context: createAppleSuppliersAdapterContext(),
    logLabel: "Apple Supplier List"
  });
  const saved = await saveNormalizedDocument(store, normalized);
  await recordSavedDocumentObservation(store, normalized, saved.doc_id);
  const candidates = extractAppleSupplierCandidates(normalized, input.fiscalYear).map((candidate) =>
    buildSupplierListReviewCandidate({
      candidate,
      docId: saved.doc_id,
      sourceUrl: raw.url,
      ...(sourceDate === undefined ? {} : { sourceDate })
    })
  );
  const result = await enqueueReviewCandidates(store, candidates);
  return {
    doc_id: saved.doc_id,
    source_url: raw.url,
    candidates: candidates.length,
    inserted: result.inserted,
    skipped: result.skipped
  };
}
