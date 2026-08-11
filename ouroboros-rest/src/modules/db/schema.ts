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
 *   * **What the database fills in, application code may not overwrite.** `created_at`,
 *     `updated_at` and `invited_at` are {@link Stamped}: readable, optional on insert, and
 *     absent from the update type — because `ouroboros.touch_updated_at()` sets
 *     `updated_at` from the server clock on every update and ignores whatever the
 *     statement supplied. A type that let someone write it would promise something the
 *     trigger then quietly discards.
 *
 * Regenerating this by hand is deliberate. The issue permits either hand-maintenance or
 * `kysely-codegen` against the development database; hand-maintained wins here because
 * the generator's output cannot carry the union types above, the trigger-owned columns, or
 * the reasons — and the drift check makes the generator's real contribution (catching a
 * column that moved) something CI does on every run rather than something a developer has
 * to remember to run.
 */

import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

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

/** `tenants.status` — the values `tenants_status_valid` admits (V001). */
export type TenantStatus = "active" | "suspended" | "deleted";

/** `tenant_members.role` — the values `tenant_members_role_valid` admits (V002). */
export type TenantRole = "owner" | "admin" | "member" | "viewer";

/** `user_identities.provider` — the values `user_identities_provider_valid` admits (V002). */
export type IdentityProvider = "github";

/**
 * `ouroboros.tenants` — an isolated customer workspace (V001).
 *
 * The root of the schema: everything else is reachable from a row here by following
 * foreign keys, and every one of those keys cascades.
 */
