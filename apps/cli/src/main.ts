#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { runDataQualityChecks } from "@supplystrata/data-quality";
import { getPendingEntity, migrate, seedFromCsv } from "@supplystrata/db";
import { DbEntityResolver } from "@supplystrata/entity-resolver";
import { backfillEvidenceTrace } from "@supplystrata/evidence-maintenance";
import { GraphBuilder } from "@supplystrata/graph-builder";
import { listDueSourceChecks, listSourceHealthRows, parseSourcePolicyConfig, syncSourcePolicyConfig } from "@supplystrata/source-monitor";
import {
  applyApprovedReviewCandidate,
  applyApprovedReviewCandidates,
  enqueueAppleSupplierReviewCandidates,
  enqueueEntitySourceReviewCandidates,
  lookupEntitySourceCandidates,
  previewAppleSuppliers,
  previewNvidiaResearchReport,
  previewDefaultNvidiaSlice,
  previewSecEdgarSupplyChain,
  runDefaultNvidiaSlice,
  runSecEdgarPipeline
} from "@supplystrata/pipeline";
import { renderChanges, renderCompany, renderEvidence, renderPendingEntities, renderPendingEntity, renderUnknownMap, type OutputFormat } from "@supplystrata/render";
import { decideReviewCandidate, getReviewCandidate, nextReviewCandidate, reviewStats } from "@supplystrata/review-store";
import { listSources, sourceStatusSummary } from "@supplystrata/source-registry";
import {
  defaultSince,
  isSupportedFormType,
  parseChangeScope,
  parseEntityLookupSource,
  parseFormat,
  parseLanguage,
  parseLimit,
  parsePendingEntityStatus,
  parsePreviewFormat,
  parseSince,
  withPool,
  write,
  writeJson
} from "./cli-utils.js";
import { renderEntityLookup } from "./entity-render.js";
import { renderDataQuality } from "./dq-render.js";
import { renderGraphCheck } from "./graph-render.js";
import { renderAppleSuppliersPreview, renderPreview, renderResearchReport } from "./preview-render.js";
import { renderReviewApplyBatch, renderReviewItemOrEmpty } from "./review-render.js";
import { renderDueSources, renderSourceHealth, renderSourcesList } from "./source-render.js";

const program = new Command();

program.name("supplystrata").description("Open Supply Chain Evidence Graph MVP CLI").version("0.1.0");

const db = program.command("db").description("database commands");
db.command("migrate").description("run SQL migrations").action(async () => {
  await withPool(async (pool) => {
    await migrate(pool);
    writeJson({ ok: true, migrated: true });
  });
});
db.command("backfill-evidence-trace").option("--limit <count>", "max evidence rows to backfill", "1000").description("backfill evidence citation offsets and fingerprints").action(async (options: { limit: string }) => {
  await withPool(async (pool) => {
    const summary = await backfillEvidenceTrace(pool, { limit: parseLimit(options.limit) });
    writeJson({ ok: true, ...summary });
  });
});

const admin = program.command("admin").description("admin commands");
admin.command("seed").description("load seed CSV files").action(async () => {
  await withPool(async (pool) => {
    const result = await seedFromCsv(pool);
    writeJson({ ok: true, ...result });
  });
});

const ingest = program.command("ingest").description("ingestion commands");
ingest
  .command("sec-edgar")
  .requiredOption("--cik <cik>", "SEC CIK")
  .option("--entity <entityId>", "primary entity id", "ENT-NVIDIA")
  .option("--types <types>", "comma separated filing types", "10-K")
  .description("fetch latest matching SEC filing and run the vertical pipeline")
  .action(async (options: { cik: string; entity: string; types: string }) => {
    await withPool(async (pool) => {
      const formTypes = options.types.split(",").map((item) => item.trim()).filter(isSupportedFormType);
      const summary = await runSecEdgarPipeline(pool, { cik: options.cik, entityId: options.entity, formTypes });
      writeJson(summary);
    });
  });

const pipeline = program.command("pipeline").description("pipeline shortcuts");
pipeline.command("nvidia").description("run SEC/NVIDIA 10-K vertical slice").action(async () => {
  await withPool(async (pool) => {
    const summary = await runDefaultNvidiaSlice(pool);
    writeJson(summary);
  });
});

const preview = program.command("preview").description("database-free supply-chain parsing previews");
preview.command("nvidia").option("--format <format>", "markdown or json", "markdown").description("preview NVIDIA SEC 10-K parsing without database").action(async (options: { format: string }) => {
  const result = await previewDefaultNvidiaSlice();
  write(renderPreview(result, parseFormat(options.format)));
});

