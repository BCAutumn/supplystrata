import { loadEnv } from "@supplystrata/config";
import { defineHtmlSnapshotAdapter, type AdapterContext } from "@supplystrata/source-adapter-runtime";
import { normalizeHtmlDocument } from "@supplystrata/source-normalizers";

export interface AsmlIrInput {
  year: number;
  entityId: "ENT-ASML";
}

export const asmlIrAdapter = defineHtmlSnapshotAdapter<AsmlIrInput>({
  id: "asml-ir",
  tier: "P0",
  description: "ASML official annual report website",
  tos_url: "https://www.asml.com/en/investors/annual-report",
  rate_limit: { requests: 1, per_seconds: 3 },
  sourceLabel: "ASML annual report",
  storagePrefix: "company-ir/asml",
  async *plan(input) {
    yield {
      task_id: `asml-ir-annual-report-${input.year}`,
      url: annualReportUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
});

export function annualReportUrl(year: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error(`Invalid ASML annual report year: ${year}`);
  return `https://www.asml.com/en/investors/annual-report/${year}`;
}

export function createAsmlIrAdapterContext(): AdapterContext {
  return { userAgent: loadEnv().SEC_USER_AGENT, now: () => new Date() };
}
