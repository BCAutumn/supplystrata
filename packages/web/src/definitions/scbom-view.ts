import type { ScbomDocument } from "@scbom/spec";

export interface ScbomViewMetadata {
  readonly schema_version: ScbomDocument["schema_version"];
  readonly document_id: string;
  readonly generated_at: string;
  readonly producer_name: string;
}

export interface ScbomViewEntity {
  readonly id: string;
  readonly name: string;
  readonly entity_kind: string;
  readonly identifier_labels: readonly string[];
}

export interface ScbomViewEvidence {
  readonly id: string;
  readonly source_title: string;
  readonly source_url: string;
  readonly citation_text: string;
  readonly locator_label: string;
  readonly evidence_level?: number;
  readonly visual_weight: ScbomEvidenceVisualWeight;
  readonly assessment_labels: readonly string[];
}

export type ScbomEvidenceVisualWeight = "level_5" | "level_4" | "level_3" | "level_2" | "level_1" | "unknown";

export interface ScbomViewEvidenceRef {
  readonly evidence_id: string;
  readonly evidence?: ScbomViewEvidence;
}

export interface ScbomViewRelationship {
  readonly id: string;
  readonly subject_ref: string;
  readonly subject_name: string;
  readonly predicate: string;
  readonly object_ref: string;
  readonly object_name: string;
  readonly validity_status: string;
  readonly evidence_level?: number;
  readonly visual_weight: ScbomEvidenceVisualWeight;
  readonly evidence_trail: readonly ScbomViewEvidenceRef[];
  readonly assessment_labels: readonly string[];
}

export interface ScbomViewObservation {
  readonly id: string;
  readonly scope_ref: string;
  readonly observation_kind: string;
  readonly statement: string;
  readonly evidence_trail: readonly ScbomViewEvidenceRef[];
}

export interface ScbomViewUnknown {
  readonly id: string;
  readonly scope_ref: string;
  readonly question: string;
  readonly status: string;
  readonly reason?: string;
  readonly evidence_trail: readonly ScbomViewEvidenceRef[];
}

export interface ScbomViewChange {
  readonly id: string;
  readonly changed_object_ref: string;
  readonly change_type: string;
  readonly changed_at: string;
  readonly summary: string;
  readonly evidence_trail: readonly ScbomViewEvidenceRef[];
}

export interface ScbomViewGraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: "entity" | "evidence" | "observation" | "unknown" | "change";
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly label_x: number;
  readonly label_y: number;
  readonly label_width: number;
}

export interface ScbomViewGraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: "relationship" | "evidence_link" | "change_link";
  readonly label: string;
}

export interface ScbomView {
  readonly metadata: ScbomViewMetadata;
  readonly warnings: readonly ScbomViewWarning[];
  readonly entities: readonly ScbomViewEntity[];
  readonly evidences: readonly ScbomViewEvidence[];
  readonly relationships: readonly ScbomViewRelationship[];
  readonly observations: readonly ScbomViewObservation[];
  readonly unknowns: readonly ScbomViewUnknown[];
  readonly changes: readonly ScbomViewChange[];
  readonly graph: {
    readonly nodes: readonly ScbomViewGraphNode[];
    readonly edges: readonly ScbomViewGraphEdge[];
    readonly bounds: ScbomViewGraphBounds;
  };
}

export interface ScbomViewGraphBounds {
  readonly min_x: number;
  readonly min_y: number;
  readonly width: number;
  readonly height: number;
}

export interface ScbomViewWarning {
  readonly code: "missing_ref" | "unsupported_object";
  readonly message: string;
  readonly object_id?: string;
  readonly ref?: string;
}
