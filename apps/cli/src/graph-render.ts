import type { GraphConsistencyCheck } from "@supplystrata/graph-builder";
import type { OutputFormat } from "@supplystrata/render";

export function renderGraphCheck(check: GraphConsistencyCheck, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", ok: check.status === "synced", check }, null, 2);

  const lines = [
    "# Graph Check",
    "",
    `Status: ${check.status}`,
    `Postgres truth: ${check.postgres.nodes} nodes, ${check.postgres.edges} edges`
  ];
  if (check.status === "unreachable") {
    lines.push(`Neo4j: unreachable (${check.error_message})`);
  } else {
    lines.push(`Neo4j view: ${check.neo4j.nodes} nodes, ${check.neo4j.edges} edges`);
  }
  lines.push(`Recommendation: ${check.recommendation}`);
  return lines.join("\n");
}
