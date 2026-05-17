import type { ChainLayout, Point } from "./layout.js";

export function hitTestSegment(layout: ChainLayout, point: Point): number | null {
  let best: { index: number; distance: number } | null = null;
  for (let index = 0; index < layout.segments.length; index += 1) {
    const segment = layout.segments[index];
    if (segment === undefined) continue;
    const distance = distanceToSegment(point, segment.from, segment.to);
    if (distance > 14) continue;
    if (best === null || distance < best.distance) best = { index, distance };
  }
  return best?.index ?? null;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
