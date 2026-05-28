import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { createSupplyStrataMcpServer, type McpWriteExecutors } from "@supplystrata/mcp";

describe("mcp pending write gate", () => {
  it("requires confirmation before executing every write tool action", async () => {
    const executed: string[] = [];
    const { server } = createSupplyStrataMcpServer({
      now: () => "2026-05-28T00:00:00.000Z",
      writeExecutors: fakeWriteExecutors(executed)
    });
    const client = new Client({
      name: "supplystrata-mcp-pending-test-client",
      version: "0.1.0"
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      await expectRequiresConfirmation(client, "start_research_session", { company: "NVIDIA", depth: 2 });
      await expectRequiresConfirmation(client, "run_source_check", { check_target_ids: ["target-1"] });
      await expectRequiresConfirmation(client, "review.approve", { review_id: "REV-1", reviewer: "tester", reason: "evidence checked" });
      await expectRequiresConfirmation(client, "review.reject", { review_id: "REV-2", reviewer: "tester", reason: "bad evidence" });

      expect(executed).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

async function expectRequiresConfirmation(client: Client, name: string, args: Record<string, unknown>): Promise<void> {
  const content = await callStructured(client, name, args);
  expect(content["status"]).toBe("requires_confirmation");
  expect(typeof content["pending_id"]).toBe("string");
  expect(typeof content["confirmation_token"]).toBe("string");
  expect(typeof content["summary_of_action"]).toBe("string");
}

function fakeWriteExecutors(executed: string[]): Partial<McpWriteExecutors> {
  return {
    start_research_session: async () => {
      executed.push("start_research_session");
      return { ok: true };
    },
    run_source_check: async () => {
      executed.push("run_source_check");
      return { ok: true };
    },
    "review.approve": async () => {
      executed.push("review.approve");
      return { ok: true };
    },
    "review.reject": async () => {
      executed.push("review.reject");
      return { ok: true };
    }
  };
}

async function callStructured(client: Client, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  if (!("content" in result) || !isRecord(result.structuredContent)) throw new Error(`Expected ${name} to return structured content.`);
  return result.structuredContent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
