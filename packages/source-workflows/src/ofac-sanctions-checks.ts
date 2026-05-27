import { createHash } from "node:crypto";
import type { NormalizedDocument, RawDocument } from "@supplystrata/core";
import { saveNormalizedDocumentTx, type DatabaseStore, type DbTxClient } from "@supplystrata/db/write";
import { messageFromUnknown, noopLogger } from "@supplystrata/observability";
import { storeObservation, type ObservationScopeKind } from "@supplystrata/observation-store";
import { recordSourceFailure } from "@supplystrata/source-monitor";
import {
  createAdapterContext as createRuntimeAdapterContext,
  createRateLimitedSourceAdapter,
  fetchOrLoadCachedSnapshot,
  persistRawDocumentSnapshot,
  requireSnapshotStore,
  type AdapterContext,
  type CreateAdapterContextInput,
  type SourceAdapter
} from "@supplystrata/source-adapter-runtime";
import {
  optionalConfigPositiveInteger,
  requireConfigStringArray,
  type SourceCheckAdapterContextInput,
  type SourceCheckConnector,
  type SourceCheckConnectorLogger
} from "@supplystrata/source-connectors";
import type { SourceCheckSummary } from "./source-check-runner.js";
import { recordSavedDocumentObservation } from "./saved-document-observation.js";

const OFAC_SDN_XML_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const OFAC_STORAGE_PREFIX = "policy/ofac/sdn";

export interface OfacSanctionsInput {
  targetNames: readonly string[];
  listUrl?: string;
  maxMatches?: number;
}

export interface OfacSanctionsEntry {
  uid: string;
  primary_name: string;
  sdn_type: string | null;
  programs: readonly string[];
  aliases: readonly string[];
}

export interface OfacSanctionsMatch {
  target_name: string;
  matched_name: string;
  match_source: "primary_name" | "alias";
  entry: OfacSanctionsEntry;
}

const ofacSanctionsAdapterBase: SourceAdapter<OfacSanctionsInput, Uint8Array> = {
  id: "ofac-sanctions",
  tier: "P0",
  description: "OFAC SDN sanctions list XML monitor for policy constraint observations.",
  tos_url: "https://ofac.treasury.gov/useful-information",
  rate_limit: { requests: 1, per_seconds: 10 },
  async *plan(input, ctx) {
    const targetDigest = stableDigest({ target_names: input.targetNames });
    yield {
      task_id: `ofac-sdn:${targetDigest}`,
      url: input.listUrl ?? OFAC_SDN_XML_URL,
      expected_format: "xml",
      params: { target_names: [...input.targetNames] },
      hint: {
        document_type: "manual",
        period: ctx.now().toISOString().slice(0, 10)
      }
    };
  },
  async fetch(task, ctx) {
    const snapshot = await fetchOrLoadCachedSnapshot({
      url: task.url,
      userAgent: ctx.userAgent,
      partition: "current",
      extension: "xml",
      storagePrefix: OFAC_STORAGE_PREFIX,
      sourceLabel: "OFAC SDN XML",
      timeoutMs: 45_000,
      snapshotStore: requireSnapshotStore(ctx, "ofac-sanctions"),
      headers: { Accept: "application/xml,text/xml,*/*" }
    });
    return persistRawDocumentSnapshot({
      ctx,
      sourceAdapterId: "ofac-sanctions",
      url: task.url,
      body: snapshot.bytes,
      metadata: {
        task_id: task.task_id,
        document_type: "manual",
        source_date: ctx.now().toISOString().slice(0, 10),
        source_fetch_status: snapshot.source_fetch_status,
        target_names: task.params?.["target_names"],
        list_kind: "SDN",
        ...(snapshot.source_fetch_error === undefined ? {} : { source_fetch_error: snapshot.source_fetch_error })
      },
      storageKeyForSha256: (sha256) => `${OFAC_STORAGE_PREFIX}/current/${sha256}.xml`
    });
  },
  async normalize(raw) {
    return normalizeOfacSdnDocument(raw);
  }
};

export const ofacSanctionsAdapter = createRateLimitedSourceAdapter(ofacSanctionsAdapterBase);

export function createOfacSanctionsAdapterContext(input: CreateAdapterContextInput): AdapterContext {
  return createRuntimeAdapterContext(input);
}

export const ofacSanctionsSourceCheckConnector: SourceCheckConnector<DatabaseStore, SourceCheckSummary> = {
  source_adapter_id: "ofac-sanctions",
  target_kind: "policy-constraint-observation",
  config_schema: {
    fields: [
      { key: "target_names", type: "string_array", required: true, description: "Exact legal names or aliases to screen against OFAC SDN entries." },
      { key: "scope_kind", type: "string", required: false, description: "Observation scope kind.", allowed_values: ["company", "topic"] },
      { key: "scope_id", type: "string", required: false, description: "Observation scope id; defaults to the first target name." },
      { key: "list_url", type: "string", required: false, description: "Override OFAC SDN XML URL for fixtures or controlled mirrors." },
      { key: "max_matches", type: "positive_integer", required: false, description: "Maximum matched SDN entries to store as observations." }
    ]
  },
  run(store, target, context) {
    return runOfacSanctionsSourceCheck(store, ofacSanctionsInputFromConfig(target.target_config), {
      checkTargetId: target.check_target_id,
      targetConfig: target.target_config,
      adapterContextInput: context.adapter_context_input,
      checkedAt: context.checked_at,
      ...(context.logger === undefined ? {} : { logger: context.logger })
    });
  }
};

