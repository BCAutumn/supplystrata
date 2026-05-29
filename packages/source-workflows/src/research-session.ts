import type { ResearchTargetProfileSelection } from "@supplystrata/research-pack";

export interface ResearchSessionProfileSummary {
  readonly layer: ResearchTargetProfileSelection["layer"];
  readonly profile_id: string | null;
  readonly title: string | null;
  readonly derivation_status: "placeholder" | "candidate" | "generic" | null;
  readonly helper_status: string | null;
  readonly target_nodes: number;
  readonly expected_upstream_components: number;
  readonly source_targets: number;
  readonly selection_reason: string;
}

export interface ResearchSessionRecord {
  readonly session_id: string;
  readonly run_id: string;
  readonly company_entity_id: string;
  readonly profile: ResearchSessionProfileSummary;
  readonly created_at: string;
}

export interface ResearchSessionStore {
  register(record: ResearchSessionRecord): void;
  get(runId: string): ResearchSessionRecord | null;
  complete(runId: string): void;
}

export function createResearchSessionStore(): ResearchSessionStore {
  const sessionsByRunId = new Map<string, ResearchSessionRecord>();
  return {
    register(record) {
      sessionsByRunId.set(record.run_id, cloneResearchSessionRecord(record));
    },
    get(runId) {
      const record = sessionsByRunId.get(runId);
      return record === undefined ? null : cloneResearchSessionRecord(record);
    },
    complete(runId) {
      sessionsByRunId.delete(runId);
    }
  };
}

export const defaultResearchSessionStore = createResearchSessionStore();

export function researchSessionProfileSummary(selection: ResearchTargetProfileSelection): ResearchSessionProfileSummary | null {
  if (selection.profile === null) {
    return {
      layer: "none",
      profile_id: null,
      title: null,
      derivation_status: null,
      helper_status: null,
      target_nodes: 0,
      expected_upstream_components: 0,
      source_targets: 0,
      selection_reason: selection.reason
    };
  }
  if (selection.profile.layer === "anchor") {
    return {
      layer: "anchor",
      profile_id: selection.profile.profile_id,
      title: selection.profile.title,
      derivation_status: null,
      helper_status: null,
      target_nodes: selection.profile.target_nodes.length,
      expected_upstream_components: 0,
      source_targets: 0,
      selection_reason: selection.reason
    };
  }
  const derivation = selection.profile.derivation;
  return {
    layer: "derived",
    profile_id: selection.profile.profile_id,
    title: selection.profile.title,
    derivation_status: derivation.status,
    helper_status: derivation.status === "placeholder" ? null : derivation.helper_status,
    target_nodes: selection.profile.target_nodes.length,
    expected_upstream_components: derivation.status === "placeholder" ? 0 : derivation.expected_upstream_components.length,
    source_targets: derivation.status === "placeholder" ? 0 : derivation.source_targets.length,
    selection_reason: selection.reason
  };
}

function cloneResearchSessionRecord(record: ResearchSessionRecord): ResearchSessionRecord {
  return {
    ...record,
    profile: { ...record.profile }
  };
}
