import type { SourceRegistryEntry } from "./types.js";
import { ENTITY_AND_FACILITY_SOURCES } from "./registry-entity-facility.js";
import { LEAD_AND_MANUAL_SOURCES } from "./registry-lead-manual-sources.js";
import { OBSERVATION_SOURCES } from "./registry-observation-sources.js";
import { OFFICIAL_DISCLOSURE_SOURCES } from "./registry-official-disclosure.js";

export const SOURCE_REGISTRY = [
  ...OFFICIAL_DISCLOSURE_SOURCES,
  ...ENTITY_AND_FACILITY_SOURCES,
  ...OBSERVATION_SOURCES,
  ...LEAD_AND_MANUAL_SOURCES
] as const satisfies readonly SourceRegistryEntry[];
