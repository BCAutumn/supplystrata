import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScbomDocument } from "@scbom/spec";

const COMPONENT_BUNDLE_PATH = join(process.cwd(), "packages/web/dist/components.iife.js");

export interface AgentHtmlArtifactInput {
  readonly title: string;
  readonly markdown: string;
  readonly scbomDocument: ScbomDocument;
  readonly componentBundle?: string;
}

export async function writeAgentHtmlArtifact(path: string, input: AgentHtmlArtifactInput): Promise<void> {
  const componentBundle = input.componentBundle ?? (await readFile(COMPONENT_BUNDLE_PATH, "utf8"));
  await writeFile(path, renderAgentHtmlArtifact({ ...input, componentBundle }), "utf8");
}

export function renderAgentHtmlArtifact(input: Required<AgentHtmlArtifactInput>): string {
  const documentJson = JSON.stringify(input.scbomDocument);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(input.title)}</title>
    <style>
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f8fafc; color: #18202a; }
      main { max-width: 1180px; margin: 0 auto; padding: 24px; display: grid; gap: 16px; }
      pre { white-space: pre-wrap; background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 16px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(input.title)}</h1>
      <pre>${escapeHtml(input.markdown)}</pre>
      <scbom-evidence-view></scbom-evidence-view>
      <scbom-unknown-map></scbom-unknown-map>
      <scbom-supply-chain-graph></scbom-supply-chain-graph>
    </main>
    <script>${input.componentBundle}</script>
    <script type="application/json" id="scbom-document">${escapeScriptJson(documentJson)}</script>
    <script>
      window.ScbomViewer.registerScbomComponents();
      const scbomDocument = JSON.parse(document.getElementById("scbom-document").textContent);
      for (const element of document.querySelectorAll("scbom-evidence-view, scbom-unknown-map, scbom-supply-chain-graph")) {
        element.scbomDocument = scbomDocument;
      }
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
}

function escapeScriptJson(value: string): string {
  return value
    .replace(/</gu, "\\u003c")
    .replace(/\u2028/gu, "\\u2028")
    .replace(/\u2029/gu, "\\u2029");
}
