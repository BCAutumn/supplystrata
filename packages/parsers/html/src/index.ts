import * as cheerio from "cheerio";
import { type DocumentType, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { chunkText, normalizeText } from "@supplystrata/parsers-text";

type LoadedCheerio = ReturnType<typeof cheerio.load>;

export interface HtmlParseInput {
  raw: RawDocument<Uint8Array>;
  documentType: DocumentType;
  primaryEntityId?: string;
  sourceDate?: string;
}

export function parseHtml(input: HtmlParseInput): NormalizedDocument {
  const html = new TextDecoder("utf-8").decode(input.raw.body);
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header").remove();
  const title = normalizeText($("title").first().text());
  const bodyText = extractReadableBodyText($);
  const text = title.length > 0 ? `${title}\n\n${bodyText}` : bodyText;
  const chunks = chunkText(text, input.raw.doc_id, 7000);

  return {
    doc_id: input.raw.doc_id,
    source_adapter_id: input.raw.source_adapter_id,
    document_type: input.documentType,
    language: "en",
    fetched_at: input.raw.fetched_at,
    source_url: input.raw.url,
    storage_key: input.raw.storage_key,
    bytes_sha256: input.raw.bytes_sha256,
    text,
    chunks,
    metadata: input.raw.metadata,
    ...(input.primaryEntityId === undefined ? {} : { primary_entity_id: input.primaryEntityId }),
    ...(input.sourceDate === undefined ? {} : { source_date: input.sourceDate })
  };
}

function extractReadableBodyText($: LoadedCheerio): string {
  const blockSelector = [
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "caption",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "li",
    "main",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul"
  ].join(",");

  // Cheerio 的 .text() 会把相邻块级元素直接拼接；先插入换行，避免 cite_text 出现 `products.Competition` 这类粘连。
  $(blockSelector).each((_, element) => {
    const node = $(element);
    node.before("\n");
    node.after("\n");
  });

  return normalizeText($("body").text());
}
