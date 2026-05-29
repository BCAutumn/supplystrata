import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCommunityPack, findCommunityPackScbomDocument, loadCommunityPackFromPath } from "@supplystrata/community-pack";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("community-pack loader", () => {
  it("loads sha256-checked SCBOM JSONL as read-only baseline documents", async () => {
    const dir = await writePackFixture();
    const loaded = loadCommunityPackFromPath(dir);
    const document = findCommunityPackScbomDocument(loaded, "ENT-NVIDIA");

    expect(loaded.manifest.pack_version).toBe("pack-2026.Q2");
    expect(document?.objects.every((object) => object.provenance.method === "community-pack:pack-2026.Q2")).toBe(true);
  });

  it("fails fast when a loaded data file does not match its manifest sha256", async () => {
    const dir = await writePackFixture();
    await writeFile(join(dir, "scbom", "companies.jsonl"), "", "utf8");

    expect(() => loadCommunityPackFromPath(dir)).toThrow("sha256 mismatch");
  });
});

async function writePackFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "supplystrata-community-pack-"));
  const pack = buildCommunityPack({
    packVersion: "pack-2026.Q2",
    generatedAt: "2026-05-29T00:00:00.000Z",
    license: "CC-BY-4.0",
    sourceInstanceFingerprint: "e".repeat(64),
    workbenchModels: [workbenchScbomFixture()]
  });
  await mkdir(join(dir, "scbom"), { recursive: true });
  await writeFile(join(dir, "manifest.json"), `${JSON.stringify(pack.manifest, null, 2)}\n`, "utf8");
  await writeFile(join(dir, "scbom", "companies.jsonl"), String(pack.files[0]?.content ?? ""), "utf8");
  return dir;
}
