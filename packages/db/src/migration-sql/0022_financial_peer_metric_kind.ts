import { RISK_METRIC_KINDS } from "@supplystrata/core";

export const sql = `
ALTER TABLE risk_metrics DROP CONSTRAINT IF EXISTS risk_metrics_metric_kind_check;
ALTER TABLE risk_metrics ADD CONSTRAINT risk_metrics_metric_kind_check
CHECK (metric_kind IN (${RISK_METRIC_KINDS.map(sqlString).join(",")}));
`;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
