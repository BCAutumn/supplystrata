import type { DocumentType, EvidenceLevel } from "@supplystrata/core";

export type SourceTier = "P0" | "P1" | "P2" | "manual";
export type SourceStatus = "implemented" | "preview" | "planned" | "scoped" | "manual_only" | "rejected";
export type AutomationPolicy = "allowed" | "semi_auto" | "manual_only";
export type SourceCategory =
  | "official_disclosure"
  | "entity_resolution"
  | "supplier_list"
  | "facility"
  | "trade"
  | "commodity"
  | "macro"
  | "logistics"
  | "procurement_news"
  | "policy"
  | "manual";
export type PublisherType =
  | "regulator"
  | "company_official"
  | "government_registry"
  | "official_supplier_list"
  | "macro_statistical_agency"
  | "news"
  | "manual";
export type RelationAuthority = "self_disclosure" | "counterparty_disclosure" | "registry_fact" | "facility_claim" | "macro_trend" | "lead_only";

export interface SourceRegistryEntry {
  id: string;
  tier: SourceTier;
  name: string;
  category: SourceCategory;
  evidence_level_cap: EvidenceLevel;
  publisher_type: PublisherType;
  relation_authority: RelationAuthority;
  automation: AutomationPolicy;
  status: SourceStatus;
  implemented_package?: string;
  requires_key: boolean;
  official_url: string;
  tos_url: string;
  notes: string;
}

export interface SourceAuthority {
  source_adapter_id: string;
  document_type: DocumentType;
  publisher_type: PublisherType;
  relation_authority: RelationAuthority;
  max_evidence_level: EvidenceLevel;
}
