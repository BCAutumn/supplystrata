import { describe, expect, it } from "vitest";
import {
  assertCommunityPackFileIntegrity,
  assertCommunityPackManifest,
  COMMUNITY_PACK_CANONICAL_FORMAT,
  COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION,
  COMMUNITY_PACK_SCBOM_SCHEMA_VERSION,
  COMMUNITY_PACK_SHA256_ALGORITHM,
  manifestFileForScbomJsonl,
  manifestTotals,
  parseCommunityPackManifest,
  summarizeScbomJsonl,
  type CommunityPackManifest
} from "@supplystrata/community-pack";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("community-pack manifest format", () => {
  it("validates a neutral SCBOM JSONL manifest with sha256-covered files", () => {
    const jsonl = `${JSON.stringify(toScbomDocument(workbenchScbomFixture()))}\n`;
    const file = manifestFileForScbomJsonl({ path: "scbom/companies.jsonl", content: jsonl });
    const manifest: CommunityPackManifest = {
      schema_version: COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION,
      pack_version: "pack-2026.Q2",
      generated_at: "2026-05-29T00:00:00.000Z",
      canonical_format: COMMUNITY_PACK_CANONICAL_FORMAT,
      scbom_schema_version: COMMUNITY_PACK_SCBOM_SCHEMA_VERSION,
      license: "CC-BY-4.0",
      source_instance: {
        fingerprint: "a".repeat(64)
      },
      integrity: {
        algorithm: COMMUNITY_PACK_SHA256_ALGORITHM
      },
      files: [file],
      totals: manifestTotals([file])
    };

    assertCommunityPackManifest(manifest);
    assertCommunityPackFileIntegrity(manifest, [{ path: file.path, content: jsonl }]);
    expect(parseCommunityPackManifest(JSON.stringify(manifest))).toEqual(manifest);
    expect(summarizeScbomJsonl(jsonl)).toEqual({
      documents: 1,
      object_counts: file.object_counts
    });
  });

  it("fails fast when a listed data file is tampered", () => {
    const jsonl = `${JSON.stringify(toScbomDocument(workbenchScbomFixture()))}\n`;
    const file = manifestFileForScbomJsonl({ path: "scbom/companies.jsonl", content: jsonl });
    const manifest: CommunityPackManifest = {
      schema_version: COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION,
      pack_version: "pack-2026.Q2",
      generated_at: "2026-05-29T00:00:00.000Z",
      canonical_format: COMMUNITY_PACK_CANONICAL_FORMAT,
      scbom_schema_version: COMMUNITY_PACK_SCBOM_SCHEMA_VERSION,
      license: "CC-BY-4.0",
      source_instance: {
        fingerprint: "b".repeat(64)
      },
      integrity: {
        algorithm: COMMUNITY_PACK_SHA256_ALGORITHM
      },
      files: [file],
      totals: manifestTotals([file])
    };

    const tampered = jsonl.replace("NVIDIA uses TSMC for wafer fabrication.", "NVIDIA uses TSMC for wafer fabrication and packaging.");

    expect(() => assertCommunityPackFileIntegrity(manifest, [{ path: file.path, content: tampered }])).toThrow("sha256 mismatch");
  });

  it("rejects fields outside the manifest schema", () => {
    const jsonl = `${JSON.stringify(toScbomDocument(workbenchScbomFixture()))}\n`;
    const file = manifestFileForScbomJsonl({ path: "scbom/companies.jsonl", content: jsonl });
    const manifest: CommunityPackManifest & { supplystrata_private_state: string } = {
      schema_version: COMMUNITY_PACK_MANIFEST_SCHEMA_VERSION,
      pack_version: "pack-2026.Q2",
      generated_at: "2026-05-29T00:00:00.000Z",
      canonical_format: COMMUNITY_PACK_CANONICAL_FORMAT,
      scbom_schema_version: COMMUNITY_PACK_SCBOM_SCHEMA_VERSION,
      license: "CC-BY-4.0",
      source_instance: {
        fingerprint: "c".repeat(64)
      },
      integrity: {
        algorithm: COMMUNITY_PACK_SHA256_ALGORITHM
      },
      files: [file],
      totals: manifestTotals([file]),
      supplystrata_private_state: "blocked"
    };

    expect(() => assertCommunityPackManifest(manifest)).toThrow("supplystrata_private_state is not part of the community-pack manifest schema");
  });
});
