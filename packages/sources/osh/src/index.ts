import { createHash } from "node:crypto";
import { loadEnv, requireEnvValue } from "@supplystrata/config";
import { createId, type FetchTask, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import {
  createFsSnapshotStore,
  createRateLimitedSourceAdapter,
  fetchBytesWithTimeout,
  requireSnapshotStore,
  type AdapterContext,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import { normalizeTextDocument } from "@supplystrata/source-normalizers";

export interface OshFacilitySearchInput {
  query: string;
  countryCode?: string;
  sector?: string;
  page?: number;
  pageSize?: number;
}

export interface OshFacilityCandidate {
  os_id: string;
  name: string;
  address?: string;
  country_code?: string;
  country_name?: string;
  latitude?: number;
  longitude?: number;
  contributors: string[];
  sector?: string;
  product_type?: string;
  source_url: string;
}

const oshAdapterBase: SourceAdapter<OshFacilitySearchInput, Uint8Array> = {
  id: "osh",
  tier: "P1",
  description: "Open Supply Hub facility search for facility profile observations",
  tos_url: "https://info.opensupplyhub.org/terms-of-use",
  rate_limit: { requests: 1, per_seconds: 1 },
  async *plan(input) {
    yield {
      task_id: `osh-facility-search-${stableInputId(input)}`,
      url: buildOshFacilitySearchUrl(input),
      expected_format: "json",
      hint: { document_type: "facility_dataset" }
    };
  },
  async fetch(task, ctx) {
    const token = requireEnvValue(loadEnv().OSH_API_TOKEN, "OSH_API_TOKEN");
    const bytes = await fetchBytesWithTimeout(task.url, {
      userAgent: ctx.userAgent,
      timeoutMs: 15_000,
      sourceLabel: "Open Supply Hub",
      headers: {
        Accept: "application/json",
        Authorization: `Token ${token}`
      }
    });
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `facility/osh/${sha256}.json`;
    await requireSnapshotStore(ctx, "osh").put(storageKey, bytes);
    return {
      doc_id: createId("DOC"),
      source_adapter_id: "osh",
      url: task.url,
      fetched_at: ctx.now().toISOString(),
      bytes_sha256: sha256,
      storage_key: storageKey,
      body: bytes,
      metadata: { task_id: task.task_id, document_type: "facility_dataset" }
    };
  },
  async normalize(raw) {
    return normalizeOshFacilitiesDocument(raw);
  }
};

export const oshAdapter = createRateLimitedSourceAdapter(oshAdapterBase);

export function createOshAdapterContext(): AdapterContext {
  const env = loadEnv();
  return { userAgent: env.SEC_USER_AGENT, now: () => new Date(), snapshotStore: createFsSnapshotStore(env.OBJECT_STORE_FS_BASE) };
}

export function buildOshFacilitySearchUrl(input: OshFacilitySearchInput): string {
  const query = input.query.trim();
  if (query.length === 0) throw new Error("OSH facility query must not be empty");
  const url = new URL("https://opensupplyhub.org/api/facilities/");
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(input.page ?? 1));
  url.searchParams.set("pageSize", String(validatePageSize(input.pageSize ?? 25)));
  if (input.countryCode !== undefined && input.countryCode.trim().length > 0) {
    url.searchParams.set("countries", input.countryCode.trim().toUpperCase());
  }
  if (input.sector !== undefined && input.sector.trim().length > 0) {
    url.searchParams.set("sector", input.sector.trim());
  }
  return url.toString();
}

export function parseOshFacilityCandidates(bytes: Uint8Array, sourceUrl: string): OshFacilityCandidate[] {
  const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  const features = featuresFromPayload(parsed);
  return features.map((feature, index) => parseOshFeature(feature, index, sourceUrl));
}

function normalizeOshFacilitiesDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const candidates = parseOshFacilityCandidates(raw.body, raw.url);
  return normalizeTextDocument({
    raw,
    documentType: "facility_dataset",
    parserVersion: "osh-facility-json-v1",
    text: candidates.map(formatOshFacilityCandidate).join("\n\n"),
    extraMetadata: { candidate_count: candidates.length }
  });
}

