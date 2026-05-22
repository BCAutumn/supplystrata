import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadEnv,
  missingSourceCredentialRequirements,
  requireSourceCredential,
  sourceCredentialRequirement,
  type SourceCredentialEnvKey
} from "@supplystrata/config";

const SOURCE_CREDENTIAL_KEYS: readonly SourceCredentialEnvKey[] = [
  "OPENDART_API_KEY",
  "EDINET_API_KEY",
  "OPEN_CORPORATES_API_TOKEN",
  "COMPANIES_HOUSE_API_KEY",
  "CENSUS_API_KEY",
  "OSH_API_TOKEN"
];

describe("source credential config", () => {
  it("loads source API credentials from the unified local file without overriding non-empty env values", () => {
    const snapshot = snapshotEnv();
    const directory = mkdtempSync(join(tmpdir(), "supplystrata-source-credentials-"));
    const credentialsPath = join(directory, "source-credentials.local.json");
    try {
      clearSourceCredentialEnv();
      process.env["EDINET_API_KEY"] = "env-edinet-key";
      writeFileSync(
        credentialsPath,
        JSON.stringify(
          {
            schema_version: "1.0.0",
            credentials: {
              OPENDART_API_KEY: "file-opendart-key",
              EDINET_API_KEY: "file-edinet-key",
              CENSUS_API_KEY: ""
            }
          },
          null,
          2
        )
      );

      const env = loadEnv({ dotenvPath: join(directory, "missing.env"), sourceCredentialsPath: credentialsPath });

      expect(env.OPENDART_API_KEY).toBe("file-opendart-key");
      expect(env.EDINET_API_KEY).toBe("env-edinet-key");
      expect(env.CENSUS_API_KEY).toBeUndefined();
      expect(requireSourceCredential(env, "OPENDART_API_KEY")).toBe("file-opendart-key");
    } finally {
      restoreEnv(snapshot);
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps connector credential requirements tied to the central source credential definitions", () => {
    expect(sourceCredentialRequirement("OPENDART_API_KEY")).toEqual({
      env_key: "OPENDART_API_KEY",
      required: true,
      description: "OpenDART official API key used for Korean disclosure list monitoring."
    });
  });

  it("resolves missing connector credentials from an explicit Env object", () => {
    const snapshot = snapshotEnv();
    try {
      clearSourceCredentialEnv();
      const env = loadEnv({ dotenvPath: "/tmp/supplystrata-missing.env", sourceCredentialsPath: "/tmp/supplystrata-missing-credentials.json" });
      const missing = missingSourceCredentialRequirements(env, [
        sourceCredentialRequirement("OPENDART_API_KEY"),
        sourceCredentialRequirement("EDINET_API_KEY")
      ]);

      expect(missing.map((requirement) => requirement.env_key)).toEqual(["OPENDART_API_KEY", "EDINET_API_KEY"]);
    } finally {
      restoreEnv(snapshot);
    }
  });
});

function snapshotEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {
    SUPPLYSTRATA_SOURCE_CREDENTIALS_FILE: process.env["SUPPLYSTRATA_SOURCE_CREDENTIALS_FILE"]
  };
  for (const key of SOURCE_CREDENTIAL_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function clearSourceCredentialEnv(): void {
  delete process.env["SUPPLYSTRATA_SOURCE_CREDENTIALS_FILE"];
  for (const key of SOURCE_CREDENTIAL_KEYS) {
    delete process.env[key];
  }
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
