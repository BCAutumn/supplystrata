import { parseSince } from "./cli-utils.js";

export function currentIsoTimestamp(): string {
  return new Date().toISOString();
}

export function explicitOrCurrentIsoTimestamp(value: string | undefined): string {
  return value === undefined ? currentIsoTimestamp() : parseSince(value);
}
