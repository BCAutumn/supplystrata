export const migration0001EntityCoreSql = `
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
`;
