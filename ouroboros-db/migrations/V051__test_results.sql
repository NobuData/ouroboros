-- V051__test_results.sql — `test_runs` → `test_suites` → `test_cases`: one results tree per
-- build attempt, with retry truth and a case identity that survives everything.
--
-- Mockup 11 (docs/mockups/11-test-results.html) is the same rows read at different depths:
--
--     61/63 passed · build 3 of loop #1847
--     63 · across 5 suites   61 · ▲ 12 vs build 2   6m 12s · 4m sim · 2m 12s physical
--     Build 1 · 49/63 · 14 failed (a3f19c2) → Build 2 · 61/63 → Build 3 ● running
--     unit · drivers native_sim 24/24 … PHYSICAL · HIL rig  rig:helios-rig-02 1/2
--     flaky · passed on retry 2/3 · quarantine watching
--
-- Filed as issue #324 (AS.1), the first issue of the Test Results roadmap
-- (docs/ROADMAP_MOCKUP_11_TEST_RESULTS.md). It blocks the rest of epic AS and all of AT.
--
--
-- Decision T1 — results belong to a build attempt, not to a run.
-- ---------------------------------------------------------------------------
--
-- `Build 1 · 49/63` and `Build 2 · 61/63` are two complete result trees for the same run,
-- produced by two farm jobs, and the timeline is the sequence of them. So a `test_runs` row is
-- one attempt — `(run_id, attempt_seq)` is unique, and `attempt_seq` is the Build 1/2/3
-- ordinal — and it names the `build_jobs` row that produced it. Hanging results off `runs`
-- directly would make the attempts strip a fiction and `▲ 12 vs build 2` uncomputable.
--
-- The build job is a composite reference, V047's `reserved_build_job_id` pattern: a result
-- tree can only name a job of its own workspace, and it is released with
-- `on delete set null (build_job_id)` — the column list matters, because an unqualified
-- `set null` on a composite key would try to null `organization_id` as well and fail the
-- delete. Results outlive a pruned job; a job produces at most one attempt. Where the job
-- itself names a run, `test_runs_build_job_same_run` holds it to this attempt's run.
--
--
-- Decision T2 — case identity is durable.
-- ---------------------------------------------------------------------------
--
-- *"passed on retry 2/3 · quarantine watching"* is a claim about a test case over time —
-- across retries within a build, across builds within a run, and across runs entirely. That
-- needs a key that is the same every time the same test is seen, so `case_key` is
--
--     sha256( github_repo_id ␟ suite name ␟ classname ␟ name )   as 64 lowercase hex digits
--
-- computed by `ouroboros.test_case_key()` — `␟` is U+001F, the unit separator, which no
-- JUnit name contains, so `("a b", "c")` and `("a", "b c")` cannot collide. The repository is
-- part of the input because the key is scoped per repo; `(case_key, organization_id)` is the
-- index case-history joins go through (AS.3, #326).
--
-- Stability is structural rather than promised:
--
--   * **The key is derived, not trusted.** `test_cases_derive_case_key` fills `case_key` when
--     a writer leaves it null and refuses one that disagrees with the derivation, so re-parsing
--     the same XML — in this attempt, a later attempt or another run of the same repo — cannot
--     produce a different key. A parser may compute it itself (the recipe above) or leave it
--     to the database.
--   * **Its inputs are frozen.** A suite's `name` and a test run's `run_id` feed every key
--     beneath them, so `test_suites_identity_frozen` and `test_runs_identity_frozen` refuse
--     to change them once written. Renaming a case means writing its new key with it (or null
--     to have it derived) — which is the point: a renamed test is a different identity.
--
-- The inputs are hashed exactly as given. Normalising them — trimming, collapsing
-- parameterised names — is the parser's job (AT.1), because only it knows its format.
--
--
-- Retries are recorded, not summarised.
-- ---------------------------------------------------------------------------
--
-- A case that passed on its third attempt is a different fact from one that passed first
-- time, and `retries: 2` alone loses which attempts failed. So `retry_outcomes` is the
-- ordered list of every attempt's outcome, first attempt included — `["passed"]` is passed
-- first time, `["failed", "failed", "passed"]` is passed on retry 2 — and
-- `ouroboros.test_case_outcomes_valid()` holds it to `retries` and `status`:
--
--   | status    | retry_outcomes                                                   |
--   |-----------|------------------------------------------------------------------|
--   | `passed`  | every attempt passed                                             |
--   | `flaky`   | the last attempt passed and an earlier one failed or errored     |
--   | `failed`  | the last attempt failed                                          |
--   | `error`   | the last attempt errored                                         |
--   | `skipped` | exactly `["skipped"]` — a case that never ran was never retried  |
--
-- and its length is always `retries + 1`.
--
--
-- One deliberate denormalisation — the totals.
-- ---------------------------------------------------------------------------
--
-- `total`, `passed`, `failed`, `flaky` and `skipped` are stored on `test_runs` and
-- `test_suites` even though they are derivable, because the strip, the timeline and the
-- suites card read them on every render. The drift risk is real and contained three ways:
--
--   * **One definition of counting.** `test_suite_counts_computed` and
--     `test_run_counts_computed` are the only place a case status becomes a count. `failed`
--     counts `failed` *and* `error` — both are a case that did not pass, which is what the
--     head's `61/63` and the DASH check counts mean — so `total = passed + failed + flaky +
--     skipped` holds, and a CHECK says so.
--   * **Recomputed on every parse.** `ouroboros.test_run_recount()` rewrites an attempt's
--     stored figures from those views; the parser (AT.1) calls it after every write of cases.
--   * **Asserted.** `test_results_count_drift` lists every attempt or suite whose stored
--     figures differ from the recompute, and `tests/constraints.sql` requires it empty.
--
--
-- The wall-time split.
-- ---------------------------------------------------------------------------
--
-- `6m 12s · 4m sim · 2m 12s physical` is a split of the wall time, so it sums: when the
-- three are known, `wall_ms = sim_ms + physical_ms`, and while they are not (a running
-- attempt) all three are null together. A split with one part missing would print a strip
-- whose parts do not add up to its headline.
--
--
-- Reconciliation with the dashboard (#64).
-- ---------------------------------------------------------------------------
--
-- `runs.checks_passed/checks_total` and these totals describe the same fact from two
-- surfaces, so `run_check_reconciliation` maps one onto the other — a run's **latest complete
-- attempt**, `passed → checks_passed` and `total → checks_total` — with an `agrees` column,
-- so the two cannot quietly disagree. A running or errored attempt is not a finished count
-- and is not compared.
--
--
-- Why `organization_id` on all three tables.
-- ---------------------------------------------------------------------------
--
-- V045 left it off `run_stages` because no query asks for *"this workspace's stages"*. Here
-- one does: case history (AS.3) and the Build Analyzer (#512) read `test_cases` across runs by
-- `(case_key, organization_id)` without entering through a run. So each level carries it and
-- each reference is composite — `(test_run_id, organization_id)`,
-- `(test_suite_id, organization_id)` — V040's pattern, which makes a case of another
-- workspace's suite unspellable rather than merely checked.

-- ---------------------------------------------------------------------------
-- The case identity recipe (decision T2).
-- ---------------------------------------------------------------------------
create function ouroboros.test_case_key(
  p_github_repo_id uuid,
  p_suite          text,
  p_classname      text,
  p_name           text
) returns text
language sql
immutable
parallel safe
as $$
  select encode(
           sha256(convert_to(
             p_github_repo_id::text || chr(31) || p_suite || chr(31)
               || coalesce(p_classname, '') || chr(31) || p_name,
             'UTF8')),
           'hex')
$$;

comment on function ouroboros.test_case_key(uuid, text, text, text) is
  'The durable case identity (#324, decision T2): sha256 over repo id, suite name, classname and name joined by U+001F, as 64 lowercase hex digits. A null classname hashes as empty. Inputs are hashed exactly as given — normalising them is the parser''s job. Returns null when the repo, suite or name is null.';

-- ---------------------------------------------------------------------------
-- The retry-truth rule, as a function a CHECK can call.
--
-- plpgsql rather than SQL so the shape checks run before anything indexes into the array:
-- `jsonb_array_length` raises on a non-array, and a CHECK that raises class 22 instead of
-- failing reads as a broken statement rather than a refused row.
-- ---------------------------------------------------------------------------
create function ouroboros.test_case_outcomes_valid(
  p_status   text,
  p_retries  integer,
  p_outcomes jsonb
) returns boolean
language plpgsql
immutable
parallel safe
as $$
declare
  n    integer;
  last text;
begin
  if p_outcomes is null or jsonb_typeof(p_outcomes) <> 'array' or p_retries is null then
    return false;
  end if;

  n := jsonb_array_length(p_outcomes);
  if n <> p_retries + 1 then
    return false;
  end if;

  if exists (select 1 from jsonb_array_elements(p_outcomes) e(v)
              where jsonb_typeof(v) <> 'string'
                 or v #>> '{}' not in ('passed', 'failed', 'error', 'skipped')) then
    return false;
  end if;

  last := p_outcomes ->> (n - 1);

  return case p_status
    when 'passed'  then not exists (select 1 from jsonb_array_elements_text(p_outcomes) e(v)
                                     where v <> 'passed')
    when 'flaky'   then last = 'passed'
                        and exists (select 1 from jsonb_array_elements_text(p_outcomes) e(v)
                                     where v in ('failed', 'error'))
    when 'failed'  then last = 'failed'
    when 'error'   then last = 'error'
    when 'skipped' then n = 1 and last = 'skipped'
    -- An unknown status is test_cases_status's to refuse, by its own name.
    else true
  end;
end;
$$;

comment on function ouroboros.test_case_outcomes_valid(text, integer, jsonb) is
  'True when retry_outcomes is the ordered list of every attempt (length retries + 1, each one of passed|failed|error|skipped) and agrees with status: passed = every attempt passed; flaky = last passed after an earlier failure or error; failed/error = the last attempt''s outcome; skipped = exactly ["skipped"] (#324). What lets "passed first time" and "passed on retry 2 of 3" be told apart.';

-- ---------------------------------------------------------------------------
-- test_runs — one row per build attempt (decision T1).
-- ---------------------------------------------------------------------------
create table ouroboros.test_runs (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The run this attempt belongs to. Cascade: results mean nothing without their run.
  run_id           uuid        not null,

  -- The farm job that produced it. Nullable so results outlive a pruned job.
  build_job_id     uuid,

  -- Build 1 · 2 · 3 — the attempt's ordinal within its run.
  attempt_seq      integer     not null,

  commit_sha       text,

  -- Denormalised from test_cases and recomputed on every parse — see the header.
  total            integer     not null default 0,
  passed           integer     not null default 0,
  failed           integer     not null default 0,
  flaky            integer     not null default 0,
  skipped          integer     not null default 0,

  -- The wall-time split: all null, or all set with wall = sim + physical.
  wall_ms          bigint,
  sim_ms           bigint,
  physical_ms      bigint,

  status           text        not null default 'running',
  started_at       timestamptz not null default now(),

  -- What the parser could not read but did not refuse the report over.
  parse_warnings   jsonb       not null default '[]'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint test_runs_run_attempt_key       unique (run_id, attempt_seq),
  constraint test_runs_build_job_key         unique (build_job_id),
  constraint test_runs_id_organization_key   unique (id, organization_id),

  constraint test_runs_run_fk
    foreign key (run_id, organization_id)
    references ouroboros.runs ("id", organization_id) on delete cascade,

  constraint test_runs_build_job_fk
    foreign key (build_job_id, organization_id)
    references ouroboros.build_jobs (id, organization_id) on delete set null (build_job_id),

  constraint test_runs_attempt_seq_positive
    check (attempt_seq >= 1),

  constraint test_runs_commit_sha_shape
    check (commit_sha is null or commit_sha ~ '^[0-9a-f]{7,40}$'),

  constraint test_runs_status
    check (status in ('running', 'complete', 'error')),

  constraint test_runs_counts_non_negative
    check (passed >= 0 and failed >= 0 and flaky >= 0 and skipped >= 0),

  constraint test_runs_totals_sum
    check (total = passed + failed + flaky + skipped),

  constraint test_runs_durations_non_negative
    check (coalesce(wall_ms, 0) >= 0 and coalesce(sim_ms, 0) >= 0
           and coalesce(physical_ms, 0) >= 0),

  constraint test_runs_duration_split
    check ((wall_ms is null and sim_ms is null and physical_ms is null)
           or (wall_ms is not null and sim_ms is not null and physical_ms is not null
               and wall_ms = sim_ms + physical_ms)),

  constraint test_runs_parse_warnings_array
    check (jsonb_typeof(parse_warnings) = 'array')
);

comment on table ouroboros.test_runs is
  'One results tree per build attempt (#324, AS.1, decision T1) — mockup 11''s Build 1 · 2 · 3. Unique per (run_id, attempt_seq); produced by at most one build job. Totals are denormalised from test_cases, recomputed by test_run_recount() and asserted against test_results_count_drift.';
comment on column ouroboros.test_runs.attempt_seq is
  'The Build 1/2/3 ordinal within the run. Frozen once written (test_runs_identity_frozen).';
comment on column ouroboros.test_runs.build_job_id is
  'The build_jobs row that produced this attempt — composite with organization_id, so only a job of the same workspace; set null when the job is pruned, so results outlive it.';
comment on column ouroboros.test_runs.failed is
  'Cases with status failed or error — both are a case that did not pass. total = passed + failed + flaky + skipped.';
comment on column ouroboros.test_runs.wall_ms is
  'Wall time of the attempt. With sim_ms and physical_ms: all null (not yet known) or all set with wall_ms = sim_ms + physical_ms — the strip''s "6m 12s · 4m sim · 2m 12s physical".';
comment on column ouroboros.test_runs.status is
  'running (results may be partial) | complete | error.';
comment on column ouroboros.test_runs.parse_warnings is
  'A JSON array of what the parser could not read but did not refuse the report over.';

create trigger test_runs_touch_updated_at
  before update on ouroboros.test_runs
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A build job that names a run must name this attempt's run.
--
-- `build_jobs.run_id` is nullable and a job can exist before it is attributed, so this is a
-- rule about the pair rather than a foreign key: where both sides name a run, they name the
-- same one. Raised as class 23 with a constraint name, V008's pattern for a join a composite
-- key cannot express.
-- ---------------------------------------------------------------------------
create function ouroboros.test_runs_build_job_same_run()
returns trigger
language plpgsql
as $$
declare
  job_run uuid;
begin
  if new.build_job_id is null then
    return new;
  end if;

  -- Scoped to this workspace: another workspace's job is test_runs_build_job_fk's to report.
  select run_id into job_run
    from ouroboros.build_jobs
   where id = new.build_job_id and organization_id = new.organization_id;

  if job_run is not null and job_run is distinct from new.run_id then
    raise exception
      'test run names build job %, which belongs to run % rather than %',
      new.build_job_id, job_run, new.run_id
      using errcode = 'check_violation', constraint = 'test_runs_build_job_same_run';
  end if;

  return new;
end;
$$;

comment on function ouroboros.test_runs_build_job_same_run() is
  'Refuses a test run whose build job is attributed to a different run (#324). A job with no run_id yet is accepted.';

create trigger test_runs_build_job_same_run
  before insert or update of run_id, build_job_id on ouroboros.test_runs
  for each row execute function ouroboros.test_runs_build_job_same_run();

-- ---------------------------------------------------------------------------
-- The columns case identity is built from cannot move (decision T2).
-- ---------------------------------------------------------------------------
create function ouroboros.test_runs_identity_frozen()
returns trigger
language plpgsql
as $$
begin
  if new.run_id is distinct from old.run_id or new.attempt_seq is distinct from old.attempt_seq then
    raise exception 'a test run''s run_id and attempt_seq are fixed once written'
      using errcode = 'check_violation', constraint = 'test_runs_identity_frozen';
  end if;
  return new;
end;
$$;

comment on function ouroboros.test_runs_identity_frozen() is
  'Refuses changing a test run''s run_id or attempt_seq (#324): the run''s repository feeds every case_key beneath it, and the ordinal is the timeline''s.';

create trigger test_runs_identity_frozen
  before update of run_id, attempt_seq on ouroboros.test_runs
  for each row execute function ouroboros.test_runs_identity_frozen();

-- ---------------------------------------------------------------------------
-- test_suites — one twister suite on one platform within an attempt.
-- ---------------------------------------------------------------------------
create table ouroboros.test_suites (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null,

  test_run_id      uuid        not null,

  -- `telemetry integration` — feeds every case_key beneath it, so frozen once written.
  name             text        not null,

  -- `native_sim`, `qemu_cortex_m3`, `rig:helios-rig-02`.
  platform         text        not null,

  kind             text        not null,

  -- Denormalised from test_cases, as on test_runs.
  total            integer     not null default 0,
  passed           integer     not null default 0,
  failed           integer     not null default 0,
  flaky            integer     not null default 0,
  skipped          integer     not null default 0,

  -- Parser-specific detail; the rig's bench description lives here.
  meta             jsonb       not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),

  -- Also the index the suites card reads through: it leads with test_run_id.
  constraint test_suites_run_name_platform_key unique (test_run_id, name, platform),
  constraint test_suites_id_organization_key   unique (id, organization_id),

  constraint test_suites_test_run_fk
    foreign key (test_run_id, organization_id)
    references ouroboros.test_runs (id, organization_id) on delete cascade,

  constraint test_suites_name_present
    check (length(btrim(name)) > 0),

  constraint test_suites_platform_shape
    check (platform ~ '^(rig:[A-Za-z0-9][A-Za-z0-9._-]*|[a-z0-9][a-z0-9_]*)$'),

  constraint test_suites_kind
    check (kind in ('sim', 'physical')),

  constraint test_suites_rig_is_physical
    check (platform not like 'rig:%' or kind = 'physical'),

  constraint test_suites_counts_non_negative
    check (passed >= 0 and failed >= 0 and flaky >= 0 and skipped >= 0),

  constraint test_suites_totals_sum
    check (total = passed + failed + flaky + skipped),

  constraint test_suites_meta_object
    check (jsonb_typeof(meta) = 'object')
);

comment on table ouroboros.test_suites is
  'One suite on one platform within a build attempt (#324) — a row of mockup 11''s suites card. Counts are denormalised from test_cases like test_runs'' totals.';
comment on column ouroboros.test_suites.platform is
  'The platform tag: a board or simulator name (native_sim, qemu_cortex_m3) or rig:<name> for a physical rig. A rig: platform is always kind physical.';
comment on column ouroboros.test_suites.kind is
  'sim | physical — which half of the wall-time split the suite belongs to.';
comment on column ouroboros.test_suites.meta is
  'Parser-specific detail as a JSON object; a physical suite''s bench description lives here.';

create function ouroboros.test_suites_identity_frozen()
returns trigger
language plpgsql
as $$
begin
  if new.name is distinct from old.name or new.test_run_id is distinct from old.test_run_id then
    raise exception 'a test suite''s name and test run are fixed once written'
      using errcode = 'check_violation', constraint = 'test_suites_identity_frozen';
  end if;
  return new;
end;
$$;

comment on function ouroboros.test_suites_identity_frozen() is
  'Refuses changing a suite''s name or test_run_id (#324): both feed the case_key of every case in it.';

create trigger test_suites_identity_frozen
  before update of name, test_run_id on ouroboros.test_suites
  for each row execute function ouroboros.test_suites_identity_frozen();

-- ---------------------------------------------------------------------------
-- test_cases — one test case's result within a suite, retries included.
-- ---------------------------------------------------------------------------
create table ouroboros.test_cases (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null,

  test_suite_id    uuid        not null,

  -- Decision T2 — derived by test_cases_derive_case_key when left null.
  case_key         text        not null,

  name             text        not null,
  classname        text,

  status           text        not null,

  -- Re-attempts after the first; retry_outcomes carries every attempt's outcome.
  retries          integer     not null default 0,
  retry_outcomes   jsonb       not null,

  duration_ms      bigint,

  -- { message, log_excerpt, path } — each optional, each a string.
  failure          jsonb,

  -- What the parser knows that JUnit cannot express generically.
  meta             jsonb       not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),

  constraint test_cases_suite_case_key       unique (test_suite_id, case_key),

  constraint test_cases_test_suite_fk
    foreign key (test_suite_id, organization_id)
    references ouroboros.test_suites (id, organization_id) on delete cascade,

  constraint test_cases_case_key_shape
    check (case_key ~ '^[0-9a-f]{64}$'),

  constraint test_cases_name_present
    check (length(btrim(name)) > 0),

  constraint test_cases_status
    check (status in ('passed', 'failed', 'flaky', 'skipped', 'error')),

  constraint test_cases_retries_non_negative
    check (retries >= 0),

  constraint test_cases_retry_outcomes
    check (ouroboros.test_case_outcomes_valid(status, retries, retry_outcomes)),

  constraint test_cases_duration_non_negative
    check (duration_ms is null or duration_ms >= 0),

  constraint test_cases_failure_shape
    check (failure is null
           or (jsonb_typeof(failure) = 'object'
               and coalesce(jsonb_typeof(failure -> 'message'), 'string') = 'string'
               and coalesce(jsonb_typeof(failure -> 'log_excerpt'), 'string') = 'string'
               and coalesce(jsonb_typeof(failure -> 'path'), 'string') = 'string')),

  constraint test_cases_meta_object
    check (jsonb_typeof(meta) = 'object')
);

comment on table ouroboros.test_cases is
  'One test case''s result within a suite (#324), retries included. case_key is the durable identity (decision T2) history and flake scoring join on; retry_outcomes is the ordered per-attempt truth test_case_outcomes_valid() holds to status and retries.';
comment on column ouroboros.test_cases.case_key is
  'ouroboros.test_case_key(repo, suite name, classname, name) — derived when written null, refused when it disagrees (test_cases_derive_case_key). Stable across re-parse, attempts and runs of the same repo.';
comment on column ouroboros.test_cases.retries is
  'Re-attempts after the first. retry_outcomes has retries + 1 entries.';
comment on column ouroboros.test_cases.retry_outcomes is
  'Every attempt''s outcome in order, the first included: ["passed"] is passed first time, ["failed","failed","passed"] is passed on retry 2.';
comment on column ouroboros.test_cases.failure is
  'The failure payload — an object whose message, log_excerpt and path are strings when present. Null when there is none.';
comment on column ouroboros.test_cases.meta is
  'Parser-specific detail JUnit cannot express generically, as a JSON object.';

-- Case-history joins (AS.3, #326) and the Build Analyzer's corpus reads (#512).
create index test_cases_case_history_idx
  on ouroboros.test_cases (case_key, organization_id);

-- ---------------------------------------------------------------------------
-- case_key is derived, never trusted (decision T2).
-- ---------------------------------------------------------------------------
create function ouroboros.test_cases_derive_case_key()
returns trigger
language plpgsql
as $$
declare
  expected text;
begin
  select ouroboros.test_case_key(r.github_repo_id, s.name, new.classname, new.name)
    into expected
    from ouroboros.test_suites s
    join ouroboros.test_runs t on t.id = s.test_run_id
    join ouroboros.runs r on r."id" = t.run_id
   where s.id = new.test_suite_id;

  -- No suite: the foreign key reports it, by name.
  if not found then
    return new;
  end if;

  if new.case_key is null then
    new.case_key := expected;
  elsif new.case_key is distinct from expected then
    raise exception
      'case_key % does not match its derivation % from the repository, suite, classname and name',
      new.case_key, expected
      using errcode = 'check_violation', constraint = 'test_cases_case_key_derived';
  end if;

  return new;
end;
$$;

comment on function ouroboros.test_cases_derive_case_key() is
  'Fills test_cases.case_key from test_case_key() when written null and refuses one that disagrees (#324, decision T2) — what makes the key stable across re-parse rather than dependent on every parser getting it right.';

create trigger test_cases_derive_case_key
  before insert or update of case_key, name, classname, test_suite_id on ouroboros.test_cases
  for each row execute function ouroboros.test_cases_derive_case_key();

-- ---------------------------------------------------------------------------
-- The one definition of counting.
-- ---------------------------------------------------------------------------
create view ouroboros.test_suite_counts_computed as
select s.id                                                     as test_suite_id,
       s.test_run_id,
       count(c.id)::integer                                     as total,
       count(c.id) filter (where c.status = 'passed')::integer  as passed,
       count(c.id) filter (where c.status in ('failed', 'error'))::integer as failed,
       count(c.id) filter (where c.status = 'flaky')::integer   as flaky,
       count(c.id) filter (where c.status = 'skipped')::integer as skipped
  from ouroboros.test_suites s
  left join ouroboros.test_cases c on c.test_suite_id = s.id
 group by s.id;

comment on view ouroboros.test_suite_counts_computed is
  'Each suite''s counts computed from its cases (#324) — failed counts failed and error. The single definition test_run_recount() writes from and test_results_count_drift compares against.';

create view ouroboros.test_run_counts_computed as
select t.id                                   as test_run_id,
       coalesce(sum(s.total),   0)::integer   as total,
       coalesce(sum(s.passed),  0)::integer   as passed,
       coalesce(sum(s.failed),  0)::integer   as failed,
       coalesce(sum(s.flaky),   0)::integer   as flaky,
       coalesce(sum(s.skipped), 0)::integer   as skipped
  from ouroboros.test_runs t
  left join ouroboros.test_suite_counts_computed s on s.test_run_id = t.id
 group by t.id;

comment on view ouroboros.test_run_counts_computed is
  'Each attempt''s totals computed from its cases, through test_suite_counts_computed (#324).';

-- ---------------------------------------------------------------------------
-- Recompute an attempt's stored figures — the parser calls this after every write of cases.
-- ---------------------------------------------------------------------------
create function ouroboros.test_run_recount(p_test_run_id uuid)
returns void
language sql
as $$
  update ouroboros.test_suites s
     set total = c.total, passed = c.passed, failed = c.failed,
         flaky = c.flaky, skipped = c.skipped
    from ouroboros.test_suite_counts_computed c
   where c.test_suite_id = s.id
     and s.test_run_id = p_test_run_id;

  update ouroboros.test_runs t
     set total = c.total, passed = c.passed, failed = c.failed,
         flaky = c.flaky, skipped = c.skipped
    from ouroboros.test_run_counts_computed c
   where c.test_run_id = t.id
     and t.id = p_test_run_id;
$$;

comment on function ouroboros.test_run_recount(uuid) is
  'Rewrites one attempt''s stored suite counts and totals from its cases (#324). Called on every parse, so the denormalised figures are a cache of test_*_counts_computed and never a second source of truth.';

-- ---------------------------------------------------------------------------
-- Where stored and computed disagree — empty is the invariant.
-- ---------------------------------------------------------------------------
create view ouroboros.test_results_count_drift as
select 'run'::text                                                   as level,
       t.id                                                          as test_run_id,
       null::uuid                                                    as test_suite_id,
       array[t.total, t.passed, t.failed, t.flaky, t.skipped]        as stored,
       array[c.total, c.passed, c.failed, c.flaky, c.skipped]        as computed
  from ouroboros.test_runs t
  join ouroboros.test_run_counts_computed c on c.test_run_id = t.id
 where (t.total, t.passed, t.failed, t.flaky, t.skipped)
       is distinct from (c.total, c.passed, c.failed, c.flaky, c.skipped)
union all
select 'suite'::text,
       s.test_run_id,
       s.id,
       array[s.total, s.passed, s.failed, s.flaky, s.skipped],
       array[c.total, c.passed, c.failed, c.flaky, c.skipped]
  from ouroboros.test_suites s
  join ouroboros.test_suite_counts_computed c on c.test_suite_id = s.id
 where (s.total, s.passed, s.failed, s.flaky, s.skipped)
       is distinct from (c.total, c.passed, c.failed, c.flaky, c.skipped);

comment on view ouroboros.test_results_count_drift is
  'Every attempt or suite whose stored [total, passed, failed, flaky, skipped] differ from the recompute from cases (#324). Empty is the invariant tests/constraints.sql asserts.';

-- ---------------------------------------------------------------------------
-- The DASH reconciliation (#64) — a run's check counts against its latest complete attempt.
-- ---------------------------------------------------------------------------
create view ouroboros.run_check_reconciliation as
select r."id"            as run_id,
       r.organization_id,
       r.checks_passed,
       r.checks_total,
       t.id              as test_run_id,
       t.attempt_seq,
       t.passed          as test_passed,
       t.total           as test_total,
       (r.checks_passed is not distinct from t.passed
        and r.checks_total is not distinct from t.total) as agrees
  from ouroboros.runs r
  join lateral (
         select tr.id, tr.attempt_seq, tr.passed, tr.total
           from ouroboros.test_runs tr
          where tr.run_id = r."id"
            and tr.status = 'complete'
          order by tr.attempt_seq desc
          limit 1
       ) t on true;

comment on view ouroboros.run_check_reconciliation is
  'Maps test results onto the dashboard''s checks_passed/checks_total (#324 against #64): a run''s latest complete attempt, passed → checks_passed and total → checks_total, with agrees false wherever the two surfaces differ. Runs with no complete attempt are absent.';

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason: `ouroboros_app` is the role a deployment that separates
-- *migrating* from *running* connects the API as.
--
--   * **All three are written and rewritten by the parser.** A running attempt fills in, its
--     totals are recounted on every parse, and a re-parse replaces cases — so `update` on all
--     three and `delete` on suites and cases.
--   * **An attempt is not deleted.** It is a point on the timeline, and removing one would
--     renumber the story the strip tells. Attempts leave with their run.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update on ouroboros.test_runs to ouroboros_app;
grant select, insert, update, delete on ouroboros.test_suites to ouroboros_app;
grant select, insert, update, delete on ouroboros.test_cases to ouroboros_app;
grant select on ouroboros.test_suite_counts_computed,
                ouroboros.test_run_counts_computed,
                ouroboros.test_results_count_drift,
                ouroboros.run_check_reconciliation to ouroboros_app;

revoke delete on ouroboros.test_runs from ouroboros_app;
revoke delete on ouroboros.test_runs from public;