interface OfacSanctionsCheckOptions {
  checkTargetId: string;
  targetConfig: Record<string, unknown>;
  adapterContextInput: SourceCheckAdapterContextInput;
  checkedAt: string;
  logger?: SourceCheckConnectorLogger;
}

async function runOfacSanctionsSourceCheck(store: DatabaseStore, input: OfacSanctionsInput, options: OfacSanctionsCheckOptions): Promise<SourceCheckSummary[]> {
  const context = createOfacSanctionsAdapterContext(options.adapterContextInput);
  const summaries: SourceCheckSummary[] = [];
  const logger = options.logger ?? noopLogger;
  try {
    for await (const task of ofacSanctionsAdapter.plan(input, context)) {
      logger.info({ stage: "source-check", adapter: ofacSanctionsAdapter.id, task_id: task.task_id }, "checking OFAC sanctions source task");
      const raw = await ofacSanctionsAdapter.fetch(task, context);
      const normalized = await ofacSanctionsAdapter.normalize(raw, context);
      const matches = matchOfacSanctionsEntries(raw.body, input).slice(0, input.maxMatches ?? 20);
      const { saved, documentObservation, storedObservations } = await store.transaction(async (client) => {
        const savedDocument = await saveNormalizedDocumentTx(client, normalized);
        const savedObservation = await recordSavedDocumentObservation(client, normalized, savedDocument.doc_id, { checkTargetId: options.checkTargetId });
        const observationCount = await storeOfacPolicyObservations(client, matches, {
          docId: savedDocument.doc_id,
          sourceItemId: savedObservation.source_item_id,
          sourceUrl: normalized.source_url,
          targetConfig: options.targetConfig
        });
        return { saved: savedDocument, documentObservation: savedObservation, storedObservations: observationCount };
      });
      summaries.push({
        source_adapter_id: ofacSanctionsAdapter.id,
        task_id: task.task_id,
        doc_id: saved.doc_id,
        source_url: normalized.source_url,
        change_type: documentObservation.change_type,
        source_item_id: documentObservation.source_item_id,
        source_event_id: documentObservation.event_id,
        observations: storedObservations,
        semantic_changes: 0,
        relation_changes: 0
      });
    }
    return summaries;
  } catch (error) {
    await store.transaction(async (client) => {
      await recordSourceFailure(client, {
        source_adapter_id: ofacSanctionsAdapter.id,
        check_target_id: options.checkTargetId,
        error_message: messageFromUnknown(error),
        failed_at: options.checkedAt,
        caused_by: "source-check.ofac-sanctions"
      });
    });
    throw error;
  }
}

async function storeOfacPolicyObservations(
  client: DbTxClient,
  matches: readonly OfacSanctionsMatch[],
  input: { docId: string; sourceItemId: string; sourceUrl: string; targetConfig: Record<string, unknown> }
): Promise<number> {
  let count = 0;
  for (const match of matches) {
    // 制裁命中是强政策约束信号，但仍不是供应链事实关系，必须停留在 observation/alert 层。
    await storeObservation(client, {
      observation_type: "POLICY_OBSERVATION",
      source_adapter_id: "ofac-sanctions",
      source_item_id: input.sourceItemId,
      doc_id: input.docId,
      scope_kind: scopeKindFromConfig(input.targetConfig),
      scope_id: scopeIdFromConfig(input.targetConfig, match.target_name),
      metric_name: "ofac_sdn.match",
      metric_value: "1",
      metric_unit: "match",
      confidence: 0.96,
      provenance: {
        source_url: input.sourceUrl,
        list_kind: "SDN",
        uid: match.entry.uid,
        sdn_type: match.entry.sdn_type,
        programs: match.entry.programs,
        matched_target_name: match.target_name,
        matched_name: match.matched_name,
        match_source: match.match_source,
        aliases: match.entry.aliases,
        no_company_edge: true,
        constraint_context_only_no_fact_mutation: true
      },
      attrs: {
        semantic_layer: "observation",
        observation_policy: "policy_constraint_cannot_create_supply_chain_edge",
        constraint_kind: "sanctions",
        constraint_source: "OFAC_SDN",
        alert_candidate_eligible: true,
        match_mode: "exact_normalized"
      }
    });
    count += 1;
  }
  return count;
}

