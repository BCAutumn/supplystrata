import type { DocumentType } from "@supplystrata/core";
import { SOURCE_REGISTRY } from "./registry-data.js";
import type { SourceAuthority, SourceRegistryEntry } from "./types.js";

export { SOURCE_REGISTRY } from "./registry-data.js";
export type {
  AutomationPolicy,
  PublisherType,
  RelationAuthority,
  SourceAuthority,
  SourceCategory,
  SourceRegistryEntry,
  SourceStatus,
  SourceTier
} from "./types.js";

export function listSources(): SourceRegistryEntry[] {
  return [...SOURCE_REGISTRY];
}

export function getSourceById(sourceAdapterId: string): SourceRegistryEntry | undefined {
  return sourceById(sourceAdapterId);
}

// 来源权威矩阵的唯一入口：scorer 只能通过这里判断“这个来源最多能证明什么”。
export function sourceAuthorityFor(input: { source_adapter_id: string; document_type: DocumentType }): SourceAuthority {
  const source = sourceById(input.source_adapter_id);
  if (source !== undefined) {
    return {
      source_adapter_id: input.source_adapter_id,
      document_type: input.document_type,
      publisher_type: source.publisher_type,
      relation_authority: source.relation_authority,
      max_evidence_level: source.evidence_level_cap
    };
  }
  return fallbackAuthority(input);
}

function sourceById(sourceAdapterId: string): SourceRegistryEntry | undefined {
  return SOURCE_REGISTRY.find((source) => source.id === sourceAdapterId);
}

function fallbackAuthority(input: { source_adapter_id: string; document_type: DocumentType }): SourceAuthority {
  // 未注册来源不能只靠 document_type 获得高证据等级；先降级成 lead，直到 source_registry 显式登记权威。
  return {
    source_adapter_id: input.source_adapter_id,
    document_type: input.document_type,
    publisher_type: "manual",
    relation_authority: "lead_only",
    max_evidence_level: 2
  };
}

export function sourceStatusSummary(): {
  total: number;
  implemented: number;
  preview: number;
  planned: number;
  scoped: number;
  manualOnly: number;
  requiresKey: number;
} {
  const sources = listSources();
  return {
    total: sources.length,
    implemented: sources.filter((source) => source.status === "implemented").length,
    preview: sources.filter((source) => source.status === "preview").length,
    planned: sources.filter((source) => source.status === "planned").length,
    scoped: sources.filter((source) => source.status === "scoped").length,
    manualOnly: sources.filter((source) => source.status === "manual_only").length,
    requiresKey: sources.filter((source) => source.requires_key).length
  };
}
