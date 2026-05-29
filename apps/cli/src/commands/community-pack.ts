import { dirname, join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { Command } from "commander";
import { loadEnv } from "@supplystrata/config";
import { buildCommunityPack, sha256Hex } from "@supplystrata/community-pack";
import { buildWorkbenchModel } from "@supplystrata/workbench-export";
import { explicitOrCurrentIsoTimestamp } from "../cli-clock.js";
import { parseLimit, withDatabase, writeJson } from "../cli-utils.js";

export function registerCommunityPackCommands(program: Command): void {
  const communityPack = program.command("community-pack").description("community-pack build and validation commands");
  communityPack
    .command("build")
    .option("--company <query>", "company name, alias, ticker, or entity id; repeat for multiple companies", collectCompany, [])
    .option("--depth <count>", "upstream traversal depth for each company", "2")
    .option("--generated-at <iso>", "explicit ISO timestamp for reproducible pack builds")
    .option("--pack-version <version>", "pack release label such as pack-2026.Q2")
    .option("--license <license>", "pack data license", "CC-BY-4.0")
    .option("--source-instance-fingerprint <sha256>", "sha256 fingerprint of the producing local source instance")
    .option("--out <dir>", "output directory", "reports/community-pack")
    .description("build a versioned SCBOM JSONL community-pack from publish-eligible local facts")
    .action(
      async (options: {
        company: string[];
        depth: string;
        generatedAt?: string;
        packVersion?: string;
        license: string;
        sourceInstanceFingerprint?: string;
        out: string;
      }) => {
        const companies = uniqueStrings(options.company);
        if (companies.length === 0) throw new Error("community-pack build requires at least one --company value");
        const generatedAt = explicitOrCurrentIsoTimestamp(options.generatedAt);
        const packVersion = options.packVersion ?? packVersionForTimestamp(generatedAt);
        const sourceInstanceFingerprint = options.sourceInstanceFingerprint ?? localSourceInstanceFingerprint();

        await withDatabase(async (store) => {
          const workbenchModels = [];
          for (const company of companies) {
            workbenchModels.push(
              await buildWorkbenchModel(store.read, {
                company,
                depth: parseLimit(options.depth),
                generatedAt
              })
            );
          }

          const pack = buildCommunityPack({
            packVersion,
            generatedAt,
            license: options.license,
            sourceInstanceFingerprint,
            workbenchModels
          });
          await writeCommunityPack(options.out, pack);
          writeJson({
            ok: true,
            out: options.out,
            pack_version: pack.manifest.pack_version,
            files: pack.manifest.totals.files,
            documents: pack.manifest.totals.documents,
            relationships: pack.manifest.totals.object_counts.relationship
          });
        });
      }
    );
}

function collectCompany(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))].sort();
}

function packVersionForTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid generated-at timestamp: ${value}`);
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  return `pack-${date.getUTCFullYear()}.Q${quarter}`;
}

function localSourceInstanceFingerprint(): string {
  const postgresUrl = new URL(loadEnv().POSTGRES_URL);
  return sha256Hex(`postgres:${postgresUrl.hostname}:${postgresUrl.port}${postgresUrl.pathname}`);
}

async function writeCommunityPack(outDir: string, pack: ReturnType<typeof buildCommunityPack>): Promise<void> {
  await mkdir(outDir, { recursive: true });
  for (const file of pack.files) {
    const path = join(outDir, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
  await writeFile(join(outDir, "manifest.json"), `${JSON.stringify(pack.manifest, null, 2)}\n`, "utf8");
}
