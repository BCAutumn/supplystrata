import { createHash } from "node:crypto";
import { createId, loadEnv, type FetchTask, type RawDocument } from "@supplystrata/core";
import { FsObjectStore } from "@supplystrata/object-store";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";

export type SecEdgarFormType = "10-K" | "10-Q" | "20-F" | "8-K";

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

export const secEdgarAdapter: SourceAdapter<SecEdgarInput, Uint8Array> = {
  id: "sec-edgar",
  tier: "P0",
  description: "SEC EDGAR official filings API",
  tos_url: "https://www.sec.gov/os/accessing-edgar-data",
  rate_limit: { requests: 5, per_seconds: 1 },
  async *plan(input, ctx) {
    const cik10 = normalizeCik(input.cik);
    const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik10}.json`;
    const response = await fetch(submissionsUrl, { headers: { "User-Agent": ctx.userAgent } });
    if (!response.ok) throw new Error(`SEC submissions failed: ${response.status} ${response.statusText}`);
    const payload = parseSubmissionPayload(await response.json());
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
    const response = await fetch(task.url, { headers: { "User-Agent": ctx.userAgent } });
    if (!response.ok) throw new Error(`SEC filing fetch failed: ${response.status} ${response.statusText}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const entityPart = task.hint?.entity_id ?? "unknown";
    const period = task.hint?.period ?? new Date().toISOString().slice(0, 10);
    const storageKey = `sec-edgar/${entityPart}/${period.slice(0, 4)}/${period.slice(5, 7)}/${sha256}.html`;
    await new FsObjectStore(loadEnv().OBJECT_STORE_FS_BASE).put(storageKey, bytes);
    return {
      doc_id: createId("DOC"),
      source_adapter_id: "sec-edgar",
      url: task.url,
      fetched_at: ctx.now().toISOString(),
      bytes_sha256: sha256,
      storage_key: storageKey,
      body: bytes,
      metadata: {
        task_id: task.task_id,
        document_type: task.hint?.document_type ?? "10-K",
        primary_entity_id: task.hint?.entity_id,
        source_date: task.hint?.period
      }
    };
  },
  async normalize(raw) {
    const primaryEntityId = stringMetadata(raw, "primary_entity_id");
    const sourceDate = stringMetadata(raw, "source_date");
    const documentType = secDocumentTypeFromMetadata(raw.metadata["document_type"]);
    return {
      doc_id: raw.doc_id,
      source_adapter_id: raw.source_adapter_id,
      document_type: documentType,
      language: "en",
      fetched_at: raw.fetched_at,
      source_url: raw.url,
      storage_key: raw.storage_key,
      bytes_sha256: raw.bytes_sha256,
      text: "",
      chunks: [],
      metadata: raw.metadata,
      ...(primaryEntityId === undefined ? {} : { primary_entity_id: primaryEntityId }),
      ...(sourceDate === undefined ? {} : { source_date: sourceDate })
    };
  }
};

export function normalizeCik(cik: string): string {
  const digits = cik.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 10) throw new Error(`Invalid CIK: ${cik}`);
  return digits.padStart(10, "0");
}

export function createAdapterContext(): AdapterContext {
  return { userAgent: loadEnv().SEC_USER_AGENT, now: () => new Date() };
}

export function isSecEdgarFormType(value: string): value is SecEdgarFormType {
  return value === "10-K" || value === "10-Q" || value === "20-F" || value === "8-K";
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
  return { filings: { recent: {
    accessionNumber: readStringArray(recent, "accessionNumber"),
    primaryDocument: readStringArray(recent, "primaryDocument"),
    form: readStringArray(recent, "form"),
    filingDate: readStringArray(recent, "filingDate")
  } } };
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

function stringMetadata(raw: RawDocument<Uint8Array>, key: string): string | undefined {
  const value = raw.metadata[key];
  return typeof value === "string" ? value : undefined;
}

function secDocumentTypeFromMetadata(value: unknown): SecEdgarFormType {
  return typeof value === "string" && isSecEdgarFormType(value) ? value : "10-K";
}
