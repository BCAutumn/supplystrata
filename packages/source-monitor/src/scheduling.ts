import { createHash } from "node:crypto";

export interface NextCheckInput {
  baseTime: string;
  cadenceMinutes: number;
  jitterMinutes: number;
  jitterSeed: string;
}

export function calculateNextCheckAt(input: NextCheckInput): string {
  if (!Number.isInteger(input.cadenceMinutes) || input.cadenceMinutes < 1) {
    throw new Error(`check_cadence_minutes must be a positive integer: ${input.cadenceMinutes}`);
  }
  const jitterMinutes = input.jitterMinutes <= 0 ? 0 : deterministicJitterMinutes(input.jitterSeed, input.jitterMinutes);
  const next = new Date(input.baseTime);
  if (Number.isNaN(next.getTime())) throw new Error(`Invalid baseTime for next source check: ${input.baseTime}`);
  next.setUTCMinutes(next.getUTCMinutes() + input.cadenceMinutes + jitterMinutes);
  return next.toISOString();
}

function deterministicJitterMinutes(seed: string, maxJitterMinutes: number): number {
  if (!Number.isFinite(maxJitterMinutes) || maxJitterMinutes <= 0) return 0;
  const max = Math.floor(maxJitterMinutes);
  const hash = createHash("sha256").update(seed).digest();
  return hash.readUInt32BE(0) % (max + 1);
}
