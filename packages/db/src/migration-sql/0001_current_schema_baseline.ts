export const sql = `
-- SupplyStrata current schema baseline.
-- Squashed from historical migrations 0001_entity_core through 0031_research_runs.

-- 0001_entity_core
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

-- 0002_documents_graph
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

-- 0003_source_monitoring
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
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  backoff_base_minutes INT NOT NULL DEFAULT 1 CHECK (backoff_base_minutes > 0),
  backoff_max_minutes INT NOT NULL DEFAULT 60 CHECK (backoff_max_minutes > 0),
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

-- 0004_review_quality
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

-- 0005_remove_legacy_review_queue
DROP TABLE IF EXISTS extraction_review_queue;

-- 0006_claims_observations_chain_views
CREATE TABLE IF NOT EXISTS claims (
  claim_id TEXT PRIMARY KEY,
  claim_type TEXT NOT NULL CHECK (claim_type IN (
    'SUPPLY_RELATION_CLAIM',
    'FACILITY_RELATION_CLAIM',
    'ENTITY_FACT_CLAIM',
    'COMPONENT_EXPOSURE_CLAIM',
    'DEMAND_SIGNAL_CLAIM',
    'RISK_SIGNAL_CLAIM',
    'UNKNOWN_BOUNDARY_CLAIM'
  )),
  claim_text TEXT NOT NULL,
  subject_id TEXT REFERENCES entity_master(entity_id),
  object_id TEXT REFERENCES entity_master(entity_id),
  component_id TEXT REFERENCES components(component_id),
  edge_id TEXT REFERENCES edges(edge_id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','superseded','rejected')),
  evidence_level SMALLINT NOT NULL CHECK (evidence_level BETWEEN 1 AND 5),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  is_inferred BOOLEAN NOT NULL,
  generated_by TEXT NOT NULL,
  review_id TEXT REFERENCES review_candidates(review_id),
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (edge_id IS NOT NULL OR subject_id IS NOT NULL OR object_id IS NOT NULL OR component_id IS NOT NULL OR review_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_claims_edge ON claims(edge_id);
CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject_id);
CREATE INDEX IF NOT EXISTS idx_claims_object ON claims(object_id);
CREATE INDEX IF NOT EXISTS idx_claims_component ON claims(component_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_review ON claims(review_id) WHERE review_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS claim_evidence (
  claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(evidence_id),
  role TEXT NOT NULL CHECK (role IN ('primary','supporting','contradicting','context')),
  PRIMARY KEY (claim_id, evidence_id)
);
CREATE INDEX IF NOT EXISTS idx_claim_evidence_evidence ON claim_evidence(evidence_id);

CREATE TABLE IF NOT EXISTS claim_unknowns (
  claim_id TEXT NOT NULL REFERENCES claims(claim_id) ON DELETE CASCADE,
  unknown_id TEXT NOT NULL REFERENCES unknown_items(unknown_id),
  role TEXT NOT NULL CHECK (role IN ('boundary','blocking','context')),
  PRIMARY KEY (claim_id, unknown_id)
);
CREATE INDEX IF NOT EXISTS idx_claim_unknowns_unknown ON claim_unknowns(unknown_id);

CREATE TABLE IF NOT EXISTS observations (
  observation_id TEXT PRIMARY KEY,
  observation_type TEXT NOT NULL CHECK (observation_type IN (
    'TRADE_FLOW_OBSERVATION',
    'PORT_ACTIVITY_OBSERVATION',
    'ROUTE_OBSERVATION',
    'ENERGY_PRICE_OBSERVATION',
    'COMMODITY_PRICE_OBSERVATION',
    'MINERAL_SUPPLY_OBSERVATION',
    'CAPEX_OBSERVATION',
    'INVENTORY_OBSERVATION',
    'BACKLOG_OBSERVATION',
    'CUSTOMER_CONCENTRATION_OBSERVATION',
    'POLICY_OBSERVATION',
    'PROCUREMENT_OBSERVATION'
  )),
  source_adapter_id TEXT NOT NULL,
  source_item_id TEXT REFERENCES source_items(source_item_id),
  doc_id TEXT REFERENCES documents(doc_id),
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  geography_kind TEXT,
  geography_id TEXT,
  component_id TEXT REFERENCES components(component_id),
  metric_name TEXT NOT NULL,
  metric_value NUMERIC,
  metric_unit TEXT,
  time_window_start DATE,
  time_window_end DATE,
  baseline_value NUMERIC,
  change_value NUMERIC,
  change_percent REAL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (time_window_start IS NULL OR time_window_end IS NULL OR time_window_start <= time_window_end)
);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(observation_type);
CREATE INDEX IF NOT EXISTS idx_observations_scope ON observations(scope_kind, scope_id);
CREATE INDEX IF NOT EXISTS idx_observations_component ON observations(component_id);
CREATE INDEX IF NOT EXISTS idx_observations_source ON observations(source_adapter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_window ON observations(time_window_start, time_window_end);

CREATE TABLE IF NOT EXISTS lead_observations (
  lead_id TEXT PRIMARY KEY,
  lead_type TEXT NOT NULL CHECK (lead_type IN (
    'HIRING_SIGNAL',
    'NEWS_SIGNAL',
    'PROCUREMENT_SIGNAL',
    'BOL_SINGLE_RECORD',
    'FORUM_OR_BLOG_SIGNAL',
    'UNVERIFIED_FACILITY_SIGNAL'
  )),
  source_adapter_id TEXT NOT NULL,
  doc_id TEXT REFERENCES documents(doc_id),
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  cite_text TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','promoted','rejected','closed')),
  review_id TEXT REFERENCES review_candidates(review_id),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_observations_type ON lead_observations(lead_type);
CREATE INDEX IF NOT EXISTS idx_lead_observations_scope ON lead_observations(scope_kind, scope_id);
CREATE INDEX IF NOT EXISTS idx_lead_observations_status ON lead_observations(status);
CREATE INDEX IF NOT EXISTS idx_lead_observations_source ON lead_observations(source_adapter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chain_views (
  chain_id TEXT PRIMARY KEY,
  root_kind TEXT NOT NULL CHECK (root_kind IN ('company','entity','facility','component','country','port','vessel','carrier','mineral','route','document')),
  root_id TEXT NOT NULL,
  view_type TEXT NOT NULL CHECK (view_type IN (
    'company_chain',
    'component_chain',
    'facility_chain',
    'route_chain',
    'material_chain',
    'demand_chain',
    'unknown_map'
  )),
  title TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_chain_views_root ON chain_views(root_kind, root_id);
CREATE INDEX IF NOT EXISTS idx_chain_views_type ON chain_views(view_type);

CREATE TABLE IF NOT EXISTS chain_segments (
  segment_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL REFERENCES chain_views(chain_id) ON DELETE CASCADE,
  sequence_index INT NOT NULL CHECK (sequence_index >= 0),
  from_kind TEXT NOT NULL CHECK (from_kind IN ('company','entity','facility','component','country','port','vessel','carrier','mineral','route','document')),
  from_id TEXT NOT NULL,
  to_kind TEXT NOT NULL CHECK (to_kind IN ('company','entity','facility','component','country','port','vessel','carrier','mineral','route','document')),
  to_id TEXT NOT NULL,
  semantic_layer TEXT NOT NULL CHECK (semantic_layer IN ('edge','claim','observation','lead','unknown')),
  relation TEXT,
  component_id TEXT REFERENCES components(component_id),
  edge_id TEXT REFERENCES edges(edge_id),
  claim_id TEXT REFERENCES claims(claim_id),
  observation_id TEXT REFERENCES observations(observation_id),
  lead_id TEXT REFERENCES lead_observations(lead_id),
  unknown_id TEXT REFERENCES unknown_items(unknown_id),
  evidence_ids TEXT[] NOT NULL DEFAULT '{}',
  confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (
    (semantic_layer = 'edge' AND edge_id IS NOT NULL AND claim_id IS NULL AND observation_id IS NULL AND lead_id IS NULL AND unknown_id IS NULL)
    OR (semantic_layer = 'claim' AND edge_id IS NULL AND claim_id IS NOT NULL AND observation_id IS NULL AND lead_id IS NULL AND unknown_id IS NULL)
    OR (semantic_layer = 'observation' AND edge_id IS NULL AND claim_id IS NULL AND observation_id IS NOT NULL AND lead_id IS NULL AND unknown_id IS NULL)
    OR (semantic_layer = 'lead' AND edge_id IS NULL AND claim_id IS NULL AND observation_id IS NULL AND lead_id IS NOT NULL AND unknown_id IS NULL)
    OR (semantic_layer = 'unknown' AND edge_id IS NULL AND claim_id IS NULL AND observation_id IS NULL AND lead_id IS NULL AND unknown_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chain_segments_order ON chain_segments(chain_id, sequence_index, segment_id);
CREATE INDEX IF NOT EXISTS idx_chain_segments_chain ON chain_segments(chain_id, sequence_index);
CREATE INDEX IF NOT EXISTS idx_chain_segments_layer ON chain_segments(semantic_layer);
CREATE INDEX IF NOT EXISTS idx_chain_segments_edge ON chain_segments(edge_id) WHERE edge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chain_segments_claim ON chain_segments(claim_id) WHERE claim_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chain_segments_observation ON chain_segments(observation_id) WHERE observation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chain_segments_lead ON chain_segments(lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chain_segments_unknown ON chain_segments(unknown_id) WHERE unknown_id IS NOT NULL;

-- 0007_source_check_targets
CREATE TABLE IF NOT EXISTS source_check_targets (
  check_target_id TEXT PRIMARY KEY,
  source_adapter_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  subject_entity_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INT NOT NULL DEFAULT 100,
  next_check_at TIMESTAMPTZ,
  check_cadence_minutes INT CHECK (check_cadence_minutes IS NULL OR check_cadence_minutes > 0),
  jitter_minutes INT CHECK (jitter_minutes IS NULL OR jitter_minutes >= 0),
  max_attempts INT CHECK (max_attempts IS NULL OR max_attempts > 0),
  backoff_base_minutes INT CHECK (backoff_base_minutes IS NULL OR backoff_base_minutes > 0),
  backoff_max_minutes INT CHECK (backoff_max_minutes IS NULL OR backoff_max_minutes > 0),
  target_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  config_source TEXT NOT NULL DEFAULT 'default',
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_check_targets_due ON source_check_targets(enabled, next_check_at, priority);
CREATE INDEX IF NOT EXISTS idx_source_check_targets_source ON source_check_targets(source_adapter_id, enabled);
CREATE INDEX IF NOT EXISTS idx_source_check_targets_subject ON source_check_targets(subject_entity_id);

-- 0008_claim_drafts
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

-- 0009_review_queue_hardening
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_entities_open_surface
  ON pending_entities (lower(surface))
  WHERE status = 'pending';

-- 0010_graph_projection_jobs
CREATE TABLE IF NOT EXISTS graph_projection_jobs (
  job_id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  edge_id TEXT NOT NULL REFERENCES edges(edge_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_graph_projection_jobs_due
  ON graph_projection_jobs (status, next_attempt_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_graph_projection_jobs_active_edge_operation
  ON graph_projection_jobs (operation, edge_id)
  WHERE status IN ('pending','failed');

-- 0011_graph_projection_in_progress
DROP INDEX IF EXISTS uniq_graph_projection_jobs_active_edge_operation;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_graph_projection_jobs_active_edge_operation
  ON graph_projection_jobs (operation, edge_id)
  WHERE status IN ('pending','failed','in_progress');

-- 0012_observation_type_contract
ALTER TABLE observations
  DROP CONSTRAINT IF EXISTS observations_observation_type_check;

ALTER TABLE observations
  ADD CONSTRAINT observations_observation_type_check
  CHECK (observation_type IN ('FINANCIAL_METRIC_OBSERVATION','TRADE_FLOW_OBSERVATION','PORT_ACTIVITY_OBSERVATION','ROUTE_OBSERVATION','ENERGY_PRICE_OBSERVATION','COMMODITY_PRICE_OBSERVATION','MINERAL_SUPPLY_OBSERVATION','CAPEX_OBSERVATION','INVENTORY_OBSERVATION','BACKLOG_OBSERVATION','CUSTOMER_CONCENTRATION_OBSERVATION','POLICY_OBSERVATION','PROCUREMENT_OBSERVATION','FACILITY_PROFILE_OBSERVATION'));

-- 0013_edge_intelligence_context
CREATE TABLE IF NOT EXISTS edge_strength_estimates (
  strength_id TEXT PRIMARY KEY,
  identity_key TEXT NOT NULL,
  edge_id TEXT NOT NULL REFERENCES edges(edge_id) ON DELETE CASCADE,
  strength_kind TEXT NOT NULL CHECK (strength_kind IN ('share','spend_band','dependency','capacity','qualitative')),
  value NUMERIC,
  lower_bound NUMERIC,
  upper_bound NUMERIC,
  unit TEXT,
  evidence_id TEXT REFERENCES evidence(evidence_id),
  method TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_edge_strength_identity ON edge_strength_estimates(identity_key);
CREATE INDEX IF NOT EXISTS idx_edge_strength_edge ON edge_strength_estimates(edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_strength_evidence ON edge_strength_estimates(evidence_id) WHERE evidence_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS edge_freshness (
  edge_id TEXT PRIMARY KEY REFERENCES edges(edge_id) ON DELETE CASCADE,
  last_verified_at TIMESTAMPTZ NOT NULL,
  decay_model TEXT NOT NULL CHECK (decay_model IN ('methodology.v1')),
  age_days INTEGER NOT NULL CHECK (age_days >= 0),
  freshness_score REAL NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 1),
  computed_at TIMESTAMPTZ NOT NULL,
  source_evidence_id TEXT REFERENCES evidence(evidence_id),
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_edge_freshness_score ON edge_freshness(freshness_score);
CREATE INDEX IF NOT EXISTS idx_edge_freshness_verified ON edge_freshness(last_verified_at);

-- 0014_risk_views
CREATE TABLE IF NOT EXISTS risk_views (
  risk_view_id TEXT PRIMARY KEY,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  model_version TEXT NOT NULL,
  inputs_fingerprint TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_views_scope ON risk_views(scope_kind, scope_id, generated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_risk_views_scope_model_inputs ON risk_views(scope_kind, scope_id, model_version, inputs_fingerprint);

CREATE TABLE IF NOT EXISTS risk_metrics (
  metric_id TEXT PRIMARY KEY,
  risk_view_id TEXT NOT NULL REFERENCES risk_views(risk_view_id) ON DELETE CASCADE,
  metric_kind TEXT NOT NULL CHECK (metric_kind IN ('supplier_concentration_hhi','single_source_exposure','path_redundancy','node_knockout_reach','node_knockout_weighted_impact','betweenness_centrality','freshness_adjusted_exposure','observation_anomaly','financial_metric_peer_zscore')),
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  component_id TEXT REFERENCES components(component_id),
  value NUMERIC,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_risk_metrics_view ON risk_metrics(risk_view_id);
CREATE INDEX IF NOT EXISTS idx_risk_metrics_component ON risk_metrics(component_id) WHERE component_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_risk_metric_identity ON risk_metrics(
  risk_view_id,
  metric_kind,
  subject_kind,
  subject_id,
  COALESCE(component_id, '')
);

-- 0015_alert_candidates
CREATE TABLE IF NOT EXISTS alert_candidates (
  alert_id TEXT PRIMARY KEY,
  alert_kind TEXT NOT NULL CHECK (alert_kind IN ('observation_anomaly','source_failure','component_risk','policy_constraint')),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','suppressed')),
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  observation_id TEXT REFERENCES observations(observation_id),
  risk_view_id TEXT REFERENCES risk_views(risk_view_id) ON DELETE SET NULL,
  risk_metric_id TEXT REFERENCES risk_metrics(metric_id) ON DELETE SET NULL,
  change_id TEXT REFERENCES change_records(change_id) ON DELETE SET NULL,
  source_event_id TEXT,
  source_adapter_id TEXT,
  detected_at TIMESTAMPTZ NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_alert_candidates_dedupe ON alert_candidates(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_alert_candidates_status ON alert_candidates(status, severity, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_candidates_scope ON alert_candidates(scope_kind, scope_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_candidates_source ON alert_candidates(source_adapter_id, detected_at DESC) WHERE source_adapter_id IS NOT NULL;

-- 0016_source_check_jobs
CREATE TABLE IF NOT EXISTS source_check_jobs (
  job_id TEXT PRIMARY KEY,
  check_target_id TEXT NOT NULL REFERENCES source_check_targets(check_target_id) ON DELETE CASCADE,
  source_adapter_id TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','failed','succeeded','dead')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  backoff_base_minutes INT NOT NULL DEFAULT 1 CHECK (backoff_base_minutes > 0),
  backoff_max_minutes INT NOT NULL DEFAULT 60 CHECK (backoff_max_minutes > 0),
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_check_jobs_active_target
  ON source_check_jobs(check_target_id)
  WHERE status IN ('pending','in_progress','failed');

CREATE INDEX IF NOT EXISTS idx_source_check_jobs_due
  ON source_check_jobs(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_source_check_jobs_target
  ON source_check_jobs(check_target_id, created_at DESC);

-- 0017_source_monitoring_controls
ALTER TABLE source_policies
  ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  ADD COLUMN IF NOT EXISTS backoff_base_minutes INT NOT NULL DEFAULT 1 CHECK (backoff_base_minutes > 0),
  ADD COLUMN IF NOT EXISTS backoff_max_minutes INT NOT NULL DEFAULT 60 CHECK (backoff_max_minutes > 0);

ALTER TABLE source_check_targets
  ADD COLUMN IF NOT EXISTS check_cadence_minutes INT CHECK (check_cadence_minutes IS NULL OR check_cadence_minutes > 0),
  ADD COLUMN IF NOT EXISTS jitter_minutes INT CHECK (jitter_minutes IS NULL OR jitter_minutes >= 0),
  ADD COLUMN IF NOT EXISTS max_attempts INT CHECK (max_attempts IS NULL OR max_attempts > 0),
  ADD COLUMN IF NOT EXISTS backoff_base_minutes INT CHECK (backoff_base_minutes IS NULL OR backoff_base_minutes > 0),
  ADD COLUMN IF NOT EXISTS backoff_max_minutes INT CHECK (backoff_max_minutes IS NULL OR backoff_max_minutes > 0);

ALTER TABLE source_check_jobs
  ADD COLUMN IF NOT EXISTS backoff_base_minutes INT NOT NULL DEFAULT 1 CHECK (backoff_base_minutes > 0),
  ADD COLUMN IF NOT EXISTS backoff_max_minutes INT NOT NULL DEFAULT 60 CHECK (backoff_max_minutes > 0);

-- 0018_edge_calibration
CREATE TABLE IF NOT EXISTS edge_calibration_labels (
  label_id TEXT PRIMARY KEY,
  edge_id TEXT NOT NULL REFERENCES edges(edge_id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES evidence(evidence_id) ON DELETE SET NULL,
  label TEXT NOT NULL CHECK (label IN ('correct','incorrect','uncertain')),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN ('extraction_error','entity_resolution_error','source_error','staleness_error','semantic_misread','other')),
  CHECK ((label = 'incorrect' AND error_category IS NOT NULL) OR (label <> 'incorrect' AND error_category IS NULL)),
  reviewer TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  rationale TEXT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_edge_calibration_label_with_evidence ON edge_calibration_labels(edge_id, evidence_id, reviewer)
WHERE evidence_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_edge_calibration_label_without_evidence ON edge_calibration_labels(edge_id, reviewer)
WHERE evidence_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_edge_calibration_labels_edge ON edge_calibration_labels(edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_calibration_labels_reviewed_at ON edge_calibration_labels(reviewed_at DESC);

CREATE TABLE IF NOT EXISTS edge_calibration_runs (
  run_id TEXT PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  model_version TEXT NOT NULL,
  inputs_fingerprint TEXT NOT NULL,
  min_evidence_level SMALLINT NOT NULL CHECK (min_evidence_level BETWEEN 1 AND 5),
  sample_size INT NOT NULL,
  evaluated_count INT NOT NULL,
  correct_count INT NOT NULL,
  incorrect_count INT NOT NULL,
  uncertain_count INT NOT NULL,
  precision NUMERIC,
  reliability_buckets JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_edge_calibration_run_inputs ON edge_calibration_runs(model_version, inputs_fingerprint);
CREATE INDEX IF NOT EXISTS idx_edge_calibration_runs_generated_at ON edge_calibration_runs(generated_at DESC);

CREATE TABLE IF NOT EXISTS edge_calibration_run_items (
  run_id TEXT NOT NULL REFERENCES edge_calibration_runs(run_id) ON DELETE CASCADE,
  label_id TEXT NOT NULL REFERENCES edge_calibration_labels(label_id) ON DELETE CASCADE,
  edge_id TEXT NOT NULL REFERENCES edges(edge_id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES evidence(evidence_id) ON DELETE SET NULL,
  evidence_level SMALLINT NOT NULL,
  predicted_confidence REAL NOT NULL CHECK (predicted_confidence >= 0 AND predicted_confidence <= 1),
  confidence_bucket TEXT NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('correct','incorrect','uncertain')),
  error_category TEXT CHECK (error_category IS NULL OR error_category IN ('extraction_error','entity_resolution_error','source_error','staleness_error','semantic_misread','other')),
  CHECK ((label = 'incorrect' AND error_category IS NOT NULL) OR (label <> 'incorrect' AND error_category IS NULL)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_calibration_run_items_edge ON edge_calibration_run_items(edge_id);
CREATE INDEX IF NOT EXISTS idx_edge_calibration_run_items_bucket ON edge_calibration_run_items(run_id, confidence_bucket);

-- 0019_risk_metric_kind_contract
ALTER TABLE risk_metrics DROP CONSTRAINT IF EXISTS risk_metrics_metric_kind_check;
ALTER TABLE risk_metrics ADD CONSTRAINT risk_metrics_metric_kind_check
CHECK (metric_kind IN ('supplier_concentration_hhi','single_source_exposure','path_redundancy','node_knockout_reach','node_knockout_weighted_impact','betweenness_centrality','freshness_adjusted_exposure','observation_anomaly','financial_metric_peer_zscore'));

-- 0020_weighted_node_knockout_metric
ALTER TABLE risk_metrics DROP CONSTRAINT IF EXISTS risk_metrics_metric_kind_check;
ALTER TABLE risk_metrics ADD CONSTRAINT risk_metrics_metric_kind_check
CHECK (metric_kind IN ('supplier_concentration_hhi','single_source_exposure','path_redundancy','node_knockout_reach','node_knockout_weighted_impact','betweenness_centrality','freshness_adjusted_exposure','observation_anomaly','financial_metric_peer_zscore'));

-- 0021_financial_metric_observation_type
ALTER TABLE observations
  DROP CONSTRAINT IF EXISTS observations_observation_type_check;

ALTER TABLE observations
  ADD CONSTRAINT observations_observation_type_check
  CHECK (observation_type IN ('FINANCIAL_METRIC_OBSERVATION','TRADE_FLOW_OBSERVATION','PORT_ACTIVITY_OBSERVATION','ROUTE_OBSERVATION','ENERGY_PRICE_OBSERVATION','COMMODITY_PRICE_OBSERVATION','MINERAL_SUPPLY_OBSERVATION','CAPEX_OBSERVATION','INVENTORY_OBSERVATION','BACKLOG_OBSERVATION','CUSTOMER_CONCENTRATION_OBSERVATION','POLICY_OBSERVATION','PROCUREMENT_OBSERVATION','FACILITY_PROFILE_OBSERVATION'));

-- 0022_financial_peer_metric_kind
ALTER TABLE risk_metrics DROP CONSTRAINT IF EXISTS risk_metrics_metric_kind_check;
ALTER TABLE risk_metrics ADD CONSTRAINT risk_metrics_metric_kind_check
CHECK (metric_kind IN ('supplier_concentration_hhi','single_source_exposure','path_redundancy','node_knockout_reach','node_knockout_weighted_impact','betweenness_centrality','freshness_adjusted_exposure','observation_anomaly','financial_metric_peer_zscore'));

-- 0023_source_event_check_target
ALTER TABLE source_change_events
  ADD COLUMN IF NOT EXISTS check_target_id TEXT;

CREATE INDEX IF NOT EXISTS idx_source_change_events_check_target
  ON source_change_events(check_target_id, detected_at DESC);

-- 0024_source_event_check_target_loose_ref
ALTER TABLE source_change_events
  DROP CONSTRAINT IF EXISTS source_change_events_check_target_id_fkey;

-- 0025_source_check_job_lease
ALTER TABLE source_check_jobs
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_source_check_jobs_lease
  ON source_check_jobs(status, lease_expires_at)
  WHERE status = 'in_progress';

-- 0026_claim_human_edit_guard
ALTER TABLE claims
  ADD COLUMN IF NOT EXISTS last_human_edit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_human_editor TEXT;

CREATE INDEX IF NOT EXISTS idx_claims_last_human_edit
  ON claims(last_human_edit_at)
  WHERE last_human_edit_at IS NOT NULL;

-- 0027_observation_calibration
CREATE TABLE IF NOT EXISTS observation_calibration_labels (
  label_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(observation_id) ON DELETE CASCADE,
  candidate_id TEXT,
  label TEXT NOT NULL CHECK (label IN ('useful_signal','background_context','needs_context','not_useful')),
  reviewer TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  rationale TEXT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_observation_calibration_label_reviewer ON observation_calibration_labels(observation_id, reviewer);
CREATE INDEX IF NOT EXISTS idx_observation_calibration_labels_observation ON observation_calibration_labels(observation_id);
CREATE INDEX IF NOT EXISTS idx_observation_calibration_labels_label ON observation_calibration_labels(label);
CREATE INDEX IF NOT EXISTS idx_observation_calibration_labels_reviewed_at ON observation_calibration_labels(reviewed_at DESC);

-- 0028_ranking_calibration
CREATE TABLE IF NOT EXISTS ranking_calibration_labels (
  label_id TEXT PRIMARY KEY,
  ranking_context_id TEXT NOT NULL,
  ranking_kind TEXT NOT NULL,
  model_version TEXT NOT NULL,
  candidate_entity_id TEXT NOT NULL,
  candidate_rank INT NOT NULL CHECK (candidate_rank > 0),
  label TEXT NOT NULL CHECK (label IN ('useful_target','wrong_direction','brand_center_bias','needs_more_context','not_relevant')),
  reviewer TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  rationale TEXT,
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ranking_calibration_label_reviewer
  ON ranking_calibration_labels(ranking_context_id, candidate_entity_id, reviewer);
CREATE INDEX IF NOT EXISTS idx_ranking_calibration_labels_context
  ON ranking_calibration_labels(ranking_context_id);
CREATE INDEX IF NOT EXISTS idx_ranking_calibration_labels_label
  ON ranking_calibration_labels(label);
CREATE INDEX IF NOT EXISTS idx_ranking_calibration_labels_reviewed_at
  ON ranking_calibration_labels(reviewed_at DESC);

-- 0029_policy_constraint_alert_kind
ALTER TABLE alert_candidates
  DROP CONSTRAINT IF EXISTS alert_candidates_alert_kind_check;

ALTER TABLE alert_candidates
  ADD CONSTRAINT alert_candidates_alert_kind_check
  CHECK (alert_kind IN ('observation_anomaly','source_failure','component_risk','policy_constraint'));

-- 0030_ai_analysis_runs
CREATE TABLE IF NOT EXISTS ai_analysis_runs (
  run_id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL CHECK (node_id IN ('company_context_explanation_v0','reasoning_walkthrough_explanation_v0')),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('company','component','edge','claim','policy')),
  scope_id TEXT NOT NULL CHECK (length(scope_id) > 0),
  status TEXT NOT NULL CHECK (status IN ('queued','in_progress','succeeded','failed','blocked_missing_configuration','cannot_conclude')),
  provider TEXT NOT NULL CHECK (provider IN ('none','openai','anthropic','deepseek','custom')),
  model TEXT,
  provider_request_id TEXT,
  input_refs TEXT[] NOT NULL DEFAULT '{}',
  guardrail_refs TEXT[] NOT NULL DEFAULT '{}',
  cannot_conclude TEXT[] NOT NULL DEFAULT '{}',
  prompt_sha256 TEXT,
  output_sha256 TEXT,
  output_summary TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_analysis_runs_scope_idx
  ON ai_analysis_runs(scope_kind, scope_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_analysis_runs_status_idx
  ON ai_analysis_runs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_analysis_runs_node_idx
  ON ai_analysis_runs(node_id, created_at DESC);

-- 0031_research_runs
CREATE TABLE IF NOT EXISTS research_runs (
  run_id TEXT PRIMARY KEY,
  company_query TEXT NOT NULL,
  company_entity_id TEXT REFERENCES entity_master(entity_id),
  depth INT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN (
      'accepted',
      'queued_source_checks',
      'in_progress',
      'succeeded',
      'cannot_conclude',
      'failed',
      'blocked'
    )
  ),
  bootstrap_status TEXT NOT NULL,
  source_target_namespace TEXT NOT NULL,
  source_check_target_ids TEXT[] NOT NULL DEFAULT '{}',
  error_message TEXT,
  attrs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_research_runs_company ON research_runs(company_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_runs_status ON research_runs(status, updated_at DESC);

`;
