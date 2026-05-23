import { describe, expect, it } from "vitest";
import { formatCliError } from "../../apps/cli/src/cli-utils.js";

describe("CLI error formatting", () => {
  it("turns nested connection refusal into an actionable message", () => {
    const message = formatCliError({
      errors: [
        {
          code: "ECONNREFUSED",
          address: "127.0.0.1",
          port: 5432
        }
      ]
    });

    expect(message).toContain("A local database service is not reachable.");
    expect(message).toContain("POSTGRES_URL");
    expect(message).toContain("NEO4J_URI");
    expect(message).toContain("pnpm cli preview sec-edgar --cik 0001045810 --entity ENT-NVIDIA --format json");
  });

  it("preserves ordinary error messages", () => {
    expect(formatCliError(new Error("bad input"))).toBe("bad input");
  });
});
