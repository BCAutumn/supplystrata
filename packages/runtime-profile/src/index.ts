export type RuntimeModeId = "preview" | "workbench_snapshot" | "truth_store" | "graph_projection";
export type RuntimeModeStatus = "ready" | "available_after_input" | "requires_service" | "optional";

export interface RuntimeProfileInput {
  checked_at: string;
  postgres_url: string;
  neo4j_uri: string;
  checked_db: boolean;
  db_reachable: boolean | null;
  workbench_path: string;
  workbench_exists: boolean;
}

export interface RuntimeDoctorMode {
  id: RuntimeModeId;
  status: RuntimeModeStatus;
  docker_required: false;
  summary: string;
  command: string;
  requires: string[];
}

export interface RuntimeDoctorReport extends RuntimeProfileInput {
  schema_version: "1.0.0";
  modes: RuntimeDoctorMode[];
}

// 纯运行形态评估：不读文件、不连数据库，方便 CLI、前端安装向导和宿主 app 共用同一套判断。
export function buildRuntimeDoctorReport(input: RuntimeProfileInput): RuntimeDoctorReport {
  return {
    schema_version: "1.0.0",
    ...input,
    modes: runtimeModes(input)
  };
}

export function runtimeModes(input: Pick<RuntimeProfileInput, "workbench_path" | "workbench_exists" | "db_reachable" | "checked_db">): RuntimeDoctorMode[] {
  const truthStoreStatus: RuntimeModeStatus = input.checked_db ? (input.db_reachable === true ? "ready" : "requires_service") : "available_after_input";
  return [
    {
      id: "preview",
      status: "ready",
      docker_required: false,
      summary: "实时抓取/解析/规则抽取，不落库，不写 GraphStore。",
      command: "pnpm --silent cli preview sec-edgar --cik <cik> --entity <entity-id> --format markdown",
      requires: ["Node.js", "pnpm", "network for live source fetches"]
    },
    {
      id: "workbench_snapshot",
      status: input.workbench_exists ? "ready" : "available_after_input",
      docker_required: false,
      summary: "消费已有 Workbench JSON，生成静态 research snapshot，不连接 Postgres / Neo4j。",
      command: `pnpm --silent cli research from-workbench --workbench ${input.workbench_path} --out reports/research-snapshot`,
      requires: ["Node.js", "pnpm", `Workbench JSON at ${input.workbench_path}`]
    },
    {
      id: "truth_store",
      status: truthStoreStatus,
      docker_required: false,
      summary: "完整持久化研究链路；需要 SQL truth store。内置 adapter 是 Postgres，但服务可以来自本机、远程或宿主 app。",
      command: "pnpm --silent cli research run --company <query> --out reports/research-pack",
      requires: ["POSTGRES_URL reachable", "migrated schema", "seeded entities/components"]
    },
    {
      id: "graph_projection",
      status: "optional",
      docker_required: false,
      summary: "GraphStore 是可插拔物化视图；Neo4j 只是内置 adapter，只有 graph rebuild/check 或图查询需要。",
      command: "pnpm --silent cli graph check --format markdown",
      requires: ["DatabaseStore", "GraphStore adapter, for example Neo4j"]
    }
  ];
}
