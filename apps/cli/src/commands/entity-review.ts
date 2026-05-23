import type { Command } from "commander";
import { getPendingEntity, listPendingEntities, type PendingEntityRow } from "@supplystrata/db/read";
import { applyApprovedReviewCandidate, applyApprovedReviewCandidates } from "@supplystrata/pipeline";
import { enqueueAppleSupplierReviewCandidates, enqueueEntitySourceReviewCandidates, lookupEntitySourceCandidates } from "@supplystrata/source-workflows";
import { renderPendingEntities, renderPendingEntity } from "@supplystrata/render";
import { decideReviewCandidateTransactionally, getReviewCandidate, nextReviewCandidateTransactionally, reviewStats } from "@supplystrata/review-store";
import { parseEntityLookupSource, parseFormat, parseLimit, parsePendingEntityStatus, withDatabase, write, writeJson } from "../cli-utils.js";
import { renderEntityLookup } from "../entity-render.js";
import { renderReviewApplyBatch, renderReviewItemOrEmpty } from "../review-render.js";
import { sourceWorkflowRuntime } from "../source-workflow-runtime.js";

export function registerEntityAndReviewCommands(program: Command): void {
  registerEntityCommands(program);
  registerReviewCommands(program);
}

function registerEntityCommands(program: Command): void {
  const entity = program.command("entity").description("entity resolution helper commands");
  entity
    .command("lookup")
    .argument("<query>", "company name to search in external entity sources")
    .option("--source <source>", "all, gleif, opencorporates, or companies-house", "all")
    .option("--jurisdiction <code>", "OpenCorporates jurisdiction code, such as gb or us_de")
    .option("--limit <count>", "max results per source", "5")
    .option("--format <format>", "markdown or json", "markdown")
    .description("lookup external registry candidates without merging them into entity_master")
    .action(async (query: string, options: { source: string; jurisdiction?: string; limit: string; format: string }) => {
      const result = await lookupEntitySourceCandidates(
        {
          query,
          source: parseEntityLookupSource(options.source),
          limit: parseLimit(options.limit),
          ...(options.jurisdiction === undefined ? {} : { jurisdictionCode: options.jurisdiction })
        },
        sourceWorkflowRuntime()
      );
      write(renderEntityLookup(result, parseFormat(options.format)));
    });

  const entityPending = entity.command("pending").description("inspect and resolve unresolved entity surfaces");
  entityPending
    .command("list")
    .option("--status <status>", "pending, resolved, or all", "pending")
    .option("--limit <count>", "max rows", "25")
    .option("--format <format>", "markdown or json", "markdown")
    .description("list pending entity surfaces")
    .action(async (options: { status: string; limit: string; format: string }) => {
      await withDatabase(async (pool) => {
        const status = parsePendingEntityStatus(options.status);
        const items = await listPendingEntities(pool.read, {
          status,
          limit: parseLimit(options.limit)
        });
        write(
          renderPendingEntities(items.map(pendingEntityToModel), {
            status,
            format: parseFormat(options.format)
          })
        );
      });
    });
  entityPending
    .command("show")
    .argument("<pendingId>", "pending entity id")
    .option("--format <format>", "markdown or json", "markdown")
    .description("show one pending entity with context")
    .action(async (pendingId: string, options: { format: string }) => {
      await withDatabase(async (pool) => {
        const pending = await getPendingEntity(pool.read, pendingId);
        if (pending === undefined) throw new Error(`Pending entity not found: ${pendingId}`);
        write(renderPendingEntity(pendingEntityToModel(pending), parseFormat(options.format)));
      });
    });
  entityPending
    .command("lookup")
    .argument("<pendingId>", "pending entity id")
    .option("--source <source>", "all, gleif, opencorporates, or companies-house", "all")
    .option("--jurisdiction <code>", "OpenCorporates jurisdiction code, such as gb or us_mn")
    .option("--limit <count>", "max results per source", "5")
    .option("--format <format>", "markdown or json", "markdown")
    .description("lookup external registry candidates for one pending entity")
    .action(async (pendingId: string, options: { source: string; jurisdiction?: string; limit: string; format: string }) => {
      await withDatabase(async (pool) => {
        const pending = await getPendingEntity(pool.read, pendingId);
        if (pending === undefined) throw new Error(`Pending entity not found: ${pendingId}`);
        const result = await lookupEntitySourceCandidates(
          {
            query: pending.surface,
            source: parseEntityLookupSource(options.source),
            limit: parseLimit(options.limit),
            ...(options.jurisdiction === undefined ? {} : { jurisdictionCode: options.jurisdiction })
          },
          sourceWorkflowRuntime()
        );
        write(renderEntityLookup(result, parseFormat(options.format)));
      });
    });
}

function pendingEntityToModel(row: PendingEntityRow): {
  pending_id: string;
  surface: string;
  context: Record<string, unknown>;
  first_seen_at: string;
  occurrence_count: number;
  status: "pending" | "resolved" | "rejected";
  resolved_entity_id: string | null;
  reviewer: string | null;
} {
  return {
    pending_id: row.pending_id,
    surface: row.surface,
    context: row.context,
    first_seen_at: row.first_seen_at.toISOString(),
    occurrence_count: row.occurrence_count,
    status: row.status,
    resolved_entity_id: row.resolved_entity_id,
    reviewer: row.reviewer
  };
}

