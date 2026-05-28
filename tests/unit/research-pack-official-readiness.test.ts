import { describe, expect, it } from "vitest";
import type { WorkbenchModel } from "@supplystrata/workbench-export";
import {
  buildInvestigationBacklog,
  buildOfficialDisclosureReadinessReport,
  getBuiltInResearchTargetProfile,
  listBuiltInResearchTargetProfiles,
  renderOfficialDisclosureReadinessMarkdown
} from "@supplystrata/research-pack";
import {
  edgeFixture,
  emptyWorkbench,
  evidenceFixture,
  officialSourcePlanItem,
  officialSourceTargetCoverage,
  readyQuestionReadiness
} from "./research-pack-fixtures.js";

describe("research-pack official disclosure readiness", () => {
  it("counts only undisposed official disclosure signals as open review work", () => {
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-HBM"],
      workbench: {
        ...emptyWorkbench(),
        review_queue: [
          officialSignalReviewCandidateFixture("REV-SIGNAL-OPEN", "pending", []),
          officialSignalReviewCandidateFixture("REV-SIGNAL-DISPOSED", "pending", [
            {
              change_id: "CHG-SIGNAL-DISPOSITION-1",
              review_id: "REV-SIGNAL-DISPOSED",
              edge_id: "EDGE-NVIDIA-SKHYNIX",
              decision: "needs_more_evidence",
              reviewer: "unit-test",
              reason: "Useful HBM context, but not enough to prove a counterparty edge.",
              source_adapter_id: "skhynix-ir",
              doc_id: "DOC-SKHYNIX-IR",
              signal_title: "SK hynix links results to HBM demand",
              evidence_id: null,
              unknown_id: null,
              check_target_id: null,
              recorded_at: "2026-01-01T00:00:00.000Z",
              fact_write_policy: {
                automatic_fact_mutation_allowed: false,
                allowed_edge_mutation: "none",
                requires_human_review: true
              }
            }
          ])
        ]
      }
    });

    expect(report.summary.official_disclosure_signal_review_candidates).toBe(2);
    expect(report.summary.open_official_disclosure_signal_review_candidates).toBe(1);
    expect(report.summary.official_disclosure_signal_dispositions).toBe(1);
  });

  it("reports official disclosure readiness gaps without inferring corroboration from silence", () => {
    const workbench = emptyWorkbench();
    const edge = {
      edge_id: "EDGE-OFFICIAL-1",
      from_id: "ENT-NVIDIA",
      from_name: "NVIDIA",
      to_id: "ENT-MICRON",
      to_name: "Micron",
      relation: "BUYS_FROM" as const,
      component: "memory",
      component_id: "COMP-MEMORY",
      evidence_level: 5 as const,
      confidence: 0.95,
      evidence_ids: ["EV-OFFICIAL-1"]
    };
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-MEMORY"],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: officialSourceTargetCoverage("due"),
      workbench: {
        ...workbench,
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-MICRON", name: "Micron", role: "counterparty" }
        ],
        edges: [edge],
        evidences: [
          evidenceFixture("EV-OFFICIAL-1", {
            edge_id: "EDGE-OFFICIAL-1",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.summary.level_4_5_fact_edges).toBe(1);
    expect(report.summary.traceable_edges).toBe(1);
    expect(report.summary.cross_source_edges).toBe(0);
    expect(report.summary.single_source_edges).toBe(1);
    expect(report.summary.corroboration_queue_items).toBe(1);
    expect(report.summary.corroboration_queue_needing_disposition).toBe(1);
    expect(report.summary.corroboration_queue_with_recorded_disposition).toBe(0);
    expect(report.summary.corroboration_queue_proposed_unknowns).toBe(1);
    const [queueItem] = report.corroboration_queue;
    expect(queueItem?.edge_id).toBe("EDGE-OFFICIAL-1");
    expect(queueItem?.disposition).toBe("needs_explicit_single_source_disposition");
    expect(queueItem?.existing_source_adapters).toEqual(["sec-edgar"]);
    expect(queueItem?.unknown_ids).toEqual([]);
    expect(queueItem?.proposed_unknown?.scope_kind).toBe("edge");
    expect(queueItem?.proposed_unknown?.scope_id).toBe("EDGE-OFFICIAL-1");
    expect(queueItem?.proposed_unknown?.created_by).toBe("official-disclosure-readiness.single-source-disposition.v1");
    expect(report.summary.visible_research_nodes).toBe(5);
    expect(report.summary.nodes_with_fact_edges).toBe(3);
    expect(report.summary.nodes_with_runnable_official_targets).toBe(2);
    expect(report.summary.runnable_official_targets).toBe(1);
    expect(report.scorecard.criteria.find((criterion) => criterion.criterion_id === "fact_edge_traceability")).toEqual(
      expect.objectContaining({ status: "pass", measured: 1, target: 1, progress: 1 })
    );
    expect(report.scorecard.criteria.find((criterion) => criterion.criterion_id === "level_4_5_fact_edge_coverage")).toEqual(
      expect.objectContaining({ status: "partial", measured: 1, target: 100, progress: 0.01 })
    );
    expect(report.summary.synced_official_targets).toBe(1);
    expect(report.summary.due_official_targets).toBe(1);
    expect(report.source_plan_items[0]?.source_targets[0]?.state).toBe("due");
    expect(report.nodes.find((node) => node.node_id === "COMP-DRAM")?.coverage_state).toBe("official_target_synced");
    expect(report.nodes.find((node) => node.node_id === "ENT-SAMSUNG-ELECTRONICS")?.coverage_state).toBe("official_target_synced");
    expect(report.gaps.map((gap) => gap.kind)).toContain("corroboration_or_disposition_coverage");
    expect(report.gaps.map((gap) => gap.kind)).toContain("edge_strength");
    expect(report.gaps.find((gap) => gap.kind === "level_4_5_edge_coverage")?.action).toContain("Run due official disclosure targets");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Add second-source corroboration or explicit single-source disposition");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Proposed unknown: UNK-EDGE-CORROB-");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("samsung-ir/official-html-disclosure=due");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Node coverage");
  });

  it("distinguishes recorded single-source dispositions from missing disposition unknowns", () => {
    const edge = {
      edge_id: "EDGE-SINGLE-SOURCE-1",
      from_id: "ENT-NVIDIA",
      from_name: "NVIDIA",
      to_id: "ENT-CUSTOM",
      to_name: "Custom Supplier",
      relation: "BUYS_FROM" as const,
      component: "custom",
      component_id: "COMP-CUSTOM",
      evidence_level: 5 as const,
      confidence: 0.95,
      evidence_ids: ["EV-SINGLE-SOURCE-1"]
    };
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-CUSTOM"],
      workbench: {
        ...emptyWorkbench(),
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-CUSTOM", name: "Custom Supplier", role: "counterparty" }
        ],
        edges: [edge],
        evidences: [
          evidenceFixture("EV-SINGLE-SOURCE-1", {
            edge_id: "EDGE-SINGLE-SOURCE-1",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        unknown_items: [
          {
            unknown_id: "UNK-SINGLE-SOURCE-DISPOSITION-1",
            scope_kind: "edge",
            scope_id: "EDGE-SINGLE-SOURCE-1",
            question: "Can this relationship be corroborated by a second-source official disclosure?",
            why_unknown: "This fact edge is currently single-source; no counterparty official disclosure path is visible.",
            blocking_data_sources: ["single-source disposition"],
            proxies: ["manual disposition"],
            status: "open"
          }
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.summary.corroboration_queue_items).toBe(1);
    expect(report.summary.corroboration_queue_needing_disposition).toBe(0);
    expect(report.summary.corroboration_queue_with_recorded_disposition).toBe(1);
    expect(report.summary.corroboration_or_disposition_edges).toBe(1);
    expect(report.summary.corroboration_or_disposition_ratio).toBe(1);
    expect(report.summary.corroboration_queue_proposed_unknowns).toBe(0);
    expect(report.corroboration_queue[0]).toEqual(
      expect.objectContaining({
        edge_id: "EDGE-SINGLE-SOURCE-1",
        disposition: "single_source_disposition_recorded",
        unknown_ids: ["UNK-SINGLE-SOURCE-DISPOSITION-1"],
        proposed_unknown: null
      })
    );
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("single_source_disposition_recorded");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("UNK-SINGLE-SOURCE-DISPOSITION-1");
  });

  it("uses review-only edge corroboration dispositions as explicit single-source coverage", () => {
    const edge = {
      edge_id: "EDGE-DISPOSED-SINGLE-SOURCE-1",
      from_id: "ENT-NVIDIA",
      from_name: "NVIDIA",
      to_id: "ENT-MICRON",
      to_name: "Micron",
      relation: "BUYS_FROM" as const,
      component: "memory",
      component_id: "COMP-MEMORY",
      evidence_level: 5 as const,
      confidence: 0.95,
      evidence_ids: ["EV-DISPOSED-SINGLE-SOURCE-1"]
    };
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-MEMORY"],
      edge_corroboration_dispositions: [
        {
          change_id: "CHG-EDGE-CORROBORATION-1",
          edge_id: "EDGE-DISPOSED-SINGLE-SOURCE-1",
          decision: "record_single_source_unknown",
          reviewer: "unit-test",
          reason: "No second official counterparty source is currently visible.",
          evidence_id: null,
          unknown_id: "UNK-DISPOSED-SINGLE-SOURCE-1",
          check_target_id: null,
          recorded_at: "2026-05-26T00:00:00.000Z"
        }
      ],
      workbench: {
        ...emptyWorkbench(),
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-MICRON", name: "Micron", role: "counterparty" }
        ],
        edges: [edge],
        evidences: [
          evidenceFixture("EV-DISPOSED-SINGLE-SOURCE-1", {
            edge_id: "EDGE-DISPOSED-SINGLE-SOURCE-1",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.edge_corroboration_dispositions).toHaveLength(1);
    expect(report.summary.corroboration_queue_needing_disposition).toBe(0);
    expect(report.summary.corroboration_queue_with_recorded_disposition).toBe(1);
    const queueItem = report.corroboration_queue[0];
    expect(queueItem?.edge_id).toBe("EDGE-DISPOSED-SINGLE-SOURCE-1");
    expect(queueItem?.disposition).toBe("single_source_disposition_recorded");
    expect(queueItem?.latest_disposition?.change_id).toBe("CHG-EDGE-CORROBORATION-1");
    expect(queueItem?.latest_disposition?.decision).toBe("record_single_source_unknown");
    expect(queueItem?.proposed_unknown).toBeNull();
  });

  it("does not re-propose a single-source unknown after the controlled unknown materialization has run", () => {
    const edge = {
      edge_id: "EDGE-MATERIALIZED-SINGLE-SOURCE-1",
      from_id: "ENT-NVIDIA",
      from_name: "NVIDIA",
      to_id: "ENT-MICRON",
      to_name: "Micron",
      relation: "BUYS_FROM" as const,
      component: "memory",
      component_id: "COMP-MEMORY",
      evidence_level: 5 as const,
      confidence: 0.95,
      evidence_ids: ["EV-MATERIALIZED-SINGLE-SOURCE-1"]
    };
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-MEMORY"],
      edge_corroboration_dispositions: [
        {
          change_id: "CHG-EDGE-CORROBORATION-MATERIALIZED-1",
          edge_id: "EDGE-MATERIALIZED-SINGLE-SOURCE-1",
          decision: "record_single_source_unknown",
          reviewer: "unit-test",
          reason: "Counterparty source target completed without edge-specific second-source evidence.",
          evidence_id: null,
          unknown_id: null,
          check_target_id: "CHK-MICRON-IR",
          recorded_at: "2026-05-26T00:00:00.000Z"
        }
      ],
      workbench: {
        ...emptyWorkbench(),
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-MICRON", name: "Micron", role: "counterparty" }
        ],
        edges: [edge],
        evidences: [
          evidenceFixture("EV-MATERIALIZED-SINGLE-SOURCE-1", {
            edge_id: "EDGE-MATERIALIZED-SINGLE-SOURCE-1",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        unknown_items: [
          {
            unknown_id: "UNK-EDGE-CORROB-MATERIALIZED",
            scope_kind: "edge",
            scope_id: "EDGE-MATERIALIZED-SINGLE-SOURCE-1",
            question: "Can this edge be corroborated by a second official source?",
            why_unknown: "A single-source disposition was reviewed and materialized after no counterparty official disclosure evidence was found.",
            blocking_data_sources: ["single-source disposition", "counterparty official disclosure"],
            proxies: ["check_target:CHK-MICRON-IR"],
            status: "open"
          }
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.summary.corroboration_queue_with_recorded_disposition).toBe(1);
    expect(report.summary.corroboration_queue_proposed_unknowns).toBe(0);
    expect(report.corroboration_queue[0]).toEqual(
      expect.objectContaining({
        disposition: "single_source_disposition_recorded",
        unknown_ids: ["UNK-EDGE-CORROB-MATERIALIZED"],
        proposed_unknown: null
      })
    );
  });

  it("measures official disclosure coverage against an explicit target node set", () => {
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: [],
      target_nodes: [
        {
          node_id: "ENT-SAMSUNG-ELECTRONICS",
          node_kind: "company",
          name: "Samsung Electronics",
          priority: "P0",
          expected_source_ids: ["samsung-ir"]
        },
        { node_id: "COMP-DRAM", node_kind: "component", priority: "P0", expected_source_ids: ["samsung-ir"] },
        { node_id: "COMP-HBM", node_kind: "component", priority: "P0", expected_source_ids: ["skhynix-ir", "micron-ir"] }
      ],
      source_plan: [officialSourcePlanItem()],
      source_target_coverage: officialSourceTargetCoverage("due"),
      workbench: {
        ...emptyWorkbench(),
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.targets.core_nodes).toBe(3);
    expect(report.summary.target_research_nodes).toBe(3);
    expect(report.summary.target_nodes_missing_official_coverage).toBe(1);
    expect(report.summary.target_nodes_with_runnable_official_targets).toBe(2);
    expect(report.summary.expected_official_source_links).toBe(4);
    expect(report.summary.expected_official_source_links_with_coverage).toBe(2);
    expect(report.summary.expected_official_source_links_runnable).toBe(2);
    expect(report.summary.expected_official_source_links_connector_available).toBe(2);
    expect(report.summary.expected_official_source_links_unimplemented).toBe(0);
    expect(report.expected_source_coverage).toEqual([
      expect.objectContaining({
        node_id: "COMP-HBM",
        expected_source_id: "micron-ir",
        coverage_state: "connector_available"
      }),
      expect.objectContaining({
        node_id: "COMP-HBM",
        expected_source_id: "skhynix-ir",
        coverage_state: "connector_available"
      }),
      expect.objectContaining({
        node_id: "ENT-SAMSUNG-ELECTRONICS",
        expected_source_id: "samsung-ir",
        coverage_state: "official_target_synced"
      }),
      expect.objectContaining({
        node_id: "COMP-DRAM",
        expected_source_id: "samsung-ir",
        coverage_state: "official_target_synced"
      })
    ]);
    expect(report.gates.find((gate) => gate.gate_id === "official_disclosure.core_nodes")).toEqual(
      expect.objectContaining({ measured: 2, target: 3, status: "partial" })
    );
    expect(report.scorecard.data_progress).toBeGreaterThan(0);
    expect(report.scorecard.source_path_progress).toBe(0.5);
    expect(report.gaps.find((gap) => gap.kind === "expected_official_source_coverage")).toEqual(
      expect.objectContaining({
        priority: "P0",
        source_adapters: ["micron-ir", "skhynix-ir"]
      })
    );
    expect(report.nodes.find((node) => node.node_id === "COMP-HBM")).toEqual(
      expect.objectContaining({
        is_target_node: true,
        coverage_state: "missing",
        expected_source_ids: ["micron-ir", "skhynix-ir"]
      })
    );
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Explicit target nodes: 3 supplied; 1 missing");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Expected official source links: 2/4 covered");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("connector_available COMP-HBM via micron-ir");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("[target] COMP-HBM");
  });

  it("keeps built-in research target profiles deterministic and reviewable", () => {
    const profiles = listBuiltInResearchTargetProfiles();
    const profile = getBuiltInResearchTargetProfile("ai-compute-memory.v0");
    const evProfile = getBuiltInResearchTargetProfile("ev-battery-energy.v0");

    expect(profiles.map((item) => item.profile_id)).toEqual(["ai-compute-memory.v0", "ev-battery-energy.v0"]);
    expect(profile.target_nodes).toHaveLength(39);
    expect(evProfile.target_nodes).toHaveLength(24);
    expect(evProfile.target_nodes.find((node) => node.node_id === "ENT-TESLA")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar"] })
    );
    expect(evProfile.target_nodes.find((node) => node.node_id === "COMP-BATTERY-CELL")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar", "company-ir"] })
    );
    expect(evProfile.target_nodes.find((node) => node.node_id === "COMP-LITHIUM-REFINING")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar", "company-ir", "usgs-mcs", "iea-critical-minerals"] })
    );
    const teslaSecTargets = evProfile.target_nodes.find((node) => node.node_id === "ENT-TESLA")?.expected_source_targets ?? [];
    expect(teslaSecTargets.find((target) => target.target_kind === "sec-company-filings")?.target_config).toEqual({
      cik: "0001318605",
      entity_id: "ENT-TESLA",
      form_types: ["10-K", "10-Q", "20-F", "8-K"],
      limit: 3
    });
    expect(profile.target_nodes.find((node) => node.node_id === "ENT-NVIDIA")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "ENT-MICROSOFT")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "ENT-AMAZON")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar"] })
    );
    const nvidiaSecTargets = profile.target_nodes.find((node) => node.node_id === "ENT-NVIDIA")?.expected_source_targets ?? [];
    expect(nvidiaSecTargets.map((target) => target.target_kind).sort()).toEqual(["sec-company-facts", "sec-company-filings"]);
    expect(nvidiaSecTargets.find((target) => target.target_kind === "sec-company-facts")?.target_config).toEqual({
      cik: "0001045810",
      entity_id: "ENT-NVIDIA",
      metrics: ["inventory", "cost_of_revenue", "capital_expenditures", "accounts_payable", "purchase_obligations", "revenue"],
      max_periods: 12
    });
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-SERVER")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["sec-edgar", "company-ir"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-PCB")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["company-ir", "twse-mops", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-CCL")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "twse-mops", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-COPPER-FOIL")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "twse-mops", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-ELECTRONIC-GLASS-CLOTH")).toEqual(
      expect.objectContaining({ priority: "P2", expected_source_ids: ["company-ir", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-LAMINATE-RESIN")).toEqual(
      expect.objectContaining({ priority: "P2", expected_source_ids: ["company-ir", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-CLEANROOM")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-PHOTORESIST")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-SEMICONDUCTOR-EQUIPMENT")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["asml-ir", "company-ir", "sec-edgar", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-TARGET")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-CMP")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-SPECIALTY-GASES")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "edinet"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "COMP-HBM")).toEqual(
      expect.objectContaining({ priority: "P0", expected_source_ids: ["skhynix-ir", "samsung-ir", "micron-ir"] })
    );
    expect(profile.target_nodes.find((node) => node.node_id === "ENT-FOXCONN")).toEqual(
      expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "twse-mops"] })
    );
    const foxconnTarget = profile.target_nodes
      .find((node) => node.node_id === "ENT-FOXCONN")
      ?.expected_source_targets?.find((target) => target.source_id === "twse-mops");
    const waferNode = profile.target_nodes.find((node) => node.node_id === "COMP-SILICON-WAFER");
    const edinetTarget = waferNode?.expected_source_targets?.find((target) => target.source_id === "edinet");

    expect(foxconnTarget).toEqual(
      expect.objectContaining({
        source_id: "twse-mops",
        target_kind: "electronic-documents"
      })
    );
    expect(foxconnTarget?.target_config).toEqual({
      stock_code: "2317",
      entity_id: "ENT-FOXCONN",
      year: 2025,
      document_kind: "F",
      limit: 50
    });
    expect(waferNode).toEqual(expect.objectContaining({ priority: "P1", expected_source_ids: ["company-ir", "edinet"] }));
    expect(edinetTarget).toEqual(
      expect.objectContaining({
        source_id: "edinet",
        target_kind: "daily-filings"
      })
    );
    expect(edinetTarget?.target_config).toEqual({
      date: "2025-06-30",
      type: 2,
      scope_kind: "component",
      scope_id: "COMP-SILICON-WAFER",
      component_id: "COMP-SILICON-WAFER",
      doc_type_codes: ["120"]
    });
  });

  it("reports discovered nodes outside a target profile as expansion candidates", () => {
    const report = buildOfficialDisclosureReadinessReport({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      component_ids: ["COMP-MEMORY"],
      target_nodes: [{ node_id: "ENT-NVIDIA", node_kind: "company", name: "NVIDIA", priority: "P0", expected_source_ids: ["sec-edgar"] }],
      target_profile: {
        profile_id: "fixture-profile",
        title: "Fixture profile",
        version: "0.1.0",
        description: "Fixture profile for expansion testing.",
        selection_reason: "test"
      },
      workbench: {
        ...emptyWorkbench(),
        companies: [
          { entity_id: "ENT-NVIDIA", name: "NVIDIA", role: "root" },
          { entity_id: "ENT-MICRON", name: "Micron", role: "counterparty" }
        ],
        edges: [
          {
            edge_id: "EDGE-MICRON",
            from_id: "ENT-NVIDIA",
            from_name: "NVIDIA",
            to_id: "ENT-MICRON",
            to_name: "Micron",
            relation: "BUYS_FROM",
            component: "memory",
            component_id: "COMP-MEMORY",
            evidence_level: 5,
            confidence: 0.95,
            evidence_ids: ["EV-MICRON"]
          }
        ],
        evidences: [
          evidenceFixture("EV-MICRON", {
            edge_id: "EDGE-MICRON",
            evidence_level: 5,
            source_adapter_id: "sec-edgar",
            source_url: "https://www.sec.gov/Archives/fixture/nvidia-10k.htm",
            cite_text_sha256: "abc123"
          })
        ],
        intelligence: { edge_strengths: [], edge_freshness: [] }
      }
    });

    expect(report.profile_expansion_candidates.map((candidate) => candidate.node_id)).toEqual(["ENT-MICRON", "COMP-MEMORY"]);
    expect(report.profile_expansion_candidates[0]).toEqual(
      expect.objectContaining({
        suggested_priority: "P1",
        reason: "Visible Level 4/5 fact coverage exists outside the current target profile."
      })
    );
    const backlog = buildInvestigationBacklog({
      generated_at: "2026-01-01T00:00:00.000Z",
      company_id: "ENT-NVIDIA",
      workbench: emptyWorkbench(),
      components: [],
      source_plan: [],
      question_readiness: readyQuestionReadiness(),
      official_disclosure_readiness: report
    });
    expect(backlog.items.find((item) => item.kind === "profile_expansion" && item.title.includes("ENT-MICRON"))).toEqual(
      expect.objectContaining({
        priority: "P1",
        title: "Review profile expansion candidate ENT-MICRON"
      })
    );
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("Profile expansion candidates: 2");
    expect(renderOfficialDisclosureReadinessMarkdown(report)).toContain("ENT-MICRON");
  });
});

function officialSignalReviewCandidateFixture(
  reviewId: string,
  status: WorkbenchModel["review_queue"][number]["status"],
  dispositions: WorkbenchModel["review_queue"][number]["dispositions"]
): WorkbenchModel["review_queue"][number] {
  return {
    review_id: reviewId,
    kind: "official_disclosure_signal",
    status,
    title: "Official disclosure signal: SK hynix links results to HBM demand",
    confidence: 0.84,
    source_adapter_id: "skhynix-ir",
    doc_id: "DOC-SKHYNIX-IR",
    source_url: "https://www.skhynix.com/fixture",
    source_locator: "annual-report:page 7",
    source_row_text: "In addition to HBM, demand on conventional memory solutions for servers increased sharply.",
    created_at: "2026-01-01T00:00:00.000Z",
    reviewed_at: null,
    decision_reason: null,
    signal: {
      signal_title: "SK hynix links results to HBM demand",
      evidence_level_hint: 4,
      automatic_fact_mutation_allowed: false
    },
    dispositions
  };
}
