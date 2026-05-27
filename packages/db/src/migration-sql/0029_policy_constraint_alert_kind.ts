import { ALERT_KINDS } from "@supplystrata/core";

export const sql = `
ALTER TABLE alert_candidates
  DROP CONSTRAINT IF EXISTS alert_candidates_alert_kind_check;

ALTER TABLE alert_candidates
  ADD CONSTRAINT alert_candidates_alert_kind_check
  CHECK (alert_kind IN (${ALERT_KINDS.map(sqlString).join(",")}));
`;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
