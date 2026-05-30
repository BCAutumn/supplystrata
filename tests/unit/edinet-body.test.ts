import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import type { NormalizedDocument, RawDocument } from "@supplystrata/core";
import { ruleExtractors } from "@supplystrata/relation-extractor-rule";
import {
  EDINET_DEFAULT_BODY_DOC_TYPE_CODES,
  buildEdinetDocumentBodyUrl,
  normalizeEdinetBodyDocument,
  selectEdinetBodyEntries
} from "@supplystrata/source-workflows";

describe("edinet body adapter", () => {
  it("builds a type=1 body download URL with the subscription key", () => {
    const url = new URL(buildEdinetDocumentBodyUrl("S100AAAA", "test-edinet-key"));
    expect(url.origin).toBe("https://api.edinet-fsa.go.jp");
    expect(url.pathname).toBe("/api/v2/documents/S100AAAA");
    expect(url.searchParams.get("type")).toBe("1");
    expect(url.searchParams.get("Subscription-Key")).toBe("test-edinet-key");
  });

  it("selects only matching annual-report filings that ship XBRL, respecting the limit", () => {
    const payload = {
      status: "200",
      message: "OK",
      results: [
        { docId: "S100AAAA", edinetCode: "E01234", docTypeCode: "120", xbrlFlag: "1", filerName: "Shin-Etsu Chemical" },
        { docId: "S100NOXBRL", edinetCode: "E01234", docTypeCode: "120", xbrlFlag: "0", filerName: "No XBRL" },
        { docId: "S100OTHER", edinetCode: "E01234", docTypeCode: "350", xbrlFlag: "1", filerName: "Large holding report" },
        { docId: "S100OUT", edinetCode: "E09999", docTypeCode: "120", xbrlFlag: "1", filerName: "Out of scope" }
      ]
    };

    const selected = selectEdinetBodyEntries(payload, { date: "2026-06-30", edinetCodes: ["E01234"] });
    expect(selected.map((entry) => entry.docId)).toEqual(["S100AAAA"]);
    expect(EDINET_DEFAULT_BODY_DOC_TYPE_CODES).toContain("120");

    const limited = selectEdinetBodyEntries(
      { status: "200", message: "OK", results: [payload.results[0]!, { ...payload.results[0]!, docId: "S100AAAB" }] },
      { date: "2026-06-30", edinetCodes: ["E01234"], limit: 1 }
    );
    expect(limited).toHaveLength(1);
  });

  it("unzips the iXBRL body into a Japanese annual_report document", () => {
    const narrative =
      "<html><head><title>有価証券報告書</title></head><body>" +
      "<p>当社の主要な仕入先は信越化学工業株式会社です。</p>" +
      "<p>事業等のリスクとして、特定の供給業者への依存があります。</p>" +
      "</body></html>";
    const raw = edinetBodyRaw({ "XBRL/PublicDoc/0101010_honbun.htm": narrative });

    const normalized = normalizeEdinetBodyDocument(raw);

    expect(normalized.source_adapter_id).toBe("edinet");
    expect(normalized.document_type).toBe("annual_report");
    expect(normalized.language).toBe("ja");
    expect(normalized.primary_entity_id).toBe("ENT-SHINETSU");
    expect(normalized.text).toContain("有価証券報告書");
    expect(normalized.text).toContain("主要な仕入先は信越化学工業株式会社");
    expect(normalized.chunks.length).toBeGreaterThan(0);
    expect(normalized.metadata["parser_version"]).toBe("edinet-body-v1");
    expect(normalized.metadata["edinet_doc_id"]).toBe("S100AAAA");
  });

  it("ignores non-narrative files and falls back to any html when PublicDoc is absent", () => {
    const raw = edinetBodyRaw({
      "manifest.xml": "<xbrl>numbers only</xbrl>",
      "AuditDoc/cover.htm": "<html><body><p>監査報告書本文。</p></body></html>"
    });
    const normalized = normalizeEdinetBodyDocument(raw);
    expect(normalized.text).toContain("監査報告書本文");
  });

  it("throws when the body is not a ZIP archive (EDINET 200-with-JSON error)", () => {
    const raw = edinetBodyRaw({});
    raw.body = new Uint8Array(Buffer.from(JSON.stringify({ metadata: { status: "404", message: "not found" } })));
    expect(() => normalizeEdinetBodyDocument(raw)).toThrow(/not a ZIP archive/i);
  });

  it("keeps Japanese bodies inert for the English rule extractor (enters pipeline, yields no edges yet)", async () => {
    const raw = edinetBodyRaw({
      "XBRL/PublicDoc/0101010_honbun.htm": "<html><body><p>当社は半導体材料を製造しています。主要な仕入先について記載します。</p></body></html>"
    });
    const normalized = normalizeEdinetBodyDocument(raw);
    const candidates: unknown[] = [];
    for (const extractor of ruleExtractors) {
      for await (const candidate of extractor.extract(normalized)) candidates.push(candidate);
    }
    expect(candidates).toHaveLength(0);
  });
});

function edinetBodyRaw(files: Record<string, string>): RawDocument<Uint8Array> {
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])));
  return {
    doc_id: "DOC-EDINET-BODY",
    source_adapter_id: "edinet",
    url: "https://api.edinet-fsa.go.jp/api/v2/documents/S100AAAA?type=1",
    fetched_at: "2026-06-30T00:00:00.000Z",
    bytes_sha256: "sha256-body",
    storage_key: "official-disclosure/edinet/body/S100AAAA/sha256-body.zip",
    body: zipped,
    metadata: {
      task_id: "edinet-body-S100AAAA",
      document_type: "annual_report",
      edinet_doc_id: "S100AAAA",
      primary_entity_id: "ENT-SHINETSU",
      source_date: "2026-03-31",
      edinet_code: "E01234",
      edinet_doc_type_code: "120"
    }
  };
}
