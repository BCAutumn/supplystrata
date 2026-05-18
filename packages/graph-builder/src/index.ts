import type { ApplyResult, ApprovedCandidate } from "@supplystrata/core";
import {
  deprecateEdge,
  markGraphProjectionJobsSucceeded,
  recordGraphProjectionFailure,
  type DatabaseStore,
  type DbTxClient,
  type GraphProjectionOperation
} from "@supplystrata/db";
import type { EntityResolver } from "@supplystrata/entity-resolver";
import type { GraphStore } from "@supplystrata/graph-store";
import { getLogger, messageFromUnknown } from "@supplystrata/observability";
import {
  checkGraphConsistency,
  rebuildGraphProjection,
  retryGraphProjectionJobs,
  syncGraphEdge,
  type GraphConsistencyCheck,
  type GraphProjectionRetrySummary
} from "./projection.js";
import { applyApprovedCandidateToSql } from "./sql-store.js";

export type GraphSyncMode = "sync" | "defer";

export interface GraphBuilderOptions {
  graphSyncMode?: GraphSyncMode;
  graphStore?: GraphStore;
}

export type { GraphConsistencyCheck, GraphProjectionRetrySummary } from "./projection.js";

export interface DeprecateEdgeRequest {
  edge_id: string;
  reason: string;
  superseded_by_edge_id?: string;
  reviewer: string;
}

export interface DeprecateEdgeApplyResult {
  edge_id: string;
  primary_evidence_id?: string;
  graph_sync: ApplyResult["graph_sync"];
}

export class GraphBuilder {
  readonly #store: DatabaseStore;
  readonly #resolver: EntityResolver;
  readonly #graph: GraphStore | null;
  readonly #graphSyncMode: GraphSyncMode;

  constructor(store: DatabaseStore, resolver: EntityResolver, graphOrOptions: GraphStore | GraphBuilderOptions = {}, options: GraphBuilderOptions = {}) {
    this.#store = store;
    this.#resolver = resolver;
    if (isGraphStore(graphOrOptions)) {
      this.#graph = graphOrOptions;
      this.#graphSyncMode = options.graphSyncMode ?? "sync";
    } else {
      this.#graph = graphOrOptions.graphStore ?? null;
      // 没有 GraphStore adapter 时，GraphBuilder 只维护 Postgres 真相存储；图投影由后续 rebuild/check 命令补齐。
      this.#graphSyncMode = graphOrOptions.graphSyncMode ?? (this.#graph === null ? "defer" : "sync");
    }
  }

  async close(): Promise<void> {
    if (this.#graph === null) return;
    await this.#graph.close();
  }

  async apply(approved: ApprovedCandidate): Promise<ApplyResult> {
    const committed = await this.#store.transaction((client) => this.applySqlInTransaction(client, approved));
    const graphSync = await this.#trySyncEdge(committed.edge_id);
    return { ...committed, graph_sync: graphSync };
  }

  async applySqlInTransaction(client: DbTxClient, approved: ApprovedCandidate): Promise<Omit<ApplyResult, "graph_sync">> {
    const subject = await this.#resolver.resolve(approved.candidate.subject_resolve);
    const object = await this.#resolver.resolve(approved.candidate.object_resolve);
    if (subject.status !== "resolved" || subject.entity_id === undefined) {
      throw new Error(`Cannot resolve subject: ${approved.candidate.subject_resolve.surface}`);
    }
    if (object.status !== "resolved" || object.entity_id === undefined) {
      throw new Error(`Cannot resolve object: ${approved.candidate.object_resolve.surface}`);
    }
    const subjectId = subject.entity_id;
    const objectId = object.entity_id;

    return applyApprovedCandidateToSql(client, { approved, subject_id: subjectId, object_id: objectId });
  }

  async deprecate(input: DeprecateEdgeRequest): Promise<DeprecateEdgeApplyResult> {
    const committed = await this.#store.transaction(async (client) =>
      deprecateEdge(client, {
        edge_id: input.edge_id,
        reason: input.reason,
        caused_by: input.reviewer,
        ...(input.superseded_by_edge_id === undefined ? {} : { superseded_by_edge_id: input.superseded_by_edge_id })
      })
    );
    const graphSync = await this.#tryRemoveEdge(committed.edge_id);
    return { ...committed, graph_sync: graphSync };
  }

  async rebuild(): Promise<{ nodes: number; edges: number }> {
    return rebuildGraphProjection(this.#store, this.#requireGraph());
  }

  async checkConsistency(): Promise<GraphConsistencyCheck> {
    return checkGraphConsistency(this.#store, this.#requireGraph());
  }

  async retryProjectionJobs(input: { limit?: number } = {}): Promise<GraphProjectionRetrySummary> {
    return retryGraphProjectionJobs(this.#store, this.#requireGraph(), input);
  }

  async #trySyncEdge(edgeId: string): Promise<ApplyResult["graph_sync"]> {
    if (this.#graphSyncMode === "defer") return { status: "deferred" };
    try {
      await syncGraphEdge(this.#store, this.#requireGraph(), edgeId);
      await markGraphProjectionJobsSucceeded(this.#store, { operation: "upsert_edge", edge_id: edgeId });
      return { status: "synced" };
    } catch (error) {
      const errorMessage = messageFromUnknown(error);
      await this.#recordProjectionFailure("upsert_edge", edgeId, errorMessage);
      getLogger().warn({ stage: "graph-sync", edge_id: edgeId, err: errorMessage }, "GraphStore projection sync failed; Postgres truth was committed");
      return { status: "failed", error_message: errorMessage };
    }
  }

  async #tryRemoveEdge(edgeId: string): Promise<ApplyResult["graph_sync"]> {
    if (this.#graphSyncMode === "defer") return { status: "deferred" };
    try {
      await this.#requireGraph().removeEdge(edgeId);
      await markGraphProjectionJobsSucceeded(this.#store, { operation: "remove_edge", edge_id: edgeId });
      return { status: "synced" };
    } catch (error) {
      const errorMessage = messageFromUnknown(error);
      await this.#recordProjectionFailure("remove_edge", edgeId, errorMessage);
      getLogger().warn({ stage: "graph-remove-edge", edge_id: edgeId, err: errorMessage }, "GraphStore projection remove failed; Postgres truth was committed");
      return { status: "failed", error_message: errorMessage };
    }
  }

  async #recordProjectionFailure(operation: GraphProjectionOperation, edgeId: string, errorMessage: string): Promise<void> {
    try {
      await recordGraphProjectionFailure(this.#store, { operation, edge_id: edgeId, error_message: errorMessage });
    } catch (error) {
      getLogger().error(
        { stage: "graph-projection-outbox", operation, edge_id: edgeId, err: messageFromUnknown(error) },
        "Failed to persist GraphStore projection retry job"
      );
    }
  }

  #requireGraph(): GraphStore {
    if (this.#graph !== null) return this.#graph;
    throw new Error("No GraphStore adapter is configured for this GraphBuilder.");
  }
}

function isGraphStore(value: GraphStore | GraphBuilderOptions): value is GraphStore {
  return (
    "close" in value &&
    "ensureSchema" in value &&
    "clear" in value &&
    "upsertEntity" in value &&
    "upsertEdge" in value &&
    "removeEdge" in value &&
    "stats" in value
  );
}
