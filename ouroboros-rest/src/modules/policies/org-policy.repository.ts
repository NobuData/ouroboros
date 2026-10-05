/**
 * `org_policies` statements — the read through `org_policies_effective`, the onboarding default
 * and the audited flip (V075, [#382](https://github.com/NobuData/ouroboros/issues/382)).
 *
 * V075's header gives the two write statements; this file is them.
 */

import { Injectable } from "@nestjs/common";
import { type Kysely, sql } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, OrgPolicies, OrgPoliciesEffective } from "../db/schema";
import { type PublishedOrgPolicy, rulesOf } from "./org-policy.document";

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
   * Write `dry_run = true` when the workspace has never answered — no row, or a row whose
   * `dry_run` is null because a policy publish created it (V092) — and leave any answer alone.
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

/** The published document, as the resolver reaches it (BQ.2, #481). */
export interface PolicyDocumentStore {
  /**
   * @param organizationId - The workspace.
   * @returns The version `org_policies.current_version` points at, or null when none is published.
   */
  current(organizationId: string): Promise<PublishedOrgPolicy | null>;
}

/** The per-repository loop count `dry_run_new_repos` reads (BQ.2, #481). */
export interface RepositoryLoopStore {
  /**
   * How many PRs Ouroboros has opened on a repository — the runs of this workspace there that
   * opened one, whether the PR is recorded on the run (`runs.pr_number`) or mirrored
   * (`pull_requests.run_id`). The next PR opened is loop `count + 1`.
   *
   * @param organizationId - The workspace.
   * @param githubRepoId - `github_repos.id`.
   * @returns The count.
   */
  loopsOpened(organizationId: string, githubRepoId: string): Promise<number>;
}

/** One published version, as stored — the document verbatim, for the settings card. */
export interface StoredPolicyVersion {
  readonly version: number;
  /** `org_policy_versions.document`, untouched. */
  readonly document: Record<string, unknown>;
  readonly publishedAt: Date;
  /** `user.id`, or null when the person is gone. */
  readonly publishedBy: string | null;
  readonly changeNote: string | null;
}

/** What the publish flow asks of the store (BQ.2, #481). */
export interface PolicyPublishStore {
  /**
   * @param organizationId - The workspace.
   * @returns The version in force, verbatim, or null when none is published.
   */
  version(organizationId: string): Promise<StoredPolicyVersion | null>;
  /**
   * Publish the next version, deciding under the workspace's lock.
   *
   * The handle row is created when absent (`dry_run` null — publishing answers nothing about
   * dry-run) and locked; `decide` is handed the version in force under that lock and may throw to
   * refuse; then `org_policy_publish` appends the version and advances the pointer. All one
   * transaction, so two concurrent publishes are decided one after the other, each against what
   * the other left.
   *
   * @param organizationId - The workspace.
   * @param document - The document to publish.
   * @param publishedBy - Who — `user.id`.
   * @param changeNote - Why, or null.
   * @param decide - Called with the version in force; a throw refuses the publish and writes nothing.
   * @returns The version written, and when.
   */
  publish(
    organizationId: string,
    document: Record<string, unknown>,
    publishedBy: string,
    changeNote: string | null,
    decide: (current: StoredPolicyVersion | null) => void,
  ): Promise<{ readonly version: number; readonly publishedAt: Date }>;
}

/** One published version with its publisher's name — a history row (BS.4, #494). */
export interface StoredPolicyHistoryVersion extends StoredPolicyVersion {
  /** `user.name` of whoever published it, or null when the person is gone. */
  readonly publisherName: string | null;
}

/** What the version history asks of the store (BS.4, #494). */
export interface PolicyHistoryStore {
  /**
   * A workspace's published versions, newest first.
   *
   * @param organizationId - The workspace.
   * @param before - Only versions strictly below this one; null for the newest.
   * @param take - The most rows to return.
   * @returns The versions, descending. Empty when nothing is published (below `before`).
   */
  versions(
    organizationId: string,
    before: number | null,
    take: number,
  ): Promise<StoredPolicyHistoryVersion[]>;
}

