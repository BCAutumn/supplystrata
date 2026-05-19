import type { DbClient, DbRow } from "@supplystrata/db";
import type { CompanyFinancialPeerMetric } from "@supplystrata/render";

interface FinancialPeerMetricRow extends DbRow {
  risk_view_id: string;
  generated_at: Date;
  model_version: string;
  inputs_fingerprint: string;
  metric_id: string;
  value: string | null;
  confidence: number;
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
}

const DEFAULT_FINANCIAL_PEER_LIMIT = 20;

export async function loadCompanyFinancialPeerMetrics(client: DbClient, entityId: string): Promise<CompanyFinancialPeerMetric[]> {
  const result = await client.query<FinancialPeerMetricRow>(
    `SELECT rv.risk_view_id, rv.generated_at, rv.model_version, rv.inputs_fingerprint,
            rm.metric_id, rm.value::text, rm.confidence, rm.provenance, rm.attrs
     FROM risk_metrics rm
     JOIN risk_views rv ON rv.risk_view_id = rm.risk_view_id
     WHERE rm.metric_kind = 'financial_metric_peer_zscore'
       AND rm.subject_kind = 'company'
       AND rm.subject_id = $1
     ORDER BY rv.generated_at DESC, rm.metric_id
     LIMIT $2`,
    [entityId, DEFAULT_FINANCIAL_PEER_LIMIT]
  );
  return result.rows.map(financialPeerMetricFromRow).sort(compareFinancialPeerMetrics);
}

function financialPeerMetricFromRow(row: FinancialPeerMetricRow): CompanyFinancialPeerMetric {
  return {
    risk_view_id: row.risk_view_id,
    generated_at: row.generated_at.toISOString(),
    model_version: row.model_version,
    inputs_fingerprint: row.inputs_fingerprint,
    metric_id: row.metric_id,
    value: row.value,
    confidence: row.confidence,
    metric_name: stringAttr(row.attrs, "metric_name") ?? "unknown_metric",
    metric_value: numberAttr(row.attrs, "metric_value"),
    metric_unit: stringAttr(row.attrs, "metric_unit"),
    fiscal_year: numberAttr(row.attrs, "fiscal_year"),
    fiscal_period: stringAttr(row.attrs, "fiscal_period"),
    period_basis: stringAttr(row.attrs, "period_basis"),
    peer_count: numberAttr(row.attrs, "peer_count"),
    percentile: numberAttr(row.attrs, "percentile"),
    rank_descending: numberAttr(row.attrs, "rank_descending"),
    z_score: numberAttr(row.attrs, "z_score"),
    peer_company_ids: stringArrayAttr(row.attrs, "peer_company_ids"),
    provenance: row.provenance,
    attrs: row.attrs
  };
}

function compareFinancialPeerMetrics(left: CompanyFinancialPeerMetric, right: CompanyFinancialPeerMetric): number {
  return (
    (right.fiscal_year ?? 0) - (left.fiscal_year ?? 0) ||
    fiscalPeriodRank(right.fiscal_period) - fiscalPeriodRank(left.fiscal_period) ||
    Math.abs(right.z_score ?? 0) - Math.abs(left.z_score ?? 0) ||
    left.metric_name.localeCompare(right.metric_name) ||
    left.metric_id.localeCompare(right.metric_id)
  );
}

function fiscalPeriodRank(period: string | null): number {
  if (period === null) return 0;
  if (period === "FY") return 5;
  const quarter = /^Q([1-4])$/.exec(period);
  if (quarter === null) return 0;
  return Number.parseInt(quarter[1] ?? "0", 10);
}

function stringAttr(attrs: Record<string, unknown>, key: string): string | null {
  const value = attrs[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberAttr(attrs: Record<string, unknown>, key: string): number | null {
  const value = attrs[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayAttr(attrs: Record<string, unknown>, key: string): string[] {
  const value = attrs[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string").sort((left, right) => left.localeCompare(right));
}
