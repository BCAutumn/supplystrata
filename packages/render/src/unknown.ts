import type { OutputFormat } from "./types.js";

export interface UnknownMapItem {
  unknown_id: string;
  question: string;
  why_unknown: string;
  blocking_data_sources: string[];
  proxies: string[];
  status: string;
}

export interface UnknownMapModel {
  scope: string;
  items: UnknownMapItem[];
}

export function renderUnknownMapCard(model: UnknownMapModel, format: OutputFormat): string {
  if (format === "json") return JSON.stringify({ schema_version: "1.0.0", scope: model.scope, items: model.items }, null, 2);
  return [`# Unknown map [${model.scope}]`, "", ...model.items.flatMap((item) => [`- ${item.question}`, `  Why unknown: ${item.why_unknown}`])].join("\n");
}
