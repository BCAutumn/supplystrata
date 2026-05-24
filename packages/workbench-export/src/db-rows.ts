import type pg from "pg";
import type {
  ClaimDtoSource,
  EvidenceDtoSource,
  OfficialSignalDispositionDtoSource,
  ReviewCandidateDtoSource,
  SourceHealthDtoSource,
  UnknownDtoSource
} from "./dto-source-records.js";

export interface ClaimDbRow extends pg.QueryResultRow, ClaimDtoSource {}

export interface EvidenceDbRow extends pg.QueryResultRow, EvidenceDtoSource {}

export interface UnknownDbRow extends pg.QueryResultRow, UnknownDtoSource {}

export interface SourceHealthDbRow extends pg.QueryResultRow, SourceHealthDtoSource {}

export interface ReviewCandidateDbRow extends pg.QueryResultRow, ReviewCandidateDtoSource {}

export interface OfficialSignalDispositionDbRow extends pg.QueryResultRow, OfficialSignalDispositionDtoSource {}
