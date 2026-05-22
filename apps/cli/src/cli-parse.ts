import { isSecFormType, type SecFormType } from "@supplystrata/core";
import type { ChangeTimelineScope, PendingEntityStatusFilter } from "@supplystrata/db/read";
import type { GraphSyncMode } from "@supplystrata/graph-builder";
import type { OutputFormat } from "@supplystrata/render";
import type { EntityLookupSource } from "@supplystrata/source-workflows";

export type PreviewFormat = OutputFormat | "csv";

export function parseFormat(value: string): OutputFormat {
  if (value === "markdown" || value === "json") return value;
  throw new Error(`Unsupported format: ${value}`);
}

export function parsePreviewFormat(value: string): PreviewFormat {
  if (value === "csv") return value;
  return parseFormat(value);
}

export function parseEntityLookupSource(value: string): EntityLookupSource {
  if (value === "all" || value === "gleif" || value === "opencorporates" || value === "companies-house") return value;
  throw new Error(`Unsupported entity lookup source: ${value}`);
}

export function parsePendingEntityStatus(value: string): PendingEntityStatusFilter {
  if (value === "pending" || value === "resolved" || value === "all") return value;
  throw new Error(`Unsupported pending entity status: ${value}`);
}

export function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10_000) throw new Error(`Unsupported limit: ${value}`);
  return parsed;
}

export function parseLanguage(value: string): "en" | "zh" {
  if (value === "en" || value === "zh") return value;
  throw new Error(`Unsupported language: ${value}`);
}

export function parseSince(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Unsupported since date: ${value}`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : date.toISOString();
}

export function parseGraphSyncMode(value: string): GraphSyncMode {
  if (value === "sync" || value === "defer") return value;
  throw new Error(`Unsupported graph sync mode: ${value}`);
}

export function defaultSince(daysBack: number): string {
  const date = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

export function parseChangeScope(value: string | undefined): ChangeTimelineScope | undefined {
  if (value === undefined) return undefined;
  const separator = value.indexOf(":");
  if (separator < 1 || separator === value.length - 1) throw new Error(`Unsupported change scope: ${value}`);
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (kind === "company" || kind === "entity" || kind === "edge" || kind === "alert" || kind === "risk_view" || kind === "risk_metric" || kind === "source") {
    return { kind, id };
  }
  throw new Error(`Unsupported change scope: ${value}`);
}

export function isSupportedFormType(value: string): value is SecFormType {
  return isSecFormType(value);
}
