import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type DocumentType, type NormalizedDocument, type RawDocument } from "@supplystrata/core";
import { chunkText } from "@supplystrata/parsers-text";

const execFileAsync = promisify(execFile);
const PDF_PARSER_VERSION = "pdf-pdftotext-v1";

export interface PdfParseInput {
  raw: RawDocument<Uint8Array>;
  documentType: DocumentType;
  primaryEntityId?: string;
  sourceDate?: string;
  layout: boolean;
}

export async function extractPdfText(bytes: Uint8Array, layout = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "supplystrata-pdf-"));
  const pdfPath = join(dir, "input.pdf");
  try {
    await writeFile(pdfPath, bytes);
    const args = layout ? ["-layout", pdfPath, "-"] : [pdfPath, "-"];
    const { stdout } = await execFileAsync("pdftotext", args, { maxBuffer: 64 * 1024 * 1024 });
    return normalizePdfText(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function normalizePdfText(text: string): string {
  return text.normalize("NFKC").replace(/\r\n?/g, "\n").replace(/\uFEFF/g, "").trim();
}

export async function parsePdf(input: PdfParseInput): Promise<NormalizedDocument> {
  const text = await extractPdfText(input.raw.body, input.layout);
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
    chunks: chunkText(text, input.raw.doc_id, 7000),
    metadata: { ...input.raw.metadata, parser_version: PDF_PARSER_VERSION },
    ...(input.primaryEntityId === undefined ? {} : { primary_entity_id: input.primaryEntityId }),
    ...(input.sourceDate === undefined ? {} : { source_date: input.sourceDate })
  };
}
