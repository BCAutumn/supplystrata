#!/usr/bin/env node
import { loadEnv } from "@supplystrata/config";
import { createDatabaseStore } from "@supplystrata/db/write";
import { createLogger, setLogger } from "@supplystrata/observability";
import { createDbApiOperationHandlers } from "./features/http-adapter/orchestration/db-operation-handlers.js";
import { createApiNodeServer } from "./features/http-adapter/orchestration/node-server.js";

const env = loadEnv();
const logger = setLogger(createLogger(env));
const store = createDatabaseStore({ connectionString: env.POSTGRES_URL });
const port = parsePort(process.env["SUPPLYSTRATA_API_PORT"] ?? process.env["PORT"] ?? "3001");
const server = createApiNodeServer({ handlers: createDbApiOperationHandlers(store, env), logger });

server.listen(port, () => {
  logger.info({ stage: "api-http", port }, "SupplyStrata API HTTP adapter listening");
});

for (const signalName of ["SIGINT", "SIGTERM"] as const) {
  process.once(signalName, () => {
    logger.info({ stage: "api-http", signal: signalName }, "SupplyStrata API shutdown requested");
    server.close((error) => {
      void store.close().finally(() => {
        if (error !== undefined) {
          logger.error({ stage: "api-http", err: error.message }, "SupplyStrata API shutdown failed");
          process.exitCode = 1;
        }
      });
    });
  });
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid API port: ${value}`);
  return port;
}
