import type { ApplyResult, ApprovedCandidate } from "@supplystrata/core";
import type { DbTxClient } from "@supplystrata/db/write";
import type { EntityResolver } from "@supplystrata/entity-resolver";
import { applyApprovedCandidateToSql } from "./sql-store.js";

export class GraphSqlWriter {
  readonly #resolver: EntityResolver;

  constructor(resolver: EntityResolver) {
    this.#resolver = resolver;
  }

  async applyApprovedCandidate(client: DbTxClient, approved: ApprovedCandidate): Promise<Omit<ApplyResult, "graph_sync">> {
    const subject = await this.#resolver.resolve(approved.candidate.subject_resolve, { client });
    const object = await this.#resolver.resolve(approved.candidate.object_resolve, { client });
    if (subject.status !== "resolved" || subject.entity_id === undefined) {
      throw new Error(`Cannot resolve subject: ${approved.candidate.subject_resolve.surface}`);
    }
    if (object.status !== "resolved" || object.entity_id === undefined) {
      throw new Error(`Cannot resolve object: ${approved.candidate.object_resolve.surface}`);
    }
    return applyApprovedCandidateToSql(client, {
      approved,
      subject_id: subject.entity_id,
      object_id: object.entity_id
    });
  }
}