preview.command("apple-suppliers").option("--format <format>", "markdown, json, or csv", "markdown").option("--limit <count>", "max rows for markdown preview", "25").description("preview Apple Supplier List semi-auto candidates").action(async (options: { format: string; limit: string }) => {
  const result = await previewAppleSuppliers();
  write(renderAppleSuppliersPreview(result, parsePreviewFormat(options.format), parseLimit(options.limit)));
});

const previewReport = preview.command("report").description("database-free research reports");
previewReport.command("nvidia").option("--format <format>", "markdown or json", "markdown").option("--lang <lang>", "en or zh", "en").description("preview an NVIDIA supply-chain research memo").action(async (options: { format: string; lang: string }) => {
  const result = await previewNvidiaResearchReport();
  write(renderResearchReport(result, parseFormat(options.format), parseLanguage(options.lang)));
});

preview
  .command("sec-edgar")
  .requiredOption("--cik <cik>", "SEC CIK")
  .option("--entity <entityId>", "primary entity id", "ENT-NVIDIA")
  .option("--types <types>", "comma separated filing types", "10-K")
  .option("--format <format>", "markdown or json", "markdown")
  .description("preview SEC EDGAR supply-chain parsing without database")
  .action(async (options: { cik: string; entity: string; types: string; format: string }) => {
    const formTypes = options.types.split(",").map((item) => item.trim()).filter(isSupportedFormType);
    const result = await previewSecEdgarSupplyChain({ cik: options.cik, entityId: options.entity, formTypes });
    write(renderPreview(result, parseFormat(options.format)));
  });

const sources = program.command("sources").description("source registry commands");
sources.command("list").option("--format <format>", "markdown or json", "markdown").description("list configured free/public sources").action((options: { format: string }) => {
  write(renderSourcesList(listSources(), parseFormat(options.format)));
});
sources.command("status").option("--format <format>", "markdown or json", "markdown").description("summarize source implementation status").action((options: { format: string }) => {
  const summary = sourceStatusSummary();
  if (parseFormat(options.format) === "json") {
    writeJson({ schema_version: "1.0.0", summary, sources: listSources() });
    return;
  }
  write([
    "# Source Status",
    "",
    `Total: ${summary.total}`,
    `Implemented: ${summary.implemented}`,
    `Preview: ${summary.preview}`,
    `Planned: ${summary.planned}`,
    `Manual-only: ${summary.manualOnly}`,
    `Requires key: ${summary.requiresKey}`
  ].join("\n"));
});
sources.command("health").option("--format <format>", "markdown or json", "markdown").description("show source monitoring health from Postgres").action(async (options: { format: string }) => {
  await withPool(async (pool) => {
    const health = await listSourceHealthRows(pool);
    write(renderSourceHealth(health, parseFormat(options.format)));
  });
});
sources.command("due").option("--limit <count>", "max due sources", "50").option("--format <format>", "markdown or json", "markdown").description("list sources whose configured check time is due").action(async (options: { limit: string; format: string }) => {
  await withPool(async (pool) => {
    const due = await listDueSourceChecks(pool, { limit: parseLimit(options.limit) });
    write(renderDueSources(due, parseFormat(options.format)));
  });
});

program
  .command("changes")
  .option("--since <date>", "ISO date/time lower bound", defaultSince(7))
  .option("--scope <scope>", "company:<id>, entity:<id>, edge:<id>, or source:<id>")
  .option("--type <changeType>", "change/event type filter")
  .option("--source <sourceAdapterId>", "source adapter filter")
  .option("--attention-only", "only show changes requiring attention", false)
  .option("--limit <count>", "max changes", "50")
  .option("--format <format>", "markdown or json", "markdown")
  .description("show graph and source-monitor changes")
  .action(async (options: { since: string; scope?: string; type?: string; source?: string; attentionOnly: boolean; limit: string; format: string }) => {
    await withPool(async (pool) => {
      const scope = parseChangeScope(options.scope);
      const input = {
        since: parseSince(options.since),
        limit: parseLimit(options.limit),
        format: parseFormat(options.format),
        ...(scope === undefined ? {} : { scope }),
        ...(options.type === undefined ? {} : { changeType: options.type }),
        ...(options.source === undefined ? {} : { sourceAdapterId: options.source }),
        attentionOnly: options.attentionOnly
      };
      write(await renderChanges(pool, input));
    });
  });
