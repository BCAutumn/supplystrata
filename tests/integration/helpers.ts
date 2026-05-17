import { createPool } from "@supplystrata/db";

export async function canConnectToIntegrationDatabase(): Promise<boolean> {
  const pool = createPool();
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}