function formatOshFacilityCandidate(candidate: OshFacilityCandidate): string {
  return [
    `os_id: ${candidate.os_id}`,
    `name: ${candidate.name}`,
    candidate.address === undefined ? undefined : `address: ${candidate.address}`,
    candidate.country_code === undefined ? undefined : `country_code: ${candidate.country_code}`,
    candidate.country_name === undefined ? undefined : `country_name: ${candidate.country_name}`,
    candidate.latitude === undefined ? undefined : `latitude: ${candidate.latitude}`,
    candidate.longitude === undefined ? undefined : `longitude: ${candidate.longitude}`,
    candidate.sector === undefined ? undefined : `sector: ${candidate.sector}`,
    candidate.product_type === undefined ? undefined : `product_type: ${candidate.product_type}`,
    candidate.contributors.length === 0 ? undefined : `contributors: ${candidate.contributors.join("; ")}`,
    `source_url: ${candidate.source_url}`
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function featuresFromPayload(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = requireRecord(payload, "OSH response");
  const features = root["features"];
  if (Array.isArray(features)) return features;
  const results = root["results"];
  if (Array.isArray(results)) return results;
  throw new Error("OSH response must contain features or results array");
}

function parseOshFeature(feature: unknown, index: number, sourceUrl: string): OshFacilityCandidate {
  const record = requireRecord(feature, `OSH feature ${index}`);
  const properties = isRecord(record["properties"]) ? record["properties"] : record;
  const coordinates = parseCoordinates(record["geometry"]);
  const osId = firstString(properties, ["os_id", "id"]) ?? firstString(record, ["id"]);
  if (osId === undefined) throw new Error(`OSH feature ${index} missing os_id`);
  const name = firstString(properties, ["name", "facility_name"]);
  if (name === undefined) throw new Error(`OSH feature ${index} missing name`);
  const candidate: OshFacilityCandidate = {
    os_id: osId,
    name,
    contributors: parseContributors(properties["contributors"]),
    source_url: sourceUrl
  };
  const address = firstString(properties, ["address"]);
  const countryCode = firstString(properties, ["country_code"]);
  const countryName = firstString(properties, ["country_name"]);
  const sector = firstString(properties, ["sector"]);
  const productType = firstString(properties, ["product_type", "product_types"]);
  if (address !== undefined) candidate.address = address;
  if (countryCode !== undefined) candidate.country_code = countryCode;
  if (countryName !== undefined) candidate.country_name = countryName;
  if (coordinates !== undefined) {
    candidate.longitude = coordinates.longitude;
    candidate.latitude = coordinates.latitude;
  }
  if (sector !== undefined) candidate.sector = sector;
  if (productType !== undefined) candidate.product_type = productType;
  return candidate;
}

function parseCoordinates(value: unknown): { longitude: number; latitude: number } | undefined {
  if (!isRecord(value)) return undefined;
  const coordinates = value["coordinates"];
  if (!Array.isArray(coordinates) || coordinates.length < 2) return undefined;
  const longitude: unknown = coordinates[0];
  const latitude: unknown = coordinates[1];
  if (typeof longitude !== "number" || typeof latitude !== "number") return undefined;
  return { longitude, latitude };
}

function parseContributors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const contributors: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) {
      contributors.push(item.trim());
      continue;
    }
    if (!isRecord(item)) continue;
    const name = firstString(item, ["name", "contributor_name"]);
    if (name !== undefined) contributors.push(name);
  }
  return [...new Set(contributors)].sort();
}

function validatePageSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error(`OSH pageSize must be an integer between 1 and 100: ${value}`);
  return value;
}

function stableInputId(input: OshFacilitySearchInput): string {
  return createHash("sha256")
    .update(`${input.query}|${input.countryCode ?? ""}|${input.sector ?? ""}|${String(input.page ?? "")}|${String(input.pageSize ?? "")}`)
    .digest("hex")
    .slice(0, 16);
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
