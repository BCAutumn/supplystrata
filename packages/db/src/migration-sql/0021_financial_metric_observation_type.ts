import { OBSERVATION_TYPES } from "@supplystrata/core";

export const sql = `
ALTER TABLE observations
  DROP CONSTRAINT IF EXISTS observations_observation_type_check;

ALTER TABLE observations
  ADD CONSTRAINT observations_observation_type_check
  CHECK (observation_type IN (${OBSERVATION_TYPES.map(sqlString).join(",")}));
`;

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
