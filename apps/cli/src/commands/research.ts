import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  buildResearchPack,
  buildResearchPackFromWorkbench,
  writeResearchPack,
  writeWorkbenchSnapshotPack,
  parseSourceTargetPreflightReport,
  isResearchTargetProfileId,
  type ResearchPackInput,
  type ResearchTargetProfileOption
} from "@supplystrata/research-pack";
import { parseWorkbenchModel } from "@supplystrata/workbench-export/schema";
import { parseCommaSeparated, parseLimit, parseSince, parseTradeDirections, withDatabase, writeJson } from "../cli-utils.js";
import { explicitOrCurrentIsoTimestamp } from "../cli-clock.js";

export function registerResearchCommands(program: Command): void {
  const research = program.command("research").description("research package commands");

  research
    .command("run")
    .requiredOption("--company <query>", "company name, alias, ticker, or entity id")
    .option("--component <ids>", "optional comma-separated component ids to force into the research pack")
    .option("--depth <count>", "chain/source-plan traversal depth", "3")
    .option("--generated-at <iso>", "explicit ISO timestamp for reproducible research-pack outputs")
    .option("--since <date>", "ISO date/time lower bound for changes")
    .option("--change-limit <count>", "max changes", "50")
    .option("--source-limit <count>", "max source health rows", "50")
    .option("--intelligence-limit <count>", "max Level 4/5 fact edges to refresh for intelligence context", "1000")
    .option("--trade-month <yyyy-mm>", "emit Census Trade target suggestions for this month")
    .option("--trade-country <code>", "optional Census partner country code for trade target suggestions")
    .option("--trade-directions <directions>", "comma-separated trade directions", "imports,exports")
    .option("--official-year <yyyy>", "emit official IR disclosure target suggestions for this year")
    .option("--target-profile <id>", "research target profile id, or 'none' to disable automatic profile selection")
    .option("--material-year <yyyy>", "emit annual material observation target suggestions")
    .option("--commodity-month <yyyy-mm>", "emit monthly commodity price target suggestions")
    .option("--source-target-namespace <name>", "optional namespace used when matching research source-plan targets to source_check_targets")
    .option("--source-target-preflight <file>", "optional source-plan smoke JSON to package without rerunning external fetches")
    .option("--seed-edge <ids>", "optional comma-separated seed edge ids when this pack is opened from a frontier queue")
    .option("--seed-unknown <ids>", "optional comma-separated seed unknown ids carried from the parent research pack")
    .option("--parent-company <entityId>", "optional parent company/entity id for recursive research lineage")
    .option("--parent-component <ids>", "optional comma-separated parent component ids for recursive research lineage")
    .option("--lineage-note <text>", "optional human-readable note explaining why this research pack was opened")
    .option("--prepare-data", "explicitly refresh claims, edge intelligence, and eligible component risk before exporting")
    .option("--build-claims", "explicitly build active claims before exporting")
    .option("--refresh-intelligence", "explicitly refresh edge strength/freshness context before exporting")
    .option("--refresh-component-risk", "explicitly refresh eligible component risk baselines before exporting")
    .option("--materialize-root-unknowns", "explicitly materialize selected-company root unknowns before exporting")
    .option("--skip-claims", "with --prepare-data, do not build active claims before exporting")
    .option("--skip-intelligence-refresh", "with --prepare-data, do not refresh edge strength/freshness context before exporting")
    .option("--skip-component-risk-refresh", "with --prepare-data, do not refresh component risk baselines before exporting")
    .option("--skip-root-unknowns", "with --prepare-data, do not materialize selected-company root unknowns before exporting")
    .option("--out <dir>", "output directory", "reports/research-pack")
    .description("build a full local research pack from existing truth-store data")
    .action(
      async (options: {
        company: string;
        component?: string;
        depth: string;
        generatedAt?: string;
        since?: string;
        changeLimit: string;
        sourceLimit: string;
        intelligenceLimit: string;
        tradeMonth?: string;
        tradeCountry?: string;
        tradeDirections: string;
        officialYear?: string;
        targetProfile?: string;
        materialYear?: string;
        commodityMonth?: string;
        sourceTargetNamespace?: string;
        sourceTargetPreflight?: string;
        seedEdge?: string;
        seedUnknown?: string;
        parentCompany?: string;
        parentComponent?: string;
        lineageNote?: string;
        prepareData?: boolean;
        buildClaims?: boolean;
        refreshIntelligence?: boolean;
        refreshComponentRisk?: boolean;
        materializeRootUnknowns?: boolean;
        skipClaims?: boolean;
        skipIntelligenceRefresh?: boolean;
        skipComponentRiskRefresh?: boolean;
        skipRootUnknowns?: boolean;
        out: string;
      }) => {
        await withDatabase(async (store) => {
          const generatedAt = explicitOrCurrentIsoTimestamp(options.generatedAt);
          const pack = await buildResearchPack(store, await researchPackInputFromOptions({ ...options, generatedAt }));
          const written = await writeResearchPack(options.out, pack);
          writeJson({
            ok: true,
            out_dir: written.out_dir,
            manifest: written.manifest
          });
        });
      }
    );

  research
    .command("from-workbench")
    .requiredOption("--workbench <file>", "existing Workbench JSON export")
    .option("--component <ids>", "optional comma-separated component ids to force into the source plan")
    .option("--depth <count>", "source-plan traversal depth; defaults to the workbench chain depth")
    .option("--generated-at <iso>", "explicit ISO timestamp for reproducible research-pack outputs")
    .option("--trade-month <yyyy-mm>", "emit Census Trade target suggestions for this month")
    .option("--trade-country <code>", "optional Census partner country code for trade target suggestions")
    .option("--trade-directions <directions>", "comma-separated trade directions", "imports,exports")
    .option("--official-year <yyyy>", "emit official IR disclosure target suggestions for this year")
    .option("--target-profile <id>", "research target profile id, or 'none' to disable automatic profile selection")
    .option("--material-year <yyyy>", "emit annual material observation target suggestions")
    .option("--commodity-month <yyyy-mm>", "emit monthly commodity price target suggestions")
    .option("--source-target-namespace <name>", "namespace used when rendering expected source target coverage")
    .option("--source-target-preflight <file>", "optional source-plan smoke JSON to package without rerunning external fetches")
    .option("--seed-edge <ids>", "optional comma-separated seed edge ids when this snapshot is opened from a frontier queue")
    .option("--seed-unknown <ids>", "optional comma-separated seed unknown ids carried from the parent research pack")
    .option("--parent-company <entityId>", "optional parent company/entity id for recursive research lineage")
    .option("--parent-component <ids>", "optional comma-separated parent component ids for recursive research lineage")
    .option("--lineage-note <text>", "optional human-readable note explaining why this snapshot was opened")
    .option("--out <dir>", "output directory", "reports/research-pack-snapshot")
    .description("build a no-database research snapshot from an existing workbench JSON")
    .action(
      async (options: {
        workbench: string;
        component?: string;
        depth?: string;
        generatedAt?: string;
        tradeMonth?: string;
        tradeCountry?: string;
        tradeDirections: string;
        officialYear?: string;
        targetProfile?: string;
        materialYear?: string;
        commodityMonth?: string;
        sourceTargetNamespace?: string;
        sourceTargetPreflight?: string;
        seedEdge?: string;
        seedUnknown?: string;
        parentCompany?: string;
        parentComponent?: string;
        lineageNote?: string;
        out: string;
      }) => {
        const workbench = parseWorkbenchModel(await readFile(options.workbench, "utf8"));
        const pack = buildResearchPackFromWorkbench({
          workbench,
          ...(options.component === undefined ? {} : { components: parseCommaSeparated(options.component) }),
          ...(options.depth === undefined ? {} : { depth: parseLimit(options.depth) }),
          ...(options.generatedAt === undefined ? {} : { generatedAt: parseSince(options.generatedAt) }),
          ...(options.tradeMonth === undefined
            ? {}
            : {
                tradeObservationMonth: options.tradeMonth,
                ...(options.tradeCountry === undefined ? {} : { tradeObservationCountryCode: options.tradeCountry }),
                tradeObservationDirections: parseTradeDirections(options.tradeDirections)
              }),
          ...(options.officialYear === undefined ? {} : { officialDisclosureYear: options.officialYear }),
          ...(options.targetProfile === undefined ? {} : { researchTargetProfileId: parseResearchTargetProfileOption(options.targetProfile) }),
          ...(options.materialYear === undefined ? {} : { materialObservationYear: options.materialYear }),
          ...(options.commodityMonth === undefined ? {} : { commodityObservationMonth: options.commodityMonth }),
          ...(options.sourceTargetNamespace === undefined ? {} : { sourceTargetNamespace: options.sourceTargetNamespace }),
          ...researchLineageFromOptions(options),
          ...(options.sourceTargetPreflight === undefined
            ? {}
            : { sourceTargetPreflight: parseSourceTargetPreflightReport(await readFile(options.sourceTargetPreflight, "utf8")) })
        });
        const written = await writeWorkbenchSnapshotPack(options.out, pack);
        writeJson({
          ok: true,
          out_dir: written.out_dir,
          manifest: written.manifest
        });
      }
    );
}

