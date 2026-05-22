export function write(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function formatCliError(error: unknown): string {
  if (isConnectionRefused(error)) {
    return [
      "A local database service is not reachable.",
      "DB-backed commands need a configured SQL truth store. The built-in adapter is Postgres via POSTGRES_URL; graph sync commands using the built-in Neo4j GraphStore adapter also need NEO4J_URI.",
      "DB-free commands remain available, for example: pnpm cli preview nvidia --format json",
      "Run pnpm cli runtime doctor to see which no-Docker mode is ready in this environment."
    ].join("\n");
  }
  return error instanceof Error ? error.message : "Unknown CLI error";
}

function isConnectionRefused(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error["code"] === "ECONNREFUSED") return true;
  const nestedErrors = error["errors"];
  if (!Array.isArray(nestedErrors)) return false;
  return nestedErrors.some(isConnectionRefused);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
