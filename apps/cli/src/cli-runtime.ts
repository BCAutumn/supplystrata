import { loadEnv } from "@supplystrata/config";
import { createDatabaseStore, type DatabaseStore } from "@supplystrata/db/write";

export async function withDatabase<T>(fn: (store: DatabaseStore) => Promise<T>): Promise<T> {
  const store = createDatabaseStore({ connectionString: loadEnv().POSTGRES_URL });
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}