function registerReviewCommands(program: Command): void {
  const review = program.command("review").description("human review queue commands");
  review
    .command("stats")
    .option("--format <format>", "markdown or json", "markdown")
    .description("summarize review queue status")
    .action(async (options: { format: string }) => {
      await withDatabase(async (pool) => {
        const stats = await reviewStats(pool.read);
        if (parseFormat(options.format) === "json") writeJson({ schema_version: "1.0.0", stats });
        else
          write(
            [
              "# Review Stats",
              "",
              `Pending: ${stats.pending}`,
              `In review: ${stats.in_review}`,
              `Approved: ${stats.approved}`,
              `Rejected: ${stats.rejected}`,
              `Blocked: ${stats.blocked}`,
              `Applied: ${stats.applied}`,
              `Total: ${stats.total}`
            ].join("\n")
          );
      });
    });
  review
    .command("next")
    .option("--format <format>", "markdown or json", "markdown")
    .description("claim and show the next pending review candidate")
    .action(async (options: { format: string }) => {
      await withDatabase(async (pool) => {
        const item = await nextReviewCandidateTransactionally(pool);
        write(renderReviewItemOrEmpty(item, parseFormat(options.format)));
      });
    });
  review
    .command("show")
    .argument("<reviewId>", "review candidate id")
    .option("--format <format>", "markdown or json", "markdown")
    .description("show one review candidate")
    .action(async (reviewId: string, options: { format: string }) => {
      await withDatabase(async (pool) => {
        const item = await getReviewCandidate(pool.read, reviewId);
        write(renderReviewItemOrEmpty(item, parseFormat(options.format)));
      });
    });
  review
    .command("approve")
    .argument("<reviewId>", "review candidate id")
    .requiredOption("--reviewer <name>", "reviewer name")
    .option("--reason <reason>", "decision reason")
    .description("mark a review candidate approved")
    .action(async (reviewId: string, options: { reviewer: string; reason?: string }) => {
      await withDatabase(async (pool) => {
        const item = await decideReviewCandidateTransactionally(pool, {
          reviewId,
          decision: "approved",
          reviewer: options.reviewer,
          ...(options.reason === undefined ? {} : { reason: options.reason })
        });
        writeJson({ ok: true, review_id: item.review_id, status: item.status });
      });
    });
  review
    .command("reject")
    .argument("<reviewId>", "review candidate id")
    .requiredOption("--reviewer <name>", "reviewer name")
    .requiredOption("--reason <reason>", "decision reason")
    .description("mark a review candidate rejected")
    .action(async (reviewId: string, options: { reviewer: string; reason: string }) => {
      await withDatabase(async (pool) => {
        const item = await decideReviewCandidateTransactionally(pool, { reviewId, decision: "rejected", reviewer: options.reviewer, reason: options.reason });
        writeJson({ ok: true, review_id: item.review_id, status: item.status });
      });
    });
  review
    .command("apply")
    .argument("<reviewId>", "approved review candidate id")
    .requiredOption("--reviewer <name>", "reviewer name")
    .description("apply an approved review candidate to the graph when it resolves cleanly")
    .action(async (reviewId: string, options: { reviewer: string }) => {
      await withDatabase(async (pool) => {
        const result = await applyApprovedReviewCandidate(pool, reviewId, options.reviewer);
        writeJson({ ok: result.status === "applied" || result.status === "entity_applied" || result.status === "acknowledged", ...result });
      });
    });
  review
    .command("apply-approved")
    .requiredOption("--reviewer <name>", "reviewer name")
    .option("--limit <count>", "max approved candidates to apply", "10")
    .option("--format <format>", "markdown or json", "markdown")
    .description("apply already-approved review candidates without approving pending ones")
    .action(async (options: { reviewer: string; limit: string; format: string }) => {
      await withDatabase(async (pool) => {
        const summary = await applyApprovedReviewCandidates(pool, { reviewer: options.reviewer, limit: parseLimit(options.limit) });
        write(renderReviewApplyBatch(summary, parseFormat(options.format)));
      });
    });

  const reviewEnqueue = review.command("enqueue").description("enqueue review candidates from sources");
  reviewEnqueue
    .command("apple-suppliers")
    .description("enqueue Apple Supplier List candidates for human review")
    .action(async () => {
      await withDatabase(async (pool) => {
        const summary = await enqueueAppleSupplierReviewCandidates(pool, { fiscalYear: 2022, entityId: "ENT-APPLE" }, sourceWorkflowRuntime());
        writeJson({ ok: true, ...summary });
      });
    });
  reviewEnqueue
    .command("entity-source")
    .argument("<query>", "company name to search in external entity sources")
    .option("--source <source>", "all, gleif, opencorporates, or companies-house", "all")
    .option("--jurisdiction <code>", "OpenCorporates jurisdiction code, such as gb or us_mn")
    .option("--limit <count>", "max results per source", "5")
    .description("enqueue external entity source candidates for review/import")
    .action(async (query: string, options: { source: string; jurisdiction?: string; limit: string }) => {
      await withDatabase(async (pool) => {
        const summary = await enqueueEntitySourceReviewCandidates(
          pool,
          {
            query,
            source: parseEntityLookupSource(options.source),
            limit: parseLimit(options.limit),
            ...(options.jurisdiction === undefined ? {} : { jurisdictionCode: options.jurisdiction })
          },
          sourceWorkflowRuntime()
        );
        writeJson({ ok: summary.errors.length === 0, ...summary });
      });
    });
}
