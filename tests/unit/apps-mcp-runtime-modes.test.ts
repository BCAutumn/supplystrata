import { describe, expect, it } from "vitest";

import { createMcpRuntime, MCP_RUNTIME_FIXTURE, requireMcpDbPostgresUrl } from "@supplystrata/mcp";

describe("apps/mcp runtime modes", () => {
  it("defaults fixture runtime to injected handlers without DB access", async () => {
    const runtime = createMcpRuntime(MCP_RUNTIME_FIXTURE);

    try {
      expect(runtime.mode).toBe(MCP_RUNTIME_FIXTURE);
      expect(runtime.serverOptions.handlers?.["getCompanyCard"]).toBeTypeOf("function");
      expect(runtime.serverOptions.writeExecutors?.run_source_check).toBeTypeOf("function");
    } finally {
      await runtime.close();
    }
  });

  it("fails fast when db runtime has no explicit POSTGRES_URL", () => {
    expect(() => requireMcpDbPostgresUrl(undefined)).toThrow("MCP --runtime=db requires POSTGRES_URL");
    expect(() => requireMcpDbPostgresUrl("")).toThrow("MCP --runtime=db requires POSTGRES_URL");
  });
});
