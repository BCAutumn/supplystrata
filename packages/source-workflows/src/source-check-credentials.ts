import type { SourceCheckCredentialRequirement } from "@supplystrata/source-connectors";

export const OPENDART_CREDENTIALS: readonly SourceCheckCredentialRequirement[] = [
  { env_key: "OPENDART_API_KEY", required: true, description: "OpenDART official API key used for Korean disclosure list monitoring." }
];

export const EDINET_CREDENTIALS: readonly SourceCheckCredentialRequirement[] = [
  { env_key: "EDINET_API_KEY", required: true, description: "Japan FSA EDINET API v2 key used for documents.json daily filing list monitoring." }
];

export const CENSUS_TRADE_CREDENTIALS: readonly SourceCheckCredentialRequirement[] = [
  { env_key: "CENSUS_API_KEY", required: true, description: "U.S. Census API key used for international trade observations." }
];

export const OSH_CREDENTIALS: readonly SourceCheckCredentialRequirement[] = [
  { env_key: "OSH_API_TOKEN", required: true, description: "Open Supply Hub API token used for facility search observations and review candidates." }
];
