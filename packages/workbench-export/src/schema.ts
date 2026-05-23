import type { WorkbenchModel } from "./definitions.js";
import { normalizeWorkbenchModelJson } from "./schema-normalize.js";
import { assertWorkbenchModel } from "./schema-validator.js";

export function parseWorkbenchModel(text: string): WorkbenchModel {
  const parsed: unknown = JSON.parse(text);
  const normalized = normalizeWorkbenchModelJson(parsed);
  assertWorkbenchModel(normalized);
  return normalized;
}
