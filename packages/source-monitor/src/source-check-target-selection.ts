import type { SourceCheckTargetSelection } from "./types.js";

export function uniqueCheckTargetIds(values: readonly string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

export function normalizeSourceCheckTargetSelection(input: SourceCheckTargetSelection): {
  check_target_ids: string[] | null;
  source_adapter_ids: string[] | null;
} {
  return {
    check_target_ids: normalizeOptionalTextList(input.check_target_ids),
    source_adapter_ids: normalizeOptionalTextList(input.source_adapter_ids)
  };
}

function normalizeOptionalTextList(values: readonly string[] | undefined): string[] | null {
  if (values === undefined) return null;
  const normalized = uniqueCheckTargetIds(values);
  if (normalized.length === 0) throw new Error("source check target selection cannot be empty when provided");
  return normalized;
}
