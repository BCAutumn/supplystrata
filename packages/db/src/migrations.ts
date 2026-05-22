import type { DbClient } from "./client.js";
import { migration0001EntityCoreSql } from "./migration-sql/0001_entity_core.js";
import { migration0002DocumentsGraphSql } from "./migration-sql/0002_documents_graph.js";
import { migration0003SourceMonitoringSql } from "./migration-sql/0003_source_monitoring.js";
import { migration0004ReviewQualitySql } from "./migration-sql/0004_review_quality.js";
import { migration0005RemoveLegacyReviewQueueSql } from "./migration-sql/0005_remove_legacy_review_queue.js";
import { migration0006ClaimsObservationsChainViewsSql } from "./migration-sql/0006_claims_observations_chain_views.js";
import { migration0007SourceCheckTargetsSql } from "./migration-sql/0007_source_check_targets.js";
import { migration0008ClaimDraftsSql } from "./migration-sql/0008_claim_drafts.js";
import { migration0009ReviewQueueHardeningSql } from "./migration-sql/0009_review_queue_hardening.js";
import { migration0010GraphProjectionJobsSql } from "./migration-sql/0010_graph_projection_jobs.js";
import { sql as migration0011GraphProjectionInProgressSql } from "./migration-sql/0011_graph_projection_in_progress.js";
import { sql as migration0012ObservationTypeContractSql } from "./migration-sql/0012_observation_type_contract.js";
import { sql as migration0013EdgeIntelligenceContextSql } from "./migration-sql/0013_edge_intelligence_context.js";
import { sql as migration0014RiskViewsSql } from "./migration-sql/0014_risk_views.js";
import { sql as migration0015AlertCandidatesSql } from "./migration-sql/0015_alert_candidates.js";
import { sql as migration0016SourceCheckJobsSql } from "./migration-sql/0016_source_check_jobs.js";
import { sql as migration0017SourceMonitoringControlsSql } from "./migration-sql/0017_source_monitoring_controls.js";
import { sql as migration0018EdgeCalibrationSql } from "./migration-sql/0018_edge_calibration.js";
import { sql as migration0019RiskMetricKindContractSql } from "./migration-sql/0019_risk_metric_kind_contract.js";
import { sql as migration0020WeightedNodeKnockoutMetricSql } from "./migration-sql/0020_weighted_node_knockout_metric.js";
import { sql as migration0021FinancialMetricObservationTypeSql } from "./migration-sql/0021_financial_metric_observation_type.js";
import { sql as migration0022FinancialPeerMetricKindSql } from "./migration-sql/0022_financial_peer_metric_kind.js";
import { sql as migration0023SourceEventCheckTargetSql } from "./migration-sql/0023_source_event_check_target.js";
import { sql as migration0024SourceEventCheckTargetLooseRefSql } from "./migration-sql/0024_source_event_check_target_loose_ref.js";
import { sql as migration0025SourceCheckJobLeaseSql } from "./migration-sql/0025_source_check_job_lease.js";

export interface Migration {
  readonly id: string;
  readonly description: string;
  readonly sql: string;
}

