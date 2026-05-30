import type { ScbomAssessment, ScbomDocument, ScbomEvidence, ScbomRelationship } from "@scbom/spec";
import {
  COMMUNITY_PACK_BASELINE_RELATIONSHIP_STATUS,
  COMMUNITY_PACK_EVIDENCE_LEVEL_SCHEME,
  COMMUNITY_PACK_EXTRACTION_METHOD_SCHEME,
  COMMUNITY_PACK_MIN_PUBLISH_EVIDENCE_LEVEL,
  COMMUNITY_PACK_RULE_EXTRACTION_METHOD
} from "../definitions/manifest.js";

// 加载侧发布资格复检：pack 没有签名也没有可信根，唯一的信任门就是 loader 独立确认
// 每条 relationship 都达到与导出侧一致的事实门槛（current 边 + rule 抽取 + evidence_level≥4，
// 且其引用的每条 evidence 同样达标）。任何不达标的 relationship 都意味着 pack 由非合规/
// 被篡改的生产者产生，必须整体拒绝，避免读层把不可信关系当 baseline 欺骗 agent/用户。
export function assertCommunityPackPublishEligible(documents: readonly ScbomDocument[]): void {
  const errors = communityPackPublishEligibilityErrors(documents);
  if (errors.length > 0) {
    throw new Error(`Community-pack publish-eligibility re-check failed: ${errors.slice(0, 8).join("; ")}`);
  }
}

export function communityPackPublishEligibilityErrors(documents: readonly ScbomDocument[]): string[] {
  const errors: string[] = [];
  for (const document of documents) {
    const evidenceById = new Map<string, ScbomEvidence>();
    for (const object of document.objects) {
      if (object.object_type === "evidence") evidenceById.set(object.id, object);
    }
    for (const object of document.objects) {
      if (object.object_type === "relationship") {
        checkRelationship(document.document_id, object, evidenceById, errors);
      }
    }
  }
  return errors;
}

function checkRelationship(
  documentId: string,
  relationship: ScbomRelationship,
  evidenceById: ReadonlyMap<string, ScbomEvidence>,
  errors: string[]
): void {
  const label = `${documentId}/${relationship.id}`;

  if (relationship.validity.status !== COMMUNITY_PACK_BASELINE_RELATIONSHIP_STATUS) {
    errors.push(`${label} relationship validity is '${relationship.validity.status}', baseline requires '${COMMUNITY_PACK_BASELINE_RELATIONSHIP_STATUS}'`);
  }

  const relationshipLevel = numericAssessment(relationship.assessments, COMMUNITY_PACK_EVIDENCE_LEVEL_SCHEME);
  if (relationshipLevel === undefined || relationshipLevel < COMMUNITY_PACK_MIN_PUBLISH_EVIDENCE_LEVEL) {
    errors.push(`${label} relationship evidence_level ${relationshipLevel ?? "missing"} is below publish threshold ${COMMUNITY_PACK_MIN_PUBLISH_EVIDENCE_LEVEL}`);
  }

  if (relationship.evidence_refs.length === 0) {
    errors.push(`${label} relationship has no evidence_refs; baseline facts must be evidence-backed`);
    return;
  }

  for (const ref of relationship.evidence_refs) {
    const evidence = evidenceById.get(ref);
    if (evidence === undefined) {
      errors.push(`${label} references evidence ${ref} that is missing from the same document`);
      continue;
    }
    const level = numericAssessment(evidence.assessments, COMMUNITY_PACK_EVIDENCE_LEVEL_SCHEME);
    if (level === undefined || level < COMMUNITY_PACK_MIN_PUBLISH_EVIDENCE_LEVEL) {
      errors.push(`${label} evidence ${ref} evidence_level ${level ?? "missing"} is below publish threshold ${COMMUNITY_PACK_MIN_PUBLISH_EVIDENCE_LEVEL}`);
    }
    const method = stringAssessment(evidence.assessments, COMMUNITY_PACK_EXTRACTION_METHOD_SCHEME);
    if (method !== COMMUNITY_PACK_RULE_EXTRACTION_METHOD) {
      errors.push(`${label} evidence ${ref} extraction_method '${method ?? "missing"}' is not '${COMMUNITY_PACK_RULE_EXTRACTION_METHOD}'`);
    }
  }
}

function numericAssessment(assessments: readonly ScbomAssessment[] | undefined, scheme: string): number | undefined {
  const value = assessmentValue(assessments, scheme);
  return typeof value === "number" ? value : undefined;
}

function stringAssessment(assessments: readonly ScbomAssessment[] | undefined, scheme: string): string | undefined {
  const value = assessmentValue(assessments, scheme);
  return typeof value === "string" ? value : undefined;
}

function assessmentValue(assessments: readonly ScbomAssessment[] | undefined, scheme: string): ScbomAssessment["value"] | undefined {
  return assessments?.find((assessment) => assessment.scheme === scheme)?.value;
}
