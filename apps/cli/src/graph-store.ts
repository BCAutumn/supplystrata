import { loadEnv } from "@supplystrata/config";
import { createNeo4jDriver, Neo4jGraphStore } from "@supplystrata/graph";

export function createCliNeo4jGraphStore(): Neo4jGraphStore {
  const env = loadEnv();
  return new Neo4jGraphStore(
    createNeo4jDriver({
      uri: env.NEO4J_URI,
      user: env.NEO4J_USER,
      password: env.NEO4J_PASSWORD
    })
  );
}
