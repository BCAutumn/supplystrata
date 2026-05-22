import type { NormalizedDocument } from "@supplystrata/core";
import type { DbClient } from "@supplystrata/db";
import { buildOfficialDisclosureSignalReviewCandidate } from "@supplystrata/review-candidates";
import { enqueueReviewCandidates } from "@supplystrata/review-store";
import { extractOfficialDisclosureSignalsForSource, type OfficialDisclosureSignal } from "@supplystrata/signal-extractor";

export interface OfficialDisclosureSignalCandidateResult {
  inserted: number;
  skipped: number;
}

export async function enqueueOfficialDisclosureSignalReviewCandidates(
  client: DbClient,
  input: {
    normalized: NormalizedDocument;
    docId: string;
    sourceItemId: string;
  }
): Promise<OfficialDisclosureSignalCandidateResult> {
  const signals = extractOfficialDisclosureSignalsForSource(input.normalized.source_adapter_id, input.normalized.text);
  if (signals.length === 0) return { inserted: 0, skipped: 0 };
  const candidates = signals.map((signal) =>
    buildOfficialDisclosureSignalReviewCandidate({
      signal,
      docId: input.docId,
      sourceItemId: input.sourceItemId,
      sourceAdapterId: input.normalized.source_adapter_id,
      sourceUrl: input.normalized.source_url,
      ...(input.normalized.source_date === undefined ? {} : { sourceDate: input.normalized.source_date }),
      sourceLocator: locatorForSignal(input.normalized, signal)
    })
  );
  return enqueueReviewCandidates(client, candidates);
}

function locatorForSignal(normalized: NormalizedDocument, signal: OfficialDisclosureSignal): string {
  const cite = normalizeText(signal.cite_text);
  const chunk = normalized.chunks.find((item) => normalizeText(item.text).includes(cite));
  return chunk?.locator ?? "document";
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}
