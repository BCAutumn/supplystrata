import {
  listComponentHsCodes,
  listComponentMaterialObservationTargets,
  listComponentUpstreamLeads,
  type ComponentUpstreamLead
} from "@supplystrata/component-context";
import type {
  SourcePlanContext,
  SourcePlanDraft,
  SourcePlanForComponentsInput,
  SourcePlanItem,
  SourcePlanOfficialDisclosureTargetNode,
  TradeObservationContext
} from "./definitions.js";
import { aggregateDrafts, requireSource } from "./source-plan-aggregation.js";
import { createContext, tradeObservationInput } from "./context.js";
import { officialDisclosureSourceIdsForNode, officialDisclosureTargetReason } from "./official-disclosure-targets.js";
import { sourceIdsForLead, sourceMatchesContext, sourceReason } from "./source-plan-rules.js";

export * from "./definitions.js";

// 这里是二/三级链路寻找免费数据源的唯一规划入口；它只返回计划，不抓取、不落库、不升级事实边。
export function planSourcesForComponents(input: SourcePlanForComponentsInput): SourcePlanItem[] {
  const drafts: SourcePlanDraft[] = [];
  const maxTierDepth = input.maxTierDepth ?? 3;
  const context = createContext(input);
  const taxonomyComponentIds = new Set(input.component_ids);
  for (const componentId of input.component_ids) {
    for (const lead of listComponentUpstreamLeads(componentId, maxTierDepth)) {
      taxonomyComponentIds.add(lead.parent_component_id);
      taxonomyComponentIds.add(lead.target_id);
      drafts.push(...draftsForLead(lead, context));
    }
  }
  if (context.tradeObservation !== undefined) drafts.push(...draftsForTradeTaxonomy([...taxonomyComponentIds]));
  if (context.materialObservation !== undefined) drafts.push(...draftsForMaterialTaxonomy([...taxonomyComponentIds]));
  drafts.push(...draftsForOfficialDisclosureTargetNodes(context.officialDisclosureTargetNodes));
  return aggregateDrafts(drafts, context);
}

export function planSourcesForComponent(
  componentId: string,
  maxTierDepth = 3,
  entityIds: readonly string[] = [],
  tradeObservation?: TradeObservationContext
): SourcePlanItem[] {
  return planSourcesForComponents({
    component_ids: [componentId],
    maxTierDepth,
    entity_ids: entityIds,
    ...tradeObservationInput(tradeObservation)
  });
}

export function planSourcesForComponentLead(lead: ComponentUpstreamLead, entityIds: readonly string[] = []): SourcePlanItem[] {
  return aggregateDrafts(draftsForLead(lead, createContext({ entity_ids: entityIds })));
}

function draftsForLead(lead: ComponentUpstreamLead, context: SourcePlanContext): SourcePlanDraft[] {
  return sourceIdsForLead(lead).flatMap((sourceId) => {
    // 计划层引用的来源必须先登记到 source registry；未登记来源静默消失会让研究计划看起来“正常但缺数据”。
    requireSource(sourceId);
    if (!sourceMatchesContext(sourceId, context)) return [];
    return [
      {
        sourceId,
        parentComponentId: lead.parent_component_id,
        targetId: lead.target_id,
        dependencyId: lead.dependency_id,
        reason: `${lead.title}: ${sourceReason(sourceId, lead)}`
      }
    ];
  });
}

function draftsForTradeTaxonomy(componentIds: readonly string[]): SourcePlanDraft[] {
  return componentIds.flatMap((componentId) => {
    if (listComponentHsCodes(componentId).length === 0) return [];
    requireSource("census-trade");
    return [
      {
        sourceId: "census-trade",
        parentComponentId: componentId,
        targetId: componentId,
        dependencyId: `trade-taxonomy:${componentId}`,
        reason: `${componentId}: Census Trade can create observation-only HS proxy checks from component trade taxonomy`
      }
    ];
  });
}

function draftsForMaterialTaxonomy(componentIds: readonly string[]): SourcePlanDraft[] {
  const drafts: SourcePlanDraft[] = [];
  for (const componentId of componentIds) {
    for (const item of listComponentMaterialObservationTargets(componentId)) {
      requireSource(item.target.source_adapter_id);
      drafts.push({
        sourceId: item.target.source_adapter_id,
        parentComponentId: componentId,
        targetId: item.material.material_id,
        dependencyId: `material-taxonomy:${componentId}:${item.material.material_id}`,
        reason: `${componentId} exposes ${item.material.name}: ${item.target.reason}`
      });
    }
  }
  return drafts;
}

function draftsForOfficialDisclosureTargetNodes(targetNodes: readonly SourcePlanOfficialDisclosureTargetNode[]): SourcePlanDraft[] {
  const drafts: SourcePlanDraft[] = [];
  for (const node of targetNodes) {
    const sourceIds = officialDisclosureSourceIdsForNode(node);
    for (const sourceId of sourceIds) {
      requireSource(sourceId);
      drafts.push({
        sourceId,
        parentComponentId: node.node_kind === "component" ? node.node_id : null,
        targetId: node.node_id,
        dependencyId: `official-target:${node.node_id}:${sourceId}`,
        reason: officialDisclosureTargetReason(node, sourceId)
      });
    }
  }
  return drafts;
}
