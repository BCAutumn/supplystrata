import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import type { ApiOperationHandlers } from "@supplystrata/api-orchestration";
import { createInMemoryPendingWriteStore, createSupplyStrataMcpServer, type McpWriteExecutors } from "@supplystrata/mcp";

describe("mcp confirmation tokens", () => {
  it("rejects invalid confirmation tokens without executing the write", async () => {
    const executed: string[] = [];
    const { server } = createSupplyStrataMcpServer({
      now: () => "2026-05-28T00:00:00.000Z",
      writeExecutors: fakeWriteExecutors(executed)
    });
    const client = new Client({ name: "supplystrata-mcp-invalid-token-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const pending = await callStructured(client, "review.approve", { review_id: "REV-1", reviewer: "tester", reason: "checked" });
      const invalid = await callStructured(client, "review.approve", {
        review_id: "REV-1",
        reviewer: "tester",
        reason: "checked",
        pending_id: pendingString(pending, "pending_id"),
        confirmation_token: "wrong-token"
      });

      expect(invalid["status"]).toBe("invalid_token");
      expect(executed).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("executes with the correct token and rejects token reuse", async () => {
    const executed: string[] = [];
    const { server } = createSupplyStrataMcpServer({
      now: () => "2026-05-28T00:00:00.000Z",
      writeExecutors: fakeWriteExecutors(executed)
    });
    const client = new Client({ name: "supplystrata-mcp-token-use-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const pending = await callStructured(client, "run_source_check", { check_target_ids: ["target-1"] });
      const args = {
        check_target_ids: ["target-1"],
        pending_id: pendingString(pending, "pending_id"),
        confirmation_token: pendingString(pending, "confirmation_token")
      };

      const executedResult = await callStructured(client, "run_source_check", args);
      const reuseResult = await callStructured(client, "run_source_check", args);

      expect(executedResult).toMatchObject({
        status: "executed",
        pending_id: args.pending_id
      });
      expect(reuseResult["status"]).toBe("invalid_token");
      expect(executed).toEqual(["run_source_check"]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("rejects expired tokens before execution", async () => {
    const executed: string[] = [];
    let now = "2026-05-28T00:00:00.000Z";
    const { server } = createSupplyStrataMcpServer({
      pendingWrites: createInMemoryPendingWriteStore(1),
      now: () => now,
      writeExecutors: fakeWriteExecutors(executed)
    });
    const client = new Client({ name: "supplystrata-mcp-expired-token-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const pending = await callStructured(client, "start_research_session", { company: "NVIDIA" });
      now = "2026-05-28T00:00:01.000Z";
      const expired = await callStructured(client, "confirm_research_session", {
        pending_id: pendingString(pending, "pending_id"),
        confirmation_token: pendingString(pending, "confirmation_token")
      });

      expect(expired["status"]).toBe("invalid_token");
      expect(executed).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("executes review decisions through api-orchestration handlers with MCP audit source", async () => {
    const bodies: unknown[] = [];
    const handlers: ApiOperationHandlers = {
      approveReviewCandidate: async (input) => {
        bodies.push(input.body);
        return {
          review_id: input.path_params["id"] ?? "REV-1",
          decision: "approved",
          status: "approved",
          fact_edge_write_allowed: false
        };
      }
    };
    const { server } = createSupplyStrataMcpServer({
      handlers,
      now: () => "2026-05-28T00:00:00.000Z"
    });
    const client = new Client({ name: "supplystrata-mcp-api-backed-review-test-client", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const pending = await callStructured(client, "review.approve", { review_id: "REV-1", reviewer: "tester", reason: "checked" });
      const confirmed = await callStructured(client, "review.approve", {
        review_id: "REV-1",
        reviewer: "tester",
        reason: "checked",
        pending_id: pendingString(pending, "pending_id"),
        confirmation_token: pendingString(pending, "confirmation_token")
      });

      expect(confirmed["status"]).toBe("executed");
      expect(bodies).toEqual([
        {
          reviewer: "tester",
          reason: "via=mcp-tool checked"
        }
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});

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

function pendingString(content: Record<string, unknown>, key: "pending_id" | "confirmation_token"): string {
  const value = content[key];
  if (typeof value !== "string") throw new Error(`Expected ${key} to be returned.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
