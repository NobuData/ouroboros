/**
 * Every statement this module issues against `provider_connections` — one read for the
 * sweep, one read for the page, one guarded read for a credential, and the one write in this
 * service that touches the table.
 *
 * ## The sweep reads across workspaces, and that is the one place in this service that does
 *
 * Every other repository here takes an `organizationId` first, and the rule exists because
 * the caller is a request. This module's caller is a timer: nobody is signed in, there is no
 * tenant context to read, and the work is *every workspace's providers, oldest check first*.
 * {@link ProviderHealthRepository.due} is therefore unscoped by design, and the two things
 * that keep that safe are written into it — it selects no credential, and its result is
 * consumed only by the sweep, which writes back to the row it came from and answers nobody.
 *
 * The **page** read is the ordinary shape again: {@link ProviderHealthRepository.forOrganization}
 * takes a workspace and every statement carries it, because that one is a request's.
 *
 * ## `credentials_encrypted` is selected in one method and never with anything else
 *
 * {@link ProviderHealthRepository.sealedCredential} is the only statement in this module that
 * names the column, it selects nothing beside it, and it is called once per key-validation
 * check rather than once per sweep. The sweep's own read reports the column as a *boolean* —
 * `has_credential` — which is all it needs to decide whether a check is possible and is a
 * fact rather than a ciphertext. `provider-health.repository.spec.ts` compiles the other
 * statements and asserts none of them names the column, which is the same probe
 * `registry.repository.spec.ts` runs for the same reason.
 *
 * ## The write moves three columns together, because V015 requires two of them to agree
 *
 * `provider_connections_health_measured` refuses a non-empty `health` without a
 * `last_checked_at`. Writing them in one statement is what makes that constraint unreachable
 * rather than something a caller has to remember — there is no method here that sets one
 * without the other.
 */

