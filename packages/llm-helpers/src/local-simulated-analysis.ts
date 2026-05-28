import {
  AI_ANALYSIS_SCHEMA_VERSION,
  type AiAnalysisArtifact,
  type AiAnalysisConsumerInput,
  type AiAnalysisOfficialEvidenceGapInput,
  type AiAnalysisReasoningInput,
  type AiAnalysisResearchPackManifestInput,
  type BuildLocalAiAnalysisArtifactFromUnknownInput,
  type BuildLocalAiAnalysisArtifactInput
} from "@supplystrata/ai-analysis";

export function buildLocalAiAnalysisArtifact(input: BuildLocalAiAnalysisArtifactInput): AiAnalysisArtifact {
  const stats = input.manifest.stats;
  const sourceMonitoring = input.consumer_read_model.source_monitoring;
  const cannotConclude = input.reasoning_walkthrough.cannot_conclude;
  const blockedLayers = input.reasoning_walkthrough.layers.filter((layer) => layer.status === "blocked_source" || (layer.explicit_unknowns?.count ?? 0) > 0);
  const factLayers = input.reasoning_walkthrough.layers.filter((layer) => (layer.known_facts?.count ?? 0) > 0);
  const inputRefs = collectInputRefs(input.consumer_read_model, input.reasoning_walkthrough);
  const nextActions = input.consumer_read_model.next_actions.top_items.slice(0, 5).map((item) => ({
    title: item.title,
    action: item.recommended_action,
    refs: item.refs
  }));

  return {
    schema_version: AI_ANALYSIS_SCHEMA_VERSION,
    generated_at: input.generated_at,
    mode: "simulated_local_ai_v0",
    scope_id: input.manifest.selected_company_id,
    node_id: "company_context_explanation_v0",
    status: cannotConclude.length > 0 || blockedLayers.length > 0 ? "cannot_conclude" : "succeeded",
    provider: input.provider.provider,
    model: input.provider.model,
    policy: {
      fact_mutation_allowed: false,
      agent_behavior_allowed: false,
      source_connector_allowed: false
    },
    headline: `AI 解读：这版已经有 ${stats.official_disclosure_l4_l5_edges} 条 L4/L5 fact edge；核心价值是把事实、线索、unknown 和 source monitor 状态分开讲清楚。`,
    executive_summary: [
      `当前报告最强的部分是事实层可追溯：${stats.official_disclosure_traceable_edges} 条 traceable edge，${stats.source_target_total_observations} 条 observation 被明确留在上下文层。`,
      `AI 不应把 ${stats.supply_chain_expansion_component_dependency_leads} 条上游 lead 说成已确认关系；它们更适合作为下一轮 source target 或人工 review 的入口。`,
      sourceMonitoring === undefined
        ? "source monitor 摘要未进入 consumer read model，AI 只能根据 reasoning walkthrough 做有限解释。"
        : `source monitor 显示 ${sourceMonitoring.expected_targets} 个 expected target、${sourceMonitoring.synced_targets} 个 synced target、${sourceMonitoring.due_targets} 个 due target；这说明报告已经知道下一步该跑哪里。`
    ],
    key_insights: [
      {
        title: "事实层和研究层已经分开",
        body: `${stats.official_disclosure_l4_l5_edges} 条 L4/L5 edge 可以作为当前事实底座；${stats.supply_chain_expansion_component_dependency_leads} 条 dependency lead 只作为扩展线索。`
      },
      {
        title: "不能下结论的地方被显式列出",
        body:
          cannotConclude.length === 0
            ? "当前 reasoning walkthrough 没有列出全局 cannot_conclude；仍需保守引用 refs。"
            : cannotConclude
                .slice(0, 3)
                .map((item) => item.reason)
                .join(" ")
      },
      {
        title: "下一步行动更像工作队列，不像摘要结尾",
        body:
          nextActions.length === 0 ? "当前 consumer read model 没有列出 next action，AI 只能解释现有边界。" : nextActions.map((item) => item.title).join("；")
      }
    ],
    evidence_boundaries: [
      `${factLayers.length} 个 reasoning layer 有已审查事实输入；${blockedLayers.length} 个 layer 仍被 unknown 或 source 状态阻塞。`,
      "Observation、lead、policy constraint 只能支持解释和排队，不能提升 evidence_level。",
      "AI 输出只能引用现有 evidence/claim/observation/unknown/source target ref，不能创造新 ref。"
    ],
    cannot_conclude: cannotConclude.slice(0, 8).map((item) => `${item.layer_id}: ${item.reason}`),
    next_human_actions: nextActions,
    open_unknowns: input.consumer_read_model.unknowns.top_open.slice(0, 5).map((item) => `${item.unknown_id}: ${item.question}`),
    referenced_refs: inputRefs,
    assumptions: [
      "本地模拟输出用于固定 AI 输出契约和报告体验；配置真实 provider 后仍必须通过同一产物 schema。",
      "AI 不读取网页、不运行 source connector、不写 truth store。"
    ],
    model_metadata: {
      provider_request_id: null,
      prompt_version: "company_context_explanation.local.v0",
      input_contracts: [input.consumer_read_model.contract_id, input.reasoning_walkthrough.walkthrough_id],
      input_refs: inputRefs,
      output_schema_id: "ai_analysis_artifact.v1",
      simulated: true
    },
    quality_lift: {
      before: "上一版 HTML 主要展示指标、表格和队列，需要读者自己拼出叙事。",
      after: qualityLiftAfter(input.manifest, input.previous_manifest)
    }
  };
}

