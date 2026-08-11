/**
 * What the API returns, and the one place a database row becomes it.
 *
 * The tables and the JSON deliberately do not have the same shape, and the difference is
 * worth stating because `src/modules/db/schema.ts` argues the opposite case for itself:
 *
 *   * **Rows keep the database's names.** `display_name`, `is_primary`, `created_at` —
 *     because a type that renamed them would be a mapping nobody could grep for between a
 *     migration and a query.
 *   * **Resources keep the API's.** `displayName`, `isPrimary`, `createdAt` — because the
 *     heartbeat already answers `uptimeSeconds`, `ouroboros-ui` generates TypeScript from
 *     this contract, and a JSON body full of snake_case would make the client's field names
 *     an artefact of a schema no browser has ever seen.
 *
 * So the translation exists, and it exists exactly here: one function per resource, called
 * by the services, and never anywhere else. A controller that returned a row would publish
 * the schema as the contract, and the first migration to rename a column would be a breaking
 * change to the API by accident.
 *
 * Timestamps become ISO-8601 strings rather than `Date`s. Nest's serialiser would do the
 * same thing on the way out, but doing it here is what lets the specification say
 * `format: date-time` about a field whose type the code actually guarantees.
 */

import type {
  GithubOrg,
  GithubRepo,
  Tenant,
  TenantDomain,
  TenantRole,
  TenantStatus,
} from "../db/schema";

/** A tenant, as `GET /api/v1/tenants/{tenantId}` answers. */
export interface TenantResource {
  id: string;
  slug: string;
  displayName: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}

/** An email domain that resolves this tenant at sign-in. */
export interface DomainResource {
  id: string;
  tenantId: string;
  domain: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A person's membership of one tenant, with the person's own details alongside.
 *
 * Flattened rather than nested (`{user: {…}, role}`) because it is one row of mockup 17's
 * member table, and every field here is a column that table renders. There is no `id`: the
 * membership *is* the `(tenantId, userId)` pair — V002 makes that the primary key — so
 * `userId` is what a `PATCH` or a `DELETE` addresses.
 */
export interface MemberResource {
  tenantId: string;
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: TenantRole;
  invitedAt: string;
  /** `null` while the invitation is outstanding — a state the member list renders. */
  joinedAt: string | null;
}

/** A GitHub organisation this tenant has added, enabled or not. */
export interface OrgResource {
  id: string;
  tenantId: string;
  login: string;
  enabled: boolean;
  /** `null` until the GitHub App installation flow exists. */
  installedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A repository within an organisation. In scope only when this *and* its org are enabled. */
export interface RepoResource {
  id: string;
  orgId: string;
  name: string;
  enabled: boolean;
  /** `null` until it has been discovered from GitHub. */
  defaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The columns a member listing selects.
 *
 * A membership joined to its user, named as the join returns it. Declared here rather than
 * inferred from the query so {@link memberResource} states what it needs and the repository
 * is checked against it.
 */
export interface MemberRow {
  tenant_id: string;
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: TenantRole;
  invited_at: Date;
  joined_at: Date | null;
}

/**
 * Render a timestamp for the wire.
 *
 * @param instant - The instant, as `pg` parsed it.
 * @returns ISO-8601 with a `Z` offset — `2026-08-11T10:20:23.000Z`.
 */
function at(instant: Date): string {
  return instant.toISOString();
}

/**
 * Render a timestamp that may not have happened.
 *
 * @param instant - The instant, or `null` when the thing it records has not occurred.
 * @returns ISO-8601, or `null`. Null is preserved rather than defaulted, because "not
 *   joined yet" and "joined at the epoch" are different facts.
 */
function maybeAt(instant: Date | null): string | null {
  return instant === null ? null : at(instant);
}

/**
 * @param row - A row of `ouroboros.tenants`.
 * @returns Its API representation.
 */
export function tenantResource(row: Tenant): TenantResource {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    createdAt: at(row.created_at),
    updatedAt: at(row.updated_at),
  };
}

/**
 * @param row - A row of `ouroboros.tenant_domains`.
 * @returns Its API representation.
 */
export function domainResource(row: TenantDomain): DomainResource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    domain: row.domain,
    isPrimary: row.is_primary,
    createdAt: at(row.created_at),
    updatedAt: at(row.updated_at),
  };
}

/**
 * @param row - A membership joined to its user.
 * @returns Its API representation.
 */
export function memberResource(row: MemberRow): MemberResource {
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    invitedAt: at(row.invited_at),
    joinedAt: maybeAt(row.joined_at),
  };
}

/**
 * @param row - A row of `ouroboros.github_orgs`.
 * @returns Its API representation.
 */
export function orgResource(row: GithubOrg): OrgResource {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    login: row.login,
    enabled: row.enabled,
    installedAt: maybeAt(row.installed_at),
    createdAt: at(row.created_at),
    updatedAt: at(row.updated_at),
  };
}

/**
 * @param row - A row of `ouroboros.github_repos`.
 * @returns Its API representation.
 */
export function repoResource(row: GithubRepo): RepoResource {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    enabled: row.enabled,
    defaultBranch: row.default_branch,
    createdAt: at(row.created_at),
    updatedAt: at(row.updated_at),
  };
}
