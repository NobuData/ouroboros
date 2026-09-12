-- V030__canonical_tickets.sql — `ticket_sources` and `tickets`: the source-agnostic intake
-- read-model, in which a Jira ticket and a GitHub issue are the same kind of thing.
--
-- The first migration of the **sources** domain (docs/ROADMAP_MOCKUP_04_WORKFLOW_BUILDER.md),
-- filed as Q.1 (#138) under epic #128. It is decision **P6** made structural, and the reason
-- the studio's trigger node reads **`Issue queued`** rather than *GitHub issue queued*:
-- ingestion sources are pluggable from day one (decision **P5**), so the model intake reads
-- must be the one every tracker can be mapped into rather than the one GitHub happens to
-- return.
--
-- Nothing writes it yet. Q.2 (#139) is the `TicketSourceProvider` SPI and the registry the
-- sync loop iterates, Q.3 (#140) is the GitHub provider that maps into these columns, Q.4
-- (#141) the source-management API and settings surface, and R.1 (#143) the trigger
-- evaluation that matches a queued ticket to a workflow. As with every read-model table
-- before it — `V029` said this a migration ago — that is exactly why each rule a reader
-- depends on is a constraint here rather than an application invariant: the writers do not
-- exist to be trusted yet.
--
-- ---------------------------------------------------------------------------
-- What the issue says, what the repository says, and which one this file follows.
-- ---------------------------------------------------------------------------
--
-- #138 was filed on 2026-08-09 recording that intake epic K was *"filed but unbuilt"*, and
-- concluded from that this migration **replaces** #99. That was true when it was written and
-- is not true now: `V014` landed `github_issues`, `V026` `issue_estimates`, `V027` the
-- workspace's GitHub credential and `V028` the bot-author widening, and the `backlog`,
-- `backlog-sync` and `estimation` modules in `ouroboros-rest` read all four. The roadmap
-- records the correction itself — *"Overtaken by events, 2026-09-08 … Q.1 generalizes a
-- shipped table rather than replacing an unwritten one"* — and the issue's own Solution/Scope
-- anticipated both cases: *"if that epic is unbuilt, this replaces it; if built, this is its
-- generalizing migration"*.
--
-- So this is the generalizing migration, and it generalizes **additively**:
--
--   * The two tables below are created with every constraint, index and vocabulary the
--     canonical model needs, and `tests/constraints.sql` proves each acceptance criterion
--     against a live PostgreSQL.
--   * `github_issues` is left exactly as it was found. No row is copied, no foreign key is
--     re-pointed, no column is renamed, and nothing outside this module changes.
--
-- **Why the cut-over is not here.** Moving intake onto these tables means changing the thing
-- that *writes* it — the sync — and that is Q.2 and Q.3 by the roadmap's own division of
-- labour. A migration that copied nine rows into `tickets` while the shipped sync kept
-- writing `github_issues` would not deliver the canonical model; it would deliver two
-- records of the same backlog, diverging from the first poll, with no rule for which one
-- wins. That is the failure `V014`'s own header warns about in the small ("a title is
-- re-read from GitHub and overwritten here; it is never authored here") and it is worse at
-- table scale. An empty table with the right shape is honest about what has happened so
-- far. A populated table with no writer is not.
--
-- What Q.3 therefore inherits, and what this file has deliberately made cheap: the row
-- shapes match one-for-one, `sizing_status` keeps `V014`'s vocabulary and default verbatim
-- so the estimation pipeline needs no change, and the mapping from a `github_issues` row is
-- written out in the column comments below.
--
-- ---------------------------------------------------------------------------
-- Decision P6 — the canonical model, and the four columns that stop being columns.
-- ---------------------------------------------------------------------------
--
-- `V014` is GitHub-shaped in four specific ways, and each one becomes a special case the
-- moment a second provider arrives:
--
--   | `github_issues`                | why it does not generalize                        |
--   |--------------------------------|---------------------------------------------------|
--   | `github_repo_id` (a FK)        | a Jira ticket has no repository at all            |
--   | `number integer`               | `PROJ-142` is not a number; a Linear id is a uuid |
--   | `gh_created_at`/`gh_updated_at`| the prefix names one provider                     |
--   | `gh_url`                       | so does that one                                  |
--
-- The canonical answers are `external_id` (identity, unique within its source),
-- `external_key` (the display form a surface renders), `external_url`,
-- `source_created_at`/`source_updated_at`, and `meta` for whatever else a provider needs to
-- carry. The repository linkage does not disappear — it moves into the source's `config` and
-- the ticket's `meta`, where it stays queryable for GitHub-kind sources without being a
-- column every other provider has to pretend to have.
--
-- **The split between `external_id` and `external_key` is the load-bearing part**, and it is
-- worth stating because one column looks sufficient. They differ for every provider that is
-- not GitHub: Linear identifies an issue by a uuid and *shows* `ENG-123`, so a single column
-- would have to be either the thing the API takes or the thing a person reads, and whichever
-- was chosen the other would be reconstructed by guesswork. GitHub is the case that hides
-- this — `485` and `#485` differ by one character — which is exactly why a model derived
-- from GitHub alone would not have had the second column.
--
-- ---------------------------------------------------------------------------
-- Decision — `external_id` is text, which costs the backlog's `number` sort. That is paid
-- here rather than left to be discovered.
-- ---------------------------------------------------------------------------
--
-- The backlog listing offers four orderings (`ouroboros-rest/src/modules/backlog`,
-- `listing.repository.ts`), and one of them is `github_issues.number desc`. Over a text
-- `external_id` that ordering is lexicographic — `'9'` sorts above `'485'`, and a Linear
-- uuid has no meaningful order at all — so it cannot simply be re-pointed at this column.
--
-- The resolution is that the sort's *meaning* survives even though its column does not: what
-- a reader wants from *"sort by number, descending"* is **most recently opened first**, and
-- a GitHub issue number is a monotonic counter that happens to encode exactly that. The
-- source-neutral spelling is therefore `source_created_at desc`, which is true of every
-- provider rather than of the one whose identifier is an integer. `tests/constraints.sql`
-- asserts it over a backlog holding GitHub and Jira rows at once, where the two orderings
-- genuinely differ.
--
-- The alternative that was not taken: an `external_number integer` column beside the text
-- one, nullable for providers without one. It is `number` under a new name — the special
-- case this migration exists to remove — and a sort that silently reorders itself depending
-- on which provider a workspace happens to use is worse than one that is defined for all of
-- them.
--
-- ---------------------------------------------------------------------------
-- Decision — `credentials_encrypted` is `text`, not the ER diagram's `bytea`, and it is
-- envelope-only.
-- ---------------------------------------------------------------------------
--
-- Not a new decision: `V015` met the same ER diagram discrepancy on
-- `provider_connections.credentials_encrypted` and wrote the argument out, and `V027`
-- followed it for the GitHub token. `VaultService.encryptText`
-- (`ouroboros-rest/src/modules/vault/`, AD.1 #222) does not produce bytes — it produces the
-- five-field envelope `ouro.v1.<key version>.<base64url nonce>.<base64url ciphertext‖tag>`,
-- and the key version in the middle field is what makes rotation additive: a value sealed
-- under version 3 stays readable after version 4 becomes active because the value itself
-- says which key opens it. A `bytea` column would mean decoding that framing on write and
-- re-encoding it on read — a second encoding of a value nothing reads as bytes, and a second
-- place the version could be lost.
--
-- **`ticket_sources_credentials_sealed` is the part that matters.** It refuses any value
-- that is not one of those envelopes, so a plaintext token pasted into this column by a
-- migration, a fixture or a hand-written `update` is rejected by the server rather than
-- stored. That is a stronger guarantee than *"the service always encrypts"*: the service is
-- one writer, and this is every writer. It also means #222's adoption sweep has nothing to
-- do on this table, because a row holding an unsealed secret cannot exist — which is what
-- the amendment comment on #138 means by *"the storage columns are unchanged"*.
--
-- Nullable, and legitimately so, for `V015`'s reason one domain over: a source exists before
-- anybody has finished configuring it. Q.4's settings screen adds the source, then the
-- credential, and a `not null` column would make the first of those two steps impossible.
--
-- ---------------------------------------------------------------------------
-- Decision — the secret is kept out of read paths by a view, not by a convention.
-- ---------------------------------------------------------------------------
--
-- The acceptance criterion is that `credentials_encrypted` *"is never selected by read
-- paths"*. A comment asking readers not to select a column is not a mechanism, and `select
-- *` is one autocomplete away from breaking it — so `ticket_sources_public` below is every
-- column except that one, and a read path selects the view. The secret is then not
-- forgotten, it is **absent**: there is nothing to leak through a listing, a join or a debug
-- dump, and only the one code path that needs to decrypt names the table.
--
-- `tests/constraints.sql` asserts the view's column list over `information_schema`, so a
-- later migration that widens it back fails the build rather than quietly re-exposing the
-- column.
--
-- ---------------------------------------------------------------------------
-- What this migration deliberately does **not** add.
-- ---------------------------------------------------------------------------
--
--   * **No `status_reason`.** Q.2's criterion is that provider errors map to source status
--     *"with honest UI-facing reasons"*, and a reason has to be stored somewhere. It is not
--     in this issue's column list, so it is not invented here — the ticket that writes that
--     read is the ticket that adds the column, which is the rule `V014` followed when it
--     left `sizing_status` unindexed.
--   * **No foreign key from `tickets` to `github_repos`**, for any kind of source. That is
--     the whole point: see decision P6 above.
--   * **No `organization_id` on a ticket's estimate, queue item or run.** Those tables are
--     untouched by this migration; see the additive section at the top.
--   * **No vocabulary for `meta` or `config`.** Both are checked to be objects and no
--     further. A provider's specifics are the provider's, and Q.2's SPI is where a shape is
--     agreed per kind — a grammar written here would be GitHub's grammar under a neutral
--     name, which is the mistake this file is undoing.
--
-- Filed as issue #138 (Q.1). Needs #19 (Flyway scaffold). Written by Q.2's sync loop (#139)
-- and Q.3's GitHub provider (#140); read by Q.4's source management (#141), R.1's trigger
-- evaluation (#143) and the intake surfaces once Q.3 cuts them over. Asserted in
-- tests/constraints.sql; seeded by migrations/R__dev_seed_sources.sql.

-- ---------------------------------------------------------------------------
-- ticket_sources
--
-- One row per configured tracker per workspace: *where tickets come from*. The settings
-- surface Q.4 builds lists these, and Q.2's sync loop iterates the `active` ones.
-- ---------------------------------------------------------------------------
create table ouroboros.ticket_sources (
  id                    uuid        primary key default gen_random_uuid(),

  -- The workspace that configured this source, and the scope of every read of this table.
  -- Cascade, the posture of every extension table since `V006`: a deleted workspace must not
  -- leave behind a configuration pointing at a tracker nobody can reach any more — still
  -- less a sealed credential for it.
  organization_id       text        not null
                                    references ouroboros.organization ("id") on delete cascade,

  -- Which tracker this is, and the one column a provider is looked up by: Q.2's registry
  -- resolves a `TicketSourceProvider` from it. Text with a named CHECK rather than an enum,
  -- the house idiom (`V003`, `V007`, `V008`): a sixth tracker is an ordinary migration
  -- instead of enum surgery, which matters more here than anywhere else in the schema
  -- because Q.5's conformance kit exists to make adding one routine.
  --
  -- `custom` is in the set from the start rather than added when somebody needs it. It is
  -- what a community provider registers as, and leaving it out would mean the first such
  -- provider needed a migration before it could store a single row.
  kind                  text        not null,

  -- What the settings list calls this source — *"GitHub · acme-robotics"*, *"Jira · PROJ"*.
  -- The workspace's own words, so it is authored here rather than mirrored, which makes it
  -- the one column on this table nothing external owns.
  display_name          text        not null,

  -- How to reach the tracker, minus anything secret: a base URL for a self-hosted GitLab or
  -- a Jira site, the project keys to poll, the repository list for a GitHub-kind source.
  --
  -- Checked to be an object **and no further**, as `V029` bounds `workflow_versions
  -- .definition`. The per-kind shape is Q.2's to agree in the SPI and validate in
  -- `validateConfig`; a grammar spelled here would be GitHub's under a neutral name, and
  -- would have to be widened by migration every time a provider needed a field.
  --
  -- Defaulted to `{}` rather than nullable: a source with nothing configured yet is the
  -- common case on the way through Q.4's form, and an empty object is what every reader
  -- already handles without a `coalesce`.
  config                jsonb       not null default '{}'::jsonb,

  -- The sealed credential, or null while there is not one yet. See the decision above for
  -- why this is text, and why the CHECK is the part that matters.
  credentials_encrypted text,

  -- Whether the sync loop should pick this source up, and what the settings list renders as
  -- a dot. `active` is the working state, `paused` is a person's choice, and `error` is the
  -- sync's report — three states rather than a boolean precisely so a source that is failing
  -- cannot be confused with one somebody switched off.
  --
  -- Defaulted to `active`: a source somebody has just added is meant to be polled, and
  -- defaulting to `paused` would mean every source needed a second write to do anything.
  status                text        not null default 'active',

  -- The watermark the next incremental sync sends to the tracker — GitHub's `since`,
  -- GitLab's `updated_after`, a JQL `updated >=` bound, Linear's `updatedAt` filter.
  --
  -- Text and **opaque to this schema**, `V014`'s decision K2 generalized: it is a value the
  -- provider round-trips to its own API, and a database that parsed it would be a second
  -- implementation of somebody else's format with its own opinion about time zones. That
  -- argument only gets stronger with five providers. The one thing asserted is that it is
  -- not blank — a cursor of `''` is a poller that would silently re-import the entire
  -- backlog on every pass.
  --
  -- On `ticket_sources` rather than on `tickets`, which is the same shape `V014` chose when
  -- it put the watermark on `github_repos`: it is a property of *a source's sync*, one value
  -- per source updated once per poll, not a property of any ticket.
  sync_cursor           text,

  -- When the last successful sync of this source finished — the *"synced 40s ago"* tag's
  -- per-source counterpart. Nullable rather than defaulted, `V003`'s reason as `V014`
  -- restated it: `now()` would assert a sync that never happened, and the freshness tag
  -- would be a lie on a source that has never been polled.
  --
  -- Moved by a poll that found nothing changed, because *"we looked and nothing had
  -- changed"* is exactly what that tag claims.
  synced_at             timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- --- a workspace's sources are distinguishable ------------------------------
  --
  -- Two sources called *"GitHub"* in one workspace is a settings list nobody can read and a
  -- pair of rows nothing in a UI can tell apart. The rule `github_orgs.login` already
  -- carries per organization, one level up.
  --
  -- Deliberately not `(organization_id, kind)`: two GitHub sources in one workspace is a
  -- legitimate configuration — two enterprises, or a personal account beside an org — and a
  -- unique key on the kind would refuse it. What has to be unique is the name a person
  -- reads.
  constraint ticket_sources_organization_name_key
    unique (organization_id, display_name),

  -- --- the vocabularies are closed --------------------------------------------
  --
  -- Both are partitions something renders — the provider registry over one, the status dot
  -- over the other — so a value outside either set is a row that resolves to no provider and
  -- appears under no filter: invisible rather than wrong, which is worse.
  constraint ticket_sources_kind
    check (kind in ('github', 'gitlab', 'jira', 'linear', 'custom')),
  constraint ticket_sources_status
    check (status in ('active', 'paused', 'error')),

  -- A name says something, and is bounded where a rendered label stops being one.
  constraint ticket_sources_display_name_present
    check (btrim(display_name) <> '' and length(display_name) <= 128),

  -- --- the credential is sealed, always ---------------------------------------
  --
  -- `V015`'s constraint, verbatim, for `V015`'s reason. See the decision above.
  constraint ticket_sources_credentials_sealed
    check (credentials_encrypted is null
           or credentials_encrypted ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),

  -- --- config is an object ----------------------------------------------------
  --
  -- `jsonb` alone accepts `3`, `"github"` and `[]`, and a reader written against an object
  -- would break differently on each. An object is the only one of those a settings form can
  -- round-trip.
  constraint ticket_sources_config_shape
    check (jsonb_typeof(config) = 'object'),

  -- --- the cursor is something a sync produced --------------------------------
  --
  -- `V014`'s two rules on `github_repos.issues_sync_cursor`, carried over. The implication
  -- rather than the biconditional, for its reason: the other direction is legitimate — a
  -- first poll of a project with no tickets at all completes, stamps `synced_at`, and has no
  -- watermark to record.
  constraint ticket_sources_cursor_after_sync
    check (sync_cursor is null or synced_at is not null),
  constraint ticket_sources_sync_cursor_present
    check (sync_cursor is null
           or (btrim(sync_cursor) <> '' and length(sync_cursor) <= 255))
);

comment on table ouroboros.ticket_sources is
  'Where a workspace''s tickets come from — one row per configured tracker (#138, decision P6). Q.2''s registry resolves a provider from kind; Q.2''s sync loop iterates the active rows; Q.4 manages them. Never holds a credential in the clear: credentials_encrypted is envelope-only by CHECK, and read paths select ticket_sources_public, which does not carry the column at all.';
comment on column ouroboros.ticket_sources.organization_id is
  'Owning workspace. Every read of this table is scoped by it, and a deleted workspace takes its sources — and their sealed credentials — with it.';
comment on column ouroboros.ticket_sources.kind is
  'Which tracker: github | gitlab | jira | linear | custom. The key Q.2''s registry resolves a TicketSourceProvider by. custom is in the set from the start so a community provider needs no migration before it can store a row.';
comment on column ouroboros.ticket_sources.display_name is
  'What the settings list calls this source. The workspace''s own words — the one column here nothing external owns — and unique per workspace, because two sources with one name cannot be told apart by anything that renders them.';
comment on column ouroboros.ticket_sources.config is
  'Non-secret settings: base URL, project keys, repository list. An object and no further — the per-kind shape is Q.2''s SPI contract to agree and validateConfig''s to enforce, not this schema''s, because a grammar spelled here would be GitHub''s under a neutral name.';
comment on column ouroboros.ticket_sources.credentials_encrypted is
  'The sealed credential, or null while a source is configured but not yet credentialed (#138). Text rather than the ER diagram''s bytea, and envelope-only — V015''s decision and V027''s, for their reason: the vault''s envelope is text by construction and its middle field says which key opens the value. A plaintext token cannot be stored here by any writer.';
comment on column ouroboros.ticket_sources.status is
  'active | paused | error — the sync loop''s filter and the settings dot. Three states rather than a boolean, so a source that is failing is never confused with one somebody switched off.';
comment on column ouroboros.ticket_sources.sync_cursor is
  'The watermark the next incremental sync sends to the tracker (V014''s decision K2, generalized). Opaque to this schema — the provider owns its format, and five providers make that argument stronger, not weaker. Null until a poll has produced one.';
comment on column ouroboros.ticket_sources.synced_at is
  'When this source was last polled successfully — the source of the freshness tag. Null until the first sync; moved by a poll that found nothing changed, because that is what the tag claims.';
comment on constraint ticket_sources_credentials_sealed on ouroboros.ticket_sources is
  'The credential is one of the vault''s envelopes, always (#138) — V015''s posture, for its reason: this is a rule about every writer rather than about the one service that is supposed to encrypt. It is also why #222''s re-sealing sweep has nothing to do on this table, since a row holding an unsealed secret cannot exist.';
comment on constraint ticket_sources_organization_name_key on ouroboros.ticket_sources is
  'A workspace''s sources are distinguishable by the name a person reads. Deliberately not unique on kind: two GitHub sources in one workspace — two enterprises, or a personal account beside an org — is a legitimate configuration.';

create trigger ticket_sources_touch_updated_at
  before update on ouroboros.ticket_sources
  for each row execute function ouroboros.touch_updated_at();

comment on trigger ticket_sources_touch_updated_at on ouroboros.ticket_sources is
  'updated_at moves when the row does. Distinct from synced_at, which a poll moves even when it found nothing to change.';

-- ---------------------------------------------------------------------------
-- ticket_sources_public — every column except the secret.
--
-- The mechanism behind the *"never selected by read paths"* criterion. A read path selects
-- this; only the one code path that has to decrypt names the table. See the decision above
-- for why this is a view rather than a comment asking people to be careful.
--
-- Columns are listed rather than written as `select *` minus nothing: `select *` in a view
-- is frozen at creation time anyway, so the explicit list is the same thing said out loud —
-- and it puts the omission where a reader of this file can see it.
-- ---------------------------------------------------------------------------
create view ouroboros.ticket_sources_public as
  select id,
         organization_id,
         kind,
         display_name,
         config,
         status,
         sync_cursor,
         synced_at,
         created_at,
         updated_at
    from ouroboros.ticket_sources;

comment on view ouroboros.ticket_sources_public is
  'ticket_sources without credentials_encrypted (#138) — what every read path selects, so the sealed credential is absent rather than merely unselected. tests/constraints.sql asserts the column list, so a later migration that widens it back fails the build.';

-- ---------------------------------------------------------------------------
-- The source-belongs-to-the-organization rule.
--
-- `V009`'s `repo_in_organization()` and `V010`'s `run_in_organization()`, third shape of the
-- same guard: a table carrying both `organization_id` and a parent that carries its own.
-- Nothing about two separate foreign keys makes them agree, and a row naming one workspace
-- and another's source is not a broken join — it is a tenancy leak, one workspace's ticket
-- titles rendering on another's backlog.
--
-- Its own function rather than `run_in_organization()` reused, for the reason `V010` gave
-- when it declined to reuse `V009`'s: each reaches its parent through a different column, so
-- the shared thing is the argument and not the code. The error is raised the same way — class
-- 23 naming the trigger — so each table reports its own constraint name.
--
-- `new.source_id` is `not null` on the one table that uses this today, so the null branch
-- `run_in_organization()` needs is not written: there is no such thing here as a ticket with
-- no source. A later table with a nullable source would add it, and would be the migration
-- that owns the change.
-- ---------------------------------------------------------------------------
create function ouroboros.ticket_source_in_organization()
returns trigger language plpgsql as $$
declare
  owner text;
begin
  select s.organization_id into owner
    from ouroboros.ticket_sources s
   where s.id = new.source_id;

  -- Null means the source is gone between this statement and its own foreign key — which
  -- the FK itself will refuse a moment later. Saying nothing here leaves that error to the
  -- constraint that describes it properly.
  if owner is not null and owner is distinct from new.organization_id then
    raise exception
      '% row names source %, which belongs to organization % rather than %',
      tg_table_name, new.source_id, owner, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.ticket_source_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for any table carrying both organization_id and a source_id (#138): refuses a row whose source belongs to a different organization than the row does. The sibling of repo_in_organization() (#65) and run_in_organization() (#66) — same argument, different parent column. Raises class 23 naming the trigger, so each table reports its own constraint name.';

-- ---------------------------------------------------------------------------
-- tickets
--
-- The canonical intake row. Two parents, as `github_issues` has and for its reason: the
-- workspace the row is scoped to, and the source it was ingested from.
--
-- The mapping Q.3 will write, column for column, so it is recorded where both shapes can be
-- read together:
--
--   github_issues            tickets
--   ----------------------   --------------------------------------------------
--   number                   external_id       (as text)
--   —                        external_key      ('#' || number)
--   gh_url                   external_url
--   gh_created_at            source_created_at
--   gh_updated_at            source_updated_at
--   author_login             author
--   github_repo_id           meta -> 'github' -> 'repo_id'
--   title, body, state,      unchanged
--   labels, synced_at,
--   sizing_status
-- ---------------------------------------------------------------------------
create table ouroboros.tickets (
  id                uuid        primary key default gen_random_uuid(),

  -- The workspace this ticket belongs to, and the leading column of every read the backlog
  -- screen makes. Cascade, as on `github_issues`: a deleted workspace must not leave rows
  -- behind describing tickets in trackers nobody can reach any more.
  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,

  -- Where this ticket came from. Cascade rather than `set null`, `V014`'s argument for
  -- `github_repo_id` generalized: a ticket with no source cannot be rendered — nothing could
  -- say what `PROJ-142` even refers to — and a source that leaves scope should take its
  -- ingested rows with it rather than leave a cache of a tracker Ouroboros no longer polls.
  -- Held to the same workspace as `organization_id` by the trigger at the foot of this file.
  source_id         uuid        not null
                                references ouroboros.ticket_sources (id) on delete cascade,

  -- --- what the tracker owns --------------------------------------------------

  -- The tracker's own identity for this ticket, and the key a sync upserts on: `485` for a
  -- GitHub issue, `PROJ-142` for a Jira one, a uuid for a Linear one. Unique within its
  -- source and meaningless outside it — every tracker has a first ticket.
  --
  -- Text, which is what makes the three examples above one column rather than three. See the
  -- decision above for what that costs the `number` sort and how it is paid.
  external_id       text        not null,

  -- The display form: `#485`, `PROJ-142`, `ENG-123`. What a table cell, a panel heading and
  -- a search box's `#485` all render, and **not** derivable from `external_id` in general —
  -- a Linear ticket's key has no relationship to its uuid at all, so the provider supplies
  -- this rather than a renderer computing it.
  --
  -- Not unique, deliberately, and this is the one place that might surprise: two sources may
  -- hold the same key — the acceptance criterion is explicit that they must be able to — and
  -- `PROJ-142` in two Jira sites is two different tickets. Identity is `(source_id,
  -- external_id)`; this column is a label.
  external_key      text        not null,

  -- The ticket in its own tracker — the href behind the panel's *"Open ↗"*. Stored rather
  -- than composed, `V014`'s reason widened: GitHub Enterprise Server, a self-hosted GitLab
  -- and a Jira site all serve from hosts this schema cannot know, and every one of those
  -- APIs already returns the right URL.
  --
  -- `V014`'s https rule verbatim, and it is a safety rule rather than a tidiness one: an
  -- `href` is a place a scheme like `javascript:` or `data:` executes rather than navigates.
  -- Requiring `https://` and a host makes that unrepresentable in the column instead of
  -- something every renderer has to remember to check — and a provider is an HTTP client
  -- parsing somebody else's JSON, which is exactly the kind of writer that should not be
  -- trusted to have. The pattern's shape refuses userinfo tricks
  -- (`https://github.com@evil.example/…`) because `@` is not in the host class, and refuses
  -- a leading space because it is anchored.
  external_url      text        not null,

  -- The title, as the tracker currently has it. Overwritten by the next sync that sees it
  -- change — unlike `runs.issue_title` (`V008`), which is deliberately frozen at the moment
  -- a run started. The two columns look alike and mean opposite things.
  title             text        not null,

  -- The body, in full: a panel excerpts it and the estimator reads it whole, so truncating
  -- here would decide the excerpt length for every future reader and would have an estimator
  -- size the wrong problem.
  --
  -- Nullable, because trackers' are: a ticket opened with a title and no description has no
  -- body, and `''` would be this schema inventing a distinction the tracker does not make.
  body              text,

  -- `open` or `closed` — the filter bar's *State* select, and the one vocabulary every
  -- tracker in the set can be mapped onto. Jira's workflow states and Linear's are richer
  -- than two; collapsing them is the provider's job (`mapTicket`), because the alternative
  -- is a filter whose options change depending on which tracker a workspace happens to use.
  state             text        not null,

  -- The tracker's labels as a JSON array of names — `["bug", "i2c", "watchdog"]` — rendered
  -- as the tags under a title and as the filter bar's chip-set. The tracker's vocabulary, not
  -- ours: Ouroboros has its own word for the same ticket in `sizing_status` below, and mixing
  -- the two into one column would make a filter chip ambiguous about whose word it is
  -- showing.
  --
  -- An array of names rather than a table of label rows, `V014`'s argument and unchanged by
  -- generalizing: a label has no life of its own in this product, nothing joins to it, and
  -- the one read that exists is *"tickets carrying these labels"* — a containment query the
  -- GIN index below answers directly.
  --
  -- Validated by `V026`'s `jsonb_string_list_valid` rather than by `V014`'s open-coded
  -- jsonpath. `V014` predates the function and migration rule 1 forbids rewriting it; a new
  -- table has no such excuse. 100 names, and 255 characters each — GitHub caps labels per
  -- issue at 100 and Jira caps a label at 255, so the bounds are the loosest of the set
  -- rather than any one tracker's.
  labels            jsonb       not null default '[]'::jsonb,

  -- Who opened it — `by field-support` on the panel's meta line — in whatever form the
  -- tracker returns: a GitHub login, a Jira account id, a Linear display name.
  --
  -- **No login grammar**, and that is the point rather than an omission. `V014` checks
  -- GitHub's rule for a user login and `V028` widened it for `[bot]` suffixes; a
  -- GitHub-shaped pattern on a source-agnostic column is precisely the special case this
  -- migration exists to remove, and it would reject legitimate authors from three of the
  -- five kinds. Non-blank and bounded is all that generalizes.
  --
  -- Nullable, because trackers' are: a ticket whose author deleted their account comes back
  -- with no user at all, and the panel renders that as no attribution rather than as a name
  -- nobody holds.
  author            text,

  -- The tracker's own timestamps, under a `source_` prefix rather than `V014`'s `gh_` one,
  -- so the name says *the system this came from* instead of naming one of five.
  --
  -- Both `not null`: `source_updated_at` is where an incremental sync's watermark is drawn
  -- from, so a row without one could not participate in the sync at all, and
  -- `source_created_at` is what *"opened 2d ago"* counts from — and, per the decision above,
  -- the column the backlog's newest-first ordering is now defined over.
  source_created_at timestamptz not null,
  source_updated_at timestamptz not null,

  -- When this row was last confirmed against its source — the honesty a cache owes: one that
  -- cannot say how stale it is presents old data as current. Distinct from `updated_at`,
  -- which moves only when something in the row actually changed; a sync that re-read an
  -- unchanged ticket moves this and not that.
  synced_at         timestamptz not null default now(),

  -- --- what this product owns -------------------------------------------------

  -- Where the ticket is in *our* sizing pipeline: `unsized → estimating → sized |
  -- needs_human`. `V014`'s four values and `V014`'s default, **verbatim and deliberately
  -- so** — it is an acceptance criterion that this vocabulary does not change, because the
  -- estimation pipeline claims work by it and advances it, and a fifth value or a renamed
  -- one would be a change to `ouroboros-rest` disguised as a change to a schema.
  --
  -- Defaulted to `unsized`, which is what a freshly ingested ticket is: a sync writes
  -- tickets, not estimates, and a row arriving with any other value would be claiming an
  -- estimate that does not exist.
  sizing_status     text        not null default 'unsized',

  -- Everything a provider needs to carry that the canonical columns do not name: a GitHub
  -- repository, a Jira project, a Linear team.
  --
  -- **This is where `github_repo_id` went** (decision P6), and it stays queryable — the
  -- repository filter becomes `meta @> '{"github": {"repo_id": …}}'`, which the GIN index
  -- below serves as an index scan. What it stops being is a column every other provider has
  -- to hold null.
  --
  -- An object and no further, for `config`'s reason above: the per-kind shape is Q.2's SPI
  -- contract, and a grammar written here would be GitHub's under a neutral name.
  meta              jsonb       not null default '{}'::jsonb,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- --- one row per ticket per source ------------------------------------------
  --
  -- The first acceptance criterion, and the key a provider's sync upserts on. `(source_id,
  -- external_id)` rather than anything involving the workspace: an identifier is unique
  -- within the tracker that issued it and nowhere else, so two sources may each hold
  -- `PROJ-142` and they are two different tickets.
  --
  -- Its leading column also serves the cascade — `ticket_sources` cascades into this table,
  -- and an unindexed referencing column makes every source deletion a full scan — so no
  -- separate index on `source_id` is created. `V014`'s argument, and `V003`'s before it.
  constraint tickets_source_external_id_key unique (source_id, external_id),

  -- --- the vocabularies are closed --------------------------------------------
  --
  -- Both are partitions something renders — the *State* select over one, the status pill and
  -- the page head's sized count over the other — so a value outside either set is a row that
  -- appears under no filter and in no count: invisible rather than wrong.
  constraint tickets_state
    check (state in ('open', 'closed')),
  constraint tickets_sizing_status
    check (sizing_status in ('unsized', 'estimating', 'sized', 'needs_human')),

  -- --- the identifiers and strings the tracker gave us ------------------------
  --
  -- An identifier and a key both say something. 255 is Jira's bound on an issue key's
  -- project part and comfortably holds a uuid; the display form is shorter because it is a
  -- label in a table cell.
  constraint tickets_external_id_present
    check (btrim(external_id) <> '' and length(external_id) <= 255),
  constraint tickets_external_key_present
    check (btrim(external_key) <> '' and length(external_key) <= 128),

  -- A title says something, and is bounded at the 512 `runs` and `queue_items` bound theirs
  -- at — GitHub's own cap is 256 and Jira's 255, so the slack is there to make sure a mirror
  -- never refuses a title its tracker accepted.
  constraint tickets_title_present
    check (btrim(title) <> '' and length(title) <= 512),

  -- The body's bound is **not** `V014`'s. `V014` bounded it at *"what the thing being copied
  -- permits"* — GitHub's 64 KiB — and with an open provider set there is no such number:
  -- Jira allows 32 767 characters, Linear considerably more, and a `custom` provider is
  -- whatever somebody writes. So this is a storage-sanity bound rather than a tracker's
  -- rule, set well above every known limit, because the one thing it must never be is the
  -- reason a ticket a provider legitimately returned cannot be stored.
  constraint tickets_body_bounded
    check (body is null or length(body) <= 262144),

  -- Non-blank and bounded, and no grammar. See the column comment for why that is a
  -- decision.
  constraint tickets_author_present
    check (author is null or (btrim(author) <> '' and length(author) <= 255)),

  -- --- the URL is a link something will render --------------------------------
  --
  -- `V014`'s `github_issues_url_https`, verbatim. Not a check that the URL names *this*
  -- source or *this* identifier: the host belongs to the installation, the path shape to the
  -- tracker, and a mirror that refused a URL its own API returned would be broken by a
  -- rename it has no say in.
  constraint tickets_external_url_https
    check (external_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/'
           and length(external_url) <= 2048),

  -- --- the labels are a list of names, and meta is an object ------------------
  constraint tickets_labels_shape
    check (ouroboros.jsonb_string_list_valid(labels, 100, 255)),
  constraint tickets_meta_shape
    check (jsonb_typeof(meta) = 'object'),

  -- --- the mirrored timestamps agree with each other --------------------------
  --
  -- A ticket cannot have been updated before it was opened. No tracker produces that pair; a
  -- mapping bug that swapped two fields does, and it would render as a ticket `opened` after
  -- it was last touched — and would poison the watermark drawn from the column.
  constraint tickets_updated_after_created
    check (source_updated_at >= source_created_at)
);

comment on table ouroboros.tickets is
  'The canonical intake row (#138, decision P6) — one per ticket per source, whatever tracker it came from. Source-agnostic by construction: no repository, no issue number, no gh_ prefix. sizing_status is the one column this product owns, and it keeps V014''s vocabulary verbatim so the estimation pipeline needs no change. Written by Q.3''s provider (#140) through Q.2''s sync loop (#139); github_issues remains the shipped intake table until that cut-over.';
comment on column ouroboros.tickets.organization_id is
  'Owning workspace. Every backlog read is scoped by it, and it leads the filter index.';
comment on column ouroboros.tickets.source_id is
  'The source this was ingested from. Held to the same workspace as organization_id by the tickets_source_in_organization trigger, which is the composite foreign key ticket_sources cannot offer.';
comment on column ouroboros.tickets.external_id is
  'The tracker''s own identity — 485, PROJ-142, a Linear uuid. Unique within its source and meaningless outside it; the upsert key with source_id. Text, which is what makes those three one column.';
comment on column ouroboros.tickets.external_key is
  'The display form — #485, PROJ-142, ENG-123. Supplied by the provider rather than computed, because a Linear key has no relationship to the uuid that identifies it. Deliberately not unique: two sources may hold the same key, and the acceptance criterion requires it.';
comment on column ouroboros.tickets.external_url is
  'The ticket in its own tracker — the href behind "Open ↗". Constrained to https and a host, because an href is a place a scheme executes.';
comment on column ouroboros.tickets.title is
  'Title as the tracker currently has it — overwritten by every sync that sees it change, unlike runs.issue_title, which is frozen at the moment a run started.';
comment on column ouroboros.tickets.body is
  'Body in full — a panel excerpts it and the estimator reads it whole. Null when the tracker''s is. Bounded for storage sanity rather than at any one tracker''s limit, because the provider set is open.';
comment on column ouroboros.tickets.state is
  'open | closed — the filter bar''s State select, and the one state vocabulary every tracker can be mapped onto. Collapsing a richer workflow is the provider''s job, so the filter''s options do not change with the tracker.';
comment on column ouroboros.tickets.labels is
  'The tracker''s label names as a JSON array of strings — not Ouroboros'' vocabulary. Filtered by containment through tickets_labels_idx; validated by V026''s jsonb_string_list_valid.';
comment on column ouroboros.tickets.author is
  'Who opened it, in whatever form the tracker returns — a GitHub login, a Jira account id, a Linear display name. Deliberately carries no login grammar: V014''s GitHub pattern on this column would reject legitimate authors from three of the five kinds.';
comment on column ouroboros.tickets.source_created_at is
  'When the tracker says it was opened — what "opened 2d ago" counts from, and the column the backlog''s newest-first ordering is defined over now that identity is text (#138).';
comment on column ouroboros.tickets.source_updated_at is
  'The tracker''s last-updated time — the value an incremental sync''s cursor is drawn from, which is why it is not nullable.';
comment on column ouroboros.tickets.synced_at is
  'When this row was last confirmed against its source — moved by every sync, including one that found nothing changed. updated_at moves only when the row did.';
comment on column ouroboros.tickets.sizing_status is
  'Our sizing pipeline: unsized | estimating | sized | needs_human. V014''s four values and default, verbatim and as an acceptance criterion — the estimation pipeline claims work by this column, so a fifth value would be a change to ouroboros-rest disguised as a change to a schema.';
comment on column ouroboros.tickets.meta is
  'Provider specifics the canonical columns do not name — a GitHub repository, a Jira project, a Linear team. Where github_repo_id went (decision P6), and still queryable: the repository filter is a containment query served by tickets_meta_idx.';
comment on constraint tickets_source_external_id_key on ouroboros.tickets is
  'One row per ticket per source (#138) — the first acceptance criterion, and the key a sync upserts on. Two sources may each hold PROJ-142; they are two different tickets. Its leading column also serves ticket_sources'' cascade, which is why source_id has no index of its own.';
comment on constraint tickets_body_bounded on ouroboros.tickets is
  'A storage-sanity bound, not a tracker''s: with five kinds and a custom one there is no single body limit to copy, and this constraint must never be the reason a ticket a provider legitimately returned cannot be stored.';

-- ---------------------------------------------------------------------------
-- Indexes — the intake filter paths, carried over from `V014` and one added.
--
-- Acceptance criterion: the intake queries — filters, sorting and search — work unchanged
-- over the canonical model. Asserted in tests/constraints.sql against a migrated database,
-- which is the only place the planner can be asked.
--
-- `pg_trgm` is **not** installed here: `V014` installed it, and a second guarded
-- `create extension` would be a no-op that has to be kept in step with the first.
-- ---------------------------------------------------------------------------

-- The backlog list, and the filter bar's *Source* and *State* selects:
--
--   select … from ouroboros.tickets
--    where organization_id = $1 and source_id = $2 and state = 'open'
--
-- `V014`'s `(organization_id, github_repo_id, state)` with the source in the repository's
-- place, and for the same reasons: leading `organization_id` because no read here is global,
-- `source_id` next because the select is a single choice rather than a facet, `state` last
-- because it defaults to `open` and is the narrowest of the three. The prefix serves the
-- shorter reads too — a workspace's whole backlog, and the page head's counts over it — so
-- those get no index of their own.
create index tickets_organization_source_state_idx
  on ouroboros.tickets (organization_id, source_id, state);

-- The chip-set:
--
--   select … from ouroboros.tickets where labels @> '["bug"]'
--
-- `jsonb_ops`, the default, rather than the smaller `jsonb_path_ops`: `@>` is served by
-- both, while `?`, `?|` and `?&` are served only by this one, and those are the operators an
-- *any-of-these-labels* chip-set reaches for. `V014`'s choice, and its argument — the
-- narrower class saves index size and silently drops a read.
create index tickets_labels_idx
  on ouroboros.tickets using gin (labels);

-- The search box — *"Filter by title, key, or label…"*:
--
--   select … from ouroboros.tickets where title ilike '%watchdog%'
--
-- Trigrams, because a substring match has no prefix for a b-tree to start from. GIN rather
-- than GiST because this index is read far more often than it is written — a sync touches a
-- row when its tracker does, a person searches on every keystroke.
create index tickets_title_trgm_idx
  on ouroboros.tickets using gin (title gin_trgm_ops);

-- The *Repository* select, which is the one filter path decision P6 **moved**:
--
--   select … from ouroboros.tickets where meta @> '{"github": {"repo_id": "…"}}'
--
-- `V014` served it with a b-tree column in the composite index above. With the linkage in
-- `meta` it is a containment query, and without this index it is a sequential scan — so the
-- fourth index is what keeps *"intake queries work unchanged"* true rather than nearly true.
-- `jsonb_ops` again, and for a second reason here: a provider's `meta` is an open shape, so
-- the key-existence operators are exactly what a later per-kind filter will reach for.
create index tickets_meta_idx
  on ouroboros.tickets using gin (meta);

comment on index ouroboros.tickets_meta_idx is
  'The repository filter, after decision P6 moved the linkage out of a column and into meta (#138). Without it that filter is a sequential scan, which is the difference between the intake queries working unchanged and nearly doing so.';

-- Not indexed, deliberately: `sizing_status`, for `V014`'s reason — the reads that filter by
-- it are scoped by workspace first, so they enter through the composite index above, and a
-- column with four values and no independent read of its own would be an index the sync
-- maintains for nobody.
--
-- And no index for the orderings, also `V014`'s position: a sort over a workspace's backlog
-- reads rows the filter index already found, and the page sizes involved are small. The
-- ticket that measures a slow sort is the ticket that adds one.

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------

-- `updated_at` moves when the row does — which, for a mirror, is what separates a ticket its
-- tracker has changed from one merely re-read. See `synced_at`.
create trigger tickets_touch_updated_at
  before update on ouroboros.tickets
  for each row execute function ouroboros.touch_updated_at();

-- The source-belongs-to-the-organization rule. The trigger takes its constraint name from
-- itself, so a rejected write reports `tickets_source_in_organization`.
create trigger tickets_source_in_organization
  before insert or update of organization_id, source_id on ouroboros.tickets
  for each row execute function ouroboros.ticket_source_in_organization();

comment on trigger tickets_source_in_organization on ouroboros.tickets is
  'A ticket and its source belong to the same workspace (#138). Two separate foreign keys do not make each other agree, and a row naming one workspace and another''s source is a tenancy leak rather than a broken join.';
