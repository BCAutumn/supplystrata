import { sourceCredentialRequirement } from "@supplystrata/config";
import type { SourceCheckCredentialRequirement } from "@supplystrata/source-connectors";

export const OPENDART_CREDENTIALS: readonly SourceCheckCredentialRequirement[] = [sourceCredentialRequirement("OPENDART_API_KEY")];

export const EDINET_CREDENTIALS: readonly SourceCheckCredentialRequirement[] = [sourceCredentialRequirement("EDINET_API_KEY")];

export const CENSUS_TRADE_CREDENTIALS: readonly SourceCheckCredentialRequirement[] = [sourceCredentialRequirement("CENSUS_API_KEY")];

export const OSH_CREDENTIALS: readonly SourceCheckCredentialRequirement[] = [sourceCredentialRequirement("OSH_API_TOKEN")];
