-- V014__github_issue_cache.sql — `github_issues`, the local mirror of an enabled
-- repository's GitHub issues, and the per-repo sync cursor the poller writes.
--
-- The first table of the **intake** read-model (docs/ROADMAP_MOCKUP_03_ISSUE_INTAKE.md).
-- Mockup 03 (docs/mockups/03-issues.html) renders GitHub issues in two places, and
-- neither had anywhere to read them from:
--
--   * the backlog table's **Issue** cell — a mono `#485`, a title, and the issue's own
--     label tags underneath it,
--   * the detail panel's meta line — `#485 · opened 2d ago by field-support` — its
--     heading, its label row, and the body excerpt below them.
--
-- Scaffolding (#22, `V003`) records *which* repositories a workspace has enabled. It has
-- never recorded what is in them. This migration is that, and nothing more: the sizing
-- that fills the *Effort*, *Suggested workflow* and *Routed model* columns is K.2
-- (#100), and the service that fills these rows from GitHub is K.4 (#102).
--
-- ---------------------------------------------------------------------------
-- Decision K3 — **this is a cache. GitHub is the source of truth.**
-- ---------------------------------------------------------------------------
--
-- Of the columns below, exactly one is this product's: `sizing_status`. `number`, `title`,
-- `body`, `state`, `labels`, `author_login` and the three `gh_` columns are **copies of
-- something GitHub owns**; the rest are this schema's own plumbing — a surrogate key, two
-- parents and three timestamps. Nothing in this product edits issue content, ever. A title
-- is re-read from GitHub and overwritten here; it is never authored here. The panel's *"Open on GitHub ↗"* button is the escape hatch that
-- makes that posture honest — the moment somebody needs to *change* an issue, they leave.
--
-- This is written at the top of the file because it is the thing a later reader is most
-- likely to get wrong. A local table holding titles, bodies and labels looks exactly like
-- a table you could let a user edit, and the first `update` that sets a title from a form
-- turns the mirror into a fork: two records of the same issue, diverging, with no rule
-- for which one wins. The shape below is deliberately unhelpful to that: there is no
-- `edited_by`, no `local_title`, no dirty flag, and `synced_at` records that a row is a
-- copy taken at a moment rather than a document with a history.
--
-- What it does **not** mean: that the row is read-only. K.4's sync upserts these rows on
-- every poll, and K.2's estimator moves `sizing_status` through its four values. The rule
-- is about *authorship* — GitHub's columns are written only by a sync that read them from
-- GitHub, and the one column this product owns says so by not being one of them.
--
-- ---------------------------------------------------------------------------
-- Decision K2 — the sync cursor lives on `github_repos`, not here.
-- ---------------------------------------------------------------------------
--
-- Incremental polling asks GitHub for the issues in a repository updated `since` a
-- watermark. The watermark is therefore a property of *the repository's sync*, not of any
-- issue — one value per repo, updated once per poll — and putting it on `github_repos` is
-- what keeps it that. The two columns are added at the foot of this file.
--
-- The alternative that was not taken: deriving the watermark as `max(gh_updated_at)` over
-- the mirrored rows. It reads as free, and it is wrong in the case that matters — an
-- issue *deleted or transferred* on GitHub leaves the maximum where it was, and a repo
-- whose sync found nothing has no maximum at all, so a poller would re-import the whole
-- backlog every time. A stored cursor is a fact about what the poller did; a maximum is a
-- guess about what it saw.
--
-- ---------------------------------------------------------------------------
-- The one extension this schema takes, and why the V001 argument does not carry.
-- ---------------------------------------------------------------------------
--
-- `V001` bought case-insensitive domain lookup by *folding on write* rather than by
-- `citext`, and gave the reason: `create extension` needs rights a managed PostgreSQL
-- does not always grant the migration role. That argument holds for `citext` and does not
-- hold here, on both halves:
--
--   * **There is no fold that buys this.** The backlog's search box is documented as
--     *"Filter by title, #number, or label…"* and M.1 (#110) implements `q` as a
--     substring match. No stored form of a title makes `ilike '%watchdog%'` an index scan;
--     a b-tree on `lower(title)` serves a *prefix* and nothing else, and a search box that
--     silently only matched the beginning of a title would be a worse answer than a slow
--     one.
--   * **`pg_trgm` is a trusted extension.** Since PostgreSQL 13 it carries `trusted`, so
--     any role holding `create` on the database installs it — no superuser, and no
--     rights a managed provider withholds. Verified rather than assumed: a plain
--     `login` role with nothing but `grant create on database` installs it on the
--     `postgres:17-alpine` this repository pins.
--
-- Guarded with a catalogue lookup rather than `create extension if not exists`, which is
-- V000's idiom and for V000's reason: `if not exists` raises a NOTICE when the extension
-- is already there, and Flyway reports every NOTICE as a WARNING — so on a shared managed
-- instance, or a restore, where somebody has already installed it, every run of this
-- migration would print a warning about a condition that is entirely fine.
--
-- Filed as issue #99 (K.1).

-- ---------------------------------------------------------------------------
-- The trigram operator class the title index below is built with.
--
-- Unqualified deliberately: it lands in whatever schema is first in the migration
-- session's `search_path`, and the index's operator class is resolved from that same path
-- a few statements later. Naming a schema here would be a second place `OURO_DB_SCHEMA`
-- has to agree with — and would be silently ignored anyway on the databases where the
-- extension already exists, which is the case the guard is written for.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    execute 'create extension pg_trgm';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- github_issues
--
-- Two parents, as `runs` (V008) and `queue_items` (V009) have: the workspace the row is
-- scoped to, and the repository the issue lives in. Same reasoning, same rule — see the
-- trigger at the foot of this file.
-- ---------------------------------------------------------------------------
create table ouroboros.github_issues (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace this mirror belongs to, and the leading column of every read the
  -- backlog screen makes. Cascade for the reason V006 gave the extension tables one and
  -- V008 restated: a deleted workspace must not leave rows behind describing issues in
  -- repositories nobody can reach any more.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The repository the issue lives in. Cascade rather than `set null`: an issue with no
  -- repository cannot be rendered — the row's whole identity is `(repo, number)` — and a
  -- repository that leaves scope should take its mirror with it rather than leave a
  -- cache of a place Ouroboros may no longer look. Held to the same workspace as
  -- `organization_id` by the trigger below.
  github_repo_id   uuid        not null
                               references ouroboros.github_repos (id) on delete cascade,

  -- --- what GitHub owns (decision K3) ---------------------------------------

  -- The issue number as GitHub assigns it — the `485` the table renders as `#485`. Unique
  -- within the repository and meaningless outside it: every repo has a `#1`.
  number           integer     not null,

  -- The title, as GitHub currently has it. Overwritten by the next sync that sees it
  -- change, unlike `runs.issue_title` (V008), which is deliberately frozen at the moment
  -- a run started — a run is a record of work done, and this is a mirror of a live issue.
  -- The two columns look alike and mean opposite things.
  title            text        not null,

  -- The issue body. The panel excerpts it (`panel-body-excerpt`) and the estimator reads
  -- it whole, so it is stored in full rather than truncated here: truncating in the
  -- database would decide the excerpt length for every future reader, and an estimator
  -- reading a cut-off body would size the wrong problem.
  --
  -- Nullable, because GitHub's is: an issue opened with a title and no description has a
  -- null body, and `''` would be this schema inventing a distinction GitHub does not make.
  body             text,

  -- `open` or `closed` — GitHub's own two, and the filter bar's *State* select. Text with
  -- a named CHECK rather than an enum, the house idiom (V003, V007, V008): widening the
  -- set is an ordinary migration instead of enum surgery.
  state            text        not null,

  -- **GitHub's** labels, not ours — a JSON array of label names, `["bug", "i2c",
  -- "watchdog"]`, rendered as the tags under the issue title and as the filter bar's
  -- chip-set. Ouroboros has its own vocabulary for the same issue (`sizing_status` below,
  -- the estimate K.2 attaches); mixing the two into one column would make a filter chip
  -- ambiguous about whose word it is showing.
  --
  -- An array of names rather than a table of label rows, deliberately. A label has no
  -- life of its own in this product — nothing joins to it, nothing counts it across
  -- repositories, and the one read that exists is "issues carrying these labels", which
  -- is a containment query a GIN index answers directly. A join table would buy
  -- referential integrity over a set of values GitHub can rename underneath us anyway,
  -- and would make the sync's upsert a diff instead of an assignment.
  --
  -- Defaulted to `[]`, not null: "no labels" is the common case and an empty array is
  -- what renders as no tags, whereas null would make every reader write `coalesce`.
  labels           jsonb       not null default '[]'::jsonb,

  -- Who opened it — `by field-support` on the panel's meta line. GitHub's login, in the
  -- case GitHub returns it, and **not folded** the way V003 folds an org login: this is a
  -- mirrored value and folding it would be an edit, which K3 forbids. Nothing looks a
  -- row up by it, so nothing needs the fold that V003's unique key needed.
  --
  -- Nullable, because GitHub's author is: an issue whose author has deleted their account
  -- can come back with no user at all, and the panel renders that as no attribution rather
  -- than as a login nobody holds.
  author_login     text,

  -- GitHub's own timestamps, kept under a `gh_` prefix so no reader confuses them with
  -- this row's. `gh_created_at` is what `opened 2d ago` counts from. `gh_updated_at` is
  -- the value the `since` watermark is drawn from, which is why it is not nullable: a row
  -- with no update time could not participate in the incremental sync at all.
  gh_created_at    timestamptz not null,
  gh_updated_at    timestamptz not null,

  -- The issue's URL on GitHub — the href behind *"Open on GitHub ↗"*. Stored rather than
  -- composed from `owner/repo/number`, because GitHub Enterprise Server serves the same
  -- issue from another host and the API already returns the right one.
  gh_url           text        not null,

  -- When this row was last confirmed against GitHub — the *"synced 40s ago"* tag's
  -- per-issue counterpart, and the honesty K2 asks for: a cache that cannot say how stale
  -- it is presents old data as current. Distinct from `updated_at`, which moves only when
  -- something in the row actually changed; a sync that re-read an unchanged issue moves
  -- this and not that.
  synced_at        timestamptz not null default now(),

  -- --- what this product owns -----------------------------------------------

  -- Where the issue is in *our* sizing pipeline, which is decision K4's other half:
  -- `unsized → estimating → sized | needs_human`. The estimates themselves are versioned
  -- rows in K.2's `issue_estimates`; this column is the status the backlog table renders
  -- as a pill and the estimator claims work by.
  --
  -- Defaulted to `unsized`, which is what a freshly mirrored issue is: the sync writes
  -- issues, not estimates, and a row that arrived with any other value would be claiming
  -- an estimate that does not exist.
  sizing_status    text        not null default 'unsized',

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- --- one row per issue ------------------------------------------------------
  --
  -- Acceptance criterion, and the key the sync upserts on. `(github_repo_id, number)`
  -- rather than `(organization_id, number)`: a number is unique within a repository and
  -- nowhere else, and a workspace with two enabled repositories has two `#1`s.
  --
  -- Its leading column also serves the cascade — `github_repos` cascades into this table,
  -- and an unindexed referencing column makes every repository deletion a full scan — so
  -- no separate index on `github_repo_id` is created. Same argument V003 gave for not
  -- indexing `org_id`.
  constraint github_issues_repo_number_key unique (github_repo_id, number),

  -- --- the vocabularies are closed --------------------------------------------
  --
  -- Acceptance criterion: `sizing_status` rejects an unknown value, and its default is
  -- `unsized`. Both vocabularies are partitions something renders — the *State* filter
  -- over one, the status pill and the page head's *"38 already sized"* over the other —
  -- so a value outside either set is a row that appears under no filter and in no count:
  -- invisible rather than wrong, which is worse.
  constraint github_issues_state
    check (state in ('open', 'closed')),
  constraint github_issues_sizing_status
    check (sizing_status in ('unsized', 'estimating', 'sized', 'needs_human')),

  -- --- the numbers and strings GitHub gave us ---------------------------------
  --
  -- Issue numbers are positive counters; there is no `#0`.
  constraint github_issues_number_positive check (number >= 1),

  -- A title says something, and is bounded at the same 512 `runs` and `queue_items` bound
  -- theirs at — GitHub's own cap is 256, and the slack is there so a mirror never refuses
  -- a title GitHub accepted.
  constraint github_issues_title_present
    check (btrim(title) <> '' and length(title) <= 512),

  -- The body is bounded at GitHub's own limit rather than at a rendering surface's: this
  -- column is a copy, so the right bound is what the thing being copied permits. 64 KiB
  -- is what GitHub accepts in an issue body, and a value past it did not come from there.
  constraint github_issues_body_bounded
    check (body is null or length(body) <= 65536),

  -- GitHub's rule for a user login: alphanumerics and single hyphens, no leading or
  -- trailing hyphen, at most 39 characters — V003's `github_orgs_login_format` with the
  -- upper case left in, for the reason `author_login` gives above. Checked here so a path
  -- that never reached GitHub cannot store an attribution GitHub could not have issued.
  constraint github_issues_author_login_format
    check (author_login is null
           or (author_login ~ '^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$'
               and length(author_login) between 1 and 39)),

  -- --- the URL is a link something will render --------------------------------
  --
  -- This one is a safety rule, not a tidiness rule. `gh_url` becomes the `href` of the
  -- panel's *"Open on GitHub ↗"* button, and an `href` is a place a scheme like
  -- `javascript:` or `data:` executes rather than navigates. Requiring `https://` and a
  -- host makes that unrepresentable in the column rather than something every renderer
  -- has to remember to check — and the sync is an HTTP client parsing somebody else's
  -- JSON, which is exactly the kind of writer that should not be trusted to have.
  --
  -- What the pattern requires, in order: the literal `https://`, a host that starts and
  -- ends with an alphanumeric, an optional port, and then a `/` — an issue URL always has
  -- a path. Two things fall out of that shape rather than being spelled: `@` is not in the
  -- host class and cannot be reached before the `/`, so `https://github.com@evil.example/…`
  -- is refused along with every other userinfo trick; and the anchor refuses a leading
  -- space, which is how a scheme gets smuggled past a naive trim.
  --
  -- Deliberately not a check that the URL names *this* repository and *this* number: the
  -- host is GitHub Enterprise Server's on some installations, the path shape is GitHub's
  -- to change, and a mirror that refused a URL GitHub itself returned would be broken by
  -- a rename this table has no say in.
  constraint github_issues_url_https
    check (gh_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?/'
           and length(gh_url) <= 2048),

  -- --- the labels are a list of names -----------------------------------------
  --
  -- `jsonb` alone accepts `3`, `"bug"` and `{"name": "bug"}` — three shapes that would
  -- each break the tags renderer differently, and two of which the GIN index below would
  -- happily store. What the readers depend on is narrower: an array, of strings.
  --
  -- `jsonb_path_exists` is the immutable way to say "no element fails this" inside a
  -- CHECK, where a subquery over `jsonb_array_elements` is not allowed. Read the filter
  -- as *"is there any element whose type is not string"* — and the constraint as there
  -- not being one.
  --
  -- The empty name is excluded by containment (`@> '[""]'`) rather than by a second
  -- jsonpath, because jsonpath has no string-length function. A whitespace-only name is
  -- not excluded and is not worth a constraint: GitHub trims label names, so one could
  -- only arrive from a writer that was not GitHub, and every other column here would be
  -- lying too by then.
  --
  -- 100 is GitHub's own cap on labels per issue. It bounds what one row can put into the
  -- GIN index, which is the only place an unbounded array here would actually hurt.
  constraint github_issues_labels_shape
    check (jsonb_typeof(labels) = 'array'
           and not jsonb_path_exists(labels, '$[*] ? (@.type() != "string")')
           and not labels @> '[""]'::jsonb
           and jsonb_array_length(labels) <= 100),

  -- --- the mirrored timestamps agree with each other --------------------------
  --
  -- An issue cannot have been updated before it was opened. GitHub does not produce that
  -- pair; a mapping bug that swapped the two fields does, and it would render as an issue
  -- `opened` after it was last touched — and would poison the `since` watermark drawn
  -- from the column.
  constraint github_issues_updated_after_created
    check (gh_updated_at >= gh_created_at)
);

comment on table ouroboros.github_issues is
  'Mirror of an enabled repository''s GitHub issues (#99) — the backlog mockup 03 renders. Decision K3: this is a cache and GitHub is the source of truth; no local edit to issue content, ever. sizing_status is the one column this product owns.';
comment on column ouroboros.github_issues.organization_id is
  'Owning workspace. Every backlog query is scoped by it, and it leads the filter index.';
comment on column ouroboros.github_issues.github_repo_id is
  'Repository the issue lives in. Held to the same workspace as organization_id by the github_issues_repo_in_organization trigger, which is the composite foreign key github_repos cannot offer.';
comment on column ouroboros.github_issues.number is
  'Issue number as GitHub assigns it — unique within the repository, meaningless outside it. The upsert key with github_repo_id.';
comment on column ouroboros.github_issues.title is
  'Title as GitHub currently has it — overwritten by every sync that sees it change, unlike runs.issue_title, which is frozen at the moment a run started.';
comment on column ouroboros.github_issues.body is
  'Issue body in full — the panel excerpts it and the estimator reads it whole. Null when GitHub''s is: an issue opened without a description.';
comment on column ouroboros.github_issues.state is
  'GitHub''s own two: open | closed. The filter bar''s State select.';
comment on column ouroboros.github_issues.labels is
  'GitHub''s label names as a JSON array of strings — not Ouroboros'' vocabulary. Filtered by containment through github_issues_labels_idx.';
comment on column ouroboros.github_issues.author_login is
  'Who opened it, in the case GitHub returns — unfolded, because a mirrored value folded is an edit (K3). Null when the author''s account is gone.';
comment on column ouroboros.github_issues.gh_updated_at is
  'GitHub''s last-updated time — the value the per-repo since watermark is drawn from (decision K2).';
comment on column ouroboros.github_issues.gh_url is
  'The issue on GitHub — the href behind "Open on GitHub ↗". Constrained to https and a host, because an href is a place a scheme executes.';
comment on column ouroboros.github_issues.synced_at is
  'When this row was last confirmed against GitHub — moved by every sync, including one that found nothing changed. updated_at moves only when the row did.';
comment on column ouroboros.github_issues.sizing_status is
  'Our sizing pipeline, decision K4: unsized | estimating | sized | needs_human. The estimates themselves are K.2''s versioned rows; this is the status the table renders as a pill.';

-- ---------------------------------------------------------------------------
-- Indexes — one per filter path M.1 (#110) documents.
--
-- Acceptance criterion: label containment and title search are `EXPLAIN`-verified index
-- scans. Both are asserted in tests/constraints.sql against a migrated database, which is
-- the only place the planner can be asked.
-- ---------------------------------------------------------------------------

-- The backlog list, and the filter bar's *Repository* and *State* selects:
--
--   select … from ouroboros.github_issues
--    where organization_id = $1 and github_repo_id = $2 and state = 'open'
--
-- Leading `organization_id` because no read here is global and every one is scoped by the
-- workspace; `github_repo_id` next because the mockup's repository select is a single
-- choice rather than a facet; `state` last because it defaults to `open` and is the
-- narrowest of the three. The prefix serves the two shorter reads as well — a workspace's
-- whole backlog, and the page head's counts over it — so those get no index of their own.
create index github_issues_organization_repo_state_idx
  on ouroboros.github_issues (organization_id, github_repo_id, state);

-- The chip-set:
--
--   select … from ouroboros.github_issues where labels @> '["bug"]'
--
-- `jsonb_ops`, the default, rather than the smaller `jsonb_path_ops`. `@>` is served by
-- both; `?`, `?|` and `?&` are served only by this one, and those are the operators an
-- *any-of-these-labels* chip-set reaches for — M.1 documents AND-filtering today and the
-- chips are a set the user toggles. Choosing the narrower class would save index size and
-- silently drop the read that has not been written yet.
create index github_issues_labels_idx
  on ouroboros.github_issues using gin (labels);

-- The search box — *"Filter by title, #number, or label…"*:
--
--   select … from ouroboros.github_issues where title ilike '%watchdog%'
--
-- Trigrams, for the reason the header gives: a substring match has no prefix for a b-tree
-- to start from. GIN rather than GiST because this index is read far more often than it
-- is written — a sync touches a row when GitHub does, a human searches on every keystroke.
--
-- Not a composite with `organization_id`: GIN cannot lead with a scalar column without
-- `btree_gin`, a second extension for a case the planner already handles by combining
-- this index with the one above through a bitmap AND.
create index github_issues_title_trgm_idx
  on ouroboros.github_issues using gin (title gin_trgm_ops);

-- Not indexed, deliberately: `sizing_status`. The reads that filter by it — the page
-- head's *"38 already sized"*, and the estimator claiming `unsized` work — are scoped by
-- workspace first, so they enter through the index above; a column with four values and
-- no independent read of its own would be an index the sync maintains for nobody. The
-- ticket that gives it one is the ticket that writes that read.

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------

-- `updated_at` moves when the row does — which, for a mirror, is what separates an issue
-- GitHub has changed from one merely re-read. See `synced_at`.
create trigger github_issues_touch_updated_at
  before update on ouroboros.github_issues
  for each row execute function ouroboros.touch_updated_at();

-- The repo-belongs-to-the-organization rule, V009's shared function, third table. Nothing
-- about two separate foreign keys makes them agree, and a row naming one workspace and
-- another's repository is not a broken join but a tenancy leak — one workspace's issue
-- titles rendering on another's backlog. The trigger takes its constraint name from
-- itself, so a rejected write reports `github_issues_repo_in_organization`.
create trigger github_issues_repo_in_organization
  before insert or update of organization_id, github_repo_id on ouroboros.github_issues
  for each row execute function ouroboros.repo_in_organization();

-- ---------------------------------------------------------------------------
-- The sync cursor, on `github_repos` (decision K2).
--
-- Both nullable, and both null on every row this migration finds: no repository has been
-- synced, because nothing syncs yet. Nullable rather than defaulted for the reason V003
-- gave `installed_at` — `now()` would assert a sync that never happened, and the *"synced
-- 40s ago"* tag would be a lie on a repository that has never been read.
-- ---------------------------------------------------------------------------
alter table ouroboros.github_repos
  -- When the last successful poll of this repository's issues finished. The freshness tag
  -- on the backlog card is rendered from it, and it is the *sync's* clock rather than any
  -- row's: a poll that found nothing changed still moves it, because "we looked and
  -- nothing had changed" is exactly what that tag claims.
  add column issues_synced_at   timestamptz,

  -- The `since` watermark the next poll sends to GitHub. Text and opaque to this schema:
  -- it is a value the sync service round-trips to GitHub's API, and a database that
  -- parsed it would be a second implementation of GitHub's format with its own opinion
  -- about time zones. The one thing asserted is that it is not blank — a cursor of `''`
  -- is a poller that would silently re-import the entire backlog.
  add column issues_sync_cursor text,

  -- A cursor is something a sync produced, so it cannot exist before one ran. The
  -- implication rather than the biconditional: the other direction is legitimate — a
  -- first poll of a repository with no issues at all completes, stamps `issues_synced_at`
  -- and has no watermark to record.
  add constraint github_repos_issues_cursor_after_sync
    check (issues_sync_cursor is null or issues_synced_at is not null),

  add constraint github_repos_issues_sync_cursor_present
    check (issues_sync_cursor is null
           or (btrim(issues_sync_cursor) <> '' and length(issues_sync_cursor) <= 255));

comment on column ouroboros.github_repos.issues_synced_at is
  'When this repository''s issues were last polled (#99, decision K2) — the source of the backlog card''s "synced 40s ago" tag. Null until the first sync; moved by a poll that found nothing changed.';
comment on column ouroboros.github_repos.issues_sync_cursor is
  'The since watermark the next incremental poll sends to GitHub (#99, decision K2). Opaque to this schema — the sync service owns its format. Null until a poll has produced one.';
