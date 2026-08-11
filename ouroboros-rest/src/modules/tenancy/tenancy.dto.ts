/**
 * What a request may contain — the path parameters, the query strings and the bodies of
 * every tenancy route, as `class-validator` classes.
 *
 * They are here in one file rather than in a `dto/` directory of nine, because they are read
 * together: the patterns below restate the `check` constraints V001–V003 declare, and having
 * them side by side is what makes it possible to see that they still agree. The pairing is
 * deliberate in both directions:
 *
 *   * **The database is the authority.** A DTO that admitted something a constraint refuses
 *     would produce a `500` where the caller deserved a `422`, and one that admits *less* is
 *     merely stricter than it has to be — which is why `constraints.ts` still maps a check
 *     violation, and why that mapping is not dead code.
 *   * **The DTO is the message.** A constraint's failure is a SQLSTATE and a name; a
 *     decorator's is a sentence naming the field, and it arrives before a connection is
 *     taken from the pool. Validating here is what turns "the write failed" into "slug must
 *     be lower-case letters, digits and single hyphens".
 *
 * Every property is `!`-asserted or optional rather than initialised. `class-transformer`
 * constructs these objects and assigns to them, so a default written here would be a value
 * the pipe then overwrote — or, worse, one it kept for a field the client never sent.
 */

import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

import type { TenantRole, TenantStatus } from "../db/schema";

/** `tenants_slug_format` (V001): lower-case alphanumerics in single-hyphen-separated groups. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `tenant_domains_domain_format` (V001): two or more lower-case hostname labels. */
export const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** `github_orgs_login_format` (V003): GitHub's own rule for an organisation login. */
export const ORG_LOGIN_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** `github_repos_name_format` (V003): GitHub's own rule for a repository name. */
export const REPO_NAME_PATTERN = /^[a-z0-9._-]+$/;

/**
 * `github_repos_default_branch_format` (V003), as one expression.
 *
 * The migration states it as an allow-list and four exclusions; this is the same rule with
 * the exclusions folded into the pattern — no leading or trailing slash, no empty segment,
 * no leading dot, and no `..` anywhere, which is the one that matters because a slash is
 * permitted and `..` would therefore be path traversal in anything that builds a checkout
 * directory from the value.
 */
export const BRANCH_PATTERN = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._-]+(\/(?!\.)[A-Za-z0-9._-]+)*$/;

/** The values `tenants_status_valid` (V001) admits. */
export const TENANT_STATUSES: readonly TenantStatus[] = ["active", "suspended", "deleted"];

/** The values `tenant_members_role_valid` (V002) admits. */
export const TENANT_ROLES: readonly TenantRole[] = ["owner", "admin", "member", "viewer"];

/**
 * Every route below `/tenants/{tenantId}`.
 *
 * A class rather than a `ParseUUIDPipe` on the parameter, so a malformed id answers with the
 * same `422` and the same `details` shape as a malformed body — one failure mode for the
 * client to handle instead of two.
 */
export class TenantParams {
  @IsUUID()
  tenantId!: string;
}

/** A route addressing one domain of one tenant. */
export class DomainParams extends TenantParams {
  @IsUUID()
  domainId!: string;
}

/** A route addressing one member of one tenant. The member *is* the user. */
export class MemberParams extends TenantParams {
  @IsUUID()
  userId!: string;
}

/** A route addressing one organisation of one tenant, by its GitHub login. */
export class OrgParams extends TenantParams {
  @Matches(ORG_LOGIN_PATTERN, {
    message: "login must be a lower-case GitHub organisation login",
  })
  @Length(1, 39)
  login!: string;
}

/** A route addressing one repository within one organisation. */
export class RepoParams extends OrgParams {
  @Matches(REPO_NAME_PATTERN, { message: "name must be a lower-case GitHub repository name" })
  @Length(1, 100)
  name!: string;
}

/** `POST /api/v1/tenants`. */
export class CreateTenantBody {
  /**
   * The URL- and CLI-safe handle, unique across the installation.
   *
   * Not derived from `displayName` here. A slug appears in paths and command arguments and
   * is the thing a person types, so it is chosen rather than generated — and a generator
   * that produced `acme-inc` from `Acme, Inc.` would be one more rule to keep in step with
   * `tenants_slug_format`.
   */
  @Matches(SLUG_PATTERN, {
    message: "slug must be lower-case letters, digits and single hyphens",
  })
  @Length(2, 63)
  slug!: string;

  /** What a human reads. Free text; only required to be non-blank. */
  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: "displayName must not be blank" })
  displayName!: string;
}

/**
 * `PATCH /api/v1/tenants/{tenantId}`.
 *
 * Every field optional, and a body with none of them is a no-op that answers with the tenant
 * unchanged — which is what `PATCH` means, and cheaper to allow than to special-case.
 */
export class UpdateTenantBody {
  @IsOptional()
  @Matches(SLUG_PATTERN, {
    message: "slug must be lower-case letters, digits and single hyphens",
  })
  @Length(2, 63)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: "displayName must not be blank" })
  displayName?: string;

  /**
   * The lifecycle.
   *
   * `deleted` is the soft-delete marker V001 describes: the row and everything cascading
   * from it survive, so an accidental deletion is a second `PATCH` away from being undone.
   * There is deliberately no `DELETE /tenants/{tenantId}` — a hard delete of a tenant takes
   * its domains, members, organisations and repositories with it, and that is not an
   * operation an HTTP verb should make one click away.
   */
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;
}

