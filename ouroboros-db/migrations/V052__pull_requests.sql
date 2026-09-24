-- V052__pull_requests.sql — `pull_requests` and `pr_revisions`: the host-mirrored PR and the
-- push history everything on the PR Verification page is scoped to.
--
-- Mockup 12 (docs/mockups/12-pr-verification.html) opens with:
--
--     PR Verification · PR #514 · Revision 2
--     can: fix flaky telemetry frame order under ISR load
--     loop #1847 · issue #482 · verifying — 5 of 7 gates green
--     loop/482-canbus-flake → main · +68 −15 · 3 files
--
--     Revision 1 · 3f9c2ae — blocked → Correction round · attempt 4 → Revision 2 · b7e41d0
--
-- Filed as issue #352 (AW.1), the first issue of the PR Verification roadmap
-- (docs/ROADMAP_MOCKUP_12_PR_VERIFICATION.md). It blocks the rest of epic AW and all of AX.
--
--
-- Decision V1 — the host owns a PR's content; Ouroboros owns its verification.
-- ---------------------------------------------------------------------------
--
-- The git host is the truth for a PR's title, branches, counts and merge. Ouroboros mirrors
-- them — V014's and V030's cache-not-fork discipline — and owns what the host has no concept
-- of: the verification plane. The two sets of columns never overlap, so there is no field
-- both sides edit and nothing to reconcile.
--
-- **Sync-owned — written only by the SPI PR sync (AX.1, #357), never edited locally:**
--
--   | table           | columns                                                           |
--   |-----------------|-------------------------------------------------------------------|
--   | `pull_requests` | `source_id`, `external_number`, `external_url`, `title`,          |
--   |                 | `head_branch`, `base_branch`, `additions`, `deletions`,           |
--   |                 | `changed_files`, `merged_at`, `merged_by`                         |
--   | `pr_revisions`  | `revision_seq`, `head_sha`, `pushed_at`, `files`, `diff_excerpt`  |
--
-- A product surface that wants to change a PR's title changes it **on the host**, through the
-- SPI, and the next sync brings it back. Making any of these columns locally editable would
-- fork the PR from the host that owns it, and the next sync would silently undo the edit.
--
-- **Verification-plane-owned — Ouroboros writes these:**
--
--   * `pull_requests.run_id` — the loop that opened the PR. **Nullable**: in the MVP a PR on a
--     sandbox repo exists without a loop, and loop-created PRs arrive with AZ.5 (#375).
--   * `pull_requests.ticket_id` — the canonical ticket (V030) it closes. Canonical rather than
--     `github_issues`, so a Jira- or Linear-sourced issue links exactly as a GitHub one does.
--   * `pr_revisions.run_stage_id` — decision V4's attempt link, below.
--
-- **Shared by rule — `pull_requests.state`.** The host reports `open`, `merged` and `closed`;
-- the verification plane refines an open PR into `verifying`, `blocked` and `armed`. The
-- transition graph below admits both writers and nothing else.
--
--
-- The state machine.
-- ---------------------------------------------------------------------------
--
--     open      → verifying | closed | merged
--     verifying → blocked | armed | closed | merged
--     blocked   → verifying | closed | merged        (a new revision re-verifies)
--     armed     → verifying (a disarm) | merged | closed
--     closed    → open                                (reopened on the host)
--     merged    → (terminal)
--
-- `armed` is reachable only from `verifying`, and a PR is never mirrored in as `armed` —
-- arming is the verification plane's act on a PR it has verified. A merge or close made on
-- the host is accepted from any open state, because the host owns that fact and a sync that
-- refused it would leave the mirror lying. `merged` is terminal, and carries `merged_at`
-- exactly when it is the state. Enforced by `pull_requests_state_transition`, for every role.
--
--
-- Revisions are first-class (decision V1), and map to attempts by sha (decision V4).
-- ---------------------------------------------------------------------------
--
-- The page is scoped to one push — `Revision 2` — and revision 1, blocked with two red gates,
-- has to stay inspectable after revision 2 turns them green. A `current_head_sha` column on
-- the PR would make revision 1 unreachable the moment revision 2 landed, so each push is a
-- `pr_revisions` row, unique by `(pr_id, revision_seq)` and by `(pr_id, head_sha)`, and its
-- sync-owned columns are frozen once written (`pr_revisions_history_frozen`).
--
-- `Revision 1 blocked → Correction round · attempt 4 → Revision 2` is a relationship, not
-- prose: `run_stage_id` names the `run_stages` row (V045, #298) — the stage × attempt — whose
-- work the push carries. `pr_revisions_attempt_by_sha` only accepts that link when the PR has
-- a run, the stage is that run's, and the revision's `head_sha` is a commit that run reported
-- (`run_commits`, V047). The link is therefore always a match by commit sha, never an
-- assertion somebody typed; `pr_revision_attempts` is the read that joins the three.
--
--
-- The files snapshot.
-- ---------------------------------------------------------------------------
--
-- `files` is the changed-files card's source: a JSON array of
-- `{"path": text, "additions": int ≥ 0, "deletions": int ≥ 0}`, one entry per path, held to
-- that shape by `ouroboros.pr_revision_files_valid()`. `diff_excerpt` is the card's sample and
-- is bounded at 16 KiB of text, because it is a sample and a full diff belongs to the host.
--
--
-- Tenancy.
-- ---------------------------------------------------------------------------
--
-- `pull_requests.organization_id` is held to its source by V030's
-- `ticket_source_in_organization()`, to its ticket by `pull_requests_ticket_in_organization`,
-- and to its run by a composite reference onto `runs (id, organization_id)`. The source must
-- also be a git host — a Jira project has no pull requests. `pr_revisions` carries no
-- `organization_id`, for V045's reason: every read enters through its PR, and `pr_id`
-- cascades.

-- ---------------------------------------------------------------------------
-- The files snapshot's shape, as a function a CHECK can call.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_revision_files_valid(p_files jsonb)
returns boolean
language plpgsql
immutable
parallel safe
as $$
begin
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    return false;
  end if;

  -- Every entry an object with a non-empty path and two non-negative integer counts.
  if exists (
       select 1
         from jsonb_array_elements(p_files) e(f)
        where jsonb_typeof(f) <> 'object'
           or jsonb_typeof(f -> 'path') is distinct from 'string'
           or length(btrim(f ->> 'path')) = 0
           or jsonb_typeof(f -> 'additions') is distinct from 'number'
           or jsonb_typeof(f -> 'deletions') is distinct from 'number') then
    return false;
  end if;

  -- A second pass, so the casts below only ever see numbers: SQL does not promise to
  -- evaluate an OR left to right.
  if exists (
       select 1
         from jsonb_array_elements(p_files) e(f)
        where (f ->> 'additions')::numeric < 0
           or (f ->> 'deletions')::numeric < 0
           or (f ->> 'additions')::numeric <> trunc((f ->> 'additions')::numeric)
           or (f ->> 'deletions')::numeric <> trunc((f ->> 'deletions')::numeric)) then
    return false;
  end if;

  -- One entry per path.
  return not exists (
    select 1
      from jsonb_array_elements(p_files) e(f)
     group by f ->> 'path'
    having count(*) > 1);
end;
$$;

comment on function ouroboros.pr_revision_files_valid(jsonb) is
  'True when a revision''s files snapshot is a JSON array of {path, additions, deletions} objects — non-empty path, non-negative integer counts, one entry per path (#352). The changed-files card renders these rows directly, so a count that is a string or a path listed twice would be a card that lies.';

-- ---------------------------------------------------------------------------
-- pull_requests — one row per mirrored PR.
-- ---------------------------------------------------------------------------
create table ouroboros.pull_requests (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- --- sync-owned: the host's truth, never edited locally ----------------------------
  -- The git-host connection this PR is mirrored from. Cascade: a mirror without its source
  -- has nothing left to be a mirror of.
  source_id        uuid        not null
                               references ouroboros.ticket_sources (id) on delete cascade,

  external_number  integer     not null,
  external_url     text        not null,
  title            text        not null,
  head_branch      text        not null,
  base_branch      text        not null,
  additions        integer     not null default 0,
  deletions        integer     not null default 0,
  changed_files    integer     not null default 0,
  merged_at        timestamptz,
  -- The host login that merged it — a host identity, not necessarily an Ouroboros user.
  merged_by        text,

  -- --- shared by rule: see the state machine in the header ----------------------------
  state            text        not null default 'open',

  -- --- verification-plane-owned --------------------------------------------------------
  -- Null until a loop opens the PR (AZ.5, #375).
  run_id           uuid,
  -- The canonical ticket this PR closes, whatever tracker it came from.
  ticket_id        uuid        references ouroboros.tickets (id) on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint pull_requests_source_number_key unique (source_id, external_number),

  -- Set null on this column alone: an unqualified set null on a composite reference would
  -- null organization_id too, and the delete would fail instead of releasing the link.
  constraint pull_requests_run_fk
    foreign key (run_id, organization_id)
    references ouroboros.runs ("id", organization_id) on delete set null (run_id),

  constraint pull_requests_external_number_positive
    check (external_number >= 1),

  constraint pull_requests_external_url_http
    check (external_url ~ '^https?://'),

  constraint pull_requests_title_present
    check (length(btrim(title)) > 0),

  constraint pull_requests_branches_present
    check (length(btrim(head_branch)) > 0 and length(btrim(base_branch)) > 0),

  constraint pull_requests_counts_non_negative
    check (additions >= 0 and deletions >= 0 and changed_files >= 0),

  constraint pull_requests_state
    check (state in ('open', 'verifying', 'blocked', 'armed', 'merged', 'closed')),

  constraint pull_requests_merged_at_when_merged
    check ((state = 'merged') = (merged_at is not null)),

  constraint pull_requests_merged_by_when_merged
    check (merged_by is null or state = 'merged')
);

comment on table ouroboros.pull_requests is
  'A PR mirrored from its git host (#352, AW.1, decision V1). The host owns its content — source_id, external_number, external_url, title, head_branch, base_branch, additions, deletions, changed_files, merged_at, merged_by are written only by the SPI sync (#357) and never edited locally. Ouroboros owns run_id and ticket_id. state is shared by the rule pull_requests_state_transition enforces.';
comment on column ouroboros.pull_requests.source_id is
  'Sync-owned. The git-host connection (a github, gitlab or custom ticket_sources row of the same workspace) the PR is mirrored from.';
comment on column ouroboros.pull_requests.external_number is
  'Sync-owned. The host''s PR number — #514. Unique per source, so one PR cannot be mirrored twice.';
comment on column ouroboros.pull_requests.external_url is
  'Sync-owned. The PR''s page on the host.';
comment on column ouroboros.pull_requests.title is
  'Sync-owned — never locally edited. Changing it is an SPI call to the host; the next sync brings it back.';
comment on column ouroboros.pull_requests.head_branch is
  'Sync-owned. The branch the PR merges from — loop/482-canbus-flake.';
comment on column ouroboros.pull_requests.base_branch is
  'Sync-owned. The branch the PR merges into — main.';
comment on column ouroboros.pull_requests.additions is
  'Sync-owned. Lines added across the PR, as the host reports — the head''s +68.';
comment on column ouroboros.pull_requests.deletions is
  'Sync-owned. Lines deleted across the PR, as the host reports — the head''s −15.';
comment on column ouroboros.pull_requests.changed_files is
  'Sync-owned. Files the PR changes, as the host reports — the head''s 3 files.';
comment on column ouroboros.pull_requests.merged_at is
  'Sync-owned. When the host merged it; set exactly when state is merged.';
comment on column ouroboros.pull_requests.merged_by is
  'Sync-owned. The host login that merged it; only on a merged PR, and null when the host does not say.';
comment on column ouroboros.pull_requests.state is
  'open | verifying | blocked | armed | merged | closed. The host reports open, merged and closed; the verification plane refines open into verifying, blocked and armed. Transitions are held to the graph in V052''s header by pull_requests_state_transition; merged is terminal.';
comment on column ouroboros.pull_requests.run_id is
  'Verification-plane-owned. The loop that opened the PR — null until a loop opens one (AZ.5, #375). Composite with organization_id, so only a run of the same workspace.';
comment on column ouroboros.pull_requests.ticket_id is
  'Verification-plane-owned. The canonical ticket the PR closes — tracker-agnostic, so a Jira- or Linear-sourced issue links exactly as a GitHub one does. Held to the same workspace by pull_requests_ticket_in_organization.';

create index pull_requests_run_idx
  on ouroboros.pull_requests (run_id) where run_id is not null;

create index pull_requests_ticket_idx
  on ouroboros.pull_requests (ticket_id) where ticket_id is not null;

create trigger pull_requests_touch_updated_at
  before update on ouroboros.pull_requests
  for each row execute function ouroboros.touch_updated_at();

create trigger pull_requests_source_in_organization
  before insert or update of organization_id, source_id on ouroboros.pull_requests
  for each row execute function ouroboros.ticket_source_in_organization();

-- ---------------------------------------------------------------------------
-- The source is a git host.
-- ---------------------------------------------------------------------------
create function ouroboros.pull_requests_source_is_git_host()
returns trigger
language plpgsql
as $$
declare
  source_kind text;
begin
  select s.kind into source_kind
    from ouroboros.ticket_sources s
   where s.id = new.source_id;

  -- Null means the source is gone; its foreign key reports that by name.
  if source_kind is not null and source_kind not in ('github', 'gitlab', 'custom') then
    raise exception
      'pull request names source %, a % source — only a git host has pull requests',
      new.source_id, source_kind
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pull_requests_source_is_git_host() is
  'Refuses a pull request mirrored from a source that is not a git host — github, gitlab or custom (#352). A Jira or Linear project has no pull requests.';

create trigger pull_requests_source_is_git_host
  before insert or update of source_id on ouroboros.pull_requests
  for each row execute function ouroboros.pull_requests_source_is_git_host();

-- ---------------------------------------------------------------------------
-- The ticket is the workspace's own.
-- ---------------------------------------------------------------------------
create function ouroboros.pull_requests_ticket_in_organization()
returns trigger
language plpgsql
as $$
declare
  owner text;
begin
  if new.ticket_id is null then
    return new;
  end if;

  select t.organization_id into owner
    from ouroboros.tickets t
   where t.id = new.ticket_id;

  -- Null means the ticket is gone; its foreign key reports that by name.
  if owner is not null and owner is distinct from new.organization_id then
    raise exception
      'pull request names ticket %, which belongs to organization % rather than %',
      new.ticket_id, owner, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pull_requests_ticket_in_organization() is
  'Refuses a pull request whose canonical ticket belongs to a different workspace (#352) — the composite key tickets does not offer.';

create trigger pull_requests_ticket_in_organization
  before insert or update of organization_id, ticket_id on ouroboros.pull_requests
  for each row execute function ouroboros.pull_requests_ticket_in_organization();

-- ---------------------------------------------------------------------------
-- The state machine — see the header for the graph.
-- ---------------------------------------------------------------------------
create function ouroboros.pull_requests_state_transition()
returns trigger
language plpgsql
as $$
begin
  -- A state outside the vocabulary is pull_requests_state's to refuse, by its own name.
  if new.state not in ('open', 'verifying', 'blocked', 'armed', 'merged', 'closed') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Arming is the verification plane's act on a PR it has verified; nothing arrives armed.
    if new.state = 'armed' then
      raise exception 'a pull request cannot be mirrored in as armed — armed is reached from verifying'
        using errcode = 'check_violation', constraint = tg_name;
    end if;
    return new;
  end if;

  if new.state is not distinct from old.state then
    return new;
  end if;

  if (old.state, new.state) not in (
       ('open',      'verifying'), ('open',      'closed'),  ('open',      'merged'),
       ('verifying', 'blocked'),   ('verifying', 'armed'),   ('verifying', 'closed'),
       ('verifying', 'merged'),
       ('blocked',   'verifying'), ('blocked',   'closed'),  ('blocked',   'merged'),
       ('armed',     'verifying'), ('armed',     'merged'),  ('armed',     'closed'),
       ('closed',    'open')) then
    raise exception 'a pull request cannot move from % to %', old.state, new.state
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pull_requests_state_transition() is
  'Holds pull_requests.state to its graph (#352): open → verifying|closed|merged; verifying → blocked|armed|closed|merged; blocked → verifying|closed|merged; armed → verifying (disarm)|merged|closed; closed → open (host reopen); merged is terminal. Nothing is inserted armed. Binds every role, the owner included.';

create trigger pull_requests_state_transition
  before insert or update of state on ouroboros.pull_requests
  for each row execute function ouroboros.pull_requests_state_transition();

-- ---------------------------------------------------------------------------
-- pr_revisions — one row per push to the PR's head branch.
-- ---------------------------------------------------------------------------
create table ouroboros.pr_revisions (
  id               uuid        primary key default gen_random_uuid(),

  pr_id            uuid        not null
                               references ouroboros.pull_requests (id) on delete cascade,

  -- --- sync-owned, and frozen once written ------------------------------------------
  -- Revision 1 · 2 — the page's "Revision 2".
  revision_seq     integer     not null,
  head_sha         text        not null,
  pushed_at        timestamptz not null,
  -- The changed-files card: [{path, additions, deletions}].
  files            jsonb       not null default '[]'::jsonb,
  -- The card's diff sample — bounded, because the full diff is the host's.
  diff_excerpt     text,

  -- --- verification-plane-owned: decision V4 ---------------------------------------
  -- The stage × attempt whose work this push carries, matched by head_sha.
  run_stage_id     uuid        references ouroboros.run_stages (id) on delete set null,

  created_at       timestamptz not null default now(),

  constraint pr_revisions_pr_seq_key unique (pr_id, revision_seq),
  constraint pr_revisions_pr_sha_key unique (pr_id, head_sha),

  constraint pr_revisions_revision_seq_positive
    check (revision_seq >= 1),

  constraint pr_revisions_head_sha_shape
    check (head_sha ~ '^[0-9a-f]{7,40}$'),

  constraint pr_revisions_files
    check (ouroboros.pr_revision_files_valid(files)),

  constraint pr_revisions_diff_excerpt_bounded
    check (diff_excerpt is null or length(diff_excerpt) <= 16384)
);

comment on table ouroboros.pr_revisions is
  'One push to a PR (#352, decisions V1 and V4) — the page''s Revision 1 · 2. Each push is its own row so an earlier revision stays inspectable after a later one lands; the sync-owned columns are frozen once written. run_stage_id links the push to the run attempt whose commit it is.';
comment on column ouroboros.pr_revisions.revision_seq is
  'Sync-owned. The push''s ordinal within the PR — Revision 1, 2. Frozen.';
comment on column ouroboros.pr_revisions.head_sha is
  'Sync-owned. The PR head after this push — 3f9c2ae, b7e41d0. Unique per PR, 7–40 lowercase hex. Frozen.';
comment on column ouroboros.pr_revisions.pushed_at is
  'Sync-owned. When the host saw the push. Frozen.';
comment on column ouroboros.pr_revisions.files is
  'Sync-owned. The changed-files card''s rows: a JSON array of {path, additions, deletions}, one per path (pr_revision_files_valid).';
comment on column ouroboros.pr_revisions.diff_excerpt is
  'Sync-owned. A bounded sample of the diff (at most 16384 characters) for the card; the full diff stays on the host.';
comment on column ouroboros.pr_revisions.run_stage_id is
  'Verification-plane-owned (decision V4). The run_stages row — stage × attempt — whose work this push carries. Accepted only when head_sha is a commit the PR''s run reported (pr_revisions_attempt_by_sha). Set null if the stage row goes.';

create index pr_revisions_run_stage_idx
  on ouroboros.pr_revisions (run_stage_id) where run_stage_id is not null;

-- ---------------------------------------------------------------------------
-- A revision's history does not change.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_revisions_history_frozen()
returns trigger
language plpgsql
as $$
begin
  if (new.pr_id, new.revision_seq, new.head_sha, new.pushed_at)
     is distinct from (old.pr_id, old.revision_seq, old.head_sha, old.pushed_at) then
    raise exception 'a revision''s pr, sequence, head sha and push time are fixed once written'
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.pr_revisions_history_frozen() is
  'Refuses changing a revision''s pr_id, revision_seq, head_sha or pushed_at (#352): a push that happened cannot be rewritten, which is what keeps Revision 1 inspectable after Revision 2 lands. files and diff_excerpt may still be filled in by a later sync, and run_stage_id linked.';

create trigger pr_revisions_history_frozen
  before update of pr_id, revision_seq, head_sha, pushed_at on ouroboros.pr_revisions
  for each row execute function ouroboros.pr_revisions_history_frozen();

-- ---------------------------------------------------------------------------
-- The attempt link is a match by commit sha (decision V4).
-- ---------------------------------------------------------------------------
create function ouroboros.pr_revisions_attempt_by_sha()
returns trigger
language plpgsql
as $$
declare
  pr_run    uuid;
  stage_run uuid;
begin
  if new.run_stage_id is null then
    return new;
  end if;

  select p.run_id into pr_run from ouroboros.pull_requests p where p.id = new.pr_id;
  select s.run_id into stage_run from ouroboros.run_stages s where s.id = new.run_stage_id;

  -- A missing stage is its foreign key's to report.
  if stage_run is null then
    return new;
  end if;

  if pr_run is null or pr_run <> stage_run
     or not exists (select 1 from ouroboros.run_commits c
                     where c.run_id = pr_run and c.sha = new.head_sha) then
    raise exception
      'revision % (head %) cannot link stage %: the PR''s run must be the stage''s run and have reported that commit',
      new.revision_seq, new.head_sha, new.run_stage_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_revisions_attempt_by_sha() is
  'Accepts a revision''s run_stage_id only when the PR has a run, the stage belongs to that run, and the revision''s head_sha is a commit that run reported in run_commits (#352, decision V4). The attempt link is always a match by sha, never an assertion.';

create trigger pr_revisions_attempt_by_sha
  before insert or update of run_stage_id on ouroboros.pr_revisions
  for each row execute function ouroboros.pr_revisions_attempt_by_sha();

-- ---------------------------------------------------------------------------
-- The revision strip's join: revision → the run's commit (by sha) → the stage attempt.
-- ---------------------------------------------------------------------------
create view ouroboros.pr_revision_attempts as
select v.id                as revision_id,
       v.pr_id,
       v.revision_seq,
       v.head_sha,
       v.pushed_at,
       p.run_id,
       c.id                as run_commit_id,
       c.message           as commit_message,
       s.id                as run_stage_id,
       s.stage_key,
       s.attempt
  from ouroboros.pr_revisions v
  join ouroboros.pull_requests p on p.id = v.pr_id
  left join ouroboros.run_commits c on c.run_id = p.run_id and c.sha = v.head_sha
  left join ouroboros.run_stages s on s.id = v.run_stage_id;

comment on view ouroboros.pr_revision_attempts is
  'Every revision with the run commit its head_sha matches and the stage attempt it is linked to (#352, decision V4) — the revision strip''s "Revision 1 → Correction round · attempt 4 → Revision 2" as a join. Commit and stage columns are null for a PR no loop opened.';

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason: `ouroboros_app` is the role a deployment that separates
-- *migrating* from *running* connects the API as.
--
--   * **Both tables are written and updated by the application** — the sync mirrors the host
--     into them and the verification plane moves `state` and sets its links. What bounds
--     `update` is the triggers above, which bind every role.
--   * **Neither may be deleted.** A PR mirror that vanished would take its revisions, and
--     with them the record of what was wrong before the fix. Rows leave with their source.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update on ouroboros.pull_requests to ouroboros_app;
grant select, insert, update on ouroboros.pr_revisions to ouroboros_app;
grant select on ouroboros.pr_revision_attempts to ouroboros_app;

revoke delete on ouroboros.pull_requests from ouroboros_app;
revoke delete on ouroboros.pull_requests from public;
revoke delete on ouroboros.pr_revisions from ouroboros_app;
revoke delete on ouroboros.pr_revisions from public;
