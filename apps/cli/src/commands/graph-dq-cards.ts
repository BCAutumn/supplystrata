import type { Command } from "commander";
import { runDataQualityChecks } from "@supplystrata/data-quality";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { Neo4jGraphStore } from "@supplystrata/graph";
import { GraphBuilder } from "@supplystrata/graph-builder";
import { renderChain, renderCompany, renderComponent, renderEvidence, renderUnknownMap } from "@supplystrata/render";
import { parseFormat, parseLimit, withPool, write, writeJson } from "../cli-utils.js";
import { renderDataQuality } from "../dq-render.js";
import { renderGraphCheck } from "../graph-render.js";

export function registerGraphDqAndCardCommands(program: Command): void {
  const graph = program.command("graph").description("graph commands");
  graph
    .command("rebuild")
    .description("rebuild the configured graph projection from Postgres")
    .action(async () => {
      await withPool(async (pool) => {
        const resolver = new DbEntityResolver(pool);
        const builder = new GraphBuilder(pool, resolver, new Neo4jGraphStore());
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
      await withPool(async (pool) => {
        const resolver = new DbEntityResolver(pool);
        const builder = new GraphBuilder(pool, resolver, new Neo4jGraphStore());
        try {
          const check = await builder.checkConsistency();
          write(renderGraphCheck(check, parseFormat(options.format)));
        } finally {
          await builder.close();
        }
      });
    });

  const dq = program.command("dq").description("data quality commands");
  dq.command("run")
    .option("--format <format>", "markdown or json", "markdown")
    .description("run MVP data quality checks against Postgres truth")
    .action(async (options: { format: string }) => {
      await withPool(async (pool) => {
        const summary = await runDataQualityChecks(pool);
        write(renderDataQuality(summary, parseFormat(options.format)));
      });
    });

  program
    .command("company")
    .argument("<query>", "company name, alias, ticker, or entity id")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render a company card")
    .action(async (query: string, options: { format: string }) => {
      await withPool(async (pool) => {
        write(await renderCompany(pool, query, parseFormat(options.format)));
      });
    });

  program
    .command("chain")
    .argument("<query>", "company name, alias, ticker, or entity id")
    .option("--depth <count>", "upstream traversal depth, max 5", "2")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render a chain-first upstream view for a company")
    .action(async (query: string, options: { depth: string; format: string }) => {
      await withPool(async (pool) => {
        write(await renderChain(pool, query, { depth: parseLimit(options.depth), format: parseFormat(options.format) }));
      });
    });

  program
    .command("component")
    .argument("<query>", "component id, name, or alias")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render a component supply-chain card")
    .action(async (query: string, options: { format: string }) => {
      await withPool(async (pool) => {
        write(await renderComponent(pool, query, parseFormat(options.format)));
      });
    });

  program
    .command("evidence")
    .argument("<evidenceId>", "EV-xxx")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render an evidence card")
    .action(async (evidenceId: string, options: { format: string }) => {
      await withPool(async (pool) => {
        write(await renderEvidence(pool, evidenceId, parseFormat(options.format)));
      });
    });

  program
    .command("unknown-map")
    .argument("<query>", "company query")
    .option("--format <format>", "markdown or json", "markdown")
    .description("render unknown map")
    .action(async (query: string, options: { format: string }) => {
      await withPool(async (pool) => {
        write(await renderUnknownMap(pool, query, parseFormat(options.format)));
      });
    });
}
