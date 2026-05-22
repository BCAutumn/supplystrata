import { readFileSync } from "node:fs";
import { normalizeAlias, type ResolveResult } from "@supplystrata/core";

interface SpecialEntityResolvedResult {
  status: "resolved";
  entity_id: string;
  confidence: number;
  needs_human_review: false;
}

interface SpecialEntityAmbiguousCandidate {
  entity_id: string;
  confidence: number;
  reason: string;
}

interface SpecialEntityAmbiguousResult {
  status: "ambiguous";
  confidence: number;
  needs_human_review: true;
  candidates: SpecialEntityAmbiguousCandidate[];
}

type SpecialEntityResult = SpecialEntityResolvedResult | SpecialEntityAmbiguousResult;

interface SpecialEntityContextRule {
  context_patterns: string[];
  result: SpecialEntityResult;
}

interface SpecialEntityFamilyRule {
  rule_id: string;
  surface_aliases: string[];
  context_rules: SpecialEntityContextRule[];
  default_result: SpecialEntityResult;
}

// 公司家族/业务单元消歧规则放在 patterns 中，避免每新增一个公司就在流程里堆正则分支。
const SPECIAL_ENTITY_RULES_URL = new URL("../patterns/special-entity-rules.json", import.meta.url);

let cachedRules: SpecialEntityFamilyRule[] | undefined;

export function resolveSpecialEntity(surface: string, context: string): ResolveResult | undefined {
  const normalizedSurface = normalizeAlias(surface);
  const normalizedContext = normalizeAlias(context);
  for (const familyRule of loadSpecialEntityRules()) {
    if (!familyRule.surface_aliases.map(normalizeAlias).includes(normalizedSurface)) continue;
    return resolveFamilyRule(familyRule, normalizedSurface, normalizedContext);
  }
  return undefined;
}

function resolveFamilyRule(rule: SpecialEntityFamilyRule, normalizedSurface: string, normalizedContext: string): ResolveResult {
  for (const contextRule of rule.context_rules) {
    if (
      normalizedSurfaceMatchesRule(normalizedSurface, contextRule) ||
      contextRule.context_patterns.some((pattern) => matchesPattern(normalizedContext, pattern))
    ) {
      return cloneSpecialEntityResult(contextRule.result);
    }
  }
  return cloneSpecialEntityResult(rule.default_result);
}

function normalizedSurfaceMatchesRule(normalizedSurface: string, rule: SpecialEntityContextRule): boolean {
  return rule.context_patterns.some((pattern) => pattern.startsWith("surface:") && normalizeAlias(pattern.slice("surface:".length)) === normalizedSurface);
}

function matchesPattern(text: string, pattern: string): boolean {
  if (pattern.startsWith("surface:")) return false;
  return new RegExp(pattern).test(text);
}

function loadSpecialEntityRules(): SpecialEntityFamilyRule[] {
  if (cachedRules !== undefined) return cachedRules;
  const parsed: unknown = JSON.parse(readFileSync(SPECIAL_ENTITY_RULES_URL, "utf8"));
  cachedRules = parseSpecialEntityRules(parsed, SPECIAL_ENTITY_RULES_URL.toString());
  return cachedRules;
}

function parseSpecialEntityRules(value: unknown, path: string): SpecialEntityFamilyRule[] {
  return expectArray(value, path).map((item, index) => parseSpecialEntityFamilyRule(item, `${path}[${index}]`));
}

function parseSpecialEntityFamilyRule(value: unknown, path: string): SpecialEntityFamilyRule {
  const record = expectRecord(value, path);
  return {
    rule_id: expectString(readField(record, "rule_id", path), `${path}.rule_id`),
    surface_aliases: parseStringArray(readField(record, "surface_aliases", path), `${path}.surface_aliases`),
    context_rules: expectArray(readField(record, "context_rules", path), `${path}.context_rules`).map((item, index) =>
      parseSpecialEntityContextRule(item, `${path}.context_rules[${index}]`)
    ),
    default_result: parseSpecialEntityResult(readField(record, "default_result", path), `${path}.default_result`)
  };
}

function parseSpecialEntityContextRule(value: unknown, path: string): SpecialEntityContextRule {
  const record = expectRecord(value, path);
  return {
    context_patterns: parseStringArray(readField(record, "context_patterns", path), `${path}.context_patterns`),
    result: parseSpecialEntityResult(readField(record, "result", path), `${path}.result`)
  };
}

function parseSpecialEntityResult(value: unknown, path: string): SpecialEntityResult {
  const record = expectRecord(value, path);
  const status = expectString(readField(record, "status", path), `${path}.status`);
  if (status === "resolved") {
    return {
      status,
      entity_id: expectString(readField(record, "entity_id", path), `${path}.entity_id`),
      confidence: expectConfidence(readField(record, "confidence", path), `${path}.confidence`),
      needs_human_review: false
    };
  }
  if (status === "ambiguous") {
    return {
      status,
      confidence: expectConfidence(readField(record, "confidence", path), `${path}.confidence`),
      needs_human_review: true,
      candidates: expectArray(readField(record, "candidates", path), `${path}.candidates`).map((item, index) =>
        parseAmbiguousCandidate(item, `${path}.candidates[${index}]`)
      )
    };
  }
  throw new Error(`Invalid special entity result status at ${path}.status: ${status}`);
}

function parseAmbiguousCandidate(value: unknown, path: string): SpecialEntityAmbiguousCandidate {
  const record = expectRecord(value, path);
  return {
    entity_id: expectString(readField(record, "entity_id", path), `${path}.entity_id`),
    confidence: expectConfidence(readField(record, "confidence", path), `${path}.confidence`),
    reason: expectString(readField(record, "reason", path), `${path}.reason`)
  };
}

function cloneSpecialEntityResult(result: SpecialEntityResult): ResolveResult {
  if (result.status === "resolved") return { ...result };
  return { ...result, candidates: result.candidates.map((candidate) => ({ ...candidate })) };
}

function readField(record: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in record)) throw new Error(`Missing required field ${path}.${key}`);
  return record[key];
}

function parseStringArray(value: unknown, path: string): string[] {
  return expectArray(value, path).map((item, index) => expectString(item, `${path}[${index}]`));
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) record[key] = field;
    return record;
  }
  throw new Error(`Expected object at ${path}`);
}

function expectArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  throw new Error(`Expected array at ${path}`);
}

function expectString(value: unknown, path: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`Expected non-empty string at ${path}`);
}

function expectConfidence(value: unknown, path: string): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value;
  throw new Error(`Expected confidence between 0 and 1 at ${path}`);
}
