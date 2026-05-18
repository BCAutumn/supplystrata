import type { ChainViewSegmentModel } from "@supplystrata/chain-view";
import { createInitialState, selectSegment, type WorkbenchState } from "./app-state.js";
import { createChainCanvas } from "./canvas/chain-canvas.js";
import { loadWorkbenchModelFromFile, loadWorkbenchModelFromUrl } from "./data/load-report.js";
import { renderChangesTimeline } from "./panels/changes-timeline.js";
import { renderDraftClaimsPanel } from "./panels/draft-claims-panel.js";
import { renderEvidencePanel } from "./panels/evidence-panel.js";
import { renderSourceHealthPanel } from "./panels/source-health-panel.js";
import { renderUnknownPanel } from "./panels/unknown-panel.js";

let state: WorkbenchState = createInitialState();
let nextLoadId = 0;
let activeLoad: LoadToken | null = null;

const canvas = requireElement("chain-canvas", HTMLCanvasElement);
const fileInput = requireElement("report-file", HTMLInputElement);
const title = requireElement("workbench-title", HTMLHeadingElement);
const loadStatus = requireElement("load-status", HTMLParagraphElement);
const summary = requireElement("summary-strip", HTMLDivElement);
const inspectorPanel = requireElement("inspector-panel", HTMLElement);
const draftClaimsPanel = requireElement("draft-claims-panel", HTMLElement);
const unknownPanel = requireElement("unknown-panel", HTMLElement);
const sourceHealthPanel = requireElement("source-health-panel", HTMLElement);
const changesPanel = requireElement("changes-panel", HTMLElement);

const chainCanvas = createChainCanvas(canvas, {
  onSegmentSelect(segmentIndex) {
    state = selectSegment(state, segmentIndex);
    render();
  }
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file === undefined) return;
  void loadFromFile(file);
});

render();

const initialReportUrl = reportUrlFromLocation(window.location);
if (initialReportUrl !== null) {
  void loadFromUrl(initialReportUrl);
}

async function loadFromFile(file: File): Promise<void> {
  const token = beginLoad();
  try {
    loadStatus.textContent = `Loading ${file.name}...`;
    const model = await loadWorkbenchModelFromFile(file, token.controller.signal);
    if (!isActiveLoad(token)) return;
    setModel(model);
    loadStatus.textContent = `Loaded ${file.name}`;
  } catch (error) {
    if (isActiveLoad(token) && !isAbortError(error)) showLoadError(error);
  }
}

async function loadFromUrl(reportUrl: string): Promise<void> {
  const token = beginLoad();
  try {
    loadStatus.textContent = `Loading ${reportUrl}...`;
    const model = await loadWorkbenchModelFromUrl(reportUrl, token.controller.signal);
    if (!isActiveLoad(token)) return;
    setModel(model);
    loadStatus.textContent = `Loaded ${reportUrl}`;
  } catch (error) {
    if (isActiveLoad(token) && !isAbortError(error)) showLoadError(error);
  }
}

function setModel(model: WorkbenchState["model"]): void {
  state = {
    model,
    selectedSegmentIndex: null
  };
  render();
}

function render(): void {
  const model = state.model;
  const segment = selectedSegment(state);
  if (model !== null) {
    title.textContent = `${model.chain.root.name} Supply Chain`;
    summary.innerHTML = [
      metric("Fact edges", model.chain.stats.fact_edges),
      metric("Claims", model.chain.stats.claims),
      metric("Draft claims", model.draft_claims.length),
      metric("Observations", model.chain.stats.observations),
      metric("Leads", model.chain.stats.leads),
      metric("Unknowns", model.chain.stats.unknowns)
    ].join("");
    chainCanvas.render(model, state.selectedSegmentIndex);
  } else {
    title.textContent = "公开供应链情报网";
    summary.innerHTML = `<span class="muted">Run <code>pnpm cli workbench export --company nvidia --out reports/nvidia-workbench.json</code>, then load the JSON here.</span>`;
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f7f9fc";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#667085";
      ctx.font = "16px ui-sans-serif, system-ui";
      ctx.fillText("Load a workbench JSON export to render the chain canvas.", 40, 60);
    }
  }
  renderEvidencePanel(inspectorPanel, model, segment);
  renderDraftClaimsPanel(draftClaimsPanel, model);
  renderUnknownPanel(unknownPanel, model);
  renderSourceHealthPanel(sourceHealthPanel, model);
  renderChangesTimeline(changesPanel, model);
}

function showLoadError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown load error";
  loadStatus.textContent = "Load failed";
  inspectorPanel.innerHTML = `<h2>Load failed</h2><p class="error">${escapeHtml(message)}</p>`;
}

interface LoadToken {
  id: number;
  controller: AbortController;
}

function beginLoad(): LoadToken {
  activeLoad?.controller.abort();
  const token = {
    id: nextLoadId + 1,
    controller: new AbortController()
  };
  nextLoadId = token.id;
  activeLoad = token;
  return token;
}

function isActiveLoad(token: LoadToken): boolean {
  return activeLoad?.id === token.id;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function selectedSegment(stateValue: WorkbenchState): ChainViewSegmentModel | null {
  if (stateValue.model === null || stateValue.selectedSegmentIndex === null) return null;
  return stateValue.model.chain_segments[stateValue.selectedSegmentIndex] ?? null;
}

function reportUrlFromLocation(location: Location): string | null {
  const url = new URL(location.href);
  const reportUrl = url.searchParams.get("report");
  if (reportUrl === null || reportUrl.trim() === "") return null;
  return reportUrl;
}

function metric(label: string, value: number): string {
  return `<span class="metric"><strong>${value}</strong>${escapeHtml(label)}</span>`;
}

function requireElement<T extends HTMLElement>(id: string, ctor: { new (...args: never[]): T }): T {
  const element = document.getElementById(id);
  if (element instanceof ctor) return element;
  throw new Error(`Missing required element: ${id}`);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
