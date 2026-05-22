import type { DbClient } from "@supplystrata/db";
import type { ComponentRiskComponentRow, ComponentRiskEdgeRow } from "./db-rows.js";

export async function listRefreshableComponentRiskComponentIds(client: DbClient, componentIds: readonly string[]): Promise<string[]> {
  const normalizedComponentIds = uniqueSorted(componentIds.map((componentId) => componentId.trim()).filter((componentId) => componentId.length > 0));
  if (normalizedComponentIds.length === 0) return [];
  const result = await client.query<ComponentRiskComponentRow>(
    `SELECT DISTINCT e.component_id
     FROM edges e
     WHERE e.validity = 'current'
       AND e.evidence_level >= 4
       AND e.is_inferred = false
       AND e.component_id = ANY($1::text[])
       AND e.relation IN ('BUYS_FROM','SUPPLIES_TO','USES_FOUNDRY','MANUFACTURES_AT')
     ORDER BY e.component_id`,
    [normalizedComponentIds]
  );
  return result.rows.map((row) => row.component_id);
}

export async function listComponentRiskEdges(client: DbClient, componentId: string): Promise<ComponentRiskEdgeRow[]> {
  const result = await client.query<ComponentRiskEdgeRow>(
    `SELECT e.edge_id, e.relation,
            e.subject_id, s.display_name AS subject_name,
            e.object_id, o.display_name AS object_name,
            e.component_id, e.evidence_level, e.confidence, e.primary_evidence_id
     FROM edges e
     JOIN entity_master s ON s.entity_id = e.subject_id
     JOIN entity_master o ON o.entity_id = e.object_id
     WHERE e.validity = 'current'
       AND e.evidence_level >= 4
       AND e.is_inferred = false
       AND e.component_id = $1
       AND e.relation IN ('BUYS_FROM','SUPPLIES_TO','USES_FOUNDRY','MANUFACTURES_AT')
     ORDER BY e.evidence_level DESC, e.confidence DESC, e.edge_id`,
    [componentId]
  );
  return result.rows;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
