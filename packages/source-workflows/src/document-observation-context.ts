import type { SourceCheckConnectorRunContext } from "@supplystrata/source-connectors";
import type { SourceDocumentObservationStore } from "./document-observation-port.js";

export interface SourceCheckConnectorDocumentObservationContext extends SourceCheckConnectorRunContext {
  document_observation_store?: SourceDocumentObservationStore;
}

export function documentObservationStoreFromRunContext(context: SourceCheckConnectorRunContext): SourceDocumentObservationStore | undefined {
  if (!hasDocumentObservationStore(context)) return undefined;
  return context.document_observation_store;
}

export function documentObservationStoreOption(
  context: SourceCheckConnectorRunContext
): { documentObservationStore: SourceDocumentObservationStore } | Record<string, never> {
  const store = documentObservationStoreFromRunContext(context);
  return store === undefined ? {} : { documentObservationStore: store };
}

function hasDocumentObservationStore(context: SourceCheckConnectorRunContext): context is SourceCheckConnectorDocumentObservationContext {
  return "document_observation_store" in context;
}
