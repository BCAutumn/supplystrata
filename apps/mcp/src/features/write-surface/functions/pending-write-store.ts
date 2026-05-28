import { randomUUID } from "node:crypto";

import type { McpPendingActionToolName, PendingWriteAction, PendingWriteRecord, PendingWriteStore } from "../definitions/write-surface.js";

const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;

export function createInMemoryPendingWriteStore(ttlMs: number = DEFAULT_PENDING_TTL_MS): PendingWriteStore {
  const records = new Map<string, PendingWriteRecord>();

  return {
    create(action, now) {
      const pendingId = `PENDING-${randomUUID()}`;
      const record: PendingWriteRecord = {
        pending_id: pendingId,
        confirmation_token: randomUUID(),
        created_at: now,
        expires_at: new Date(Date.parse(now) + ttlMs).toISOString(),
        action
      };
      records.set(pendingId, record);
      return record;
    },
    consume(input) {
      const record = records.get(input.pending_id);
      if (record === undefined) return null;
      if (!isPendingRecordUsable(record, input.tool_name, input.confirmation_token, input.now)) {
        if (isExpired(record, input.now)) records.delete(input.pending_id);
        return null;
      }
      records.delete(input.pending_id);
      return record;
    }
  };
}

function isPendingRecordUsable(record: PendingWriteRecord, toolName: McpPendingActionToolName, token: string, now: string): boolean {
  return record.action.tool_name === toolName && record.confirmation_token === token && !isExpired(record, now);
}

function isExpired(record: PendingWriteRecord, now: string): boolean {
  return Date.parse(now) > Date.parse(record.expires_at);
}