const sourcePolicy = sources.command("policy").description("source monitoring policy commands");
sourcePolicy.command("sync").requiredOption("--file <path>", "JSON source policy config").description("sync external source monitoring policy config").action(async (options: { file: string }) => {
  await withPool(async (pool) => {
    const config = parseSourcePolicyConfig(await readFile(options.file, "utf8"));
    const result = await syncSourcePolicyConfig(pool, { config, configSource: options.file });
    writeJson({ ok: true, ...result });
  });
});

const entity = program.command("entity").description("entity resolution helper commands");
entity
  .command("lookup")
  .argument("<query>", "company name to search in external entity sources")
  .option("--source <source>", "all, opencorporates, or companies-house", "all")
  .option("--jurisdiction <code>", "OpenCorporates jurisdiction code, such as gb or us_de")
  .option("--limit <count>", "max results per source", "5")
  .option("--format <format>", "markdown or json", "markdown")
  .description("lookup external registry candidates without merging them into entity_master")
  .action(async (query: string, options: { source: string; jurisdiction?: string; limit: string; format: string }) => {
    const result = await lookupEntitySourceCandidates({
      query,
      source: parseEntityLookupSource(options.source),
      limit: parseLimit(options.limit),
      ...(options.jurisdiction === undefined ? {} : { jurisdictionCode: options.jurisdiction })
    });
    write(renderEntityLookup(result, parseFormat(options.format)));
  });
const entityPending = entity.command("pending").description("inspect and resolve unresolved entity surfaces");
entityPending.command("list").option("--status <status>", "pending, resolved, or all", "pending").option("--limit <count>", "max rows", "25").option("--format <format>", "markdown or json", "markdown").description("list pending entity surfaces").action(async (options: { status: string; limit: string; format: string }) => {
  await withPool(async (pool) => {
    write(await renderPendingEntities(pool, { status: parsePendingEntityStatus(options.status), limit: parseLimit(options.limit), format: parseFormat(options.format) }));
  });
});
entityPending.command("show").argument("<pendingId>", "pending entity id").option("--format <format>", "markdown or json", "markdown").description("show one pending entity with context").action(async (pendingId: string, options: { format: string }) => {
  await withPool(async (pool) => {
    write(await renderPendingEntity(pool, pendingId, parseFormat(options.format)));
  });
});
entityPending
  .command("lookup")
  .argument("<pendingId>", "pending entity id")
  .option("--source <source>", "all, opencorporates, or companies-house", "all")
  .option("--jurisdiction <code>", "OpenCorporates jurisdiction code, such as gb or us_mn")
  .option("--limit <count>", "max results per source", "5")
  .option("--format <format>", "markdown or json", "markdown")
  .description("lookup external registry candidates for one pending entity")
  .action(async (pendingId: string, options: { source: string; jurisdiction?: string; limit: string; format: string }) => {
    await withPool(async (pool) => {
      const pending = await getPendingEntity(pool, pendingId);
      if (pending === undefined) throw new Error(`Pending entity not found: ${pendingId}`);
      const result = await lookupEntitySourceCandidates({
        query: pending.surface,
        source: parseEntityLookupSource(options.source),
        limit: parseLimit(options.limit),
        ...(options.jurisdiction === undefined ? {} : { jurisdictionCode: options.jurisdiction })
      });
      write(renderEntityLookup(result, parseFormat(options.format)));
    });
  });

