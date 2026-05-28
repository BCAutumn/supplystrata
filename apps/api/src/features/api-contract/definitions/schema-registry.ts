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
  | { type: "integer"; minimum?: number; description?: string }
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

const readThroughEnvelope = (schemaId: ApiSchemaId, description: string): ApiJsonSchema => ({
  $id: schemaId,
  type: "object",
  additionalProperties: false,
  description,
  required: ["schema_version", "contract_version", "data", "meta"],
  properties: {
    schema_version: { type: "string", const: API_SCHEMA_VERSION },
    contract_version: { type: "string", const: API_CONTRACT_VERSION },
    data: { type: "object", additionalProperties: true, description: "Endpoint-specific read-through research DTO." },
    meta: { type: "object", additionalProperties: false, description: "Read-through research metadata and policy." }
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
  SourceCheckRunsApiResponse: readEnvelope("SourceCheckRunsApiResponse", "Source check run/status API read envelope."),
  ResearchRunStatusApiResponse: readEnvelope("ResearchRunStatusApiResponse", "Research run/status API read envelope."),
  ResearchRunRequest: {
    $id: "ResearchRunRequest",
    type: "object",
    additionalProperties: false,
    description: "Explicit company research run request. This may enqueue source checks but cannot write fact edges or call AI providers.",
    required: [],
    properties: {
      depth: { type: "integer", minimum: 1, description: "Optional research/source-plan traversal depth." },
      source_target_namespace: { type: "string", description: "Optional namespace used to make generated source-check target ids stable across polls." },
      enqueue_source_checks: { type: "boolean", description: "When false, create source targets without enqueueing due source-check jobs." },
      reviewer: { type: "string", description: "Optional host-app actor id used for entity bootstrap audit records." }
    }
  },
  ResearchRunApiResponse: writeEnvelope("ResearchRunApiResponse", "Research run creation API write envelope."),
  CompanySupplyChainReportApiResponse: readThroughEnvelope("CompanySupplyChainReportApiResponse", "Read-through company supply-chain report envelope."),
  AiProviderStatusApiResponse: readEnvelope("AiProviderStatusApiResponse", "Sanitized AI provider status API read envelope."),
  AiAnalysisRunsApiResponse: readEnvelope("AiAnalysisRunsApiResponse", "AI analysis run/status API read envelope."),
  CompanyAiAnalysisPlanApiResponse: readEnvelope("CompanyAiAnalysisPlanApiResponse", "Company AI analysis plan API read envelope."),
  CompanyAiAnalysisLatestApiResponse: readEnvelope("CompanyAiAnalysisLatestApiResponse", "Company latest AI analysis artifact API read envelope."),
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
