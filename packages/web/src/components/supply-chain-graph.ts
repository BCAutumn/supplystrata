import Graph from "graphology";
import { css, html, svg, type CSSResultGroup, type PropertyValues, type SVGTemplateResult, type TemplateResult } from "lit";
import type Sigma from "sigma";
import type { ScbomViewGraphEdge, ScbomViewGraphNode } from "../definitions/scbom-view.js";
import { ScbomBaseElement } from "./base.js";

type SigmaNodeAttributes = {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly size: number;
  readonly color: string;
} & Record<string, unknown>;

type SigmaEdgeAttributes = {
  readonly label: string;
  readonly size: number;
  readonly color: string;
} & Record<string, unknown>;

export class ScbomSupplyChainGraphElement extends ScbomBaseElement {
  static override properties = {
    ...ScbomBaseElement.properties,
    rendererStatus: { state: true }
  };

  static override styles: CSSResultGroup = [
    ScbomBaseElement.styles,
    css`
      [part="graph-canvas"] {
        height: 460px;
        min-height: 460px;
        border: 1px solid var(--scbom-color-border);
        border-radius: var(--scbom-radius);
        background: #f8fafc;
      }

      [part="graph-fallback"] {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin-top: 12px;
      }

      [part="graph-list-title"] {
        margin: 0 0 6px;
        font-size: 13px;
      }

      [part="graph-svg"] {
        box-sizing: border-box;
        width: 100%;
        height: 420px;
        min-height: 420px;
        margin-top: 12px;
        border: 1px solid var(--scbom-color-border);
        border-radius: var(--scbom-radius);
        background: #f8fafc;
      }

      [part="graph-svg-edge"] {
        stroke: #98a2b3;
        stroke-width: 1.8;
      }

      [part="graph-svg-node"] {
        fill: #2563eb;
        stroke: #ffffff;
        stroke-width: 2;
      }

      [part="graph-svg-label"] {
        fill: var(--scbom-color-text);
        font-size: 11px;
        font-weight: 650;
        paint-order: stroke;
        stroke: #ffffff;
        stroke-width: 3;
      }
    `
  ];

  private renderer: Sigma<SigmaNodeAttributes, SigmaEdgeAttributes> | undefined = undefined;
  protected rendererStatus: "idle" | "sigma" | "fallback" = "idle";

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    super.willUpdate(changedProperties);
    if (changedProperties.has("scbomDocument")) this.rendererStatus = this.scbomDocument === undefined ? "idle" : canUseWebGl() ? "sigma" : "fallback";
  }

  protected override updated(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has("scbomDocument") && this.rendererStatus === "sigma") void this.syncRenderer();
  }

  override disconnectedCallback(): void {
    this.killRenderer();
    super.disconnectedCallback();
  }

  protected override render(): TemplateResult {
    const graph = this.view?.graph;
    return this.renderSurface(
      "Supply chain graph",
      html`
        <p part="status">
          ${graph?.nodes.length ?? 0} entities / ${graph?.edges.length ?? 0} relationships. Evidence and unknowns remain in their dedicated views.
        </p>
        ${this.renderSvgGraph(graph?.nodes ?? [], graph?.edges ?? [])}
        <div part="graph-canvas" data-renderer=${this.rendererStatus}></div>
        <div part="graph-fallback">${this.renderFallbackNodes(graph?.nodes ?? [])}${this.renderFallbackEdges(graph?.edges ?? [])}</div>
      `
    );
  }

  private renderSvgGraph(nodes: readonly ScbomViewGraphNode[], edges: readonly ScbomViewGraphEdge[]): SVGTemplateResult {
    const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
    const bounds = this.view?.graph.bounds ?? { min_x: -240, min_y: -220, width: 480, height: 440 };
    return svg`
      <svg part="graph-svg" viewBox="${bounds.min_x} ${bounds.min_y} ${bounds.width} ${bounds.height}" role="img" aria-label="SCBOM relationship graph">
        <defs>
          <marker id="scbom-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="#98a2b3"></path>
          </marker>
        </defs>
        ${edges.map((edge) => this.renderSvgEdge(edge, nodeLookup))}
        ${nodes.map((node) => this.renderSvgNode(node))}
      </svg>
    `;
  }

  private renderSvgEdge(edge: ScbomViewGraphEdge, nodeLookup: ReadonlyMap<string, ScbomViewGraphNode>): SVGTemplateResult {
    const source = nodeLookup.get(edge.source);
    const target = nodeLookup.get(edge.target);
    if (source === undefined || target === undefined) return svg``;
    return svg`
      <line
        part="graph-svg-edge"
        x1=${source.x}
        y1=${source.y}
        x2=${target.x}
        y2=${target.y}
        marker-end="url(#scbom-arrowhead)"
      ></line>
    `;
  }

  private renderSvgNode(node: ScbomViewGraphNode): SVGTemplateResult {
    return svg`
      <circle part="graph-svg-node" cx=${node.x} cy=${node.y} r=${node.size}></circle>
      <text part="graph-svg-label" text-anchor="middle" x=${node.label_x} y=${node.label_y}>${shortLabel(node.label)}</text>
    `;
  }

  private renderFallbackNodes(nodes: readonly ScbomViewGraphNode[]): TemplateResult {
    return html`
      <section>
        <h3 part="graph-list-title">Entities</h3>
        <ul part="graph-node-list">
          ${nodes.map((node) => html`<li data-node-id=${node.id}>${node.label}</li>`)}
        </ul>
      </section>
    `;
  }

  private renderFallbackEdges(edges: readonly ScbomViewGraphEdge[]): TemplateResult {
    return html`
      <section>
        <h3 part="graph-list-title">Relationships</h3>
        <ul part="graph-edge-list">
          ${edges.map((edge) => html`<li data-edge-id=${edge.id}>${edge.label}</li>`)}
        </ul>
      </section>
    `;
  }

  private async syncRenderer(): Promise<void> {
    this.killRenderer();
    const graph = this.view?.graph;
    const container = this.renderRoot.querySelector<HTMLElement>('[part="graph-canvas"]');
    if (graph === undefined || container === null) return;

    const { default: SigmaRenderer } = await import("sigma");
    this.renderer = new SigmaRenderer(buildSigmaGraph(graph.nodes, graph.edges), container, {
      allowInvalidContainer: true,
      renderEdgeLabels: true
    });
  }

  private killRenderer(): void {
    this.renderer?.kill();
    this.renderer = undefined;
  }
}

export function defineScbomSupplyChainGraphElement(registry: CustomElementRegistry = defaultRegistry()): void {
  if (registry.get("scbom-supply-chain-graph") === undefined) registry.define("scbom-supply-chain-graph", ScbomSupplyChainGraphElement);
}

function buildSigmaGraph(nodes: readonly ScbomViewGraphNode[], edges: readonly ScbomViewGraphEdge[]): Graph<SigmaNodeAttributes, SigmaEdgeAttributes> {
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>({ type: "directed", multi: true });
  for (const node of nodes) {
    graph.addNode(node.id, {
      x: node.x,
      y: node.y,
      label: node.label,
      size: node.size,
      color: "#2563eb"
    });
  }
  for (const edge of edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
        label: edge.label,
        size: 1,
        color: "#667085"
      });
    }
  }
  return graph;
}

function canUseWebGl(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
}

function shortLabel(label: string): string {
  return label.length > 18 ? `${label.slice(0, 15)}...` : label;
}

function defaultRegistry(): CustomElementRegistry {
  if (globalThis.customElements === undefined) throw new Error("customElements registry is not available");
  return globalThis.customElements;
}