const MIGRATIONS: readonly Migration[] = [
  {
    id: "0001_entity_core",
    description: "Create entity, alias, and component taxonomy tables.",
    sql: migration0001EntityCoreSql
  },
  {
    id: "0002_documents_graph",
    description: "Create document, evidence, edge, and change-record tables.",
    sql: migration0002DocumentsGraphSql
  },
  {
    id: "0003_source_monitoring",
    description: "Create source health, fetch-run, version, and change-event tables.",
    sql: migration0003SourceMonitoringSql
  },
  {
    id: "0004_review_quality",
    description: "Create unknown-map, review-candidate, rejection, and pending-entity tables.",
    sql: migration0004ReviewQualitySql
  },
  {
    id: "0005_remove_legacy_review_queue",
    description: "Remove obsolete extraction_review_queue after review_candidates became the single review store.",
    sql: migration0005RemoveLegacyReviewQueueSql
  },
  {
    id: "0006_claims_observations_chain_views",
    description: "Create claim, observation, lead, and chain-view contract tables.",
    sql: migration0006ClaimsObservationsChainViewsSql
  },
  {
    id: "0007_source_check_targets",
    description: "Create configurable source check targets for scheduled monitoring.",
    sql: migration0007SourceCheckTargetsSql
  },
  {
    id: "0008_claim_drafts",
    description: "Allow reviewed semantic changes to create non-active claim drafts.",
    sql: migration0008ClaimDraftsSql
  },
  {
    id: "0009_review_queue_hardening",
    description: "Add pending entity uniqueness needed for atomic upsert and review queue hardening.",
    sql: migration0009ReviewQueueHardeningSql
  },
  {
    id: "0010_graph_projection_jobs",
    description: "Create durable GraphStore projection retry jobs.",
    sql: migration0010GraphProjectionJobsSql
  },
  {
    id: "0011_graph_projection_in_progress",
    description: "Treat in-progress GraphStore projection jobs as active for uniqueness.",
    sql: migration0011GraphProjectionInProgressSql
  },
  {
    id: "0012_observation_type_contract",
    description: "Synchronize observations.observation_type check constraint with core OBSERVATION_TYPES.",
    sql: migration0012ObservationTypeContractSql
  },
  {
    id: "0013_edge_intelligence_context",
    description: "Create edge strength and freshness context tables for intelligence views.",
    sql: migration0013EdgeIntelligenceContextSql
  },
  {
    id: "0014_risk_views",
    description: "Create deterministic risk view and metric tables.",
    sql: migration0014RiskViewsSql
  },
  {
    id: "0015_alert_candidates",
    description: "Create deterministic alert candidate table.",
    sql: migration0015AlertCandidatesSql
  },
  {
    id: "0016_source_check_jobs",
    description: "Create durable source check worker jobs.",
    sql: migration0016SourceCheckJobsSql
  },
  {
    id: "0017_source_monitoring_controls",
    description: "Add configurable source monitoring cadence and retry controls.",
    sql: migration0017SourceMonitoringControlsSql
  },
  {
    id: "0018_edge_calibration",
    description: "Create edge calibration labels, runs, and reliability buckets.",
    sql: migration0018EdgeCalibrationSql
  },
  {
    id: "0019_risk_metric_kind_contract",
    description: "Synchronize risk_metrics.metric_kind check constraint with core RISK_METRIC_KINDS.",
    sql: migration0019RiskMetricKindContractSql
  },
  {
    id: "0020_weighted_node_knockout_metric",
    description: "Allow weighted node knockout propagation metrics in risk views.",
    sql: migration0020WeightedNodeKnockoutMetricSql
  },
  {
    id: "0021_financial_metric_observation_type",
    description: "Allow SEC company facts financial metric observations.",
    sql: migration0021FinancialMetricObservationTypeSql
  },
  {
    id: "0022_financial_peer_metric_kind",
    description: "Allow financial peer comparison metrics in risk views.",
    sql: migration0022FinancialPeerMetricKindSql
  },
  {
    id: "0023_source_event_check_target",
    description: "Link source change events back to source check targets.",
    sql: migration0023SourceEventCheckTargetSql
  },
  {
    id: "0024_source_event_check_target_loose_ref",
    description: "Keep source change event target refs compatible with manual source checks.",
    sql: migration0024SourceEventCheckTargetLooseRefSql
  },
  {
    id: "0025_source_check_job_lease",
    description: "Add source check job leases so crashed workers cannot block targets forever.",
    sql: migration0025SourceCheckJobLeaseSql
  }
];

interface MigrationRow {
  migration_id: string;
}

export async function runMigrations(client: DbClient): Promise<{ applied: string[]; skipped: string[] }> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('supplystrata:migrate', 0))");
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       migration_id TEXT PRIMARY KEY,
       description TEXT NOT NULL,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`
  );

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const migration of MIGRATIONS) {
    const existing = await client.query<MigrationRow>("SELECT migration_id FROM schema_migrations WHERE migration_id = $1", [migration.id]);
    if (existing.rows[0] !== undefined) {
      skipped.push(migration.id);
      continue;
    }
    await client.query(migration.sql);
    await client.query("INSERT INTO schema_migrations (migration_id, description) VALUES ($1,$2)", [migration.id, migration.description]);
    applied.push(migration.id);
  }
  return { applied, skipped };
}