import { Injectable } from "@nestjs/common";
import { sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { ProviderConnectionKind, ProviderConnectionStatus } from "../db/schema";
import type { ProviderHealthRow } from "./snapshot";

/** The kinds whose cutoff a due-check compares against — see `checks.ts`'s cadence classes. */
export interface DueCutoffs {
  /** Kinds on the fast cadence, and the instant before which their last check is stale. */
  readonly local: { readonly kinds: readonly ProviderConnectionKind[]; readonly before: Date };
  /** Kinds on the slow cadence, and their own, much older, cutoff. */
  readonly cloud: { readonly kinds: readonly ProviderConnectionKind[]; readonly before: Date };
}

/** One connection the sweep is about to check. */
export interface DueConnection {
  id: string;
  organization_id: string;
  kind: ProviderConnectionKind;
  base_url: string | null;
  health: Record<string, unknown>;
  /**
   * Whether the row holds a sealed credential — **not** the credential.
   *
   * A boolean because that is the whole of what the sweep needs in order to decide whether a
   * key-validation check is possible at all, and because a ciphertext selected for fifty rows
   * to be used by three is fifty ciphertexts in a process that needed none of them.
   */
  has_credential: boolean;
}

/** What one performed check has to write back. */
export interface HealthWrite {
  /** The concluded status — `active` or `error`. Never `unknown`: this service writes only what it saw. */
  readonly status: ProviderConnectionStatus;
  /** The merged `health` object, from `mergeHealth`. */
  readonly health: Record<string, unknown>;
  /** When the check finished — the check's clock, per V015's column comment. */
  readonly checkedAt: Date;
}

@Injectable()
export class ProviderHealthRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * The connections whose last check is old enough to redo, oldest first.
   *
   * **`paused` rows are excluded in the statement rather than skipped in the sweep.** V015
   * calls `paused` an operator's *intent* rather than a conclusion from a check, and the
   * honest reading of that intent is that nobody wants this provider contacted — so the rows
   * do not leave the database, and there is no code path on which a paused provider is
   * reached and then discarded.
   *
   * The two cadences are one statement with an `or` rather than two round trips: they differ
   * only in a cutoff, and a sweep that issued a query per cadence class would issue a third
   * the day a third class exists.
   *
   * @param cutoffs - The kinds on each cadence and the instant each is stale before.
   * @param limit - The most rows to return; the sweep's cap. The tail is not lost, it is
   *   reached on the next cycle — the ordering guarantees the rows that wait are the ones
   *   checked most recently.
   * @returns The rows, oldest check first and never-checked rows before all of them. Empty is
   *   the ordinary answer for a deployment whose providers were all checked a moment ago.
   */
  async due(cutoffs: DueCutoffs, limit: number): Promise<DueConnection[]> {
    return (
      this.database.db
        .selectFrom("provider_connections")
        .select([
          "id",
          "organization_id",
          "kind",
          "base_url",
          "health",
          // A fact about the row, not the row's secret. See this file's header.
          sql<boolean>`credentials_encrypted is not null`.as("has_credential"),
        ])
        .where("status", "!=", "paused")
        .where((eb) =>
          eb.or([
            eb.and([
              eb("kind", "in", cutoffs.local.kinds),
              eb.or([
                eb("last_checked_at", "is", null),
                eb("last_checked_at", "<", cutoffs.local.before),
              ]),
            ]),
            eb.and([
              eb("kind", "in", cutoffs.cloud.kinds),
              eb.or([
                eb("last_checked_at", "is", null),
                eb("last_checked_at", "<", cutoffs.cloud.before),
              ]),
            ]),
          ]),
        )
        // Never-checked first, then longest-waiting. `nulls first` is stated rather than left
        // to PostgreSQL's default for `asc`, because the default is what this depends on and a
        // reader should not have to know it.
        .orderBy("last_checked_at", (order) => order.asc().nullsFirst())
        .limit(limit)
        .execute()
    );
  }

  /**
   * One connection's sealed credential.
   *
   * The only statement in this module that names `credentials_encrypted`, called only for a
   * connection whose check needs one, and selecting nothing else — so what this method can
   * leak is bounded by what it can see.
   *
   * @param organizationId - The workspace, from the row the sweep is holding. Carried even
   *   though the id is globally unique, for the reason `registry.repository.ts` gives: a
   *   lookup that could cross a workspace boundary is one that eventually does.
   * @param connectionId - The connection.
   * @returns The `ouro.v1.…` envelope, or null when the row holds none. Null is ordinary: a
   *   cloud connection whose key has not been entered yet is a row mockup 07 has not
   *   finished, not a provider that is failing.
   */
  async sealedCredential(organizationId: string, connectionId: string): Promise<string | null> {
    const row = await this.database.db
      .selectFrom("provider_connections")
      .select("credentials_encrypted")
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();

    return row?.credentials_encrypted ?? null;
  }

  /**
   * Write back what one check concluded.
   *
   * All three columns in one statement — see this file's header for why they cannot be
   * separated. The `health` object is serialised and cast rather than passed as a parameter:
   * `pg` sends a JavaScript object to a `jsonb` column as `[object Object]`, which the column
   * accepts as a string and nothing can read back.
   *
   * @param organizationId - The workspace the row belongs to.
   * @param connectionId - The connection that was checked.
   * @param write - The concluded state.
   * @returns When it is stored.
   */
  async record(organizationId: string, connectionId: string, write: HealthWrite): Promise<void> {
    await this.database.db
      .updateTable("provider_connections")
      .set({
        status: write.status,
        last_checked_at: write.checkedAt,
        health: sql<Record<string, unknown>>`${JSON.stringify(write.health)}::jsonb`,
      })
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .execute();
  }

  /**
   * The `health` one connection holds, for a writer about to merge over it.
   *
   * The sweep reads the column in the same statement that selects what is due; a check that
   * arrives from outside the sweep — mockup 07's **Test connection**
   * ([#230](https://github.com/NobuData/ouroboros/issues/230)) — has to read it separately, and
   * has to read it here rather than through the lifecycle's own row, whose `select` list
   * deliberately omits this column.
   *
   * @param organizationId - The workspace the row belongs to.
   * @param connectionId - The connection.
   * @returns The column's value, or `undefined` when this workspace has no such connection.
   */
  async healthOf(
    organizationId: string,
    connectionId: string,
  ): Promise<Record<string, unknown> | undefined> {
    const row = await this.database.db
      .selectFrom("provider_connections")
      .select("health")
      .where("organization_id", "=", organizationId)
      .where("id", "=", connectionId)
      .executeTakeFirst();

    return row?.health;
  }

  /**
   * Every connection in one workspace, with whatever is known about its health.
   *
   * What the strip renders and what Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194))
   * resolves against. Unpaged for the reason `registry.repository.ts`'s alias list is: the
   * strip draws five chips, and a page over a list that short would cost a client a second
   * request to discover there was nothing more.
   *
   * Ordered by display name so the chips do not reshuffle between polls. Creation order would
   * be stable too and would put the strip in an order nobody chose; alphabetical is at least
   * an order a person can predict.
   *
   * @param organizationId - The workspace, from the tenant context.
   * @returns Every connection. Empty for a workspace that has configured none, which is what
   *   a new workspace should see rather than an error.
   */
  async forOrganization(organizationId: string): Promise<ProviderHealthRow[]> {
    return this.database.db
      .selectFrom("provider_connections")
      .select(["id", "kind", "display_name", "base_url", "status", "last_checked_at", "health"])
      .where("organization_id", "=", organizationId)
      .orderBy("display_name")
      .execute();
  }
}
