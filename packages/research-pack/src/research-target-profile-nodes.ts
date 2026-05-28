import type { OfficialDisclosureReadinessTargetNode } from "./official-disclosure-readiness.js";

type ResearchTargetNodePriority = NonNullable<OfficialDisclosureReadinessTargetNode["priority"]>;

const SEC_COMPANY_FACT_OBSERVATION_METRICS = [
  "inventory",
  "cost_of_revenue",
  "capital_expenditures",
  "accounts_payable",
  "purchase_obligations",
  "revenue"
] as const;

export function secTargetCompany(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  cik: string,
  additionalExpectedSourceIds: readonly string[] = []
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetCompany(nodeId, name, priority, ["sec-edgar", ...additionalExpectedSourceIds]),
    expected_source_targets: [
      {
        source_id: "sec-edgar",
        target_kind: "sec-company-filings",
        target_config: {
          cik,
          entity_id: nodeId,
          form_types: ["10-K", "10-Q", "20-F", "8-K"],
          limit: 3
        },
        reason: `${name} has an audited SEC CIK in the research target profile; monitor official filings as Gate 1 source coverage.`
      },
      {
        source_id: "sec-edgar",
        target_kind: "sec-company-facts",
        target_config: {
          cik,
          entity_id: nodeId,
          metrics: [...SEC_COMPANY_FACT_OBSERVATION_METRICS],
          max_periods: 12
        },
        reason: `${name} has an audited SEC CIK in the research target profile; monitor SEC company facts as observation-only financial signals for Gate 1.`
      }
    ]
  };
}

export function targetCompany(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  expectedSourceIds: readonly string[]
): OfficialDisclosureReadinessTargetNode {
  return { node_id: nodeId, node_kind: "company", name, priority, expected_source_ids: expectedSourceIds };
}

export function targetComponent(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  expectedSourceIds: readonly string[]
): OfficialDisclosureReadinessTargetNode {
  return { node_id: nodeId, node_kind: "component", name, priority, expected_source_ids: expectedSourceIds };
}

export function appleSupplierListTargetComponent(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  expectedSourceIds: readonly string[]
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetComponent(nodeId, name, priority, expectedSourceIds),
    expected_source_targets: [
      {
        source_id: "apple-suppliers",
        target_kind: "supplier-list-review",
        target_config: {
          fiscal_year: 2022,
          entity_id: "ENT-APPLE",
          scope_kind: "component",
          scope_id: nodeId,
          component_id: nodeId
        },
        reason:
          "Apple Supplier List FY2022 is an official supplier-list review path for manufacturing-services coverage; it enqueues review candidates and facility leads, not fact edges."
      }
    ]
  };
}

export function edinetDailyFilingsTargetComponent(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  expectedSourceIds: readonly string[]
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetComponent(nodeId, name, priority, expectedSourceIds),
    expected_source_targets: [
      {
        source_id: "edinet",
        target_kind: "daily-filings",
        target_config: {
          date: "2025-06-30",
          type: 2,
          scope_kind: "component",
          scope_id: nodeId,
          component_id: nodeId,
          doc_type_codes: ["120"]
        },
        reason:
          "EDINET daily documents list is a Japanese official disclosure directory seed for annual securities reports; it only monitors metadata and does not download ZIP/PDF/XBRL or create fact edges."
      }
    ]
  };
}

export function twseMopsTargetCompany(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  stockCode: string,
  additionalExpectedSourceIds: readonly string[] = []
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetCompany(nodeId, name, priority, [...additionalExpectedSourceIds, "twse-mops"]),
    expected_source_targets: [
      {
        source_id: "twse-mops",
        target_kind: "electronic-documents",
        target_config: {
          stock_code: stockCode,
          entity_id: nodeId,
          year: 2025,
          document_kind: "F",
          limit: 50
        },
        reason:
          `${name} has a curated TWSE/MOPS stock code; monitor the official electronic documents directory as Gate 1 coverage. ` +
          "This target records directory metadata only and must not download PDF files or create fact edges."
      }
    ]
  };
}

export function dartKrTargetCompany(
  nodeId: string,
  name: string,
  priority: ResearchTargetNodePriority,
  corpCode: string,
  additionalExpectedSourceIds: readonly string[] = []
): OfficialDisclosureReadinessTargetNode {
  return {
    ...targetCompany(nodeId, name, priority, [...additionalExpectedSourceIds, "dart-kr"]),
    expected_source_targets: [
      {
        source_id: "dart-kr",
        target_kind: "company-filings",
        target_config: {
          corp_code: corpCode,
          entity_id: nodeId,
          disclosure_types: ["A", "B"],
          corp_cls: "Y",
          year: 2025,
          final_reports_only: "Y",
          limit: 20
        },
        reason: `${name} has a curated OpenDART corp_code; source-plan should treat this as a periodic official disclosure target template and override year at call time.`
      }
    ]
  };
}
