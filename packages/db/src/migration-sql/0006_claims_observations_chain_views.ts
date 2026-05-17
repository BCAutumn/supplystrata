export const migration0006ClaimsObservationsChainViewsSql = `
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
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','rejected')),
  evidence_level SMALLINT NOT NULL CHECK (evidence_level BETWEEN 1 AND 5),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  is_inferred BOOLEAN NOT NULL,
  generated_by TEXT NOT NULL,
  last_verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (edge_id IS NOT NULL OR subject_id IS NOT NULL OR object_id IS NOT NULL OR component_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_claims_edge ON claims(edge_id);
CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject_id);
CREATE INDEX IF NOT EXISTS idx_claims_object ON claims(object_id);
CREATE INDEX IF NOT EXISTS idx_claims_component ON claims(component_id);
CREATE INDEX IF NOT EXISTS idx_claims_status ON claims(status);

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
    (semantic_layer = 'edge' AND edge_id IS NOT NULL)
    OR (semantic_layer = 'claim' AND claim_id IS NOT NULL)
    OR (semantic_layer = 'observation' AND observation_id IS NOT NULL)
    OR (semantic_layer = 'lead' AND lead_id IS NOT NULL)
    OR (semantic_layer = 'unknown' AND unknown_id IS NOT NULL)
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
`;
