import { createPool, type PendingEntityStatusFilter } from "@supplystrata/db";
import type { EntityLookupSource } from "@supplystrata/pipeline";
import type { OutputFormat } from "@supplystrata/render";

export type PreviewFormat = OutputFormat | "csv";

export async function withPool<T>(fn: (pool: ReturnType<typeof createPool>) => Promise<T>): Promise<T> {
  const pool = createPool();
  try {
    return await fn(pool);
  } finally {
    await pool.end();
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

export function write(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function isSupportedFormType(value: string): value is "10-K" | "10-Q" | "20-F" | "8-K" {
  return value === "10-K" || value === "10-Q" || value === "20-F" || value === "8-K";
}
