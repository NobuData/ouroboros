/**
 * `org_policies` statements — the read through `org_policies_effective`, the onboarding default
 * and the audited flip (V075, [#382](https://github.com/NobuData/ouroboros/issues/382)).
 *
 * V075's header gives the two write statements; this file is them.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";
import type { OrgPolicies, OrgPoliciesEffective } from "../db/schema";

/** What a flip changed — the row after it, and the value in force before it. */
export interface DryRunFlip {
  /** The row as the upsert left it. */
  readonly row: OrgPolicies;
  /** The dry-run value in force before the flip. */
  readonly previous: boolean;
  /** Whether that value was a stored row (`true`) or the view's default (`false`). */
  readonly previousExplicit: boolean;
}

/** The policy statements, as the service reaches them. */
export interface OrgPolicyStore {
  /**
   * @param organizationId - The workspace.
   * @returns Its effective policies, or undefined for a workspace that does not exist.
   */
  effective(organizationId: string): Promise<OrgPoliciesEffective | undefined>;
  /**
   * Write `dry_run = true` when the workspace has never answered; leave any answer alone.
   *
   * @param organizationId - The workspace.
   * @returns `true` when a row was written.
   */
  adoptDefault(organizationId: string): Promise<boolean>;
  /**
   * Set `dry_run`, reading the value it replaces under the row's lock.
   *
   * @param organizationId - The workspace.
   * @param dryRun - The new value.
   * @param updatedBy - Who.
   * @returns The flip.
   */
  setDryRun(organizationId: string, dryRun: boolean, updatedBy: string): Promise<DryRunFlip>;
}

@Injectable()
export class OrgPolicyRepository implements OrgPolicyStore {
  /** @param database - The connection. */
  constructor(private readonly database: DatabaseService) {}

  /** @inheritdoc */
  effective(organizationId: string): Promise<OrgPoliciesEffective | undefined> {
    return this.database.db
      .selectFrom("org_policies_effective")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();
  }

  /** @inheritdoc */
  async adoptDefault(organizationId: string): Promise<boolean> {
    const written = await this.database.db
      .insertInto("org_policies")
      .values({ organization_id: organizationId, dry_run: true })
      .onConflict((conflict) => conflict.column("organization_id").doNothing())
      .returning("organization_id")
      .executeTakeFirst();

    return written !== undefined;
  }

  /**
   * @inheritdoc
   *
   * One transaction: the row is created when absent (so there is a row to lock), locked, then
   * updated — two concurrent flips each read the value the other left, so each audit row's
   * `previous` is true. A row this call created stood for a workspace that never answered, so its
   * prior value is the view's `false`, not the column default it was written with.
   */
  setDryRun(organizationId: string, dryRun: boolean, updatedBy: string): Promise<DryRunFlip> {
    return this.database.db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto("org_policies")
        .values({ organization_id: organizationId, dry_run: true })
        .onConflict((conflict) => conflict.column("organization_id").doNothing())
        .returning("organization_id")
        .executeTakeFirst();
      const prior = await trx
        .selectFrom("org_policies")
        .select("dry_run")
        .where("organization_id", "=", organizationId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const row = await trx
        .updateTable("org_policies")
        .set({ dry_run: dryRun, updated_by: updatedBy })
        .where("organization_id", "=", organizationId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const previousExplicit = created === undefined;

      return { row, previous: previousExplicit ? prior.dry_run : false, previousExplicit };
    });
  }
}
