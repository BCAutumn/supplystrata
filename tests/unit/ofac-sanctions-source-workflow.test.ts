import { describe, expect, it } from "vitest";
import { matchOfacSanctionsEntries, ofacSanctionsAdapter, parseOfacSdnEntries } from "@supplystrata/source-workflows";

const FIXTURE_XML = new TextEncoder().encode(`
  <sdnList>
    <sdnEntry>
      <uid>123</uid>
      <lastName>ACME SEMICONDUCTOR CO., LTD.</lastName>
      <sdnType>Entity</sdnType>
      <programList>
        <program>TEST-SANCTIONS</program>
      </programList>
      <akaList>
        <aka>
          <uid>456</uid>
          <lastName>ACME SEMI</lastName>
        </aka>
      </akaList>
    </sdnEntry>
    <sdnEntry>
      <uid>789</uid>
      <firstName>Jane</firstName>
      <lastName>Example</lastName>
      <sdnType>Individual</sdnType>
    </sdnEntry>
  </sdnList>
`);

describe("ofac sanctions source workflow", () => {
  it("parses OFAC SDN XML entries into policy-constraint-ready rows", () => {
    expect(parseOfacSdnEntries(FIXTURE_XML)).toEqual([
      {
        uid: "123",
        primary_name: "ACME SEMICONDUCTOR CO., LTD.",
        sdn_type: "Entity",
        programs: ["TEST-SANCTIONS"],
        aliases: ["ACME SEMI"]
      },
      {
        uid: "789",
        primary_name: "Jane Example",
        sdn_type: "Individual",
        programs: [],
        aliases: []
      }
    ]);
  });

  it("matches target names exactly after normalization and does not infer clean status from silence", () => {
    const matches = matchOfacSanctionsEntries(FIXTURE_XML, {
      targetNames: ["ACME Semiconductor Co Ltd", "No Match Corp"]
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      target_name: "ACME Semiconductor Co Ltd",
      matched_name: "ACME SEMICONDUCTOR CO., LTD.",
      match_source: "primary_name",
      entry: { uid: "123" }
    });
  });

  it("normalizes OFAC snapshots as non-fact policy documents", async () => {
    const normalized = await ofacSanctionsAdapter.normalize(
      {
        doc_id: "DOC-OFAC",
        source_adapter_id: "ofac-sanctions",
        url: "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML",
        fetched_at: "2026-05-27T00:00:00.000Z",
        bytes_sha256: "sha",
        storage_key: "policy/ofac/sdn/current/sha.xml",
        body: FIXTURE_XML,
        metadata: { source_date: "2026-05-27" }
      },
      { userAgent: "SupplyStrata test@example.com", now: () => new Date("2026-05-27T00:00:00.000Z") }
    );

    expect(normalized.source_adapter_id).toBe("ofac-sanctions");
    expect(normalized.document_type).toBe("manual");
    expect(normalized.text).toContain("cannot create supply-chain fact edges");
    expect(normalized.metadata["observation_policy"]).toBe("policy_constraint_cannot_create_supply_chain_edge");
  });
});
