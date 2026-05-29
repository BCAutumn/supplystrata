/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true }
    },
    {
      name: "core-must-not-depend-on-outer-packages",
      severity: "error",
      from: { path: "^packages/core/src" },
      to: { path: "^(packages|apps)/", pathNot: "^packages/core/src" }
    },
    {
      name: "sources-must-not-depend-on-db-or-graph",
      severity: "error",
      from: { path: "^packages/sources/" },
      to: { path: "^packages/(db|graph|graph-builder)/" }
    },
    {
      name: "extractor-must-not-depend-on-storage",
      severity: "error",
      from: { path: "^packages/relation-extractor/" },
      to: { path: "^packages/(db|graph|graph-builder)/" }
    },
    {
      name: "chain-view-model-must-stay-pure",
      severity: "error",
      from: { path: "^packages/chain-view/src" },
      to: { path: "^packages/(db|component-context|graph|graph-builder)/|^node_modules/pg" }
    },
    {
      name: "render-must-stay-pure",
      severity: "error",
      from: { path: "^packages/render/src" },
      to: { path: "^packages/(db|chain-view-builder|card-builder|component-context|graph|graph-builder)/|^node_modules/pg" }
    },
    {
      name: "source-adapter-spec-must-stay-pure",
      severity: "error",
      from: { path: "^packages/source-adapter-spec/src" },
      to: { path: "^packages/(config|object-store|source-adapter-runtime)/|^node_modules/(pino|pg)" }
    },
    {
      name: "source-adapter-runtime-must-not-own-env-or-store",
      severity: "error",
      from: { path: "^packages/source-adapter-runtime/src" },
      to: { path: "^packages/(config|object-store)/" }
    },
    {
      name: "pipeline-must-not-depend-on-concrete-source-adapters",
      severity: "error",
      from: { path: "^packages/pipeline/src" },
      to: { path: "^packages/sources/" }
    },
    {
      name: "fact-and-derived-writers-must-not-import-llm-helpers",
      severity: "error",
      from: {
        path: "^packages/(pipeline|graph-builder|claim-builder|review-store|evidence-maintenance|observation-store)/src"
      },
      to: { path: "^packages/llm-helpers/src" }
    },
    {
      name: "dynamic-profile-derive-must-stay-plan-context-only",
      severity: "error",
      from: { path: "^packages/research-pack/src/research-target-profile-derive\\.ts$" },
      to: { path: "^packages/(db|claim-builder|graph-builder|evidence-maintenance|observation-store|review-store|source-monitor)/src" }
    },
    {
      name: "llm-helpers-must-not-depend-on-ai-analysis-domain",
      severity: "error",
      from: { path: "^packages/llm-helpers/src" },
      to: { path: "^packages/ai-analysis/src" }
    },
    {
      name: "workspace-packages-must-not-depend-on-reference-agent",
      severity: "error",
      from: { path: "^packages/(?!agent/).*?/src" },
      to: { path: "^packages/agent/src" }
    },
    {
      name: "reference-agent-must-use-mcp-not-core-writers",
      severity: "error",
      from: { path: "^packages/agent/src" },
      to: { path: "^packages/(api-orchestration|db|pipeline|graph-builder|claim-builder|review-store|source-workflows|source-monitor)/src" }
    },
    {
      name: "apps-mcp-must-not-depend-on-apps-api",
      severity: "error",
      from: { path: "^apps/mcp/src" },
      to: { path: "^apps/api/src" }
    },
    {
      name: "apps-mcp-db-runtime-must-enter-through-api-orchestration",
      severity: "error",
      from: { path: "^apps/mcp/src" },
      to: {
        path: "^packages/(source-workflows|source-monitor|pipeline|review-store|graph-builder|claim-builder|card-builder|research-pack|ai-analysis|llm-helpers)/src"
      }
    },
    {
      name: "production-code-must-not-import-test-fixtures",
      severity: "error",
      from: { path: "^(apps|packages|scripts)/" },
      to: { path: "^tests/fixtures/" }
    },
    {
      name: "graph-builder-must-use-graph-store-interface",
      severity: "error",
      from: { path: "^packages/graph-builder/src" },
      to: { path: "^packages/graph/src" }
    },
    {
      name: "apps-cli-must-not-use-concrete-source-adapters-directly",
      severity: "warn",
      from: { path: "^apps/cli/src" },
      to: { path: "^packages/sources/" }
    }
  ],
  options: {
    exclude: { path: "(^|/)dist/" },
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.typecheck.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "node", "default"]
    }
  }
};
