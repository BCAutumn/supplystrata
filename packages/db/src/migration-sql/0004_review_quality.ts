export const migration0004ReviewQualitySql = `
CREATE TABLE IF NOT EXISTS unknown_items (
  unknown_id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  question TEXT NOT NULL,
  why_unknown TEXT NOT NULL,
  blocking_data_sources TEXT[] DEFAULT '{}',
  proxies TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_evidence_ids TEXT[]
);
CREATE INDEX IF NOT EXISTS idx_unknown_items_scope ON unknown_items(scope_kind, scope_id);

CREATE TABLE IF NOT EXISTS review_candidates (
  review_id TEXT PRIMARY KEY,
  candidate_key TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  candidate JSONB NOT NULL,
  doc_id TEXT REFERENCES documents(doc_id),
  source_adapter_id TEXT NOT NULL,
  reviewer TEXT,
  reviewed_at TIMESTAMPTZ,
  decision_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_candidates_status ON review_candidates(status);
CREATE INDEX IF NOT EXISTS idx_review_candidates_kind ON review_candidates(kind);
CREATE INDEX IF NOT EXISTS idx_review_candidates_doc ON review_candidates(doc_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_review_candidates_candidate_key ON review_candidates(candidate_key) WHERE candidate_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS extraction_rejections (
  rejection_id TEXT PRIMARY KEY,
  candidate JSONB NOT NULL,
  doc_id TEXT REFERENCES documents(doc_id),
  chunk_id TEXT REFERENCES document_chunks(chunk_id),
  stage TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pending_entities (
  pending_id TEXT PRIMARY KEY,
  surface TEXT NOT NULL,
  context JSONB NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  resolved_entity_id TEXT REFERENCES entity_master(entity_id),
  reviewer TEXT,
  reviewed_at TIMESTAMPTZ
);
`;