export interface TenantsTable {
  /** Surrogate key, `gen_random_uuid()`. Every foreign key in the schema points here. */
  id: Generated<string>;
  /** URL- and CLI-safe handle, unique across the installation. DNS-label shaped. */
  slug: string;
  /** What a human reads. Free text; non-blank. */
  display_name: string;
  /** Lifecycle. `deleted` is a soft-delete marker, not a hard removal. */
  status: Generated<TenantStatus>;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.tenant_domains` — the email domains that resolve a tenant at sign-in (V001).
 *
 * Stored lower-cased and globally unique, so a lookup is `where domain = lower($1)` and
 * one domain names exactly one tenant.
 */
export interface TenantDomainsTable {
  id: Generated<string>;
  /** Owning tenant. `on delete cascade`. */
  tenant_id: string;
  /** Lower-cased domain, unique across the whole table. */
  domain: string;
  /** The domain displayed back to the user. At most one per tenant; zero is legal. */
  is_primary: Generated<boolean>;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.users` — a person (V002).
 *
 * Global rather than tenant-scoped, so one human can hold roles in several tenants.
 */
export interface UsersTable {
  id: Generated<string>;
  /** Lower-cased, unique. How a person is recognised — not how they authenticate. */
  email: string;
  /** What the member list prints beside the avatar. Non-blank. */
  display_name: string;
  /** `http(s)` URL, or null when none is known. */
  avatar_url: string | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.user_identities` — an external account a person has proved control of (V002).
 *
 * **Records which account only.** No token, secret or credential is stored here, and none
 * may be added: `ouroboros-db/tests/constraints.sql` reads `information_schema` and fails
 * if a column whose name looks like a credential ever appears on this table.
 */
export interface UserIdentitiesTable {
  id: Generated<string>;
  /** The person this identity belongs to. `on delete cascade`. */
  user_id: string;
  /** Which external system issued it. */
  provider: IdentityProvider;
  /** The provider's immutable id — GitHub's numeric user id, not the renameable login. */
  external_id: string;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.tenant_members` — a person's role in one tenant (V002).
 *
 * Keyed on the `(tenant_id, user_id)` pair rather than a surrogate id, which is what makes
 * "a user cannot join a tenant twice" true by construction. There is deliberately no
 * `created_at`: `invited_at` is when the row came into being.
 */
export interface TenantMembersTable {
  /** Half of the primary key. `on delete cascade`. */
  tenant_id: string;
  /** The other half. `on delete cascade`. */
  user_id: string;
  /** What this person may do in this tenant. No default — a caller must decide. */
  role: TenantRole;
  /** When the invitation was issued; also the row's creation time. */
  invited_at: Stamped;
  /** When it was accepted, or null while the invitation is outstanding. */
  joined_at: Date | null;
  updated_at: Stamped;
}

/**
 * `ouroboros.github_orgs` — GitHub organisations a tenant has enabled (V003).
 *
 * With {@link GithubReposTable}, the boundary of where Ouroboros may operate: a repo is in
 * scope only when its own `enabled` and its org's are **both** true.
 */
export interface GithubOrgsTable {
  id: Generated<string>;
  /** Owning tenant — enablement is per tenant, not global. `on delete cascade`. */
  tenant_id: string;
  /** Lower-cased GitHub org login, unique within the tenant. */
  login: string;
  /** Deliberate opt-in; defaults false, so anything created by a future flow is off. */
  enabled: Generated<boolean>;
  /** When the GitHub App was installed, or null until the installation flow exists. */
  installed_at: Date | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.github_repos` — repositories within an enabled org (V003).
 *
 * Hung off the org rather than off the tenant: the tenant is reachable through `org_id`,
 * and a second copy of that fact could disagree with the org's.
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
 * makes `selectFrom("tenants").select("slug")` compile and `select("slugg")` not.
 */
export interface Database {
  tenants: TenantsTable;
  tenant_domains: TenantDomainsTable;
  users: UsersTable;
  user_identities: UserIdentitiesTable;
  tenant_members: TenantMembersTable;
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
  tenants: ["id", "slug", "display_name", "status", "created_at", "updated_at"],
  tenant_domains: ["id", "tenant_id", "domain", "is_primary", "created_at", "updated_at"],
  users: ["id", "email", "display_name", "avatar_url", "created_at", "updated_at"],
  user_identities: ["id", "user_id", "provider", "external_id", "created_at", "updated_at"],
  tenant_members: ["tenant_id", "user_id", "role", "invited_at", "joined_at", "updated_at"],
  github_orgs: ["id", "tenant_id", "login", "enabled", "installed_at", "created_at", "updated_at"],
  github_repos: ["id", "org_id", "name", "enabled", "default_branch", "created_at", "updated_at"],
} as const satisfies { [T in keyof Database]: readonly (keyof Database[T])[] };

/** Every table name, for a caller that wants to iterate them. */
export const TABLE_NAMES = Object.keys(TABLE_COLUMNS) as (keyof Database)[];

/** A row of `ouroboros.tenants`, as a `select` returns it. */
export type Tenant = Selectable<TenantsTable>;
/** The columns an `insert` into `ouroboros.tenants` may carry. */
export type NewTenant = Insertable<TenantsTable>;
/** The columns an `update` of `ouroboros.tenants` may carry. */
export type TenantUpdate = Updateable<TenantsTable>;

/** A row of `ouroboros.tenant_domains`, as a `select` returns it. */
export type TenantDomain = Selectable<TenantDomainsTable>;
/** The columns an `insert` into `ouroboros.tenant_domains` may carry. */
export type NewTenantDomain = Insertable<TenantDomainsTable>;

/** A row of `ouroboros.users`, as a `select` returns it. */
export type User = Selectable<UsersTable>;
/** The columns an `insert` into `ouroboros.users` may carry. */
export type NewUser = Insertable<UsersTable>;

/** A row of `ouroboros.user_identities`, as a `select` returns it. */
export type UserIdentity = Selectable<UserIdentitiesTable>;
/** The columns an `insert` into `ouroboros.user_identities` may carry. */
export type NewUserIdentity = Insertable<UserIdentitiesTable>;

/** A row of `ouroboros.tenant_members`, as a `select` returns it. */
export type TenantMember = Selectable<TenantMembersTable>;
/** The columns an `insert` into `ouroboros.tenant_members` may carry. */
export type NewTenantMember = Insertable<TenantMembersTable>;

/** A row of `ouroboros.github_orgs`, as a `select` returns it. */
export type GithubOrg = Selectable<GithubOrgsTable>;
/** The columns an `insert` into `ouroboros.github_orgs` may carry. */
export type NewGithubOrg = Insertable<GithubOrgsTable>;

/** A row of `ouroboros.github_repos`, as a `select` returns it. */
export type GithubRepo = Selectable<GithubReposTable>;
/** The columns an `insert` into `ouroboros.github_repos` may carry. */
export type NewGithubRepo = Insertable<GithubReposTable>;