@Injectable()
export class OrgPolicyRepository
  implements
    OrgPolicyStore,
    PolicyDocumentStore,
    PolicyPublishStore,
    PolicyHistoryStore,
    RepositoryLoopStore
{
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

  /**
   * @inheritdoc
   *
   * V092's form of V075's statement: an existing row is answered only when its `dry_run` is
   * null, so an explicit `false` survives and a publish-created handle is turned on.
   */
  async adoptDefault(organizationId: string): Promise<boolean> {
    const written = await this.database.db
      .insertInto("org_policies")
      .values({ organization_id: organizationId, dry_run: true })
      .onConflict((conflict) =>
        conflict
          .column("organization_id")
          .doUpdateSet({ dry_run: true })
          .where("org_policies.dry_run", "is", null),
      )
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
   * prior value is the view's `false`, not the column default it was written with; so did a row
   * whose `dry_run` is null (a policy publish created it, V092).
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

      const previousExplicit = created === undefined && prior.dry_run !== null;

      return { row, previous: previousExplicit ? prior.dry_run === true : false, previousExplicit };
    });
  }

  /** @inheritdoc */
  async current(organizationId: string): Promise<PublishedOrgPolicy | null> {
    const result = await sql<{ version: number; published_at: Date; document: unknown }>`
      select v.version, v.published_at, v.document
        from ouroboros.org_policies p
        join ouroboros.org_policy_versions v
          on v.organization_id = p.organization_id and v.version = p.current_version
       where p.organization_id = ${organizationId}
    `.execute(this.database.db);
    const row = result.rows[0];

    return row === undefined
      ? null
      : { version: row.version, publishedAt: row.published_at, rules: rulesOf(row.document) };
  }

  /** @inheritdoc */
  async loopsOpened(organizationId: string, githubRepoId: string): Promise<number> {
    const result = await sql<{ loops: number }>`
      select count(*)::int as loops
        from ouroboros.runs r
       where r.organization_id = ${organizationId}
         and r.github_repo_id = ${githubRepoId}
         and (r.pr_number is not null
              or exists (select 1 from ouroboros.pull_requests p
                          where p.run_id = r.id and p.organization_id = r.organization_id))
    `.execute(this.database.db);

    return result.rows[0]?.loops ?? 0;
  }

  /** @inheritdoc */
  async version(organizationId: string): Promise<StoredPolicyVersion | null> {
    return versionIn(this.database.db, organizationId);
  }

  /** @inheritdoc */
  async versions(
    organizationId: string,
    before: number | null,
    take: number,
  ): Promise<StoredPolicyHistoryVersion[]> {
    const result = await sql<{
      version: number;
      document: Record<string, unknown>;
      published_at: Date;
      published_by: string | null;
      change_note: string | null;
      publisher_name: string | null;
    }>`
      select v.version, v.document, v.published_at, v.published_by, v.change_note,
             u."name" as publisher_name
        from ouroboros.org_policy_versions v
        left join ouroboros."user" u on u."id" = v.published_by
       where v.organization_id = ${organizationId}
         and (${before}::int is null or v.version < ${before}::int)
       order by v.version desc
       limit ${take}
    `.execute(this.database.db);

    return result.rows.map((row) => ({
      version: row.version,
      document: row.document,
      publishedAt: row.published_at,
      publishedBy: row.published_by,
      changeNote: row.change_note,
      publisherName: row.publisher_name,
    }));
  }

  /** @inheritdoc */
  publish(
    organizationId: string,
    document: Record<string, unknown>,
    publishedBy: string,
    changeNote: string | null,
    decide: (current: StoredPolicyVersion | null) => void,
  ): Promise<{ readonly version: number; readonly publishedAt: Date }> {
    return this.database.db.transaction().execute(async (trx) => {
      await trx
        .insertInto("org_policies")
        .values({ organization_id: organizationId, dry_run: null })
        .onConflict((conflict) => conflict.column("organization_id").doNothing())
        .execute();
      await trx
        .selectFrom("org_policies")
        .select("organization_id")
        .where("organization_id", "=", organizationId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      decide(await versionIn(trx, organizationId));

      // Two statements: a row the function inserts is not visible to the statement that called it.
      const written = await sql<{ version: number }>`
        select ouroboros.org_policy_publish(
                 ${organizationId}, ${JSON.stringify(document)}::jsonb, ${publishedBy}, ${changeNote}) as version
      `.execute(trx);
      const version = written.rows[0]?.version;
      const row =
        version === undefined || version === null
          ? undefined
          : (
              await sql<{ version: number; published_at: Date }>`
                select v.version, v.published_at
                  from ouroboros.org_policy_versions v
                 where v.organization_id = ${organizationId} and v.version = ${version}
              `.execute(trx)
            ).rows[0];

      if (row === undefined) {
        throw new Error(`org_policy_publish wrote no version for ${organizationId}.`);
      }

      return { version: row.version, publishedAt: row.published_at };
    });
  }
}

/**
 * The version in force, verbatim.
 *
 * @param reader - The pool or a transaction.
 * @param organizationId - The workspace.
 * @returns It, or null when none is published.
 */
async function versionIn(
  reader: Kysely<Database>,
  organizationId: string,
): Promise<StoredPolicyVersion | null> {
  const result = await sql<{
    version: number;
    document: Record<string, unknown>;
    published_at: Date;
    published_by: string | null;
    change_note: string | null;
  }>`
    select v.version, v.document, v.published_at, v.published_by, v.change_note
      from ouroboros.org_policies p
      join ouroboros.org_policy_versions v
        on v.organization_id = p.organization_id and v.version = p.current_version
     where p.organization_id = ${organizationId}
  `.execute(reader);
  const row = result.rows[0];

  return row === undefined
    ? null
    : {
        version: row.version,
        document: row.document,
        publishedAt: row.published_at,
        publishedBy: row.published_by,
        changeNote: row.change_note,
      };
}
