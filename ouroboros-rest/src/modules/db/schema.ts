/**
 * The tenancy schema, as TypeScript — one interface per table Flyway has created.
 *
 * `docs/ARCHITECTURE.md` decision **D3**: `ouroboros-rest` writes no DDL. `ouroboros-db`'s
 * migrations own every table, index, constraint and trigger, and this file *mirrors* them
 * so a query can be type-checked. Nothing here creates anything, and nothing here is
 * consulted at run time by PostgreSQL — if the two disagree, the migration is right and
 * this file is wrong.
 *
 * Which is exactly the failure mode a mirror has, so the disagreement is checked rather
 * than trusted. {@link TABLE_COLUMNS} restates the same column names as *values*;
 * `schema.spec.ts` fails to compile if that list and these interfaces drift apart, and
 * `db.integration-spec.ts` fails if the list and a migrated database drift apart. The two
 * together are what make "the types mirror the migrations" a claim something checks.
 *
 * Three conventions, each of them a decision:
 *
 *   * **Names are the database's, not JavaScript's.** `display_name`, not `displayName`.
 *     Kysely offers a `CamelCasePlugin` that would translate them, and translating is the
 *     one thing a mirror must not do: a name that differs between the migration and the
 *     type is a mapping nobody can grep for, and it puts the drift check — which compares
 *     literal strings against `information_schema` — one convention away from being
 *     unable to compare anything at all.
 *   * **A `CHECK (x in (…))` becomes a union type.** `ouroboros-db` deliberately uses text
 *     with a check constraint rather than a PostgreSQL enum, so that adding a value later
 *     is an ordinary migration. The union here is what gives the same value a compile-time
 *     meaning; widening it is the migration's counterpart in this file.
 *   * **What the database fills in, application code may not overwrite.** `created_at` and
 *     `updated_at` are {@link Stamped}: readable, optional on insert, and absent from the
 *     update type — because `ouroboros.touch_updated_at()` sets `updated_at` from the
 *     server clock on every update and ignores whatever the statement supplied. A type that
 *     let someone write it would promise something the trigger then quietly discards.
 *
 * Regenerating this by hand is deliberate. The issue permits either hand-maintenance or
 * `kysely-codegen` against the development database; hand-maintained wins here because
 * the generator's output cannot carry the union types above, the trigger-owned columns, or
 * the reasons — and the drift check makes the generator's real contribution (catching a
 * column that moved) something CI does on every run rather than something a developer has
 * to remember to run.
 */

import type { ColumnType, Generated, Insertable, Selectable } from "kysely";

/**
 * The PostgreSQL schema every table below lives in.
 *
 * The migrations qualify their own DDL — `create table ouroboros.tenants` — so the name is
 * fixed by them rather than configurable here, and `OURO_DB_SCHEMA` only tells Flyway
 * which schema to create and record history in. `db.service.ts` applies this in two
 * places, both from this constant: Kysely's `WithSchemaPlugin`, which qualifies every
 * generated statement, and the connection's `search_path`, which covers a raw `sql`
 * fragment the plugin cannot see.
 */
export const SCHEMA_NAME = "ouroboros";

/**
 * A timestamp the database is responsible for.
 *
 * Selectable as a `Date` (`pg` parses `timestamptz` for us), optional on insert — every
 * one of these columns has a `default now()` — and **not updateable**: see this file's
 * header on `touch_updated_at()`.
 */
export type Stamped = ColumnType<Date, Date | undefined, never>;

/**
 * The tables BetterAuth owns, which this service reads and does not write.
 *
 * `V004` and `V005` are the library's own DDL, and the library is the only thing that writes
 * those rows — through its adapter, which mints ids, maps field names and converts dates the
 * way its own routes expect. A hand-written `insert` into `organization` or `member` would be
 * a second implementation of all three, and the first one to drift would drift silently.
 *
 * It is a rule rather than a type, deliberately, after the type was tried: a column of
 * `ColumnType<T, never, never>` makes Kysely's `Insertable` resolve to `{}`, which accepts
 * *any* object literal rather than refusing every one — a guarantee that reads as airtight in
 * the schema and holds nothing at the call site. `organization.repository.spec.ts` enforces
 * the rule where it can actually be enforced: it reads this module's own source and fails on
 * a write verb naming either table.
 */
export const LIBRARY_OWNED_TABLES = ["organization", "member"] as const;

/**
 * `member.role` — what a person may do in one organization (V005).
 *
 * The same four words `tenant_members.role` held, which is what made
 * [#708](https://github.com/NobuData/ouroboros/issues/708) a rename rather than a re-think.
 * The difference is where the vocabulary is *decided*: V002 pinned it with a check
 * constraint, and V005 deliberately does not — the list is the organization plugin's
 * configuration, and `src/auth/organization.roles.ts` is where this service states it.
 * `organization.roles.spec.ts` asserts the two agree, which is what keeps this union from
 * becoming a third opinion.
 *
 * Because nothing in the database enforces it, a value outside this union is *possible* in a
 * row — a plugin upgrade, a hand-written insert — and the tenancy code treats one as a role
 * it does not recognise rather than assuming it away. See `organization.repository.ts`.
 */
