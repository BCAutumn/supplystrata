import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildEdgeClaimsFromCurrentEdgesTransactionally } from "@supplystrata/claim-builder";
import { loadChainCard, loadCompanyCard, loadComponentCard } from "@supplystrata/card-builder";
import { runDataQualityChecks, type DataQualitySummary } from "@supplystrata/data-quality";
import type { DatabaseStore, DbClient } from "@supplystrata/db";
import {
  renderChainCard,
  renderCompanyCard,
  renderComponentCard,
  type ChainViewModel,
  type CompanyCardModel,
  type ComponentCardModel
} from "@supplystrata/render";
import { planSourcesForComponents, type SourcePlanItem, type TradeObservationDirection } from "@supplystrata/source-plan";
import { buildWorkbenchModel, type WorkbenchModel } from "@supplystrata/workbench-export";

export interface ResearchPackInput {
  company: string;
  components?: readonly string[];
  depth?: number;
  since?: string;
  changeLimit?: number;
  sourceLimit?: number;
  buildClaims?: boolean;
  minEvidenceLevel?: 4 | 5;
  generatedBy?: string;
  tradeObservationMonth?: string;
  tradeObservationCountryCode?: string;
  tradeObservationDirections?: readonly TradeObservationDirection[];
  materialObservationYear?: string;
  commodityObservationMonth?: string;
}

export interface ResearchPackManifest {
  schema_version: "1.0.0";
  mode: "truth_store" | "workbench_snapshot";
  generated_at: string;
  company_query: string;
  selected_company_id: string;
  depth: number;
  components: string[];
  files: ResearchPackFile[];
  stats: ResearchPackStats;
  claim_build: ResearchPackClaimBuild | null;
}

export interface ResearchPackFile {
  path: string;
  kind: "json" | "markdown";
  description: string;
}

export interface ResearchPackStats {
  companies: number;
  chain_segments: number;
  fact_edges: number;
  claims: number;
  draft_claims: number;
  evidences: number;
  unknown_items: number;
  source_plan_items: number;
  runnable_suggested_targets: number;
  data_quality_errors: number;
  data_quality_warnings: number;
}

export interface ResearchPackClaimBuild {
  scanned: number;
  inserted: number;
  updated: number;
  generated_by: string;
}

export interface ResearchPackModel {
  manifest: ResearchPackManifest;
  workbench: WorkbenchModel;
  company: CompanyCardModel;
  chain: ChainViewModel;
  components: ComponentCardModel[];
  source_plan: SourcePlanItem[];
  data_quality: DataQualitySummary;
}

export interface WorkbenchSnapshotPackInput {
  workbench: WorkbenchModel;
  components?: readonly string[];
  depth?: number;
  tradeObservationMonth?: string;
  tradeObservationCountryCode?: string;
  tradeObservationDirections?: readonly TradeObservationDirection[];
  materialObservationYear?: string;
  commodityObservationMonth?: string;
}

export interface WorkbenchSnapshotPackModel {
  manifest: ResearchPackManifest;
  workbench: WorkbenchModel;
  chain: ChainViewModel;
  source_plan: SourcePlanItem[];
}

export interface WrittenResearchPack {
  out_dir: string;
  manifest: ResearchPackManifest;
}

export async function buildResearchPack(client: DatabaseStore, input: ResearchPackInput): Promise<ResearchPackModel> {
  const depth = input.depth ?? 3;
  const claimBuild = await maybeBuildClaims(client, input);
  const workbench = await buildWorkbenchModel(client, {
    company: input.company,
    depth,
    ...(input.since === undefined ? {} : { since: input.since }),
    ...(input.changeLimit === undefined ? {} : { changeLimit: input.changeLimit }),
    ...(input.sourceLimit === undefined ? {} : { sourceLimit: input.sourceLimit })
  });
  const components = collectResearchComponentIds(workbench, input.components ?? []);
  const sourcePlan = components.length === 0 ? [] : planSourcesForComponents(sourcePlanInput(input, components, depth));
  const [company, chain, componentCards, dataQuality] = await Promise.all([
    loadCompanyCard(client, workbench.selected_company_id),
    loadChainCard(client, workbench.selected_company_id, { depth }),
    loadComponentCards(client, components),
    runDataQualityChecks(client)
  ]);
  const generatedAt = new Date().toISOString();
  const manifest = manifestFromModel({
    generatedAt,
    input,
    depth,
    workbench,
    components,
    sourcePlan,
    dataQuality,
    claimBuild
  });
  return { manifest, workbench, company, chain, components: componentCards, source_plan: sourcePlan, data_quality: dataQuality };
}

