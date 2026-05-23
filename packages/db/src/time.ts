export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toIsoDateString(value: Date | string): string {
  return toIsoString(value).slice(0, 10);
}