export type OrganizationRole = "owner" | "admin" | "member" | "viewer";

/**
 * `ouroboros.tenant_domains` — the email domains that resolve a workspace at sign-in (V001,
 * re-parented by V006).
 *
 * Stored lower-cased and globally unique, so a lookup is `where domain = lower($1)` and
 * one domain names exactly one workspace. `tenant_domains_domain_key` is the index #712's
 * discovery route reads, and V006 preserved it untouched.
 */
export interface TenantDomainsTable {
  id: Generated<string>;
  /** Lower-cased domain, unique across the whole table. */
  domain: string;
  /** The domain displayed back to the user. At most one per workspace; zero is legal. */
  is_primary: Generated<boolean>;
  created_at: Stamped;
  updated_at: Stamped;
  /**
   * Owning organization — `organization."id"`, as text. `on delete cascade`.
   *
   * Was `tenant_id` until [#708](https://github.com/NobuData/ouroboros/issues/708). It is
   * *last* here rather than second because that is where V006's `alter table … add column`
   * put it, and this file's own rule is that the order is the migration's — so a diff of the
   * interface against the DDL still reads top to bottom.
   */
  organization_id: string;
}

/**
 * `ouroboros.organization` — a workspace, as the organization plugin holds one (V005).
 *
 * The successor to {@link TenantsTable}: #708 moved every tenant into this table with its id
 * preserved, and dropped the old one. Names are the *library's* — camelCase, quoted — for
 * the reason V004's header gives, and this file's rule about mirroring rather than
 * translating applies with more force here than anywhere: these are the names a
 * `@better-auth/cli generate` emits, and a drift check that compared translated ones would
 * compare nothing.
 *
 * There is no `status` and no `updated_at`. V001 had both; the plugin's schema has neither,
 * and adding them would be columns the library never writes and every future `generate`
 * would report as drift ([#710](https://github.com/NobuData/ouroboros/issues/710)).
 */
export interface OrganizationTable {
  /** The workspace's id. Text, because the library mints its own; V006 preserved uuids. */
  id: string;
  /** What a human reads — V001's `display_name` under the library's name for it. */
  name: string;
  /** URL- and CLI-safe handle, unique across the installation. */
  slug: string;
  /** The workspace's avatar as a URL, or null when none is set. */
  logo: string | null;
  /** When it came into being. No `updatedAt` counterpart — the plugin declares none. */
  createdAt: Date;
  /**
   * JSON held as **text**, and `organization_metadata_is_json` keeps it parseable.
   *
   * Carries `{"personal": true}` for the organization made for somebody at their first
   * sign-in — see `src/auth/active.organization.ts`, which is the only thing that writes it.
   */
  metadata: string | null;
}

/**
 * `ouroboros.member` — a person's role in one organization (V005).
 *
 * The successor to {@link TenantMembersTable}, and the table every tenant-scoped request is
 * authorized against ([#713](https://github.com/NobuData/ouroboros/issues/713)). The
 * difference from V002 is the key: a membership has a surrogate `id` here, because the
 * plugin's `removeMember` and `updateMemberRole` address one by a single value, and the
 * `(organizationId, userId)` pair it used to be keyed on is a unique constraint instead.
 */
export interface MemberTable {
  /** Surrogate key, minted by the library. */
  id: string;
  /** The organization. Half of `member_organization_user_key`. `on delete cascade`. */
  organizationId: string;
  /** The person — `"user".id`. The other half. `on delete cascade`. */
  userId: string;
  /**
   * What they may do here.
   *
   * Typed as text rather than as {@link OrganizationRole} because the column is *not*
   * check-constrained and holds a **comma-separated list** for a member holding more than
   * one role (V005's column comment). Narrowing it to the union in the type would be this
   * file claiming a guarantee the database does not make; `organization.repository.ts` is
   * where the text becomes roles, and where a word this service does not recognise is
   * dropped rather than trusted.
   */
  role: string;
  /** When the membership was created. The plugin's only timestamp on it. */
  createdAt: Date;
}

/**
 * `ouroboros.github_orgs` — GitHub organisations a workspace has enabled (V003, re-parented
 * by V006).
 *
 * With {@link GithubReposTable}, the boundary of where Ouroboros may operate: a repo is in
 * scope only when its own `enabled` and its org's are **both** true.
 *
 * **Not to be confused with {@link OrganizationTable}.** These are *GitHub's* organisations;
 * that one is the workspace they are enabled in. The API keeps the two apart in its paths —
 * `/api/v1/orgs/{orgId}/github-orgs/{login}` — and this file keeps them apart by name.
 */
