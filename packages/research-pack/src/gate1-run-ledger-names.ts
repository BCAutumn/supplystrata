export function defaultGate1Namespace(companyId: string): string {
  return `research-${companyId.toLowerCase()}`;
}

export function safeGate1Segment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (cleaned.length === 0) throw new Error(`Cannot create a file segment from empty value: ${value}`);
  return cleaned;
}
