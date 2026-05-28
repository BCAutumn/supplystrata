import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("research HTML renderer", () => {
  it("renders simulated AI analysis and comparison from a minimal research pack", async () => {
    const root = await mkdtemp(join(tmpdir(), "supplystrata-html-"));
    try {
      const current = join(root, "current");
      const previous = join(root, "previous");
      const output = join(root, "report.html");
      await writePack(current, packFixture({ observations: 4, progress: 0.7, withConsumer: true }));
      await writePack(previous, packFixture({ observations: 1, progress: 0.5, withConsumer: false }));

      await execFileAsync("node", ["scripts/render-research-html.mjs", current, output, previous], { cwd: process.cwd() });

      const html = await readFile(output, "utf8");
      expect(html).toContain("AI Analyst");
      expect(html).toContain("综合判断");
      expect(html).toContain("Cannot conclude");
      expect(html).toContain("上一版没有 AI analysis artifact");
      expect(html).toContain("多覆盖 0 个目标节点、3 条 observation");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prefers an existing ai-analysis artifact over renderer fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "supplystrata-html-ai-"));
    try {
      const current = join(root, "current");
      const output = join(root, "report.html");
      await writePack(
        current,
        packFixture({
          observations: 4,
          progress: 0.7,
          withConsumer: true,
          ai: {
            schema_version: "1.0.0",
            generated_at: "2026-05-27T00:00:00.000Z",
            mode: "simulated_local_ai_v0",
            scope_id: "ENT-NVIDIA",
            node_id: "company_context_explanation_v0",
            status: "cannot_conclude",
            provider: "none",
            model: null,
            policy: {
              fact_mutation_allowed: false,
              agent_behavior_allowed: false,
              source_connector_allowed: false
            },
            headline: "来自 ai-analysis.json 的固定产物",
            executive_summary: ["artifact summary"],
            key_insights: [{ title: "artifact insight", body: "renderer should not replace this" }],
            evidence_boundaries: ["artifact boundary"],
            cannot_conclude: ["artifact cannot conclude"],
            next_human_actions: [{ title: "artifact action", action: "review fixed artifact", refs: ["source_target:sec-edgar:nvidia"] }],
            open_unknowns: [],
            referenced_refs: ["source_target:sec-edgar:nvidia"],
            assumptions: [],
            model_metadata: {
              provider_request_id: null,
              prompt_version: "company_context_explanation.local.v0",
              input_contracts: ["gate8_lite_consumer_read_model.v0"],
              input_refs: ["source_target:sec-edgar:nvidia"],
              output_schema_id: "ai_analysis_artifact.v1",
              simulated: true
            },
            quality_lift: {
              before: "before",
              after: "artifact quality lift"
            }
          }
        })
      );

      await execFileAsync("node", ["scripts/render-research-html.mjs", current, output], { cwd: process.cwd() });

      const html = await readFile(output, "utf8");
      expect(html).toContain("来自 ai-analysis.json 的固定产物");
      expect(html).toContain("artifact quality lift");
      expect(html).not.toContain("这版已经有 8 条 L4/L5 fact edge");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function writePack(dir: string, pack: ResearchHtmlPackFixture): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeJson(dir, "manifest.json", pack.manifest),
    writeJson(dir, "official-disclosure-readiness.json", pack.readiness),
    writeJson(dir, "supply-chain-expansion-plan.json", pack.expansion),
    writeJson(dir, "gate1-data-depth-workbench.json", pack.workbench),
    writeJson(dir, "gate1-run-ledger.json", pack.ledger),
    writeJson(dir, "source-target-coverage.json", { schema_version: "1.0.0" }),
    writeJson(dir, "propagation-readiness.json", pack.propagation),
    writeJson(dir, "question-readiness.json", pack.questions),
    ...(pack.consumer === null ? [] : [writeJson(dir, "consumer-read-model.json", pack.consumer)]),
    ...(pack.reasoning === null ? [] : [writeJson(dir, "reasoning-walkthrough.json", pack.reasoning)]),
    ...(pack.ai === null ? [] : [writeJson(dir, "ai-analysis.json", pack.ai)])
  ]);
}

async function writeJson(dir: string, file: string, value: unknown): Promise<void> {
  await writeFile(join(dir, file), JSON.stringify(value, null, 2), "utf8");
}

interface ResearchHtmlPackFixture {
  manifest: Record<string, unknown>;
  readiness: Record<string, unknown>;
  expansion: Record<string, unknown>;
  workbench: Record<string, unknown>;
  ledger: Record<string, unknown>;
  propagation: Record<string, unknown>;
  questions: Record<string, unknown>;
  consumer: Record<string, unknown> | null;
  reasoning: Record<string, unknown> | null;
  ai: Record<string, unknown> | null;
}

function packFixture(input: { observations: number; progress: number; withConsumer: boolean; ai?: Record<string, unknown> }): ResearchHtmlPackFixture {
  const stats = {
    official_disclosure_target_nodes: 39,
    official_disclosure_l4_l5_edges: 8,
    official_disclosure_traceable_edges: 8,
    official_disclosure_expected_source_links: 12,
    official_disclosure_expected_source_links_with_coverage: 5,
    source_target_total_observations: input.observations,
    source_target_targets_with_observations: 2,
    supply_chain_expansion_component_dependency_leads: 6,
    supply_chain_expansion_leads_with_fact_capable_source_path: 3,
    supply_chain_expansion_leads_with_fact_coverage: 0,
    gate1_data_depth_adjacent_official_fact_edges: 2,
    gate1_data_depth_adjacent_official_fact_companies: 2,
    gate1_data_depth_p0: 1,
    gate1_data_depth_items: 2,
    gate1_data_depth_fact_edge_gap: 4,
    official_disclosure_corroboration_ratio: 0.25,
    unknown_items: 1,
    runnable_suggested_targets: 4,
    official_disclosure_gate1_overall_progress: input.progress
  };
  return {
    manifest: {
      schema_version: "1.0.0",
      mode: "truth_store",
      generated_at: "2026-05-27T00:00:00.000Z",
      depth: 3,
      selected_company_id: "ENT-NVIDIA",
      research_target_profile: { title: "AI compute memory", target_nodes: 39 },
      stats
    },
    readiness: {
      scorecard: {
        criteria: [
          {
            label: "L4/L5 coverage",
            status: "partial",
            progress: input.progress,
            measured: 8,
            target: 12,
            rationale: "fixture"
          }
        ]
      },
      edges: [
        {
          from_name: "NVIDIA",
          to_name: "TSMC",
          relation: "USES_FOUNDRY",
          component_id: "COMP-WAFER",
          evidence_level: 5,
          source_adapters: ["sec-edgar"],
          traceability_state: "traceable",
          corroboration_state: "single_source",
          has_freshness: true,
          has_strength: false
        }
      ]
    },
    expansion: {
      component_dependency_leads: [
        {
          parent_component_id: "COMP-HBM",
          target_name: "Advanced packaging",
          category: "process",
          source_path_authority: "fact_capable",
          state: "source_path_runnable",
          expansion_policy: "lead_only_no_fact_mutation",
          source_ids: ["sec-edgar"]
        }
      ]
    },
    workbench: {
      summary: {
        fact_edge_gap_to_target: 4,
        adjacent_official_fact_edges: 2,
        source_blockers: 1,
        entity_context_items: 1,
        strength_missing_edges: 1,
        observation_labeling_batch: 1
      },
      items: []
    },
    ledger: {
      scorecard: {
        status: "partial",
        overall_progress: input.progress,
        data_progress: input.progress,
        source_path_progress: 0.5,
        l4_l5_fact_edge_target: 12
      },
      source_path_progress: {
        expected_source_links: 12,
        synced_targets: 5,
        retry_wait_targets: 1,
        targets_with_observations: 2
      },
      data_progress: {
        corroboration_queue_recorded_disposition: 1
      },
      monitoring_config: {
        batches: []
      },
      action_queue: [
        {
          title: "Run official source target",
          priority: "P0",
          rationale: "Official evidence missing.",
          command_hint: "pnpm cli sources check"
        }
      ]
    },
    propagation: {
      items: [
        {
          title: "Compute to server",
          question: "Can compute demand be traced?",
          status: "partial",
          confidence: 0.5,
          policy: "reasoning_input_only_no_fact_mutation"
        }
      ]
    },
    questions: {
      items: [
        {
          question: "Who supplies HBM?",
          status: "partial",
          confidence: 0.6,
          missing_requirements: ["second source"]
        }
      ]
    },
    consumer: input.withConsumer
      ? {
          contract_id: "gate8_lite_consumer_read_model.v0",
          company: {
            selected_company_id: "ENT-NVIDIA"
          },
          research_pack: {
            mode: "truth_store"
          },
          source_monitoring: {
            expected_targets: 12,
            synced_targets: 5,
            due_targets: 2
          },
          unknowns: {
            top_open: [{ unknown_id: "UNK-1", question: "Need second source?" }]
          },
          next_actions: {
            top_items: [
              {
                title: "Run SEC target",
                recommended_action: "Run target before conclusion.",
                refs: ["source_target:sec-edgar:nvidia"]
              }
            ]
          }
        }
      : null,
    reasoning: input.withConsumer
      ? {
          walkthrough_id: "gate8_lite_reasoning_walkthrough.v0",
          company_id: "ENT-NVIDIA",
          layers: [
            {
              layer_id: "compute_to_server",
              status: "unknown_open",
              known_facts: { count: 0 },
              explicit_unknowns: { count: 1, refs: ["unknown:UNK-1"] },
              constrained_evidence: {
                source_target_refs: ["source_target:sec-edgar:nvidia"],
                observation_refs: [],
                lead_refs: []
              },
              cannot_conclude: ["Cannot claim a relationship without reviewed evidence."]
            }
          ],
          cannot_conclude: [
            {
              layer_id: "compute_to_server",
              reason: "Cannot claim a relationship without reviewed evidence."
            }
          ]
        }
      : null,
    ai: input.ai ?? null
  };
}
