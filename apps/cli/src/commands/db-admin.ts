import type { Command } from "commander";
import { migrate, seedFromCsv } from "@supplystrata/db/admin";
import { backfillEvidenceTrace } from "@supplystrata/evidence-maintenance";
import { parseLimit, withDatabase, writeJson } from "../cli-utils.js";

export function registerDbAndAdminCommands(program: Command): void {
  const db = program.command("db").description("database commands");
  db.command("migrate")
    .description("run SQL migrations")
    .action(async () => {
      await withDatabase(async (pool) => {
        await migrate(pool);
        writeJson({ ok: true, migrated: true });
      });
    });
  db.command("backfill-evidence-trace")
    .option("--limit <count>", "max evidence rows to backfill", "1000")
    .description("backfill evidence citation offsets and fingerprints")
    .action(async (options: { limit: string }) => {
      await withDatabase(async (pool) => {
        const summary = await backfillEvidenceTrace(pool, { limit: parseLimit(options.limit) });
        writeJson({ ok: true, ...summary });
      });
    });

  const admin = program.command("admin").description("admin commands");
  admin
    .command("seed")
    .description("load seed CSV files")
    .action(async () => {
      await withDatabase(async (pool) => {
        const result = await seedFromCsv(pool);
        writeJson({ ok: true, ...result });
      });
    });
}
