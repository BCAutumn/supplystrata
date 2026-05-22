import { loadEnv, SOURCE_CREDENTIAL_DEFINITIONS, type Env } from "@supplystrata/config";
import type { CreateAdapterContextInput } from "@supplystrata/source-adapter-runtime";

export function sourceWorkflowAdapterContextInput(env: Env): CreateAdapterContextInput {
  return {
    userAgent: env.SEC_USER_AGENT,
    objectStoreBase: env.OBJECT_STORE_FS_BASE,
    credentials: sourceCredentialMap(env)
  };
}

export function sourceWorkflowAdapterContextInputFromEnv(): CreateAdapterContextInput {
  return sourceWorkflowAdapterContextInput(loadEnv());
}

function sourceCredentialMap(env: Env): CreateAdapterContextInput["credentials"] {
  const credentials: Record<string, string | undefined> = {};
  for (const definition of SOURCE_CREDENTIAL_DEFINITIONS) {
    credentials[definition.env_key] = env[definition.env_key];
  }
  return credentials;
}
