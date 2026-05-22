import { createHash } from "node:crypto";
import type { LeadType, ObservationType } from "@supplystrata/core";
import {
  recordSemanticChange,
  upsertLeadObservation,
  upsertObservation,
  type DbClient,
  type LeadStatus,
  type NewLeadObservationInput,
  type NewObservationInput
} from "@supplystrata/db/write";

export type ObservationScopeKind = "company" | "component" | "facility" | "country" | "port" | "route" | "topic";

export interface ObservationStoreInput {
  observation_id?: string;
  observation_type: ObservationType;
  source_adapter_id: string;
  source_item_id?: string;
  doc_id?: string;
  scope_kind: ObservationScopeKind;
  scope_id: string;
  geography_kind?: string;
  geography_id?: string;
  component_id?: string;
  metric_name: string;
  metric_value?: string;
  metric_unit?: string;
  time_window_start?: string;
  time_window_end?: string;
  baseline_value?: string;
  change_value?: string;
  change_percent?: number;
  confidence: number;
  provenance?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
}

export interface LeadStoreInput {
  lead_id?: string;
  lead_type: LeadType;
  source_adapter_id: string;
  doc_id?: string;
  scope_kind: ObservationScopeKind;
  scope_id: string;
  title: string;
  summary: string;
  cite_text?: string;
  source_url?: string;
  status?: LeadStatus;
  review_id?: string;
  attrs?: Record<string, unknown>;
}

export interface StoreResult {
  id: string;
  inserted: boolean;
}

export async function storeObservation(client: DbClient, input: ObservationStoreInput): Promise<StoreResult> {
  validateConfidence(input.confidence);
  validateObservationWindow(input);
  // 观测层只保存可复现信号，不在这里升级成 graph fact edge。
  const observationInput = toNewObservationInput(input, input.observation_id ?? deterministicObservationId(input));
  const result = await upsertObservation(client, observationInput);
  await recordSemanticChange(client, {
    scope_kind: "observation",
    scope_id: result.observation_id,
    change_type: result.inserted ? "OBSERVATION_ADDED" : "OBSERVATION_REASSERTED",
    after: {
      observation_type: input.observation_type,
      source_adapter_id: input.source_adapter_id,
      doc_id: input.doc_id,
      scope_kind: input.scope_kind,
      scope_id: input.scope_id,
      component_id: input.component_id,
      metric_name: input.metric_name
    },
    caused_by: "observation-store"
  });
  return { id: result.observation_id, inserted: result.inserted };
}

export async function storeLeadObservation(client: DbClient, input: LeadStoreInput): Promise<StoreResult> {
  const leadInput = toNewLeadObservationInput(input, input.lead_id ?? deterministicLeadId(input));
  const result = await upsertLeadObservation(client, leadInput);
  await recordSemanticChange(client, {
    scope_kind: "lead",
    scope_id: result.lead_id,
    change_type: result.inserted ? "LEAD_ADDED" : "LEAD_UPDATED",
    after: {
      lead_type: input.lead_type,
      source_adapter_id: input.source_adapter_id,
      doc_id: input.doc_id,
      scope_kind: input.scope_kind,
      scope_id: input.scope_id,
      title: input.title,
      status: input.status ?? "open"
    },
    caused_by: "observation-store"
  });
  return { id: result.lead_id, inserted: result.inserted };
}

export function deterministicObservationId(input: ObservationStoreInput): string {
  return `OBS-${stableDigest({
    observation_type: input.observation_type,
    source_adapter_id: input.source_adapter_id,
    source_item_id: input.source_item_id,
    doc_id: input.doc_id,
    scope_kind: input.scope_kind,
    scope_id: input.scope_id,
    geography_kind: input.geography_kind,
    geography_id: input.geography_id,
    component_id: input.component_id,
    metric_name: input.metric_name,
    time_window_start: input.time_window_start,
    time_window_end: input.time_window_end
  })}`;
}

export function deterministicLeadId(input: LeadStoreInput): string {
  return `LEAD-${stableDigest({
    lead_type: input.lead_type,
    source_adapter_id: input.source_adapter_id,
    doc_id: input.doc_id,
    scope_kind: input.scope_kind,
    scope_id: input.scope_id,
    title: input.title,
    source_url: input.source_url
  })}`;
}

function toNewObservationInput(input: ObservationStoreInput, observationId: string): NewObservationInput {
  const output: NewObservationInput = {
    observation_id: observationId,
    observation_type: input.observation_type,
    source_adapter_id: input.source_adapter_id,
    scope_kind: input.scope_kind,
    scope_id: input.scope_id,
    metric_name: input.metric_name,
    confidence: input.confidence
  };
  if (input.source_item_id !== undefined) output.source_item_id = input.source_item_id;
  if (input.doc_id !== undefined) output.doc_id = input.doc_id;
  if (input.geography_kind !== undefined) output.geography_kind = input.geography_kind;
  if (input.geography_id !== undefined) output.geography_id = input.geography_id;
  if (input.component_id !== undefined) output.component_id = input.component_id;
  if (input.metric_value !== undefined) output.metric_value = input.metric_value;
  if (input.metric_unit !== undefined) output.metric_unit = input.metric_unit;
  if (input.time_window_start !== undefined) output.time_window_start = input.time_window_start;
  if (input.time_window_end !== undefined) output.time_window_end = input.time_window_end;
  if (input.baseline_value !== undefined) output.baseline_value = input.baseline_value;
  if (input.change_value !== undefined) output.change_value = input.change_value;
  if (input.change_percent !== undefined) output.change_percent = input.change_percent;
  if (input.provenance !== undefined) output.provenance = input.provenance;
  if (input.attrs !== undefined) output.attrs = input.attrs;
  return output;
}

function toNewLeadObservationInput(input: LeadStoreInput, leadId: string): NewLeadObservationInput {
  const output: NewLeadObservationInput = {
    lead_id: leadId,
    lead_type: input.lead_type,
    source_adapter_id: input.source_adapter_id,
    scope_kind: input.scope_kind,
    scope_id: input.scope_id,
    title: input.title,
    summary: input.summary
  };
  if (input.doc_id !== undefined) output.doc_id = input.doc_id;
  if (input.cite_text !== undefined) output.cite_text = input.cite_text;
  if (input.source_url !== undefined) output.source_url = input.source_url;
  if (input.status !== undefined) output.status = input.status;
  if (input.review_id !== undefined) output.review_id = input.review_id;
  if (input.attrs !== undefined) output.attrs = input.attrs;
  return output;
}

function validateConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Observation confidence must be between 0 and 1: ${value}`);
}

function validateObservationWindow(input: ObservationStoreInput): void {
  if (input.time_window_start === undefined || input.time_window_end === undefined) return;
  if (input.time_window_start > input.time_window_end) {
    throw new Error(`Observation time window start must be before or equal to end: ${input.time_window_start} > ${input.time_window_end}`);
  }
}

function stableDigest(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(sortRecord(value)))
    .digest("hex")
    .slice(0, 24)
    .toUpperCase();
}

function sortRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
  );
}
