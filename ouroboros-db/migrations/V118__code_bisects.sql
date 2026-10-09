-- V118__code_bisects.sql — the bisect primitive's checkpoints, and its citations (#617, CL.4).
--
-- Mockup 22's watch row says `bisected → a41f2c9`: the product found the commit that caused a
-- measured regression. The code & git mining tool (#617) does it the way `git bisect run` does,
-- with a build-farm job (#252) in place of the local test run, so a bisect over a nightly HIL
-- metric is a long-running job — minutes to hours a step — that must survive a restart of the
-- service orchestrating it. Two tables hold it:
--
--   * **`code_bisects`** — one bisect: the repository, the good and bad commits, the candidate
--     line between them (first-parent, oldest first, `good` excluded and `bad` included, as the
--     engine's clone listed it), and the **checkpoint**: `lo`..`hi`, the candidates the culprit is
--     still among. A step narrows it; a restart resumes from it instead of starting again.
--     `max_steps` is ⌊log₂ n⌋ + 1 — the bound the acceptance criterion names — and a bisect that
--     ends names its culprit and stops.
--   * **`code_bisect_steps`** — one farm job per step: the candidate it built, the job, and the
--     verdict the job's status gave (`succeeded` → good, `failed` → bad). The steps are the proof:
--     the culprit is cited with the jobs that isolated it. A step past `max_steps`, or a job from
--     another workspace, is refused here — not merely avoided by the service.
--
-- **Citations.** A converged bisect is cited as a `code` source whose locator names the culprit
-- and the jobs that proved it — `bisect://acme-robotics/helios-firmware@<culprit>?jobs=<uuid>,…`
-- — so `source_locator_valid()` (V108) is widened to accept it beside `git://`. At most 32 jobs:
-- ⌊log₂ n⌋ + 1 for every n a 10 000-commit line can hold, and the locator stays under 2 048
-- characters.
--
-- The regression watch (#623) uses the same primitive; `regression_watch_items.bisect_result`
-- (V115) records its outcome in its own shape, which a converged row here fills.
--
-- Revert forward:
--   drop table ouroboros.code_bisect_steps;
--   drop table ouroboros.code_bisects;
--   drop function ouroboros.code_bisect_steps_guard();
--   create or replace function ouroboros.source_locator_valid … (V108's body)

-- ---------------------------------------------------------------------------
-- source_locator_valid — code sources may cite a bisect.
-- ---------------------------------------------------------------------------
-- source_locator_valid(kind, locator) — whether a locator is well-formed for its record kind.
--   kind    — web | competitor_diff | code | ticket | telemetry | doc
--   locator — the URL or internal URI
--   returns true when the locator matches the kind's pattern:
--     web, competitor_diff, doc  https?://host/…
--     ticket                     issue-index://<index>/<key>[/…], or an https?:// URL
--     code                       git://<repo>[/<repo>]@<sha, 7–40 hex>[/<path>][#L<n>[-L<m>]], or
--                                bisect://<owner>/<name>@<culprit, 40 hex>?jobs=<uuid>[,<uuid>…] (≤ 32)
--     telemetry                  telemetry://<metric>[/<metric>…]/<window>, the window <n>h|d|w
--                                or <date>[T<time>Z]..<date>[T<time>Z]
create or replace function ouroboros.source_locator_valid(kind text, locator text)
returns boolean language sql immutable as $$
  select coalesce(length(locator) <= 2048 and locator !~ '\s' and case kind
    when 'web'             then locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'competitor_diff' then locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'doc'             then locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'ticket'          then locator ~ '^issue-index://[a-z0-9][a-z0-9_-]*(/[A-Za-z0-9._#-]+)+$'
                             or locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'code'            then (locator ~ '^git://[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?@[0-9a-f]{7,40}(/[A-Za-z0-9._-]+)*(#L[1-9][0-9]*(-L[1-9][0-9]*)?)?$'
                                 and locator !~ '/\.\.?(/|#|$)')
                             or (locator ~ '^bisect://[A-Za-z0-9._-]+/[A-Za-z0-9._-]+@[0-9a-f]{40}\?jobs=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){0,31}$'
                                 and locator !~ '/\.\.?@')
    when 'telemetry'       then locator ~ '^telemetry://[a-z0-9][a-z0-9_.-]*(/[a-z0-9][a-z0-9_.-]*)*/([1-9][0-9]*[hdw]|[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z)?\.\.[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z)?)$'
    else false
  end, false);
$$;

comment on function ouroboros.source_locator_valid(text, text) is
  'True when a source locator is well-formed for its kind (#609, widened by #617): web/competitor_diff/doc an http(s) URL; ticket issue-index://<index>/<key> or an http(s) URL; code git://<repo>@<sha>[/<path>][#L<n>[-L<m>]] or bisect://<owner>/<name>@<culprit sha>?jobs=<uuid>[,…] (at most 32 jobs); telemetry telemetry://<metric>/<window> (<n>h|d|w or <date>..<date>). At most 2048 characters, no whitespace.';

-- ---------------------------------------------------------------------------
-- code_bisects — one bisect and its checkpoint.
-- ---------------------------------------------------------------------------
create table ouroboros.code_bisects (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, as everything a workspace owns.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The investigation that asked for it, when one did; the regression watch (#623) asks with
  -- none. Set null: the bisect and its jobs outlive the investigation that read them.
  investigation_id uuid        references ouroboros.investigations (id) on delete set null,

  -- The repository, mirrored (V003), and as owner/name — what the locator and a build name.
  github_repo_id   uuid        not null
                               references ouroboros.github_repos (id) on delete cascade,
  repository       text        not null
                               constraint code_bisects_repository_format
                                 check (repository ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'),

  -- The farm pool every step builds in, by name — as a submission names it.
  pool             text        not null
                               constraint code_bisects_pool_present check (btrim(pool) <> ''),

  -- What decides a step: the test it stands for (`hil:hover_drift`), and the argv each step's job
  -- runs (null = the pool's default command). A job that succeeds marks its commit good.
  test_ref         text        not null
                               constraint code_bisects_test_ref_format
                                 check (btrim(test_ref) <> '' and length(test_ref) <= 200),
  command          jsonb
                               constraint code_bisects_command_argv
                                 check (command is null or (jsonb_typeof(command) = 'array'
                                        and jsonb_array_length(command) between 1 and 64)),

  -- The refs as asked, and the commits they named when the bisect began.
  good_ref         text        not null,
  bad_ref          text        not null,
  good_sha         text        not null
                               constraint code_bisects_good_sha check (good_sha ~ '^[0-9a-f]{40}$'),
  bad_sha          text        not null
                               constraint code_bisects_bad_sha check (bad_sha ~ '^[0-9a-f]{40}$'),

  -- The ref each step's build fetches to reach its commit (refs/heads/nightly).
  build_ref        text        not null
                               constraint code_bisects_build_ref_present check (btrim(build_ref) <> ''),

  -- The candidates, oldest first: after good_sha, up to and including bad_sha.
  commits          jsonb       not null
                               constraint code_bisects_commits_shape
                                 check (jsonb_typeof(commits) = 'array'
                                        and jsonb_array_length(commits) between 1 and 10000),

  -- The checkpoint: the culprit is among commits[lo..hi] (0-based, inclusive).
  lo               integer     not null default 0,
  hi               integer     not null,

  -- ⌊log₂ n⌋ + 1 — the most steps (farm jobs) the bisect may spend.
  max_steps        integer     not null
                               constraint code_bisects_max_steps check (max_steps between 1 and 32),

  status           text        not null default 'running'
                               constraint code_bisects_status
                                 check (status in ('running', 'converged', 'inconclusive',
                                                   'failed', 'canceled')),

  -- The commit that broke it, once converged.
  culprit_sha      text
                               constraint code_bisects_culprit_sha
                                 check (culprit_sha ~ '^[0-9a-f]{40}$'),

  -- Why it stopped, when it stopped without a culprit — written for a person.
  note             text
                               constraint code_bisects_note_present
                                 check (btrim(note) <> '' and length(note) <= 500),

  -- Who started it: a person, or null for the watch.
  created_by       text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finished_at      timestamptz,

  constraint code_bisects_id_organization_key unique (id, organization_id),

  -- The checkpoint is a non-empty window of the line.
  constraint code_bisects_window
    check (lo >= 0 and lo <= hi and hi < jsonb_array_length(commits)),

  -- A converged bisect names its culprit, and nothing else does; a finished one has finished.
  constraint code_bisects_converged_has_culprit
    check ((status = 'converged') = (culprit_sha is not null)),
  constraint code_bisects_finished_when_done
    check ((status = 'running') = (finished_at is null))
);

comment on table ouroboros.code_bisects is
  'One bisect between a good and a bad commit (#617, CL.4): the first-parent candidate line, the checkpoint lo..hi the culprit is still among, the step bound ⌊log₂ n⌋+1 and, once converged, the culprit. A restart resumes from the checkpoint. Shared by the code research tool and the regression watch (#623).';
comment on column ouroboros.code_bisects.commits is
  'The candidates, oldest first: after good_sha up to and including bad_sha, on bad''s first-parent line, as the engine''s clone listed them.';
comment on column ouroboros.code_bisects.lo is
  'Checkpoint: the culprit is at or after commits[lo] — every commit before it built good.';
comment on column ouroboros.code_bisects.hi is
  'Checkpoint: the culprit is at or before commits[hi] — commits[hi] built bad (or is bad_sha).';
comment on column ouroboros.code_bisects.test_ref is
  'What a step tests, as the caller names it — hil:hover_drift. Each step is one farm job running command (or the pool''s default); success = good.';
comment on column ouroboros.code_bisects.status is
  'running | converged (culprit found) | inconclusive (the only candidate built good) | failed (a step could not be decided) | canceled.';

-- The resume tick's question: which bisects are still running.
create index code_bisects_running_idx
  on ouroboros.code_bisects (updated_at) where status = 'running';
create index code_bisects_organization_idx
  on ouroboros.code_bisects (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- code_bisect_steps — one farm job per step, and what it said.
-- ---------------------------------------------------------------------------
create table ouroboros.code_bisect_steps (
  bisect_id        uuid        not null
                               references ouroboros.code_bisects (id) on delete cascade,

  -- 1, 2, … — never more than the bisect's max_steps (code_bisect_steps_guard).
  step             integer     not null
                               constraint code_bisect_steps_step_positive check (step >= 1),

  -- The candidate built, by index into the bisect's line, and its commit.
  candidate        integer     not null
                               constraint code_bisect_steps_candidate check (candidate >= 0),
  commit_sha       text        not null
                               constraint code_bisect_steps_commit_sha
                                 check (commit_sha ~ '^[0-9a-f]{40}$'),

  -- The job that decides the step — after an infrastructure retry, the retry (#252).
  build_job_id     uuid        not null,
  organization_id  text        not null,

  -- good (the job succeeded) or bad (it failed); null while it runs.
  verdict          text
                               constraint code_bisect_steps_verdict
                                 check (verdict in ('good', 'bad')),

  created_at       timestamptz not null default now(),
  decided_at       timestamptz,

  primary key (bisect_id, step),

  -- The job is the workspace's own — a bisect never cites another workspace's build.
  constraint code_bisect_steps_job_fk
    foreign key (build_job_id, organization_id)
    references ouroboros.build_jobs (id, organization_id) on delete cascade,
  constraint code_bisect_steps_bisect_fk
    foreign key (bisect_id, organization_id)
    references ouroboros.code_bisects (id, organization_id) on delete cascade,

  constraint code_bisect_steps_decided_together
    check ((verdict is null) = (decided_at is null))
);

comment on table ouroboros.code_bisect_steps is
  'One build-farm job per bisect step (#617): the candidate it built, the job, and the verdict its status gave (succeeded → good, failed → bad). The steps are the proof the culprit is cited with. At most the bisect''s max_steps.';

create index code_bisect_steps_job_idx on ouroboros.code_bisect_steps (build_job_id);

-- code_bisect_steps_guard() — a step within the bound, on a candidate inside the line.
create function ouroboros.code_bisect_steps_guard()
returns trigger language plpgsql as $$
declare
  bound integer;
  line  jsonb;
begin
  select b.max_steps, b.commits into bound, line
    from ouroboros.code_bisects b
   where b.id = new.bisect_id;
  if not found then
    -- The foreign key reports it.
    return new;
  end if;
  if new.step > bound then
    raise exception 'bisect % may spend at most % steps; step % is one too many',
      new.bisect_id, bound, new.step
      using errcode = 'check_violation', constraint = 'code_bisect_steps_bounded';
  end if;
  if new.candidate >= jsonb_array_length(line) or line ->> new.candidate <> new.commit_sha then
    raise exception 'step % of bisect % does not build one of its candidates', new.step, new.bisect_id
      using errcode = 'check_violation', constraint = 'code_bisect_steps_candidate_in_line';
  end if;
  return new;
end;
$$;

comment on function ouroboros.code_bisect_steps_guard() is
  'Refuses a bisect step past the bisect''s max_steps, or one whose commit is not the candidate it names (#617).';

create trigger code_bisect_steps_guard
  before insert or update on ouroboros.code_bisect_steps
  for each row execute function ouroboros.code_bisect_steps_guard();

grant select, insert, update on ouroboros.code_bisects to ouroboros_app;
grant select, insert, update on ouroboros.code_bisect_steps to ouroboros_app;
