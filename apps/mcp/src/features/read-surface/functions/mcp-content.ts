import type { ApiOperationEnvelope } from "@supplystrata/api-orchestration";
import { z } from "zod";

export const MCP_API_ENVELOPE_OUTPUT_SCHEMA = {
  schema_version: z.string(),
  contract_version: z.string(),
  data: z.unknown(),
  meta: z.record(z.unknown())
};

export function apiEnvelopeStructuredContent(envelope: ApiOperationEnvelope<unknown>): Record<string, unknown> {
  return {
    schema_version: envelope.schema_version,
    contract_version: envelope.contract_version,
    data: envelope.data,
    meta: envelope.meta
  };
}

export function apiEnvelopeText(envelope: ApiOperationEnvelope<unknown>): string {
  return JSON.stringify(apiEnvelopeStructuredContent(envelope), null, 2);
}
