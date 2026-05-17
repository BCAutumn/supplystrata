import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { WorkbenchModel } from "@supplystrata/workbench-export";

export interface Point {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  name: string;
  kind: string;
  point: Point;
}

export interface LayoutSegment {
  segment: ChainViewSegmentModel;
  from: Point;
  to: Point;
}

export interface ChainLayout {
  nodes: LayoutNode[];
  segments: LayoutSegment[];
  width: number;
  height: number;
}

export function layoutWorkbench(model: WorkbenchModel): ChainLayout {
  const nodesById = new Map<string, LayoutNode>();
  const root = model.chain.root;
  nodesById.set(root.id, {
    id: root.id,
    name: root.name,
    kind: root.kind,
    point: { x: 130, y: 120 }
  });

  let companyLane = 0;
  let contextLane = 0;
  for (const segment of model.chain_segments) {
    ensureEndpoint(nodesById, segment.from, root.id, companyLane, contextLane);
    if (!nodesById.has(segment.to.id)) {
      if (segment.to.kind === "company") {
        companyLane += 1;
      } else {
        contextLane += 1;
      }
    }
    ensureEndpoint(nodesById, segment.to, root.id, companyLane, contextLane);
  }

  const segments = model.chain_segments.map((segment) => ({
    segment,
    from: pointFor(nodesById, segment.from.id),
    to: pointFor(nodesById, segment.to.id)
  }));
  return {
    nodes: [...nodesById.values()],
    segments,
    width: 1200,
    height: Math.max(720, 220 + Math.max(companyLane, contextLane) * 90)
  };
}

function ensureEndpoint(
  nodesById: Map<string, LayoutNode>,
  endpoint: { kind: string; id: string; name: string },
  rootId: string,
  companyLane: number,
  contextLane: number
): void {
  if (nodesById.has(endpoint.id)) return;
  const isRoot = endpoint.id === rootId;
  const x = isRoot ? 130 : endpoint.kind === "company" ? 520 + Math.min(companyLane, 3) * 170 : 900;
  const y = isRoot ? 120 : endpoint.kind === "company" ? 100 + companyLane * 88 : 110 + contextLane * 74;
  nodesById.set(endpoint.id, {
    id: endpoint.id,
    name: endpoint.name,
    kind: endpoint.kind,
    point: { x, y }
  });
}

function pointFor(nodesById: Map<string, LayoutNode>, nodeId: string): Point {
  const node = nodesById.get(nodeId);
  if (node === undefined) throw new Error(`Layout node missing: ${nodeId}`);
  return node.point;
}
