/**
 * Every statement the tenant context issues against `ouroboros.organization` and
 * `ouroboros.member` ([#713](https://github.com/NobuData/ouroboros/issues/713)).
 *
 * Two tables and three reads, which is the whole of what resolving a request's workspace
 * needs: find the organization a request named, and find whether the caller is in it. The
 * pair is one repository for the same reason `members.repository.ts` joined `tenant_members`
 * to `users` — the two are never read apart, and splitting them would mean the resolver
 * performing the join by hand.
 *
 * **Not to be confused with `orgs.repository.ts`**, which is *GitHub* organisations
 * (`github_orgs`, `github_repos` — V003's enablement tables). The collision is real and it is
 * temporary: [#714](https://github.com/NobuData/ouroboros/issues/714) rewrites that module and
 * is where the two vocabularies stop overlapping. Until then, "organization" here always means
 * the workspace and "org" there always means GitHub's.
 *
 * **This repository only reads.** Organizations and memberships are written by BetterAuth's
 * organization plugin, through its own adapter and its own routes; `db/schema.ts` types both
 * tables as `LibraryOwned` so an `insert` here would not compile. A workspace is created by
 * `POST /api/auth/organization/create` and by `active.organization.ts`, and by nothing else.
 */

import { Injectable } from "@nestjs/common";
import type { Transaction } from "kysely";

import { DatabaseService } from "../db/db.service";
import type { Database, Organization, OrganizationRole } from "../db/schema";
import { queryOn } from "./queries";

/**
 * The words this service recognises in `member.role`.
 *
 * `V005` deliberately leaves the column un-CHECK-constrained — the vocabulary is the
 * organization plugin's configuration, not the schema's — so this list is where a stored
 * word becomes a role with a meaning. It is the same four `src/auth/organization.roles.ts`
 * configures the plugin with, and `organization.repository.spec.ts` asserts they agree
 * rather than leaving two lists to drift.
 */
export const KNOWN_ROLES: readonly OrganizationRole[] = ["owner", "admin", "member", "viewer"];

/** How the plugin separates roles when a membership carries more than one. */
const ROLE_SEPARATOR = ",";

/**
 * Read `member.role` as the roles it grants.
 *
 * The column is text and holds **a comma-separated list** where somebody holds more than one
 * role — the library's `addMember` accepts an array and joins it, and V005's column comment
 * records that. Reading the raw string as a single role would give that person a role called
 * `"admin,member"`, which matches nothing `@Roles()` asks for: an administrator locked out of
 * every mutation, with the database showing them as an admin.
 *
 * A word that is not in {@link KNOWN_ROLES} is **dropped**, not passed through. Nothing in
 * this service can decide what an unknown role may do, so the safe reading of one is that it
 * grants nothing — which is what dropping it produces, because `RolesGuard` refuses anybody
 * holding none of the roles a route requires. It does not cost the membership itself: being a
 * member is what the row's existence says, and that is a separate question from what the role
 * permits.
 *
 * @param stored - The column's value, exactly as the database holds it.
 * @returns The roles it grants, de-duplicated, in the order stored. Possibly empty — a
 *   membership carrying only words this service does not know is a membership with no
 *   permissions, which is honest rather than convenient.
 */
export function rolesFrom(stored: string): OrganizationRole[] {
  const words = stored.split(ROLE_SEPARATOR).map((word) => word.trim());
  const known = words.filter((word): word is OrganizationRole =>
    KNOWN_ROLES.includes(word as OrganizationRole),
  );

  return [...new Set(known)];
}

/**
 * How a workspace was named.
 *
 * A uuid and a slug are different lookups against different indexes — `organization_pkey` and
 * `organization_slug_key` — and deciding which from the *shape* of the value is what lets one
 * header accept both without a second parameter saying which it is.
 */
export type OrganizationReference =
  | { readonly kind: "id"; readonly value: string }
  | { readonly kind: "slug"; readonly value: string };

@Injectable()
export class OrganizationRepository {
  /**
   * @param database - The typed connection. Injected, never constructed: the pool's lifecycle
   *   belongs to `DatabaseService`.
   */
  constructor(private readonly database: DatabaseService) {}

  /**
   * Find a workspace by whichever way it was named.
   *
   * @param reference - The id or the slug the request carried.
   * @param trx - The transaction to run in, if there is one.
   * @returns The row, or `undefined` when nothing matches. The caller decides what to say
   *   about that; the rule is in `tenant.resolver.ts` and the answer is a `404`.
   */
  async find(
    reference: OrganizationReference,
    trx?: Transaction<Database>,
  ): Promise<Organization | undefined> {
    return queryOn(this.database, trx)
      .selectFrom("organization")
      .selectAll()
      .where(reference.kind === "id" ? "id" : "slug", "=", reference.value)
      .executeTakeFirst();
  }

  /**
   * What a person may do in a workspace.
   *
   * One indexed lookup on `member_organization_user_key`, which V005 declared in
   * `("organizationId", "userId")` order for exactly this.
   *
   * @param organizationId - The workspace.
   * @param userId - The person, as `"user".id` — the same value a session's `user.id` holds.
   * @param trx - The transaction to run in, if there is one.
   * @returns Their roles, or `undefined` when they are not a member at all. The distinction
   *   matters and is not decorative: `undefined` is "not a member", which is a `404`, while
   *   an empty array is "a member holding no role this service recognises", which is a member
   *   who may read and may change nothing.
   */
  async rolesFor(
    organizationId: string,
    userId: string,
    trx?: Transaction<Database>,
  ): Promise<OrganizationRole[] | undefined> {
    const membership = await queryOn(this.database, trx)
      .selectFrom("member")
      .select("role")
      .where("organizationId", "=", organizationId)
      .where("userId", "=", userId)
      .executeTakeFirst();

    return membership === undefined ? undefined : rolesFrom(membership.role);
  }
}
