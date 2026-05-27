import { API_CONTRACT_VERSION, API_SCHEMA_VERSION, type ApiSchemaId } from "./api-contract.js";

export interface ApiJsonSchema {
  $id: ApiSchemaId;
  type: "object";
  additionalProperties: boolean;
  description: string;
  properties: Record<string, ApiJsonSchemaProperty>;
  required: readonly string[];
}

export type ApiJsonSchemaProperty =
  | { type: "string"; const?: string; enum?: readonly string[]; description?: string }
  | { type: "boolean"; const?: boolean; description?: string }
  | { type: "object"; description?: string; additionalProperties?: boolean }
  | { type: "array"; description?: string; items: { type: "object"; additionalProperties: boolean } };

const readEnvelope = (schemaId: ApiSchemaId, description: string): ApiJsonSchema => ({
  $id: schemaId,
  type: "object",
  additionalProperties: false,
  description,
  required: ["schema_version", "contract_version", "data", "meta"],
  properties: {
    schema_version: { type: "string", const: API_SCHEMA_VERSION },
    contract_version: { type: "string", const: API_CONTRACT_VERSION },
    data: { type: "object", additionalProperties: true, description: "Endpoint-specific public DTO." },
    meta: { type: "object", additionalProperties: false, description: "Read metadata and policy." }
  }
});

const writeEnvelope = (schemaId: ApiSchemaId, description: string): ApiJsonSchema => ({
  $id: schemaId,
  type: "object",
  additionalProperties: false,
  description,
  required: ["schema_version", "contract_version", "data", "meta"],
  properties: {
    schema_version: { type: "string", const: API_SCHEMA_VERSION },
    contract_version: { type: "string", const: API_CONTRACT_VERSION },
    data: { type: "object", additionalProperties: true, description: "Endpoint-specific mutation result." },
    meta: { type: "object", additionalProperties: false, description: "Write metadata and policy." }
  }
});

export const API_SCHEMA_REGISTRY = {
  CompanyCardApiResponse: readEnvelope("CompanyCardApiResponse", "Company card API read envelope."),
  ComponentCardApiResponse: readEnvelope("ComponentCardApiResponse", "Component card API read envelope."),
  ChainApiResponse: readEnvelope("ChainApiResponse", "Chain view API read envelope."),
  ClaimApiResponse: readEnvelope("ClaimApiResponse", "Claim API read envelope."),
  EvidenceApiResponse: readEnvelope("EvidenceApiResponse", "Evidence API read envelope."),
  ObservationsApiResponse: readEnvelope("ObservationsApiResponse", "Observations API read envelope."),
  RiskViewApiResponse: readEnvelope("RiskViewApiResponse", "Risk view API read envelope."),
  ChangesApiResponse: readEnvelope("ChangesApiResponse", "Change timeline API read envelope."),
  SourcesHealthApiResponse: readEnvelope("SourcesHealthApiResponse", "Source health API read envelope."),
  UnknownMapApiResponse: readEnvelope("UnknownMapApiResponse", "Unknown map API read envelope."),
  ConsumerReadModelApiResponse: readEnvelope("ConsumerReadModelApiResponse", "Gate 8-lite consumer read model API read envelope."),
  ReasoningWalkthroughApiResponse: readEnvelope("ReasoningWalkthroughApiResponse", "Reasoning walkthrough API read envelope."),
  ReviewDecisionRequest: {
    $id: "ReviewDecisionRequest",
    type: "object",
    additionalProperties: false,
    description: "Human or host-app review decision input. It cannot request fact-edge mutation.",
    required: ["reviewer", "reason"],
    properties: {
      reviewer: { type: "string", description: "Stable reviewer id or host-app actor id." },
      reason: { type: "string", description: "Human-readable decision rationale." }
    }
  },
  ReviewDecisionApiResponse: writeEnvelope("ReviewDecisionApiResponse", "Review decision API write envelope.")
} as const satisfies Record<ApiSchemaId, ApiJsonSchema>;

export function schemaIds(): ApiSchemaId[] {
  return Object.keys(API_SCHEMA_REGISTRY).sort() as ApiSchemaId[];
}
