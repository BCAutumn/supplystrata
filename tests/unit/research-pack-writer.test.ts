import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildResearchPackFromWorkbench, writeWorkbenchSnapshotPack } from "@supplystrata/research-pack";
import type { WorkbenchModel } from "@supplystrata/workbench-export";

describe("research-pack writer", () => {
  it("keeps workbench snapshot README semantics read-only and source-target explicit", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "supplystrata-research-pack-writer-"));
    try {
      const pack = buildResearchPackFromWorkbench({
        workbench: minimalWorkbench(),
        components: ["COMP-HBM"],
        depth: 2,
        sourceTargetNamespace: "nvidia-memory-2025"
      });

      await writeWorkbenchSnapshotPack(outDir, pack);

      const readme = await readFile(join(outDir, "README.md"), "utf8");
      expect(readme).toContain("Research Snapshot NVIDIA");
      expect(readme).toContain("does not refresh the SQL truth store, rebuild claims, or run data-quality checks");
      expect(readme).toContain("Source target coverage:");
      expect(readme).toContain("not synced");
      expect(readme).not.toContain("Data quality errors:");
      expect(readme).toContain("`gate1-run-ledger.json` and `gate1-run-ledger.md`");
      expect(readme).toContain("`evidence-index.json` contains the evidence records carried by the workbench export.");

      const ledger = JSON.parse(await readFile(join(outDir, "gate1-run-ledger.json"), "utf8")) as { mainline_phase?: string; company_switching?: unknown };
      expect(ledger.mainline_phase).toBe("sync_official_source_targets");
      expect(ledger.company_switching).toBeDefined();
    } finally {
      await rm(outDir, { force: true, recursive: true });
    }
  });
});

function minimalWorkbench(): WorkbenchModel {
  return {
    schema_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    selected_company_id: "ENT-NVIDIA",
    companies: [{ entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" }],
    chain: {
      schema_version: "1.0.0",
      view_type: "company_chain",
      root: { kind: "company", id: "ENT-NVIDIA", name: "NVIDIA" },
      max_depth: 2,
      generated_by: "unit-test",
      segments: [],
      stats: { fact_edges: 0, claims: 0, observations: 0, leads: 0, unknowns: 0 }
    },
    chain_segments: [],
    edges: [],
    upstream_edges: [],
    downstream_edges: [],
    claims: [],
    draft_claims: [],
    evidences: [],
    unknown_items: [],
    sources: [],
    source_plan: [],
    changes: [],
    attention_queue: [],
    review_queue: [],
    intelligence: { edge_strengths: [], edge_freshness: [] }
  };
}
