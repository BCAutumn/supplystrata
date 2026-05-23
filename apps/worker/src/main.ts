#!/usr/bin/env node
import { createDatabaseStore } from "@supplystrata/db/write";
import { loadEnv } from "@supplystrata/config";
import { createLogger, messageFromUnknown, setLogger, type SupplyStrataLogger } from "@supplystrata/observability";
import { parseSourceCheckWorkerOptions, shouldShowSourceCheckWorkerHelp, sourceCheckWorkerHelp } from "./options.js";
import { runSourceCheckWorkerLoop } from "./source-check-worker.js";

const args = process.argv.slice(2);

if (shouldShowSourceCheckWorkerHelp(args)) {
  process.stdout.write(`${sourceCheckWorkerHelp()}\n`);
  process.exitCode = 0;
} else {
  const controller = new AbortController();
  const env = loadEnv();
  const logger = setLogger(createLogger(env));
  installShutdownHandlers(controller, logger);
  const store = createDatabaseStore({ connectionString: env.POSTGRES_URL });
  try {
    const options = parseSourceCheckWorkerOptions(args, process.env);
    logger.info({ stage: "source-check-worker", options }, "source check worker starting");
    await runSourceCheckWorkerLoop({ store, env, options, logger, signal: controller.signal });
    logger.info({ stage: "source-check-worker" }, "source check worker stopped");
  } catch (error) {
    logger.error({ stage: "source-check-worker", err: messageFromUnknown(error) }, "source check worker failed");
    process.exitCode = 1;
  } finally {
    await store.close();
  }
}

function installShutdownHandlers(controller: AbortController, logger: SupplyStrataLogger): void {
  const stop = (signalName: string): void => {
    logger.info({ stage: "source-check-worker", signal: signalName }, "source check worker shutdown requested");
    controller.abort();
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}
