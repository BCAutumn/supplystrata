import type { ScbomDocument } from "@scbom/spec";
import type { ApiOperationHandlers } from "@supplystrata/api-orchestration";
import { findCommunityPackScbomDocument, loadCommunityPackFromPath, type LoadedCommunityPack } from "@supplystrata/community-pack";

export interface LoadCommunityPackBaselineOptions {
  loadPack?: (path: string) => LoadedCommunityPack;
  warn?: (message: string) => void;
}

// 数据流承诺：pack 校验/资格复检失败时降级到纯本地 cache 并显式告警，而非让整个 MCP 进程退出。
export function loadCommunityPackBaselineOrWarn(packPath: string, options: LoadCommunityPackBaselineOptions = {}): LoadedCommunityPack | undefined {
  const loadPack = options.loadPack ?? loadCommunityPackFromPath;
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  try {
    return loadPack(packPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    warn(`Community-pack at ${packPath} failed validation and was skipped; serving from local cache only. Reason: ${reason}`);
    return undefined;
  }
}

export function withCommunityPackBaseline(handlers: ApiOperationHandlers, communityPack: LoadedCommunityPack | undefined): ApiOperationHandlers {
  if (communityPack === undefined) return handlers;
  return {
    ...handlers,
    getCompanyScbomDocument: async (input) => {
      const companyId = input.path_params["id"];
      const baseline = companyId === undefined ? undefined : findCommunityPackScbomDocument(communityPack, companyId);
      const fallback = handlers["getCompanyScbomDocument"];
      if (fallback === undefined) {
        if (baseline !== undefined) return baseline;
        throw new Error("MCP community-pack overlay requires getCompanyScbomDocument fallback handler.");
      }

      try {
        const current = await fallback(input);
        if (hasRelationship(current)) return current;
        return baseline ?? current;
      } catch (error) {
        if (baseline !== undefined) return baseline;
        throw error;
      }
    }
  };
}

function hasRelationship(value: unknown): value is ScbomDocument {
  if (!isRecord(value)) return false;
  const objects = value["objects"];
  return Array.isArray(objects) && objects.some((object) => isRecord(object) && object["object_type"] === "relationship");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
