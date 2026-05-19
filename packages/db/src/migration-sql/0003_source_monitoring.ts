export const migration0003SourceMonitoringSql = `
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
`;
