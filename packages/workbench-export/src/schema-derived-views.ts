export function validateDerivedWorkbenchViews(record: Record<string, unknown>, path: string, errors: string[]): void {
  const chain = record["chain"];
  const chainSegments = record["chain_segments"];
  if (isRecord(chain) && Array.isArray(chain["segments"]) && Array.isArray(chainSegments)) {
    expectSignatureArrayMatch(chainSegments, chain["segments"], `${path}.chain_segments`, `${path}.chain.segments`, segmentSignature, errors);
  }

  const edgeSegments = Array.isArray(chainSegments) ? chainSegments.filter(isEdgeSegmentRecord) : [];
  const edges = record["edges"];
  if (Array.isArray(edges)) {
    expectSignatureArrayMatch(edges, edgeSegments, `${path}.edges`, `${path}.chain_segments edge view`, edgeSignature, errors);
  }

  const upstreamEdges = record["upstream_edges"];
  if (Array.isArray(edges) && Array.isArray(upstreamEdges)) {
    expectSignatureArrayMatch(upstreamEdges, edges, `${path}.upstream_edges`, `${path}.edges`, edgeSignature, errors);
  }

  const downstreamEdges = record["downstream_edges"];
  if (Array.isArray(downstreamEdges) && downstreamEdges.length > 0) {
    errors.push(`${path}.downstream_edges must stay empty until downstream chain export is implemented`);
  }
}

function expectSignatureArrayMatch(
  actual: readonly unknown[],
  expected: readonly unknown[],
  actualPath: string,
  expectedPath: string,
  signature: (value: unknown) => string,
  errors: string[]
): void {
  const actualSignatures = actual.map(signature);
  const expectedSignatures = expected.map(signature);
  if (actualSignatures.length !== expectedSignatures.length) {
    pushDerivedMismatch(
      errors,
      actualPath,
      expectedPath,
      `length ${actualSignatures.length} !== ${expectedSignatures.length}`,
      actualSignatures,
      expectedSignatures
    );
    return;
  }
  for (let index = 0; index < actualSignatures.length; index += 1) {
    if (actualSignatures[index] === expectedSignatures[index]) continue;
    pushDerivedMismatch(errors, actualPath, expectedPath, `item ${index} differs`, actualSignatures, expectedSignatures);
    return;
  }
}

function pushDerivedMismatch(
  errors: string[],
  actualPath: string,
  expectedPath: string,
  reason: string,
  actualSignatures: readonly string[],
  expectedSignatures: readonly string[]
): void {
  const actualPreview = actualSignatures.slice(0, 3).join(" | ");
  const expectedPreview = expectedSignatures.slice(0, 3).join(" | ");
  errors.push(`${actualPath} must match ${expectedPath}: ${reason}; actual=[${actualPreview}] expected=[${expectedPreview}]`);
}

function segmentSignature(value: unknown): string {
  if (!isRecord(value)) return "invalid-segment";
  return [
    numberField(value, "sequence_index"),
    stringField(value, "semantic_layer"),
    layerScopedId(value),
    endpointId(value["from"]),
    endpointId(value["to"]),
    stringField(value, "relation"),
    nullableStringField(value, "component_id"),
    stringArrayField(value, "evidence_ids")
  ].join("|");
}

function edgeSignature(value: unknown): string {
  if (!isRecord(value)) return "invalid-edge";
  if (isEdgeSegmentRecord(value)) {
    return [
      stringField(value, "edge_id"),
      endpointId(value["from"]),
      endpointId(value["to"]),
      stringField(value, "relation"),
      nullableStringField(value, "component_id"),
      stringArrayField(value, "evidence_ids")
    ].join("|");
  }
  return [
    stringField(value, "edge_id"),
    stringField(value, "from_id"),
    stringField(value, "to_id"),
    stringField(value, "relation"),
    nullableStringField(value, "component_id"),
    stringArrayField(value, "evidence_ids")
  ].join("|");
}

function isEdgeSegmentRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value["semantic_layer"] === "edge";
}

function layerScopedId(record: Record<string, unknown>): string {
  for (const key of ["edge_id", "claim_id", "observation_id", "lead_id", "unknown_id"] as const) {
    const value = record[key];
    if (typeof value === "string") return `${key}:${value}`;
  }
  return "unscoped";
}

function endpointId(value: unknown): string {
  return isRecord(value) ? stringField(value, "id") : "invalid-endpoint";
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : `invalid:${key}`;
}

function nullableStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (value === null) return "null";
  return typeof value === "string" ? value : `invalid:${key}`;
}

function numberField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : `invalid:${key}`;
}

function stringArrayField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value.join(",") : `invalid:${key}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
