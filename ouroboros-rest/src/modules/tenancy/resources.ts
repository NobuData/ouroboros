/**
 * What the API returns, and the one place a database row becomes it.
 *
 * The tables and the JSON deliberately do not have the same shape, and the difference is
 * worth stating because `src/modules/db/schema.ts` argues the opposite case for itself:
 *
 *   * **Rows keep the database's names.** `is_primary`, `created_at`, `organization_id` —
 *     because a type that renamed them would be a mapping nobody could grep for between a
 *     migration and a query.
 *   * **Resources keep the API's.** `isPrimary`, `createdAt`, `orgId` — because the
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
 *
 * ## Two words called "org", kept apart by one rule
 *
 * `orgId` in every resource below is the **workspace** — an `ouroboros.organization` row,
 * what `/api/v1/orgs/{orgId}` addresses. A *GitHub* organisation is never identified by that
 * name: it is `login` where it is addressed and `githubOrgId` where a child row points at it.
 * The rule is worth stating because the collision is what
 * [#714](https://github.com/NobuData/ouroboros/issues/714) inherited and the paths are what
 * resolve it.
 */

import type {
  Organization,
  OrganizationRole,
  GithubOrg,
  GithubRepo,
  TenantDomain,
} from "../db/schema";

/** How many of something are on, and how many there are. */
export interface RepoCounts {
  /** Rows whose own `enabled` is true. */
  enabled: number;
  /** Rows, whatever their flag. `enabled` is never greater than this. */
  total: number;
}

/**
 * One GitHub organisation as a Step 2 row carries it — enough to draw a switch and to
 * address the `PATCH` that flips it.
 *
 * A summary rather than the full {@link GithubOrgResource}: the ids and timestamps a
 * settings screen pages through are noise on a first-run card, and `login` is what the
 * enable/disable path takes.
 */
export interface GithubOrgSummary {
  /** The lower-cased GitHub login — the `{login}` in the `PATCH` path. */
  login: string;
  /** Whether Ouroboros may operate in it. */
  enabled: boolean;
  /** Its repositories, on and in total. */
  repoCounts: RepoCounts;
}

/**
 * One workspace the signed-in person belongs to — mockup 01 Step 2's row, field for field.
 *
 * Shaped so that [#719](https://github.com/NobuData/ouroboros/issues/719) renders it without
 * transformation, which is the issue's own requirement and the reason the derived fields
 * ({@link monogramOf}, {@link isPersonal}) are computed here rather than in the browser: a
 * client that had to derive them would be a second place the rule lives, and the two would
 * disagree the first time either changed.
 *
 * ```
 * ┌────┐  acme-robotics ✓                          ┌────●
 * │ AR │  4 repos enabled · incl. helios-firmware  └────┘
 * └────┘
 *   ▲     ▲              ▲     ▲                     ▲
 *   │     slug           │     featuredRepo          enabled
 *   monogram             repoCounts.enabled
 * ```
 */
export interface OrgRowResource {
  /** The workspace's id — the `{orgId}` every other route in this module takes. */
  id: string;
  /** The handle. What the mockup prints as the row's name. */
  slug: string;
  /** What a human reads — `organization.name`. The monogram is derived from it. */
  name: string;
  /** Initials for the avatar the mockup draws in place of a logo. See {@link monogramOf}. */
  monogram: string;
  /** Whether this is somebody's own workspace — the mockup's `personal` pill. */
  personal: boolean;
  /**
   * What the caller may do here.
   *
   * **A list, not a word**, because `member.role` is (V005) — see `ActiveMembership`. It is
   * what a screen greys the switch out on: `owner` and `admin` may toggle, `member` and
   * `viewer` may look. Ordinarily one entry; possibly none, for a membership carrying only
   * roles this service does not recognise.
   */
  roles: OrganizationRole[];
  /**
   * Whether **any** of this workspace's GitHub organisations is switched on.
   *
   * The row's own switch, and a summary of the ones in {@link OrgRowResource.githubOrgs}
   * rather than a flag of its own: there is nothing in the database that is "the workspace's
   * enablement", and inventing one would be a fourth flag to keep in step with three.
   */
  enabled: boolean;
  /**
   * Repositories across every GitHub organisation here — the `N repos enabled` line.
   *
   * Counted on the repository's *own* flag, without regard to its organisation's. The two are
   * independent by design (V003: a repo is in scope only when both are true), and a count
   * that folded them together would make turning an organisation off look like losing the
   * per-repository choices underneath it — which is exactly what the two flags exist to
   * prevent.
   */
  repoCounts: RepoCounts;
  /**
   * One enabled repository to name in the mockup's `incl. <repo>`, or `null` when none is.
   *
   * The earliest-recorded enabled repository in the first of this workspace's GitHub
   * organisations (by login) that has one — which for the development seed is
   * `helios-firmware`, the repository the mockup names. Earliest rather than alphabetical
   * because "the first one you turned on" is a more useful thing to show a person than "the
   * one whose name happens to sort first"; deterministic either way, which is what keeps the
   * line from changing between two identical requests.
   */
  featuredRepo: string | null;
  /** Its GitHub organisations, by login — what the switch acts on. */
  githubOrgs: GithubOrgSummary[];
  /** When the workspace came into being. The listing's own order. */
  createdAt: string;
}

