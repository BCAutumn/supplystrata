import { describe, expect, it } from "vitest";
import { agentLlmOptions } from "../../apps/agent-cli/src/provider.js";
import { runAgentCli } from "../../apps/agent-cli/src/main.js";

describe("agent cli", () => {
  it("builds disabled llm-helper options for provider none", () => {
    expect(agentLlmOptions({ provider: "none", generatedAt: "2026-05-29T00:00:00.000Z" })).toEqual({
      disabled: true,
      generated_at: "2026-05-29T00:00:00.000Z"
    });
  });

  it("fails fast when a configured provider is missing credentials", () => {
    expect(() => agentLlmOptions({ provider: "custom", baseUrl: "http://127.0.0.1:9999/v1", generatedAt: "2026-05-29T00:00:00.000Z" })).toThrow(
      "requires a configured API key"
    );
  });

  it("keeps unsupported non-compatible providers out of the CLI boundary", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const exitCode = await runAgentCli(["--company", "NVIDIA", "--provider", "anthropic"], {
      stdout,
      stderr
    });

    expect(exitCode).toBe(1);
    expect(stdout.text).toBe("");
    expect(stderr.text).toContain("Provider anthropic is not supported");
  });

  it("prints a cannot_conclude report against the fixture MCP runtime without a provider", async () => {
    const stdout = new MemoryWriter();
    const stderr = new MemoryWriter();
    const exitCode = await runAgentCli(["--company", "NVIDIA", "--provider", "none", "--mcp-runtime", "fixture"], {
      stdout,
      stderr
    });

    expect(exitCode).toBe(2);
    expect(stderr.text).toBe("");
    expect(stdout.text).toContain("## cannot_conclude");
    expect(stdout.text).toContain("No citation-backed");
  }, 20_000);
});

class MemoryWriter {
  text = "";

  write(chunk: string): boolean {
    this.text += chunk;
    return true;
  }
}
