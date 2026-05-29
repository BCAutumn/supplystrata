import type { ScbomDocument } from "@scbom/spec";
import type { ApiOperationHandlers } from "@supplystrata/api-orchestration";
import { findCommunityPackScbomDocument, type LoadedCommunityPack } from "@supplystrata/community-pack";

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
