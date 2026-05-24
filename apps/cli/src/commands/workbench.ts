import { writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { buildWorkbenchModel } from "@supplystrata/workbench-export";
import { parseLimit, parseSince, withDatabase, writeJson } from "../cli-utils.js";
import { explicitOrCurrentIsoTimestamp } from "../cli-clock.js";

export function registerWorkbenchCommands(program: Command): void {
  const workbench = program.command("workbench").description("local research workbench commands");
  workbench
    .command("export")
    .requiredOption("--company <query>", "company name, alias, ticker, or entity id")
    .option("--depth <count>", "upstream traversal depth, max 5", "2")
    .option("--since <date>", "ISO date/time lower bound for changes")
    .option("--generated-at <iso>", "explicit ISO timestamp for reproducible workbench exports")
    .option("--change-limit <count>", "max changes", "50")
    .option("--source-limit <count>", "max source health rows", "50")
    .option("--out <path>", "write JSON to a file instead of stdout")
    .description("export a JSON model consumed by apps/research-preview")
    .action(
      async (options: { company: string; depth: string; since?: string; generatedAt?: string; changeLimit: string; sourceLimit: string; out?: string }) => {
        await withDatabase(async (pool) => {
          const generatedAt = explicitOrCurrentIsoTimestamp(options.generatedAt);
          const model = await buildWorkbenchModel(pool.read, {
            company: options.company,
            depth: parseLimit(options.depth),
            generatedAt,
            changeLimit: parseLimit(options.changeLimit),
            sourceLimit: parseLimit(options.sourceLimit),
            ...(options.since === undefined ? {} : { since: parseSince(options.since) })
          });
          if (options.out === undefined) {
            writeJson(model);
            return;
          }
          await writeFile(options.out, `${JSON.stringify(model, null, 2)}\n`, "utf8");
          writeJson({ ok: true, out: options.out, schema_version: model.schema_version, selected_company_id: model.selected_company_id });
        });
      }
    );
}
