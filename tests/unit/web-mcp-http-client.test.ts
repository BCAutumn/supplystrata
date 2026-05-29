import { describe, expect, it } from "vitest";
import { toScbomDocument } from "@supplystrata/workbench-export";
import type { ScbomMcpResourceTransport } from "@supplystrata/web/mcp-http-client";
import { readScbomCompanyResource, StreamableHttpScbomResourceTransport } from "@supplystrata/web/mcp-http-client";
import { workbenchScbomFixture } from "./workbench-scbom-fixture.js";

describe("SCBOM MCP HTTP browser client", () => {
  it("reads the SCBOM company resource through an injected transport", async () => {
    const transport = new MockResourceTransport({
      contents: [{ text: JSON.stringify(toScbomDocument(workbenchScbomFixture())) }]
    });

    const document = await readScbomCompanyResource({ companyId: "ENT-NVIDIA", transport });

    expect(transport.uris).toEqual(["supplystrata://scbom/company/ENT-NVIDIA"]);
    expect(document.schema_version).toBe("0.0.1");
  });

  it("reports an explicit error when the resource response is not SCBOM JSON", async () => {
    const transport = new MockResourceTransport({ contents: [] });

    await expect(readScbomCompanyResource({ companyId: "ENT-NVIDIA", transport })).rejects.toThrow("did not return a valid SCBOM document");
  });

  it("requires explicit opt-in for remote or cross-origin endpoints", () => {
    expect(() => new StreamableHttpScbomResourceTransport({ endpoint: "https://example.com/mcp" })).toThrow("allowRemoteEndpoint");
    expect(() => new StreamableHttpScbomResourceTransport({ endpoint: "https://example.com/mcp", allowRemoteEndpoint: true })).not.toThrow();
  });
});

class MockResourceTransport implements ScbomMcpResourceTransport {
  readonly uris: string[] = [];

  constructor(private readonly response: unknown) {}

  async readResource(uri: string): Promise<unknown> {
    this.uris.push(uri);
    return this.response;
  }
}
