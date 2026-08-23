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
 * `schema.spec.ts` holds this list to the two view interfaces above; `db.integration-spec.ts`
 * compares their columns against `information_schema` exactly as it does a table's, because a
 * view that lost a column breaks a query the same way a table that lost one does.
 */
export const READ_ONLY_VIEWS = ["token_usage_daily", "workspace_settings_effective"] as const;

/**
 * Every table `ouroboros-rest` may query, keyed by its name in the database.
 *
 * This is the type parameter the whole module is built around: `Kysely<Database>` is what
 * makes `selectFrom("organization").select("slug")` compile and `select("slugg")` not.
 *
 * **Two of the fourteen entries are views** rather than tables — see {@link READ_ONLY_VIEWS},
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
 * **Four tables are deliberately absent.** `tenants`, `tenant_members`, `users` and
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
  user_preferences: UserPreferencesTable;
  runs: RunsTable;
  queue_items: QueueItemsTable;
  token_usage: TokenUsageTable;
  workspace_settings: WorkspaceSettingsTable;
  tenant_keys: TenantKeysTable;
  model_prices: ModelPricesTable;
  token_usage_daily: TokenUsageDailyView;
  workspace_settings_effective: WorkspaceSettingsEffectiveView;
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
