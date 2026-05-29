import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import type { ScbomDocument, ScbomObject, ScbomObjectType } from "@scbom/spec";
import commonSchema from "@scbom/spec/schemas/common" with { type: "json" };
import entitySchema from "@scbom/spec/schemas/entity" with { type: "json" };
import evidenceSchema from "@scbom/spec/schemas/evidence" with { type: "json" };
import relationshipSchema from "@scbom/spec/schemas/relationship" with { type: "json" };
import observationSchema from "@scbom/spec/schemas/observation" with { type: "json" };
import unknownSchema from "@scbom/spec/schemas/unknown" with { type: "json" };
import changeSchema from "@scbom/spec/schemas/change" with { type: "json" };
import documentSchema from "@scbom/spec/schemas/document" with { type: "json" };
import {
  COMMUNITY_PACK_CANONICAL_FORMAT,
  COMMUNITY_PACK_DATA_FILE_ROLE,
  COMMUNITY_PACK_DATA_MEDIA_TYPE,
  COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION,
  COMMUNITY_PACK_SCBOM_SCHEMA_VERSION,
  COMMUNITY_PACK_SHA256_ALGORITHM,
  type CommunityPackDataFileContent,
  type CommunityPackJsonlSummary,
  type CommunityPackManifest,
  type CommunityPackManifestFile,
  type CommunityPackObjectCounts
} from "../definitions/manifest.js";

const PACK_VERSION_PATTERN = /^pack-[0-9]{4}\.Q[1-4]$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const MANIFEST_KEYS = [
  "schema_version",
  "pack_version",
  "generated_at",
  "canonical_format",
  "scbom_schema_version",
  "license",
  "source_instance",
  "integrity",
  "files",
  "totals"
] as const;

const SOURCE_INSTANCE_KEYS = ["fingerprint"] as const;
const INTEGRITY_KEYS = ["algorithm"] as const;
const FILE_KEYS = ["path", "role", "media_type", "sha256", "bytes", "documents", "object_counts"] as const;
const TOTALS_KEYS = ["files", "documents", "object_counts"] as const;
const OBJECT_COUNT_KEYS = ["total", "entity", "evidence", "relationship", "observation", "unknown", "change"] as const;
const SCBOM_DOCUMENT_SCHEMA_ID = "https://scbom.org/schema/v0.0.1/scbom-document.schema.json";

const ajv = new Ajv2020({ allErrors: true });
ajv.addSchema(commonSchema);
ajv.addSchema(entitySchema);
ajv.addSchema(evidenceSchema);
ajv.addSchema(relationshipSchema);
ajv.addSchema(observationSchema);
ajv.addSchema(unknownSchema);
ajv.addSchema(changeSchema);

const validateScbomDocument = ajv.compile(documentSchema);

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function parseCommunityPackManifest(text: string): CommunityPackManifest {
  const parsed: unknown = JSON.parse(text);
  assertCommunityPackManifest(parsed);
  return parsed;
}

export function assertCommunityPackManifest(value: unknown): asserts value is CommunityPackManifest {
  const errors = validateCommunityPackManifest(value);
  if (errors.length > 0) throw new Error(`Invalid community-pack manifest: ${errors.slice(0, 8).join("; ")}`);
}

export function validateCommunityPackManifest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["$ must be an object"];
  rejectExtraKeys(value, MANIFEST_KEYS, "$", errors);
  expectLiteral(value, "schema_version", COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION, "$", errors);
  expectPattern(value, "pack_version", PACK_VERSION_PATTERN, "$", errors);
  expectString(value, "generated_at", "$", errors);
  expectLiteral(value, "canonical_format", COMMUNITY_PACK_CANONICAL_FORMAT, "$", errors);
  expectLiteral(value, "scbom_schema_version", COMMUNITY_PACK_SCBOM_SCHEMA_VERSION, "$", errors);
  expectNonEmptyString(value, "license", "$", errors);
  validateSourceInstance(value["source_instance"], "$.source_instance", errors);
  validateIntegrity(value["integrity"], "$.integrity", errors);
  validateFiles(value["files"], "$.files", errors);
  validateTotals(value["totals"], "$.totals", errors);
  validateManifestTotals(value, errors);
  return errors;
}

export function summarizeScbomJsonl(text: string): CommunityPackJsonlSummary {
  const documents = parseScbomJsonl(text);
  return {
    documents: documents.length,
    object_counts: documents.reduce((counts, document) => addObjectCounts(counts, countObjects(document)), emptyObjectCounts())
  };
}

