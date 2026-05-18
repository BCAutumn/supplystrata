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
      name: "graph-builder-must-use-graph-store-interface",
      severity: "error",
      from: { path: "^packages/graph-builder/src" },
      to: { path: "^packages/graph/src" }
    },
    {
      name: "apps-cli-uses-render-and-pipeline-not-sources-directly",
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
