/**
 * The one statement domain discovery issues, and the two columns it is allowed to touch.
 *
 * A repository of its own rather than a method on `tenancy/domains.repository.ts`, and the
 * reason is a migration rather than a preference. `V006__tenancy_extensions.sql`
 * ([#708](https://github.com/NobuData/ouroboros/issues/708)) re-parented `tenant_domains`
 * from `tenant_id` onto `organization_id` and dropped the old column;
 * `src/modules/db/schema.ts` still declares `tenant_id`, and
 * [#714](https://github.com/NobuData/ouroboros/issues/714) is the issue that rewrites both
 * the schema type and the tenancy module against the organization tables. Every method on
 * that repository is scoped by the column V006 deleted, so reusing one would mean issuing
 * `where tenant_id = $1` against a table that no longer has it.
 *
 * What survives V006 untouched is exactly what this endpoint needs, and the migration says
 * so in its own comment: `tenant_domains_domain_key` *"survives this migration untouched and
 * remains the sign-in lookup index (#712's path)"*. So this file names `domain` and nothing
 * else — not `selectAll()`, which would return columns the type is wrong about, and not the
 * parent id, which is a different thing under either name.
 *
 * **It answers a boolean, and that is the anti-enumeration rule written as a return type.**
 * The caller is anonymous. Whatever it learns, anybody learns, so the narrowest thing this
 * layer can hand upward is the widest thing the endpoint may ever say — no row, no id, no
 * organisation, no count. `discovery.service.ts` is where even that is not passed on.
 */

import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../db/db.service";

@Injectable()
export class DiscoveryRepository {
  constructor(private readonly database: DatabaseService) {}

  /**
   * Is this domain claimed by a workspace?
   *
   * `limit 1` and one column, because existence is the question: the unique index means a
   * second row cannot exist, and reading more would be reading it for nobody.
   *
   * No transaction parameter, unlike every method in `tenancy/`. Those exist because
   * promoting a primary domain is two statements that have to be one unit of work; this is
   * one statement that is the whole request, and a parameter for a caller that cannot exist
   * would be a seam somebody has to reason about.
   *
   * @param domain - The domain, already normalised by {@link DiscoverBody} — lower-cased,
   *   with no scheme and no path. The column is lower-case by constraint, so a value that
   *   skipped normalisation would silently miss rather than fail.
   * @returns Whether a `tenant_domains` row holds it.
   */
  async exists(domain: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom("tenant_domains")
      .select("domain")
      .where("domain", "=", domain)
      .limit(1)
      .executeTakeFirst();

    return row !== undefined;
  }
}