export function buildResearchPackFromWorkbench(input: WorkbenchSnapshotPackInput): WorkbenchSnapshotPackModel {
  const depth = input.depth ?? input.workbench.chain.max_depth;
  const components = collectResearchComponentIds(input.workbench, input.components ?? []);
  const sourcePlan = components.length === 0 ? input.workbench.source_plan : planSourcesForComponents(sourcePlanInput(input, components, depth));
  const dataQuality = emptyStaticDataQualitySummary();
  const generatedAt = new Date().toISOString();
  const staticInput: ResearchPackInput = {
    company: input.workbench.selected_company_id,
    components,
    depth,
    ...(input.tradeObservationMonth === undefined
      ? {}
      : {
          tradeObservationMonth: input.tradeObservationMonth,
          ...(input.tradeObservationCountryCode === undefined ? {} : { tradeObservationCountryCode: input.tradeObservationCountryCode }),
          ...(input.tradeObservationDirections === undefined ? {} : { tradeObservationDirections: input.tradeObservationDirections })
        }),
    ...(input.materialObservationYear === undefined ? {} : { materialObservationYear: input.materialObservationYear }),
    ...(input.commodityObservationMonth === undefined ? {} : { commodityObservationMonth: input.commodityObservationMonth })
  };
  const manifest = manifestFromModel({
    generatedAt,
    input: staticInput,
    depth,
    workbench: input.workbench,
    components,
    sourcePlan,
    dataQuality,
    claimBuild: null,
    mode: "workbench_snapshot"
  });
  return { manifest, workbench: input.workbench, chain: input.workbench.chain, source_plan: sourcePlan };
}

export async function writeResearchPack(outDir: string, pack: ResearchPackModel): Promise<WrittenResearchPack> {
  await mkdir(outDir, { recursive: true });
  await mkdir(join(outDir, "components"), { recursive: true });

  const files: ResearchPackFile[] = [
    await writeJsonFile(outDir, "manifest.json", pack.manifest, "Research pack manifest"),
    await writeJsonFile(outDir, "workbench.json", pack.workbench, "Workbench JSON consumed by apps/research-preview"),
    await writeJsonFile(outDir, "source-plan.json", { schema_version: "1.0.0", source_plan: pack.source_plan }, "Source plan for existing component coverage"),
    await writeJsonFile(outDir, "quality.json", pack.data_quality, "Data quality summary"),
    await writeJsonFile(outDir, "company.json", { schema_version: "1.0.0", company: pack.company }, "Company card JSON"),
    await writeMarkdownFile(outDir, "company.md", renderCompanyCard(pack.company, "markdown"), "Company card markdown"),
    await writeJsonFile(outDir, "chain.json", pack.chain, "ChainView JSON"),
    await writeMarkdownFile(outDir, "chain.md", renderChainCard(pack.chain, "markdown"), "ChainView markdown"),
    await writeMarkdownFile(outDir, "README.md", renderResearchPackReadme(pack), "Research pack table of contents")
  ];

  for (const component of pack.components) {
    const name = safeFileSegment(component.component.component_id);
    files.push(
      await writeJsonFile(
        outDir,
        `components/${name}.json`,
        { schema_version: "1.0.0", component },
        `Component card JSON for ${component.component.component_id}`
      )
    );
    files.push(
      await writeMarkdownFile(
        outDir,
        `components/${name}.md`,
        renderComponentCard(component, "markdown"),
        `Component card markdown for ${component.component.component_id}`
      )
    );
  }

  const manifest = { ...pack.manifest, files: sortFiles(files) };
  await writeJsonFile(outDir, "manifest.json", manifest, "Research pack manifest");
  return { out_dir: outDir, manifest };
}

