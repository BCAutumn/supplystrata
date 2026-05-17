import { describe, expect, it } from "vitest";
import { parseHtml } from "@supplystrata/parsers-html";
import { type RawDocument } from "@supplystrata/core";

function rawHtml(body: string): RawDocument<Uint8Array> {
  return {
    doc_id: "DOC-html-test",
    source_adapter_id: "test-html",
    url: "https://example.test/report.html",
    fetched_at: "2026-05-16T00:00:00.000Z",
    bytes_sha256: "sha256-test",
    storage_key: "test/report.html",
    body: new TextEncoder().encode(body),
    metadata: {}
  };
}

describe("html parser", () => {
  it("preserves readable boundaries between adjacent block elements", () => {
    const doc = parseHtml({
      raw: rawHtml(
        "<html><head><title>Annual Report</title></head><body><p>We assemble final products.</p><h2>Competition</h2><p>Markets change quickly.</p></body></html>"
      ),
      documentType: "10-K"
    });

    expect(doc.text).toContain("Annual Report");
    expect(doc.text).toContain("We assemble final products.\n\nCompetition");
    expect(doc.text).not.toContain("products.Competition");
  });
});