export function buildLocalAiAnalysisArtifactFromUnknown(input: BuildLocalAiAnalysisArtifactFromUnknownInput): AiAnalysisArtifact {
  return buildLocalAiAnalysisArtifact(parseLocalAiAnalysisArtifactInput(input));
}

export function parseLocalAiAnalysisArtifactInput(input: BuildLocalAiAnalysisArtifactFromUnknownInput): BuildLocalAiAnalysisArtifactInput {
  const manifest = parseManifestInput(input.manifest, "manifest");
  const consumer = parseConsumerInput(input.consumer_read_model, "consumer_read_model");
  const reasoning = parseReasoningInput(input.reasoning_walkthrough, "reasoning_walkthrough");
  const previousManifest =
    input.previous_manifest === undefined || input.previous_manifest === null ? undefined : parseManifestInput(input.previous_manifest, "previous_manifest");

  return {
    generated_at: input.generated_at ?? manifest.generated_at,
    provider: input.provider,
    manifest,
    consumer_read_model: consumer,
    reasoning_walkthrough: reasoning,
    ...(previousManifest === undefined ? {} : { previous_manifest: previousManifest })
  };
}

export function collectAllowedAiAnalysisRefs(input: {
  manifest: AiAnalysisResearchPackManifestInput;
  consumer_read_model: AiAnalysisConsumerInput;
  reasoning_walkthrough: AiAnalysisReasoningInput;
}): string[] {
  return collectInputRefs(input.consumer_read_model, input.reasoning_walkthrough);
}

function collectInputRefs(consumer: AiAnalysisConsumerInput, reasoning: AiAnalysisReasoningInput): string[] {
  return uniqueStrings([
    `company:${consumer.company.selected_company_id}`,
    `research_pack:${consumer.research_pack.mode}`,
    ...consumer.unknowns.top_open.map((item) => `unknown:${item.unknown_id}`),
    ...consumer.next_actions.top_items.flatMap((item) => item.refs),
    `company:${reasoning.company_id}`,
    ...reasoning.layers.map((layer) => `reasoning_layer:${layer.layer_id}`),
    ...reasoning.layers.flatMap((layer) => layer.known_facts?.refs ?? []),
    ...reasoning.layers.flatMap((layer) => layer.explicit_unknowns?.refs ?? []),
    ...reasoning.layers.flatMap((layer) => layer.constrained_evidence?.source_target_refs ?? []),
    ...reasoning.layers.flatMap((layer) => layer.constrained_evidence?.observation_refs ?? []),
    ...reasoning.layers.flatMap((layer) => layer.constrained_evidence?.lead_refs ?? [])
  ]);
}

