export const migration0008ClaimDraftsSql = `
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_status_check;
ALTER TABLE claims
  ADD CONSTRAINT claims_status_check CHECK (status IN ('draft','active','superseded','rejected'));

ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS review_id TEXT REFERENCES review_candidates(review_id);

ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_check;
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_scope_check;
ALTER TABLE claims
  ADD CONSTRAINT claims_scope_check CHECK (
    edge_id IS NOT NULL
    OR subject_id IS NOT NULL
    OR object_id IS NOT NULL
    OR component_id IS NOT NULL
    OR review_id IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS idx_claims_review ON claims(review_id) WHERE review_id IS NOT NULL;
`;
