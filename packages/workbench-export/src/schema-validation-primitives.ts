export function validateArrayField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  errors: string[],
  validateItem: (value: unknown, path: string, errors: string[]) => void
): void {
  const value = record[key];
  if (!Array.isArray(value)) {
    errors.push(`${path}.${key} must be an array`);
    return;
  }
  value.forEach((item, index) => validateItem(item, `${path}.${key}[${index}]`, errors));
}

export function expectLiteral(record: Record<string, unknown>, key: string, expected: string | boolean, path: string, errors: string[]): void {
  if (record[key] !== expected) errors.push(`${path}.${key} must equal ${expected}`);
}

export function expectEnum(record: Record<string, unknown>, key: string, values: readonly string[], path: string, errors: string[]): void {
  const value = record[key];
  if (typeof value !== "string" || !values.includes(value)) errors.push(`${path}.${key} must be one of ${values.join(", ")}`);
}

export function expectNullableEnum(record: Record<string, unknown>, key: string, values: readonly string[], path: string, errors: string[]): void {
  const value = record[key];
  if (value !== null && (typeof value !== "string" || !values.includes(value))) errors.push(`${path}.${key} must be one of ${values.join(", ")} or null`);
}

export function expectString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== "string") errors.push(`${path}.${key} must be a string`);
}

export function expectNullableString(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (value !== null && typeof value !== "string") errors.push(`${path}.${key} must be a string or null`);
}

export function expectStringArray(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) errors.push(`${path}.${key} must be a string array`);
}

export function expectEnumArray(record: Record<string, unknown>, key: string, values: readonly string[], path: string, errors: string[]): void {
  const value = record[key];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && values.includes(item))) {
    errors.push(`${path}.${key} must only include ${values.join(", ")}`);
  }
}

export function expectNumber(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== "number" || !Number.isFinite(record[key])) errors.push(`${path}.${key} must be a finite number`);
}

export function expectNullableNumber(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) errors.push(`${path}.${key} must be a finite number or null`);
}

export function expectEvidenceLevel(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4 && value !== 5) errors.push(`${path}.${key} must be an evidence level from 1 to 5`);
}

export function expectBoolean(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof record[key] !== "boolean") errors.push(`${path}.${key} must be a boolean`);
}

export function expectNullableBoolean(record: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  const value = record[key];
  if (value !== null && typeof value !== "boolean") errors.push(`${path}.${key} must be a boolean or null`);
}

export function isRecordAt(value: unknown, path: string, errors: string[]): value is Record<string, unknown> {
  if (isRecord(value)) return true;
  errors.push(`${path} must be an object`);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