const review = program.command("review").description("human review queue commands");
review.command("stats").option("--format <format>", "markdown or json", "markdown").description("summarize review queue status").action(async (options: { format: string }) => {
  await withPool(async (pool) => {
    const stats = await reviewStats(pool);
    if (parseFormat(options.format) === "json") writeJson({ schema_version: "1.0.0", stats });
    else write(["# Review Stats", "", `Pending: ${stats.pending}`, `Approved: ${stats.approved}`, `Rejected: ${stats.rejected}`, `Blocked: ${stats.blocked}`, `Applied: ${stats.applied}`, `Total: ${stats.total}`].join("\n"));
  });
});
review.command("next").option("--format <format>", "markdown or json", "markdown").description("show next pending review candidate").action(async (options: { format: string }) => {
  await withPool(async (pool) => {
    const item = await nextReviewCandidate(pool);
    write(renderReviewItemOrEmpty(item, parseFormat(options.format)));
  });
});
review.command("show").argument("<reviewId>", "review candidate id").option("--format <format>", "markdown or json", "markdown").description("show one review candidate").action(async (reviewId: string, options: { format: string }) => {
  await withPool(async (pool) => {
    const item = await getReviewCandidate(pool, reviewId);
    write(renderReviewItemOrEmpty(item, parseFormat(options.format)));
  });
});
review.command("approve").argument("<reviewId>", "review candidate id").requiredOption("--reviewer <name>", "reviewer name").option("--reason <reason>", "decision reason").description("mark a review candidate approved").action(async (reviewId: string, options: { reviewer: string; reason?: string }) => {
  await withPool(async (pool) => {
    const item = await decideReviewCandidate(pool, { reviewId, decision: "approved", reviewer: options.reviewer, ...(options.reason === undefined ? {} : { reason: options.reason }) });
    writeJson({ ok: true, review_id: item.review_id, status: item.status });
  });
});
review.command("reject").argument("<reviewId>", "review candidate id").requiredOption("--reviewer <name>", "reviewer name").requiredOption("--reason <reason>", "decision reason").description("mark a review candidate rejected").action(async (reviewId: string, options: { reviewer: string; reason: string }) => {
  await withPool(async (pool) => {
    const item = await decideReviewCandidate(pool, { reviewId, decision: "rejected", reviewer: options.reviewer, reason: options.reason });
    writeJson({ ok: true, review_id: item.review_id, status: item.status });
  });
});
review.command("apply").argument("<reviewId>", "approved review candidate id").requiredOption("--reviewer <name>", "reviewer name").description("apply an approved review candidate to the graph when it resolves cleanly").action(async (reviewId: string, options: { reviewer: string }) => {
  await withPool(async (pool) => {
    const result = await applyApprovedReviewCandidate(pool, reviewId, options.reviewer);
    writeJson({ ok: result.status === "applied" || result.status === "entity_applied", ...result });
  });
});
review.command("apply-approved").requiredOption("--reviewer <name>", "reviewer name").option("--limit <count>", "max approved candidates to apply", "10").option("--format <format>", "markdown or json", "markdown").description("apply already-approved review candidates without approving pending ones").action(async (options: { reviewer: string; limit: string; format: string }) => {
  await withPool(async (pool) => {
    const summary = await applyApprovedReviewCandidates(pool, { reviewer: options.reviewer, limit: parseLimit(options.limit) });
    write(renderReviewApplyBatch(summary, parseFormat(options.format)));
  });
});
const reviewEnqueue = review.command("enqueue").description("enqueue review candidates from sources");
reviewEnqueue.command("apple-suppliers").description("enqueue Apple Supplier List candidates for human review").action(async () => {
  await withPool(async (pool) => {
    const summary = await enqueueAppleSupplierReviewCandidates(pool);
    writeJson({ ok: true, ...summary });
  });
});
reviewEnqueue
  .command("entity-source")
  .argument("<query>", "company name to search in external entity sources")
  .option("--source <source>", "all, opencorporates, or companies-house", "all")
  .option("--jurisdiction <code>", "OpenCorporates jurisdiction code, such as gb or us_mn")
  .option("--limit <count>", "max results per source", "5")
  .description("enqueue external entity source candidates for review/import")
  .action(async (query: string, options: { source: string; jurisdiction?: string; limit: string }) => {
    await withPool(async (pool) => {
      const summary = await enqueueEntitySourceReviewCandidates(pool, {
        query,
        source: parseEntityLookupSource(options.source),
        limit: parseLimit(options.limit),
        ...(options.jurisdiction === undefined ? {} : { jurisdictionCode: options.jurisdiction })
      });
      writeJson({ ok: summary.errors.length === 0, ...summary });
    });
  });

const graph = program.command("graph").description("graph commands");
graph.command("rebuild").description("rebuild Neo4j from Postgres").action(async () => {
  await withPool(async (pool) => {
    const resolver = new DbEntityResolver(pool);
    const builder = new GraphBuilder(pool, resolver);
    try {
      const stats = await builder.rebuild();
      writeJson({ ok: true, ...stats });
    } finally {
      await builder.close();
    }
  });
});
graph.command("check").option("--format <format>", "markdown or json", "markdown").description("compare Neo4j materialized view counts with Postgres truth").action(async (options: { format: string }) => {
  await withPool(async (pool) => {
    const resolver = new DbEntityResolver(pool);
    const builder = new GraphBuilder(pool, resolver);
    try {
      const check = await builder.checkConsistency();
      write(renderGraphCheck(check, parseFormat(options.format)));
    } finally {
      await builder.close();
    }
  });
});

const dq = program.command("dq").description("data quality commands");
dq.command("run").option("--format <format>", "markdown or json", "markdown").description("run MVP data quality checks against Postgres truth").action(async (options: { format: string }) => {
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

await program.parseAsync(process.argv);
