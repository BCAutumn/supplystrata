import { createId } from "@supplystrata/core";
import type { Env } from "@supplystrata/config";
import type { DbTxClient } from "@supplystrata/db/write";
import { createFsSnapshotStore, type SourceSnapshotStore } from "@supplystrata/source-adapter-runtime";
import type { CompanyOfficialDirectoryIdentity } from "./country-router.js";
import { routeCountryOfficialDirectoryTargets } from "./country-router.js";
import { dartKrDirectoryIdentifiers, lookupDartKrCompanyDirectory } from "./dart-kr-directory.js";
import { edinetDirectoryIdentifiers, lookupEdinetCompanyDirectory } from "./edinet-directory.js";
import { hkexDirectoryIdentifiers, lookupHkexCompanyDirectory } from "./hkex-directory.js";
import { sourceWorkflowAdapterContextInput } from "./adapter-context.js";
import { lookupTwseCompanyDirectory, twseDirectoryIdentifiers } from "./twse-directory.js";

export type OfficialDirectoryBridgeStatus = "enriched" | "unchanged" | "unavailable" | "ambiguous";

export interface OfficialDirectoryBridgeInput {
  identity: CompanyOfficialDirectoryIdentity;
  company_query: string;
  env: Env;
  now: string;
}

export interface OfficialDirectoryBridgeResult {
  status: OfficialDirectoryBridgeStatus;
  source_adapter_id?: "dart-kr" | "edinet" | "twse-mops" | "hkex-news";
  source_url?: string;
  identifiers: Record<string, string>;
  reason?: string;
}

export interface OfficialDirectoryBridgeRuntime {
  lookupDartKrCompanyDirectory?: typeof lookupDartKrCompanyDirectory;
  lookupEdinetCompanyDirectory?: typeof lookupEdinetCompanyDirectory;
  lookupTwseCompanyDirectory?: typeof lookupTwseCompanyDirectory;
  lookupHkexCompanyDirectory?: typeof lookupHkexCompanyDirectory;
  snapshotStore?: SourceSnapshotStore;
}

export async function bridgeOfficialDirectoryIdentifiers(
  input: OfficialDirectoryBridgeInput,
  runtime: OfficialDirectoryBridgeRuntime = {}
): Promise<OfficialDirectoryBridgeResult> {
  const routing = routeCountryOfficialDirectoryTargets({
    identity: input.identity,
    namespace: "official-directory-bridge",
    now: input.now
  });
  const missingRoute = routing.routes.find((route) => route.status === "missing_identifier");
  if (missingRoute === undefined) {
    return { status: "unchanged", identifiers: {} };
  }

  const adapterContext = sourceWorkflowAdapterContextInput(input.env, { now: input.now });
  const snapshotStore = runtime.snapshotStore ?? createFsSnapshotStore(input.env.OBJECT_STORE_FS_BASE);
  const directoryContext = { userAgent: adapterContext.userAgent, now: input.now, snapshotStore };
  const lookupInput = {
    query: input.company_query,
    limit: 5,
    ...stockLookupHints(input.identity.identifiers)
  };

  if (missingRoute.source_adapter_id === "dart-kr") {
    const apiKey = input.env.OPENDART_API_KEY?.trim();
    if (apiKey === undefined || apiKey.length === 0) {
      return unavailable("dart-kr", "OpenDART API key is not configured.");
    }
    const lookup = runtime.lookupDartKrCompanyDirectory ?? lookupDartKrCompanyDirectory;
    return tolerateLookup("dart-kr", () => lookup(lookupInput, { ...directoryContext, apiKey }), dartKrDirectoryIdentifiers);
  }

  if (missingRoute.source_adapter_id === "twse-mops") {
    const lookup = runtime.lookupTwseCompanyDirectory ?? lookupTwseCompanyDirectory;
    return tolerateLookup("twse-mops", () => lookup(lookupInput, directoryContext), twseDirectoryIdentifiers);
  }

  if (missingRoute.source_adapter_id === "edinet") {
    const lookup = runtime.lookupEdinetCompanyDirectory ?? lookupEdinetCompanyDirectory;
    return tolerateLookup(
      "edinet",
      () =>
        lookup(
          {
            ...lookupInput,
            ...(lookupInput.stockCode === undefined ? {} : { secCode: lookupInput.stockCode })
          },
          directoryContext
        ),
      edinetDirectoryIdentifiers
    );
  }

  if (missingRoute.source_adapter_id === "hkex-news") {
    const lookup = runtime.lookupHkexCompanyDirectory ?? lookupHkexCompanyDirectory;
    return tolerateLookup("hkex-news", () => lookup(lookupInput, directoryContext), hkexDirectoryIdentifiers);
  }

  return { status: "unchanged", identifiers: {} };
}

