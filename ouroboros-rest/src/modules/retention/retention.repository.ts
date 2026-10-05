/**
 * Every statement the retention policy service issues, over V094's `retention_policies`
 * (BQ.3, [#482](https://github.com/NobuData/ouroboros/issues/482)). Statements only — the
 * defaults, the bounds and the audit are the service's.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database } from "../db/schema";

/** One stored tier. */
export interface StoredTier {
  readonly data_class: string;
  readonly days: number;
  readonly updated_by: string | null;
  readonly updated_at: Date;
}

/** One workspace's stored tier for one class — what a sweep's cutoffs are built from. */
export interface TierOverride {
  readonly organization_id: string;
  readonly days: number;
}

@Injectable()
export class RetentionRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * A workspace's stored tiers, by class.
   *
   * @param organizationId - The workspace.
   * @param trx - A transaction to read inside, locking the rows; the plain connection otherwise.
   * @returns Every tier the workspace stored. A class it never stored is absent.
   */
  async stored(organizationId: string, trx?: Transaction<Database>): Promise<StoredTier[]> {
    const query = (trx ?? this.database.db)
      .selectFrom("retention_policies")
      .select(["data_class", "days", "updated_by", "updated_at"])
      .where("organization_id", "=", organizationId)
      .orderBy("data_class");

    return trx === undefined ? query.execute() : query.forUpdate().execute();
  }

  /**
   * Every workspace's stored tier for one class.
   *
   * @param dataClass - The class.
   * @returns One row per workspace that stored a tier for it.
   */
  overrides(dataClass: string): Promise<TierOverride[]> {
    return this.database.db
      .selectFrom("retention_policies")
      .select(["organization_id", "days"])
      .where("data_class", "=", dataClass)
      .execute();
  }

  /**
   * Store a tier, replacing the workspace's previous one for the class.
   *
   * @param trx - The save's transaction.
   * @param organizationId - The workspace.
   * @param dataClass - The class.
   * @param days - The tier, already checked against its bounds.
   * @param updatedBy - Who saved it.
   * @returns When the row is written.
   */
  async upsert(
    trx: Transaction<Database>,
    organizationId: string,
    dataClass: string,
    days: number,
    updatedBy: string,
  ): Promise<void> {
    await trx
      .insertInto("retention_policies")
      .values({
        organization_id: organizationId,
        data_class: dataClass,
        days,
        updated_by: updatedBy,
      })
      .onConflict((conflict) =>
        conflict
          .columns(["organization_id", "data_class"])
          .doUpdateSet({ days, updated_by: updatedBy }),
      )
      .execute();
  }

  /**
   * Run work in one transaction.
   *
   * @param work - The statements.
   * @returns What the work returned.
   */
  transaction<T>(work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
    return this.database.transaction(work);
  }
}
