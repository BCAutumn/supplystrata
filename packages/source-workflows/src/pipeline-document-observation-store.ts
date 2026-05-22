import { persistDocumentObservations } from "@supplystrata/pipeline";
import type { SourceDocumentObservationStore } from "./document-observation-port.js";

// 监控 runner 只依赖窄写入 port；当前默认实现复用 pipeline 的 normalized-document 内核。
export const PIPELINE_DOCUMENT_OBSERVATION_STORE: SourceDocumentObservationStore = {
  persistDocumentObservations
};
