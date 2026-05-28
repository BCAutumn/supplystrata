import type { Command } from "commander";
import { getPendingEntity, listPendingEntities, type PendingEntityRow } from "@supplystrata/db/read";
import {
  applyApprovedReviewCandidate,
  applyApprovedReviewCandidates,
  runGate1EntitySourceReviewBatch,
  runGate1SupplierListReviewBatch
} from "@supplystrata/pipeline";
import {
  enqueueAppleSupplierReviewCandidates,
  enqueueEntityResolutionBacklogReviewCandidates,
  enqueueEntitySourceReviewCandidates,
  lookupEntitySourceCandidates
} from "@supplystrata/source-workflows";
import { renderPendingEntities, renderPendingEntity } from "@supplystrata/render";
import {
  decideReviewCandidateTransactionally,
  getReviewCandidate,
  nextReviewCandidateTransactionally,
  recordEntityAffiliationDisposition,
  recordEdgeCorroborationDisposition,
  recordOfficialDisclosureSignalDisposition,
  reviewStats,
  type EdgeCorroborationDispositionDecision,
  type EntityAffiliationDispositionDecision,
  type OfficialDisclosureSignalDispositionDecision
} from "@supplystrata/review-store";
import {
  parseEntityLookupSource,
  parseCommaSeparated,
  parseFormat,
  parseLimit,
  parsePendingEntityStatus,
  parsePositiveInteger,
  withDatabase,
  write,
  writeJson
} from "../cli-utils.js";
import { renderEntityLookup } from "../entity-render.js";
import { renderReviewApplyBatch, renderReviewItemOrEmpty } from "../review-render.js";
import { explicitOrCurrentIsoTimestamp } from "../cli-clock.js";
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
    .option("--source <source>", "all, gleif, openfigi, opencorporates, or companies-house", "all")
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
    .option("--source <source>", "all, gleif, openfigi, opencorporates, or companies-house", "all")
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
  review
    .command("gate1-supplier-list-batch")
    .option("--reviewer <name>", "reviewer name; required only when --apply is set")
    .option("--limit <count>", "max pending supplier-list candidates to scan", "50")
    .option("--apply", "approve and apply eligible candidates; default is dry-run")
    .description("dry-run or apply the constrained Gate 1 supplier-list review batch")
    .action(async (options: { reviewer?: string; limit: string; apply?: boolean }) => {
      await withDatabase(async (pool) => {
        const summary = await runGate1SupplierListReviewBatch(pool, {
          limit: parseLimit(options.limit),
          apply: options.apply === true,
          ...(options.reviewer === undefined ? {} : { reviewer: options.reviewer })
        });
        writeJson({ schema_version: "1.0.0", ok: summary.errors === 0 && summary.blocked === 0, summary });
      });
    });

  review
    .command("gate1-entity-source-batch")
    .option("--reviewer <name>", "reviewer name; required only when --apply is set")
    .option("--limit <count>", "max pending entity-source candidates to scan", "20")
    .option("--apply", "approve and apply eligible GLEIF candidates; default is dry-run")
    .description("dry-run or apply the constrained Gate 1 GLEIF entity-source review batch")
    .action(async (options: { reviewer?: string; limit: string; apply?: boolean }) => {
      await withDatabase(async (pool) => {
        const summary = await runGate1EntitySourceReviewBatch(pool, {
          limit: parseLimit(options.limit),
          apply: options.apply === true,
          ...(options.reviewer === undefined ? {} : { reviewer: options.reviewer })
        });
        writeJson({ schema_version: "1.0.0", ok: summary.errors === 0 && summary.blocked === 0, summary });
      });
    });

  review
    .command("edge-corroboration-disposition")
    .argument("<edgeId>", "fact edge id whose second-source corroboration was reviewed")
    .requiredOption(
      "--decision <decision>",
      "supports_existing_edge, needs_more_evidence, not_relevant, record_single_source_unknown, or create_counterparty_source_target"
    )
    .requiredOption("--reviewer <name>", "reviewer or automation name")
    .requiredOption("--reason <reason>", "why this edge corroboration disposition was recorded")
    .option("--evidence <evidenceId>", "reviewed evidence id, if one was created separately")
    .option("--unknown <unknownId>", "related unknown id, if one already exists")
    .option("--check-target <checkTargetId>", "source check target used during review")
    .option("--recorded-at <date>", "ISO date/time for deterministic replay")
    .description("record a review-only edge corroboration disposition without mutating fact edges")
    .action(
      async (
        edgeId: string,
        options: {
          decision: string;
          reviewer: string;
          reason: string;
          evidence?: string;
          unknown?: string;
          checkTarget?: string;
          recordedAt?: string;
        }
      ) => {
        await withDatabase(async (pool) => {
          const disposition = await pool.transaction((client) =>
            recordEdgeCorroborationDisposition(client, {
              edgeId,
              decision: parseEdgeCorroborationDispositionDecision(options.decision),
              reviewer: options.reviewer,
              reason: options.reason,
              recordedAt: explicitOrCurrentIsoTimestamp(options.recordedAt),
              ...(options.evidence === undefined ? {} : { evidenceId: options.evidence }),
              ...(options.unknown === undefined ? {} : { unknownId: options.unknown }),
              ...(options.checkTarget === undefined ? {} : { checkTargetId: options.checkTarget })
            })
          );
          writeJson({ ok: true, disposition });
        });
      }
    );

  review
    .command("entity-affiliation-disposition")
    .argument("<contextId>", "gate1 entity affiliation context id")
    .requiredOption("--subject <entityId>", "business-unit or child entity id visible in the current chain")
    .requiredOption("--parent <entityId>", "parent legal entity id to evaluate for recursive research")
    .requiredOption("--decision <decision>", "research_parent_entity, research_child_entity, research_both_scopes, not_relevant, or keep_unknown_open")
    .requiredOption("--reviewer <name>", "reviewer or automation name")
    .requiredOption("--reason <reason>", "why this entity affiliation disposition was recorded")
    .option("--edge <edgeIds>", "comma-separated related edge ids from the research pack")
    .option("--component <componentIds>", "comma-separated component ids for the recursive research scope")
    .option("--unknown <unknownIds>", "comma-separated related unknown ids")
    .option("--recorded-at <date>", "ISO date/time for deterministic replay")
    .description("record a review-only disposition for a Gate 1 entity affiliation context without merging entities or mutating fact edges")
    .action(
      async (
        contextId: string,
        options: {
          subject: string;
          parent: string;
          decision: string;
          reviewer: string;
          reason: string;
          edge?: string;
          component?: string;
          unknown?: string;
          recordedAt?: string;
        }
      ) => {
        await withDatabase(async (pool) => {
          const disposition = await pool.transaction((client) =>
            recordEntityAffiliationDisposition(client, {
              contextId,
              subjectEntityId: options.subject,
              parentEntityId: options.parent,
              decision: parseEntityAffiliationDispositionDecision(options.decision),
              reviewer: options.reviewer,
              reason: options.reason,
              recordedAt: explicitOrCurrentIsoTimestamp(options.recordedAt),
              ...(options.edge === undefined ? {} : { edgeIds: parseCommaSeparated(options.edge) }),
              ...(options.component === undefined ? {} : { componentIds: parseCommaSeparated(options.component) }),
              ...(options.unknown === undefined ? {} : { unknownIds: parseCommaSeparated(options.unknown) })
            })
          );
          writeJson({ ok: true, disposition });
        });
      }
    );

  review
    .command("signal-disposition")
    .argument("<reviewId>", "official disclosure signal review id")
    .requiredOption("--edge <edgeId>", "fact edge id this signal was reviewed against")
    .requiredOption(
      "--decision <decision>",
      "supports_existing_edge, needs_more_evidence, not_relevant, record_single_source_unknown, or create_counterparty_source_target"
    )
    .requiredOption("--reviewer <name>", "reviewer or automation name")
    .requiredOption("--reason <reason>", "why this disposition was recorded")
    .option("--evidence <evidenceId>", "reviewed evidence id, if one was created separately")
    .option("--unknown <unknownId>", "related unknown id, if one already exists")
    .option("--check-target <checkTargetId>", "source check target used during review")
    .option("--recorded-at <date>", "ISO date/time for deterministic replay")
    .description("record a review-only disposition for an official disclosure signal without mutating fact edges")
    .action(
      async (
        reviewId: string,
        options: {
          edge: string;
          decision: string;
          reviewer: string;
          reason: string;
          evidence?: string;
          unknown?: string;
          checkTarget?: string;
          recordedAt?: string;
        }
      ) => {
        await withDatabase(async (pool) => {
          const recordedAt = explicitOrCurrentIsoTimestamp(options.recordedAt);
          const disposition = await pool.transaction((client) =>
            recordOfficialDisclosureSignalDisposition(client, {
              reviewId,
              edgeId: options.edge,
              decision: parseOfficialSignalDispositionDecision(options.decision),
              reviewer: options.reviewer,
              reason: options.reason,
              recordedAt,
              ...(options.evidence === undefined ? {} : { evidenceId: options.evidence }),
              ...(options.unknown === undefined ? {} : { unknownId: options.unknown }),
              ...(options.checkTarget === undefined ? {} : { checkTargetId: options.checkTarget })
            })
          );
          writeJson({ ok: true, disposition });
        });
      }
    );

  const reviewEnqueue = review.command("enqueue").description("enqueue review candidates from sources");
  reviewEnqueue
    .command("apple-suppliers")
    .requiredOption("--entity <entityId>", "buyer entity id; Apple Supplier List currently supports ENT-APPLE")
    .requiredOption("--fiscal-year <year>", "Apple Supplier List fiscal year; currently supports 2022")
    .description("enqueue Apple Supplier List candidates for human review using explicit source input")
    .action(async (options: { entity: string; fiscalYear: string }) => {
      await withDatabase(async (pool) => {
        const summary = await enqueueAppleSupplierReviewCandidates(
          pool,
          { fiscalYear: parsePositiveInteger(options.fiscalYear, "Apple Supplier List fiscal year"), entityId: options.entity },
          sourceWorkflowRuntime()
        );
        writeJson({ ok: true, ...summary });
      });
    });
  reviewEnqueue
    .command("entity-source")
    .argument("<query>", "company name to search in external entity sources")
    .option("--source <source>", "all, gleif, openfigi, opencorporates, or companies-house", "all")
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
  reviewEnqueue
    .command("gate1-supplier-entity-backlog")
    .option("--source <source>", "gleif, openfigi, opencorporates, companies-house, or all", "gleif")
    .option("--scan-limit <count>", "max pending supplier-list candidates to scan", "500")
    .option("--supplier-limit <count>", "max unresolved suppliers to enqueue", "10")
    .option("--candidate-limit <count>", "max external candidates per supplier/source", "3")
    .description("enqueue entity-source review candidates from the Gate 1 supplier-list entity backlog")
    .action(async (options: { source: string; scanLimit: string; supplierLimit: string; candidateLimit: string }) => {
      await withDatabase(async (pool) => {
        const supplierBatch = await runGate1SupplierListReviewBatch(pool, {
          limit: parseLimit(options.scanLimit)
        });
        const queries = supplierBatch.entity_resolution_backlog.slice(0, parseLimit(options.supplierLimit)).map((item) => item.supplier_name);
        const entityReview = await enqueueEntityResolutionBacklogReviewCandidates(
          pool,
          {
            queries,
            source: parseEntityLookupSource(options.source),
            limitPerQuery: parseLimit(options.candidateLimit)
          },
          sourceWorkflowRuntime()
        );
        writeJson({
          ok: entityReview.errors === 0,
          supplier_backlog: {
            scanned: supplierBatch.scanned,
            unresolved_suppliers: supplierBatch.entity_resolution_backlog.length,
            selected_suppliers: queries
          },
          entity_review: entityReview
        });
      });
    });
}

function parseOfficialSignalDispositionDecision(value: string): OfficialDisclosureSignalDispositionDecision {
  if (
    value === "supports_existing_edge" ||
    value === "needs_more_evidence" ||
    value === "not_relevant" ||
    value === "record_single_source_unknown" ||
    value === "create_counterparty_source_target"
  ) {
    return value;
  }
  throw new Error(`Unsupported official signal disposition decision: ${value}`);
}

function parseEdgeCorroborationDispositionDecision(value: string): EdgeCorroborationDispositionDecision {
  if (
    value === "supports_existing_edge" ||
    value === "needs_more_evidence" ||
    value === "not_relevant" ||
    value === "record_single_source_unknown" ||
    value === "create_counterparty_source_target"
  ) {
    return value;
  }
  throw new Error(`Unsupported edge corroboration disposition decision: ${value}`);
}

function parseEntityAffiliationDispositionDecision(value: string): EntityAffiliationDispositionDecision {
  if (
    value === "research_parent_entity" ||
    value === "research_child_entity" ||
    value === "research_both_scopes" ||
    value === "not_relevant" ||
    value === "keep_unknown_open"
  ) {
    return value;
  }
  throw new Error(`Unsupported entity affiliation disposition decision: ${value}`);
}
