export interface ComponentRiskGraphEdge {
  edge_id: string;
  from_entity_id: string;
  to_entity_id: string;
}

export interface WeightedComponentRiskGraphEdge extends ComponentRiskGraphEdge {
  weight?: number;
}

export interface BetweennessCentralityScore {
  entity_id: string;
  raw_score: number;
  normalized_score: number;
}

export interface ReachabilityScore {
  entity_id: string;
  reachable_entity_ids: readonly string[];
  reachable_edge_ids: readonly string[];
}

export interface WeightedReachabilityScore {
  entity_id: string;
  weighted_score: number;
  reachable_entity_ids: readonly string[];
  weighted_entity_impacts: readonly WeightedEntityImpact[];
  contributing_edge_ids: readonly string[];
  missing_weight_edge_ids: readonly string[];
}

export interface WeightedEntityImpact {
  entity_id: string;
  impact_score: number;
  path_edge_ids: readonly string[];
}

export function calculateDirectedReachability(edges: readonly ComponentRiskGraphEdge[]): ReachabilityScore[] {
  const nodeIds = uniqueSorted(edges.flatMap((edge) => [edge.from_entity_id, edge.to_entity_id]));
  const adjacency = buildEdgeAdjacency(nodeIds, edges);
  return nodeIds
    .map((entityId) => reachableFrom(entityId, adjacency))
    .filter((score) => score.reachable_entity_ids.length > 0)
    .sort((left, right) => right.reachable_entity_ids.length - left.reachable_entity_ids.length || left.entity_id.localeCompare(right.entity_id));
}

export function calculateWeightedReachability(edges: readonly WeightedComponentRiskGraphEdge[]): WeightedReachabilityScore[] {
  const nodeIds = uniqueSorted(edges.flatMap((edge) => [edge.from_entity_id, edge.to_entity_id]));
  const adjacency = buildEdgeAdjacency(nodeIds, edges);
  return nodeIds
    .map((entityId) => weightedReachableFrom(entityId, adjacency))
    .filter((score) => score.reachable_entity_ids.length > 0 || score.missing_weight_edge_ids.length > 0)
    .sort((left, right) => right.weighted_score - left.weighted_score || left.entity_id.localeCompare(right.entity_id));
}

export function calculateBetweennessCentrality(edges: readonly ComponentRiskGraphEdge[]): BetweennessCentralityScore[] {
  const nodeIds = uniqueSorted(edges.flatMap((edge) => [edge.from_entity_id, edge.to_entity_id]));
  if (nodeIds.length < 3) return [];

  const adjacency = buildAdjacency(nodeIds, edges);
  const scores = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  for (const source of nodeIds) {
    const state = shortestPathState(source, nodeIds, adjacency);
    const dependency = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
    for (const node of [...state.stack].reverse()) {
      for (const predecessor of state.predecessors.get(node) ?? []) {
        const predecessorPaths = state.pathCounts.get(predecessor) ?? 0;
        const nodePaths = state.pathCounts.get(node) ?? 0;
        if (nodePaths === 0) continue;
        dependency.set(predecessor, (dependency.get(predecessor) ?? 0) + (predecessorPaths / nodePaths) * (1 + (dependency.get(node) ?? 0)));
      }
      if (node !== source) scores.set(node, (scores.get(node) ?? 0) + (dependency.get(node) ?? 0));
    }
  }

  const normalization = (nodeIds.length - 1) * (nodeIds.length - 2);
  return nodeIds
    .map((entityId) => {
      const rawScore = scores.get(entityId) ?? 0;
      return {
        entity_id: entityId,
        raw_score: roundSix(rawScore),
        normalized_score: roundSix(normalization === 0 ? 0 : rawScore / normalization)
      };
    })
    .filter((score) => score.raw_score > 0)
    .sort((left, right) => right.normalized_score - left.normalized_score || left.entity_id.localeCompare(right.entity_id));
}

function reachableFrom(source: string, adjacency: ReadonlyMap<string, readonly ComponentRiskGraphEdge[]>): ReachabilityScore {
  const reachedEntities = new Set<string>();
  const reachedEdges = new Set<string>();
  const visited = new Set<string>([source]);
  const queue: string[] = [source];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const edge of adjacency.get(current) ?? []) {
      reachedEdges.add(edge.edge_id);
      if (edge.to_entity_id !== source) reachedEntities.add(edge.to_entity_id);
      if (visited.has(edge.to_entity_id)) continue;
      visited.add(edge.to_entity_id);
      queue.push(edge.to_entity_id);
    }
  }
  return {
    entity_id: source,
    reachable_entity_ids: [...reachedEntities].sort(),
    reachable_edge_ids: [...reachedEdges].sort()
  };
}

