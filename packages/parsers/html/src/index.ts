import * as cheerio from "cheerio";
import { type DocumentType, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { chunkText, normalizeText } from "@supplystrata/parsers-text";

type LoadedCheerio = ReturnType<typeof cheerio.load>;
const HTML_PARSER_VERSION = "html-parser-v1";

export interface HtmlParseInput {
  raw: RawDocument<Uint8Array>;
  documentType: DocumentType;
  primaryEntityId?: string;
  sourceDate?: string;
}

// 把 HTML/iXBRL 字节抽成可读正文（title + 块级换行规整）。SEC HTML 与 EDINET iXBRL（type=1 ZIP 里的
// PublicDoc/*.htm）共用同一套清洗，避免每个来源各写一份 HTML 解析。返回纯文本，由调用方决定语言/切块/文档类型。
export function extractReadableHtmlText(bytes: Uint8Array): string {
  const html = new TextDecoder("utf-8").decode(bytes);
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer, header").remove();
  const title = normalizeText($("title").first().text());
  const bodyText = extractReadableBodyText($);
  return title.length > 0 ? `${title}\n\n${bodyText}` : bodyText;
}

export function parseHtml(input: HtmlParseInput): NormalizedDocument {
  const text = extractReadableHtmlText(input.raw.body);
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
    metadata: { ...input.raw.metadata, parser_version: HTML_PARSER_VERSION },
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