/** `POST /api/v1/tenants/{tenantId}/domains`. */
export class CreateDomainBody {
  /**
   * The email domain, lower-cased.
   *
   * Rejected rather than folded when it carries upper case. Folding would be friendlier, and
   * it would also mean the value stored is not the value sent — which is the beginning of a
   * client that cannot predict what a `GET` will return.
   */
  @Matches(DOMAIN_PATTERN, { message: "domain must be a lower-case domain name" })
  @MaxLength(253)
  domain!: string;

  /** Make this the tenant's primary domain, demoting whichever one holds it now. */
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/**
 * `PATCH /api/v1/tenants/{tenantId}/domains/{domainId}` — the set-primary operation.
 *
 * One field, because it is the only thing about a domain that can change: the domain itself
 * is what the row *is*, and renaming one is adding the new one and removing the old.
 */
export class UpdateDomainBody {
  @IsBoolean()
  isPrimary!: boolean;
}

/**
 * `POST /api/v1/tenants/{tenantId}/members` — the invitation.
 *
 * A stub, as the issue names it: the membership row is created with `joinedAt` null, and
 * nothing is emailed. What turns an outstanding invitation into a joined member is the
 * OAuth callback in [#33](https://github.com/NobuData/ouroboros/issues/33), which is the
 * first thing that can know a person accepted.
 */
export class InviteMemberBody {
  /**
   * Who to invite, by email address.
   *
   * Lower-cased before the lookup, matching `users_email_lowercase` (V002) — the one place
   * this file normalises rather than rejects, because an address is typed by a person into
   * a form and `Ken@example.com` is not a mistake worth an error message.
   */
  @IsEmail()
  @MaxLength(320)
  email!: string;

  /** What they may do in this tenant. */
  @IsIn(TENANT_ROLES)
  role!: TenantRole;

  /**
   * What to call them, if this is the first Ouroboros has heard of them.
   *
   * Ignored when the person already exists — their own name is not an inviter's to
   * overwrite. Omitted, the local part of the address is used, which is what a member list
   * shows until they sign in and GitHub supplies the real one.
   */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: "displayName must not be blank" })
  displayName?: string;
}

/** `PATCH /api/v1/tenants/{tenantId}/members/{userId}` — the role change. */
export class UpdateMemberBody {
  @IsIn(TENANT_ROLES)
  role!: TenantRole;
}

/** `POST /api/v1/tenants/{tenantId}/orgs`. */
export class CreateOrgBody {
  /** The organisation's GitHub login — the `NobuData` in github.com/NobuData. */
  @Matches(ORG_LOGIN_PATTERN, {
    message: "login must be a lower-case GitHub organisation login",
  })
  @Length(1, 39)
  login!: string;

  /**
   * Whether Ouroboros may operate in it.
   *
   * Defaults to `false`, as V003 does: a row records that the organisation is *known*, and
   * this records that somebody deliberately turned it on. Failing closed is the posture for
   * the two tables whose whole job is to bound what an autonomous agent may touch.
   */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** `PATCH /api/v1/tenants/{tenantId}/orgs/{login}` — enable or disable. */
export class UpdateOrgBody {
  @IsBoolean()
  enabled!: boolean;
}

/**
 * `PATCH /api/v1/tenants/{tenantId}/orgs/{login}/repos/{name}` — enable or disable.
 *
 * This is also how a repository first comes to be known: there is no `POST`, because there
 * is no discovery flow yet to create rows for a person to then enable. The `PATCH` creates
 * the row if this repository has not been seen before, which keeps "turn this repo on" one
 * request whether or not something else has already mentioned it.
 */
export class UpdateRepoBody {
  @IsBoolean()
  enabled!: boolean;

  /**
   * The branch work is cut from.
   *
   * Optional, and left alone when omitted rather than cleared: it is discovered from GitHub,
   * and an enable/disable request is not the thing that should forget it.
   */
  @IsOptional()
  @IsString()
  @Matches(BRANCH_PATTERN, { message: "defaultBranch must be a valid branch name" })
  @MaxLength(255)
  defaultBranch?: string;
}

/**
 * Coerce a value the API accepts loosely into the one the database stores.
 *
 * Only email addresses need this — every other text column in the tenancy schema is
 * constrained to a pattern that admits no upper case, so a DTO can reject rather than fold
 * and the stored value is always the value sent.
 *
 * @param email - The address as it was typed.
 * @returns It, lower-cased, which is what `users_email_key` compares.
 */
export function normaliseEmail(email: string): string {
  return email.toLowerCase();
}

/**
 * The name to give a person nobody has named.
 *
 * @param email - Their address, already normalised.
 * @returns The local part, which is a better placeholder than the whole address in a table
 *   of names and is guaranteed non-blank by `users_email_format`.
 */
export function displayNameFromEmail(email: string): string {
  return email.slice(0, email.indexOf("@"));
}
