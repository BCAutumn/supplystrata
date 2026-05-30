import { createHash } from "node:crypto";
import { fetchBytesWithTimeout, type SourceSnapshotStore } from "@supplystrata/source-adapter-runtime";

// 上游抖动时最多回溯多少天复用旧快照。国家级登记目录变动缓慢，两周内的快照仍可用，
// 但超出窗口就宁可失败（交由调用方降级），避免静默使用过期数据。
const DEFAULT_OFFLINE_FALLBACK_DAYS = 14;

export interface DirectorySnapshotInput {
  url: string;
  userAgent: string;
  sourceLabel: string;
  storagePrefix: string;
  extension: string;
  now: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  snapshotStore?: SourceSnapshotStore;
  offlineFallbackDays?: number;
}

// 国家级目录（OpenDART corpCode、TWSE/EDINET/HKEX 全量列表）变动缓慢但单份较大。
// 先读当天 FS 对象存储快照，命中即复用；未命中才实拉并落盘。这样每天最多下载一次，
// 跨进程/跨重启共享，且原始 blob 不进 Postgres。上游抓取失败时回溯最近一份快照离线兜底。
export async function loadOrFetchDirectorySnapshot(input: DirectorySnapshotInput): Promise<Uint8Array> {
  const partition = snapshotPartition(input.now);
  if (input.snapshotStore !== undefined) {
    const cached = await input.snapshotStore.readLatest({
      storagePrefix: input.storagePrefix,
      partition,
      extension: input.extension
    });
    if (cached !== undefined) return cached;
  }

  try {
    const bytes = await fetchBytesWithTimeout(input.url, {
      userAgent: input.userAgent,
      timeoutMs: input.timeoutMs ?? 20_000,
      sourceLabel: input.sourceLabel,
      ...(input.headers === undefined ? {} : { headers: input.headers })
    });
    if (input.snapshotStore !== undefined) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await input.snapshotStore.put(`${input.storagePrefix}/${partition}/${sha256}.${input.extension}`, bytes);
    }
    return bytes;
  } catch (error) {
    if (input.snapshotStore !== undefined) {
      const fallback = await readMostRecentDirectorySnapshot(input.snapshotStore, {
        storagePrefix: input.storagePrefix,
        extension: input.extension,
        now: input.now,
        maxLookbackDays: input.offlineFallbackDays ?? DEFAULT_OFFLINE_FALLBACK_DAYS
      });
      if (fallback !== undefined) return fallback;
    }
    throw error;
  }
}

export interface MostRecentDirectorySnapshotInput {
  storagePrefix: string;
  extension: string;
  now: string;
  maxLookbackDays?: number;
}

// 从昨天起逐日回溯，复用最近一份已落盘的快照（绕过共享 SourceSnapshotStore 只能按分区读的限制）。
export async function readMostRecentDirectorySnapshot(
  snapshotStore: SourceSnapshotStore,
  input: MostRecentDirectorySnapshotInput
): Promise<Uint8Array | undefined> {
  const baseDay = snapshotPartition(input.now);
  const lookback = input.maxLookbackDays ?? DEFAULT_OFFLINE_FALLBACK_DAYS;
  for (let offset = 1; offset <= lookback; offset += 1) {
    const partition = shiftPartition(baseDay, -offset);
    const cached = await snapshotStore.readLatest({ storagePrefix: input.storagePrefix, partition, extension: input.extension });
    if (cached !== undefined) return cached;
  }
  return undefined;
}

function snapshotPartition(now: string): string {
  const day = now.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`Directory snapshot partition requires an ISO timestamp, got: ${now}`);
  return day;
}

function shiftPartition(day: string, deltaDays: number): string {
  const millis = Date.parse(`${day}T00:00:00.000Z`) + deltaDays * 86_400_000;
  return new Date(millis).toISOString().slice(0, 10);
}
