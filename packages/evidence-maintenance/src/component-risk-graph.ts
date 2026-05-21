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

export interface TerminalPathRedundancyPath {
  source_entity_id: string;
  terminal_entity_id: string;
  entity_ids: readonly string[];
  edge_ids: readonly string[];
}

export interface TerminalPathRedundancyScore {
  terminal_entity_id: string;
  path_count: number;
  alternate_path_count: number;
  source_entity_ids: readonly string[];
  paths: readonly TerminalPathRedundancyPath[];
}

export interface WeightedTerminalPathRedundancyPath extends TerminalPathRedundancyPath {
  path_weight: number | null;
  missing_weight_edge_ids: readonly string[];
}

export interface WeightedTerminalPathRedundancyScore {
  terminal_entity_id: string;
  path_count: number;
  known_path_count: number;
  alternate_path_count: number;
  weighted_alternate_path_score: number | null;
  known_weighted_alternate_path_score: number | null;
  strongest_path_weight: number | null;
  weight_complete: boolean;
  source_entity_ids: readonly string[];
  missing_weight_edge_ids: readonly string[];
  paths: readonly WeightedTerminalPathRedundancyPath[];
}

export interface WeightedPathCentralityScore {
  entity_id: string;
  raw_score: number;
  normalized_score: number;
  path_count: number;
  contributing_path_edge_ids: readonly string[];
  missing_weight_edge_ids: readonly string[];
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

export function calculateTerminalPathRedundancy(edges: readonly ComponentRiskGraphEdge[]): TerminalPathRedundancyScore[] {
  const routeEdges = dedupeRouteEdges(edges);
  const nodeIds = uniqueSorted(routeEdges.flatMap((edge) => [edge.from_entity_id, edge.to_entity_id]));
  if (nodeIds.length === 0) return [];

  const adjacency = buildEdgeAdjacency(nodeIds, routeEdges);
  const incomingCounts = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const outgoingCounts = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  for (const edge of routeEdges) {
    incomingCounts.set(edge.to_entity_id, (incomingCounts.get(edge.to_entity_id) ?? 0) + 1);
    outgoingCounts.set(edge.from_entity_id, (outgoingCounts.get(edge.from_entity_id) ?? 0) + 1);
  }

  const sources = nodeIds.filter((nodeId) => (incomingCounts.get(nodeId) ?? 0) === 0 && (outgoingCounts.get(nodeId) ?? 0) > 0);
  const terminals = nodeIds.filter((nodeId) => (incomingCounts.get(nodeId) ?? 0) > 0 && (outgoingCounts.get(nodeId) ?? 0) === 0);

  return terminals
    .map((terminalEntityId) => {
      const paths = sources.flatMap((sourceEntityId) => simplePathsToTerminal(sourceEntityId, terminalEntityId, adjacency));
      return {
        terminal_entity_id: terminalEntityId,
        path_count: paths.length,
        alternate_path_count: Math.max(0, paths.length - 1),
        source_entity_ids: uniqueSorted(paths.map((path) => path.source_entity_id)),
        paths
      };
    })
    .filter((score) => score.path_count > 0)
    .sort((left, right) => right.alternate_path_count - left.alternate_path_count || left.terminal_entity_id.localeCompare(right.terminal_entity_id));
}

export function calculateWeightedTerminalPathRedundancy(edges: readonly WeightedComponentRiskGraphEdge[]): WeightedTerminalPathRedundancyScore[] {
  const routeEdges = dedupeWeightedRouteEdges(edges);
  const unweightedScores = calculateTerminalPathRedundancy(routeEdges);
  const weightByEdgeId = new Map(routeEdges.map((edge) => [edge.edge_id, edge.weight]));
  return unweightedScores.map((score) => {
    const paths = score.paths.map((path) => {
      const missingWeightEdgeIds = path.edge_ids.filter((edgeId) => weightByEdgeId.get(edgeId) === undefined);
      return {
        ...path,
        path_weight: missingWeightEdgeIds.length === 0 ? roundSix(product(path.edge_ids.map((edgeId) => weightByEdgeId.get(edgeId) ?? 0))) : null,
        missing_weight_edge_ids: missingWeightEdgeIds
      };
    });
    const knownPathWeights = paths.flatMap((path) => (path.path_weight === null ? [] : [path.path_weight]));
    const strongestPathWeight = knownPathWeights.length === 0 ? null : Math.max(...knownPathWeights);
    const knownWeightedAlternatePathScore = strongestPathWeight === null ? null : roundSix(sum(knownPathWeights) - strongestPathWeight);
    const missingWeightEdgeIds = uniqueSorted(paths.flatMap((path) => path.missing_weight_edge_ids));
    const weightComplete = missingWeightEdgeIds.length === 0;
    return {
      terminal_entity_id: score.terminal_entity_id,
      path_count: score.path_count,
      known_path_count: knownPathWeights.length,
      alternate_path_count: score.alternate_path_count,
      weighted_alternate_path_score: weightComplete ? knownWeightedAlternatePathScore : null,
      known_weighted_alternate_path_score: knownWeightedAlternatePathScore,
      strongest_path_weight: strongestPathWeight === null ? null : roundSix(strongestPathWeight),
      weight_complete: weightComplete,
      source_entity_ids: score.source_entity_ids,
      missing_weight_edge_ids: missingWeightEdgeIds,
      paths
    };
  });
}

export function calculateWeightedPathCentrality(edges: readonly WeightedComponentRiskGraphEdge[]): WeightedPathCentralityScore[] {
  const terminalScores = calculateWeightedTerminalPathRedundancy(edges);
  const rawScores = new Map<string, number>();
  const pathCounts = new Map<string, number>();
  const contributingPathEdgeIds = new Map<string, Set<string>>();
  const missingWeightEdgeIds = uniqueSorted(terminalScores.flatMap((score) => score.missing_weight_edge_ids));
  let totalKnownPathWeight = 0;

  for (const terminalScore of terminalScores) {
    for (const path of terminalScore.paths) {
      if (path.path_weight === null) continue;
      totalKnownPathWeight += path.path_weight;
      for (const entityId of path.entity_ids.slice(1, -1)) {
        rawScores.set(entityId, (rawScores.get(entityId) ?? 0) + path.path_weight);
        pathCounts.set(entityId, (pathCounts.get(entityId) ?? 0) + 1);
        const edgeIds = contributingPathEdgeIds.get(entityId) ?? new Set<string>();
        for (const edgeId of path.edge_ids) edgeIds.add(edgeId);
        contributingPathEdgeIds.set(entityId, edgeIds);
      }
    }
  }

  return [...rawScores.entries()]
    .map(([entityId, rawScore]) => ({
      entity_id: entityId,
      raw_score: roundSix(rawScore),
      normalized_score: totalKnownPathWeight === 0 ? 0 : roundSix(rawScore / totalKnownPathWeight),
      path_count: pathCounts.get(entityId) ?? 0,
      contributing_path_edge_ids: [...(contributingPathEdgeIds.get(entityId) ?? new Set<string>())].sort(),
      missing_weight_edge_ids: missingWeightEdgeIds
    }))
    .filter((score) => score.raw_score > 0)
    .sort((left, right) => right.normalized_score - left.normalized_score || left.entity_id.localeCompare(right.entity_id));
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

function simplePathsToTerminal(
  sourceEntityId: string,
  terminalEntityId: string,
  adjacency: ReadonlyMap<string, readonly ComponentRiskGraphEdge[]>
): TerminalPathRedundancyPath[] {
  const paths: TerminalPathRedundancyPath[] = [];
  const stack: Array<{
    entity_id: string;
    entity_ids: readonly string[];
    edge_ids: readonly string[];
    visited_entity_ids: ReadonlySet<string>;
  }> = [{ entity_id: sourceEntityId, entity_ids: [sourceEntityId], edge_ids: [], visited_entity_ids: new Set([sourceEntityId]) }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (current.entity_id === terminalEntityId && current.edge_ids.length > 0) {
      paths.push({
        source_entity_id: sourceEntityId,
        terminal_entity_id: terminalEntityId,
        entity_ids: current.entity_ids,
        edge_ids: current.edge_ids
      });
      continue;
    }
    const nextEdges = adjacency.get(current.entity_id) ?? [];
    for (const edge of [...nextEdges].reverse()) {
      if (current.visited_entity_ids.has(edge.to_entity_id)) continue;
      const visitedEntityIds = new Set(current.visited_entity_ids);
      visitedEntityIds.add(edge.to_entity_id);
      stack.push({
        entity_id: edge.to_entity_id,
        entity_ids: [...current.entity_ids, edge.to_entity_id],
        edge_ids: [...current.edge_ids, edge.edge_id],
        visited_entity_ids: visitedEntityIds
      });
    }
  }

  return paths.sort((left, right) => left.edge_ids.join("\u0000").localeCompare(right.edge_ids.join("\u0000")));
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

function dedupeRouteEdges(edges: readonly ComponentRiskGraphEdge[]): ComponentRiskGraphEdge[] {
  const byRoute = new Map<string, ComponentRiskGraphEdge>();
  for (const edge of edges) {
    const key = `${edge.from_entity_id}\u0000${edge.to_entity_id}`;
    const previous = byRoute.get(key);
    if (previous === undefined || edge.edge_id.localeCompare(previous.edge_id) < 0) byRoute.set(key, edge);
  }
  return [...byRoute.values()].sort(
    (left, right) =>
      left.from_entity_id.localeCompare(right.from_entity_id) ||
      left.to_entity_id.localeCompare(right.to_entity_id) ||
      left.edge_id.localeCompare(right.edge_id)
  );
}

function dedupeWeightedRouteEdges(edges: readonly WeightedComponentRiskGraphEdge[]): WeightedComponentRiskGraphEdge[] {
  const byRoute = new Map<string, WeightedComponentRiskGraphEdge>();
  for (const edge of edges) {
    const key = `${edge.from_entity_id}\u0000${edge.to_entity_id}`;
    const previous = byRoute.get(key);
    if (previous === undefined || compareWeightedRouteEdge(edge, previous) < 0) byRoute.set(key, edge);
  }
  return [...byRoute.values()].sort(
    (left, right) =>
      left.from_entity_id.localeCompare(right.from_entity_id) ||
      left.to_entity_id.localeCompare(right.to_entity_id) ||
      left.edge_id.localeCompare(right.edge_id)
  );
}

function compareWeightedRouteEdge(left: WeightedComponentRiskGraphEdge, right: WeightedComponentRiskGraphEdge): number {
  if (left.weight !== undefined && right.weight === undefined) return -1;
  if (left.weight === undefined && right.weight !== undefined) return 1;
  if (left.weight !== undefined && right.weight !== undefined && left.weight !== right.weight) return right.weight - left.weight;
  return left.edge_id.localeCompare(right.edge_id);
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

function product(values: readonly number[]): number {
  return values.reduce((total, value) => total * value, 1);
}

function roundSix(value: number): number {
  return Number(value.toFixed(6));
}
