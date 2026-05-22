import { createAdapterContext, defineHtmlSnapshotAdapter, type AdapterContext, type CreateAdapterContextInput } from "@supplystrata/source-adapter-runtime";
import { normalizeHtmlDocument } from "@supplystrata/source-normalizers";

export interface TsmcIrInput {
  year: number;
  entityId: "ENT-TSMC";
}

export interface SamsungIrInput {
  year: number;
  entityId: "ENT-SAMSUNG-ELECTRONICS";
}

export interface SkHynixIrInput {
  year: number;
  entityId: "ENT-SKHYNIX";
}

export interface AsmlIrInput {
  year: number;
  entityId: "ENT-ASML";
}

export interface MicronIrInput {
  year: number;
  entityId: "ENT-MICRON";
}

export interface CompanyIrExplicitUrlInput {
  year: number;
  entityId: string;
  url: string;
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
      url: tsmcAnnualReportUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
});

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
      url: samsungOfficialDisclosureUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
});

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
      url: skHynixOfficialDisclosureUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
});

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
      url: asmlAnnualReportUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
});

export const micronIrAdapter = defineHtmlSnapshotAdapter<MicronIrInput>({
  id: "micron-ir",
  tier: "P1",
  description: "Micron official investor relations SEC filing detail page",
  tos_url: "https://www.micron.com/about/legal",
  rate_limit: { requests: 1, per_seconds: 3 },
  sourceLabel: "Micron IR",
  storagePrefix: "company-ir/micron",
  async *plan(input) {
    yield {
      task_id: `micron-ir-annual-report-${input.year}`,
      url: micronAnnualReportUrl(input.year),
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
});

// company-ir 是长尾公司官方披露的受控入口，只消费人工/host app 已审阅 URL，不能演变成任意 IR 页面发现器。
export const companyIrExplicitUrlAdapter = defineHtmlSnapshotAdapter<CompanyIrExplicitUrlInput>({
  id: "company-ir",
  tier: "P1",
  description: "Controlled company investor relations HTML disclosure by explicit official URL",
  tos_url: "manual://per-target-company-ir-tos",
  rate_limit: { requests: 1, per_seconds: 3 },
  sourceLabel: "Company IR explicit URL",
  storagePrefix: "company-ir/explicit",
  async *plan(input) {
    assertDisclosureYear(input.year, "Company IR disclosure");
    assertHttpsUrl(input.url, "Company IR disclosure URL");
    if (input.entityId.trim().length === 0) throw new Error("Company IR entityId must not be empty");
    yield {
      task_id: `company-ir-${input.entityId}-${input.year}`,
      url: input.url,
      expected_format: "html",
      hint: { entity_id: input.entityId, document_type: "annual_report", period: `${input.year}-12-31` }
    };
  },
  async normalize(raw) {
    return normalizeHtmlDocument({ raw, documentType: "annual_report" });
  }
});

export function tsmcAnnualReportUrl(year: number): string {
  assertDisclosureYear(year, "TSMC annual report");
  return `https://investor.tsmc.com/static/annualReports/${year}/english/index.html`;
}

export function asmlAnnualReportUrl(year: number): string {
  assertDisclosureYear(year, "ASML annual report");
  return `https://www.asml.com/en/investors/annual-report/${year}`;
}

export function samsungOfficialDisclosureUrl(year: number): string {
  if (year !== 2025) return "https://news.samsung.com/global/";
  return "https://news.samsung.com/global/samsung-electronics-announces-fourth-quarter-and-fy-2025-results";
}

export function skHynixOfficialDisclosureUrl(year: number): string {
  if (year !== 2025) return "https://news.skhynix.com/";
  return "https://news.skhynix.com/sk-hynix-announces-fy25-financial-results/";
}

export function micronAnnualReportUrl(year: number): string {
  assertDisclosureYear(year, "Micron annual report");
  if (year !== 2025) return "https://investors.micron.com/sec-filings";
  return "https://investors.micron.com/sec-filings/sec-filing/10-k/0000723125-25-000028";
}

export function createOfficialIrAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  // 官方 IR HTML 检查共用同一套 snapshot store，避免每个薄 adapter 包重复持有环境装配逻辑。
  return createAdapterContext(input);
}

function assertDisclosureYear(year: number, label: string): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error(`Invalid ${label} year: ${year}`);
}

function assertHttpsUrl(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${label} must use https`);
}