function weightedReachableFrom(source: string, adjacency: ReadonlyMap<string, readonly WeightedComponentRiskGraphEdge[]>): WeightedReachabilityScore {
  const bestByEntityId = new Map<string, WeightedEntityImpact>();
  const missingWeightEdgeIds = new Set<string>();
  const queue: Array<{ entity_id: string; impact_score: number; path_edge_ids: readonly string[] }> = [
    { entity_id: source, impact_score: 1, path_edge_ids: [] }
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const edge of adjacency.get(current.entity_id) ?? []) {
      if (edge.to_entity_id === source) continue;
      if (edge.weight === undefined) {
        missingWeightEdgeIds.add(edge.edge_id);
        continue;
      }
      const impactScore = roundSix(current.impact_score * edge.weight);
      if (impactScore <= 0) continue;
      const previous = bestByEntityId.get(edge.to_entity_id);
      if (previous !== undefined && previous.impact_score >= impactScore) continue;
      const pathEdgeIds = [...current.path_edge_ids, edge.edge_id];
      const impact: WeightedEntityImpact = {
        entity_id: edge.to_entity_id,
        impact_score: impactScore,
        path_edge_ids: pathEdgeIds
      };
      bestByEntityId.set(edge.to_entity_id, impact);
      queue.push(impact);
    }
  }

  const weightedEntityImpacts = [...bestByEntityId.values()].sort(
    (left, right) => right.impact_score - left.impact_score || left.entity_id.localeCompare(right.entity_id)
  );
  const contributingEdgeIds = uniqueSorted(weightedEntityImpacts.flatMap((impact) => impact.path_edge_ids));
  return {
    entity_id: source,
    weighted_score: roundSix(sum(weightedEntityImpacts.map((impact) => impact.impact_score))),
    reachable_entity_ids: weightedEntityImpacts.map((impact) => impact.entity_id).sort(),
    weighted_entity_impacts: weightedEntityImpacts,
    contributing_edge_ids: contributingEdgeIds,
    missing_weight_edge_ids: [...missingWeightEdgeIds].sort()
  };
}

function buildEdgeAdjacency<TEdge extends ComponentRiskGraphEdge>(nodeIds: readonly string[], edges: readonly TEdge[]): Map<string, TEdge[]> {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, [] as TEdge[]]));
  for (const edge of edges) {
    const group = adjacency.get(edge.from_entity_id) ?? [];
    if (!group.some((item) => item.edge_id === edge.edge_id)) group.push(edge);
    adjacency.set(edge.from_entity_id, group);
  }
  for (const [nodeId, group] of adjacency.entries()) {
    adjacency.set(
      nodeId,
      group.sort((left, right) => left.to_entity_id.localeCompare(right.to_entity_id) || left.edge_id.localeCompare(right.edge_id))
    );
  }
  return adjacency;
}

function shortestPathState(
  source: string,
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>
): {
  stack: string[];
  predecessors: Map<string, string[]>;
  pathCounts: Map<string, number>;
} {
  const stack: string[] = [];
  const queue: string[] = [source];
  const predecessors = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  const distances = new Map(nodeIds.map((nodeId) => [nodeId, -1]));
  const pathCounts = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  distances.set(source, 0);
  pathCounts.set(source, 1);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    stack.push(current);
    for (const next of adjacency.get(current) ?? []) {
      if ((distances.get(next) ?? -1) < 0) {
        queue.push(next);
        distances.set(next, (distances.get(current) ?? 0) + 1);
      }
      if ((distances.get(next) ?? -1) === (distances.get(current) ?? 0) + 1) {
        pathCounts.set(next, (pathCounts.get(next) ?? 0) + (pathCounts.get(current) ?? 0));
        const group = predecessors.get(next) ?? [];
        group.push(current);
        predecessors.set(next, group);
      }
    }
  }

  return { stack, predecessors, pathCounts };
}

function buildAdjacency(nodeIds: readonly string[], edges: readonly ComponentRiskGraphEdge[]): Map<string, string[]> {
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  for (const edge of edges) {
    const group = adjacency.get(edge.from_entity_id) ?? [];
    if (!group.includes(edge.to_entity_id)) group.push(edge.to_entity_id);
    adjacency.set(edge.from_entity_id, group);
  }
  for (const [nodeId, group] of adjacency.entries()) {
    adjacency.set(nodeId, group.sort());
  }
  return adjacency;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}
