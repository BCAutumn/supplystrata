import { describe, expect, it } from "vitest";
import { planSourcesForComponent, planSourcesForComponents } from "@supplystrata/source-plan";

describe("source-plan", () => {
  it("maps wafer upstream leads to official, material, and trade sources without promoting macro data to fact edges", () => {
    const plan = planSourcesForComponent("COMP-WAFER", 2);
    const byId = new Map(plan.map((item) => [item.source_id, item]));

    expect(byId.get("asml-ir")?.relation_policy).toBe("can_create_fact_edge");
    expect(byId.get("usgs-mcs")?.expected_output_layer).toBe("observation");
    expect(byId.get("un-comtrade")?.relation_policy).toBe("observation_only");
    expect(byId.get("census-trade")?.relation_policy).toBe("observation_only");
    expect(byId.get("usgs-mcs")?.target_ids).toContain("COMP-SILICON-WAFER");
  });

  it("keeps memory supplier plan entries connected to registered free source definitions", () => {
    const plan = planSourcesForComponent("COMP-MEMORY", 2);
    const byId = new Map(plan.map((item) => [item.source_id, item]));

    expect(byId.get("micron-ir")?.status).toBe("preview");
    expect(byId.get("micron-ir")?.relation_policy).toBe("can_create_fact_edge");
    expect(byId.get("micron-ir")?.expected_output_layer).toBe("edge");
  });

  it("routes manufacturing-service leads to facility, procurement, logistics, and manual BOL sources without Apple coupling by default", () => {
    const plan = planSourcesForComponent("COMP-MANUFACTURING-SERVICES", 3);
    const byId = new Map(plan.map((item) => [item.source_id, item]));

    expect(byId.has("apple-suppliers")).toBe(false);
    expect(byId.get("osh")?.expected_output_layer).toBe("observation");
    expect(byId.get("noaa-ais")?.expected_output_layer).toBe("observation");
    expect(byId.get("sam-gov")?.expected_output_layer).toBe("lead");
    expect(byId.get("import-yeti")?.relation_policy).toBe("lead_only");
  });

  it("includes Apple Supplier List only when the caller is explicitly planning an Apple chain", () => {
    const plan = planSourcesForComponent("COMP-MANUFACTURING-SERVICES", 3, ["ENT-APPLE"]);
    const apple = plan.find((item) => item.source_id === "apple-suppliers");

    expect(apple?.expected_output_layer).toBe("edge");
    expect(apple?.parent_component_ids).toContain("COMP-MANUFACTURING-SERVICES");
  });

  it("aggregates duplicated sources across multiple component inputs", () => {
    const plan = planSourcesForComponents({ component_ids: ["COMP-WAFER", "COMP-MANUFACTURING-SERVICES"], maxTierDepth: 2 });
    const sourceIds = plan.map((item) => item.source_id);

    expect(sourceIds.filter((sourceId) => sourceId === "census-trade")).toHaveLength(1);
    expect(plan.find((item) => item.source_id === "census-trade")?.target_ids.length).toBeGreaterThan(1);
  });

  it("emits Census Trade check target suggestions from component HS taxonomy when a month is provided", () => {
    const plan = planSourcesForComponents({
      component_ids: ["COMP-MEMORY"],
      maxTierDepth: 2,
      tradeObservationMonth: "2025-12",
      tradeObservationCountryCode: "5800",
      tradeObservationDirections: ["imports"]
    });
    const census = plan.find((item) => item.source_id === "census-trade");
    const target = census?.suggested_check_targets.find(
      (item) => item.target_config["commodity_code"] === "854232" && item.target_config["component_id"] === "COMP-MEMORY"
    );

    expect(target?.source_adapter_id).toBe("census-trade");
    expect(target?.target_kind).toBe("trade-flow-observation");
    expect(target?.target_config["direction"]).toBe("imports");
    expect(target?.target_config["time"]).toBe("2025-12");
    expect(target?.target_config["country_code"]).toBe("5800");
    expect(target?.target_config["scope_kind"]).toBe("component");
    expect(target?.target_config["scope_id"]).toBe("COMP-MEMORY");
  });

  it("does not emit runnable trade target suggestions without an explicit observation month", () => {
    const plan = planSourcesForComponent("COMP-MEMORY", 2);

    expect(plan.every((item) => item.suggested_check_targets.length === 0)).toBe(true);
  });

  it("emits runnable official IR disclosure target suggestions only when a year is provided", () => {
    const withoutYear = planSourcesForComponents({ component_ids: ["COMP-WAFER"], maxTierDepth: 2 });
    const withYear = planSourcesForComponents({ component_ids: ["COMP-WAFER"], maxTierDepth: 2, officialDisclosureYear: "2025" });
    const tsmcTarget = withYear.find((item) => item.source_id === "tsmc-ir")?.suggested_check_targets[0];
    const asmlTarget = withYear.find((item) => item.source_id === "asml-ir")?.suggested_check_targets[0];

    expect(withoutYear.find((item) => item.source_id === "tsmc-ir")?.suggested_check_targets).toEqual([]);
    expect(tsmcTarget).toMatchObject({
      source_adapter_id: "tsmc-ir",
      target_kind: "official-html-disclosure",
      runnable: true,
      target_config: { entity_id: "ENT-TSMC", year: 2025 }
    });
    expect(asmlTarget?.target_config["entity_id"]).toBe("ENT-ASML");
  });

  it("turns explicit target profile sources into node-specific official disclosure targets", () => {
    const withoutYear = planSourcesForComponents({
      component_ids: ["COMP-HBM"],
      maxTierDepth: 1,
      officialDisclosureTargetNodes: [
        {
          node_id: "ENT-NVIDIA",
          node_kind: "company",
          name: "NVIDIA",
          expected_source_ids: ["sec-edgar"],
          expected_source_targets: [
            {
              source_id: "sec-edgar",
              target_kind: "sec-company-filings",
              target_config: {
                cik: "0001045810",
                entity_id: "ENT-NVIDIA",
                form_types: ["10-K", "10-Q", "20-F", "8-K"],
                limit: 3
              }
            }
          ]
        },
        { node_id: "COMP-HBM", node_kind: "component", expected_source_ids: ["skhynix-ir", "micron-ir"] },
        {
          node_id: "ENT-SKHYNIX",
          node_kind: "company",
          name: "SK Hynix",
          expected_source_ids: ["dart-kr"],
          expected_source_targets: [
            {
              source_id: "dart-kr",
              target_kind: "company-filings",
              target_config: {
                corp_code: "00164779",
                entity_id: "ENT-SKHYNIX",
                disclosure_types: ["A", "B"],
                corp_cls: "Y",
                year: 2025,
                final_reports_only: "Y",
                limit: 20
              }
            }
          ]
        }
      ]
    });
    const plan = planSourcesForComponents({
      component_ids: ["COMP-HBM"],
      maxTierDepth: 1,
      officialDisclosureYear: "2025",
      officialDisclosureTargetNodes: [
        {
          node_id: "ENT-NVIDIA",
          node_kind: "company",
          name: "NVIDIA",
          expected_source_ids: ["sec-edgar"],
          expected_source_targets: [
            {
              source_id: "sec-edgar",
              target_kind: "sec-company-filings",
              target_config: {
                cik: "0001045810",
                entity_id: "ENT-NVIDIA",
                form_types: ["10-K", "10-Q", "20-F", "8-K"],
                limit: 3
              }
            }
          ]
        },
        { node_id: "COMP-HBM", node_kind: "component", expected_source_ids: ["skhynix-ir", "micron-ir"] },
        {
          node_id: "ENT-SKHYNIX",
          node_kind: "company",
          name: "SK Hynix",
          expected_source_ids: ["dart-kr"],
          expected_source_targets: [
            {
              source_id: "dart-kr",
              target_kind: "company-filings",
              target_config: {
                corp_code: "00164779",
                entity_id: "ENT-SKHYNIX",
                disclosure_types: ["A", "B"],
                corp_cls: "Y",
                year: 2025,
                final_reports_only: "Y",
                limit: 20
              }
            }
          ]
        }
      ]
    });
    const secWithoutYear = withoutYear.find((item) => item.source_id === "sec-edgar");
    const skHynixWithoutYear = withoutYear.find((item) => item.source_id === "skhynix-ir");
    const micronWithoutYear = withoutYear.find((item) => item.source_id === "micron-ir");
    const dartWithoutYear = withoutYear.find((item) => item.source_id === "dart-kr");
    const sec = plan.find((item) => item.source_id === "sec-edgar");
    const skHynix = plan.find((item) => item.source_id === "skhynix-ir");
    const micron = plan.find((item) => item.source_id === "micron-ir");
    const dart = plan.find((item) => item.source_id === "dart-kr");

    expect(secWithoutYear?.suggested_check_targets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "sec-edgar",
        target_kind: "sec-company-filings",
        runnable: true
      })
    );
    expect(skHynixWithoutYear?.suggested_check_targets).toEqual([]);
    expect(micronWithoutYear?.suggested_check_targets).toEqual([]);
    expect(dartWithoutYear?.suggested_check_targets).toEqual([]);
    expect(sec?.target_ids).toContain("ENT-NVIDIA");
    expect(sec?.suggested_check_targets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "sec-edgar",
        target_kind: "sec-company-filings",
        runnable: true,
        target_config: {
          cik: "0001045810",
          entity_id: "ENT-NVIDIA",
          form_types: ["10-K", "10-Q", "20-F", "8-K"],
          limit: 3
        }
      })
    );
    expect(skHynix?.target_ids).toContain("COMP-HBM");
    expect(skHynix?.suggested_check_targets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "skhynix-ir",
        target_kind: "official-html-disclosure",
        runnable: true,
        target_config: { entity_id: "ENT-SKHYNIX", year: 2025 }
      })
    );
    expect(dart?.target_ids).toContain("ENT-SKHYNIX");
    expect(dart?.suggested_check_targets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "dart-kr",
        target_kind: "company-filings",
        runnable: true,
        target_config: {
          corp_code: "00164779",
          entity_id: "ENT-SKHYNIX",
          disclosure_types: ["A", "B"],
          corp_cls: "Y",
          year: 2025,
          final_reports_only: "Y",
          limit: 20
        }
      })
    );
    expect(micron?.target_ids).toContain("COMP-HBM");
    expect(micron?.suggested_check_targets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "micron-ir",
        target_kind: "official-html-disclosure",
        runnable: true,
        target_config: { entity_id: "ENT-MICRON", year: 2025 }
      })
    );
  });

  it("turns explicit Apple Supplier List profile targets into review-only runnable source targets", () => {
    const plan = planSourcesForComponents({
      component_ids: ["COMP-MANUFACTURING-SERVICES"],
      maxTierDepth: 1,
      officialDisclosureTargetNodes: [
        {
          node_id: "COMP-MANUFACTURING-SERVICES",
          node_kind: "component",
          name: "Manufacturing services",
          expected_source_ids: ["apple-suppliers"],
          expected_source_targets: [
            {
              source_id: "apple-suppliers",
              target_kind: "supplier-list-review",
              target_config: {
                fiscal_year: 2022,
                entity_id: "ENT-APPLE",
                scope_kind: "component",
                scope_id: "COMP-MANUFACTURING-SERVICES",
                component_id: "COMP-MANUFACTURING-SERVICES"
              },
              reason: "Apple Supplier List target should remain review-only."
            }
          ]
        }
      ]
    });
    const apple = plan.find((item) => item.source_id === "apple-suppliers");

    expect(apple?.relation_policy).toBe("can_create_fact_edge");
    expect(apple?.suggested_check_targets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "apple-suppliers",
        target_kind: "supplier-list-review",
        runnable: true,
        target_config: {
          fiscal_year: 2022,
          entity_id: "ENT-APPLE",
          scope_kind: "component",
          scope_id: "COMP-MANUFACTURING-SERVICES",
          component_id: "COMP-MANUFACTURING-SERVICES"
        },
        reason: "Apple Supplier List target should remain review-only."
      })
    );
  });

  it("turns explicit company IR URLs into runnable source targets without guessing URLs", () => {
    const targetNodes = [
      {
        node_id: "ENT-EXAMPLE",
        node_kind: "company" as const,
        name: "Example",
        expected_source_ids: ["company-ir"],
        expected_source_targets: [
          {
            source_id: "company-ir",
            target_kind: "official-html-disclosure",
            target_config: {
              entity_id: "ENT-EXAMPLE",
              year: 2025,
              url: "https://investor.example.com/annual-report"
            },
            reason: "Explicit company IR URL should be runnable only when audited into the profile."
          }
        ]
      },
      {
        node_id: "ENT-MISSING-URL",
        node_kind: "company" as const,
        name: "Missing URL",
        expected_source_ids: ["company-ir"]
      }
    ];
    const withoutYear = planSourcesForComponents({
      component_ids: ["COMP-SERVER"],
      maxTierDepth: 1,
      officialDisclosureTargetNodes: targetNodes
    });
    const plan = planSourcesForComponents({
      component_ids: ["COMP-SERVER"],
      maxTierDepth: 1,
      officialDisclosureYear: "2026",
      officialDisclosureTargetNodes: targetNodes
    });
    const companyIrWithoutYear = withoutYear.find((item) => item.source_id === "company-ir");
    const companyIr = plan.find((item) => item.source_id === "company-ir");

    expect(companyIrWithoutYear?.suggested_check_targets).toEqual([]);
    expect(companyIr?.suggested_check_targets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "company-ir",
        target_kind: "official-html-disclosure",
        runnable: true,
        target_config: {
          entity_id: "ENT-EXAMPLE",
          year: 2026,
          url: "https://investor.example.com/annual-report"
        },
        reason: "Explicit company IR URL should be runnable only when audited into the profile."
      })
    );
    expect(companyIr?.suggested_check_targets).toHaveLength(1);
  });

  it("turns explicit EDINET daily list profile targets into annual directory monitor targets", () => {
    const targetNodes = [
      {
        node_id: "COMP-SILICON-WAFER",
        node_kind: "component" as const,
        name: "Silicon wafer",
        expected_source_ids: ["edinet"],
        expected_source_targets: [
          {
            source_id: "edinet",
            target_kind: "daily-filings",
            target_config: {
              date: "2025-06-30",
              type: 2,
              scope_kind: "component",
              scope_id: "COMP-SILICON-WAFER",
              component_id: "COMP-SILICON-WAFER",
              doc_type_codes: ["120"]
            },
            reason: "EDINET target should remain a directory monitor."
          }
        ]
      }
    ];
    const withoutYear = planSourcesForComponents({
      component_ids: ["COMP-SILICON-WAFER"],
      maxTierDepth: 1,
      officialDisclosureTargetNodes: targetNodes
    });
    const plan = planSourcesForComponents({
      component_ids: ["COMP-SILICON-WAFER"],
      maxTierDepth: 1,
      officialDisclosureYear: "2026",
      officialDisclosureTargetNodes: targetNodes
    });
    const edinetWithoutYear = withoutYear.find((item) => item.source_id === "edinet");
    const edinet = plan.find((item) => item.source_id === "edinet");

    expect(edinetWithoutYear?.suggested_check_targets).toEqual([]);
    expect(edinet?.relation_policy).toBe("can_create_fact_edge");
    expect(edinet?.suggested_check_targets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "edinet",
        target_kind: "daily-filings",
        runnable: true,
        target_config: {
          date: "2026-06-30",
          type: 2,
          scope_kind: "component",
          scope_id: "COMP-SILICON-WAFER",
          component_id: "COMP-SILICON-WAFER",
          doc_type_codes: ["120"]
        },
        reason: "EDINET target should remain a directory monitor."
      })
    );
  });

  it("turns explicit TWSE MOPS profile targets into annual electronic document directory monitors", () => {
    const targetNodes = [
      {
        node_id: "ENT-FOXCONN",
        node_kind: "company" as const,
        name: "Foxconn",
        expected_source_ids: ["company-ir", "twse-mops"],
        expected_source_targets: [
          {
            source_id: "twse-mops",
            target_kind: "electronic-documents",
            target_config: {
              stock_code: "2317",
              entity_id: "ENT-FOXCONN",
              year: 2025,
              document_kind: "F",
              limit: 50
            },
            reason: "TWSE target should remain a directory monitor."
          }
        ]
      }
    ];
    const withoutYear = planSourcesForComponents({
      component_ids: ["COMP-SERVER"],
      maxTierDepth: 1,
      officialDisclosureTargetNodes: targetNodes
    });
    const plan = planSourcesForComponents({
      component_ids: ["COMP-SERVER"],
      maxTierDepth: 1,
      officialDisclosureYear: "2026",
      officialDisclosureTargetNodes: targetNodes
    });
    const twseWithoutYear = withoutYear.find((item) => item.source_id === "twse-mops");
    const twse = plan.find((item) => item.source_id === "twse-mops");

    expect(twseWithoutYear?.suggested_check_targets).toEqual([]);
    expect(twse?.relation_policy).toBe("can_create_fact_edge");
    expect(twse?.suggested_check_targets).toContainEqual(
      expect.objectContaining({
        source_adapter_id: "twse-mops",
        target_kind: "electronic-documents",
        runnable: true,
        target_config: {
          stock_code: "2317",
          entity_id: "ENT-FOXCONN",
          year: 2026,
          document_kind: "F",
          limit: 50
        },
        reason: "TWSE target should remain a directory monitor."
      })
    );
  });

  it("emits material observation targets for USGS and runnable World Bank commodity prices without promoting them to facts", () => {
    const plan = planSourcesForComponents({
      component_ids: ["COMP-HBM"],
      maxTierDepth: 1,
      materialObservationYear: "2025",
      commodityObservationMonth: "2025-12"
    });
    const usgs = plan.find((item) => item.source_id === "usgs-mcs");
    const worldbank = plan.find((item) => item.source_id === "worldbank-pink");
    const copperPrice = worldbank?.suggested_check_targets.find((item) => item.target_config["material_id"] === "MAT-COPPER");

    expect(usgs?.relation_policy).toBe("observation_only");
    expect(worldbank?.relation_policy).toBe("observation_only");
    expect(usgs?.suggested_check_targets.some((item) => item.target_kind === "mineral-supply-observation" && item.target_config["period"] === "2025")).toBe(
      true
    );
    expect(copperPrice?.runnable).toBe(true);
    expect(copperPrice?.target_kind).toBe("commodity-price-observation");
    expect(copperPrice?.target_config["period"]).toBe("2025-12");
    expect(copperPrice?.target_config["scope_id"]).toBe("COMP-HBM");
  });
});
