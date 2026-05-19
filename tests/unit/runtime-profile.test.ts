import { describe, expect, it } from "vitest";
import { buildRuntimeDoctorReport, runtimeModes } from "@supplystrata/runtime-profile";

describe("runtime-profile", () => {
  it("marks preview and workbench snapshot ready without database services", () => {
    const modes = runtimeModes({
      workbench_path: "reports/nvidia-workbench.json",
      workbench_exists: true,
      checked_db: false,
      db_reachable: null
    });

    expect(modes.find((mode) => mode.id === "preview")?.status).toBe("ready");
    expect(modes.find((mode) => mode.id === "workbench_snapshot")?.status).toBe("ready");
    expect(modes.find((mode) => mode.id === "truth_store")?.status).toBe("available_after_input");
    expect(modes.every((mode) => mode.docker_required === false)).toBe(true);
  });

  it("marks truth-store mode as requiring a service when the database ping fails", () => {
    const report = buildRuntimeDoctorReport({
      checked_at: "2026-01-01T00:00:00.000Z",
      postgres_url: "postgres://example.invalid/supplystrata",
      neo4j_uri: "bolt://localhost:7687",
      checked_db: true,
      db_reachable: false,
      workbench_path: "reports/missing.json",
      workbench_exists: false
    });

    expect(report.schema_version).toBe("1.0.0");
    expect(report.modes.find((mode) => mode.id === "workbench_snapshot")?.status).toBe("available_after_input");
    expect(report.modes.find((mode) => mode.id === "truth_store")?.status).toBe("requires_service");
    expect(report.modes.find((mode) => mode.id === "graph_projection")?.status).toBe("optional");
  });
});
