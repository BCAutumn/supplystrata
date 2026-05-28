import type { PingToolResult } from "../definitions/ping-tool.js";

export function createPingToolResult(): PingToolResult {
  return {
    ok: true,
    message: "pong"
  };
}