export function ofacSanctionsInputFromConfig(config: Record<string, unknown>): OfacSanctionsInput {
  const label = "OFAC sanctions source check target";
  const listUrl = optionalConfigString(config, "list_url", label);
  const maxMatches = optionalConfigPositiveInteger(config, "max_matches", label);
  return {
    targetNames: requireConfigStringArray(config, "target_names", label),
    ...(listUrl === undefined ? {} : { listUrl }),
    ...(maxMatches === undefined ? {} : { maxMatches })
  };
}

export function matchOfacSanctionsEntries(bytes: Uint8Array, input: OfacSanctionsInput): OfacSanctionsMatch[] {
  const targetNames = input.targetNames.map((name) => ({ value: name, normalized: normalizeName(name) }));
  const matches: OfacSanctionsMatch[] = [];
  for (const entry of parseOfacSdnEntries(bytes)) {
    for (const targetName of targetNames) {
      if (targetName.normalized.length === 0) continue;
      if (normalizeName(entry.primary_name) === targetName.normalized) {
        matches.push({ target_name: targetName.value, matched_name: entry.primary_name, match_source: "primary_name", entry });
        continue;
      }
      const alias = entry.aliases.find((item) => normalizeName(item) === targetName.normalized);
      if (alias !== undefined) {
        matches.push({ target_name: targetName.value, matched_name: alias, match_source: "alias", entry });
      }
    }
  }
  return matches;
}

export function parseOfacSdnEntries(bytes: Uint8Array): OfacSanctionsEntry[] {
  const xml = new TextDecoder().decode(bytes);
  const entries: OfacSanctionsEntry[] = [];
  for (const match of xml.matchAll(/<sdnEntry\b[^>]*>([\s\S]*?)<\/sdnEntry>/g)) {
    const block = match[1];
    if (block === undefined) continue;
    const uid = tagText(block, "uid");
    const primaryName = personOrEntityName(block);
    if (uid === null || primaryName === null) continue;
    entries.push({
      uid,
      primary_name: primaryName,
      sdn_type: tagText(block, "sdnType"),
      programs: tagTexts(tagBlock(block, "programList") ?? "", "program"),
      aliases: aliasNames(block)
    });
  }
  return entries;
}

function normalizeOfacSdnDocument(raw: RawDocument<Uint8Array>): NormalizedDocument {
  const text = [
    "OFAC SDN sanctions list snapshot.",
    `source_url: ${raw.url}`,
    `fetched_at: ${raw.fetched_at}`,
    `bytes_sha256: ${raw.bytes_sha256}`,
    "This document is a policy constraint source. It cannot create supply-chain fact edges."
  ].join("\n");
  return {
    doc_id: raw.doc_id,
    source_adapter_id: raw.source_adapter_id,
    document_type: "manual",
    language: "en",
    fetched_at: raw.fetched_at,
    source_date: typeof raw.metadata["source_date"] === "string" ? raw.metadata["source_date"] : raw.fetched_at.slice(0, 10),
    source_url: raw.url,
    storage_key: raw.storage_key,
    bytes_sha256: raw.bytes_sha256,
    text,
    chunks: [{ chunk_id: `${raw.doc_id}-CHUNK-0`, text, locator: "ofac-sdn-summary", language: "en" }],
    metadata: {
      ...raw.metadata,
      observation_policy: "policy_constraint_cannot_create_supply_chain_edge"
    }
  };
}

function aliasNames(block: string): string[] {
  const aliases: string[] = [];
  for (const match of block.matchAll(/<aka\b[^>]*>([\s\S]*?)<\/aka>/g)) {
    const akaBlock = match[1];
    if (akaBlock === undefined) continue;
    const name = personOrEntityName(akaBlock);
    if (name !== null) aliases.push(name);
  }
  return [...new Set(aliases)];
}

function personOrEntityName(block: string): string | null {
  const firstName = tagText(block, "firstName");
  const lastName = tagText(block, "lastName");
  if (firstName === null && lastName === null) return null;
  return [firstName, lastName]
    .filter((value): value is string => value !== null && value.length > 0)
    .join(" ")
    .trim();
}

function tagBlock(block: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`).exec(block);
  return match?.[1] ?? null;
}

function tagText(block: string, tagName: string): string | null {
  const value = tagBlock(block, tagName);
  if (value === null) return null;
  return decodeXmlText(value).trim() || null;
}

function tagTexts(block: string, tagName: string): string[] {
  return [...block.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "g"))]
    .map((match) => decodeXmlText(match[1] ?? "").trim())
    .filter((value) => value.length > 0);
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function scopeKindFromConfig(config: Record<string, unknown>): ObservationScopeKind {
  const value = optionalConfigString(config, "scope_kind", "OFAC sanctions source check target") ?? "company";
  if (value === "company" || value === "topic") return value;
  throw new Error(`Unsupported OFAC sanctions observation scope_kind: ${value}`);
}

function scopeIdFromConfig(config: Record<string, unknown>, targetName: string): string {
  return optionalConfigString(config, "scope_id", "OFAC sanctions source check target") ?? targetName;
}

function optionalConfigString(config: Record<string, unknown>, key: string, label: string): string | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} ${key} must be a non-empty string`);
  return value.trim();
}

function stableDigest(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
