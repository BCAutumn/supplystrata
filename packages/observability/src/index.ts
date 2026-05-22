import pino from "pino";
import { loadEnv, type Env } from "@supplystrata/config";

export type SupplyStrataLogger = Pick<pino.Logger, "debug" | "info" | "warn" | "error">;

export const noopLogger: SupplyStrataLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

export function createLogger(env: Env): SupplyStrataLogger {
  return pino({ level: env.LOG_LEVEL }, pino.destination(2));
}

export function createLoggerFromEnv(): SupplyStrataLogger {
  return createLogger(loadEnv());
}

let defaultLogger: SupplyStrataLogger | undefined;

export function getLogger(): SupplyStrataLogger {
  defaultLogger ??= createLoggerFromEnv();
  return defaultLogger;
}

export function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}
