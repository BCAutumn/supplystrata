import { loadEnv } from "@supplystrata/config";
import { defineHtmlSnapshotAdapter, type AdapterContext } from "@supplystrata/source-adapter-spec";
import { normalizeHtmlDocument } from "@supplystrata/source-normalizers";

export interface TsmcIrInput {
  year: number;
  entityId: "ENT-TSMC";
}

export const tsmcIrAdapter = defineHtmlSnapshotAdapter<TsmcIrInput>({
  id: "tsmc-ir",
  tier: "P0",
  description: "TSMC official investor relations annual report website",
  tos_url: "https://investor.tsmc.com/english/annual-reports",
  rate_limit: { requests: 1, per_seconds: 1 },
  sourceLabel: "TSMC IR",
  storagePrefix: "company-ir/tsmc",
  async *plan(input) {
    yield {
      task_id: `tsmc-ir-annual-report-${input.year}`,
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
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error(`Invalid TSMC annual report year: ${year}`);
  return `https://investor.tsmc.com/static/annualReports/${year}/english/index.html`;
}

export function createTsmcIrAdapterContext(): AdapterContext {
  return { userAgent: loadEnv().SEC_USER_AGENT, now: () => new Date() };
}
