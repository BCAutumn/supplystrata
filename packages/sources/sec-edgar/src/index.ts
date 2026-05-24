import { isSecFormType, secFormTypeOrDefault, type FetchTask, type SecFormType } from "@supplystrata/core";
import {
  createAdapterContext as createRuntimeAdapterContext,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  persistRawDocumentSnapshot,
  type AdapterContext,
  type CreateAdapterContextInput,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeHtmlDocument } from "@supplystrata/source-normalizers";
import { normalizeCik } from "./cik.js";

export { normalizeCik } from "./cik.js";
export {
  companyFactsTask,
  parseSecCompanyFactObservations,
  secCompanyFactsAdapter,
  SEC_COMPANY_FACT_METRIC_DEFINITIONS,
  SEC_COMPANY_FACT_METRIC_NAMES,
  type SecCompanyFactMetricName,
  type SecCompanyFactObservationDraft,
  type SecCompanyFactsInput
} from "./company-facts.js";

export type SecEdgarFormType = SecFormType;

export interface SecEdgarInput {
  cik: string;
  entityId: string;
  formTypes: readonly SecEdgarFormType[];
  limit?: number;
}

interface SecRecentFilings {
  accessionNumber: string[];
  primaryDocument: string[];
  form: string[];
  filingDate: string[];
}

interface SecSubmissionPayload {
  filings: { recent: SecRecentFilings };
}

const secEdgarAdapterBase: SourceAdapter<SecEdgarInput, Uint8Array> = {
  id: "sec-edgar",
  tier: "P0",
  description: "SEC EDGAR official filings API",
  tos_url: "https://www.sec.gov/os/accessing-edgar-data",
  rate_limit: { requests: 5, per_seconds: 1 },
  async *plan(input, ctx) {
    const cik10 = normalizeCik(input.cik);
    const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik10}.json`;
    const payloadJson: unknown = JSON.parse(
      new TextDecoder().decode(await fetchBytesWithTimeout(submissionsUrl, { userAgent: ctx.userAgent, timeoutMs: 12_000, sourceLabel: "SEC submissions" }))
    );
    const payload = parseSubmissionPayload(payloadJson);
    const recent = payload.filings.recent;
    const maxTasks = Math.max(1, input.limit ?? 1);
    let yielded = 0;
    for (const [index, form] of recent.form.entries()) {
      if (!isSecEdgarFormType(form) || !input.formTypes.includes(form)) continue;
      const accession = requireString(recent.accessionNumber[index], "accessionNumber");
      const primaryDocument = requireString(recent.primaryDocument[index], "primaryDocument");
      const filingDate = requireString(recent.filingDate[index], "filingDate");
      const accessionNoDashes = accession.replace(/-/g, "");
      const cikNoLeadingZeros = String(Number(cik10));
      yield {
        task_id: `sec-edgar-${cik10}-${accession}`,
        url: `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros}/${accessionNoDashes}/${primaryDocument}`,
        expected_format: "html",
        hint: { entity_id: input.entityId, document_type: form, period: filingDate }
      };
      yielded += 1;
      if (yielded >= maxTasks) return;
    }
    if (yielded === 0) throw new Error(`No requested SEC filing found for CIK ${input.cik}`);
  },
  async fetch(task, ctx) {
    const bytes = await fetchBytesWithTimeout(task.url, { userAgent: ctx.userAgent, timeoutMs: 20_000, sourceLabel: "SEC filing" });
    const entityPart = task.hint?.entity_id ?? "unknown";
    const period = taskPeriod(task);
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "sec-edgar",
      url: task.url,
      body: bytes,
      metadata: {
        task_id: task.task_id,
        document_type: task.hint?.document_type ?? "10-K",
        primary_entity_id: task.hint?.entity_id,
        source_date: task.hint?.period
      },
      storageKeyForSha256: (sha256) => `sec-edgar/${entityPart}/${period.slice(0, 4)}/${period.slice(5, 7)}/${sha256}.html`
    });
  },
  async normalize(raw) {
    const documentType = secDocumentTypeFromMetadata(raw.metadata["document_type"]);
    return normalizeHtmlDocument({ raw, documentType });
  }
};

export const secEdgarAdapter = createRateLimitedSourceAdapter(secEdgarAdapterBase);

export function createAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createRuntimeAdapterContext(input);
}

function taskPeriod(task: FetchTask): string {
  const period = task.hint?.period;
  if (period === undefined) throw new Error(`SEC EDGAR task missing source period: ${task.task_id}`);
  return period;
}

export function isSecEdgarFormType(value: string): value is SecEdgarFormType {
  return isSecFormType(value);
}

function parseSubmissionPayload(value: unknown): SecSubmissionPayload {
  if (typeof value !== "object" || value === null || !("filings" in value)) {
    throw new Error("SEC submissions payload missing filings");
  }
  const filings = (value as { filings: unknown }).filings;
  if (typeof filings !== "object" || filings === null || !("recent" in filings)) {
    throw new Error("SEC submissions payload missing recent filings");
  }
  const recent = (filings as { recent: unknown }).recent;
  if (typeof recent !== "object" || recent === null) throw new Error("SEC recent filings payload invalid");
  return {
    filings: {
      recent: {
        accessionNumber: readStringArray(recent, "accessionNumber"),
        primaryDocument: readStringArray(recent, "primaryDocument"),
        form: readStringArray(recent, "form"),
        filingDate: readStringArray(recent, "filingDate")
      }
    }
  };
}

function readStringArray(source: unknown, key: keyof SecRecentFilings): string[] {
  const value = (source as Record<string, unknown>)[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`SEC recent filings field invalid: ${key}`);
  }
  return value;
}

function requireString(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) throw new Error(`Missing SEC value: ${name}`);
  return value;
}

function secDocumentTypeFromMetadata(value: unknown): SecEdgarFormType {
  return secFormTypeOrDefault(value);
}