// 目录抓取属尽力而为：上游抖动或解析异常不得中断 research run，降级为 unavailable，由人工后续补齐。
async function tolerateLookup<T extends { source_url: string; candidates: readonly unknown[] }>(
  sourceAdapterId: NonNullable<OfficialDirectoryBridgeResult["source_adapter_id"]>,
  run: () => Promise<T>,
  toIdentifiers: (candidate: T["candidates"][number]) => Record<string, string>
): Promise<OfficialDirectoryBridgeResult> {
  try {
    const result = await run();
    return bridgeFromCandidates(sourceAdapterId, result.source_url, result.candidates, toIdentifiers);
  } catch (error) {
    return unavailable(sourceAdapterId, `Official directory lookup failed: ${messageFromUnknown(error)}`);
  }
}

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function mergeOfficialDirectoryIdentifiers(
  client: DbTxClient,
  input: {
    entity_id: string;
    identifiers: Record<string, string>;
    reviewer: string;
    source_adapter_id: string;
    source_url?: string;
    company_query: string;
  }
): Promise<void> {
  if (Object.keys(input.identifiers).length === 0) return;
  await client.query(
    `UPDATE entity_master
     SET identifiers = identifiers || $2::jsonb,
         updated_at = now()
     WHERE entity_id = $1`,
    [input.entity_id, JSON.stringify(input.identifiers)]
  );
  const changeId = createId("CHG");
  await client.query(
    `INSERT INTO change_records (change_id, scope_kind, scope_id, change_type, before, after, evidence_ids, caused_by)
     VALUES ($1,'entity',$2,'official_directory_bridge',NULL,$3,'{}',$4)`,
    [
      changeId,
      input.entity_id,
      {
        company_query: input.company_query,
        source_adapter_id: input.source_adapter_id,
        ...(input.source_url === undefined ? {} : { source_url: input.source_url }),
        identifiers: input.identifiers
      },
      input.reviewer
    ]
  );
}

function bridgeFromCandidates<T>(
  sourceAdapterId: NonNullable<OfficialDirectoryBridgeResult["source_adapter_id"]>,
  sourceUrl: string,
  candidates: readonly T[],
  toIdentifiers: (candidate: T) => Record<string, string>
): OfficialDirectoryBridgeResult {
  if (candidates.length === 0) {
    return unavailable(sourceAdapterId, "Official directory lookup returned no candidates for the company query.");
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      source_adapter_id: sourceAdapterId,
      source_url: sourceUrl,
      identifiers: {},
      reason: "Official directory lookup returned multiple candidates; automatic bridge requires a unique company match."
    };
  }
  const candidate = candidates[0];
  if (candidate === undefined) {
    return unavailable(sourceAdapterId, "Official directory lookup returned no candidates for the company query.");
  }
  return {
    status: "enriched",
    source_adapter_id: sourceAdapterId,
    source_url: sourceUrl,
    identifiers: toIdentifiers(candidate)
  };
}

function stockLookupHints(identifiers: Record<string, unknown>): { stockCode?: string } {
  const stockCode = firstStringIdentifier(identifiers, [
    "kr_stock_code",
    "twse_stock_code",
    "hkex_stock_code",
    "jp_sec_code",
    "securities_code",
    "stock_code",
    "ticker"
  ]);
  return stockCode === undefined ? {} : { stockCode };
}

function firstStringIdentifier(identifiers: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = identifiers[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function unavailable(
  sourceAdapterId: NonNullable<OfficialDirectoryBridgeResult["source_adapter_id"]>,
  reason: string
): OfficialDirectoryBridgeResult {
  return {
    status: "unavailable",
    source_adapter_id: sourceAdapterId,
    identifiers: {},
    reason
  };
}