export function assertCommunityPackFileIntegrity(manifest: CommunityPackManifest, files: readonly CommunityPackDataFileContent[]): void {
  assertCommunityPackManifest(manifest);
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const errors: string[] = [];

  for (const file of manifest.files) {
    const content = byPath.get(file.path);
    if (content === undefined) {
      errors.push(`${file.path} is listed in manifest but no content was provided`);
      continue;
    }
    const bytes = byteLength(content);
    const sha256 = sha256Hex(content);
    if (bytes !== file.bytes) errors.push(`${file.path} byte count mismatch: manifest ${file.bytes}, actual ${bytes}`);
    if (sha256 !== file.sha256) errors.push(`${file.path} sha256 mismatch`);

    const summary = summarizeScbomJsonl(contentToText(content));
    if (summary.documents !== file.documents) errors.push(`${file.path} document count mismatch: manifest ${file.documents}, actual ${summary.documents}`);
    compareObjectCounts(file.object_counts, summary.object_counts, `${file.path}.object_counts`, errors);
  }

  if (errors.length > 0) throw new Error(`Community-pack file integrity failed: ${errors.slice(0, 8).join("; ")}`);
}

export function manifestFileForScbomJsonl(input: { path: string; content: string | Uint8Array }): CommunityPackManifestFile {
  const text = contentToText(input.content);
  const summary = summarizeScbomJsonl(text);
  return {
    path: input.path,
    role: COMMUNITY_PACK_DATA_FILE_ROLE,
    media_type: COMMUNITY_PACK_DATA_MEDIA_TYPE,
    sha256: sha256Hex(input.content),
    bytes: byteLength(input.content),
    documents: summary.documents,
    object_counts: summary.object_counts
  };
}

export function manifestTotals(files: readonly CommunityPackManifestFile[]): CommunityPackManifest["totals"] {
  return {
    files: files.length,
    documents: files.reduce((count, file) => count + file.documents, 0),
    object_counts: files.reduce((counts, file) => addObjectCounts(counts, file.object_counts), emptyObjectCounts())
  };
}

function parseScbomJsonl(text: string): ScbomDocument[] {
  return jsonlLines(text).map((line, index) => {
    const parsed: unknown = JSON.parse(line);
    assertCommunityPackScbomDocument(parsed);
    if (parsed.schema_version !== COMMUNITY_PACK_SCBOM_SCHEMA_VERSION) {
      throw new Error(`SCBOM JSONL line ${index + 1} must use schema_version ${COMMUNITY_PACK_SCBOM_SCHEMA_VERSION}`);
    }
    return parsed;
  });
}

function assertCommunityPackScbomDocument(value: unknown): asserts value is ScbomDocument {
  if (!validateScbomDocument(value)) {
    const errors = validateScbomDocument.errors ?? [];
    throw new Error(`JSONL line is not a valid SCBOM ${SCBOM_DOCUMENT_SCHEMA_ID} document: ${errors.slice(0, 8).map(formatAjvError).join("; ")}`);
  }
  if (!isScbomDocument(value)) {
    throw new Error(`JSONL line is not a valid SCBOM ${SCBOM_DOCUMENT_SCHEMA_ID} document: schema validation did not produce a typed document`);
  }
  validateScbomObjectRefs(value);
}

function validateScbomObjectRefs(document: ScbomDocument): void {
  const objectTypes = new Map<string, ScbomObjectType>();
  const errors: string[] = [];

  for (const object of document.objects) {
    if (objectTypes.has(object.id)) errors.push(`duplicate object id ${object.id}`);
    objectTypes.set(object.id, object.object_type);
  }

  for (const object of document.objects) {
    for (const ref of refsForObject(object)) {
      const actualType = objectTypes.get(ref.id);
      if (actualType === undefined) {
        errors.push(`${object.id} references missing object ${ref.id}`);
      } else if (ref.expectedType !== undefined && actualType !== ref.expectedType) {
        errors.push(`${object.id} references ${ref.id} as ${ref.expectedType}, got ${actualType}`);
      }
    }
  }

  if (errors.length > 0) throw new Error(`SCBOM document has invalid object references: ${errors.slice(0, 8).join("; ")}`);
}

interface ScbomRefRequirement {
  readonly id: string;
  readonly expectedType?: ScbomObjectType;
}

