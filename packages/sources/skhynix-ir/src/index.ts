import { loadEnv } from "@supplystrata/config";
import { defineHtmlSnapshotAdapter, type AdapterContext } from "@supplystrata/source-adapter-runtime";
import { normalizeHtmlDocument } from "@supplystrata/source-normalizers";

export interface SkHynixIrInput {
  year: number;
  entityId: "ENT-SKHYNIX";
}

export const skHynixIrAdapter = defineHtmlSnapshotAdapter<SkHynixIrInput>({
  id: "skhynix-ir",
  tier: "P0",
  description: "SK hynix official investor relations / newsroom disclosures",
  tos_url: "https://www.skhynix.com/eng/irMain.do",
  rate_limit: { requests: 1, per_seconds: 3 },
  sourceLabel: "SK hynix disclosure",
  storagePrefix: "company-ir/skhynix",
  async *plan(input) {
    yield {
      task_id: `skhynix-ir-fy-results-${input.year}`,
      url: officialDisclosureUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
});

export function officialDisclosureUrl(year: number): string {
  if (year !== 2025) return "https://news.skhynix.com/";
  return "https://news.skhynix.com/sk-hynix-announces-fy25-financial-results/";
}

export function createSkHynixIrAdapterContext(): AdapterContext {
  return { userAgent: loadEnv().SEC_USER_AGENT, now: () => new Date() };
}
