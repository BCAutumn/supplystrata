export const PING_TOOL_NAME = "ping";

export interface PingToolResult extends Readonly<Record<string, unknown>> {
  readonly ok: true;
  readonly message: "pong";
}
