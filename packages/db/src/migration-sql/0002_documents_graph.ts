export const migration0002DocumentsGraphSql = `
CREATE TABLE IF NOT EXISTS documents (
  doc_id TEXT PRIMARY KEY,
  source_adapter_id TEXT NOT NULL,
  document_type TEXT NOT NULL,
  primary_entity_id TEXT REFERENCES entity_master(entity_id),
  source_url TEXT NOT NULL,
  source_date DATE,
  fetched_at TIMESTAMPTZ NOT NULL,
  bytes_sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  language TEXT,
  parse_status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(source_adapter_id, source_url, bytes_sha256)
);
CREATE INDEX IF NOT EXISTS idx_documents_source_date ON documents(source_date);
CREATE INDEX IF NOT EXISTS idx_documents_primary_entity ON documents(primary_entity_id);

CREATE TABLE IF NOT EXISTS document_chunks (
  chunk_id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  text TEXT NOT NULL,
  locator TEXT,
  language TEXT,
  token_count INT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(doc_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(doc_id);

CREATE TABLE IF NOT EXISTS evidence (
  evidence_id TEXT PRIMARY KEY,
  edge_id TEXT,
  doc_id TEXT NOT NULL REFERENCES documents(doc_id),
  chunk_id TEXT REFERENCES document_chunks(chunk_id),
  cite_text TEXT NOT NULL,
  cite_locator TEXT,
  cite_start_char INT,
  cite_end_char INT,
  cite_text_sha256 TEXT,
  normalized_cite_text_sha256 TEXT,
  source_snapshot_sha256 TEXT,
  parser_version TEXT,
  extractor_version TEXT,
  relation_candidate_hash TEXT,
  evidence_level SMALLINT NOT NULL CHECK (evidence_level BETWEEN 1 AND 5),
  confidence REAL NOT NULL,
  is_inferred BOOLEAN NOT NULL,
  extraction_method TEXT NOT NULL,
  extractor_id TEXT,
  llm_meta JSONB,
  reviewer TEXT,
  reviewed_at TIMESTAMPTZ,
  superseded_by TEXT REFERENCES evidence(evidence_id),
  confidence_breakdown JSONB NOT NULL,
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evidence_edge ON evidence(edge_id);
CREATE INDEX IF NOT EXISTS idx_evidence_doc ON evidence(doc_id);
CREATE INDEX IF NOT EXISTS idx_evidence_relation_candidate_hash ON evidence(relation_candidate_hash) WHERE relation_candidate_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS edges (
  edge_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES entity_master(entity_id),
  object_id TEXT NOT NULL REFERENCES entity_master(entity_id),
  relation TEXT NOT NULL,
  component TEXT,
  component_id TEXT REFERENCES components(component_id),
  component_specificity TEXT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_level SMALLINT NOT NULL,
  confidence REAL NOT NULL,
  is_inferred BOOLEAN NOT NULL,
  validity TEXT NOT NULL DEFAULT 'current',
  effective_from DATE,
  effective_to DATE,
  primary_evidence_id TEXT REFERENCES evidence(evidence_id),
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deprecated_reason TEXT,
  superseded_by_edge_id TEXT REFERENCES edges(edge_id)
);
CREATE INDEX IF NOT EXISTS idx_edges_subject ON edges(subject_id);
CREATE INDEX IF NOT EXISTS idx_edges_object ON edges(object_id);
CREATE INDEX IF NOT EXISTS idx_edges_relation ON edges(relation);
CREATE INDEX IF NOT EXISTS idx_edges_validity ON edges(validity);
CREATE INDEX IF NOT EXISTS idx_edges_component_id ON edges(component_id);
DROP INDEX IF EXISTS uniq_edges_identity;
CREATE UNIQUE INDEX uniq_edges_identity ON edges (
  subject_id, object_id, relation, COALESCE(component_id, ''), COALESCE(component, ''),
  COALESCE(effective_from, DATE '1900-01-01'),
  COALESCE(effective_to, DATE '2999-12-31')
);

CREATE TABLE IF NOT EXISTS change_records (
  change_id TEXT PRIMARY KEY,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  before JSONB,
  after JSONB,
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  caused_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_change_records_scope ON change_records(scope_kind, scope_id);
CREATE INDEX IF NOT EXISTS idx_change_records_detected_at ON change_records(detected_at DESC);
`;
