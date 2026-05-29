import Ajv2020 from "ajv/dist/2020.js";
import type { ScbomDocument, ScbomObject, ScbomObjectType } from "@scbom/spec";
import commonSchema from "@scbom/spec/schemas/common" with { type: "json" };
import entitySchema from "@scbom/spec/schemas/entity" with { type: "json" };
import evidenceSchema from "@scbom/spec/schemas/evidence" with { type: "json" };
import relationshipSchema from "@scbom/spec/schemas/relationship" with { type: "json" };
import observationSchema from "@scbom/spec/schemas/observation" with { type: "json" };
import unknownSchema from "@scbom/spec/schemas/unknown" with { type: "json" };
import changeSchema from "@scbom/spec/schemas/change" with { type: "json" };
import documentSchema from "@scbom/spec/schemas/document" with { type: "json" };

const SCBOM_DOCUMENT_SCHEMA_ID = "https://scbom.org/schema/v0.0.1/scbom-document.schema.json";

const ajv = new Ajv2020({ allErrors: true });
ajv.addSchema(commonSchema);
ajv.addSchema(entitySchema);
ajv.addSchema(evidenceSchema);
ajv.addSchema(relationshipSchema);
ajv.addSchema(observationSchema);
ajv.addSchema(unknownSchema);
ajv.addSchema(changeSchema);

const validateDocument = ajv.compile(documentSchema);

export function assertScbomDocument(value: unknown): asserts value is ScbomDocument {
  if (!validateDocument(value)) {
    const errors = validateDocument.errors ?? [];
    throw new Error(`JSON is not a valid SCBOM ${SCBOM_DOCUMENT_SCHEMA_ID} document: ${errors.slice(0, 8).map(formatAjvError).join("; ")}`);
  }
  if (!isScbomDocument(value)) {
    throw new Error(`JSON is not a valid SCBOM ${SCBOM_DOCUMENT_SCHEMA_ID} document: schema validation did not produce a typed document`);
  }
  validateScbomObjectRefs(value);
}

function validateScbomObjectRefs(document: ScbomDocument): void {
  const objectTypes = new Map<string, ScbomObjectType>();
  const errors: string[] = [];

  for (const object of document.objects) {
    if (objectTypes.has(object.id)) errors.push(`duplicate object id ${object.id}`);
    objectTypes.set(object.id, object.object_type);
  }

  for (const object of document.objects) {
    for (const ref of refsForObject(object)) {
      const actualType = objectTypes.get(ref.id);
      if (actualType === undefined) {
        errors.push(`${object.id} references missing object ${ref.id}`);
      } else if (ref.expectedType !== undefined && actualType !== ref.expectedType) {
        errors.push(`${object.id} references ${ref.id} as ${ref.expectedType}, got ${actualType}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`SCBOM document has invalid object references: ${errors.slice(0, 8).join("; ")}`);
  }
}

interface ScbomRefRequirement {
  readonly id: string;
  readonly expectedType?: ScbomObjectType;
}

function refsForObject(object: ScbomObject): readonly ScbomRefRequirement[] {
  switch (object.object_type) {
    case "entity":
    case "evidence":
      return evidenceRefs(object.provenance.source_refs);
    case "relationship":
      return [
        { id: object.subject_ref, expectedType: "entity" },
        { id: object.object_ref, expectedType: "entity" },
        ...evidenceRefs(object.evidence_refs),
        ...evidenceRefs(object.provenance.source_refs)
      ];
    case "observation":
      return [{ id: object.scope_ref }, ...evidenceRefs(object.evidence_refs), ...evidenceRefs(object.provenance.source_refs)];
    case "unknown":
      return [{ id: object.scope_ref }, ...evidenceRefs(object.evidence_refs), ...evidenceRefs(object.provenance.source_refs)];
    case "change":
      return [{ id: object.changed_object_ref }, ...evidenceRefs(object.evidence_refs), ...evidenceRefs(object.provenance.source_refs)];
  }
}

function evidenceRefs(refs: readonly string[] | undefined): ScbomRefRequirement[] {
  return (refs ?? []).map((id) => ({ id, expectedType: "evidence" }));
}

function formatAjvError(error: NonNullable<typeof validateDocument.errors>[number]): string {
  return `${error.instancePath || "$"} ${error.message ?? "failed validation"}`;
}

function isScbomDocument(value: unknown): value is ScbomDocument {
  if (!isRecord(value)) return false;
  if (value["schema_version"] !== "0.0.1") return false;
  if (typeof value["document_id"] !== "string") return false;
  if (typeof value["generated_at"] !== "string") return false;
  if (!isRecord(value["producer"])) return false;
  if (!Array.isArray(value["objects"])) return false;
  return value["objects"].every(isScbomObject);
}

function isScbomObject(value: unknown): value is ScbomObject {
  if (!isRecord(value)) return false;
  if (typeof value["id"] !== "string") return false;
  switch (value["object_type"]) {
    case "entity":
    case "evidence":
    case "relationship":
    case "observation":
    case "unknown":
    case "change":
      return true;
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
