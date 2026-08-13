/**
 * What a request may contain — the path parameters, the query strings and the bodies of
 * every tenancy route, as `class-validator` classes.
 *
 * They are here in one file rather than in a `dto/` directory of seven, because they are read
 * together: the patterns below restate the `check` constraints V001 and V003 declare, and
 * having them side by side is what makes it possible to see that they still agree. The pairing
 * is deliberate in both directions:
 *
 *   * **The database is the authority.** A DTO that admitted something a constraint refuses
 *     would produce a `500` where the caller deserved a `422`, and one that admits *less* is
 *     merely stricter than it has to be — which is why `constraints.ts` still maps a check
 *     violation, and why that mapping is not dead code.
 *   * **The DTO is the message.** A constraint's failure is a SQLSTATE and a name; a
 *     decorator's is a sentence naming the field, and it arrives before a connection is
 *     taken from the pool. Validating here is what turns "the write failed" into "domain must
 *     be a lower-case domain name".
 *
 * **Nothing here describes a workspace or a membership.** Creating a workspace, renaming one,
 * inviting somebody and changing a role are the organization plugin's operations since
 * [#704](https://github.com/NobuData/ouroboros/issues/704), and
 * [#714](https://github.com/NobuData/ouroboros/issues/714) deleted this module's versions
 * rather than leaving two write paths to the same rows. What is left is what only this service
 * has: the domains that resolve a workspace, and the GitHub organisations and repositories it
 * has turned on.
 *
 * Every property is `!`-asserted or optional rather than initialised. `class-transformer`
 * constructs these objects and assigns to them, so a default written here would be a value
 * the pipe then overwrote — or, worse, one it kept for a field the client never sent.
 */

import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

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

/**
 * Every route below `/orgs/{orgId}`.
 *
 * A class rather than a `ParseUUIDPipe` on the parameter, so a malformed id answers with the
 * same `422` and the same `details` shape as a malformed body — one failure mode for the
 * client to handle instead of two.
 *
 * **`orgId` is a workspace, not a GitHub organisation.** The collision is real and the paths
 * are what keep the two apart: `/api/v1/orgs/{orgId}` is the workspace, and the GitHub
 * organisations inside it are `/github-orgs/{login}` under it. `tenant.resolver.ts` reads this
 * parameter to resolve the request's workspace, which is why it is a uuid here and why it is
 * the same value `organization."id"` holds.
 */
export class OrgParams {
  @IsUUID()
  orgId!: string;
}

/** A route addressing one domain of one workspace. */
export class DomainParams extends OrgParams {
  @IsUUID()
  domainId!: string;
}

/** A route addressing one GitHub organisation of one workspace, by its login. */
export class GithubOrgParams extends OrgParams {
  @Matches(ORG_LOGIN_PATTERN, {
    message: "login must be a lower-case GitHub organisation login",
  })
  @Length(1, 39)
  login!: string;
}

/** A route addressing one repository within one GitHub organisation. */
export class RepoParams extends GithubOrgParams {
  @Matches(REPO_NAME_PATTERN, { message: "name must be a lower-case GitHub repository name" })
  @Length(1, 100)
  name!: string;
}

/** `POST /api/v1/orgs/{orgId}/domains`. */
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

  /** Make this the workspace's primary domain, demoting whichever one holds it now. */
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/**
 * `PATCH /api/v1/orgs/{orgId}/domains/{domainId}` — the set-primary operation.
 *
 * One field, because it is the only thing about a domain that can change: the domain itself
 * is what the row *is*, and renaming one is adding the new one and removing the old.
 */
export class UpdateDomainBody {
  @IsBoolean()
  isPrimary!: boolean;
}

/** `POST /api/v1/orgs/{orgId}/github-orgs`. */
export class CreateGithubOrgBody {
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

/**
 * `PATCH /api/v1/orgs/{orgId}/github-orgs/{login}` — enable or disable.
 *
 * The Step 2 switch (`docs/mockups/01-login.html`), as a request body.
 */
export class UpdateGithubOrgBody {
  @IsBoolean()
  enabled!: boolean;
}

/**
 * `PATCH /api/v1/orgs/{orgId}/github-orgs/{login}/repos/{name}` — enable or disable.
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
