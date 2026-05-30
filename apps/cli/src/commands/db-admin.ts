import type { Command } from "commander";
import { importDevFixturesFromCsv, migrate } from "@supplystrata/db/admin";
import { backfillEvidenceTraceTransactionally, repairSupplierListEvidenceCitationsTransactionally } from "@supplystrata/evidence-maintenance";
import { backfillDocumentFacts } from "@supplystrata/pipeline";
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
        const summary = await backfillEvidenceTraceTransactionally(pool, { limit: parseLimit(options.limit) });
        writeJson({ ok: true, ...summary });
      });
    });
  db.command("repair-supplier-list-citations")
    .option("--limit <count>", "max supplier-list evidence rows to scan", "1000")
    .description("repair supplier-list evidence citations whose review row spacing no longer matches persisted chunks")
    .action(async (options: { limit: string }) => {
      await withDatabase(async (pool) => {
        const summary = await repairSupplierListEvidenceCitationsTransactionally(pool, { limit: parseLimit(options.limit) });
        writeJson({ ok: true, ...summary });
      });
    });
  db.command("reextract-facts")
    .description("re-run rule extraction + evidence-gated promotion over already-stored documents (backfill after extractor upgrades); idempotent")
    .option("--entity <entityId>", "limit to documents whose primary entity is this entity id, e.g. ENT-ASML")
    .option("--adapter <sourceAdapterId>", "limit to a source adapter, e.g. sec-edgar")
    .option("--doc-type <type...>", "limit to one or more document types, e.g. 20-F 10-K")
    .option("--limit <count>", "max documents to process", "200")
    .action(async (options: { entity?: string; adapter?: string; docType?: string[]; limit: string }) => {
      await withDatabase(async (store) => {
        const summary = await backfillDocumentFacts(store, {
          ...(options.entity === undefined ? {} : { entityId: options.entity }),
          ...(options.adapter === undefined ? {} : { sourceAdapterId: options.adapter }),
          ...(options.docType === undefined ? {} : { documentTypes: options.docType }),
          limit: parseLimit(options.limit)
        });
        writeJson({ ok: true, ...summary });
      });
    });

  const admin = program.command("admin").description("admin commands");
  admin
    .command("import-dev-fixtures")
    .description("load dev-only entity fixtures and component seeds")
    .action(async () => {
      await withDatabase(async (pool) => {
        const result = await importDevFixturesFromCsv(pool, process.cwd());
        writeJson({ ok: true, ...result });
      });
    });
}
