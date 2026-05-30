import { createDbApiOperationHandlers } from "@supplystrata/api-orchestration";
import { loadEnv, requireEnvValue } from "@supplystrata/config";
import { createDatabaseStore } from "@supplystrata/db/write";

import type { McpRuntime, McpRuntimeMode, McpRuntimeOptions } from "../definitions/mcp-runtime.js";
import { MCP_RUNTIME_DB, MCP_RUNTIME_FIXTURE } from "../definitions/mcp-runtime.js";
import { loadCommunityPackBaselineOrWarn, withCommunityPackBaseline } from "../functions/community-pack-baseline.js";
import { createFixtureApiOperationHandlers, createFixtureWriteExecutors, MCP_FIXTURE_NOW } from "../functions/fixture-mcp-runtime.js";

export function createMcpRuntime(mode: McpRuntimeMode, options: McpRuntimeOptions = {}): McpRuntime {
  const communityPack = options.packPath === undefined ? undefined : loadCommunityPackBaselineOrWarn(options.packPath);
  if (mode === MCP_RUNTIME_FIXTURE) {
    return {
      mode,
      serverOptions: {
        handlers: withCommunityPackBaseline(createFixtureApiOperationHandlers(), communityPack),
        writeExecutors: createFixtureWriteExecutors(),
        now: () => MCP_FIXTURE_NOW
      },
      close: () => Promise.resolve()
    };
  }

  const env = loadEnv();
  const postgresUrl = requireMcpDbPostgresUrl(process.env["POSTGRES_URL"]);
  const store = createDatabaseStore({ connectionString: postgresUrl });
  return {
    mode: MCP_RUNTIME_DB,
    serverOptions: {
      handlers: withCommunityPackBaseline(createDbApiOperationHandlers(store, env), communityPack)
    },
    close: async () => {
      await store.close();
    }
  };
}

export function requireMcpDbPostgresUrl(value: string | undefined): string {
  try {
    return requireEnvValue(value, "POSTGRES_URL");
  } catch {
    throw new Error("MCP --runtime=db requires POSTGRES_URL. Set POSTGRES_URL or use --runtime=fixture.");
  }
}
