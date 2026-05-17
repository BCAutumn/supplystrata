import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import type { ChainLayout, LayoutNode, LayoutSegment } from "./layout.js";

const NODE_WIDTH = 150;
const NODE_HEIGHT = 48;

export function drawChain(ctx: CanvasRenderingContext2D, layout: ChainLayout, selectedSegmentIndex: number | null): void {
  ctx.clearRect(0, 0, layout.width, layout.height);
  drawBackground(ctx, layout);
  layout.segments.forEach((segment, index) => drawSegment(ctx, segment, selectedSegmentIndex === index));
  for (const node of layout.nodes) drawNode(ctx, node);
}

function drawBackground(ctx: CanvasRenderingContext2D, layout: ChainLayout): void {
  ctx.fillStyle = "#f7f9fc";
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = "#536173";
  ctx.font = "700 13px ui-sans-serif, system-ui";
  ctx.fillText("Fact edge lane", 36, 42);
  ctx.fillText("Observation / lead / unknown context", 830, 42);
  ctx.strokeStyle = "#d7dee8";
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(805, 24);
  ctx.lineTo(805, layout.height - 24);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSegment(ctx: CanvasRenderingContext2D, item: LayoutSegment, selected: boolean): void {
  ctx.save();
  const style = styleForSegment(item.segment, selected);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.width;
  ctx.setLineDash(style.dash);
  ctx.beginPath();
  ctx.moveTo(item.from.x, item.from.y);
  const midX = (item.from.x + item.to.x) / 2;
  ctx.bezierCurveTo(midX, item.from.y, midX, item.to.y, item.to.x, item.to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  drawArrow(ctx, item.to.x, item.to.y, style.color);
  drawSegmentLabel(ctx, item.segment, item.from.x, item.from.y, item.to.x, item.to.y, style.color);
  ctx.restore();
}

function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 9, y - 5);
  ctx.lineTo(x - 9, y + 5);
  ctx.closePath();
  ctx.fill();
}

function drawSegmentLabel(ctx: CanvasRenderingContext2D, segment: ChainViewSegmentModel, x1: number, y1: number, x2: number, y2: number, color: string): void {
  const label = segment.component ?? segment.relation;
  ctx.fillStyle = color;
  ctx.font = "700 11px ui-sans-serif, system-ui";
  ctx.fillText(label, (x1 + x2) / 2 - 34, (y1 + y2) / 2 - 8);
}

function drawNode(ctx: CanvasRenderingContext2D, node: LayoutNode): void {
  const x = node.point.x - NODE_WIDTH / 2;
  const y = node.point.y - NODE_HEIGHT / 2;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = node.kind === "component" ? "#97a3b6" : "#bac4d4";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, NODE_WIDTH, NODE_HEIGHT, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#17212b";
  ctx.font = "800 13px ui-sans-serif, system-ui";
  ctx.fillText(fitText(node.name, 18), x + 12, y + 21);
  ctx.fillStyle = "#667085";
  ctx.font = "11px ui-sans-serif, system-ui";
  ctx.fillText(`${node.kind} · ${node.id}`, x + 12, y + 38);
}

function styleForSegment(segment: ChainViewSegmentModel, selected: boolean): { color: string; width: number; dash: number[] } {
  const width = selected ? 4 : 2;
  if (segment.semantic_layer === "edge") return { color: "#2758c4", width, dash: [] };
  if (segment.semantic_layer === "claim") return { color: "#0f766e", width, dash: [6, 6] };
  if (segment.semantic_layer === "observation") return { color: "#7a8699", width, dash: [3, 5] };
  if (segment.semantic_layer === "lead") return { color: "#9a5b13", width, dash: [8, 6] };
  return { color: "#b42318", width, dash: [2, 6] };
}

function fitText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