/** An email domain that resolves this workspace at sign-in. */
export interface DomainResource {
  id: string;
  /** The owning workspace. */
  orgId: string;
  domain: string;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A GitHub organisation this workspace has added, enabled or not. */
export interface GithubOrgResource {
  id: string;
  /** The owning workspace. */
  orgId: string;
  login: string;
  enabled: boolean;
  /** `null` until the GitHub App installation flow exists. */
  installedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A repository within a GitHub organisation.
 *
 * In scope for Ouroboros only when this *and* its organisation are enabled — see
 * {@link OrgRowResource.repoCounts}, which counts the first of those two flags only.
 */
export interface RepoResource {
  id: string;
  /** The GitHub organisation it belongs to — `github_orgs.id`, not the workspace. */
  githubOrgId: string;
  name: string;
  enabled: boolean;
  /** `null` until it has been discovered from GitHub. */
  defaultBranch: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Everything a row of {@link OrgRowResource} is assembled from.
 *
 * Declared here rather than inferred from three queries so that `orgs.service.ts` states what
 * it needs and the repositories are checked against it.
 */
export interface OrgRow {
  /** The workspace itself. */
  organization: Organization;
  /** What the caller holds in it. */
  roles: readonly OrganizationRole[];
  /** Its GitHub organisations with their counts, by login. */
  githubOrgs: readonly GithubOrgSummary[];
  /** The earliest-recorded enabled repository across them, or `null`. */
  featuredRepo: string | null;
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
 *   installed yet" and "installed at the epoch" are different facts.
 */
function maybeAt(instant: Date | null): string | null {
  return instant === null ? null : at(instant);
}

/**
 * The initials a workspace's avatar shows when it has no logo.
 *
 * `Acme Robotics` → `AR`, `Ken Suenobu` → `KS`, `Globex` → `GL` — the monograms mockup 01
 * Step 2 draws. Two characters, because that is what the mockup's circle holds; the first
 * letter of each of the first two words, or the first two letters when there is only one
 * word.
 *
 * Split on anything that is not a letter or a digit, which is what makes `Acme, Inc.` produce
 * `AI` rather than `A,`. Unicode-aware, because a workspace called `Ürün Ekibi` is a name
 * somebody will really have and `Ü` is not `[A-Z]`.
 *
 * @param name - `organization.name`, which V005 declares `not null`.
 * @returns One or two upper-case characters, or `""` for a name with no letters or digits in
 *   it at all — which is a state the plugin should not create and which the UI renders as an
 *   empty circle rather than as a crash.
 */
export function monogramOf(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== "");

  if (words.length === 0) {
    return "";
  }

  const initials = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`;

  return initials.toUpperCase();
}

/**
 * Is this somebody's own workspace?
 *
 * `{"personal": true}` is what `src/auth/active.organization.ts` writes onto the organization
 * it creates for a person at their first sign-in, and it is the only thing that writes it —
 * `POST /api/auth/organization/create` strips the key from whatever a client sends. So this
 * reads a flag the *service* set, which is what makes the mockup's `personal` pill a fact
 * rather than a claim.
 *
 * @param metadata - The column, which V005 holds as **text** and
 *   `organization_metadata_is_json` keeps parseable.
 * @returns Whether the flag is present and exactly `true`. Anything else — absent, `null`,
 *   `"true"`, a JSON scalar, or text the check constraint somehow admitted — is `false`.
 *   Unparseable metadata must not fail the listing: a workspace whose pill is missing is a
 *   worse screen, and a workspace nobody can see is a broken one.
 */
export function isPersonal(metadata: string | null): boolean {
  if (metadata === null) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(metadata);

    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { personal?: unknown }).personal === true
    );
  } catch {
    return false;
  }
}

/**
 * @param row - A workspace, the caller's roles in it, and its enablement counts.
 * @returns The Step 2 row.
 */
export function orgRowResource(row: OrgRow): OrgRowResource {
  const githubOrgs = [...row.githubOrgs];

  return {
    id: row.organization.id,
    slug: row.organization.slug,
    name: row.organization.name,
    monogram: monogramOf(row.organization.name),
    personal: isPersonal(row.organization.metadata),
    roles: [...row.roles],
    enabled: githubOrgs.some((org) => org.enabled),
    repoCounts: {
      enabled: githubOrgs.reduce((sum, org) => sum + org.repoCounts.enabled, 0),
      total: githubOrgs.reduce((sum, org) => sum + org.repoCounts.total, 0),
    },
    featuredRepo: row.featuredRepo,
    githubOrgs,
    createdAt: at(row.organization.createdAt),
  };
}

/**
 * @param row - A row of `ouroboros.tenant_domains`.
 * @returns Its API representation.
 */
export function domainResource(row: TenantDomain): DomainResource {
  return {
    id: row.id,
    orgId: row.organization_id,
    domain: row.domain,
    isPrimary: row.is_primary,
    createdAt: at(row.created_at),
    updatedAt: at(row.updated_at),
  };
}

/**
 * @param row - A row of `ouroboros.github_orgs`.
 * @returns Its API representation.
 */
export function githubOrgResource(row: GithubOrg): GithubOrgResource {
  return {
    id: row.id,
    orgId: row.organization_id,
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
    githubOrgId: row.org_id,
    name: row.name,
    enabled: row.enabled,
    defaultBranch: row.default_branch,
    createdAt: at(row.created_at),
    updatedAt: at(row.updated_at),
  };
}