export async function writeWorkbenchSnapshotPack(outDir: string, pack: WorkbenchSnapshotPackModel): Promise<WrittenResearchPack> {
  await mkdir(outDir, { recursive: true });
  const files: ResearchPackFile[] = [
    await writeJsonFile(outDir, "manifest.json", pack.manifest, "Research snapshot manifest"),
    await writeJsonFile(outDir, "workbench.json", pack.workbench, "Workbench JSON consumed by apps/research-preview"),
    await writeJsonFile(outDir, "chain.json", pack.chain, "ChainView JSON copied from the Workbench export"),
    await writeMarkdownFile(outDir, "chain.md", renderChainCard(pack.chain, "markdown"), "ChainView markdown"),
    await writeJsonFile(
      outDir,
      "source-plan.json",
      { schema_version: "1.0.0", source_plan: pack.source_plan },
      "Source plan derived from the Workbench components"
    ),
    await writeJsonFile(
      outDir,
      "evidence-index.json",
      { schema_version: "1.0.0", evidences: pack.workbench.evidences },
      "Evidence records included in the Workbench export"
    ),
    await writeMarkdownFile(outDir, "README.md", renderWorkbenchSnapshotReadme(pack), "Research snapshot table of contents")
  ];

  const manifest = { ...pack.manifest, files: sortFiles(files) };
  await writeJsonFile(outDir, "manifest.json", manifest, "Research snapshot manifest");
  return { out_dir: outDir, manifest };
}

export function collectResearchComponentIds(workbench: Pick<WorkbenchModel, "chain_segments">, explicitComponents: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const component of explicitComponents) {
    const normalized = normalizeId(component);
    if (normalized.length > 0) ids.add(normalized);
  }
  for (const segment of workbench.chain_segments) {
    if (segment.component_id !== null) ids.add(segment.component_id);
  }
  return [...ids].sort();
}

export function safeFileSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (cleaned.length === 0) throw new Error(`Cannot create a file name from empty value: ${value}`);
  return cleaned;
}

async function maybeBuildClaims(client: DatabaseStore, input: ResearchPackInput): Promise<ResearchPackClaimBuild | null> {
  if (input.buildClaims === false) return null;
  const summary = await buildEdgeClaimsFromCurrentEdgesTransactionally(client, {
    min_evidence_level: input.minEvidenceLevel ?? 4,
    limit: 1_000,
    generated_by: input.generatedBy ?? "research-pack.claim-build.v1"
  });
  return {
    scanned: summary.scanned,
    inserted: summary.inserted,
    updated: summary.updated,
    generated_by: summary.generated_by
  };
}

async function loadComponentCards(client: DbClient, componentIds: readonly string[]): Promise<ComponentCardModel[]> {
  const cards: ComponentCardModel[] = [];
  for (const componentId of componentIds) {
    cards.push(await loadComponentCard(client, componentId));
  }
  return cards;
}

function sourcePlanInput(
  input: Pick<
    ResearchPackInput,
    "tradeObservationMonth" | "tradeObservationCountryCode" | "tradeObservationDirections" | "materialObservationYear" | "commodityObservationMonth"
  >,
  componentIds: readonly string[],
  depth: number
): Parameters<typeof planSourcesForComponents>[0] {
  return {
    component_ids: componentIds,
    entity_ids: [],
    maxTierDepth: depth,
    ...(input.tradeObservationMonth === undefined
      ? {}
      : {
          tradeObservationMonth: input.tradeObservationMonth,
          ...(input.tradeObservationCountryCode === undefined ? {} : { tradeObservationCountryCode: input.tradeObservationCountryCode }),
          ...(input.tradeObservationDirections === undefined ? {} : { tradeObservationDirections: input.tradeObservationDirections })
        }),
    ...(input.materialObservationYear === undefined ? {} : { materialObservationYear: input.materialObservationYear }),
    ...(input.commodityObservationMonth === undefined ? {} : { commodityObservationMonth: input.commodityObservationMonth })
  };
}

function manifestFromModel(input: {
  generatedAt: string;
  input: ResearchPackInput;
  depth: number;
  workbench: WorkbenchModel;
  components: readonly string[];
  sourcePlan: readonly SourcePlanItem[];
  dataQuality: DataQualitySummary;
  claimBuild: ResearchPackClaimBuild | null;
  mode?: ResearchPackManifest["mode"];
}): ResearchPackManifest {
  return {
    schema_version: "1.0.0",
    mode: input.mode ?? "truth_store",
    generated_at: input.generatedAt,
    company_query: input.input.company,
    selected_company_id: input.workbench.selected_company_id,
    depth: input.depth,
    components: [...input.components],
    files: [],
    stats: {
      companies: input.workbench.companies.length,
      chain_segments: input.workbench.chain_segments.length,
      fact_edges: input.workbench.edges.length,
      claims: input.workbench.claims.length,
      draft_claims: input.workbench.draft_claims.length,
      evidences: input.workbench.evidences.length,
      unknown_items: input.workbench.unknown_items.length,
      source_plan_items: input.sourcePlan.length,
      runnable_suggested_targets: input.sourcePlan.reduce((count, item) => count + item.suggested_check_targets.filter((target) => target.runnable).length, 0),
      data_quality_errors: input.dataQuality.counts.error,
      data_quality_warnings: input.dataQuality.counts.warn
    },
    claim_build: input.claimBuild
  };
}

