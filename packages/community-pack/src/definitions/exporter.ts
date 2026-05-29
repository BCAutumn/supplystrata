import type { WorkbenchModel } from "@supplystrata/workbench-export";
import type { CommunityPackDataFileContent, CommunityPackManifest } from "./manifest.js";

export interface CommunityPackBuildInput {
  packVersion: string;
  generatedAt: string;
  license: string;
  sourceInstanceFingerprint: string;
  workbenchModels: readonly WorkbenchModel[];
  dataFilePath?: string;
}

export interface CommunityPackBuildResult {
  manifest: CommunityPackManifest;
  files: CommunityPackDataFileContent[];
}

export interface CommunityPackEligibilitySummary {
  input_documents: number;
  exported_documents: number;
  exported_relationships: number;
}
