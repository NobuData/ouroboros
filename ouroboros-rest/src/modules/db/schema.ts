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
 * a write verb naming any of them.
 *
 * **`"user"` joined the list with AD.4** ([#225](https://github.com/NobuData/ouroboros/issues/225)),
 * and it is the first of the library's tables here that no *authorization* decision reads.
 * The audit trail's one query joins it for a person's `name`, because a trail of ids is a
 * trail nobody can read and the alternative is the browser resolving each distinct actor
 * against BetterAuth's own routes — one round trip per person, to render a column.
 *
 * Mirroring it does not make it writable. The rule above covers all three, and every foreign
 * key that points at this table from our own schema (`provider_connections.added_by`,
 * `model_aliases.updated_by`, `route_revisions.actor`, `audit_events.actor_id`) already
 * treated a person as somebody else's row; this only lets a `select` say their name.
 */
export const LIBRARY_OWNED_TABLES = ["user", "organization", "member"] as const;

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
 * `ouroboros."user"` — a person, as BetterAuth's core schema declares them (V004,
 * [#706](https://github.com/NobuData/ouroboros/issues/706)).
 *
 * The successor to V002's `users`, which V006 dropped. Quoted everywhere because `user` is a
 * reserved word, and named in the library's camelCase for the reason V004's header gives:
 * these are the names `@better-auth/cli generate` emits, and a mirror that translated them
 * would make every drift check compare nothing.
 *
 * **Read-only here, and read by exactly one query.** It is in
 * {@link LIBRARY_OWNED_TABLES} — the library mints these rows through its own adapter — and
 * the only statement in this service that names it is the audit trail's join, for `name`. A
 * session's user is not read from here: `auth/principal.ts` gets it from BetterAuth, which
 * has already resolved it.
 */
export interface UserTable {
  /** The person's id. Text, because the library mints its own; V006 preserved uuids. */
  id: string;
  /** What a human reads, and the only column anything in this service selects. */
  name: string;
  /** Unique across the installation. Deliberately not selected by the trail — see below. */
  email: string;
  /** Whether the address has been confirmed. */
  emailVerified: boolean;
  /** An avatar URL, or null when none is set. */
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

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
 * `user_preferences.font_scale` — the five steps of the reader's font-size preference
 * (V007, [#649](https://github.com/NobuData/ouroboros/issues/649)).
 *
 * The union is `user_preferences_font_scale`'s CHECK, mirrored the way this file's header
 * says a CHECK becomes a type. Text rather than a number end to end, because the value is a
 * *label* the UI stamps onto `<html>` — nothing computes with it, `'100.0'` must not equal
 * `'100'`, and a numeric would round-trip through JSON as a float.
 */
export type FontScale = "87.5" | "100" | "112.5" | "125" | "150";

/**
 * The same five, as a list — what a DTO validates against and a test iterates.
 *
 * In the order the CHECK declares them, smallest step first. `satisfies` keeps the list and
 * {@link FontScale} from drifting; `preferences.dto.ts` reads this rather than restating it.
 */
export const FONT_SCALES = [
  "87.5",
  "100",
  "112.5",
  "125",
  "150",
] as const satisfies readonly FontScale[];

/** What a person with no stored choice reads as — the column default, § 4's default. */
export const DEFAULT_FONT_SCALE: FontScale = "100";

/**
 * `ouroboros.user_preferences` — per-person product preferences (V007,
 * [#649](https://github.com/NobuData/ouroboros/issues/649)).
 *
 * One row per person, keyed by the BetterAuth user id, holding **choices only**: a person
 * with no row is at every default, and `preferences.repository.ts` synthesizes that answer
 * rather than writing a row nobody asked for. Not a column on `"user"` — that table is the
 * library's shape, held to `betterauth-schema.sql` by ci/db, and a product column there
 * would be drift on the next `generate`. The migration's header carries the full argument.
 */
export interface UserPreferencesTable {
  /** The person — `"user".id`, text (V004). Primary key: one row each. `on delete cascade`. */
  user_id: string;
  /** The reader's font-size step. Defaults to `'100'`; the CHECK holds it to the five. */
  font_scale: Generated<FontScale>;
  created_at: Stamped;
  updated_at: Stamped;
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
  /**
   * When this repository's issues were last polled (V014,
   * [#99](https://github.com/NobuData/ouroboros/issues/99)) — what the backlog card's
   * *"synced 40s ago"* tag is rendered from. Null until the first sync, and moved by a poll
   * that found nothing changed, because that is exactly what the tag claims.
   */
  issues_synced_at: Date | null;
  /**
   * The `since` watermark the next incremental poll sends to GitHub — decision **K2**, and
   * the reason it lives here rather than on an issue: it is one value per repository per
   * poll. `string`, and opaque: the sync service owns the format, and a second parser here
   * would be a second opinion about time zones. Null until a poll has produced one, which
   * `github_repos_issues_cursor_after_sync` holds to *after* a sync rather than before.
   */
  issues_sync_cursor: string | null;
}

/**
 * `ouroboros.github_credentials` — the per-workspace GitHub token the backlog sync
 * authenticates with (V027, [#101](https://github.com/NobuData/ouroboros/issues/101)).
 *
 * One row per workspace, and **no row is the ordinary state**: a workspace that has never
 * had a token has nothing here, which is what the intake page's *"no token configured"*
 * guidance (N.6, [#120](https://github.com/NobuData/ouroboros/issues/120)) is rendered from.
 * Clearing a token deletes the row rather than nulling a column, so there is one state to
 * read instead of two that mean the same thing.
 *
 * **Nothing outside `github/` may select {@link token_encrypted}.** The column holds one of
 * the vault's envelopes (AD.1, [#222](https://github.com/NobuData/ouroboros/issues/222)),
 * `github_credentials_token_sealed` refuses anything else, and the only code that turns one
 * back into a token is `github/github.credentials.service.ts`.
 */
export interface GithubCredentialsTable {
  /**
   * The workspace. Primary key — one token each — and the `recordId` the envelope's
   * additional authenticated data is bound to, which is why it must be a value that never
   * changes. `on delete cascade`.
   */
  organization_id: string;
  /**
   * The token, sealed — `ouro.v1.<version>.<nonce>.<ciphertext>`. Never returned by an API,
   * never logged, and never read by anything but the vault.
   */
  token_encrypted: string;
  created_at: Stamped;
  /**
   * When the token was last written. Past `created_at` means it has been rotated; *who*
   * rotated it is `audit_events` (V022), not this row.
   */
  updated_at: Stamped;
}

/**
 * `github_issues.state` — GitHub's own two (V014,
 * [#99](https://github.com/NobuData/ouroboros/issues/99)).
 *
 * The `github_issues_state` CHECK, mirrored the way this file's header says a CHECK becomes a
 * type, and the filter bar's *State* select. Two words rather than three: a *merged* pull
 * request is not an issue state, and pull requests never reach this table at all — see
 * {@link GithubIssuesTable}.
 */
export type GithubIssueState = "open" | "closed";

/** The same two, in the order the CHECK declares them — what a test iterates. */
export const GITHUB_ISSUE_STATES = [
  "open",
  "closed",
] as const satisfies readonly GithubIssueState[];

/**
 * `github_issues.sizing_status` — where an issue is in *our* sizing pipeline (V014, decision
 * **K4**).
 *
 * The one column of that table this product owns, and the pill mockup 03's backlog table
 * renders. The lifecycle is `unsized → estimating → sized | needs_human`, and moving a row
 * along it is L.3's ([#107](https://github.com/NobuData/ouroboros/issues/107)); the sync
 * writes only the first, because a freshly mirrored issue has no estimate and a row that
 * arrived with any other value would be claiming one that does not exist.
 */
export type SizingStatus = "unsized" | "estimating" | "sized" | "needs_human";

/** The four, in the order the CHECK declares them — lifecycle order, as {@link RunStatus}' lists are. */
export const SIZING_STATUSES = [
  "unsized",
  "estimating",
  "sized",
  "needs_human",
] as const satisfies readonly SizingStatus[];

/**
 * What a freshly mirrored issue is — the column default, and the only value K.4 writes.
 *
 * Named rather than spelled at the one call site, because the sync's *"a new issue enters the
 * estimation pipeline"* handoff and this default are the same fact seen from two sides: the
 * pipeline claims `unsized` work, and the sync is what makes work `unsized`.
 */
export const DEFAULT_SIZING_STATUS: SizingStatus = "unsized";

/**
 * `ouroboros.github_issues` — the mirror of an enabled repository's GitHub issues (V014,
 * [#99](https://github.com/NobuData/ouroboros/issues/99)), filled by K.4
 * ([#102](https://github.com/NobuData/ouroboros/issues/102)).
 *
 * **Decision K3: this is a cache and GitHub is the source of truth.** Of the columns below,
 * exactly one is this product's — {@link sizing_status}. Everything from {@link number} to
 * {@link gh_url} is a *copy of something GitHub owns*, and nothing in this service authors
 * one: a title is re-read from GitHub and overwritten here, never edited here. The migration
 * carries the full argument, and the shape is deliberately unhelpful to the alternative —
 * there is no `edited_by`, no `local_title` and no dirty flag.
 *
 * **Pull requests are not in this table.** GitHub's issues endpoint returns both, and
 * `backlog-sync/issue.mapping.ts` drops anything carrying a `pull_request` key before a row
 * is built. There is no column that would record the difference, deliberately: a PR in the
 * backlog is a bug a user sees immediately, and the only way to be sure one is not stored is
 * for the mirror to have no way to say *this one is a pull request*.
 *
 * **Was deliberately absent from this file until K.4.** V014 landed the table in the same
 * release that left it empty, and a mirrored table with no reader is drift waiting to happen;
 * the sync that fills it is the first thing here that reads or writes a row.
 */
export interface GithubIssuesTable {
  id: Generated<string>;
  /**
   * Owning workspace, and the leading column of every read the backlog screen makes.
   *
   * Held to the repository's own workspace by the `github_issues_repo_in_organization`
   * trigger — the composite foreign key `github_repos` cannot offer, because it reaches the
   * workspace through `github_orgs`. Same rule, same trigger function, as {@link RunsTable}
   * and {@link QueueItemsTable}.
   */
  organization_id: string;
  /** Repository the issue lives in. The upsert key with {@link number}. */
  github_repo_id: string;
  /**
   * The issue number GitHub assigns — the `485` the table renders as `#485`.
   *
   * Unique *within the repository* and meaningless outside it: every repo has a `#1`. That is
   * why `github_issues_repo_number_key` is `(github_repo_id, number)` and not
   * `(organization_id, number)`.
   */
  number: number;
  /**
   * The title as GitHub currently has it.
   *
   * Overwritten by the next sync that sees it change — unlike {@link RunsTable.issue_title},
   * which is frozen at the moment a run started. The two columns look alike and mean opposite
   * things.
   */
  title: string;
  /** The body in full, or null when GitHub's is: an issue opened with no description. */
  body: string | null;
  /** GitHub's own two. The filter bar's *State* select, and what a close flips. */
  state: GithubIssueState;
  /**
   * **GitHub's** label names, as a JSON array of strings — `["bug", "i2c", "watchdog"]`.
   *
   * Not Ouroboros' vocabulary: that is {@link sizing_status} and K.2's estimate. Typed as
   * `string[]` rather than `unknown`, because `github_issues_labels_shape` is a CHECK that
   * refuses anything else and this file's header says a CHECK becomes a type. Read by
   * containment through `github_issues_labels_idx`.
   *
   * `ColumnType` rather than a bare `string[]`: `pg` hands a `jsonb` column back parsed, and
   * Kysely wants the value *written* to be the string a driver will send. Every write here
   * goes through `JSON.stringify`, which is what the `insert`/`update` position says.
   */
  labels: ColumnType<string[], string, string>;
  /**
   * Who opened it — `by field-support` on the panel's meta line.
   *
   * GitHub's login in the case GitHub returns it, **unfolded**: this is a mirrored value and
   * folding it would be an edit, which K3 forbids. Null when GitHub's author is — an issue
   * whose author deleted their account comes back with no user at all.
   */
  author_login: string | null;
  /** When GitHub says the issue was opened — what *"opened 2d ago"* counts from. */
  gh_created_at: Date;
  /**
   * When GitHub last touched it.
   *
   * The value the per-repo `since` watermark is drawn from (decision **K2**), which is why it
   * is not nullable: a row with no update time could not take part in an incremental sync.
   */
  gh_updated_at: Date;
  /** The issue on GitHub — the href behind *"Open on GitHub ↗"*, constrained to `https`. */
  gh_url: string;
  /**
   * When this row was last written from GitHub.
   *
   * Distinct from {@link updated_at}, which the `github_issues_touch_updated_at` trigger moves
   * on *every* update. The sync keeps the two apart the only way an unconditional trigger
   * allows — by not issuing an update when nothing in the row differs — so a row whose
   * `updated_at` moved is a row GitHub actually changed. `github_repos.issues_synced_at` is
   * the per-repository freshness the card renders, and that one moves on every poll,
   * including a poll that found nothing.
   */
  synced_at: Generated<Date>;
  /**
   * Our sizing pipeline (decision **K4**). Defaults to `unsized`, which is what the sync
   * writes and the only value it writes.
   */
  sizing_status: Generated<SizingStatus>;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `issue_estimates.effort` — how much work an issue is (V026, decision **F9**).
 *
 * The `issue_estimates_effort` CHECK, mirrored the way this file's header says a CHECK becomes
 * a type, and the *Effort* column's chip. The same five sizes {@link QueueEffort} holds, and
 * deliberately a separate type from it: the two columns are checked against each other by
 * `ouroboros-db/tests/constraints.sql` rather than by sharing a declaration here, because a
 * shared type would make widening one of them silently widen the other.
 */
export type EstimateEffort = "xs" | "s" | "m" | "l" | "xl";

/** The five, in the order the CHECK declares them — smallest first, so an index is a rank. */
export const ISSUE_ESTIMATE_EFFORTS = [
  "xs",
  "s",
  "m",
  "l",
  "xl",
] as const satisfies readonly EstimateEffort[];

/**
 * `issue_estimates.risk` — how likely the change is to break something (V026).
 *
 * The `issue_estimates_risk` CHECK, and the regression-risk meter's three colours.
 */
export type EstimateRisk = "low" | "medium" | "high";

/** The three, in the order the CHECK declares them — least severe first. */
export const ISSUE_ESTIMATE_RISKS = [
  "low",
  "medium",
  "high",
] as const satisfies readonly EstimateRisk[];

/**
 * `issue_estimates.breakdown` — the *AI Work Breakdown* panel as one document (V026).
 *
 * Named in the **database's** `snake_case` rather than this service's `camelCase`, and that is
 * this file's naming rule reaching one level into a `jsonb` column: the keys are stored bytes
 * that `ouroboros.issue_estimate_breakdown_valid()` checks by name, so a mirror that renamed
 * them would be a mapping nobody can grep for. `estimation/estimation.outcome.ts` is where the
 * engine's `camelCase` becomes this, once.
 *
 * Closed on both sides — the CHECK counts the keys — so an added key is an edit here, in
 * V026 and in the engine's contract, together.
 */
export interface EstimateBreakdownDocument {
  /** Paths the work is believed to touch. `[]` is a real answer; `heuristic-v0` always sends it. */
  files: string[];
  /** What the *work* is expected to cost in model tokens — not what the estimate cost. */
  est_tokens: number;
  /** The optimistic end of the wall-clock range, in minutes. Never above {@link cycle_max}. */
  cycle_min: number;
  /** The pessimistic end, in minutes. */
  cycle_max: number;
  /** The single number M.3's queue write plans with, in minutes. Not confined to the range. */
  est_minutes: number;
}

/**
 * `issue_estimates.trace` — where the estimate came from (V026, decision **K10**).
 *
 * `snake_case` for {@link EstimateBreakdownDocument}'s reason, and one key more than the
 * engine's `EstimateTrace` sends: {@link sized_at} is the writer's, because the engine does not
 * own the clock and a timestamp in a response body is one two services can disagree about.
 */
export interface EstimateTraceDocument {
  /**
   * What produced it — `heuristic-v0` today. Non-blank by `issue_estimates_provenance`, which
   * is decision **K10** as a constraint: an estimate that cannot say what produced it does not
   * get to exist.
   */
  estimator: string;
  /**
   * When the estimate was produced, as an ISO-8601 instant **with an offset**.
   *
   * Checked by regex rather than by cast — see V026 — so `new Date().toISOString()` is the
   * shape that satisfies it and a local time with no zone does not. The same instant as
   * {@link IssueEstimatesTable.created_at} for L.3's synchronous call, and deliberately
   * earlier for O.2's ([#123](https://github.com/NobuData/ouroboros/issues/123)) escalate-and-poll.
   */
  sized_at: string;
  /** What producing the estimate cost in model tokens. `0` for a rule engine. */
  tokens_used: number;
  /** What the answer was reached from, one line each. Empty rather than absent. */
  signals: string[];
}

/**
 * `ouroboros.issue_estimates` — versioned, latest-wins estimates for a mirrored issue (V026,
 * [#100](https://github.com/NobuData/ouroboros/issues/100)), written by L.3
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)).
 *
 * Everything mockup 03 calls *AI Work Breakdown*. **Decision K4: an estimate is a row, and
 * re-estimation is the next one** — there is no update path and no `updated_at`, because the
 * trace is only worth reading beside the answer it replaced.
 *
 * **`version` is computed by the writer and checked by the database.** V026 refuses a version
 * that is not above every version the issue already has, and
 * `issue_estimates_issue_version_key` refuses two writers who computed the same one. So
 * `estimation.repository.ts` asks for `max(version) + 1`, and a second writer that got there
 * first is a unique violation it retries rather than a corruption anybody has to detect.
 * That is the acceptance criterion *"concurrent estimation of the same issue produces
 * sequential versions"*, and it is the database's guarantee rather than this service's.
 *
 * **Was deliberately absent from this file until L.3**, for the reason {@link GithubIssuesTable}
 * gives: V026 landed the table with no writer, and a mirrored table nothing reads or writes is
 * drift waiting to happen.
 */
export interface IssueEstimatesTable {
  id: Generated<string>;
  /** The issue this sizes — the row's only parent and the whole of its tenancy. Cascades. */
  github_issue_id: string;
  /**
   * Which estimate of this issue this is; 1 for the first.
   *
   * Monotonic within the issue by trigger and unique with it by key. Gaps are legal —
   * monotonic is not dense — and the only question asked of these numbers is which is largest.
   */
  version: number;
  /** The *Effort* column's chip. */
  effort: EstimateEffort;
  /**
   * How much the estimator trusts its own answer, 0-100.
   *
   * Read against a floor by `estimation/estimation.outcome.ts`: below it the issue goes to
   * `needs_human` rather than `sized`. The floor is *this* service's policy — the engine
   * publishes the value its tables were calibrated against and deliberately has no
   * `needs_human` field.
   */
  confidence: number;
  /** Which workflow should run it — opaque (decision **K5**), one of the tags the request offered. */
  suggested_workflow: string;
  /** Which model it should run on — opaque (decision **K6**), resolved and never invoked. */
  routed_model: string;
  /**
   * The *AI Work Breakdown* panel's numbers.
   *
   * `ColumnType` for {@link GithubIssuesTable.labels}' reason: `pg` hands a `jsonb` column back
   * parsed, and Kysely wants the value *written* to be the string a driver will send — so
   * every write goes through `JSON.stringify`.
   */
  breakdown: ColumnType<EstimateBreakdownDocument, string, string>;
  /** The regression-risk meter. */
  risk: EstimateRisk;
  /** The sentence under the meter, saying why. Non-blank by constraint. */
  risk_note: string;
  /** Where the estimate came from. `ColumnType` for {@link breakdown}'s reason. */
  trace: ColumnType<EstimateTraceDocument, string, string>;
  /**
   * When the row was written.
   *
   * `Generated` rather than {@link Stamped}: the table is append-only, so there is no
   * `touch_updated_at` trigger to protect a written value from, and V026 defaults it to
   * `now()`. Distinct from `trace.sized_at` — see {@link EstimateTraceDocument.sized_at}.
   */
  created_at: Generated<Date>;
}

/**
 * `runs.status` — where one run of the loop is in its life (V008,
 * [#64](https://github.com/NobuData/ouroboros/issues/64)).
 *
 * The `runs_status` CHECK, mirrored the way this file's header says a CHECK becomes a type.
 * The six words split in two, and the split is decision **F2**: a run is *active* while it
 * has no `finished_at` and *terminal* once it has one, the two halves are mockup 02's two
 * tables, and there is no second table for completions. `runs_terminal_finished_at` is what
 * makes the split a property of the row rather than a convention — a terminal status and a
 * null `finished_at` cannot both be true.
 */
export type RunStatus = "coding" | "building" | "review" | "merged" | "needs_human" | "failed";

/**
 * The three statuses a run still in flight may hold, in lifecycle order.
 *
 * Ordered rather than alphabetical, and the order is load-bearing: `dashboard/` reads down
 * it to sort the *Active loops* card, so the card reads the way the pipeline runs. Widening
 * the lifecycle is one migration, this list, and {@link RunStatus}.
 */
export const ACTIVE_RUN_STATUSES = [
  "coding",
  "building",
  "review",
] as const satisfies readonly RunStatus[];

/** The three a run rests at, in the order the CHECK declares them. */
export const TERMINAL_RUN_STATUSES = [
  "merged",
  "needs_human",
  "failed",
] as const satisfies readonly RunStatus[];

/** A status a run in flight may hold — the narrowing {@link ACTIVE_RUN_STATUSES} carries. */
export type ActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number];

/**
 * `ouroboros.runs` — one run of the loop against one issue (V008,
 * [#64](https://github.com/NobuData/ouroboros/issues/64)).
 *
 * The read-model behind three of mockup 02's six surfaces, and nothing writes it yet: the
 * loop engine is deliberately v2 (#54), so the rows come from the development seed
 * ([#68](https://github.com/NobuData/ouroboros/issues/68)) and are read by `dashboard/`.
 *
 * `model` and `workflow_tag` are **opaque** (decision F8) — bounded, non-blank, and
 * otherwise unconstrained text. The model registry is mockup 06/21's and workflow entities
 * are mockup 04's; a union here would be this file inventing a catalogue it does not own,
 * and would reject a run the engine legitimately performed.
 */
export interface RunsTable {
  id: Generated<string>;
  /** Owning workspace. Every dashboard query is scoped by it, and it leads both indexes. */
  organization_id: string;
  /**
   * Repository the issue lives in.
   *
   * Held to the same workspace as `organization_id` by the `runs_repo_in_organization`
   * trigger — the composite foreign key `github_repos` cannot offer, because it reaches the
   * workspace through `github_orgs`.
   */
  github_repo_id: string;
  issue_number: number;
  /** The title as it was when the run started — stored, not fetched: a card renders it on every poll. */
  issue_title: string;
  /** Workflow label, plain text and no foreign key. Opaque, per decision F8. */
  workflow_tag: string;
  /** Model identifier as recorded, opaque: `claude-fable-5`, `ollama/qwen3-coder`, … */
  model: string;
  status: RunStatus;
  /** The workflow's word for the current step, captioning the `stage_index`/`stage_total` meter. */
  stage_label: string;
  stage_index: number;
  stage_total: number;
  /**
   * When the loop started on this issue — what *Elapsed* counts from.
   *
   * `Generated`, not {@link Stamped}: it has a `default now()` so an insert may omit it, and
   * no trigger owns it, so a correction may write it. `created_at` is the different fact of
   * when the row appeared.
   */
  started_at: Generated<Date>;
  /** When the run reached a terminal status; null exactly while it has not. */
  finished_at: Date | null;
  pr_number: number | null;
  /** Checks that passed, paired with {@link RunsTable.checks_total}: both set or both null. */
  checks_passed: number | null;
  /** Total checks on the pull request. `0/0` is a repository with no checks, which is not "not known yet". */
  checks_total: number | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `queue_items.effort` — the five size chips mockup 02 renders (V009, decision F9).
 *
 * Stored lower-case, which is the class name the UI stamps, and held to these five by
 * `queue_items_effort`.
 */
export type QueueEffort = "xs" | "s" | "m" | "l" | "xl";

/** The same five, smallest first — what a DTO would validate against and a test iterates. */
export const QUEUE_EFFORTS = ["xs", "s", "m", "l", "xl"] as const satisfies readonly QueueEffort[];

/**
 * `ouroboros.queue_items` — the ordered, estimable per-workspace issue queue (V009,
 * [#65](https://github.com/NobuData/ouroboros/issues/65)).
 *
 * The read-model behind mockup 02's *Up next in queue* card and its *Queued issues* stat.
 * Ordering is total and enforced; density is the writer's convention. The writes — reorder,
 * remove — are the issues screen's ([#73](https://github.com/NobuData/ouroboros/issues/73)).
 */
export interface QueueItemsTable {
  id: Generated<string>;
  /** Owning workspace. Leads both unique keys. */
  organization_id: string;
  /** Repository the issue lives in, held to this workspace by `queue_items_repo_in_organization`. */
  github_repo_id: string;
  issue_number: number;
  issue_title: string;
  effort: QueueEffort;
  workflow_tag: string;
  /**
   * Place in the queue; `1` is next.
   *
   * Unique within the workspace and **deferrable**, so a reorder swaps two positions inside
   * one transaction without ceremony. Density is a convention, not a constraint.
   */
  position: number;
  /**
   * Expected minutes of autonomous work, or null for **not estimated** — which is not zero.
   *
   * The *Queued issues* stat is `sum(est_minutes)`, and `sum` skips the nulls without being
   * asked. A card rendering this must not read an absent estimate as no work.
   */
  est_minutes: number | null;
  /** When the issue joined the queue — not `created_at`, which is when the row appeared. */
  enqueued_at: Generated<Date>;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.token_usage` — the append-only token spend ledger (V010,
 * [#66](https://github.com/NobuData/ouroboros/issues/66)).
 *
 * One row per call, not one row per workspace: decision **F10** — totals are aggregates over
 * events, because a stored total drifts the moment anything is corrected. Read through
 * {@link TokenUsageDailyView} rather than directly; this interface is here so the mirror
 * describes the table the view is over.
 */
export interface TokenUsageTable {
  id: Generated<string>;
  /** Who is billed. Leads the b-tree index. */
  organization_id: string;
  /** The run that incurred the spend, or null for usage no run caused — planning, triage, chat. */
  run_id: string | null;
  /** Who was paid, folded lower-case so `count(distinct provider)` counts providers rather than spellings. */
  provider: string;
  /** Model identifier as recorded, opaque and unfolded — the same shape as `runs.model`. */
  model: string;
  tokens_in: number;
  /** Output tokens. Kept apart from `tokens_in` because every provider prices the two differently. */
  tokens_out: number;
  /**
   * Cost in cents, or null for **unpriced** — never `0`, which would claim the call was free.
   *
   * `numeric(14, 4)`, and therefore a **string**: `pg` hands numerics back as text rather than
   * lose the precision the column exists to keep. Anything doing arithmetic on it either does
   * the arithmetic in SQL or converts deliberately, which is the trade the type states.
   */
  cost_cents: string | null;
  /** When the spend happened — what the day is computed from. Not `created_at`, which is when the row appeared. */
  occurred_at: Generated<Date>;
  /**
   * Which routed kind of work this call served — `task_kinds.name` as the router placed it
   * (V020, [#192](https://github.com/NobuData/ouroboros/issues/192), decision M7).
   *
   * Plain text and deliberately **no foreign key**, on V008's decision F8 precedent: a ledger
   * row records what happened, and retiring or renaming a task kind must not block, delete or
   * rewrite the history routed under it.
   *
   * Null is **not routed work** — provider-level spend, an import, a completion the router did
   * not place — and is what makes mockup 06's per-kind `$/run avg` an honest em-dash rather
   * than `$0.00`.
   */
  task_kind: string | null;
  /**
   * How long this call took, in whole milliseconds — the only source mockup 06's `p50 latency`
   * column has (V020, decision M7).
   *
   * Null means nobody timed it, and a median over no latencies is null, which renders the
   * em-dash. Never defaulted to `0`: zero is a call that returned inside a millisecond, which
   * a local daemon on loopback really does, and it must stay tellable apart from *unmeasured*.
   */
  latency_ms: number | null;
  created_at: Stamped;
}

/**
 * `ouroboros.workspace_settings` — org-scoped typed product settings (V011,
 * [#67](https://github.com/NobuData/ouroboros/issues/67)).
 *
 * One row per workspace, holding **choices only**: a workspace with no row is at every
 * default. Read through {@link WorkspaceSettingsEffectiveView}, which resolves that, and
 * write here with an upsert on the primary key — the same shape `user_preferences` has, at
 * the workspace's scale rather than the person's.
 */
export interface WorkspaceSettingsTable {
  /** The workspace, and the key. Also what the settings upsert conflicts on. */
  organization_id: string;
  /** Mockup 02's *Auto-merge when checks pass* switch (decision F6) — the dashboard's only write. */
  auto_merge_on_checks: Generated<boolean>;
  /** Who last changed a setting here, or null. `on delete set null`, never cascade. */
  updated_by: string | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.tenant_keys.status` — whether new writes are sealed with this key version
 * (V013).
 *
 * `retired` is not *revoked*: a retired version is still read, because the ciphertext it
 * sealed stays readable until the re-encrypt sweep has worked through it. What retirement
 * means is only that nothing new will be sealed with it.
 */
export type TenantKeyStatus = "active" | "retired";

/**
 * `ouroboros.tenant_keys` — the sealed per-workspace data-encryption keys (V013,
 * [#222](https://github.com/NobuData/ouroboros/issues/222)).
 *
 * One row per workspace per key version. Rotation is additive, so an old version coexists
 * with the active one and keeps its ciphertext readable; at most one row per workspace is
 * `active`, enforced by `tenant_keys_one_active_idx` rather than by the service.
 *
 * **Nothing in this interface is key material.** `sealed_dek` is ciphertext under the KEK,
 * which never enters the database — see `src/modules/vault/`.
 *
 * `created_at` is a plain {@link Stamped}, but note that `version` is **not** `Generated`:
 * the service computes it as the previous active version plus one inside the rotation
 * transaction, because "the next version" is a question about the rows and not a sequence
 * — a sequence would leave gaps on a rotation that lost a race, and the numbers are stored
 * inside every ciphertext this schema's data columns hold.
 */
export interface TenantKeysTable {
  /** The workspace — `organization."id"`, as text. `on delete cascade`, which is the shred. */
  organization_id: string;
  /** Which generation of this workspace's key, from 1. The second half of the primary key. */
  version: number;
  /** The DEK after AES-256-GCM under the KEK. Never the key itself. */
  sealed_dek: Buffer;
  /** Which `KeyWrapper` sealed it — `env-master` today, a KMS or Vault id after AF.3. */
  wrapper: string;
  /** Whether new writes use this version. At most one `active` row per workspace. */
  status: Generated<TenantKeyStatus>;
  /** When this version stopped being the active one; null exactly while it is active. */
  rotated_at: Date | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.model_prices.billing_mode` — how the money works for one priced model (V012).
 *
 * Four words, and the whole reason the table is not two nullable amounts. Each of them is a
 * different *shape* of answer rather than a different value of one answer, which is why
 * mockup 21's `$ per 1M in·out` column renders four things and why `pricing/render.ts` is a
 * `switch` over this union rather than a format string with a fallback:
 *
 * | Mode | What it claims | The cell |
 * |---|---|---|
 * | `token` | per-token rates, both present | `$10 · $50` |
 * | `seat` | billed per person, not per call | `seat-based` |
 * | `usage` | metered on terms this catalog cannot express | `usage-based` |
 * | `free` | no per-call charge — a model running locally | `$0` |
 *
 * The fifth shape, `—`, is deliberately **not** a member: *we have no price for this* is the
 * absence of a row, not a mode a row can carry. See {@link ModelPricesTable}.
 */
export type BillingMode = "token" | "seat" | "usage" | "free";

/**
 * `ouroboros.model_prices.source` — who made this claim about money (V012).
 *
 * `bundled` is the vendored snapshot's statement and applies to every workspace; `override`
 * is one workspace's own, and it wins. The column is stamped rather than inferred from
 * `organization_id` being null — V012's own reasoning — and it is what a price's provenance
 * is reported from, which the registry's hover surfaces (#592).
 */
export type PriceSource = "bundled" | "override";

/**
 * `ouroboros.model_prices` — the model pricing catalog (V012,
 * [#580](https://github.com/NobuData/ouroboros/issues/580)).
 *
 * The truth source behind mockup 21's `$ per 1M in·out` column, and the shared price table
 * DASH-J.4 (#92), Z.5 (#198) and AB.4 (#210) read rather than re-invent. Two populations in
 * one table, told apart by {@link ModelPricesTable.source}: the bundled snapshot
 * (`organization_id` null, swept and replaced wholesale by each import) and a workspace's
 * own overrides, which survive every import and beat the snapshot on lookup.
 *
 * **Absence is the fifth shape.** No row means *we do not know what this costs*, which
 * renders `—`; a `free` row means *this costs nothing*, which renders `$0`. Nothing in this
 * mirror defaults an amount to zero, for the reason V012 refuses to: on a page a user sizes
 * a budget from, turning "unknown" into "free" is the one lie the schema is built to
 * prevent.
 *
 * **Read it through `ouroboros.model_price()`**, never by re-deriving the precedence here.
 * The function is `language sql stable` so PostgreSQL inlines it, which is what makes a
 * lookup one indexed scan; `pricing/pricing.repository.ts` is the only thing in this service
 * that calls it.
 */
export interface ModelPricesTable {
  id: Generated<string>;
  /**
   * Whose statement this is: null for the bundled catalog, set for a workspace's override.
   *
   * `on delete cascade` — an override for a deleted workspace is unreachable, and leaving it
   * would let a later workspace that reused the id inherit somebody else's negotiated rate.
   */
  organization_id: string | null;
  /** The provider kind this row prices, or `'*'` for every kind. Folded lower-case. */
  match_provider_kind: string;
  /** The model identifier this row prices, or `'*'` for every model of the kind. Unfolded. */
  match_model: string;
  /** Which of the four cells this row renders, and which amounts it may carry at all. */
  billing_mode: BillingMode;
  /**
   * Input rate in cents per **one million** tokens, or null.
   *
   * `numeric(14, 4)`, and therefore a **string** — the same trade, and the same reason, as
   * {@link TokenUsageTable.cost_cents}: `pg` hands numerics back as text rather than lose the
   * precision the column exists to keep, and whole cents per 1M would round the cheapest
   * models to a `0` that reads as the `$0` this whole surface refuses to fake.
   *
   * Required exactly when `billing_mode` is `token`; zero or null when `free`; never present
   * on `seat` or `usage`. Four CHECKs in V012 make that structural rather than conventional.
   */
  input_cents_per_1m: string | null;
  /** Output rate, same rules and same type. Kept apart because every vendor prices the two differently. */
  output_cents_per_1m: string | null;
  /** `bundled` or `override` — the first half of a price's provenance. */
  source: PriceSource;
  /**
   * Which snapshot a bundled row came from — `2026-08-15+litellm.70d51a1`. The second half of
   * a price's provenance, and null on an override, which is not a version of anything.
   */
  catalog_version: string | null;
  /**
   * What the catalog knows besides the price — context window, maximum output, capability
   * flags, the upstream entry the row was transformed from.
   *
   * `Generated` rather than writeable: it has a `default '{}'::jsonb`, and **nothing in this
   * service writes it**. An override this service creates carries the default, because a
   * workspace correcting a rate is not thereby claiming a context window. CH.2
   * ([#585](https://github.com/NobuData/ouroboros/issues/585)) is what gives this object a
   * shape; until then it is read as what it is, an upstream vendor's vocabulary.
   */
  meta: Generated<Record<string, unknown>>;
  /**
   * When these prices took effect as far as the source knows — the snapshot's upstream commit
   * date for a bundled row, and when a workspace says its own rate started for an override.
   *
   * **Not a history axis.** One row per (workspace, kind, model), so the table holds what is
   * true now; re-pricing a ledger against last quarter's rates is #598's question.
   */
  effective_at: Generated<Date>;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.provider_connections.kind` — which adapter reaches one provider (V015,
 * [#189](https://github.com/NobuData/ouroboros/issues/189)).
 *
 * The same six spellings AC.1's adapter registry keys on, and the same ones
 * {@link ModelPricesTable.match_provider_kind} carries, so a connection and a price agree
 * about what kind of thing they are describing without either translating.
 *
 * Two of them — `ollama` and `openai_compatible` — are the pair `src/modules/internal/`
 * calls leasable (AD.3, [#224](https://github.com/NobuData/ouroboros/issues/224)): both are
 * reachable without a credential, which is the property that makes an address worth handing
 * to a worker. That is why V015 requires a `base_url` for exactly those two and not for the
 * rest: they have no public endpoint to fall back on.
 */
export type ProviderConnectionKind =
  "anthropic" | "openai_compatible" | "ollama" | "copilot" | "cursor" | "custom";

/** The six kinds as values, in the order V015's CHECK declares them. */
export const PROVIDER_CONNECTION_KINDS = [
  "anthropic",
  "openai_compatible",
  "ollama",
  "copilot",
  "cursor",
  "custom",
] as const satisfies readonly ProviderConnectionKind[];

/**
 * `ouroboros.provider_connections.status` — whether a connection is usable, as far as
 * anything knows (V015).
 *
 * **`unknown` is a state, not a placeholder** — roadmap decision **M8**. A connection
 * nothing has checked is `unknown`, and mockup 06's `.phealth` strip renders it as such,
 * because the alternative is a green dot the product has no evidence for. It is also the
 * column's default, so the honest answer is what a row starts with rather than something a
 * writer has to remember.
 *
 * `paused` is the odd one out and is worth knowing about: it is an *operator's intent*
 * rather than a conclusion from a check, which is why V015 deliberately does not tie
 * `status` to `last_checked_at`. Z.3 ([#196](https://github.com/NobuData/ouroboros/issues/196))
 * owns the transitions between the other three.
 */
export type ProviderConnectionStatus = "active" | "paused" | "error" | "unknown";

/** The four statuses as values, in the order V015's CHECK declares them. */
export const PROVIDER_CONNECTION_STATUSES = [
  "active",
  "paused",
  "error",
  "unknown",
] as const satisfies readonly ProviderConnectionStatus[];

/**
 * `ouroboros.provider_connections` — where a workspace's model providers are (V015,
 * [#189](https://github.com/NobuData/ouroboros/issues/189)).
 *
 * The shared foundation mockup 07 (*Providers & keys*) builds its management UI on — roadmap
 * decision **M2**. This service reads it to resolve an alias and to answer *what providers
 * does this workspace have*, and writes it from exactly one module:
 * `src/modules/provider-connections/`, the credential lifecycle AD.2
 * ([#223](https://github.com/NobuData/ouroboros/issues/223)) owns. `registry/` still declares
 * no create, update or delete surface of its own, which is what M2 asked for.
 *
 * **{@link ProviderConnectionsTable.credentials_encrypted} is the one column in this mirror
 * that must never reach a response.** `src/modules/registry/` selects it in exactly one
 * file — the vault's re-encryption store — and `registry.repository.spec.ts` reads this
 * module's own source to keep that true. The `ouroboros/no-secret-in-internal-response`
 * lint rule is the second half, and V015's own CHECK is the third: the column cannot hold a
 * plaintext at all, so what leaks in the worst case is ciphertext.
 */
export interface ProviderConnectionsTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`. */
  organization_id: string;
  /** Which adapter reaches this provider. */
  kind: ProviderConnectionKind;
  /** What the `.phealth` strip prints. Free text, and deliberately not unique. */
  display_name: string;
  /**
   * Where this provider is — `http`/`https`, and RFC-1918 is deliberately allowed.
   *
   * Required by V015 for `ollama` and `openai_compatible`, which have no public endpoint,
   * and optional elsewhere, where a proxy or a regional endpoint is a legitimate reason to
   * set one. The type cannot express the implication; the CHECK does.
   */
  base_url: string | null;
  /**
   * The provider credential, sealed — an `ouro.v1.…` envelope from `src/modules/vault/`.
   *
   * **Never selected outside the re-encryption store.** See this interface's header, and
   * note that V015 refuses any value that is not an envelope, so this column cannot hold a
   * key in the clear whatever writes it. Null where the provider needs none, which is the
   * ordinary state of a local one rather than an unfinished row.
   */
  credentials_encrypted: string | null;
  /** Whether the connection is usable. `Generated` — V015 defaults it to `unknown`. */
  status: Generated<ProviderConnectionStatus>;
  /** When the last health check finished; null until one has. */
  last_checked_at: Date | null;
  /**
   * What that check measured — `{ latency_ms: 42 }`, `{ detail: "elevated latency" }`.
   *
   * **Empty means nothing was measured**, and V015 keeps that honest rather than
   * conventional: content requires a `last_checked_at`, and a `latency_ms` must be a
   * non-negative number. Nothing here defaults a latency to zero, for the reason the
   * pricing mirror refuses to default an amount — on a strip a person reads reliability
   * from, `0ms` is not "unknown", it is a very good latency.
   *
   * `Generated` because the column has a `default '{}'::jsonb`; unlike
   * {@link ModelPricesTable.meta} it *is* written from this service, by Z.3 (#196).
   */
  health: Generated<Record<string, unknown>>;
  /**
   * The card's monthly cap in whole cents — `$600` is `60000` (V017,
   * [#221](https://github.com/NobuData/ouroboros/issues/221)).
   *
   * **Null is a value**: it is *no cap*, which mockup 07 renders as an em-dash for both
   * local providers, and it is not the same as a cap of zero — which is a real instruction
   * meaning *spend nothing*. Cents rather than a decimal for the reason V016's
   * `routes.max_cost_cents_per_run` is: money in a float is a rounding error waiting to be
   * argued about.
   *
   * Warning-only until AF.4 ([#237](https://github.com/NobuData/ouroboros/issues/237)) —
   * decision **P7**. Nothing in this service enforces it today; the meter beside it is
   * calendar-month spend summed out of {@link TokenUsageTable} per connection kind.
   */
  monthly_cap_cents: number | null;
  /**
   * Who connected this provider — the card's *"Added by Ken"* (V017).
   *
   * `"user"."id"`, and **`on delete set null`** rather than a cascade: deleting the person
   * who added a provider must not delete the workspace's provider. Null is therefore both
   * *nobody in this table added it* — an import, a service account — and *the person who
   * did has since gone*, and the card renders the connection without a name in front of it
   * rather than not at all.
   */
  added_by: string | null;
  /**
   * When something last invoked through this connection — the card's *last used 3m ago*.
   *
   * Maintained by AF.2 ([#235](https://github.com/NobuData/ouroboros/issues/235)), the
   * invocation gateway, which is the only thing that knows a call happened. Null until
   * then, and rendered as *never used* rather than as an unfilled column.
   */
  last_used_at: Date | null;
  /**
   * The card's capability line, verbatim — *api.anthropic.com · primary coding lane*.
   *
   * Stored rather than composed, and V017's header argues why: the mockup's five lines are
   * not derivable from any other column, so a derived line would be a rule with five
   * exceptions. Nullable, and a card with no note simply draws one line instead of two.
   */
  capability_note: string | null;
  /**
   * The card's switch — may this connection be used at all (V017).
   *
   * **Not {@link ProviderConnectionsTable.status}.** The status is what the last health
   * check measured (Z.3, decision **M8**); this is what a person decided, and a card draws
   * both — *connected* beside a switch that is off is a real state. A disabled connection
   * drops out of routing and out of the health strip while its aliases and routes survive,
   * which is the difference between switched off and deleted.
   *
   * `Generated` because V017 defaults it to `true`: a provider somebody has just added is
   * one they intend to use.
   */
  enabled: Generated<boolean>;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.provider_models` — the models a connection has, as discovery reported them
 * (V017, [#221](https://github.com/NobuData/ouroboros/issues/221), decision **P6**).
 *
 * Written by `ModelProviderAdapter.discoverModels()` as an upsert on
 * `(provider_connection_id, model_id)`, so re-running discovery refreshes rather than
 * duplicates. Read here by `src/modules/registry/` — CH.2
 * ([#585](https://github.com/NobuData/ouroboros/issues/585)) merges
 * {@link ProviderModelsTable.meta} into the param schema an alias's inspector renders, which
 * is what lets a context clamp be bounded by the context the provider actually published.
 *
 * **It carries no `organization_id`, and that is not an omission.** A discovered model is a
 * fact about a connection, and a connection belongs to exactly one workspace — so the tenancy
 * is the foreign key, and every read in this service enters through a join onto
 * `provider_connections` that carries the workspace predicate. V017 argues the same from the
 * other side.
 */
export interface ProviderModelsTable {
  id: Generated<string>;
  /**
   * The connection this model was discovered on, and this row's only tenancy.
   *
   * `on delete cascade` — a catalog outliving the connection it describes would be a list of
   * models nothing can reach.
   */
  provider_connection_id: string;
  /**
   * The provider's own identifier, unfolded — `claude-fable-5`, `qwen3-coder:32b`.
   *
   * The same spelling {@link ModelAliasesTable.model_id} carries, which is what makes *is this
   * alias's model one the provider still lists* a join rather than a normalisation exercise.
   * Not a second home for decision **M1**'s raw model id: M1 governs what may name a model in
   * a route, and a route still reaches one only through an alias.
   */
  model_id: string;
  /** What a chip prints — `local/llama-4-maverick` beside a `model_id` of `llama-4-maverick`. */
  display: string;
  /**
   * On-disk size in bytes for a locally-hosted model, null for a cloud one.
   *
   * A `bigint`, and therefore a **string** — `pg` will not narrow one to a `number`, and it is
   * right not to: a 63 GB model is 6.3e10. Null rather than zero, for
   * {@link ModelPricesTable}'s reason: a zero would be a tag claiming a model that takes no
   * space.
   */
  size_bytes: string | null;
  /**
   * What else discovery reported — `{"context_tokens": 200000}`, `{"tier": "priority"}`.
   *
   * `context_tokens` is the key {@link ModelPricesTable.meta} already uses, so CH.2 merging a
   * discovered model with a catalog entry is not made to translate — which is the whole reason
   * V017 chose the spelling. `Generated` for its `default '{}'::jsonb`; discovery
   * (`provider-connections/provider-models.repository.ts`, AE.4
   * [#230](https://github.com/NobuData/ouroboros/issues/230)) writes it from the adapter's
   * `NormalizedModel`.
   */
  meta: Generated<Record<string, unknown>>;
  /**
   * When discovery last reported this model; moved by every upsert.
   *
   * This table has no `updated_at` because that is what this column is — a cache of what a
   * provider said, stamped with when it said it. It is what mockup 21's *listed live from the
   * provider* is true of, and what tells a stale catalog from a fresh one.
   *
   * Not {@link Stamped}: that alias forbids an update, and V017's upsert sets this column from
   * `excluded.discovered_at` on every conflict — moving it is the whole of what the column is.
   */
  discovered_at: ColumnType<Date, Date | undefined, Date>;
}

/**
 * `ouroboros.model_aliases` — the names a workspace's routes may use (V015,
 * [#189](https://github.com/NobuData/ouroboros/issues/189)), extended into mockup 21's
 * management surface by V019 ([#579](https://github.com/NobuData/ouroboros/issues/579),
 * decision **R1** — extended, never forked).
 *
 * The shared foundation mockup 21 (*Model registry*) will build its management UI on —
 * decision **M2** again, and the same division: this service resolves aliases and lists
 * them, and creates none. The write surface over the four columns V019 added is CH.1's
 * ([#584](https://github.com/NobuData/ouroboros/issues/584)).
 *
 * **{@link ModelAliasesTable.model_id} is the only place in this schema a raw provider
 * model string lives** — roadmap decision **M1**. Y.2's routes and hops, Y.3's escalation
 * rules and the DSL's `route.task(...)` all name an alias, which is what makes swapping
 * `coder-max` from one model to another one edit of one row.
 */
export interface ModelAliasesTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`. */
  organization_id: string;
  /**
   * The name routes use — `coder-max`, `sizer`, `local-docs`. Unique per workspace.
   *
   * Lower-case kebab by CHECK, which V015 argues is a correctness rule rather than a style
   * one: uniqueness is enforced on the stored text, so admitting `Coder-Max` beside
   * `coder-max` would give one name two resolutions.
   */
  alias: string;
  /**
   * The connection this alias resolves on, or `null` for the **unbound** state.
   *
   * Held to the *same workspace* as `organization_id` by a composite foreign key rather
   * than by a trigger — V015 creates both tables, so it can declare the unique key that
   * makes the rule referential. An alias reaching another workspace's connection would
   * resolve onto that workspace's credential.
   *
   * **Nullable since V019** ([#579](https://github.com/NobuData/ouroboros/issues/579),
   * decision **R2**): mockup 21's `gpt5-experiments` is a name created ahead of its key,
   * with a {@link ModelAliasesTable.model_id} and no provider to reach it on. The composite
   * key is `MATCH SIMPLE`, so a row with a null binding is not checked against it rather
   * than being a dangling reference — and such a row depends on no connection, so it blocks
   * no provider deletion.
   *
   * Every statement in `registry.repository.ts` reads this through an `innerJoin` or an
   * equality, both of which drop a null: an unbound alias resolves to nothing, which is
   * what it is.
   */
  provider_connection_id: string | null;
  /** The raw provider model string, and the only one in this schema (decision M1). Unfolded. */
  model_id: string;
  /**
   * Mockup 21's `On` switch — may routing use this alias right now (V019,
   * [#579](https://github.com/NobuData/ouroboros/issues/579)).
   *
   * **Not provider health** ({@link ProviderConnectionsTable.status}, decision **M8**) and
   * **not the provider's own switch** ({@link ProviderConnectionsTable.enabled}): those are
   * about a connection, this is about one name on it. Switching an alias off leaves every
   * route and workflow reference intact; deleting it does not, which is why the switch
   * exists.
   *
   * `Generated` because V019 defaults it to `true`. An **unbound** alias must therefore say
   * `enabled: false` explicitly — `model_aliases_unbound_disabled` refuses the row
   * otherwise, because enabling one would let resolution select a binding that resolves to
   * nothing.
   */
  enabled: Generated<boolean>;
  /**
   * Per-alias invocation defaults — the inspector's *"(max thinking)"*, a pinned
   * temperature.
   *
   * `Generated` for its `default '{}'::jsonb`. Opaque here even though V019 closed the
   * vocabulary at the database — `thinking` (`off`/`std`/`max`), `token_budget`,
   * `max_output`, `context_clamp` and `temperature`, and nothing else — because giving it a
   * shape here is CH.2's ([#585](https://github.com/NobuData/ouroboros/issues/585)), where
   * the adapter's own param schema decides which of those keys the bound model can honour.
   */
  params: Generated<Record<string, unknown>>;
  /**
   * What this workspace allows this alias to be used for — `review_vote_only` and
   * `batch_ok`, mockup 21's *review vote only* and *batch ok* chips (V019,
   * [#579](https://github.com/NobuData/ouroboros/issues/579)).
   *
   * Registry **policy** rather than provider capability, which is why it is not
   * {@link ModelAliasesTable.params}: a param is merged into a request body and a
   * restriction never leaves this product. `Generated` for its `default '{}'::jsonb`.
   */
  restrictions: Generated<Record<string, unknown>>;
  /**
   * An operator's prose about why this alias exists — *"dev key, do not point routes at
   * this"*. Null is the ordinary state; a blank string is refused by the schema.
   */
  notes: string | null;
  /**
   * Who last wrote this row — half of the revision record CH.1
   * ([#584](https://github.com/NobuData/ouroboros/issues/584)) emits; the other half is
   * {@link ModelAliasesTable.updated_at}, which V015's touch trigger moves.
   *
   * References `"user"."id"` and **sets null** rather than cascading, exactly as
   * {@link ProviderConnectionsTable.added_by} does: deleting the person who last edited an
   * alias must not delete the alias.
   */
  updated_by: string | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.model_aliases.params`' closed vocabulary — the five keys V019 will store, and
 * nothing else ([#579](https://github.com/NobuData/ouroboros/issues/579), decision **R3**).
 *
 * `ouroboros.model_alias_params_valid()` is the authority and `model_aliases_params_known` is
 * what applies it; these constants are the mirror, and they exist for the reason
 * {@link PROVIDER_CONNECTION_KINDS} does — a vocabulary a service has to agree with is one it
 * should be unable to misspell.
 *
 * **They are read by two very different callers, which is why they live here rather than in
 * either.** CH.2 ([#585](https://github.com/NobuData/ouroboros/issues/585)) is both: a provider
 * adapter's `paramSchema()` may offer only these keys — an adapter offering a sixth would be
 * rendering a field whose valid-looking value the database refuses — and the registry's chip
 * derivation reads the stored document by them. A copy in `providers/` and a copy in
 * `registry/` would be two vocabularies that agree until somebody edits one.
 *
 * A key here is **shape**, never meaning: that `thinking` is a word this column accepts is
 * V019's rule, and whether the *bound model* can honour it is CH.2's, decided from the
 * adapter's own schema. See `registry/params.merge.ts`.
 */
export type ModelAliasParamKey =
  "thinking" | "token_budget" | "max_output" | "context_clamp" | "temperature";

/**
 * The five keys as values, in the order `ouroboros.model_alias_params_valid()` declares them.
 *
 * The order is also the order mockup 21's inspector draws the fields in and the order its param
 * chips are derived in, so a table cell and a form read top to bottom the same way.
 */
export const MODEL_ALIAS_PARAM_KEYS = [
  "thinking",
  "token_budget",
  "max_output",
  "context_clamp",
  "temperature",
] as const satisfies readonly ModelAliasParamKey[];

/**
 * `params.thinking` — how much reasoning effort an alias asks for (V019).
 *
 * Three words rather than a boolean, because mockup 21 draws three chips: *max thinking*, *std
 * thinking*, and a model told explicitly not to think. `off` is a real instruction and not the
 * absence of the key — an alias that says nothing about thinking leaves it to the provider's
 * own default, which is a different request from one that turns it off.
 */
export type ThinkingLevel = "off" | "std" | "max";

/** The three levels as values, in the order V019's function declares them. */
export const THINKING_LEVELS = ["off", "std", "max"] as const satisfies readonly ThinkingLevel[];

/**
 * The smallest token count `token_budget`, `max_output` and `context_clamp` may carry.
 *
 * One rather than zero, and V019 means it: a budget of zero is not a small budget, it is an
 * instruction to produce nothing, and the honest way to say *no budget* is to leave the key out.
 */
export const MODEL_ALIAS_TOKENS_MIN = 1;

/**
 * The largest token count those three may carry — ten million.
 *
 * A sanity bound rather than a model's context window: what any particular model will accept is
 * smaller and is CH.2's to say, from the adapter's schema and `provider_models.meta`. This is
 * only the width past which a number is a typo.
 */
export const MODEL_ALIAS_TOKENS_MAX = 10_000_000;

/** The lowest `temperature` V019 accepts. */
export const MODEL_ALIAS_TEMPERATURE_MIN = 0;

/**
 * The highest `temperature` V019 accepts.
 *
 * Two, which is the widest range any provider this product reaches publishes. A model whose own
 * ceiling is one — Anthropic's is — narrows it in its adapter's `paramSchema()`, and the
 * narrower of the two is what a write is checked against.
 */
export const MODEL_ALIAS_TEMPERATURE_MAX = 2;

/**
 * `ouroboros.model_aliases.restrictions`' two flags (V019, decision **R3**).
 *
 * Registry **policy**, not provider capability — which is why they are not
 * {@link ModelAliasParamKey}s: a param is merged into a request body and a restriction never
 * leaves this product. CH.2 appends them to every param schema it serves, bound or unbound,
 * because they are true of the alias regardless of what is on the other end of it.
 */
export type ModelAliasRestrictionKey = "review_vote_only" | "batch_ok";

/** The two flags as values, in the order `ouroboros.model_alias_restrictions_valid()` declares them. */
export const MODEL_ALIAS_RESTRICTION_KEYS = [
  "review_vote_only",
  "batch_ok",
] as const satisfies readonly ModelAliasRestrictionKey[];

/**
 * `ouroboros.task_kinds` — the eight rows of mockup 06's routing matrix (V016,
 * [#190](https://github.com/NobuData/ouroboros/issues/190)).
 *
 * A workspace's own list rather than a vocabulary: V016 constrains the *shape* of a name and
 * never the set of them, so a team that never generates tests deletes that row and a team
 * with a `triage` step adds one. That is why {@link TaskKindsTable.name} is the key
 * resolution is asked for — `resolve("implement", …)` — and why nothing in this service
 * carries a closed list of kinds to check it against.
 *
 * Mirrored here by Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194)), which is
 * the first thing in this service to read any of V016's three tables. Decision **M2** again:
 * the write surface is Z.2's ([#195](https://github.com/NobuData/ouroboros/issues/195)), and
 * resolution creates nothing.
 */
export interface TaskKindsTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`. */
  organization_id: string;
  /** The mono label the matrix row prints — `implement`, `commit-msg`. Unique per workspace. */
  name: string;
  /** The grey line under it — *"Write the change, run tests, iterate to green"*. */
  description: string;
  /** The order the matrix draws the rows in; 1 is first. Unique per workspace, deferrable. */
  sort_order: number;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.routes` — one task kind's route: the chain's owner and its policy triple (V016,
 * [#190](https://github.com/NobuData/ouroboros/issues/190), decision **M4**).
 *
 * Exactly one row per task kind *by constraint*, which is what lets
 * `routing/routing.repository.ts` ask for "the route of this kind" and get one answer rather
 * than a list it would have to pick from. The three policy columns are mockup 06's three
 * inspector controls, and all three are read by Z.1
 * ([#194](https://github.com/NobuData/ouroboros/issues/194)): the local switch, the floor, and
 * the cost cap that travels with a resolution to whatever executes it.
 */
export interface RoutesTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`. */
  organization_id: string;
  /** The kind this route answers for. Unique, so a kind has exactly one route. */
  task_kind_id: string;
  /** The pill the matrix prints and the inspector's title — `implement-primary`. */
  tag: string;
  /**
   * Mockup 06's **Allow fallback to local models** switch. `Generated` — V016 defaults it
   * to `true`.
   *
   * Off is a policy about the *chain*, not about a provider: `routing/resolve.ts` drops the
   * hops that resolve on a local provider and says so, rather than omitting them.
   */
  allow_local_fallback: Generated<boolean>;
  /**
   * Mockup 06's **Fail run instead of degrading below fallback N** — the deepest hop this
   * route may run on, or `null` for the switch being off.
   *
   * Null rather than a number is what *off* means here, and V016 says why: a floor is a hop
   * index, and there is no index that means "no floor". It is measured against
   * {@link RouteHopsTable.position}, which is dense from 1 by constraint — a chain numbered
   * 1, 2, 5 would make *below fallback 2* mean nothing.
   */
  floor_hop_index: number | null;
  /**
   * Mockup 06's **Max cost per run**, in cents — `250` is the inspector's `$2.50`. Null for
   * a route with no cap configured.
   *
   * Cents rather than a float, for the reason {@link ModelPricesTable} gives at length:
   * money in a float is a rounding error waiting to be discovered by an invoice.
   */
  max_cost_cents_per_run: number | null;
  /** Who last saved this route — `"user"."id"`, `on delete set null`. */
  updated_by: string | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.route_hops` — the inspector's numbered chain, in `position` order (V016,
 * [#190](https://github.com/NobuData/ouroboros/issues/190)).
 *
 * **There is no `model_id` here and there cannot be** — decision **M1**. A hop names an
 * alias by foreign key, so the raw provider model string a hop eventually resolves to lives
 * in {@link ModelAliasesTable.model_id} and nowhere else, and swapping `coder-max` onto
 * another model stays one edit of one row.
 */
export interface RouteHopsTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`. */
  organization_id: string;
  /** The route this hop belongs to. `on delete cascade`. */
  route_id: string;
  /**
   * Where in the chain this hop sits; 1 is the primary.
   *
   * Unique per route *and* dense from 1, held by V016's `route_chain_intact()` constraint
   * trigger — which is what makes {@link RoutesTable.floor_hop_index} a statement anybody
   * can count.
   */
  position: number;
  /** The alias this hop uses. `on delete restrict` — an alias a route names cannot be deleted. */
  model_alias_id: string;
  /**
   * The operator's sentence for this hop — *"Fallback on 5xx / timeouts"*. Null is ordinary.
   *
   * Deliberately not a composed one: the inspector's hop 1 prints *"Primary · API key valid,
   * 42ms to us-east"*, which is a position, a status and a latency measured minutes ago.
   * Storing that would freeze a latency into a note. Composing it is `routing/explanations.ts`'s.
   */
  note: string | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `escalation_rules."when".diff_kind` — how a change was classified (V018,
 * [#191](https://github.com/NobuData/ouroboros/issues/191)).
 *
 * One value, and V018 argues that a one-value vocabulary is honest rather than odd: a diff
 * classification nothing computes is a rule that can never fire, which reads on the card as a
 * protection the workspace has and does not. Widening it is one line in the migration plus
 * the classifier that produces the new value.
 */
export type DiffKind = "docs_only";

/** The classifications as values, in the order `ouroboros.escalation_rule_when_valid()` declares them. */
export const DIFF_KINDS = ["docs_only"] as const satisfies readonly DiffKind[];

/**
 * `escalation_rules."when"` — the WF-P8 predicate grammar as routing scopes it (V018,
 * [#191](https://github.com/NobuData/ouroboros/issues/191), decision **M5**).
 *
 * At least one key, no key outside these three, and every key present is **ANDed** with the
 * others — so `{effort_gte: "l", label: "security"}` is both. The empty object is refused by
 * `ouroboros.escalation_rule_when_valid()`: a rule with no condition always fires, which is
 * not an escalation, it is a route.
 *
 * Typed rather than left as an opaque document — the opposite of the choice
 * {@link ModelAliasesTable.params} makes, and for the symmetric reason. `params` is opaque
 * here because *which keys a model can honour* is decided elsewhere; this grammar is closed
 * at the column by a domain, and Z.1 ([#194](https://github.com/NobuData/ouroboros/issues/194))
 * is the thing that evaluates it. A predicate evaluator reading `Record<string, unknown>`
 * would have to re-discover the vocabulary the database already refuses to store anything
 * outside of.
 */
export interface EscalationWhen {
  /**
   * Fires at this size **or larger** — V009's five F9 sizes, not a second effort scale.
   *
   * `_gte` rather than the workflow builder's `_lte` because the two ask opposite questions
   * of the same scale: a trigger gates work *small enough* to run unattended, an escalation
   * catches work *big enough* to deserve a better model.
   */
  effort_gte?: QueueEffort;
  /** Fires when the issue carries this GitHub label — `security`. GitHub's vocabulary, not ours. */
  label?: string;
  /** Fires on this diff classification. One value today, and V018 argues that is honest. */
  diff_kind?: DiffKind;
}

/**
 * `escalation_rules."then"`'s `use_alias` — swap the primary model for one task kind.
 *
 * The mockup's *"(max thinking)"* is the rule's `params`, **not
 * prose**: the same shape {@link ModelAliasesTable.params} holds, so resolution merges the
 * rule's over the alias's and has nothing to parse.
 */
export interface EscalationUseAlias {
  use_alias: {
    /** The kind this modification applies to — `task_kinds.name`. */
    task_kind: string;
    /** The alias that becomes the primary — `model_aliases.alias`. */
    alias: string;
    /** Invocation defaults merged **over** the alias's own. Absent when the rule only swaps. */
    params?: Record<string, unknown>;
  };
}

/** `escalation_rules."then"`'s `add_vote` — a second opinion appended to a kind's resolution. */
export interface EscalationAddVote {
  add_vote: {
    /** The kind this modification applies to — `task_kinds.name`. */
    task_kind: string;
    /** The alias that casts the vote — the mockup's `second-opinion`. */
    alias: string;
  };
}

/**
 * `escalation_rules."then"`'s `route_local` — *everything routes local*.
 *
 * The one action with **no task kind**, which is what makes it the mockup's *"everything"*.
 * Its body is an empty object rather than `null` or a bare string, so the three actions are
 * one shape and a later option (*"except these kinds"*) is a key rather than a fourth
 * encoding.
 */
export interface EscalationRouteLocal {
  route_local: Record<string, never>;
}

/**
 * `escalation_rules."then"` — exactly one of three route modifications (V018, decision **M5**).
 *
 * A union rather than an object of optional keys, because V018 counts the action keys and
 * refuses a document carrying two: a rule whose effect depends on which action a reader
 * notices first is a rule nobody can predict.
 */
export type EscalationThen = EscalationUseAlias | EscalationAddVote | EscalationRouteLocal;

/**
 * `ouroboros.escalation_rules` — mockup 06's *ESCALATION RULES* card as structured
 * predicates rather than as sentences (V018,
 * [#191](https://github.com/NobuData/ouroboros/issues/191), decision **M5**).
 *
 * The three lines on the card read like sentences, so the cheap implementation stores them
 * *as* sentences — and then nothing can evaluate them. A rule is instead two checked jsonb
 * documents and a switch, and {@link EscalationRulesTable.display} is **generated from the
 * pair** by PostgreSQL, so the sentence cannot be hand-written and cannot drift from what
 * the rule does.
 *
 * Evaluated in {@link EscalationRulesTable.sort_order} by Z.1
 * ([#194](https://github.com/NobuData/ouroboros/issues/194)); written by Z.2
 * ([#195](https://github.com/NobuData/ouroboros/issues/195)).
 */
export interface EscalationRulesTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`. */
  organization_id: string;
  /**
   * The card's switch. `Generated` — V018 defaults it to `true`.
   *
   * A disabled rule is still a row with its `sort_order` and its `display`, so turning it
   * back on restores it exactly where it was. *The rules this workspace has* and *the rules
   * that currently fire* are different questions, and the card asks both.
   */
  enabled: Generated<boolean>;
  /**
   * Evaluation order; 1 is first, and it is what gives *which rule wins* one answer when two
   * match the same run.
   *
   * Unique per workspace and deliberately **not** dense, unlike {@link RouteHopsTable.position}:
   * nothing counts these numbers, they are only compared.
   */
  sort_order: number;
  /** The predicate. Quoted in SQL because `when` is reserved; the ticket, the API and the builder all call it that. */
  when: EscalationWhen;
  /** The route modification. Quoted in SQL for the same reason. */
  then: EscalationThen;
  /**
   * The sentence the card renders — *"effort ≥ L → implement uses coder-max (max thinking)"*.
   *
   * `ColumnType<string, never, never>` because the column is `generated always … stored`:
   * PostgreSQL refuses a writer that supplies one, and a type that let somebody try would be
   * promising something the database then rejects. Read by resolution and reported back on
   * every applied rule, so the explanation and the card print the same string.
   */
  display: ColumnType<string, never, never>;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * One side of one change a revision recorded — a value before, and the value after.
 *
 * `unknown` on both sides deliberately: what a column holds is that column's business, and
 * V021's CHECK constrains only that a change *has two sides*. A reader that knows which
 * column it is looking at narrows; a reader paging the audit log (#26) does not have to.
 */
export interface RouteRevisionChange {
  /** What the column held before the save. */
  from: unknown;
  /** What it holds now. */
  to: unknown;
}

/** One hop as a revision records it — the alias's **name**, never its id. See {@link RouteRevisionsTable.diff}. */
export interface RouteRevisionHop {
  /** `model_aliases.alias` — `coder-max`. */
  alias: string;
  /** The operator's sentence for the hop, or null. */
  note: string | null;
}

/** Everything one route changed in one save, keyed by the column that changed. */
export interface RouteRevisionEntry {
  /** `task_kinds.name` — the matrix row this entry is about. */
  task_kind: string;
  /**
   * The columns that moved, and nothing else.
   *
   * Non-empty by CHECK: a route that changed nothing contributes no entry, which is what
   * makes a revision a record of a decision rather than a record of a button press.
   */
  changes: Record<string, RouteRevisionChange>;
}

/**
 * `route_revisions.diff` — what one press of **Save routes** moved (V021,
 * [#195](https://github.com/NobuData/ouroboros/issues/195)).
 *
 * Typed rather than left opaque, for {@link EscalationWhen}'s reason: V021 closes the shape
 * at the column with `ouroboros.route_revision_diff_valid()`, so a reader that had to
 * re-discover the grammar would be re-discovering something the database already refuses to
 * store anything outside of.
 */
export interface RouteRevisionDiff {
  /** One entry per route that changed. Non-empty by CHECK — a no-op save is unstorable. */
  routes: RouteRevisionEntry[];
}

/**
 * `ouroboros.route_revisions` — one row per **Save routes** batch commit (V021,
 * [#195](https://github.com/NobuData/ouroboros/issues/195)).
 *
 * The audit trail behind mockup 06's staged editing model. {@link RoutesTable.updated_by} and
 * `updated_at` say who wrote the state a route is *in*; both are overwritten by the next
 * save, so the transitions between them live here — which is what turns *"why did last
 * Tuesday's runs go to the fallback provider"* from a shrug into a row.
 *
 * **Append-only, and there is nowhere to put an edit.** No `updated_at`, no touch trigger,
 * and nothing in this service updates it: an event that can be revised is not one. Read
 * later by the audit log ([#26](https://github.com/NobuData/ouroboros/issues/26)), which is
 * why V021 checks the diff's shape rather than trusting whoever writes it.
 */
export interface RouteRevisionsTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`. */
  organization_id: string;
  /**
   * Who pressed **Save routes** — `"user"."id"`, `on delete set null`.
   *
   * Nullable for both of {@link RoutesTable.updated_by}'s reasons: a route can be written by
   * something that is not a person, and deleting the person must not delete the record of
   * what they changed.
   */
  actor: string | null;
  /** What moved. See {@link RouteRevisionDiff}. */
  diff: RouteRevisionDiff;
  created_at: Stamped;
}

/**
 * `ouroboros.alias_revisions.action` — what one registry write was (V025,
 * [#584](https://github.com/NobuData/ouroboros/issues/584)).
 *
 * One per write, from a closed vocabulary the inspector's History tab (CJ.2,
 * [#599](https://github.com/NobuData/ouroboros/issues/599)) branches on. A `PATCH` that
 * renamed, rebound and edited params at once records the most consequential of them —
 * `registry/aliases.changes.ts` ranks them in this order — and its diff carries the rest.
 */
export const ALIAS_REVISION_ACTIONS = [
  "created",
  "renamed",
  "rebound",
  "enabled",
  "disabled",
  "edited",
  "duplicated",
  "deleted",
] as const;

/** One of {@link ALIAS_REVISION_ACTIONS}. */
export type AliasRevisionAction = (typeof ALIAS_REVISION_ACTIONS)[number];

/** One entry of an alias revision's diff — a column's value before the write, and after it. */
export interface AliasRevisionChange {
  from: unknown;
  to: unknown;
}

/**
 * `alias_revisions.diff` — the columns one registry write moved, keyed by column name (V025,
 * [#584](https://github.com/NobuData/ouroboros/issues/584)).
 *
 * `duplicate_of` is the one key that is not a column: a duplicate records the alias it was
 * copied from under it, in the same `{from, to}` shape. Typed rather than left opaque for
 * {@link RouteRevisionDiff}'s reason: V025 closes the shape at the column with
 * `ouroboros.alias_revision_diff_valid()`.
 */
export type AliasRevisionDiff = Record<string, AliasRevisionChange>;

/**
 * `ouroboros.alias_revisions` — one row per registry write (V025,
 * [#584](https://github.com/NobuData/ouroboros/issues/584)).
 *
 * V021's table again, for the registry: {@link ModelAliasesTable.updated_by} and `updated_at`
 * say who wrote the state an alias is *in*, both are overwritten by the next edit, and the
 * transitions between them live here — which is what turns *who rebound `coder-max` to what,
 * when* into a row. **Append-only by construction**, as `route_revisions` is: no `updated_at`,
 * no touch trigger, and nothing in this service updates it.
 *
 * The columns are `audit_events`' nouns on purpose — `actor`, an `action` from a vocabulary,
 * the alias as a subject, a before/after document — so CJ.2's promotion into that table is a
 * copy rather than a rewrite.
 */
export interface AliasRevisionsTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`. */
  organization_id: string;
  /**
   * The alias this revision was about — `model_aliases.id`, `on delete set null`.
   *
   * Null after the alias is deleted, which is what lets a `deleted` revision survive the row
   * it describes; the name lives in {@link AliasRevisionsTable.alias} for exactly that case.
   */
  alias_id: string | null;
  /** The alias's name as it read after the write — `coder-max`, or `coder-max-copy`. */
  alias: string;
  /** Who made the write — `"user"."id"`, `on delete set null`. Null for a seed or an import. */
  actor: string | null;
  /** What the write was. See {@link ALIAS_REVISION_ACTIONS}. */
  action: AliasRevisionAction;
  /** What moved. See {@link AliasRevisionDiff}. */
  diff: AliasRevisionDiff;
  created_at: Stamped;
}

/**
 * The four storage shapes a model alias can be referenced from — V023's
 * `alias_reference_kind` domain ([#581](https://github.com/NobuData/ouroboros/issues/581),
 * decision **R5**). Two are live (`route`, `escalation`); `workflow` and `chat_pin` are in
 * the vocabulary and contribute no rows until their storage exists.
 */
export const ALIAS_REFERENCE_KINDS = ["route", "escalation", "workflow", "chat_pin"] as const;

/** One of {@link ALIAS_REFERENCE_KINDS}. */
export type AliasReferenceKind = (typeof ALIAS_REFERENCE_KINDS)[number];

/**
 * `ouroboros.alias_references` — what references a model alias, one row per reference (V023,
 * [#581](https://github.com/NobuData/ouroboros/issues/581)).
 *
 * A **view**, and read-only: mockup 21's `USED BY` column, the inspector's chip list, the
 * blocked **Remove** and the rename guard all read this one definition (decision **R5**), and
 * no count is stored anywhere — the column is `count(*)` over it. Read it through
 * `alias_reference_guard()` from inside a delete or rename transaction; selecting from the
 * view directly takes no lock and its answer can go stale before the next statement runs.
 */
export interface AliasReferencesView {
  /** The workspace, carried from the referring row. */
  organization_id: string;
  /** `model_aliases.id` — what a delete or rename is about. */
  alias_id: string;
  /** `model_aliases.alias` — the name, so the view can be entered by it. */
  alias: string;
  /** Which storage shape the reference lives in. */
  kind: AliasReferenceKind;
  /** The referring row — `route_hops.id` for a route, `escalation_rules.id` for a rule. */
  ref_id: string;
  /** Mockup 21's chip, verbatim — a route's tag, or `escalation:effort≥L`. */
  ref_label: string;
  /** Whether this reference refuses a delete (409) rather than warns about one (422). */
  blocking: boolean;
}

/**
 * `ouroboros.audit_events` — who did what to which subject, from where, and when (V022,
 * [#225](https://github.com/NobuData/ouroboros/issues/225)).
 *
 * The platform audit trail. Specified by scaffolding
 * [#26](https://github.com/NobuData/ouroboros/issues/26) and landed early by AD.4, because
 * decision **P5** puts credential auditing in the MVP — so this is one table rather than a
 * credential-specific one that v2 would have to reconcile.
 *
 * **Append-only, and the database says so rather than this service promising it.** There is
 * no `updated_at`, `audit_events_no_update` refuses a revision from any role including the
 * owner, and the application role holds `select` and `insert` and nothing else. The one
 * update the table permits is the actor foreign key's own `on delete set null` — *what
 * happened cannot be rewritten; who did it can be forgotten* — which is why
 * {@link AuditEventsTable.actor_id} is `ColumnType<…>` rather than a plain `string | null`:
 * this service may read it and insert it, and may never write it again.
 *
 * **Nothing here is secret material.** {@link AuditEventsTable.detail} is the only free-form
 * column, and it is built from a closed field set by `src/modules/audit/audit.events.ts`;
 * `audit.secrecy.spec.ts` greps the rows a full credential lifecycle actually writes against
 * the vault's own redaction vocabulary, and `ouroboros/no-secret-logging` refuses a field
 * whose name would make one look at home there.
 *
 * **`action` and `subject_type` are `string` here and unions in the audit module.** V022
 * constrains them to an identifier grammar and deliberately not to a vocabulary — adding an
 * event has to be an application release rather than a migration — so this mirror declares
 * what the column holds and `audit.events.ts` declares what this service writes. That split
 * is the same one {@link ProviderConnectionsTable} does *not* make, and the difference is the
 * point: V015 CHECKs its `kind` against a list, so the list belongs here.
 */
export interface AuditEventsTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`. */
  organization_id: string;
  /**
   * Who did it — `"user"."id"`, `on delete set null`.
   *
   * Null when nobody did: a `credential.lease_granted` is a worker authenticated by a
   * service key rather than a person, and naming one there would be inventing them. Also
   * null after the person is deleted, which is the one update the table permits.
   *
   * `ColumnType` with `never` in the update position, matching {@link Stamped}'s reasoning:
   * the set-null is the foreign key's statement and not this service's, and a column this
   * service could update is one it eventually would.
   */
  actor_id: ColumnType<string | null, string | null, never>;
  /**
   * What happened — `provider.revealed`, `credential.lease_granted`. `family.event`, lower
   * snake on both sides, by CHECK.
   *
   * `string` rather than a union: see this interface's header, and `audit.events.ts` for the
   * vocabulary this service writes.
   */
  action: string;
  /** What kind of thing it was about — `provider_connection`, `run`. Lower snake by CHECK. */
  subject_type: string;
  /**
   * The subject's id, as text.
   *
   * Deliberately not a foreign key — an event about a connection has to outlive the
   * connection, and `provider.deleted` is exactly the row an FK would make unwritable. Null
   * when the event names a kind rather than an instance.
   */
  subject_id: string | null;
  /**
   * The client address the operation arrived from, as PostgreSQL's `inet`.
   *
   * `string` on the way in and on the way out — `pg` parses `inet` as text, and this service
   * has no arithmetic to do on an address. Null when none is honestly knowable; see
   * `audit/audit.context.ts` for what "knowable" means behind a proxy.
   */
  ip: string | null;
  /**
   * The rest of what happened — a flat object of scalars.
   *
   * `Generated` because the column defaults to `'{}'::jsonb`, so an event with nothing more
   * to say inserts nothing here. Flat and scalar by convention rather than by CHECK, which
   * is what makes enumerating its keys the whole of reading it — the property both secrecy
   * greps depend on.
   */
  detail: Generated<Record<string, string | number | boolean | null>>;
  /**
   * When it happened.
   *
   * {@link Stamped}, and the `never` in its update position is load-bearing here rather than
   * conventional: it is the compiler's half of the rule `audit_events_no_update` enforces in
   * the database.
   */
  occurred_at: Stamped;
}

/**
 * `workflows.status` — what the rail draws a workflow as (V029,
 * [#132](https://github.com/NobuData/ouroboros/issues/132)).
 *
 * The `workflows_status_valid` CHECK, mirrored the way this file's header says a CHECK
 * becomes a type. Three words, and each is a different thing on mockup 04's `.wf-list`:
 *
 *   * `active` — an ordinary rail entry, and the only status the assign-workflow vocabulary
 *     offers (see `workflows/registry.service.ts`).
 *   * `paused` — the `hotfix-p0` entry, whose err-dot *is* this value and whose caption reads
 *     `5 stages · paused`.
 *   * `archived` — the soft delete. Its version history stays readable, and it is off the rail
 *     and out of the vocabulary.
 */
export type WorkflowStatus = "active" | "paused" | "archived";

/** The three, in the order the CHECK declares them. */
export const WORKFLOW_STATUSES = [
  "active",
  "paused",
  "archived",
] as const satisfies readonly WorkflowStatus[];

/**
 * `ouroboros.workflows` — one workspace's workflow entities (V029,
 * [#132](https://github.com/NobuData/ouroboros/issues/132)), read by P.4
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)).
 *
 * Mockup 04's page head and its `.wf-list` rail: the title, the `v14` chip, the err-dot. The
 * entities that decision **K5** deferred — `runs.workflow_tag` and `queue_items.workflow_tag`
 * are still opaque text by decision **F8**, and V029 deliberately did not come back and
 * tighten them, so **the bridge between a stored tag and one of these rows is the slug**: a
 * lookup on `(organization_id, slug)`, which is unique, and a tag that resolves to nothing is
 * a workflow that was renamed or removed rather than a broken row.
 *
 * **Nothing in this service writes it.** P.3 ([#134](https://github.com/NobuData/ouroboros/issues/134))
 * is the CRUD and publish API and #136 is the seed that fills the rail; P.4 is the first
 * reader, which is why the mirror arrives with it rather than with V029 — a mirrored table
 * with no reader is drift waiting to happen, as {@link GithubIssuesTable} and
 * {@link IssueEstimatesTable} both say from the other side.
 */
export interface WorkflowsTable {
  id: Generated<string>;
  /** The workspace — `organization."id"`, as text. `on delete cascade`, taking the history with it. */
  organization_id: string;
  /**
   * **The name the rest of the product already knows this workflow by.**
   *
   * Lower-case kebab, at most 64 characters by `workflows_slug_format` — which is exactly what
   * a `workflow_tag` can hold, so every tag already stored is a slug this column could carry.
   * Unique within the workspace, and per workspace rather than globally: two tenants both
   * running a `standard-fix` is the ordinary case.
   */
  slug: string;
  /** The human title. Free text — the slug is the identifier, and the two are often the same string. */
  name: string;
  /** `active` on the rail, `paused` as its err-dot, `archived` as the soft delete. */
  status: WorkflowStatus;
  /**
   * **Which published version is in force** — the `v14` chip.
   *
   * Null is *nothing in force yet*: the state of a workflow that has only ever had a draft,
   * which is what **+ New workflow** leaves behind. Not a cache of `max(version)` — held to a
   * real published version of *this* workflow by `workflows_current_version_fk`.
   *
   * P.4's stats read the definition through it, which is why a null renders `not published`
   * rather than a stage count of zero: a workflow with no version in force has no definition
   * to count, and `0 stages` would be a number about a document nobody published.
   */
  current_version: number | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.workflow_versions` — a workflow's version history plus its one mutable draft
 * (V029, [#132](https://github.com/NobuData/ouroboros/issues/132)).
 *
 * **Decision P1: published versions are immutable, and the draft is the row that becomes
 * one.** A run pins the version it executed, so editing a published definition would rewrite
 * what that run did. `workflow_versions_no_update` enforces it in the database for every role,
 * which is why there is no `Updateable` counterpart to {@link NewWorkflowVersion} — the same
 * shape of rule {@link IssueEstimatesTable} and {@link AuditEventsTable} carry.
 *
 * **`version is null` *is* the draft**, rather than an `is_draft` flag beside a number the row
 * has not earned: `workflow_versions_version_publish_stamp` ties the number to the publish
 * stamp, so a row has both or neither and no reader has to know which of two facts wins.
 * `workflow_versions_one_draft_idx` holds a workflow to at most one of them.
 */
export interface WorkflowVersionsTable {
  id: Generated<string>;
  /**
   * The workflow this is a version of, and the whole of this row's tenancy.
   *
   * V017's and V026's choice: a version has no meaning apart from a workflow and every read
   * enters through one, so the single cascading foreign key is its tenancy and there is no
   * second `organization_id` for a trigger to keep in agreement.
   */
  workflow_id: string;
  /** The published version number — dense from 1, assigned by publishing, never reused. Null is the draft. */
  version: number | null;
  /**
   * The P.2 DSL document ([#133](https://github.com/NobuData/ouroboros/issues/133)).
   *
   * CHECKed to be a jsonb *object* and no further — the grammar has one owner, and an empty
   * `{}` is the legal state of a canvas with nothing on it yet. So what is stored here is
   * **not** known to be a valid document, and a reader that needs one parses it:
   * `validateWorkflowDocument` for the whole grammar, or — for the rail's two facts —
   * `workflows/stats.repository.ts`, which asks PostgreSQL for the node count and the terminal
   * actions and treats anything else as a document it cannot read.
   *
   * `ColumnType` for {@link IssueEstimatesTable.breakdown}'s reason: `pg` hands a `jsonb`
   * column back parsed, and Kysely wants the value *written* to be the string a driver will
   * send — so every write goes through `JSON.stringify`. `unknown` on the way out rather than
   * a document type, because the column's own constraint promises no more than an object.
   */
  definition: ColumnType<unknown, string, string>;
  /** When this row became a version. Null exactly while {@link version} is null. */
  published_at: Date | null;
  /**
   * Who pressed Publish — `"user"."id"`, `on delete set null`.
   *
   * Nullable because a version can be published by a seed or a template import, and the
   * set-null rather than a cascade because removing a person must not delete what they
   * published. That set-null is the one update `workflow_versions_no_update` permits.
   */
  published_by: string | null;
  /** What changed, in the publisher's words. Optional, never blank, and never on a draft. */
  change_note: string | null;
  created_at: Stamped;
  /**
   * **Last edited** — the mockup's *Last edited 2h ago*.
   *
   * Moved by the touch trigger only while the row is a draft: a published version cannot be
   * edited, so its stamp stays where publishing left it rather than drifting when the foreign
   * key erases an attribution.
   */
  updated_at: Stamped;
}

/**
 * `ticket_sources.kind` — which tracker a source is (V030, decision **P6**).
 *
 * The `ticket_sources_kind` CHECK, mirrored the way this file's header says a CHECK becomes a
 * type, and **the key Q.2's registry resolves a provider by**
 * ([#139](https://github.com/NobuData/ouroboros/issues/139)). That is what makes this union
 * different from the other vocabularies here: the others partition something a page renders,
 * and this one partitions the set of implementations a build has.
 *
 * `custom` is in the set from the start rather than added when somebody needs it — it is what
 * a community provider registers as, and leaving it out would mean the first such provider
 * needed a migration before it could store a row.
 */
export type TicketSourceKind = "github" | "gitlab" | "jira" | "linear" | "custom";

/**
 * The five, in the order the CHECK declares them.
 *
 * Iterated by `ticket-sources/ticket-source.registry.ts`, which answers *which kinds does this
 * build have a provider for* by filtering this list — so the catalog's order is the
 * migration's rather than an injector's.
 */
export const TICKET_SOURCE_KINDS = [
  "github",
  "gitlab",
  "jira",
  "linear",
  "custom",
] as const satisfies readonly TicketSourceKind[];

/**
 * `ticket_sources.status` — the sync loop's filter and the settings list's dot (V030).
 *
 * Three states rather than a boolean, and the third is the reason: a source that is *failing*
 * must not be confusable with one somebody switched off, because the two are fixed by
 * different people. `active` is the working state and the only one Q.2's loop polls, `paused`
 * is a person's choice, and `error` is the sync's own report.
 *
 * All four provider error classes coarsen into `error` — see
 * `ticket-sources/ticket-source.errors.ts`, which carries that table and the
 * {@link TicketSourcesTable.status_reason} that keeps them distinguishable.
 */
export type TicketSourceStatus = "active" | "paused" | "error";

/** The three, in the order the CHECK declares them. */
export const TICKET_SOURCE_STATUSES = [
  "active",
  "paused",
  "error",
] as const satisfies readonly TicketSourceStatus[];

/**
 * `tickets.state` — the one state vocabulary every tracker in the set maps onto (V030).
 *
 * The same two words {@link GithubIssueState} carries, and deliberately the same two: Jira's
 * workflow states and Linear's are richer than two, and collapsing them is the **provider's**
 * job in `mapTicket`. A wider union here would be a filter whose options changed depending on
 * which tracker a workspace happened to use.
 */
export type TicketState = "open" | "closed";

/** The two, in the order the CHECK declares them. */
export const TICKET_STATES = ["open", "closed"] as const satisfies readonly TicketState[];

/**
 * `ouroboros.ticket_sources` — where a workspace's tickets come from (V030,
 * [#138](https://github.com/NobuData/ouroboros/issues/138)), polled by Q.2
 * ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * One row per configured tracker per workspace. Decision **P6**, and the reason mockup 04's
 * trigger node reads `Issue queued` rather than *GitHub issue queued*.
 *
 * **Almost nothing reads this interface — reads go through {@link TicketSourcesPublicView}.**
 * The table is declared because {@link credentials_encrypted} lives on it and nowhere else,
 * and because a write has to name a table; the view is declared because the credential is
 * absent from it, which is what makes *"never selected by read paths"* a property of the
 * projection rather than of everybody's care. `ticket-sources.repository.ts` has exactly one
 * statement that names this table for reading, and it selects one column.
 */
export interface TicketSourcesTable {
  id: Generated<string>;
  /** Owning workspace. `on delete cascade` — a deleted workspace takes its sealed credentials with it. */
  organization_id: string;
  /** Which tracker, and the key the provider registry resolves by. */
  kind: TicketSourceKind;
  /** What the settings list calls this source. Unique per workspace — the one column here nothing external owns. */
  display_name: string;
  /**
   * Non-secret settings: a base URL, the project keys to poll, a GitHub-kind source's
   * repository list.
   *
   * `unknown` on the way out rather than a shape, because the column's CHECK promises an
   * object and no more: the per-kind grammar belongs to the provider that reads it, and a type
   * spelled here would be GitHub's grammar under a neutral name — the special case V030 exists
   * to remove. A provider parses it in `validateConfig`.
   *
   * `ColumnType` for {@link WorkflowVersionsTable.definition}'s reason: `pg` hands a `jsonb`
   * column back parsed, and Kysely wants the value *written* to be the string a driver will
   * send, so every write goes through `JSON.stringify`.
   */
  config: ColumnType<unknown, string, string>;
  /**
   * The sealed credential, or null while a source is configured and not yet credentialed.
   *
   * One of `VaultService`'s envelopes, always — `ticket_sources_credentials_sealed` refuses
   * anything else, for *every* writer rather than for the service that is supposed to
   * encrypt. Selected by one statement in this service and decrypted inside the call that
   * needs it; see `ticket-sources.repository.ts` and `ticket-sources.service.ts`.
   */
  credentials_encrypted: string | null;
  /** `active` | `paused` | `error`. Defaults to `active`: a source somebody just added is meant to be polled. */
  status: Generated<TicketSourceStatus>;
  /**
   * Why it is in that state, in words fit to render — `rate limited until 14:20 UTC` (V031,
   * [#139](https://github.com/NobuData/ouroboros/issues/139)).
   *
   * Null when there is nothing to say. Composed by `ticket-source.errors.ts` from a closed set
   * of phrases, never from a provider's error body.
   */
  status_reason: string | null;
  /**
   * The watermark the next incremental sync sends to the tracker.
   *
   * **Opaque**, and that is an acceptance criterion of Q.2 rather than a convenience: the loop
   * stores what a provider returned and never interprets it. Null until a poll has produced
   * one, which is what makes a poll a full sync rather than an incremental one.
   */
  sync_cursor: string | null;
  /** When this source was last polled successfully. Null until the first poll; moved by a poll that found nothing. */
  synced_at: Date | null;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.ticket_sources_public` — every column of {@link TicketSourcesTable} except the
 * sealed credential (V030, widened by V031).
 *
 * **What every read path selects.** The secret is not forgotten here, it is *absent*: there is
 * nothing for a listing, a join or a debug dump to leak. `ouroboros-db/tests/constraints.sql`
 * asserts the column list against `information_schema`, so a later migration that widened it
 * back would fail that build rather than quietly re-expose the column.
 *
 * It is in {@link READ_ONLY_VIEWS}, and it is the first entry there that PostgreSQL itself
 * would happily accept a write through — one base table, no filter, so it is auto-updatable.
 * That makes the rule *more* necessary rather than less: an `insertInto` here would compile,
 * run, and create a source with no credential and no way to be given one.
 */
export interface TicketSourcesPublicView {
  id: string;
  organization_id: string;
  kind: TicketSourceKind;
  display_name: string;
  config: unknown;
  status: TicketSourceStatus;
  sync_cursor: string | null;
  synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** V031's column, appended rather than inserted, so V030's ten keep their ordinals. */
  status_reason: string | null;
}

/**
 * `ouroboros.tickets` — the canonical intake row (V030,
 * [#138](https://github.com/NobuData/ouroboros/issues/138)), written by Q.2's sync loop
 * ([#139](https://github.com/NobuData/ouroboros/issues/139)).
 *
 * One row per ticket per source, whatever tracker it came from. Source-agnostic by
 * construction: no repository, no issue number, no `gh_` prefix — decision **P6**, and the
 * four columns of {@link GithubIssuesTable} that stop being columns are named in V030's
 * header.
 *
 * **Decision K3 still applies, generalized: this is a cache and the tracker is the source of
 * truth.** Exactly one column below is this product's — {@link sizing_status} — and it keeps
 * V014's four values and V014's default *verbatim*, which is what lets the estimation pipeline
 * stay as it is. Everything from {@link external_id} to {@link source_updated_at} is a copy of
 * something a tracker owns, and nothing in this service authors one.
 *
 * **`github_issues` is still the shipped intake table.** V030 generalized additively and left
 * it exactly as it was found, and the cut-over — the intake surfaces reading this table, the
 * estimates re-pointing at {@link id} — belongs to Q.3
 * ([#140](https://github.com/NobuData/ouroboros/issues/140)), which is the ticket that makes
 * GitHub a provider. What Q.2 contributes is the writer.
 */
export interface TicketsTable {
  id: Generated<string>;
  /** Owning workspace, and the leading column of every read. Held to the source's own workspace by a trigger. */
  organization_id: string;
  /** Where this ticket came from. The upsert key with {@link external_id}. */
  source_id: string;
  /**
   * The tracker's own identity — `485`, `PROJ-142`, a Linear uuid.
   *
   * Text, which is what makes those three one column, and unique within its source rather than
   * globally: every tracker has a first ticket.
   */
  external_id: string;
  /**
   * The display form — `#485`, `PROJ-142`, `ENG-123`.
   *
   * Supplied by the provider rather than computed, because a Linear key has no relationship to
   * the uuid that identifies it. Deliberately not unique: two sources may hold the same key.
   */
  external_key: string;
  /** The ticket in its own tracker — the href behind *"Open ↗"*, constrained to `https` and a host. */
  external_url: string;
  /** Title as the tracker currently has it. Overwritten by every sync that sees it change. */
  title: string;
  /** Body in full, or null when the tracker's is. */
  body: string | null;
  /** `open` | `closed`. Collapsing a richer workflow onto these two is the provider's job. */
  state: TicketState;
  /**
   * The **tracker's** label names as a JSON array of strings — not this product's vocabulary.
   *
   * `ColumnType` for {@link GithubIssuesTable.labels}' reason: parsed on the way out, a string
   * on the way in.
   */
  labels: ColumnType<string[], string, string>;
  /**
   * Who opened it, in whatever form the tracker returns — a GitHub login, a Jira account id, a
   * Linear display name.
   *
   * **No login grammar**, deliberately: V014's GitHub pattern on a source-agnostic column
   * would reject legitimate authors from three of the five kinds. Null when the tracker
   * returns no author.
   */
  author: string | null;
  /** When the tracker says it was opened — and the column the backlog's newest-first ordering is defined over. */
  source_created_at: Date;
  /** The tracker's last-updated time. Not nullable: a row without one could not take part in an incremental sync. */
  source_updated_at: Date;
  /**
   * When this row was last confirmed against its source.
   *
   * Moved by every sync, including one that found nothing changed. Distinct from
   * {@link updated_at}, which the touch trigger moves only when the row actually differed.
   */
  synced_at: Generated<Date>;
  /** Our sizing pipeline. V014's four values and default, verbatim — see {@link SizingStatus}. */
  sizing_status: Generated<SizingStatus>;
  /**
   * Provider specifics the canonical columns do not name — a GitHub repository, a Jira
   * project, a Linear team.
   *
   * Where `github_repo_id` went (decision **P6**), and still queryable: the repository filter
   * becomes a containment query served by `tickets_meta_idx`. `unknown` on the way out for
   * {@link TicketSourcesTable.config}'s reason.
   */
  meta: ColumnType<unknown, string, string>;
  created_at: Stamped;
  updated_at: Stamped;
}

/**
 * `ouroboros.token_usage_daily` — per-workspace, per-day, per-provider rollup of
 * {@link TokenUsageTable} (V010).
 *
 * A **view**, and a plain one rather than materialized: decision F10 again. The read behind
 * mockup 02's *Token spend · today*.
 *
 * Every aggregate below is a `bigint` or a `numeric` and therefore arrives as a **string** —
 * `pg` will not narrow either to a `number` on its own, and it is right not to. The dashboard
 * repository casts in SQL rather than converting here, so the value that reaches JavaScript
 * is one PostgreSQL already knows fits.
 */
export interface TokenUsageDailyView {
  organization_id: string;
  /**
   * The **UTC** calendar day `occurred_at` falls in, fixed rather than session-dependent.
   *
   * A `date` column, which `pg` parses into a `Date` at the *process's* local midnight — so
   * comparing it against a `Date` computed in UTC is a bug on any machine that is not on UTC.
   * Filter it against a `'YYYY-MM-DD'` string cast to `date` instead; `dashboard.repository.ts`
   * is where that is done and where the trap is written down.
   */
  day: Date;
  provider: string;
  events: string;
  /**
   * How many of the day's events have no `cost_cents` yet.
   *
   * Non-zero means {@link TokenUsageDailyView.cost_cents} is a **lower bound**, which is the
   * `≈` on the card. Today it is every event; #92 prices them.
   */
  unpriced_events: string;
  tokens_in: string;
  tokens_out: string;
  /** `tokens_in + tokens_out` summed — the `4.2M` the stat renders. */
  tokens_total: string;
  /** Cost of the day's **priced** events in cents, and null when none of them are priced. */
  cost_cents: string | null;
}

/**
 * `ouroboros.workspace_settings_effective` — every workspace's settings with the defaults
 * resolved (V011).
 *
 * One row per workspace whether or not it has a {@link WorkspaceSettingsTable} row, which is
 * what makes a newly created workspace read `auto_merge_on_checks = false` from the database
 * rather than from an application default. **Read here, write the table.**
 */
export interface WorkspaceSettingsEffectiveView {
  organization_id: string;
  /** The switch's position, `false` for a workspace that has never set it. */
  auto_merge_on_checks: boolean;
  /** Whether the workspace has ever written a settings row — i.e. whether the values are choices or defaults. */
  is_explicit: boolean;
  /** When a setting last changed, or null when nothing ever has. Not coalesced: there is no honest time to invent. */
  updated_at: Date | null;
  updated_by: string | null;
}

/**
 * The entries of {@link Database} that are **views**, and are therefore read-only.
 *
 * The same kind of rule {@link LIBRARY_OWNED_TABLES} is, and stated for the same reason: a
 * type cannot express it usefully. Kysely will happily compile an `insertInto` against either
 * of these, and PostgreSQL will refuse it at run time — an auto-updatable view needs a single
 * base table and neither of these has one. Both are windows onto a table this mirror also
 * declares, and that table is where a write goes.
 *
 * **`ticket_sources_public` (V030, [#138](https://github.com/NobuData/ouroboros/issues/138))
 * is the third, and it is the first entry here that PostgreSQL itself would accept a write
 * through**: one base table, no filter, so it is auto-updatable and the run-time refusal the
 * paragraph above relies on does not arrive. That makes the rule load-bearing rather than
 * belt-and-braces — an `insertInto` here would compile *and* succeed, and would create a
 * ticket source whose sealed credential column the statement had no way to reach. Writes go
 * to `ticket_sources`, which {@link Database} also declares.
 *
 * `schema.spec.ts` holds this list to the view interfaces above; `db.integration-spec.ts`
 * compares their columns against `information_schema` exactly as it does a table's, because a
 * view that lost a column breaks a query the same way a table that lost one does.
 */
export const READ_ONLY_VIEWS = [
  "token_usage_daily",
  "workspace_settings_effective",
  "ticket_sources_public",
] as const;

/**
 * Every table `ouroboros-rest` may query, keyed by its name in the database.
 *
 * This is the type parameter the whole module is built around: `Kysely<Database>` is what
 * makes `selectFrom("organization").select("slug")` compile and `select("slugg")` not.
 *
 * **Two of the sixteen entries are views** rather than tables — see {@link READ_ONLY_VIEWS},
 * which is the rule that keeps a write off them. `Database` has no vocabulary for the
 * difference, so the list beside it is the vocabulary.
 *
 * **The last six arrived with the dashboard read-model** (V008–V011,
 * [#70](https://github.com/NobuData/ouroboros/issues/70)): the four tables mockup 02 is
 * assembled from and the two views V010 and V011 publish over two of them. Nothing in this
 * service writes any of them today — the loop engine is v2 (#54), so the rows come from the
 * development seed — and the mirror declares them anyway, because a read is a query and a
 * query is what these types exist to check.
 *
 * **`tenant_keys` (V013, [#222](https://github.com/NobuData/ouroboros/issues/222)) is the
 * thirteenth**, and the first table here that this service both writes and is the *only*
 * writer of: `src/modules/vault/` owns every statement against it, and there is no seed row,
 * because a workspace's key is created the first time it stores a secret.
 *
 * **`model_prices` (V012, [#580](https://github.com/NobuData/ouroboros/issues/580)) is the
 * fourteenth**, and the first with *two* writers that are not the same thing: a repeatable
 * migration writes the bundled catalog through `ouroboros.import_model_price_catalog()`, and
 * `src/modules/pricing/` writes a workspace's overrides and nothing else
 * ([#586](https://github.com/NobuData/ouroboros/issues/586)). The two populations cannot
 * collide — every row the import writes is `organization_id null / source bundled`, and every
 * row this service writes is the opposite — which is a property of the conflict target rather
 * than of anybody's care.
 *
 * **`provider_connections` and `model_aliases` (V015,
 * [#189](https://github.com/NobuData/ouroboros/issues/189)) are the fifteenth and
 * sixteenth**, and they are the first pair here that this service *reads* on behalf of two
 * roadmaps that have not started. Decision **M2** puts the schema and the resolution
 * accessors in `src/modules/registry/` and leaves every create, update and delete to mockup
 * 07 and mockup 21 — so the mirror declares the columns those surfaces will write, and this
 * service writes exactly one of them: `credentials_encrypted`, and only when the vault's
 * re-encryption sweep re-seals a value it already held.
 *
 * **`provider_models` (V017, [#221](https://github.com/NobuData/ouroboros/issues/221)) is the
 * seventeenth**, and the first table here whose only writer is discovery —
 * `provider-connections/provider-models.repository.ts`, AE.4's
 * ([#230](https://github.com/NobuData/ouroboros/issues/230)) upsert. It is mirrored because CH.2
 * ([#585](https://github.com/NobuData/ouroboros/issues/585)) reads `meta` to bound a param
 * schema by the context length the provider actually published — a bound taken from a live
 * catalog rather than from a number written down here.
 *
 * **`route_revisions` (V021, [#195](https://github.com/NobuData/ouroboros/issues/195)) is the
 * eighteenth**, and the first table this service *only ever writes*. Nothing here reads it:
 * it is the audit trail one press of **Save routes** leaves behind, and the surface that pages
 * it is the audit log ([#26](https://github.com/NobuData/ouroboros/issues/26)). Mirrored now
 * because the write is Z.2's, and V021 exists because Z.2 needed somewhere to put it.
 *
 * **`audit_events` (V022, [#225](https://github.com/NobuData/ouroboros/issues/225)) is the
 * nineteenth**, and the first table here that is **append-only in the database** rather than
 * by convention — see {@link AuditEventsTable} for what that costs the two columns whose
 * `ColumnType` says `never`. It is #26's table, landed early because decision **P5** puts
 * credential auditing in the MVP, and it is the one #26 will inherit rather than replace.
 *
 * **`github_issues` (V014, [#99](https://github.com/NobuData/ouroboros/issues/99)) is the
 * twenty-eighth**, and it arrived a release late on purpose: the table landed with K.1 and
 * nothing in this service read or wrote a row of it until K.4
 * ([#102](https://github.com/NobuData/ouroboros/issues/102)) landed the sync that fills it,
 * and a mirrored table with no reader is drift waiting to happen. It is the first table here
 * whose rows are **somebody else's** — see {@link GithubIssuesTable} on decision K3.
 *
 * **`issue_estimates` (V026, [#100](https://github.com/NobuData/ouroboros/issues/100)) is the
 * twenty-ninth**, and it arrived a release late for the same reason and by the same rule: the
 * table landed with K.2 and nothing here wrote a row of it until L.3
 * ([#107](https://github.com/NobuData/ouroboros/issues/107)) landed the orchestration that
 * fills it. It is the second table in this list that is **append-only in the database** rather
 * than by convention — `audit_events` is the first — and, like it, has no `Updateable`
 * counterpart to its {@link NewIssueEstimate}.
 *
 * **`workflows` and `workflow_versions` (V029,
 * [#132](https://github.com/NobuData/ouroboros/issues/132)) are the thirtieth and
 * thirty-first**, and they arrived a release late by the same rule for the third time: V029
 * landed both tables with no writer anywhere, and nothing here read a row of either until P.4
 * ([#135](https://github.com/NobuData/ouroboros/issues/135)) — the rail's stage counts,
 * terminal captions and usage share. Every write is still somewhere else's: P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)) is the CRUD and publish API and
 * #136 is the seed, so what this mirror declares today is a **read model** — the columns two
 * statements in `src/modules/workflows/` select, plus the two `New…` shapes the suites arrange
 * a rail with.
 *
 * **Four tables are deliberately absent.** `tenants`, `tenant_members`, `users` and
 * `user_identities` were dropped by V006 and are gone from here with it
 * ([#714](https://github.com/NobuData/ouroboros/issues/714)) — a mirror that still declared
 * them would let a query compile against a table PostgreSQL would refuse, which is the exact
 * failure this file exists to prevent. `ouroboros-db/tests/constraints.sql` asserts all four
 * stay gone, so there is no state in which re-adding them here would be right.
 */
export interface Database {
  user: UserTable;
  tenant_domains: TenantDomainsTable;
  organization: OrganizationTable;
  member: MemberTable;
  github_orgs: GithubOrgsTable;
  github_repos: GithubReposTable;
  github_credentials: GithubCredentialsTable;
  github_issues: GithubIssuesTable;
  issue_estimates: IssueEstimatesTable;
  user_preferences: UserPreferencesTable;
  runs: RunsTable;
  queue_items: QueueItemsTable;
  token_usage: TokenUsageTable;
  workspace_settings: WorkspaceSettingsTable;
  tenant_keys: TenantKeysTable;
  model_prices: ModelPricesTable;
  provider_connections: ProviderConnectionsTable;
  model_aliases: ModelAliasesTable;
  provider_models: ProviderModelsTable;
  task_kinds: TaskKindsTable;
  routes: RoutesTable;
  route_hops: RouteHopsTable;
  escalation_rules: EscalationRulesTable;
  route_revisions: RouteRevisionsTable;
  alias_revisions: AliasRevisionsTable;
  audit_events: AuditEventsTable;
  workflows: WorkflowsTable;
  workflow_versions: WorkflowVersionsTable;
  ticket_sources: TicketSourcesTable;
  tickets: TicketsTable;
  token_usage_daily: TokenUsageDailyView;
  ticket_sources_public: TicketSourcesPublicView;
  workspace_settings_effective: WorkspaceSettingsEffectiveView;
  alias_references: AliasReferencesView;
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
  user: ["id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt"],
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
  github_repos: [
    "id",
    "org_id",
    "name",
    "enabled",
    "default_branch",
    "created_at",
    "updated_at",
    "issues_synced_at",
    "issues_sync_cursor",
  ],
  github_credentials: ["organization_id", "token_encrypted", "created_at", "updated_at"],
  github_issues: [
    "id",
    "organization_id",
    "github_repo_id",
    "number",
    "title",
    "body",
    "state",
    "labels",
    "author_login",
    "gh_created_at",
    "gh_updated_at",
    "gh_url",
    "synced_at",
    "sizing_status",
    "created_at",
    "updated_at",
  ],
  issue_estimates: [
    "id",
    "github_issue_id",
    "version",
    "effort",
    "confidence",
    "suggested_workflow",
    "routed_model",
    "breakdown",
    "risk",
    "risk_note",
    "trace",
    "created_at",
  ],
  user_preferences: ["user_id", "font_scale", "created_at", "updated_at"],
  runs: [
    "id",
    "organization_id",
    "github_repo_id",
    "issue_number",
    "issue_title",
    "workflow_tag",
    "model",
    "status",
    "stage_label",
    "stage_index",
    "stage_total",
    "started_at",
    "finished_at",
    "pr_number",
    "checks_passed",
    "checks_total",
    "created_at",
    "updated_at",
  ],
  queue_items: [
    "id",
    "organization_id",
    "github_repo_id",
    "issue_number",
    "issue_title",
    "effort",
    "workflow_tag",
    "position",
    "est_minutes",
    "enqueued_at",
    "created_at",
    "updated_at",
  ],
  token_usage: [
    "id",
    "organization_id",
    "run_id",
    "provider",
    "model",
    "tokens_in",
    "tokens_out",
    "cost_cents",
    "occurred_at",
    "task_kind",
    "latency_ms",
    "created_at",
  ],
  workspace_settings: [
    "organization_id",
    "auto_merge_on_checks",
    "updated_by",
    "created_at",
    "updated_at",
  ],
  tenant_keys: [
    "organization_id",
    "version",
    "sealed_dek",
    "wrapper",
    "status",
    "rotated_at",
    "created_at",
    "updated_at",
  ],
  model_prices: [
    "id",
    "organization_id",
    "match_provider_kind",
    "match_model",
    "billing_mode",
    "input_cents_per_1m",
    "output_cents_per_1m",
    "source",
    "catalog_version",
    "meta",
    "effective_at",
    "created_at",
    "updated_at",
  ],
  provider_connections: [
    "id",
    "organization_id",
    "kind",
    "display_name",
    "base_url",
    "credentials_encrypted",
    "status",
    "last_checked_at",
    "health",
    "monthly_cap_cents",
    "added_by",
    "last_used_at",
    "capability_note",
    "enabled",
    "created_at",
    "updated_at",
  ],
  model_aliases: [
    "id",
    "organization_id",
    "alias",
    "provider_connection_id",
    "model_id",
    "enabled",
    "params",
    "restrictions",
    "notes",
    "updated_by",
    "created_at",
    "updated_at",
  ],
  provider_models: [
    "id",
    "provider_connection_id",
    "model_id",
    "display",
    "size_bytes",
    "meta",
    "discovered_at",
  ],
  task_kinds: [
    "id",
    "organization_id",
    "name",
    "description",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  routes: [
    "id",
    "organization_id",
    "task_kind_id",
    "tag",
    "allow_local_fallback",
    "floor_hop_index",
    "max_cost_cents_per_run",
    "updated_by",
    "created_at",
    "updated_at",
  ],
  route_hops: [
    "id",
    "organization_id",
    "route_id",
    "position",
    "model_alias_id",
    "note",
    "created_at",
    "updated_at",
  ],
  escalation_rules: [
    "id",
    "organization_id",
    "enabled",
    "sort_order",
    "when",
    "then",
    "display",
    "created_at",
    "updated_at",
  ],
  route_revisions: ["id", "organization_id", "actor", "diff", "created_at"],
  alias_revisions: [
    "id",
    "organization_id",
    "alias_id",
    "alias",
    "actor",
    "action",
    "diff",
    "created_at",
  ],
  audit_events: [
    "id",
    "organization_id",
    "actor_id",
    "action",
    "subject_type",
    "subject_id",
    "ip",
    "detail",
    "occurred_at",
  ],
  workflows: [
    "id",
    "organization_id",
    "slug",
    "name",
    "status",
    "current_version",
    "created_at",
    "updated_at",
  ],
  workflow_versions: [
    "id",
    "workflow_id",
    "version",
    "definition",
    "published_at",
    "published_by",
    "change_note",
    "created_at",
    "updated_at",
  ],
  ticket_sources: [
    "id",
    "organization_id",
    "kind",
    "display_name",
    "config",
    "credentials_encrypted",
    "status",
    "sync_cursor",
    "synced_at",
    "created_at",
    "updated_at",
    "status_reason",
  ],
  tickets: [
    "id",
    "organization_id",
    "source_id",
    "external_id",
    "external_key",
    "external_url",
    "title",
    "body",
    "state",
    "labels",
    "author",
    "source_created_at",
    "source_updated_at",
    "synced_at",
    "sizing_status",
    "meta",
    "created_at",
    "updated_at",
  ],
  ticket_sources_public: [
    "id",
    "organization_id",
    "kind",
    "display_name",
    "config",
    "status",
    "sync_cursor",
    "synced_at",
    "created_at",
    "updated_at",
    "status_reason",
  ],
  token_usage_daily: [
    "organization_id",
    "day",
    "provider",
    "events",
    "unpriced_events",
    "tokens_in",
    "tokens_out",
    "tokens_total",
    "cost_cents",
  ],
  workspace_settings_effective: [
    "organization_id",
    "auto_merge_on_checks",
    "is_explicit",
    "updated_at",
    "updated_by",
  ],
  alias_references: [
    "organization_id",
    "alias_id",
    "alias",
    "kind",
    "ref_id",
    "ref_label",
    "blocking",
  ],
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

/** A row of `ouroboros.github_credentials`, as a `select` returns it. */
export type GithubCredentials = Selectable<GithubCredentialsTable>;
/** The columns an `insert` into `ouroboros.github_credentials` may carry. */
export type NewGithubCredentials = Insertable<GithubCredentialsTable>;

/** A row of `ouroboros.github_issues`, as a `select` returns it. */
export type GithubIssue = Selectable<GithubIssuesTable>;
/** The columns an `insert` into `ouroboros.github_issues` may carry. */
export type NewGithubIssue = Insertable<GithubIssuesTable>;

/** A row of `ouroboros.issue_estimates`, as a `select` returns it — one version of an estimate. */
export type IssueEstimate = Selectable<IssueEstimatesTable>;
/**
 * The columns an `insert` into `ouroboros.issue_estimates` may carry.
 *
 * There is no `Updateable` counterpart, and it is not merely a convention this service keeps:
 * `issue_estimates_no_update` refuses a revision in the database, for every role. Decision
 * **K4** — re-estimation is the next row, never an edit — and the absence of the type is the
 * compiler's half of the same rule.
 */
export type NewIssueEstimate = Insertable<IssueEstimatesTable>;

/** A row of `ouroboros.user_preferences`, as a `select` returns it. */
export type UserPreferences = Selectable<UserPreferencesTable>;
/** The columns an `insert` into `ouroboros.user_preferences` may carry. */
export type NewUserPreferences = Insertable<UserPreferencesTable>;

/** A row of `ouroboros.runs`, as a `select` returns it. */
export type Run = Selectable<RunsTable>;
/** The columns an `insert` into `ouroboros.runs` may carry. */
export type NewRun = Insertable<RunsTable>;

/** A row of `ouroboros.queue_items`, as a `select` returns it. */
export type QueueItem = Selectable<QueueItemsTable>;
/** The columns an `insert` into `ouroboros.queue_items` may carry. */
export type NewQueueItem = Insertable<QueueItemsTable>;

/** A row of `ouroboros.token_usage`, as a `select` returns it. */
export type TokenUsage = Selectable<TokenUsageTable>;
/** The columns an `insert` into `ouroboros.token_usage` may carry. */
export type NewTokenUsage = Insertable<TokenUsageTable>;

/** A row of `ouroboros.workspace_settings`, as a `select` returns it. */
export type WorkspaceSettings = Selectable<WorkspaceSettingsTable>;
/** The columns an `insert` into `ouroboros.workspace_settings` may carry. */
export type NewWorkspaceSettings = Insertable<WorkspaceSettingsTable>;

/** A row of `ouroboros.tenant_keys`, as a `select` returns it — sealed, never key material. */
export type TenantKey = Selectable<TenantKeysTable>;
/** The columns an `insert` into `ouroboros.tenant_keys` may carry. */
export type NewTenantKey = Insertable<TenantKeysTable>;

/**
 * A row of `ouroboros.model_prices`, as a `select` returns it — one claim about what a model
 * costs, with the provenance that makes it quotable.
 */
export type ModelPrice = Selectable<ModelPricesTable>;
/**
 * The columns an `insert` into `ouroboros.model_prices` may carry.
 *
 * **This service inserts overrides and nothing else.** Bundled rows are the import function's
 * — `ouroboros.import_model_price_catalog()`, called by a repeatable migration — and a row
 * written from here always carries `organization_id` and `source: "override"`, which V012's
 * coherence CHECK requires to agree.
 */
export type NewModelPrice = Insertable<ModelPricesTable>;

/**
 * A row of `ouroboros.provider_connections`, as a `select` returns it.
 *
 * **Includes `credentials_encrypted`**, which is why almost nothing selects a whole row: the
 * repository names its columns, and the one place that asks for the sealed value is the
 * vault's re-encryption store. See {@link ProviderConnectionsTable}.
 */
export type ProviderConnection = Selectable<ProviderConnectionsTable>;
/**
 * The columns an `insert` into `ouroboros.provider_connections` may carry.
 *
 * Declared for completeness rather than for a caller: creating a connection is mockup 07's
 * surface (decision **M2**) and this service has none. The type exists so that when 07
 * writes one, the mirror is already the thing it type-checks against.
 */
export type NewProviderConnection = Insertable<ProviderConnectionsTable>;

/** A row of `ouroboros.model_aliases`, as a `select` returns it. */
export type ModelAlias = Selectable<ModelAliasesTable>;
/**
 * The columns an `insert` into `ouroboros.model_aliases` may carry.
 *
 * Declared for the same reason {@link NewProviderConnection} is: creating an alias is mockup
 * 21's surface, not this service's.
 */
export type NewModelAlias = Insertable<ModelAliasesTable>;

/**
 * A row of `ouroboros.provider_models`, as a `select` returns it — one model a connection has.
 */
export type ProviderModel = Selectable<ProviderModelsTable>;

/**
 * The columns an `insert` into `ouroboros.provider_models` may carry.
 *
 * Declared by AE.4 ([#230](https://github.com/NobuData/ouroboros/issues/230)), the ticket that
 * made discovery a writer here: `provider-connections/provider-models.repository.ts` is V017's
 * `insert … on conflict`, and this is its shape. Until then the type was deliberately absent —
 * declaring an insert shape for a write this service did not perform would have been claiming
 * one.
 */
export type NewProviderModel = Insertable<ProviderModelsTable>;

/**
 * A row of `ouroboros.task_kinds`, as a `select` returns it — one row of the routing matrix.
 *
 * There is deliberately no `NewTaskKind`, and it is the one of the four that still has none.
 * Z.2 ([#195](https://github.com/NobuData/ouroboros/issues/195)) is the write surface decision
 * **M2** was holding V016's and V018's tables for, and it writes routes, hops and rules — so
 * those three have their insert shapes below. It does **not** create task kinds: the matrix's
 * eight rows are seeded (Y.4, [#192](https://github.com/NobuData/ouroboros/issues/192)) and
 * adding a ninth is a surface nobody has asked for yet. Declaring the shape now would be this
 * service claiming a write it does not perform.
 */
export type TaskKind = Selectable<TaskKindsTable>;

/** A row of `ouroboros.routes`, as a `select` returns it — a chain's owner and its policy triple. */
export type Route = Selectable<RoutesTable>;
/** The columns an `insert` into `ouroboros.routes` may carry. */
export type NewRoute = Insertable<RoutesTable>;

/** A row of `ouroboros.route_hops`, as a `select` returns it — one numbered hop of a chain. */
export type RouteHop = Selectable<RouteHopsTable>;
/**
 * The columns an `insert` into `ouroboros.route_hops` may carry.
 *
 * A chain is rewritten rather than patched — the hops are deleted and re-inserted inside one
 * transaction — so this is the shape the *whole* new chain is written in. V016's deferred
 * `route_chain_intact()` is what makes that legal; see `routing/management.repository.ts`.
 */
export type NewRouteHop = Insertable<RouteHopsTable>;

/** A row of `ouroboros.escalation_rules`, as a `select` returns it — one card line, structured. */
export type EscalationRule = Selectable<EscalationRulesTable>;
/**
 * The columns an `insert` into `ouroboros.escalation_rules` may carry.
 *
 * `display` is absent from it without anything here saying so: the column is
 * `generated always … stored`, so {@link EscalationRulesTable.display}'s `ColumnType<string,
 * never, never>` makes supplying one a compile error — which is decision **M5**'s
 * *"hand-written display text is rejected on write"* arriving one layer earlier than
 * PostgreSQL's own refusal.
 */
export type NewEscalationRule = Insertable<EscalationRulesTable>;

/** A row of `ouroboros.route_revisions`, as a `select` returns it — one press of **Save routes**. */
export type RouteRevision = Selectable<RouteRevisionsTable>;
/**
 * The columns an `insert` into `ouroboros.route_revisions` may carry.
 *
 * There is no `Updateable` counterpart anywhere for this table, and that is the mirror of
 * V021's own decision: a revision is an event, and nothing in this service updates one.
 */
export type NewRouteRevision = Insertable<RouteRevisionsTable>;

/** A row of `ouroboros.alias_revisions`, as a `select` returns it — one registry write. */
export type AliasRevision = Selectable<AliasRevisionsTable>;

/**
 * The columns an `insert` into `ouroboros.alias_revisions` may carry.
 *
 * No `Updateable` counterpart, for {@link NewRouteRevision}'s reason: a revision is an event,
 * and nothing in this service updates one.
 */
export type NewAliasRevision = Insertable<AliasRevisionsTable>;

/** A row of `ouroboros.alias_references`, as a `select` returns it — one reference to an alias. */
export type AliasReference = Selectable<AliasReferencesView>;

/** A row of `ouroboros.audit_events`, as a `select` returns it — one thing that happened. */
export type AuditEvent = Selectable<AuditEventsTable>;
/**
 * The columns an `insert` into `ouroboros.audit_events` may carry.
 *
 * There is no `Updateable` counterpart, and here that is not merely a convention this
 * service keeps: `audit_events_no_update` refuses a revision in the database, for every role
 * including the owner. The absence of the type is the compiler's half of the same rule.
 */
export type NewAuditEvent = Insertable<AuditEventsTable>;

/** A row of `ouroboros.workflows`, as a `select` returns it — one rail entry's entity. */
export type Workflow = Selectable<WorkflowsTable>;
/**
 * The columns an `insert` into `ouroboros.workflows` may carry.
 *
 * Declared although nothing in this service writes one yet: P.3
 * ([#134](https://github.com/NobuData/ouroboros/issues/134)) is the create, and the shape it
 * will insert is decided by V029 rather than by that ticket. P.4's own suites use it — a
 * fixture that arranges a rail through the mirror is a fixture the drift check covers.
 */
export type NewWorkflow = Insertable<WorkflowsTable>;

/** A row of `ouroboros.workflow_versions`, as a `select` returns it — one version, or the draft. */
export type WorkflowVersion = Selectable<WorkflowVersionsTable>;
/**
 * The columns an `insert` into `ouroboros.workflow_versions` may carry.
 *
 * There is no `Updateable` counterpart, and — as with {@link NewAuditEvent} — that is not a
 * convention this service keeps but decision **P1** in the database:
 * `workflow_versions_no_update` refuses an edit to a published row for every role. The draft
 * is the mutable row, and the update path that promotes it is P.3's to write against the one
 * exception that trigger carries.
 */
export type NewWorkflowVersion = Insertable<WorkflowVersionsTable>;

/**
 * A row of `ouroboros.ticket_sources`, as a `select` returns it — **including the sealed
 * credential**, which is why almost nothing uses this type.
 *
 * The shape a read path wants is {@link TicketSourcePublic}. This one exists for the single
 * statement that opens a credential and for the writes, which have to name a table.
 */
export type TicketSource = Selectable<TicketSourcesTable>;
/** The columns an `insert` into `ouroboros.ticket_sources` may carry. */
export type NewTicketSource = Insertable<TicketSourcesTable>;

/**
 * A row of `ouroboros.ticket_sources_public`, as a `select` returns it — a source with no
 * credential on it at all.
 *
 * No `New…` counterpart, for the reason {@link TokenUsageDaily} gives and with more force:
 * see {@link READ_ONLY_VIEWS} on why PostgreSQL would not refuse the write itself.
 */
export type TicketSourcePublic = Selectable<TicketSourcesPublicView>;

/** A row of `ouroboros.tickets`, as a `select` returns it — one canonical ticket. */
export type Ticket = Selectable<TicketsTable>;
/**
 * The columns an `insert` into `ouroboros.tickets` may carry.
 *
 * What Q.2's sync loop writes ([#139](https://github.com/NobuData/ouroboros/issues/139)), from
 * what a provider's `mapTicket` returned. `sizing_status` is deliberately absent from every
 * statement that builds one: a freshly ingested ticket is `unsized` by the column's default,
 * and a sync that set it would be claiming an estimate that does not exist.
 */
export type NewTicket = Insertable<TicketsTable>;

/**
 * A row of `ouroboros.token_usage_daily`, as a `select` returns it.
 *
 * There is deliberately no `NewTokenUsageDaily`: it is a view — see {@link READ_ONLY_VIEWS} —
 * and the table an event is written to is `token_usage`.
 */
export type TokenUsageDaily = Selectable<TokenUsageDailyView>;

/**
 * A row of `ouroboros.workspace_settings_effective`, as a `select` returns it.
 *
 * No `New…` counterpart, for the reason {@link TokenUsageDaily} gives: write
 * `workspace_settings`.
 */
export type WorkspaceSettingsEffective = Selectable<WorkspaceSettingsEffectiveView>;
