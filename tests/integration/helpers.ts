import { createDatabaseStore } from "@supplystrata/db/write";
import { loadEnv } from "@supplystrata/config";

export function createIntegrationDatabaseStore(): ReturnType<typeof createDatabaseStore> {
  return createDatabaseStore({ connectionString: loadEnv().POSTGRES_URL });
}

export async function canConnectToIntegrationDatabase(): Promise<boolean> {
  const pool = createIntegrationDatabaseStore();
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.close();
  }
}
