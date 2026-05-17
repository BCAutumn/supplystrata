import pino from "pino";
import { loadEnv, type Env } from "@supplystrata/config";

export type SupplyStrataLogger = Pick<pino.Logger, "debug" | "info" | "warn" | "error">;

export function createLogger(env: Env = loadEnv()): SupplyStrataLogger {
  return pino({ level: env.LOG_LEVEL }, pino.destination(2));
}

let defaultLogger: SupplyStrataLogger | undefined;

export function getLogger(): SupplyStrataLogger {
  defaultLogger ??= createLogger();
  return defaultLogger;
}