function refsForObject(object: ScbomObject): readonly ScbomRefRequirement[] {
  switch (object.object_type) {
    case "entity":
    case "evidence":
      return evidenceRefs(object.provenance.source_refs);
    case "relationship":
      return [
        { id: object.subject_ref, expectedType: "entity" },
        { id: object.object_ref, expectedType: "entity" },
        ...evidenceRefs(object.evidence_refs),
        ...evidenceRefs(object.provenance.source_refs)
      ];
    case "observation":
      return [{ id: object.scope_ref }, ...evidenceRefs(object.evidence_refs), ...evidenceRefs(object.provenance.source_refs)];
    case "unknown":
      return [{ id: object.scope_ref }, ...evidenceRefs(object.evidence_refs), ...evidenceRefs(object.provenance.source_refs)];
    case "change":
      return [{ id: object.changed_object_ref }, ...evidenceRefs(object.evidence_refs), ...evidenceRefs(object.provenance.source_refs)];
  }
}

function evidenceRefs(refs: readonly string[] | undefined): ScbomRefRequirement[] {
  return (refs ?? []).map((id) => ({ id, expectedType: "evidence" }));
}

function formatAjvError(error: NonNullable<typeof validateScbomDocument.errors>[number]): string {
  return `${error.instancePath || "$"} ${error.message ?? "failed validation"}`;
}

function isScbomDocument(value: unknown): value is ScbomDocument {
  if (!isRecord(value)) return false;
  if (value["schema_version"] !== COMMUNITY_PACK_SCBOM_SCHEMA_VERSION) return false;
  if (typeof value["document_id"] !== "string") return false;
  if (typeof value["generated_at"] !== "string") return false;
  if (!isRecord(value["producer"])) return false;
  if (!Array.isArray(value["objects"])) return false;
  return value["objects"].every(isScbomObject);
}

function isScbomObject(value: unknown): value is ScbomObject {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string") return false;
  switch (value["object_type"]) {
    case "entity":
    case "evidence":
    case "relationship":
    case "observation":
    case "unknown":
    case "change":
      return true;
    default:
      return false;
  }
}

function jsonlLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function countObjects(document: ScbomDocument): CommunityPackObjectCounts {
  const counts = emptyObjectCounts();
  for (const object of document.objects) {
    counts.total += 1;
    counts[object.object_type] += 1;
  }
  return counts;
}

function emptyObjectCounts(): CommunityPackObjectCounts {
  return { total: 0, entity: 0, evidence: 0, relationship: 0, observation: 0, unknown: 0, change: 0 };
}

function addObjectCounts(left: CommunityPackObjectCounts, right: CommunityPackObjectCounts): CommunityPackObjectCounts {
  return {
    total: left.total + right.total,
    entity: left.entity + right.entity,
    evidence: left.evidence + right.evidence,
    relationship: left.relationship + right.relationship,
    observation: left.observation + right.observation,
    unknown: left.unknown + right.unknown,
    change: left.change + right.change
  };
}

function validateSourceInstance(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  rejectExtraKeys(value, SOURCE_INSTANCE_KEYS, path, errors);
  expectPattern(value, "fingerprint", SHA256_PATTERN, path, errors);
}

function validateIntegrity(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  rejectExtraKeys(value, INTEGRITY_KEYS, path, errors);
  expectLiteral(value, "algorithm", COMMUNITY_PACK_SHA256_ALGORITHM, path, errors);
}

function validateFiles(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length === 0) errors.push(`${path} must include at least one SCBOM JSONL file`);
  value.forEach((item, index) => validateManifestFile(item, `${path}[${index}]`, errors));
}

function validateManifestFile(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  rejectExtraKeys(value, FILE_KEYS, path, errors);
  expectRelativeJsonlPath(value, "path", path, errors);
  expectLiteral(value, "role", COMMUNITY_PACK_DATA_FILE_ROLE, path, errors);
  expectLiteral(value, "media_type", COMMUNITY_PACK_DATA_MEDIA_TYPE, path, errors);
  expectPattern(value, "sha256", SHA256_PATTERN, path, errors);
  expectNonNegativeInteger(value, "bytes", path, errors);
  expectNonNegativeInteger(value, "documents", path, errors);
  validateObjectCounts(value["object_counts"], `${path}.object_counts`, errors);
}

function validateTotals(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  rejectExtraKeys(value, TOTALS_KEYS, path, errors);
  expectNonNegativeInteger(value, "files", path, errors);
  expectNonNegativeInteger(value, "documents", path, errors);
  validateObjectCounts(value["object_counts"], `${path}.object_counts`, errors);
}

function validateObjectCounts(value: unknown, path: string, errors: string[]): void {
  if (!isRecordAt(value, path, errors)) return;
  rejectExtraKeys(value, OBJECT_COUNT_KEYS, path, errors);
  for (const key of OBJECT_COUNT_KEYS) expectNonNegativeInteger(value, key, path, errors);
  const typed = objectCountsFromRecord(value);
  if (typed !== undefined) {
    const subtotal = typed.entity + typed.evidence + typed.relationship + typed.observation + typed.unknown + typed.change;
    if (typed.total !== subtotal) errors.push(`${path}.total must equal the sum of typed object counts`);
  }
}