function qualityLiftAfter(current: AiAnalysisResearchPackManifestInput, previous: AiAnalysisResearchPackManifestInput | undefined): string {
  if (previous === undefined) {
    return "加入 AI 解读后，报告先给出事实边界、不能结论和下一步动作，再进入细表；可读性更强，同时不突破证据边界。";
  }
  const targetDelta = (current.stats.official_disclosure_target_nodes ?? 0) - (previous.stats.official_disclosure_target_nodes ?? 0);
  const observationDelta = current.stats.source_target_total_observations - previous.stats.source_target_total_observations;
  const leadDelta = current.stats.supply_chain_expansion_component_dependency_leads - previous.stats.supply_chain_expansion_component_dependency_leads;
  return `和上一版相比，本版多覆盖 ${targetDelta} 个目标节点、${observationDelta} 条 observation、${leadDelta} 条上游 lead；AI 解读把这些变化翻译成“事实边界 + 不能结论 + 下一步动作”。`;
}

function parseManifestInput(value: unknown, label: string): AiAnalysisResearchPackManifestInput {
  const record = requireRecord(value, label);
  const stats = requireRecord(record["stats"], `${label}.stats`);
  return {
    generated_at: requireString(record["generated_at"], `${label}.generated_at`),
    selected_company_id: requireString(record["selected_company_id"], `${label}.selected_company_id`),
    mode: requireString(record["mode"], `${label}.mode`),
    stats: {
      official_disclosure_l4_l5_edges: requireNumber(stats["official_disclosure_l4_l5_edges"], `${label}.stats.official_disclosure_l4_l5_edges`),
      official_disclosure_traceable_edges: requireNumber(stats["official_disclosure_traceable_edges"], `${label}.stats.official_disclosure_traceable_edges`),
      source_target_total_observations: requireNumber(stats["source_target_total_observations"], `${label}.stats.source_target_total_observations`),
      supply_chain_expansion_component_dependency_leads: requireNumber(
        stats["supply_chain_expansion_component_dependency_leads"],
        `${label}.stats.supply_chain_expansion_component_dependency_leads`
      ),
      ...(typeof stats["official_disclosure_target_nodes"] === "number" ? { official_disclosure_target_nodes: stats["official_disclosure_target_nodes"] } : {})
    }
  };
}

function parseConsumerInput(value: unknown, label: string): AiAnalysisConsumerInput {
  const record = requireRecord(value, label);
  const company = requireRecord(record["company"], `${label}.company`);
  const researchPack = requireRecord(record["research_pack"], `${label}.research_pack`);
  const unknowns = requireRecord(record["unknowns"], `${label}.unknowns`);
  const nextActions = requireRecord(record["next_actions"], `${label}.next_actions`);
  const sourceMonitoring = optionalRecord(record["source_monitoring"], `${label}.source_monitoring`);
  return {
    contract_id: requireString(record["contract_id"], `${label}.contract_id`),
    company: {
      selected_company_id: requireString(company["selected_company_id"], `${label}.company.selected_company_id`)
    },
    research_pack: {
      mode: requireString(researchPack["mode"], `${label}.research_pack.mode`)
    },
    ...(sourceMonitoring === undefined
      ? {}
      : {
          source_monitoring: {
            expected_targets: requireNumber(sourceMonitoring["expected_targets"], `${label}.source_monitoring.expected_targets`),
            synced_targets: requireNumber(sourceMonitoring["synced_targets"], `${label}.source_monitoring.synced_targets`),
            due_targets: requireNumber(sourceMonitoring["due_targets"], `${label}.source_monitoring.due_targets`)
          }
        }),
    unknowns: {
      top_open: requireArray(unknowns["top_open"], `${label}.unknowns.top_open`).map((item, index) => {
        const unknown = requireRecord(item, `${label}.unknowns.top_open[${index}]`);
        return {
          unknown_id: requireString(unknown["unknown_id"], `${label}.unknowns.top_open[${index}].unknown_id`),
          question: requireString(unknown["question"], `${label}.unknowns.top_open[${index}].question`)
        };
      })
    },
    next_actions: {
      top_items: requireArray(nextActions["top_items"], `${label}.next_actions.top_items`).map((item, index) => {
        const action = requireRecord(item, `${label}.next_actions.top_items[${index}]`);
        return {
          title: requireString(action["title"], `${label}.next_actions.top_items[${index}].title`),
          recommended_action: requireString(action["recommended_action"], `${label}.next_actions.top_items[${index}].recommended_action`),
          refs: stringArray(action["refs"], `${label}.next_actions.top_items[${index}].refs`)
        };
      })
    }
  };
}