export interface GithubOrgsTable {
  id: Generated<string>;
  /** Lower-cased GitHub org login, unique within the workspace. */
  login: string;
  /** Deliberate opt-in; defaults false, so anything created by a future flow is off. */
  enabled: Generated<boolean>;
  /** When the GitHub App was installed, or null until the installation flow exists. */
  installed_at: Date | null;
  created_at: Stamped;
  updated_at: Stamped;
  /**
   * Owning organization — enablement is per workspace, not global. `on delete cascade`.
   *
   * Was `tenant_id` until #708, and last for the reason
   * {@link TenantDomainsTable.organization_id} gives. `github_orgs_org_login_key` is the
   * `(organization_id, login)` unique key V006 declared in its place.
   */
  organization_id: string;
}

/**
 * `ouroboros.github_repos` — repositories within an enabled GitHub org (V003).
 *
 * Hung off the GitHub org rather than off the workspace: the workspace is reachable through
 * `org_id`, and a second copy of that fact could disagree with the org's. That is also why
 * V006 left this table alone while it re-parented every other one.
 */
export interface GithubReposTable {
  id: Generated<string>;
  /** Owning org. `on delete cascade`, which is the second hop of the tenant cascade. */
  org_id: string;
  /** Lower-cased repo name within the org, without the owner prefix. Unique per org. */
  name: string;
  /** Deliberate opt-in, independent of the org's flag. */
  enabled: Generated<boolean>;
  /** The branch work is cut from; null until discovered from GitHub. */
  default_branch: string | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * Every table `ouroboros-rest` may query, keyed by its name in the database.
 *
 * This is the type parameter the whole module is built around: `Kysely<Database>` is what
 * makes `selectFrom("organization").select("slug")` compile and `select("slugg")` not.
 *
 * **Five tables, where V005 left nine.** `tenants`, `tenant_members`, `users` and
 * `user_identities` were dropped by V006 and are gone from here with it
 * ([#714](https://github.com/NobuData/ouroboros/issues/714)) — a mirror that still declared
 * them would let a query compile against a table PostgreSQL would refuse, which is the exact
 * failure this file exists to prevent. `ouroboros-db/tests/constraints.sql` asserts all four
 * stay gone, so there is no state in which re-adding them here would be right.
 */
export interface Database {
  tenant_domains: TenantDomainsTable;
  organization: OrganizationTable;
  member: MemberTable;
  github_orgs: GithubOrgsTable;
  github_repos: GithubReposTable;
}

/**
 * The same column names, as values — what the drift checks compare.
 *
 * `satisfies` is doing real work: it is a compile error to name a table that is not in
 * {@link Database} or a column that is not in its interface. Completeness — a column
 * declared above but missing from a list here — is the other half, and is checked in
 * `schema.spec.ts`, which is also where the reason for both is written down.
 *
 * The order within each array is the order the migrations declare, so a diff of this file
 * against a migration reads top to bottom.
 */
export const TABLE_COLUMNS = {
  tenant_domains: ["id", "domain", "is_primary", "created_at", "updated_at", "organization_id"],
  organization: ["id", "name", "slug", "logo", "createdAt", "metadata"],
  member: ["id", "organizationId", "userId", "role", "createdAt"],
  github_orgs: [
    "id",
    "login",
    "enabled",
    "installed_at",
    "created_at",
    "updated_at",
    "organization_id",
  ],
  github_repos: ["id", "org_id", "name", "enabled", "default_branch", "created_at", "updated_at"],
} as const satisfies { [T in keyof Database]: readonly (keyof Database[T])[] };

/** Every table name, for a caller that wants to iterate them. */
export const TABLE_NAMES = Object.keys(TABLE_COLUMNS) as (keyof Database)[];

/** A row of `ouroboros.tenant_domains`, as a `select` returns it. */
export type TenantDomain = Selectable<TenantDomainsTable>;
/** The columns an `insert` into `ouroboros.tenant_domains` may carry. */
export type NewTenantDomain = Insertable<TenantDomainsTable>;

/**
 * A row of `ouroboros.organization`, as a `select` returns it.
 *
 * The workspace a request operates in — what `@CurrentTenant()` hands a handler since
 * [#713](https://github.com/NobuData/ouroboros/issues/713). There is deliberately no
 * `NewOrganization`: the table is one of {@link LIBRARY_OWNED_TABLES} and nothing here
 * inserts into it.
 */
export type Organization = Selectable<OrganizationTable>;

/**
 * A row of `ouroboros.member`, as a `select` returns it.
 *
 * `role` is the column's raw text — see {@link MemberTable.role}. Nothing outside
 * `organization.repository.ts` should read it without going through the parse there.
 */
export type Member = Selectable<MemberTable>;

/** A row of `ouroboros.github_orgs`, as a `select` returns it. */
export type GithubOrg = Selectable<GithubOrgsTable>;
/** The columns an `insert` into `ouroboros.github_orgs` may carry. */
export type NewGithubOrg = Insertable<GithubOrgsTable>;

/** A row of `ouroboros.github_repos`, as a `select` returns it. */
export type GithubRepo = Selectable<GithubReposTable>;
/** The columns an `insert` into `ouroboros.github_repos` may carry. */
export type NewGithubRepo = Insertable<GithubReposTable>;
