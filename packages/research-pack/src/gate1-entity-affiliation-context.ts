import type { DbClient } from "@supplystrata/db/read";
import { listEntityAffiliationDispositions, type EntityAffiliationDispositionDecision } from "@supplystrata/review-store";
import type { WorkbenchModel } from "@supplystrata/workbench-export";

export interface Gate1EntityAffiliationDisposition {
  change_id: string;
  decision: EntityAffiliationDispositionDecision;
  reviewer: string;
  reason: string;
  recorded_at: string;
  edge_ids: string[];
  component_ids: string[];
  unknown_ids: string[];
}

export interface Gate1EntityAffiliationContext {
  context_id: string;
  subject_entity_id: string;
  subject_name: string;
  subject_kind: string;
  parent_entity_id: string;
  parent_name: string | null;
  parent_kind: string | null;
  parent_unknown_ids: string[];
  edge_ids: string[];
  component_ids: string[];
  latest_disposition: Gate1EntityAffiliationDisposition | null;
}

interface EntityAffiliationRow extends Record<string, unknown> {
  subject_entity_id: string;
  subject_name: string;
  subject_kind: string;
  parent_entity_id: string;
  parent_name: string | null;
  parent_kind: string | null;
}

interface ParentUnknownRow extends Record<string, unknown> {
  scope_id: string;
  unknown_id: string;
}

export async function loadGate1EntityAffiliationContexts(
  client: DbClient,
  input: { workbench: Pick<WorkbenchModel, "companies" | "edges"> }
): Promise<Gate1EntityAffiliationContext[]> {
  const visibleEntityIds = visibleCompanyEntityIds(input.workbench);
  if (visibleEntityIds.length === 0) return [];

  const result = await client.query<EntityAffiliationRow>(
    `SELECT
       child.entity_id AS subject_entity_id,
       child.display_name AS subject_name,
       child.kind AS subject_kind,
       child.attrs->>'parent_entity_id' AS parent_entity_id,
       parent.display_name AS parent_name,
       parent.kind AS parent_kind
     FROM entity_master child
     LEFT JOIN entity_master parent ON parent.entity_id = child.attrs->>'parent_entity_id'
     WHERE child.entity_id = ANY($1::text[])
      AND child.attrs->>'parent_entity_id' IS NOT NULL
     ORDER BY child.display_name, child.entity_id`,
    [visibleEntityIds]
  );
  const unknownIdsByParent = await loadOpenCompanyUnknownIdsByScope(
    client,
    result.rows.map((row) => row.parent_entity_id)
  );

  const contexts = result.rows.map((row) => affiliationContextFromRow(row, input.workbench, unknownIdsByParent.get(row.parent_entity_id) ?? []));
  return attachLatestDispositions(client, contexts);
}

function affiliationContextFromRow(
  row: EntityAffiliationRow,
  workbench: Pick<WorkbenchModel, "edges">,
  parentUnknownIds: readonly string[]
): Gate1EntityAffiliationContext {
  const edges = workbench.edges.filter((edge) => edge.from_id === row.subject_entity_id || edge.to_id === row.subject_entity_id);
  return {
    context_id: `gate1-entity-affiliation:${row.subject_entity_id}:${row.parent_entity_id}`,
    subject_entity_id: row.subject_entity_id,
    subject_name: row.subject_name,
    subject_kind: row.subject_kind,
    parent_entity_id: row.parent_entity_id,
    parent_name: row.parent_name,
    parent_kind: row.parent_kind,
    parent_unknown_ids: uniqueSorted(parentUnknownIds),
    edge_ids: edges.map((edge) => edge.edge_id).sort(),
    component_ids: uniqueSorted(edges.flatMap((edge) => (edge.component_id === null ? [] : [edge.component_id]))),
    latest_disposition: null
  };
}

async function attachLatestDispositions(client: DbClient, contexts: readonly Gate1EntityAffiliationContext[]): Promise<Gate1EntityAffiliationContext[]> {
  if (contexts.length === 0) return [];
  const dispositions = await listEntityAffiliationDispositions(client, {
    contextIds: contexts.map((context) => context.context_id),
    limit: contexts.length * 5
  });
  const latestByContext = new Map<string, Gate1EntityAffiliationDisposition>();
  for (const disposition of dispositions) {
    if (latestByContext.has(disposition.context_id)) continue;
    latestByContext.set(disposition.context_id, {
      change_id: disposition.change_id,
      decision: disposition.decision,
      reviewer: disposition.reviewer,
      reason: disposition.reason,
      recorded_at: disposition.recorded_at,
      edge_ids: disposition.edge_ids,
      component_ids: disposition.component_ids,
      unknown_ids: disposition.unknown_ids
    });
  }
  return contexts.map((context) => ({
    ...context,
    latest_disposition: latestByContext.get(context.context_id) ?? null
  }));
}

async function loadOpenCompanyUnknownIdsByScope(client: DbClient, parentEntityIds: readonly string[]): Promise<Map<string, string[]>> {
  const scopeIds = uniqueSorted(parentEntityIds);
  if (scopeIds.length === 0) return new Map();
  const result = await client.query<ParentUnknownRow>(
    `SELECT scope_id, unknown_id
     FROM unknown_items
     WHERE scope_kind = 'company'
       AND scope_id = ANY($1::text[])
       AND status = 'open'
     ORDER BY scope_id, created_at, unknown_id`,
    [scopeIds]
  );
  const byScope = new Map<string, string[]>();
  for (const row of result.rows) byScope.set(row.scope_id, [...(byScope.get(row.scope_id) ?? []), row.unknown_id]);
  return byScope;
}

function visibleCompanyEntityIds(workbench: Pick<WorkbenchModel, "companies" | "edges">): string[] {
  return uniqueSorted([...workbench.companies.map((company) => company.entity_id), ...workbench.edges.flatMap((edge) => [edge.from_id, edge.to_id])]);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