function parseReasoningInput(value: unknown, label: string): AiAnalysisReasoningInput {
  const record = requireRecord(value, label);
  return {
    walkthrough_id: requireString(record["walkthrough_id"], `${label}.walkthrough_id`),
    company_id: requireString(record["company_id"], `${label}.company_id`),
    layers: requireArray(record["layers"], `${label}.layers`).map((item, index) => parseReasoningLayer(item, `${label}.layers[${index}]`)),
    cannot_conclude: requireArray(record["cannot_conclude"], `${label}.cannot_conclude`).map((item, index) => {
      const cannotConclude = requireRecord(item, `${label}.cannot_conclude[${index}]`);
      return {
        layer_id: requireString(cannotConclude["layer_id"], `${label}.cannot_conclude[${index}].layer_id`),
        reason: requireString(cannotConclude["reason"], `${label}.cannot_conclude[${index}].reason`)
      };
    })
  };
}

function parseReasoningLayer(value: unknown, label: string): AiAnalysisReasoningInput["layers"][number] {
  const record = requireRecord(value, label);
  const knownFacts = optionalRefGroup(record["known_facts"], `${label}.known_facts`);
  const explicitUnknowns = optionalRefGroup(record["explicit_unknowns"], `${label}.explicit_unknowns`);
  const constrainedEvidence = optionalRecord(record["constrained_evidence"], `${label}.constrained_evidence`);
  return {
    layer_id: requireString(record["layer_id"], `${label}.layer_id`),
    status: requireString(record["status"], `${label}.status`),
    ...(knownFacts === undefined ? {} : { known_facts: knownFacts }),
    ...(explicitUnknowns === undefined ? {} : { explicit_unknowns: explicitUnknowns }),
    ...(constrainedEvidence === undefined
      ? {}
      : {
          constrained_evidence: {
            source_target_refs: stringArray(constrainedEvidence["source_target_refs"] ?? [], `${label}.constrained_evidence.source_target_refs`),
            observation_refs: stringArray(constrainedEvidence["observation_refs"] ?? [], `${label}.constrained_evidence.observation_refs`),
            lead_refs: stringArray(constrainedEvidence["lead_refs"] ?? [], `${label}.constrained_evidence.lead_refs`),
            official_evidence_gaps: parseOfficialEvidenceGaps(
              constrainedEvidence["official_evidence_gaps"] ?? [],
              `${label}.constrained_evidence.official_evidence_gaps`
            )
          }
        }),
    cannot_conclude: stringArray(record["cannot_conclude"] ?? [], `${label}.cannot_conclude`)
  };
}

function parseOfficialEvidenceGaps(value: unknown, label: string): AiAnalysisOfficialEvidenceGapInput[] {
  return requireArray(value, label).map((item, index) => {
    const gap = requireRecord(item, `${label}[${index}]`);
    return {
      gap_kind: requireString(gap["gap_kind"], `${label}[${index}].gap_kind`),
      target_kind: requireString(gap["target_kind"], `${label}[${index}].target_kind`),
      target_id: requireString(gap["target_id"], `${label}[${index}].target_id`),
      label: requireString(gap["label"], `${label}[${index}].label`),
      recommended_action: requireString(gap["recommended_action"], `${label}[${index}].recommended_action`)
    };
  });
}

function optionalRefGroup(value: unknown, label: string): { count: number; refs?: string[] } | undefined {
  if (value === undefined || value === null) return undefined;
  const record = requireRecord(value, label);
  const refs = stringArray(record["refs"] ?? [], `${label}.refs`);
  return {
    count: requireNumber(record["count"], `${label}.count`),
    ...(refs.length === 0 ? {} : { refs })
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Invalid ${label}: expected object`);
  return value;
}

function optionalRecord(value: unknown, label: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  return requireRecord(value, label);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Invalid ${label}: expected non-empty string`);
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${label}: expected finite number`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return requireArray(value, label).map((item, index) => requireString(item, `${label}[${index}]`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
