import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { validateAiAnalysisArtifact, type AiAnalysisArtifact } from "@supplystrata/ai-analysis";

export interface LatestAiAnalysisArtifactFileInput {
  reports_root: string;
  company_id: string;
}

export async function loadLatestAiAnalysisArtifactFile(input: LatestAiAnalysisArtifactFileInput): Promise<AiAnalysisArtifact | null> {
  const candidates = await listAiAnalysisArtifactCandidates(input.reports_root);
  const matching: AiAnalysisArtifactFileCandidate[] = [];
  for (const candidate of candidates) {
    const artifact = await readAiAnalysisArtifact(candidate.path);
    if (normalizeCompanyId(artifact.scope_id) === normalizeCompanyId(input.company_id)) {
      matching.push({ ...candidate, artifact });
    }
  }
  const latest = matching.sort(compareAiAnalysisArtifactCandidates).at(0);
  return latest?.artifact ?? null;
}

async function listAiAnalysisArtifactCandidates(reportsRoot: string): Promise<AiAnalysisArtifactFileCandidateWithoutArtifact[]> {
  const entries = await readReportsRootEntries(reportsRoot);
  const candidates: AiAnalysisArtifactFileCandidateWithoutArtifact[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(reportsRoot, entry.name, "ai-analysis.json");
    try {
      const fileStat = await stat(path);
      candidates.push({ path, mtime_ms: fileStat.mtimeMs });
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) continue;
      throw error;
    }
  }
  return candidates;
}

async function readReportsRootEntries(reportsRoot: string) {
  try {
    return await readdir(reportsRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) return [];
    throw error;
  }
}

async function readAiAnalysisArtifact(path: string): Promise<AiAnalysisArtifact> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const inputRefs = inputRefsFromArtifactCandidate(parsed);
  const validation = validateAiAnalysisArtifact({ artifact: parsed, allowed_refs: inputRefs });
  if (!validation.ok) throw new Error(`Invalid AI analysis artifact at ${path}: ${validation.errors.join("; ")}`);
  return validation.artifact;
}

function inputRefsFromArtifactCandidate(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const modelMetadata = value["model_metadata"];
  if (!isRecord(modelMetadata)) return [];
  const inputRefs = modelMetadata["input_refs"];
  if (!Array.isArray(inputRefs)) return [];
  return inputRefs.filter((item): item is string => typeof item === "string");
}

function compareAiAnalysisArtifactCandidates(a: AiAnalysisArtifactFileCandidate, b: AiAnalysisArtifactFileCandidate): number {
  const generatedDelta = Date.parse(b.artifact.generated_at) - Date.parse(a.artifact.generated_at);
  if (Number.isFinite(generatedDelta) && generatedDelta !== 0) return generatedDelta;
  return b.mtime_ms - a.mtime_ms;
}

function normalizeCompanyId(value: string): string {
  return value.trim().toLowerCase();
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error["code"] === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface AiAnalysisArtifactFileCandidateWithoutArtifact {
  path: string;
  mtime_ms: number;
}

interface AiAnalysisArtifactFileCandidate extends AiAnalysisArtifactFileCandidateWithoutArtifact {
  artifact: AiAnalysisArtifact;
}
