import type { Command } from "commander";
import { buildResearchPack, writeResearchPack, type ResearchPackInput } from "@supplystrata/research-pack";
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
    .option("--trade-month <yyyy-mm>", "emit Census Trade target suggestions for this month")
    .option("--trade-country <code>", "optional Census partner country code for trade target suggestions")
    .option("--trade-directions <directions>", "comma-separated trade directions", "imports,exports")
    .option("--material-year <yyyy>", "emit annual material observation target suggestions")
    .option("--commodity-month <yyyy-mm>", "emit monthly commodity price target suggestions")
    .option("--skip-claims", "do not build active claims before exporting")
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
        tradeMonth?: string;
        tradeCountry?: string;
        tradeDirections: string;
        materialYear?: string;
        commodityMonth?: string;
        skipClaims?: boolean;
        out: string;
      }) => {
        await withDatabase(async (store) => {
          const pack = await buildResearchPack(store, researchPackInputFromOptions(options));
          const written = await writeResearchPack(options.out, pack);
          writeJson({
            ok: true,
            out_dir: written.out_dir,
            manifest: written.manifest
          });
        });
      }
    );
}

function researchPackInputFromOptions(options: {
  company: string;
  component?: string;
  depth: string;
  since?: string;
  changeLimit: string;
  sourceLimit: string;
  tradeMonth?: string;
  tradeCountry?: string;
  tradeDirections: string;
  materialYear?: string;
  commodityMonth?: string;
  skipClaims?: boolean;
}): ResearchPackInput {
  return {
    company: options.company,
    depth: parseLimit(options.depth),
    ...(options.component === undefined ? {} : { components: parseCsv(options.component) }),
    ...(options.since === undefined ? {} : { since: parseSince(options.since) }),
    changeLimit: parseLimit(options.changeLimit),
    sourceLimit: parseLimit(options.sourceLimit),
    buildClaims: options.skipClaims === true ? false : true,
    ...(options.tradeMonth === undefined
      ? {}
      : {
          tradeObservationMonth: options.tradeMonth,
          ...(options.tradeCountry === undefined ? {} : { tradeObservationCountryCode: options.tradeCountry }),
          tradeObservationDirections: parseTradeDirections(options.tradeDirections)
        }),
    ...(options.materialYear === undefined ? {} : { materialObservationYear: options.materialYear }),
    ...(options.commodityMonth === undefined ? {} : { commodityObservationMonth: options.commodityMonth })
  };
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
