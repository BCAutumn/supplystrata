import type { Command } from "commander";
import { loadChainCard, loadCompanyCard, loadComponentCard, loadEvidenceCard, loadUnknownMap } from "@supplystrata/card-builder";
import { runDataQualityChecks } from "@supplystrata/data-quality";
import type { EdgeDeprecationSourceRef, EdgeDeprecationSourceKind } from "@supplystrata/db/read";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { GraphBuilder } from "@supplystrata/graph-builder";
import { renderChainCard, renderCompanyCard, renderComponentCard, renderEvidenceCard, renderUnknownMapCard } from "@supplystrata/render";
import { parseFormat, parseGraphSyncMode, parseLimit, parseSince, withDatabase, write, writeJson } from "../cli-utils.js";
import { renderDataQuality } from "../dq-render.js";
import { createCliNeo4jGraphStore } from "../graph-store.js";
import { renderGraphCheck } from "../graph-render.js";

export function registerGraphDqAndCardCommands(program: Command): void {
  const graph = program.command("graph").description("graph commands");
  graph
    .command("rebuild")
    .description("rebuild the configured graph projection from Postgres")
    .action(async () => {
      await withDatabase(async (pool) => {
        const resolver = new DbEntityResolver(pool.read);
        const builder = new GraphBuilder(pool, resolver, { graphStore: createCliNeo4jGraphStore() });
        try {
          const stats = await builder.rebuild();
          writeJson({ ok: true, ...stats });
        } finally {
          await builder.close();
        }
      });
    });
  graph
    .command("check")
    .option("--format <format>", "markdown or json", "markdown")
    .description("compare graph projection counts with Postgres truth")
    .action(async (options: { format: string }) => {
      await withDatabase(async (pool) => {
        const resolver = new DbEntityResolver(pool.read);
        const builder = new GraphBuilder(pool, resolver, { graphStore: createCliNeo4jGraphStore() });
        try {
          const check = await builder.checkConsistency();
          write(renderGraphCheck(check, parseFormat(options.format)));
        } finally {
          await builder.close();
        }
      });
    });
  graph
    .command("retry-projections")
    .option("--limit <count>", "max queued projection jobs to retry", "50")
    .description("retry failed GraphStore projection jobs from the durable queue")
    .action(async (options: { limit: string }) => {
      await withDatabase(async (pool) => {
        const resolver = new DbEntityResolver(pool.read);
        const builder = new GraphBuilder(pool, resolver, { graphStore: createCliNeo4jGraphStore() });
        try {
          const summary = await builder.retryProjectionJobs({ limit: parseLimit(options.limit) });
          writeJson({ ok: true, ...summary });
        } finally {
          await builder.close();
        }
      });
    });
  graph
    .command("deprecate-edge")
    .argument("<edge-id>", "current fact edge id to deprecate")
    .requiredOption("--source <refs>", "comma-separated refs: evidence:EV,review:REV,claim:CLM,unknown:UNK,semantic-change:CHG")
    .requiredOption("--reviewer <id>", "reviewer id")
    .requiredOption("--reason <text>", "deprecation reason")
    .option("--superseded-by <edgeId>", "replacement edge id")
    .option("--graph-sync <mode>", "sync or defer", "defer")
    .option("--format <format>", "markdown or json", "markdown")
    .description("soft-deprecate a current fact edge with auditable source refs")
    .action(
      async (
        edgeId: string,
        options: {
          source: string;
          reviewer: string;
          reason: string;
          supersededBy?: string;
          graphSync: string;
          format: string;
        }
      ) => {
        await withDatabase(async (pool) => {
          const graphSyncMode = parseGraphSyncMode(options.graphSync);
          const resolver = new DbEntityResolver(pool.read);
          const builder = new GraphBuilder(
            pool,
            resolver,
            graphSyncMode === "sync" ? { graphSyncMode, graphStore: createCliNeo4jGraphStore() } : { graphSyncMode }
          );
          try {
            const result = await builder.deprecate({
              edge_id: edgeId,
              source_refs: parseEdgeDeprecationSourceRefs(options.source),
              reviewer: options.reviewer,
              reason: options.reason,
              ...(options.supersededBy === undefined ? {} : { superseded_by_edge_id: options.supersededBy })
            });
            if (parseFormat(options.format) === "json") {
              writeJson({ ok: true, ...result });
              return;
            }
            write(
              [
                "# Edge Deprecation",
                "",
                `Edge: ${result.edge_id}`,
                `Primary evidence: ${result.primary_evidence_id ?? "none"}`,
                `Source refs: ${result.source_refs.map((ref) => `${ref.kind}:${ref.id}`).join(", ")}`,
                `Graph sync: ${result.graph_sync.status}`
              ].join("\n")
            );
          } finally {
            await builder.close();
          }
        });
      }
    );

  const dq = program.command("dq").description("data quality commands");
  dq.command("run")
    .option("--format <format>", "markdown or json", "markdown")
    .option("--unknown-company <entityId>", "company entity id that must have an open unknown map")
    .option("--unknown-min <count>", "minimum open unknown-map items for --unknown-company", "1")
    .option("--checked-at <iso>", "override the data-quality checked_at timestamp")
    .description("run MVP data quality checks against Postgres truth")
    .action(async (options: { format: string; unknownCompany?: string; unknownMin: string; checkedAt?: string }) => {
      await withDatabase(async (pool) => {
        const checkedAt = options.checkedAt === undefined ? new Date().toISOString() : parseSince(options.checkedAt);
        const summary = await runDataQualityChecks(pool.read, {
          checkedAt,
          ...(options.unknownCompany === undefined
            ? {}
            : { entity_unknown_map_targets: [{ scope_id: options.unknownCompany, minimum_open_items: parseLimit(options.unknownMin) }] })
        });
        write(renderDataQuality(summary, parseFormat(options.format)));
      });
    });

  program
    .command("company")
    .argument("<query>", "company name, alias, ticker, or entity id")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render a company card")
    .action(async (query: string, options: { format: string }) => {
      await withDatabase(async (pool) => {
        write(renderCompanyCard(await loadCompanyCard(pool.read, query, { computedAt: new Date().toISOString() }), parseFormat(options.format)));
      });
    });

  program
    .command("chain")
    .argument("<query>", "company name, alias, ticker, or entity id")
    .option("--depth <count>", "upstream traversal depth, max 5", "2")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render a chain-first upstream view for a company")
    .action(async (query: string, options: { depth: string; format: string }) => {
      await withDatabase(async (pool) => {
        write(renderChainCard(await loadChainCard(pool.read, query, { depth: parseLimit(options.depth) }), parseFormat(options.format)));
      });
    });

  program
    .command("component")
    .argument("<query>", "component id, name, or alias")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render a component supply-chain card")
    .action(async (query: string, options: { format: string }) => {
      await withDatabase(async (pool) => {
        write(renderComponentCard(await loadComponentCard(pool.read, query, { computedAt: new Date().toISOString() }), parseFormat(options.format)));
      });
    });

  program
    .command("evidence")
    .argument("<evidenceId>", "EV-xxx")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render an evidence card")
    .action(async (evidenceId: string, options: { format: string }) => {
      await withDatabase(async (pool) => {
        write(renderEvidenceCard(await loadEvidenceCard(pool.read, evidenceId), parseFormat(options.format)));
      });
    });

  program
    .command("unknown-map")
    .argument("<query>", "company query")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render unknown map")
    .action(async (query: string, options: { format: string }) => {
      await withDatabase(async (pool) => {
        write(renderUnknownMapCard(await loadUnknownMap(pool.read, query), parseFormat(options.format)));
      });
    });
}

function parseEdgeDeprecationSourceRefs(value: string): EdgeDeprecationSourceRef[] {
  const refs = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map(parseEdgeDeprecationSourceRef);
  if (refs.length === 0) throw new Error("At least one edge deprecation source ref is required");
  return refs;
}

function parseEdgeDeprecationSourceRef(value: string): EdgeDeprecationSourceRef {
  const separator = value.indexOf(":");
  if (separator < 1 || separator === value.length - 1) throw new Error(`Unsupported edge deprecation source ref: ${value}`);
  return {
    kind: parseEdgeDeprecationSourceKind(value.slice(0, separator)),
    id: value.slice(separator + 1)
  };
}

function parseEdgeDeprecationSourceKind(value: string): EdgeDeprecationSourceKind {
  if (value === "evidence") return "evidence";
  if (value === "review") return "review";
  if (value === "claim") return "claim";
  if (value === "unknown") return "unknown";
  if (value === "semantic-change") return "semantic_change";
  throw new Error(`Unsupported edge deprecation source kind: ${value}`);
}
