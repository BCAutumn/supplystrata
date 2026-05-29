import type { ScbomDocument } from "@scbom/spec";
import type { ScbomView } from "../definitions/scbom-view.js";

export function createScbomView(document: ScbomDocument): ScbomView {
  return {
    metadata: {
      schema_version: document.schema_version,
      document_id: document.document_id,
      generated_at: document.generated_at,
      producer_name: document.producer.name
    },
    entities: [],
    evidences: [],
    relationships: [],
    observations: [],
    unknowns: [],
    changes: [],
    graph: {
      nodes: [],
      edges: []
    }
  };
}
