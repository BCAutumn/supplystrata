import { performance } from "node:perf_hooks";

import type { ScbomDocument, ScbomEntity, ScbomEvidence, ScbomObject, ScbomRelationship } from "@scbom/spec";
import { createScbomView, type ScbomViewGraphNode } from "@supplystrata/web";
import { toScbomDocument } from "@supplystrata/workbench-export";
import { describe, expect, it } from "vitest";

import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("SCBOM graph layout", () => {
  it("keeps L0 graph layout deterministic and collision-aware", () => {
    const document = graphFixture(36);
    const first = createScbomView(document).graph;
    const second = createScbomView(document).graph;

    expect(first).toEqual(second);
    expect(hasNodeOverlap(first.nodes)).toBe(false);
    expect(hasLabelOverlap(first.nodes)).toBe(false);
    expect(first.bounds.width).toBeGreaterThan(120);
    expect(first.bounds.height).toBeGreaterThan(120);
  });

  it("keeps larger overview layouts bounded enough for synchronous viewer rendering", () => {
    const startedAt = performance.now();
    const graph = createScbomView(graphFixture(180)).graph;
    const elapsedMs = performance.now() - startedAt;

    expect(graph.nodes).toHaveLength(180);
    expect(graph.edges).toHaveLength(179);
    expect(hasNodeOverlap(graph.nodes)).toBe(false);
    // 这条是全量测试里的回归哨兵，不是微基准；Vitest worker 竞争下墙钟会比单测单跑更抖。
    expect(elapsedMs).toBeLessThan(3_000);
  });
});

function hasNodeOverlap(nodes: readonly ScbomViewGraphNode[]): boolean {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      if (right === undefined) continue;
      const minDistance = left.size + right.size + 2;
      if (distance(left.x, left.y, right.x, right.y) < minDistance) return true;
    }
  }
  return false;
}

function hasLabelOverlap(nodes: readonly ScbomViewGraphNode[]): boolean {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      if (right === undefined) continue;
      if (labelOverlapArea(left, right) > 0) return true;
    }
  }
  return false;
}

function labelOverlapArea(left: ScbomViewGraphNode, right: ScbomViewGraphNode): number {
  const overlapX = Math.max(0, Math.min(labelRight(left), labelRight(right)) - Math.max(labelLeft(left), labelLeft(right)));
  const overlapY = Math.max(0, Math.min(labelBottom(left), labelBottom(right)) - Math.max(labelTop(left), labelTop(right)));
  return overlapX * overlapY;
}

function graphFixture(nodeCount: number): ScbomDocument {
  const document = toScbomDocument(workbenchScbomFixture());
  const root = findEntity(document, "ENT-NVIDIA");
  const counterparty = findEntity(document, "ENT-TSMC");
  const evidence = findEvidence(document);
  const relationship = findRelationship(document);
  const entities: ScbomEntity[] = [
    root,
    ...Array.from({ length: nodeCount - 1 }, (_, index) => ({
      ...counterparty,
      id: `ENT-SUPPLIER-${String(index + 1).padStart(3, "0")}`,
      name: `Supplier ${String(index + 1).padStart(3, "0")}`
    }))
  ];
  const relationships: ScbomRelationship[] = entities.slice(1).map((entity, index) => ({
    ...relationship,
    id: `EDGE-NVIDIA-SUPPLIER-${String(index + 1).padStart(3, "0")}`,
    subject_ref: root.id,
    object_ref: entity.id,
    evidence_refs: [evidence.id]
  }));
  const objects: ScbomObject[] = [evidence, ...entities, ...relationships];
  return { ...document, objects };
}

function findEntity(document: ScbomDocument, id: string): ScbomEntity {
  const entity = document.objects.find((object): object is ScbomEntity => object.object_type === "entity" && object.id === id);
  if (entity === undefined) throw new Error(`Missing fixture entity ${id}`);
  return entity;
}

function findEvidence(document: ScbomDocument): ScbomEvidence {
  const evidence = document.objects.find((object): object is ScbomEvidence => object.object_type === "evidence");
  if (evidence === undefined) throw new Error("Missing fixture evidence");
  return evidence;
}

function findRelationship(document: ScbomDocument): ScbomRelationship {
  const relationship = document.objects.find((object): object is ScbomRelationship => object.object_type === "relationship");
  if (relationship === undefined) throw new Error("Missing fixture relationship");
  return relationship;
}

function distance(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return Math.hypot(leftX - rightX, leftY - rightY);
}

function labelLeft(node: ScbomViewGraphNode): number {
  return node.label_x - node.label_width / 2;
}

function labelRight(node: ScbomViewGraphNode): number {
  return node.label_x + node.label_width / 2;
}

function labelTop(node: ScbomViewGraphNode): number {
  return node.label_y - 14;
}

function labelBottom(node: ScbomViewGraphNode): number {
  return node.label_y + 2;
}
