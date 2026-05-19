export interface SourceCheckWorkerOptions {
  once: boolean;
  interval_ms: number;
  limit: number;
}

export type WorkerEnv = Record<string, string | undefined>;

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_LIMIT = 10;

export function parseSourceCheckWorkerOptions(args: readonly string[], env: WorkerEnv): SourceCheckWorkerOptions {
  const values = parseArgs(args);
  return {
    once: parseBooleanValue(values.get("once") ?? env["SUPPLYSTRATA_WORKER_ONCE"], false),
    interval_ms: parsePositiveInteger(values.get("interval-ms") ?? env["SUPPLYSTRATA_WORKER_INTERVAL_MS"], DEFAULT_INTERVAL_MS, "interval-ms"),
    limit: parsePositiveInteger(values.get("limit") ?? env["SUPPLYSTRATA_WORKER_LIMIT"], DEFAULT_LIMIT, "limit")
  };
}

export function sourceCheckWorkerHelp(): string {
  return [
    "supplystrata-worker",
    "",
    "Runs the source-check worker loop against Postgres-backed source_check_jobs.",
    "",
    "Options:",
    "  --once                 Run one worker cycle and exit.",
    "  --interval-ms <n>      Poll interval for continuous mode. Default: 60000.",
    "  --limit <n>            Max due source jobs to claim per cycle. Default: 10.",
    "",
    "Environment overrides:",
    "  SUPPLYSTRATA_WORKER_ONCE=true",
    "  SUPPLYSTRATA_WORKER_INTERVAL_MS=60000",
    "  SUPPLYSTRATA_WORKER_LIMIT=10"
  ].join("\n");
}

export function shouldShowSourceCheckWorkerHelp(args: readonly string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function parseArgs(args: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === "--once") {
      values.set("once", "true");
      continue;
    }
    if (arg.startsWith("--interval-ms=")) {
      values.set("interval-ms", arg.slice("--interval-ms=".length));
      continue;
    }
    if (arg === "--interval-ms") {
      values.set("interval-ms", requireNextArg(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      values.set("limit", arg.slice("--limit=".length));
      continue;
    }
    if (arg === "--limit") {
      values.set("limit", requireNextArg(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      values.set("help", "true");
      continue;
    }
    throw new Error(`Unsupported worker option: ${arg}`);
  }
  return values;
}

function requireNextArg(args: readonly string[], index: number, label: string): string {
  const next = args[index + 1];
  if (next === undefined || next.startsWith("--")) throw new Error(`Expected a value after ${label}`);
  return next;
}

function parsePositiveInteger(value: string | undefined, defaultValue: number, label: string): number {
  if (value === undefined) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Worker ${label} must be a positive integer: ${value}`);
  return parsed;
}

function parseBooleanValue(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  throw new Error(`Worker boolean value must be true or false: ${value}`);
}
