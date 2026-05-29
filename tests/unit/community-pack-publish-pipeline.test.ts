import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("community-pack publish pipeline", () => {
  it("documents a reproducible artifact build in GitHub Actions", async () => {
    const workflow = await readFile(".github/workflows/community-pack.yml", "utf8");

    expect(workflow).toContain("pnpm --silent cli community-pack build");
    expect(workflow).toContain("generated_at");
    expect(workflow).toContain("COMMUNITY_PACK_GENERATED_AT");
    expect(workflow).toContain("pnpm pack:checksums");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("SEC_USER_AGENT");
  });

  it("keeps checksum generation as a local script", async () => {
    const script = await readFile("scripts/write-community-pack-checksums.mjs", "utf8");

    expect(script).toContain("manifest.json");
    expect(script).toContain("SHA256SUMS");
    expect(script).toContain("sha256");
  });
});
