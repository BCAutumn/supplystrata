import { describe, expect, it } from "vitest";
import { discoverWorldBankPinkSheetLinks } from "@supplystrata/sources-worldbank-pink";

describe("worldbank-pink source adapter", () => {
  it("discovers monthly and annual Pink Sheet XLSX links from the official commodity page HTML", () => {
    const links = discoverWorldBankPinkSheetLinks(`
      <a href="https://thedocs.worldbank.org/en/doc/example/related/CMO-Historical-Data-Monthly.xlsx">monthly</a>
      <a href="https://thedocs.worldbank.org/en/doc/example/related/CMO-Historical-Data-Annual.xlsx">annual</a>
    `);

    expect(links.monthlyUrl).toBe("https://thedocs.worldbank.org/en/doc/example/related/CMO-Historical-Data-Monthly.xlsx");
    expect(links.annualUrl).toBe("https://thedocs.worldbank.org/en/doc/example/related/CMO-Historical-Data-Annual.xlsx");
  });

  it("fails fast when the official page no longer exposes the monthly workbook link", () => {
    expect(() => discoverWorldBankPinkSheetLinks("<html></html>")).toThrow("monthly Pink Sheet XLSX link");
  });
});
