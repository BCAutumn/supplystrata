import { createDatabaseStore, type DatabaseStore, type PendingEntityStatusFilter } from "@supplystrata/db";
import type { ChangeTimelineScope } from "@supplystrata/db";
import type { GraphSyncMode } from "@supplystrata/graph-builder";
import { isSecFormType, type SecFormType } from "@supplystrata/core";
import type { EntityLookupSource } from "@supplystrata/source-workflows";
import type { OutputFormat } from "@supplystrata/render";

export type PreviewFormat = OutputFormat | "csv";

export async function withDatabase<T>(fn: (store: DatabaseStore) => Promise<T>): Promise<T> {
  const store = createDatabaseStore();
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

export function parseFormat(value: string): OutputFormat {
  if (value === "markdown" || value === "json") return value;
  throw new Error(`Unsupported format: ${value}`);
}

export function parsePreviewFormat(value: string): PreviewFormat {
  if (value === "csv") return value;
  return parseFormat(value);
}

export function parseEntityLookupSource(value: string): EntityLookupSource {
  if (value === "all" || value === "opencorporates" || value === "companies-house") return value;
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

export function write(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function isSupportedFormType(value: string): value is SecFormType {
  return isSecFormType(value);
}

export function formatCliError(error: unknown): string {
  if (isConnectionRefused(error)) {
    return [
      "A local database service is not reachable.",
      "DB-backed commands need a configured SQL truth store. The built-in adapter is Postgres via POSTGRES_URL; graph sync commands using the built-in Neo4j GraphStore adapter also need NEO4J_URI.",
      "DB-free commands remain available, for example: pnpm cli preview nvidia --format json",
      "Run pnpm cli runtime doctor to see which no-Docker mode is ready in this environment."
    ].join("\n");
  }
  return error instanceof Error ? error.message : "Unknown CLI error";
}

function isConnectionRefused(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error["code"] === "ECONNREFUSED") return true;
  const nestedErrors = error["errors"];
  if (!Array.isArray(nestedErrors)) return false;
  return nestedErrors.some(isConnectionRefused);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
