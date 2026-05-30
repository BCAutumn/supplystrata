export const COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION = "1.0.0";
export const COMMUNITY_PACK_CANONICAL_FORMAT = "scbom-jsonl";
export const COMMUNITY_PACK_SCBOM_SCHEMA_VERSION = "0.0.1";
export const COMMUNITY_PACK_DATA_FILE_ROLE = "scbom_documents";
export const COMMUNITY_PACK_DATA_MEDIA_TYPE = "application/x-ndjson";
export const COMMUNITY_PACK_SHA256_ALGORITHM = "sha256";

// 加载侧信任门控：pack 无签名/无可信根，loader 必须独立复检发布资格，
// 不能仅凭 manifest hash 自洽就把 relationship 当 baseline 展示。
// 这些常量刻意与导出侧的 publish-eligibility 口径保持一致（fact 边：rule 抽取 + evidence_level≥4）。
export const COMMUNITY_PACK_MIN_PUBLISH_EVIDENCE_LEVEL = 4;
export const COMMUNITY_PACK_EVIDENCE_LEVEL_SCHEME = "urn:supplystrata:vocab:evidence_level";
export const COMMUNITY_PACK_EXTRACTION_METHOD_SCHEME = "urn:supplystrata:vocab:extraction_method";
export const COMMUNITY_PACK_RULE_EXTRACTION_METHOD = "rule";
export const COMMUNITY_PACK_BASELINE_RELATIONSHIP_STATUS = "active";

export type CommunityPackManifestSchemaVersion = typeof COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION;
export type CommunityPackCanonicalFormat = typeof COMMUNITY_PACK_CANONICAL_FORMAT;
export type CommunityPackScbomSchemaVersion = typeof COMMUNITY_PACK_SCBOM_SCHEMA_VERSION;
export type CommunityPackDataFileRole = typeof COMMUNITY_PACK_DATA_FILE_ROLE;
export type CommunityPackDataMediaType = typeof COMMUNITY_PACK_DATA_MEDIA_TYPE;
export type CommunityPackSha256Algorithm = typeof COMMUNITY_PACK_SHA256_ALGORITHM;

export interface CommunityPackObjectCounts {
  total: number;
  entity: number;
  evidence: number;
  relationship: number;
  observation: number;
  unknown: number;
  change: number;
}

export interface CommunityPackManifestFile {
  path: string;
  role: CommunityPackDataFileRole;
  media_type: CommunityPackDataMediaType;
  sha256: string;
  bytes: number;
  documents: number;
  object_counts: CommunityPackObjectCounts;
}

export interface CommunityPackSourceInstance {
  fingerprint: string;
}

export interface CommunityPackManifestTotals {
  files: number;
  documents: number;
  object_counts: CommunityPackObjectCounts;
}

export interface CommunityPackManifestIntegrity {
  algorithm: CommunityPackSha256Algorithm;
}

export interface CommunityPackManifest {
  schema_version: CommunityPackManifestSchemaVersion;
  pack_version: string;
  generated_at: string;
  canonical_format: CommunityPackCanonicalFormat;
  scbom_schema_version: CommunityPackScbomSchemaVersion;
  license: string;
  source_instance: CommunityPackSourceInstance;
  integrity: CommunityPackManifestIntegrity;
  files: CommunityPackManifestFile[];
  totals: CommunityPackManifestTotals;
}

export interface CommunityPackDataFileContent {
  path: string;
  content: string | Uint8Array;
}

export interface CommunityPackJsonlSummary {
  documents: number;
  object_counts: CommunityPackObjectCounts;
}