function validateManifestTotals(value: Record<string, unknown>, errors: string[]): void {
  const filesValue = value["files"];
  const totalsValue = value["totals"];
  if (!Array.isArray(filesValue) || !isRecord(totalsValue)) return;
  const files = filesValue.filter(isManifestFileLike);
  const totals = totalsFromRecord(totalsValue);
  if (files.length !== filesValue.length || totals === undefined) return;
  if (totals.files !== files.length) errors.push("$.totals.files must equal files.length");
  const expected = manifestTotals(files);
  if (totals.documents !== expected.documents) errors.push("$.totals.documents must equal the sum of file documents");
  compareObjectCounts(totals.object_counts, expected.object_counts, "$.totals.object_counts", errors);
}

function compareObjectCounts(actual: CommunityPackObjectCounts, expected: CommunityPackObjectCounts, path: string, errors: string[]): void {
  for (const key of OBJECT_COUNT_KEYS) {
    if (actual[key] !== expected[key]) errors.push(`${path}.${key} mismatch: manifest ${actual[key]}, actual ${expected[key]}`);
  }
}

function isManifestFileLike(value: unknown): value is CommunityPackManifestFile {
  if (!isRecord(value)) return false;
  if (value["role"] !== COMMUNITY_PACK_DATA_FILE_ROLE || value["media_type"] !== COMMUNITY_PACK_DATA_MEDIA_TYPE) return false;
  if (typeof value["path"] !== "string" || typeof value["sha256"] !== "string") return false;
  if (!isNonNegativeInteger(value["bytes"]) || !isNonNegativeInteger(value["documents"])) return false;
  const counts = objectCountsFromRecord(value["object_counts"]);
  return counts !== undefined;
}

function totalsFromRecord(value: Record<string, unknown>): CommunityPackManifest["totals"] | undefined {
  if (!isNonNegativeInteger(value["files"]) || !isNonNegativeInteger(value["documents"])) return undefined;
  const objectCounts = objectCountsFromRecord(value["object_counts"]);
  if (objectCounts === undefined) return undefined;
  return { files: value["files"], documents: value["documents"], object_counts: objectCounts };
}

function objectCountsFromRecord(value: unknown): CommunityPackObjectCounts | undefined {
  if (!isRecord(value)) return undefined;
  const total = value["total"];
  const entity = value["entity"];
  const evidence = value["evidence"];
  const relationship = value["relationship"];
  const observation = value["observation"];
  const unknown = value["unknown"];
  const change = value["change"];
  if (
    !isNonNegativeInteger(total) ||
    !isNonNegativeInteger(entity) ||
    !isNonNegativeInteger(evidence) ||
    !isNonNegativeInteger(relationship) ||
    !isNonNegativeInteger(observation) ||
    !isNonNegativeInteger(unknown) ||
    !isNonNegativeInteger(change)
  ) {
    return undefined;
  }
  return {
    total,
    entity,
    evidence,
    relationship,
    observation,
    unknown,
    change
  };
}

function expectLiteral(record: Record<string, unknown>, key: string, expected: string, path: string, errors: string[]): void {
  if (record[key] !== expected) errors.push(`${path}.${key} must equal ${expected}`);
}

function expectString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== "string") errors.push(`${path}.${key} must be a string`);
}

function expectNonEmptyString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) errors.push(`${path}.${key} must be a non-empty string`);
}

function expectPattern(record: Record<string, unknown>, key: string, pattern: RegExp, path: string, errors: string[]): void {
  const value = record[key];
  if (typeof value !== "string" || !pattern.test(value)) errors.push(`${path}.${key} must match ${pattern.source}`);
}

function expectNonNegativeInteger(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (!isNonNegativeInteger(record[key])) errors.push(`${path}.${key} must be a non-negative integer`);
}

function expectRelativeJsonlPath(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("..") || !value.endsWith(".jsonl")) {
    errors.push(`${path}.${key} must be a relative .jsonl path without parent traversal`);
  }
}

function rejectExtraKeys(record: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) errors.push(`${path}.${key} is not part of the community-pack manifest schema`);
  }
}

function isRecordAt(value: unknown, path: string, errors: string[]): value is Record<string, unknown> {
  if (isRecord(value)) return true;
  errors.push(`${path} must be an object`);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function byteLength(content: string | Uint8Array): number {
  return typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength;
}

function contentToText(content: string | Uint8Array): string {
  return typeof content === "string" ? content : new TextDecoder().decode(content);
}
