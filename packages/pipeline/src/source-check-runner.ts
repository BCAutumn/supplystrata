import { saveNormalizedDocument, type DatabaseStore } from "@supplystrata/db";
import { getLogger } from "@supplystrata/observability";
import { recordSourceFailure, type SourceDocumentChangeType } from "@supplystrata/source-monitor";
import type { AdapterContext, SourceAdapter } from "@supplystrata/source-adapter-spec";
import type { FetchTask, RawDocument } from "@supplystrata/core";
import { persistDocumentObservations } from "./document-observations.js";

export interface SourceCheckSummary {
  source_adapter_id: string;
  task_id: string;
  doc_id: string;
  source_url: string;
  change_type: SourceDocumentChangeType;
  source_item_id: string;
  source_event_id: string;
  observations: number;
  semantic_changes: number;
  relation_changes: number;
}

export interface SourceCheckOptions {
  checkTargetId?: string;
  failureCausedBy: string;
}

export async function runSourceAdapterCheck<TInput>(
  store: DatabaseStore,
  input: {
    adapter: SourceAdapter<TInput, Uint8Array>;
    adapterInput: TInput;
    context: AdapterContext;
    options: SourceCheckOptions;
  }
): Promise<SourceCheckSummary[]> {
  const summaries: SourceCheckSummary[] = [];
  try {
    for await (const task of input.adapter.plan(input.adapterInput, input.context)) {
      const raw = await fetchSourceTask(input.adapter, task, input.context);
      const normalized = await input.adapter.normalize(raw, input.context);
      const { saved, observation } = await store.transaction(async (client) => {
        const savedDocument = await saveNormalizedDocument(client, normalized);
        const documentObservation = await persistDocumentObservations(client, normalized, savedDocument.doc_id, {
          ...(input.options.checkTargetId === undefined ? {} : { checkTargetId: input.options.checkTargetId })
        });
        return { saved: savedDocument, observation: documentObservation };
      });
      summaries.push({
        source_adapter_id: input.adapter.id,
        task_id: task.task_id,
        doc_id: saved.doc_id,
        source_url: normalized.source_url,
        change_type: observation.change_type,
        source_item_id: observation.source_item_id,
        source_event_id: observation.event_id,
        observations: observation.stored_observations,
        semantic_changes: observation.semantic_changes,
        relation_changes: observation.relation_changes
      });
    }
    return summaries;
  } catch (error) {
    await recordSourceFailure(store, {
      source_adapter_id: input.adapter.id,
      error_message: messageFromUnknown(error),
      ...(input.options.checkTargetId === undefined ? {} : { check_target_id: input.options.checkTargetId }),
      caused_by: input.options.failureCausedBy
    });
    throw error;
  }
}

async function fetchSourceTask<TInput>(adapter: SourceAdapter<TInput, Uint8Array>, task: FetchTask, context: AdapterContext): Promise<RawDocument<Uint8Array>> {
  getLogger().info({ stage: "source-check", adapter: adapter.id, task_id: task.task_id }, "checking source task");
  return adapter.fetch(task, context);
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
