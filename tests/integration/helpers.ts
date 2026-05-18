import { createDatabaseStore } from "@supplystrata/db";

export async function canConnectToIntegrationDatabase(): Promise<boolean> {
  const pool = createDatabaseStore();
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.close();
  }
}