async function researchPackInputFromOptions(options: {
  company: string;
  component?: string;
  depth: string;
  generatedAt: string;
  since?: string;
  changeLimit: string;
  sourceLimit: string;
  intelligenceLimit: string;
  tradeMonth?: string;
  tradeCountry?: string;
  tradeDirections: string;
  officialYear?: string;
  targetProfile?: string;
  materialYear?: string;
  commodityMonth?: string;
  sourceTargetNamespace?: string;
  seedEdge?: string;
  seedUnknown?: string;
  parentCompany?: string;
  parentComponent?: string;
  lineageNote?: string;
  skipClaims?: boolean;
  skipIntelligenceRefresh?: boolean;
  skipComponentRiskRefresh?: boolean;
  prepareData?: boolean;
  buildClaims?: boolean;
  refreshIntelligence?: boolean;
  refreshComponentRisk?: boolean;
  materializeRootUnknowns?: boolean;
  skipRootUnknowns?: boolean;
  sourceTargetPreflight?: string;
}): Promise<ResearchPackInput> {
  return {
    company: options.company,
    depth: parseLimit(options.depth),
    generatedAt: options.generatedAt,
    ...(options.component === undefined ? {} : { components: parseCommaSeparated(options.component) }),
    ...(options.since === undefined ? {} : { since: parseSince(options.since) }),
    changeLimit: parseLimit(options.changeLimit),
    sourceLimit: parseLimit(options.sourceLimit),
    intelligenceLimit: parseLimit(options.intelligenceLimit),
    buildClaims: shouldRunWriteStep({
      prepareData: options.prepareData,
      explicit: options.buildClaims,
      skip: options.skipClaims
    }),
    refreshIntelligence: shouldRunWriteStep({
      prepareData: options.prepareData,
      explicit: options.refreshIntelligence,
      skip: options.skipIntelligenceRefresh
    }),
    refreshComponentRisk: shouldRunWriteStep({
      prepareData: options.prepareData,
      explicit: options.refreshComponentRisk,
      skip: options.skipComponentRiskRefresh
    }),
    materializeRootUnknowns: shouldRunWriteStep({
      prepareData: options.prepareData,
      explicit: options.materializeRootUnknowns,
      skip: options.skipRootUnknowns
    }),
    ...(options.tradeMonth === undefined
      ? {}
      : {
          tradeObservationMonth: options.tradeMonth,
          ...(options.tradeCountry === undefined ? {} : { tradeObservationCountryCode: options.tradeCountry }),
          tradeObservationDirections: parseTradeDirections(options.tradeDirections)
        }),
    ...(options.officialYear === undefined ? {} : { officialDisclosureYear: options.officialYear }),
    ...(options.targetProfile === undefined ? {} : { researchTargetProfileId: parseResearchTargetProfileOption(options.targetProfile) }),
    ...(options.materialYear === undefined ? {} : { materialObservationYear: options.materialYear }),
    ...(options.commodityMonth === undefined ? {} : { commodityObservationMonth: options.commodityMonth }),
    ...(options.sourceTargetNamespace === undefined ? {} : { sourceTargetNamespace: options.sourceTargetNamespace }),
    ...researchLineageFromOptions(options),
    ...(options.sourceTargetPreflight === undefined
      ? {}
      : { sourceTargetPreflight: parseSourceTargetPreflightReport(await readFile(options.sourceTargetPreflight, "utf8")) })
  };
}

