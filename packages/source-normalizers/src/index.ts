import { type DocumentType, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { parseHtml } from "@supplystrata/parsers-html";
import { chunkText, normalizeText } from "@supplystrata/parsers-text";

export interface HtmlDocumentNormalizationInput {
  raw: RawDocument<Uint8Array>;
  documentType: DocumentType;
  defaultPrimaryEntityId?: string;
  defaultSourceDate?: string;
}

export interface TextDocumentNormalizationInput {
  raw: RawDocument<Uint8Array>;
  documentType: DocumentType;
  text: string;
  parserVersion: string;
  language?: string;
  primaryEntityId?: string;
  sourceDate?: string;
  extraMetadata?: Record<string, string | number | boolean>;
}

export function normalizeHtmlDocument(input: HtmlDocumentNormalizationInput): NormalizedDocument {
  const primaryEntityId = stringMetadata(input.raw, "primary_entity_id") ?? input.defaultPrimaryEntityId;
  const sourceDate = stringMetadata(input.raw, "source_date") ?? input.defaultSourceDate;
  // adapter 只提供来源语义，HTML 清洗和切块统一交给 parser，避免 pipeline 私下补解析。
  return parseHtml({
    raw: input.raw,
    documentType: input.documentType,
    ...(primaryEntityId === undefined ? {} : { primaryEntityId }),
    ...(sourceDate === undefined ? {} : { sourceDate })
  });
}

export function normalizeTextDocument(input: TextDocumentNormalizationInput): NormalizedDocument {
  const text = normalizeText(input.text);
  const chunks = chunkText(text, input.raw.doc_id, 7000);
  // 结构化 JSON 也落成可审计文本，保证 review / search / source-monitor 消费同一份契约。
  return {
    doc_id: input.raw.doc_id,
    source_adapter_id: input.raw.source_adapter_id,
    document_type: input.documentType,
    language: input.language ?? "en",
    fetched_at: input.raw.fetched_at,
    source_url: input.raw.url,
    storage_key: input.raw.storage_key,
    bytes_sha256: input.raw.bytes_sha256,
    text,
    chunks,
    metadata: {
      ...input.raw.metadata,
      parser_version: input.parserVersion,
      ...(input.extraMetadata ?? {})
    },
    ...(input.primaryEntityId === undefined ? {} : { primary_entity_id: input.primaryEntityId }),
    ...(input.sourceDate === undefined ? {} : { source_date: input.sourceDate })
  };
}

export function stringMetadata(raw: RawDocument<Uint8Array>, key: string): string | undefined {
  const value = raw.metadata[key];
  return typeof value === "string" ? value : undefined;
}
