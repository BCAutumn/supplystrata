import { loadEnv } from "@supplystrata/config";
import { sourceWorkflowAdapterContextInput } from "@supplystrata/source-workflows";
import { currentIsoTimestamp } from "./cli-clock.js";

export interface CliSourceWorkflowRuntime {
  adapterContextInput: ReturnType<typeof sourceWorkflowAdapterContextInput>;
  seedRootDir: string;
}

export function sourceWorkflowRuntime(): CliSourceWorkflowRuntime {
  return {
    adapterContextInput: sourceWorkflowAdapterContextInput(loadEnv(), { now: currentIsoTimestamp() }),
    // CLI 是 app 边界，允许在这里把调用目录显式注入给下游 workflow。
    seedRootDir: process.cwd()
  };
}
