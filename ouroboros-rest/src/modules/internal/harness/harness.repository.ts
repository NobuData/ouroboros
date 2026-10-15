/**
 * The harness credentials' SQL — DH.2 ([#1303](https://github.com/NobuData/ouroboros/issues/1303)).
 *
 * ```
 * runOf          runs                                  workspace + status of the run to mint for
 * insert         harness_credentials                   one row per minted token (hash only)
 * byHash         harness_credentials ⋈ runs            what a facade request's token is bound to
 * byId           harness_credentials                   for revoke and reconcile
 * revoke         harness_credentials.revoked_at        set once
 * recorded       token_usage by credential             per (alias, model) sums, for reconcile
 * reconciled     harness_credentials.reconciliation    stored with its time
 * ```
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../../db/db.service";
import type { RunStatus } from "../../db/schema";

/** A run a credential may be minted for. */
export interface CredentialRun {
  readonly organizationId: string;
  readonly status: RunStatus;
}

/** A stored credential, without its hash. */
export interface CredentialBinding {
  readonly id: string;
  readonly organizationId: string;
  readonly runId: string;
  readonly stage: string;
  readonly alias: string;
  readonly attempt: number;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  /** The bound run's status, read with the credential. */
  readonly runStatus: RunStatus;
}

/** What one credential's calls recorded for one alias and model. */
export interface RecordedUsage {
  readonly alias: string | null;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly calls: number;
}

/** The columns a {@link StoredCredential} is read from. */
const CREDENTIAL_COLUMNS = [
  "h.id",
  "h.organization_id",
  "h.run_id",
  "h.stage",
  "h.alias",
  "h.attempt",
  "h.expires_at",
  "h.revoked_at",
  "r.status as run_status",
] as const;

@Injectable()
export class HarnessRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * The run a credential is to be minted for.
   *
   * @param runId - `runs.id`.
   * @returns Its workspace and status, or undefined when there is no such run.
   */
  async runOf(runId: string): Promise<CredentialRun | undefined> {
    const row = await this.database.db
      .selectFrom("runs")
      .select(["organization_id", "status"])
      .where("id", "=", runId)
      .executeTakeFirst();

    return row === undefined
      ? undefined
      : { organizationId: row.organization_id, status: row.status };
  }

  /**
   * Store a minted credential.
   *
   * @param row - What it is bound to, its hash and its expiry.
   * @returns Its id.
   */
  async insert(row: {
    organizationId: string;
    runId: string;
    stage: string;
    alias: string;
    attempt: number;
    digest: Buffer;
    expiresAt: Date;
  }): Promise<string> {
    const inserted = await this.database.db
      .insertInto("harness_credentials")
      .values({
        organization_id: row.organizationId,
        run_id: row.runId,
        stage: row.stage,
        alias: row.alias,
        attempt: row.attempt,
        token_hash: row.digest,
        expires_at: row.expiresAt,
      })
      .returning("id")
      .executeTakeFirstOrThrow();

    return inserted.id;
  }

  /**
   * The credential a token hashes to.
   *
   * @param digest - The presented token's sha-256.
   * @returns The credential and its run's status, or undefined.
   */
  async byDigest(digest: Buffer): Promise<CredentialBinding | undefined> {
    const row = await this.database.db
      .selectFrom("harness_credentials as h")
      .innerJoin("runs as r", "r.id", "h.run_id")
      .select(CREDENTIAL_COLUMNS)
      .where("h.token_hash", "=", digest)
      .executeTakeFirst();

    return row === undefined ? undefined : stored(row);
  }

  /**
   * A credential by id.
   *
   * @param id - `harness_credentials.id`.
   * @returns The credential, or undefined.
   */
  async byId(id: string): Promise<CredentialBinding | undefined> {
    const row = await this.database.db
      .selectFrom("harness_credentials as h")
      .innerJoin("runs as r", "r.id", "h.run_id")
      .select(CREDENTIAL_COLUMNS)
      .where("h.id", "=", id)
      .executeTakeFirst();

    return row === undefined ? undefined : stored(row);
  }

  /**
   * Revoke a credential. A second revoke keeps the first time.
   *
   * @param id - `harness_credentials.id`.
   * @param at - When.
   */
  async revoke(id: string, at: Date): Promise<void> {
    await this.database.db
      .updateTable("harness_credentials")
      .set({ revoked_at: at })
      .where("id", "=", id)
      .where("revoked_at", "is", null)
      .execute();
  }

  /**
   * What a credential's calls recorded, per alias and model.
   *
   * @param binding - The credential, as bound.
   * @returns The sums, one row per (alias, model).
   */
  async recorded(binding: CredentialBinding): Promise<RecordedUsage[]> {
    const rows = await this.database.db
      .selectFrom("token_usage")
      .select([
        "alias",
        "model",
        sql<string>`sum(tokens_in)::text`.as("input_tokens"),
        sql<string>`sum(tokens_out)::text`.as("output_tokens"),
        sql<string>`sum(cache_read_tokens)::text`.as("cache_read_tokens"),
        sql<string>`sum(cache_write_tokens)::text`.as("cache_write_tokens"),
        sql<number>`count(*)::int`.as("calls"),
      ])
      .where("organization_id", "=", binding.organizationId)
      .where("harness_credential_id", "=", binding.id)
      .groupBy(["alias", "model"])
      .orderBy("model")
      .execute();

    return rows.map((row) => ({
      alias: row.alias,
      model: row.model,
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      cacheReadTokens: Number(row.cache_read_tokens),
      cacheWriteTokens: Number(row.cache_write_tokens),
      calls: row.calls,
    }));
  }

  /**
   * Store a reconciliation. A later one replaces it.
   *
   * @param id - `harness_credentials.id`.
   * @param reconciliation - The comparison.
   * @param at - When.
   */
  async reconciled(id: string, reconciliation: Record<string, unknown>, at: Date): Promise<void> {
    await this.database.db
      .updateTable("harness_credentials")
      .set({ reconciliation, reconciled_at: at })
      .where("id", "=", id)
      .execute();
  }
}

/**
 * A row as a {@link StoredCredential}.
 *
 * @param row - The selected columns.
 * @returns The credential.
 */
function stored(row: {
  id: string;
  organization_id: string;
  run_id: string;
  stage: string;
  alias: string;
  attempt: number;
  expires_at: Date;
  revoked_at: Date | null;
  run_status: RunStatus;
}): CredentialBinding {
  return {
    id: row.id,
    organizationId: row.organization_id,
    runId: row.run_id,
    stage: row.stage,
    alias: row.alias,
    attempt: row.attempt,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    runStatus: row.run_status,
  };
}
