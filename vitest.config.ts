import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@supplystrata/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@supplystrata/config": resolve(__dirname, "packages/config/src/index.ts"),
      "@supplystrata/claim-builder": resolve(__dirname, "packages/claim-builder/src/index.ts"),
      "@supplystrata/chain-view": resolve(__dirname, "packages/chain-view/src/index.ts"),
      "@supplystrata/db": resolve(__dirname, "packages/db/src/index.ts"),
      "@supplystrata/entity-import": resolve(__dirname, "packages/entity-import/src/index.ts"),
      "@supplystrata/entity-source": resolve(__dirname, "packages/entity-source/src/index.ts"),
      "@supplystrata/entity-resolver": resolve(__dirname, "packages/entity-resolver/src/index.ts"),
      "@supplystrata/evidence-maintenance": resolve(__dirname, "packages/evidence-maintenance/src/index.ts"),
      "@supplystrata/evidence-scorer": resolve(__dirname, "packages/evidence-scorer/src/index.ts"),
      "@supplystrata/evidence-trace": resolve(__dirname, "packages/evidence-trace/src/index.ts"),
      "@supplystrata/graph": resolve(__dirname, "packages/graph/src/index.ts"),
      "@supplystrata/graph-builder": resolve(__dirname, "packages/graph-builder/src/index.ts"),
      "@supplystrata/object-store": resolve(__dirname, "packages/object-store/src/index.ts"),
      "@supplystrata/observability": resolve(__dirname, "packages/observability/src/index.ts"),
      "@supplystrata/parsers-html": resolve(__dirname, "packages/parsers/html/src/index.ts"),
      "@supplystrata/parsers-pdf": resolve(__dirname, "packages/parsers/pdf/src/index.ts"),
      "@supplystrata/parsers-text": resolve(__dirname, "packages/parsers/text/src/index.ts"),
      "@supplystrata/pipeline": resolve(__dirname, "packages/pipeline/src/index.ts"),
      "@supplystrata/relation-extractor-rule": resolve(__dirname, "packages/relation-extractor/rule/src/index.ts"),
      "@supplystrata/render": resolve(__dirname, "packages/render/src/index.ts"),
      "@supplystrata/review-candidates": resolve(__dirname, "packages/review-candidates/src/index.ts"),
      "@supplystrata/review-store": resolve(__dirname, "packages/review-store/src/index.ts"),
      "@supplystrata/source-adapter-spec": resolve(__dirname, "packages/source-adapter-spec/src/index.ts"),
      "@supplystrata/signal-extractor": resolve(__dirname, "packages/signal-extractor/src/index.ts"),
      "@supplystrata/source-monitor": resolve(__dirname, "packages/source-monitor/src/index.ts"),
      "@supplystrata/source-normalizers": resolve(__dirname, "packages/source-normalizers/src/index.ts"),
      "@supplystrata/source-registry": resolve(__dirname, "packages/source-registry/src/index.ts"),
      "@supplystrata/supplier-list": resolve(__dirname, "packages/supplier-list/src/index.ts"),
      "@supplystrata/sources-apple-suppliers": resolve(__dirname, "packages/sources/apple-suppliers/src/index.ts"),
      "@supplystrata/sources-asml-ir": resolve(__dirname, "packages/sources/asml-ir/src/index.ts"),
      "@supplystrata/sources-companies-house": resolve(__dirname, "packages/sources/companies-house/src/index.ts"),
      "@supplystrata/sources-opencorporates": resolve(__dirname, "packages/sources/opencorporates/src/index.ts"),
      "@supplystrata/sources-samsung-ir": resolve(__dirname, "packages/sources/samsung-ir/src/index.ts"),
      "@supplystrata/sources-sec-edgar": resolve(__dirname, "packages/sources/sec-edgar/src/index.ts"),
      "@supplystrata/sources-skhynix-ir": resolve(__dirname, "packages/sources/skhynix-ir/src/index.ts"),
      "@supplystrata/sources-tsmc-ir": resolve(__dirname, "packages/sources/tsmc-ir/src/index.ts")
    }
  },
  test: {
    environment: "node"
  }
});
