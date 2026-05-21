import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import {
  buildResearchPack,
  buildResearchPackFromWorkbench,
  writeResearchPack,
  writeWorkbenchSnapshotPack,
  parseSourceTargetPreflightReport,
  type ResearchPackInput,
  type ResearchTargetProfileOption
} from "@supplystrata/research-pack";
import { parseWorkbenchModel } from "@supplystrata/workbench-export/schema";
import { parseLimit, parseSince, withDatabase, writeJson } from "../cli-utils.js";

export function registerResearchCommands(program: Command): void {
  const research = program.command("research").description("research package commands");

  research
    .command("run")
    .requiredOption("--company <query>", "company name, alias, ticker, or entity id")
    .option("--component <ids>", "optional comma-separated component ids to force into the research pack")
    .option("--depth <count>", "chain/source-plan traversal depth", "3")
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
    .option("--skip-claims", "do not build active claims before exporting")
    .option("--skip-intelligence-refresh", "do not refresh edge strength/freshness context before exporting")
    .option("--skip-component-risk-refresh", "do not refresh component risk baselines before exporting")
    .option("--out <dir>", "output directory", "reports/research-pack")
    .description("build a full local research pack from existing truth-store data")
    .action(
      async (options: {
        company: string;
        component?: string;
        depth: string;
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
        skipClaims?: boolean;
        skipIntelligenceRefresh?: boolean;
        skipComponentRiskRefresh?: boolean;
        out: string;
      }) => {
        await withDatabase(async (store) => {
          const pack = await buildResearchPack(store, await researchPackInputFromOptions(options));
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
    .option("--trade-month <yyyy-mm>", "emit Census Trade target suggestions for this month")
    .option("--trade-country <code>", "optional Census partner country code for trade target suggestions")
    .option("--trade-directions <directions>", "comma-separated trade directions", "imports,exports")
    .option("--official-year <yyyy>", "emit official IR disclosure target suggestions for this year")
    .option("--target-profile <id>", "research target profile id, or 'none' to disable automatic profile selection")
    .option("--material-year <yyyy>", "emit annual material observation target suggestions")
    .option("--commodity-month <yyyy-mm>", "emit monthly commodity price target suggestions")
    .option("--source-target-namespace <name>", "namespace used when rendering expected source target coverage")
    .option("--source-target-preflight <file>", "optional source-plan smoke JSON to package without rerunning external fetches")
    .option("--out <dir>", "output directory", "reports/research-pack-snapshot")
    .description("build a no-database research snapshot from an existing workbench JSON")
    .action(
      async (options: {
        workbench: string;
        component?: string;
        depth?: string;
        tradeMonth?: string;
        tradeCountry?: string;
        tradeDirections: string;
        officialYear?: string;
        targetProfile?: string;
        materialYear?: string;
        commodityMonth?: string;
        sourceTargetNamespace?: string;
        sourceTargetPreflight?: string;
        out: string;
      }) => {
        const workbench = parseWorkbenchModel(await readFile(options.workbench, "utf8"));
        const pack = buildResearchPackFromWorkbench({
          workbench,
          ...(options.component === undefined ? {} : { components: parseCsv(options.component) }),
          ...(options.depth === undefined ? {} : { depth: parseLimit(options.depth) }),
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
  skipClaims?: boolean;
  skipIntelligenceRefresh?: boolean;
  skipComponentRiskRefresh?: boolean;
  sourceTargetPreflight?: string;
}): Promise<ResearchPackInput> {
  return {
    company: options.company,
    depth: parseLimit(options.depth),
    ...(options.component === undefined ? {} : { components: parseCsv(options.component) }),
    ...(options.since === undefined ? {} : { since: parseSince(options.since) }),
    changeLimit: parseLimit(options.changeLimit),
    sourceLimit: parseLimit(options.sourceLimit),
    intelligenceLimit: parseLimit(options.intelligenceLimit),
    buildClaims: options.skipClaims === true ? false : true,
    refreshIntelligence: options.skipIntelligenceRefresh === true ? false : true,
    refreshComponentRisk: options.skipComponentRiskRefresh === true ? false : true,
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
    ...(options.sourceTargetPreflight === undefined
      ? {}
      : { sourceTargetPreflight: parseSourceTargetPreflightReport(await readFile(options.sourceTargetPreflight, "utf8")) })
  };
}

function parseResearchTargetProfileOption(value: string): ResearchTargetProfileOption {
  if (value === "ai-compute-memory.v0" || value === "none") return value;
  throw new Error(`Unsupported research target profile: ${value}`);
}

function parseCsv(value: string): string[] {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (items.length === 0) throw new Error("Comma-separated option must include at least one value");
  return items;
}

function parseTradeDirections(value: string): ("imports" | "exports")[] {
  return parseCsv(value).map((item) => {
    if (item === "imports" || item === "exports") return item;
    throw new Error(`Unsupported trade direction: ${item}`);
  });
}
