import neo4j, { type Driver } from "neo4j-driver";
import { loadEnv } from "@supplystrata/config";
import { RELATION_TYPES, type EntityRecord, type RelationType } from "@supplystrata/core";
import type { GraphEdgeInput, GraphProjectionStats, GraphStore } from "@supplystrata/graph-store";

export type { GraphEdgeInput, GraphProjectionStats, GraphStore } from "@supplystrata/graph-store";

export function createNeo4jDriver(): Driver {
  const env = loadEnv();
  return neo4j.driver(env.NEO4J_URI, neo4j.auth.basic(env.NEO4J_USER, env.NEO4J_PASSWORD));
}

export class Neo4jGraphStore implements GraphStore {
  readonly #driver: Driver;

  constructor(driver = createNeo4jDriver()) {
    this.#driver = driver;
  }

  async close(): Promise<void> {
    await this.#driver.close();
  }

  async ensureSchema(): Promise<void> {
    await this.#write("CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (n:Entity) REQUIRE n.entity_id IS UNIQUE", {});
    await this.#write("CREATE INDEX entity_kind IF NOT EXISTS FOR (n:Entity) ON (n.kind)", {});
    for (const relationType of RELATION_TYPES) {
      await this.#write(`CREATE INDEX edge_id_${relationType.toLowerCase()} IF NOT EXISTS FOR ()-[r:${relationType}]-() ON (r.edge_id)`, {});
    }
  }

  async clear(): Promise<void> {
    await this.#write("MATCH (n) DETACH DELETE n", {});
  }

  async upsertEntity(entity: EntityRecord): Promise<void> {
    const labels = labelsForKind(entity.kind).join(":");
    await this.#write(
      `MERGE (n:Entity:${labels} { entity_id: $entity_id })
       SET n.kind = $kind,
           n.canonical_name = $canonical_name,
           n.display_name = $display_name,
           n.primary_country = $primary_country,
           n.status = $status,
           n.industry = $industry`,
      {
        entity_id: entity.entity_id,
        kind: entity.kind,
        canonical_name: entity.canonical_name,
        display_name: entity.display_name,
        primary_country: entity.primary_country ?? null,
        status: entity.status,
        industry: entity.industry
      }
    );
  }

  async upsertEdge(edge: GraphEdgeInput): Promise<void> {
    await this.#write(
      `MATCH (s:Entity { entity_id: $subject_id })
       MATCH (o:Entity { entity_id: $object_id })
       MERGE (s)-[r:${cypherRelationType(edge.relation)} { edge_id: $edge_id }]->(o)
       SET r.component = $component,
           r.component_id = $component_id,
           r.component_specificity = $component_specificity,
           r.evidence_level = $evidence_level,
           r.confidence = $confidence,
           r.is_inferred = $is_inferred,
           r.validity = $validity,
           r.last_verified_at = $last_verified_at`,
      {
        edge_id: edge.edge_id,
        subject_id: edge.subject_id,
        object_id: edge.object_id,
        component: edge.component ?? null,
        component_id: edge.component_id ?? null,
        component_specificity: edge.component_specificity ?? null,
        evidence_level: edge.evidence_level,
        confidence: edge.confidence,
        is_inferred: edge.is_inferred,
        validity: edge.validity,
        last_verified_at: edge.last_verified_at
      }
    );
  }

  async stats(): Promise<GraphProjectionStats> {
    const session = this.#driver.session();
    try {
      const result = await session.run("MATCH (n) WITH count(n) AS nodes MATCH ()-[r]->() RETURN nodes, count(r) AS edges");
      const record = result.records[0];
      if (record === undefined) return { nodes: 0, edges: 0 };
      return { nodes: neoNumber(record.get("nodes")), edges: neoNumber(record.get("edges")) };
    } finally {
      await session.close();
    }
  }

  async #write(cypher: string, params: Record<string, unknown>): Promise<void> {
    const session = this.#driver.session();
    try {
      await session.executeWrite(async (tx) => {
        await tx.run(cypher, params);
      });
    } finally {
      await session.close();
    }
  }
}

function cypherRelationType(relation: RelationType): RelationType {
  switch (relation) {
    case "BUYS_FROM":
    case "SUPPLIES_TO":
    case "USES_FOUNDRY":
    case "USES_COMPONENT":
    case "MANUFACTURES_AT":
    case "OWNS_SUBSIDIARY":
    case "OWNS_BUSINESS_UNIT":
    case "IS_A":
    case "OPERATES_FACILITY":
      return relation;
  }
  const exhaustive: never = relation;
  return exhaustive;
}

function labelsForKind(kind: EntityRecord["kind"]): string[] {
  const map: Record<EntityRecord["kind"], string> = {
    company: "Company",
    company_group: "CompanyGroup",
    business_unit: "BusinessUnit",
    facility: "Facility",
    port: "Port",
    vessel: "Vessel",
    carrier: "Carrier",
    product: "Product",
    component: "Component",
    industry_node: "IndustryNode",
    person: "Person",
    government_agency: "GovernmentAgency"
  };
  return [map[kind]];
}

function neoNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (hasToNumber(value)) return value.toNumber();
  return Number(value);
}

function hasToNumber(value: unknown): value is { toNumber(): number } {
  return typeof value === "object" && value !== null && "toNumber" in value && typeof value.toNumber === "function";
}