function researchLineageFromOptions(options: {
  seedEdge?: string;
  seedUnknown?: string;
  parentCompany?: string;
  parentComponent?: string;
  lineageNote?: string;
}): Pick<ResearchPackInput, "researchLineage"> {
  const seedEdges = options.seedEdge === undefined ? [] : parseCommaSeparated(options.seedEdge);
  const seedUnknowns = options.seedUnknown === undefined ? [] : parseCommaSeparated(options.seedUnknown);
  const parentComponents = options.parentComponent === undefined ? [] : parseCommaSeparated(options.parentComponent);
  if (
    seedEdges.length === 0 &&
    seedUnknowns.length === 0 &&
    parentComponents.length === 0 &&
    options.parentCompany === undefined &&
    options.lineageNote === undefined
  ) {
    return {};
  }
  return {
    researchLineage: {
      kind: seedEdges.length > 0 ? "frontier_company_research" : "manual_research",
      parent_company_id: options.parentCompany ?? null,
      parent_component_ids: parentComponents,
      seed_edge_ids: seedEdges,
      seed_unknown_ids: seedUnknowns,
      note: options.lineageNote ?? null
    }
  };
}

function shouldRunWriteStep(input: { prepareData: boolean | undefined; explicit: boolean | undefined; skip: boolean | undefined }): boolean {
  if (input.skip === true) return false;
  return input.explicit === true || input.prepareData === true;
}

function parseResearchTargetProfileOption(value: string): ResearchTargetProfileOption {
  if (value === "none") return value;
  if (isResearchTargetProfileId(value)) return value;
  throw new Error(`Unsupported research target profile: ${value}`);
}
