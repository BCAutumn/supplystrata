import { loadEnv } from "@supplystrata/config";
import { defineHtmlSnapshotAdapter, type AdapterContext } from "@supplystrata/source-adapter-spec";
import { normalizeHtmlDocument } from "@supplystrata/source-normalizers";

export interface SamsungIrInput {
  year: number;
  entityId: "ENT-SAMSUNG-ELECTRONICS";
}

export const samsungIrAdapter = defineHtmlSnapshotAdapter<SamsungIrInput>({
  id: "samsung-ir",
  tier: "P0",
  description: "Samsung Electronics official investor relations / newsroom disclosures",
  tos_url: "https://www.samsung.com/global/ir/",
  rate_limit: { requests: 1, per_seconds: 3 },
  sourceLabel: "Samsung disclosure",
  storagePrefix: "company-ir/samsung",
  async *plan(input) {
    yield {
      task_id: `samsung-ir-fy-results-${input.year}`,
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
  if (year !== 2025) return "https://news.samsung.com/global/";
  return "https://news.samsung.com/global/samsung-electronics-announces-fourth-quarter-and-fy-2025-results";
}

export function createSamsungIrAdapterContext(): AdapterContext {
  return { userAgent: loadEnv().SEC_USER_AGENT, now: () => new Date() };
}
