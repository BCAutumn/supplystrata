import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createResearchSessionStore, researchSessionProfileSummary } from "@supplystrata/source-workflows";
import type { ResearchTargetProfileSelection } from "@supplystrata/research-pack";

describe("research session lifecycle", () => {
  it("keeps a profile in memory only while the session is active", () => {
    const store = createResearchSessionStore();
    const profile = researchSessionProfileSummary(derivedSelection("ENT-LVMH"));
    expect(profile).not.toBeNull();
    if (profile === null) throw new Error("Expected derived profile summary.");

    store.register({
      session_id: "RR-1",
      run_id: "RR-1",
      company_entity_id: "ENT-LVMH",
      profile,
      created_at: "2026-05-29T00:00:00.000Z"
    });

    expect(store.get("RR-1")?.profile).toEqual(profile);
    store.complete("RR-1");
    expect(store.get("RR-1")).toBeNull();
  });

  it("keeps concurrent session profiles isolated by run id", () => {
    const store = createResearchSessionStore();
    const firstProfile = researchSessionProfileSummary(derivedSelection("ENT-LVMH"));
    const secondProfile = researchSessionProfileSummary(anchorSelection("ENT-NVIDIA"));
    if (firstProfile === null || secondProfile === null) throw new Error("Expected profile summaries.");

    store.register({
      session_id: "RR-1",
      run_id: "RR-1",
      company_entity_id: "ENT-LVMH",
      profile: firstProfile,
      created_at: "2026-05-29T00:00:00.000Z"
    });
    store.register({
      session_id: "RR-2",
      run_id: "RR-2",
      company_entity_id: "ENT-NVIDIA",
      profile: secondProfile,
      created_at: "2026-05-29T00:01:00.000Z"
    });

    store.complete("RR-1");
    expect(store.get("RR-1")).toBeNull();
    expect(store.get("RR-2")?.profile.profile_id).toBe("ai-compute-memory.v0");
  });

  it("summarizes derived profiles without raw prompt or rationale text", () => {
    const profile = researchSessionProfileSummary(derivedSelection("ENT-LVMH"));
    expect(profile).toEqual({
      layer: "derived",
      profile_id: "derived.runtime.v0",
      title: "Runtime derived research profile",
      derivation_status: "candidate",
      helper_status: "candidate",
      target_nodes: 0,
      expected_upstream_components: 1,
      source_targets: 1,
      selection_reason: "fixture derived profile"
    });
  });

  it("does not add a derived profile persistence path", () => {
    for (const file of sourceFiles(["packages/db/src", "packages/source-workflows/src"])) {
      expect(readFileSync(file, "utf8")).not.toContain("derived_profile");
    }
  });
});

function derivedSelection(companyId: string): ResearchTargetProfileSelection {
  return {
    layer: "derived",
    reason: "fixture derived profile",
    profile: {
      layer: "derived",
      profile_id: "derived.runtime.v0",
      version: "0.1.0",
      title: "Runtime derived research profile",
      description: "fixture",
      applies_to_company_ids: [companyId],
      applies_to_component_ids: ["COMP-PACKAGING"],
      target_nodes: [],
      derivation: {
        status: "candidate",
        company_id: companyId,
        component_ids: ["COMP-PACKAGING"],
        source_refs: ["wikidata:Q504998"],
        helper_status: "candidate",
        confidence: 0.8,
        rationale: "This must not be exposed in the session profile summary.",
        citations: [{ source_ref: "wikidata:Q504998" }],
        expected_upstream_components: [{ component_id: "COMP-PACKAGING", label: "packaging", rationale: "fixture" }],
        source_targets: [{ source_adapter_id: "gleif", target_ref: "969500FP1Q07I98R6P10", rationale: "fixture" }],
        fact_write_allowed: false,
        reason: "fixture derived profile"
      }
    }
  };
}

function anchorSelection(companyId: string): ResearchTargetProfileSelection {
  return {
    layer: "anchor",
    reason: "fixture anchor profile",
    profile: {
      layer: "anchor",
      profile_id: "ai-compute-memory.v0",
      version: "0.1.0",
      title: "AI compute memory",
      description: "fixture",
      applies_to_company_ids: [companyId],
      applies_to_component_ids: [],
      target_nodes: []
    }
  };
}

function sourceFiles(roots: readonly string[]): string[] {
  return roots.flatMap((root) => collectSourceFiles(root));
}

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}