function renderResearchPackReadme(pack: ResearchPackModel): string {
  const lines = [
    `# Research Pack ${pack.company.entity.canonical_name}`,
    "",
    `Generated at: ${pack.manifest.generated_at}`,
    `Company: ${pack.company.entity.canonical_name} [${pack.manifest.selected_company_id}]`,
    `Depth: ${pack.manifest.depth}`,
    "",
    "## Stats",
    "",
    `- Fact edges: ${pack.manifest.stats.fact_edges}`,
    `- Claims: ${pack.manifest.stats.claims}`,
    `- Evidence records: ${pack.manifest.stats.evidences}`,
    `- Unknown items: ${pack.manifest.stats.unknown_items}`,
    `- Source plan items: ${pack.manifest.stats.source_plan_items}`,
    `- Runnable suggested source targets: ${pack.manifest.stats.runnable_suggested_targets}`,
    `- Data quality errors: ${pack.manifest.stats.data_quality_errors}`,
    `- Data quality warnings: ${pack.manifest.stats.data_quality_warnings}`,
    "",
    "## Files",
    "",
    "- `workbench.json` feeds the TypeScript research preview.",
    "- `chain.md` and `company.md` are human-readable research cards.",
    "- `components/*.md` contains component-level evidence and observation context.",
    "- `source-plan.json` lists which existing free/public sources should be checked next.",
    "- `quality.json` records data-quality checks for audit."
  ];
  return lines.join("\n");
}

function renderWorkbenchSnapshotReadme(pack: WorkbenchSnapshotPackModel): string {
  const lines = [
    `# Research Snapshot ${pack.workbench.chain.root.name}`,
    "",
    `Generated at: ${pack.manifest.generated_at}`,
    `Company: ${pack.workbench.chain.root.name} [${pack.manifest.selected_company_id}]`,
    `Depth: ${pack.manifest.depth}`,
    "",
    "This pack was built from an existing Workbench JSON export. It does not refresh the SQL truth store, rebuild claims, or run data-quality checks.",
    "",
    "## Stats",
    "",
    `- Fact edges: ${pack.manifest.stats.fact_edges}`,
    `- Claims: ${pack.manifest.stats.claims}`,
    `- Evidence records: ${pack.manifest.stats.evidences}`,
    `- Unknown items: ${pack.manifest.stats.unknown_items}`,
    `- Source plan items: ${pack.manifest.stats.source_plan_items}`,
    `- Runnable suggested source targets: ${pack.manifest.stats.runnable_suggested_targets}`,
    "",
    "## Files",
    "",
    "- `workbench.json` feeds the TypeScript research preview.",
    "- `chain.md` is a human-readable chain view.",
    "- `source-plan.json` lists existing free/public source checks suggested by the components in this workbench.",
    "- `evidence-index.json` contains the evidence records carried by the workbench export."
  ];
  return lines.join("\n");
}

function emptyStaticDataQualitySummary(): DataQualitySummary {
  return {
    checked_at: new Date().toISOString(),
    ok: true,
    counts: { error: 0, warn: 0, info: 0 },
    issues: []
  };
}

async function writeJsonFile(outDir: string, relativePath: string, value: unknown, description: string): Promise<ResearchPackFile> {
  await writeFile(join(outDir, relativePath), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return { path: relativePath, kind: "json", description };
}

async function writeMarkdownFile(outDir: string, relativePath: string, value: string, description: string): Promise<ResearchPackFile> {
  await writeFile(join(outDir, relativePath), `${value.trimEnd()}\n`, "utf8");
  return { path: relativePath, kind: "markdown", description };
}

function sortFiles(files: readonly ResearchPackFile[]): ResearchPackFile[] {
  return [...files].sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeId(value: string): string {
  return value.trim();
}
