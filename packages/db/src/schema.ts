export const migrationSql = `
CREATE TABLE IF NOT EXISTS entity_master (
  entity_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  language_of_canonical TEXT NOT NULL,
  identifiers JSONB NOT NULL DEFAULT '{}'::jsonb,
  primary_country TEXT,
  hq_location JSONB,
  industry TEXT[] DEFAULT '{}',
  founded_year INT,
  status TEXT NOT NULL DEFAULT 'active',
  merged_into_entity_id TEXT REFERENCES entity_master(entity_id),
  evidence_for_existence TEXT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entity_master_kind ON entity_master(kind);
CREATE INDEX IF NOT EXISTS idx_entity_master_country ON entity_master(primary_country);
CREATE INDEX IF NOT EXISTS idx_entity_master_identifiers_cik ON entity_master ((identifiers->>'cik'));

CREATE TABLE IF NOT EXISTS entity_alias (
  alias_id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entity_master(entity_id),
  alias TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  language TEXT,
  alias_kind TEXT NOT NULL,
  evidence_id TEXT,
  source_type TEXT,
  added_by TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(entity_id, alias_norm, language)
);
CREATE INDEX IF NOT EXISTS idx_entity_alias_norm ON entity_alias(alias_norm);

CREATE TABLE IF NOT EXISTS components (
  component_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  taxonomy_path TEXT[] NOT NULL,
  aliases TEXT[] NOT NULL DEFAULT '{}'
);

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
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS cite_start_char INT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS cite_end_char INT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS cite_text_sha256 TEXT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS normalized_cite_text_sha256 TEXT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS source_snapshot_sha256 TEXT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS parser_version TEXT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS extractor_version TEXT;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS relation_candidate_hash TEXT;
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
ALTER TABLE edges ADD COLUMN IF NOT EXISTS component_id TEXT REFERENCES components(component_id);
ALTER TABLE edges ADD COLUMN IF NOT EXISTS component_specificity TEXT;
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

CREATE TABLE IF NOT EXISTS source_health (
  source_adapter_id TEXT PRIMARY KEY,
  tier TEXT NOT NULL,
  category TEXT NOT NULL,
  registry_status TEXT NOT NULL,
  automation TEXT NOT NULL,
  tos_url TEXT NOT NULL,
  official_url TEXT NOT NULL,
  requires_key BOOLEAN NOT NULL,
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  failure_count INT NOT NULL DEFAULT 0,
  last_change_at TIMESTAMPTZ,
  last_error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_health_status ON source_health(registry_status);
CREATE INDEX IF NOT EXISTS idx_source_health_last_checked ON source_health(last_checked_at);

CREATE TABLE IF NOT EXISTS source_policies (
  source_adapter_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  check_cadence_minutes INT NOT NULL CHECK (check_cadence_minutes > 0),
  jitter_minutes INT NOT NULL DEFAULT 0 CHECK (jitter_minutes >= 0),
  priority INT NOT NULL DEFAULT 100,
  config_source TEXT NOT NULL DEFAULT 'default',
  next_check_at TIMESTAMPTZ,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_policies_next_check ON source_policies(enabled, next_check_at, priority);

CREATE TABLE IF NOT EXISTS source_items (
  source_item_id TEXT PRIMARY KEY,
  source_adapter_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  url TEXT NOT NULL,
  latest_doc_id TEXT REFERENCES documents(doc_id),
  latest_bytes_sha256 TEXT,
  latest_storage_key TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_changed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE(source_adapter_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_source_items_source ON source_items(source_adapter_id);
CREATE INDEX IF NOT EXISTS idx_source_items_latest_doc ON source_items(latest_doc_id);

CREATE TABLE IF NOT EXISTS document_versions (
  version_id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL REFERENCES source_items(source_item_id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL REFERENCES documents(doc_id),
  bytes_sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_item_id, bytes_sha256)
);
CREATE INDEX IF NOT EXISTS idx_document_versions_doc ON document_versions(doc_id);

CREATE TABLE IF NOT EXISTS source_change_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  source_adapter_id TEXT NOT NULL,
  source_item_id TEXT REFERENCES source_items(source_item_id),
  doc_id TEXT REFERENCES documents(doc_id),
  before JSONB,
  after JSONB,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  caused_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_source_change_events_source ON source_change_events(source_adapter_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_change_events_item ON source_change_events(source_item_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS fetch_runs (
  fetch_run_id TEXT PRIMARY KEY,
  source_adapter_id TEXT NOT NULL,
  task_id TEXT,
  url TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL,
  response_sha256 TEXT,
  storage_key TEXT,
  error_message TEXT,
  change_type TEXT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_fetch_runs_source ON fetch_runs(source_adapter_id, started_at DESC);

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
ALTER TABLE review_candidates ADD COLUMN IF NOT EXISTS candidate_key TEXT;
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
