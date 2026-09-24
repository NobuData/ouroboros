-- V054__case_history_flake_scores.sql — `test_case_history`, `flake_score_formulas`,
-- `flake_scores` and `flake_scorer_runs`: the memory behind mockup 11's Flaky stat.
--
--     flaky · 1 · passed on retry 2/3 · quarantine watching
--
-- *"Passed on retry 2/3"* is this build's truth, and V051's `retry_outcomes` already holds it.
-- *"Quarantine watching"* is a claim about a test's behaviour over time — that it has
-- failed-then-passed often enough, recently enough, to be worth distrusting. That needs an
-- occurrence per case per attempt, accumulated against the durable `case_key` (decision T2),
-- and a score computed over a window.
--
-- Filed as issue #326 (AS.3) of the Test Results roadmap
-- (docs/ROADMAP_MOCKUP_11_TEST_RESULTS.md, option 4-A, decision T5). It feeds the flake scorer
-- (AT.3, #331), the strip's Flaky stat (#335) and mockup 15's insights boundary.
--
--
-- Occurrences — one per case per attempt.
-- ---------------------------------------------------------------------------
--
-- `test_case_history` is a row per `test_cases` row: the case's `case_key`, the attempt it ran
-- in, its `status`, `retries` and `pass_on_retry`, and when it was observed. It is keyed on the
-- case row rather than `(test_run_id, case_key)` because a key does not name a platform — the
-- same suite run on `native_sim` and `qemu_cortex_m3` in one attempt is two occurrences of one
-- `case_key`, and both count.
--
-- Everything but the case is **derived, never trusted** — V051's `case_key` pattern.
-- `test_case_history_derive` fills `case_key`, `test_run_id`, `github_repo_id`, `status`,
-- `retries` and `pass_on_retry` from the case when a writer leaves them null and refuses any
-- that disagree; `observed_at` defaults to the attempt's `started_at`. So an occurrence cannot
-- claim a case, a repository or an outcome its case does not have, and the parse-time hook
-- (AT.3) can write `(organization_id, test_case_id)` and nothing else.
--
-- `pass_on_retry` is `status = 'flaky'`, held by a CHECK. It is stored rather than left to be
-- recomputed because it is *the* signal the score counts and the history index carries it: a
-- read of one case's recent window never has to leave the index (see below). And `flaky` is
-- already the sanctioned pass-on-retry — decision T5 has the parser read the pinned DSL
-- `flakes:` policy before it marks a case flaky, so an unsanctioned retry is a `failed`.
--
-- The occurrence is a projection of its case and lives exactly as long as it: a re-parse that
-- replaces cases replaces their occurrences, and an attempt leaves with its run. A case whose
-- status is rewritten *after* its occurrence was taken is listed by
-- `test_case_history_drift`, which `tests/constraints.sql` requires empty — V051's
-- `test_results_count_drift` pattern.
--
-- The read is always *"recent occurrences for this case"*, so
-- `test_case_history_recent_idx` is `(organization_id, case_key, observed_at desc)` and
-- **includes** everything the score reads. A window read is index-only.
--
--
-- The formula — flake score v1.
-- ---------------------------------------------------------------------------
--
-- A flake score nobody can reproduce is a number people learn to ignore, so the formula is
-- written here, versioned, and computed by one function rather than encoded in whatever query
-- happens to run. Every `flake_scores` row is stamped with the `formula_version` that produced
-- it; a re-tuning is a new `flake_score_formulas` row, never an edit of an old one
-- (`flake_score_formulas_frozen`), so an old score stays interpretable against its formula.
--
-- **Version 1** — weighted recent occurrences over runs observed:
--
--     window    the latest N = 20 occurrences of the case in the workspace with
--               observed_at <= as_of and status <> 'skipped', newest first.
--               A skipped case never ran, so it is not an observation.
--     rank      i = 0 for the newest occurrence, 1 for the one before, …
--     weight    w_i = 0.9 ^ i                    — recent behaviour counts most
--     signal    f_i = 1 if pass_on_retry else 0  — a sanctioned pass-on-retry
--
--     score        = round( Σ w_i · f_i  /  Σ w_i , 4 )       in [0, 1]
--     window_runs  = the number of occurrences in the window  (0 … N)
--
-- Ties on `observed_at` are broken by `test_case_id`, so the same occurrences always produce
-- the same number: `ouroboros.flake_score()` is that computation, and the scorer (AT.3) calls
-- it rather than re-deriving it.
--
-- **State** is `ouroboros.flake_state_next()`, with hysteresis so a case does not flap:
--
--     window_runs < 3 (min_observations)   keep the current state (a new case: healthy)
--     score >= 0.25   (watch_at)           watching
--     score <  0.10   (clear_below)        healthy
--     otherwise                            keep the current state
--     quarantined                          kept — the scorer never quarantines or releases
--
-- Mockup 11's telemetry case — flaky in Build 3 (`["failed", "failed", "passed"]`) and Build 1
-- of loop #482 and once in the loop before it, passing clean in between — scores 0.5263 over
-- six occurrences and lands `watching`. The constraints suite computes exactly that.
--
--
-- States — and why `quarantined` is a soft signal.
-- ---------------------------------------------------------------------------
--
-- `flake_scores.state` is `healthy | watching | quarantined`, and only these moves exist
-- (`flake_scores_state_transition`):
--
--     (new) ──▶ healthy ◀──▶ watching ◀──▶ quarantined
--
-- A case is never quarantined without first being watched, never created quarantined, and
-- never released straight to healthy — it goes back through watching, where the score decides.
-- `state_changed_at` is set by the trigger when `state` actually changes and refused when a
-- writer moves it without one, so it always means *"when this case entered this state"*.
--
-- **`quarantined` is storable now and inert now.** Nothing in this schema or the services
-- above it consumes it yet: activation belongs to the PR gate (mockup 12) and to quarantine
-- automation (AV.3, #345). It is in the vocabulary from day one so history is continuous, and
-- its meaning is fixed here, for whoever activates it:
--
--   * **A soft signal, never a hidden one.** A failure of a quarantined case is still recorded
--     in full — its `test_cases` row, its occurrence and its failure payload are written
--     exactly as for any other case, and every count that includes it still includes it.
--   * **Reported distinctly.** Every surface that shows the failure shows it *as* a quarantined
--     failure — labelled, never folded into passed, never omitted.
--   * **Never blocking.** What quarantine changes is only whether that failure gates a merge.
--     It does not skip the test, suppress its result or stop it being scored.
--
-- Hiding failures is the failure mode this whole feature is one bad default away from; this
-- paragraph is where that default is refused.
--
--
-- Scores exist only for observed cases.
-- ---------------------------------------------------------------------------
--
-- A `flake_scores` row is unique per `(organization_id, case_key)` — the key already contains
-- the repository — and `flake_scores_has_history` refuses one whose case has no occurrence in
-- the workspace, or whose `github_repo_id` is not the occurrences' repository. A score of
-- nothing is a fabrication, and that same check is what keeps the repository in the
-- workspace, since `github_repos` has no composite key to reference.
--
--
-- The scorer is observable.
-- ---------------------------------------------------------------------------
--
-- `flake_scorer_runs` is one row per scorer pass (AT.3's nightly job) per workspace: when it
-- started and finished, which formula it applied, how many cases it scored and how many
-- changed state, and why it failed if it did. `duration_ms` is generated from the two
-- timestamps so it cannot disagree with them. The last run is one index read.

-- ---------------------------------------------------------------------------
-- test_case_history — one occurrence per case per attempt.
-- ---------------------------------------------------------------------------
create table ouroboros.test_case_history (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The case this occurrence is. Cascade: an occurrence is a projection of its case.
  test_case_id     uuid        not null,

  -- Derived from the case by test_case_history_derive when written null.
  github_repo_id   uuid        not null
                               references ouroboros.github_repos (id) on delete cascade,
  case_key         text        not null,
  test_run_id      uuid        not null,
  status           text        not null,
  retries          integer     not null,
  pass_on_retry    boolean     not null,

  -- When the attempt ran; defaults to test_runs.started_at.
  observed_at      timestamptz not null,

  created_at       timestamptz not null default now(),

  constraint test_case_history_case_key        unique (test_case_id),

  constraint test_case_history_test_case_fk
    foreign key (test_case_id, organization_id)
    references ouroboros.test_cases (id, organization_id) on delete cascade,

  constraint test_case_history_test_run_fk
    foreign key (test_run_id, organization_id)
    references ouroboros.test_runs (id, organization_id) on delete cascade,

  constraint test_case_history_case_key_shape
    check (case_key ~ '^[0-9a-f]{64}$'),

  constraint test_case_history_status
    check (status in ('passed', 'failed', 'flaky', 'skipped', 'error')),

  constraint test_case_history_retries_non_negative
    check (retries >= 0),

  constraint test_case_history_pass_on_retry
    check (pass_on_retry = (status = 'flaky'))
);

comment on table ouroboros.test_case_history is
  'One occurrence per test case per attempt (#326, AS.3) — the history flake scoring reads, keyed on the durable case_key (decision T2). Everything but the case is derived from it by test_case_history_derive; the occurrence leaves with its case.';
comment on column ouroboros.test_case_history.test_case_id is
  'The test_cases row this occurrence is — composite with organization_id, unique, cascade.';
comment on column ouroboros.test_case_history.pass_on_retry is
  'True exactly when status is flaky — a sanctioned pass on retry (decision T5). The signal flake score v1 counts.';
comment on column ouroboros.test_case_history.observed_at is
  'When the attempt ran. Defaults to test_runs.started_at; orders the scoring window, newest first.';

-- The one read: a case's recent occurrences. INCLUDE makes a window read index-only.
create index test_case_history_recent_idx
  on ouroboros.test_case_history (organization_id, case_key, observed_at desc)
  include (test_case_id, status, retries, pass_on_retry);

-- The attempt's cascade, and "every occurrence of this build".
create index test_case_history_test_run_idx
  on ouroboros.test_case_history (test_run_id);

-- ---------------------------------------------------------------------------
-- An occurrence is derived from its case, never trusted.
-- ---------------------------------------------------------------------------
create function ouroboros.test_case_history_derive()
returns trigger
language plpgsql
as $$
declare
  c record;
begin
  -- Scoped to this workspace: another workspace's case is test_case_history_test_case_fk's.
  select tc.case_key, tc.status, tc.retries, s.test_run_id, r.github_repo_id, t.started_at
    into c
    from ouroboros.test_cases tc
    join ouroboros.test_suites s on s.id = tc.test_suite_id
    join ouroboros.test_runs t   on t.id = s.test_run_id
    join ouroboros.runs r        on r."id" = t.run_id
   where tc.id = new.test_case_id
     and tc.organization_id = new.organization_id;

  -- Raised here rather than left to the foreign key, which would never be reached: the
  -- derived columns are not null, and that check fires first.
  if not found then
    raise exception 'test case % is not a case of organization %',
      new.test_case_id, new.organization_id
      using errcode = 'foreign_key_violation', constraint = 'test_case_history_test_case_fk';
  end if;

  new.case_key       := coalesce(new.case_key, c.case_key);
  new.test_run_id    := coalesce(new.test_run_id, c.test_run_id);
  new.github_repo_id := coalesce(new.github_repo_id, c.github_repo_id);
  new.status         := coalesce(new.status, c.status);
  new.retries        := coalesce(new.retries, c.retries);
  new.pass_on_retry  := coalesce(new.pass_on_retry, c.status = 'flaky');
  new.observed_at    := coalesce(new.observed_at, c.started_at);

  if (new.case_key, new.test_run_id, new.github_repo_id, new.status, new.retries)
     is distinct from (c.case_key, c.test_run_id, c.github_repo_id, c.status, c.retries) then
    raise exception
      'occurrence of case % disagrees with the case it records (case_key, test run, repository, status or retries)',
      new.test_case_id
      using errcode = 'check_violation', constraint = 'test_case_history_agrees_with_case';
  end if;

  return new;
end;
$$;

comment on function ouroboros.test_case_history_derive() is
  'Fills an occurrence''s case_key, test_run_id, github_repo_id, status, retries, pass_on_retry and observed_at from its test case when written null, and refuses any that disagree (#326).';

create trigger test_case_history_derive
  before insert or update on ouroboros.test_case_history
  for each row execute function ouroboros.test_case_history_derive();

-- ---------------------------------------------------------------------------
-- Where an occurrence and its case have come apart — empty is the invariant.
-- ---------------------------------------------------------------------------
create view ouroboros.test_case_history_drift as
select h.id                     as test_case_history_id,
       h.test_case_id,
       array[h.status, h.retries::text] as recorded,
       array[c.status, c.retries::text] as current
  from ouroboros.test_case_history h
  join ouroboros.test_cases c on c.id = h.test_case_id
 where (h.status, h.retries) is distinct from (c.status, c.retries);

comment on view ouroboros.test_case_history_drift is
  'Every occurrence whose recorded [status, retries] differ from its test case''s current values (#326) — a case rewritten after its occurrence was taken. Empty is the invariant tests/constraints.sql asserts; the fix is to rewrite the occurrence with the case.';

-- ---------------------------------------------------------------------------
-- flake_score_formulas — every formula a score was ever computed by.
-- ---------------------------------------------------------------------------
create table ouroboros.flake_score_formulas (
  version           integer     primary key,

  -- How many recent non-skipped occurrences the window holds.
  window_size       integer     not null,

  -- w_i = decay ^ i, i = 0 for the newest occurrence.
  decay             numeric     not null,

  -- score >= watch_at → watching; score < clear_below → healthy; between → unchanged.
  watch_at          numeric     not null,
  clear_below       numeric     not null,

  -- Fewer observations than this and the state is left as it is.
  min_observations  integer     not null,

  description       text        not null,

  created_at        timestamptz not null default now(),

  constraint flake_score_formulas_version_positive
    check (version >= 1),

  constraint flake_score_formulas_window_size
    check (window_size >= 1),

  constraint flake_score_formulas_decay
    check (decay > 0 and decay <= 1),

  constraint flake_score_formulas_thresholds
    check (clear_below >= 0 and clear_below <= watch_at and watch_at <= 1),

  constraint flake_score_formulas_min_observations
    check (min_observations between 1 and window_size),

  constraint flake_score_formulas_description_present
    check (length(btrim(description)) > 0)
);

comment on table ouroboros.flake_score_formulas is
  'The versioned flake score formulas (#326). Frozen once written: a re-tuning is a new version, so every flake_scores row stays interpretable against the formula that produced it. Version 1 is documented in V054''s header.';

insert into ouroboros.flake_score_formulas
    (version, window_size, decay, watch_at, clear_below, min_observations, description)
  values
    (1, 20, 0.9, 0.25, 0.10, 3,
     'Weighted recent occurrences over runs observed: the latest 20 non-skipped occurrences newest first, weight 0.9^i, signal 1 for a pass on retry; score = round(sum(w*f)/sum(w), 4). Watching at >= 0.25, healthy below 0.10, unchanged between or under 3 observations.');

create function ouroboros.flake_score_formulas_frozen()
returns trigger
language plpgsql
as $$
begin
  raise exception 'flake score formula % is published and cannot be changed; add a new version',
    old.version
    using errcode = 'check_violation', constraint = 'flake_score_formulas_frozen';
end;
$$;

comment on function ouroboros.flake_score_formulas_frozen() is
  'Refuses changing a published flake score formula (#326) — scores stamped with its version must stay reproducible.';

create trigger flake_score_formulas_frozen
  before update on ouroboros.flake_score_formulas
  for each row execute function ouroboros.flake_score_formulas_frozen();

-- ---------------------------------------------------------------------------
-- The score — one function, so the same occurrences always produce the same number.
-- ---------------------------------------------------------------------------
create function ouroboros.flake_score(
  p_organization_id text,
  p_case_key        text,
  p_formula_version integer,
  p_as_of           timestamptz default now()
) returns table (score numeric, window_runs integer)
language sql
stable
as $$
  with f as (
    select window_size, decay
      from ouroboros.flake_score_formulas
     where version = p_formula_version
  ),
  w as (
    select h.pass_on_retry,
           row_number() over (order by h.observed_at desc, h.test_case_id) - 1 as i
      from ouroboros.test_case_history h
     where h.organization_id = p_organization_id
       and h.case_key = p_case_key
       and h.observed_at <= p_as_of
       and h.status <> 'skipped'
     order by h.observed_at desc, h.test_case_id
     limit (select window_size from f)
  )
  select coalesce(round(sum(power(f.decay, w.i) * (w.pass_on_retry)::int)
                        / nullif(sum(power(f.decay, w.i)), 0), 4), 0),
         count(w.i)::integer
    from f
    left join w on true
   group by f.decay
$$;

comment on function ouroboros.flake_score(text, text, integer, timestamptz) is
  'Flake score of one case under a formula version as of a moment (#326): the latest window_size non-skipped occurrences newest first (ties by test_case_id), weight decay^i, signal 1 for a pass on retry; score = round(sum(w*f)/sum(w), 4), 0 with no observations. Returns no row for an unknown formula version. Deterministic for a fixed as_of.';

-- ---------------------------------------------------------------------------
-- The next state — thresholds with hysteresis; quarantine is never the scorer's to change.
-- ---------------------------------------------------------------------------
create function ouroboros.flake_state_next(
  p_formula_version integer,
  p_current         text,
  p_score           numeric,
  p_window_runs     integer
) returns text
language sql
stable
as $$
  select case
           when p_current = 'quarantined'        then 'quarantined'
           when p_window_runs < f.min_observations then coalesce(p_current, 'healthy')
           when p_score >= f.watch_at             then 'watching'
           when p_score <  f.clear_below          then 'healthy'
           else coalesce(p_current, 'healthy')
         end
    from ouroboros.flake_score_formulas f
   where f.version = p_formula_version
$$;

comment on function ouroboros.flake_state_next(integer, text, numeric, integer) is
  'The state a score moves a case to under a formula version (#326): quarantined is kept; under min_observations the current state is kept (healthy when new); score >= watch_at is watching; score < clear_below is healthy; between, unchanged. Null for an unknown formula version.';

-- ---------------------------------------------------------------------------
-- flake_scores — one current score and state per case per workspace.
-- ---------------------------------------------------------------------------
create table ouroboros.flake_scores (
  id                uuid        primary key default gen_random_uuid(),

  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,

  -- Held to the case's occurrences by flake_scores_has_history.
  github_repo_id    uuid        not null
                                references ouroboros.github_repos (id) on delete cascade,

  case_key          text        not null,

  score             numeric     not null,

  -- How many occurrences the score covers.
  window_runs       integer     not null,

  formula_version   integer     not null
                                references ouroboros.flake_score_formulas (version),

  state             text        not null default 'healthy',

  last_scored_at    timestamptz not null default now(),

  -- Set by flake_scores_state_transition when state changes, and only then.
  state_changed_at  timestamptz not null default now(),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint flake_scores_case_key             unique (organization_id, case_key),

  constraint flake_scores_case_key_shape
    check (case_key ~ '^[0-9a-f]{64}$'),

  constraint flake_scores_score_range
    check (score >= 0 and score <= 1),

  constraint flake_scores_window_runs_non_negative
    check (window_runs >= 0),

  constraint flake_scores_state
    check (state in ('healthy', 'watching', 'quarantined'))
);

comment on table ouroboros.flake_scores is
  'The current flake score and state of each case per workspace (#326, AS.3) — mockup 11''s "quarantine watching". Unique per (organization_id, case_key); every row stamped with its formula_version; transitions constrained by flake_scores_state_transition. quarantined is a soft signal — see V054''s header.';
comment on column ouroboros.flake_scores.score is
  'ouroboros.flake_score() under formula_version, in [0, 1].';
comment on column ouroboros.flake_scores.window_runs is
  'How many occurrences the score covers — at most the formula''s window_size.';
comment on column ouroboros.flake_scores.formula_version is
  'The flake_score_formulas version that produced this score — what makes a re-tuning traceable.';
comment on column ouroboros.flake_scores.state is
  'healthy | watching | quarantined. quarantined is storable now and inert now: a soft signal — reported distinctly, never hidden, never blocking — activated by mockup 12''s PR gate and AV.3 (#345).';
comment on column ouroboros.flake_scores.state_changed_at is
  'When the case entered its current state. Moves only when state actually changes.';

-- "Everything watching in this workspace" — the strip's stat and the insights candidates.
create index flake_scores_state_idx
  on ouroboros.flake_scores (organization_id, state)
  where state <> 'healthy';

create trigger flake_scores_touch_updated_at
  before update on ouroboros.flake_scores
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A score is of an observed case, in its own repository.
-- ---------------------------------------------------------------------------
create function ouroboros.flake_scores_has_history()
returns trigger
language plpgsql
as $$
declare
  repo uuid;
begin
  select h.github_repo_id into repo
    from ouroboros.test_case_history h
   where h.organization_id = new.organization_id
     and h.case_key = new.case_key
   limit 1;

  if not found then
    raise exception 'no occurrence of case % in organization % to score',
      new.case_key, new.organization_id
      using errcode = 'check_violation', constraint = 'flake_scores_has_history';
  end if;

  if repo is distinct from new.github_repo_id then
    raise exception 'case % was observed in repository %, not %',
      new.case_key, repo, new.github_repo_id
      using errcode = 'check_violation', constraint = 'flake_scores_has_history';
  end if;

  return new;
end;
$$;

comment on function ouroboros.flake_scores_has_history() is
  'Refuses a flake score for a case with no occurrence in the workspace, or whose github_repo_id is not the occurrences'' repository (#326).';

create trigger flake_scores_has_history
  before insert or update of organization_id, case_key, github_repo_id on ouroboros.flake_scores
  for each row execute function ouroboros.flake_scores_has_history();

-- ---------------------------------------------------------------------------
-- Only the drawn transitions, and state_changed_at moves with state.
-- ---------------------------------------------------------------------------
create function ouroboros.flake_scores_state_transition()
returns trigger
language plpgsql
as $$
begin
  -- An unknown state is flake_scores_state's to refuse, by its own name.
  if new.state not in ('healthy', 'watching', 'quarantined') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.state = 'quarantined' then
      raise exception 'a case is watched before it is quarantined; it cannot start quarantined'
        using errcode = 'check_violation', constraint = 'flake_scores_state_transition';
    end if;
    return new;
  end if;

  if new.state is not distinct from old.state then
    if new.state_changed_at is distinct from old.state_changed_at then
      raise exception 'state_changed_at moves only when state changes'
        using errcode = 'check_violation', constraint = 'flake_scores_state_changed_at';
    end if;
    return new;
  end if;

  if (old.state, new.state) not in (('healthy', 'watching'),
                                    ('watching', 'healthy'),
                                    ('watching', 'quarantined'),
                                    ('quarantined', 'watching')) then
    raise exception 'flake state cannot move from % to %', old.state, new.state
      using errcode = 'check_violation', constraint = 'flake_scores_state_transition';
  end if;

  new.state_changed_at := now();
  return new;
end;
$$;

comment on function ouroboros.flake_scores_state_transition() is
  'Holds flake_scores.state to healthy <-> watching <-> quarantined (#326): never created quarantined, never healthy <-> quarantined directly. Sets state_changed_at on an actual change and refuses moving it otherwise.';

create trigger flake_scores_state_transition
  before insert or update on ouroboros.flake_scores
  for each row execute function ouroboros.flake_scores_state_transition();

-- ---------------------------------------------------------------------------
-- flake_scorer_runs — the nightly scorer's bookkeeping, one row per pass per workspace.
-- ---------------------------------------------------------------------------
create table ouroboros.flake_scorer_runs (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  formula_version  integer     not null
                               references ouroboros.flake_score_formulas (version),

  status           text        not null default 'running',

  started_at       timestamptz not null default now(),
  finished_at      timestamptz,

  duration_ms      bigint      generated always as
                     ((extract(epoch from (finished_at - started_at)) * 1000)::bigint) stored,

  cases_scored     integer     not null default 0,
  state_changes    integer     not null default 0,

  error            text,

  constraint flake_scorer_runs_status
    check (status in ('running', 'complete', 'error')),

  constraint flake_scorer_runs_finished
    check ((status = 'running') = (finished_at is null)),

  constraint flake_scorer_runs_finished_after_start
    check (finished_at is null or finished_at >= started_at),

  constraint flake_scorer_runs_counts
    check (cases_scored >= 0 and state_changes >= 0 and state_changes <= cases_scored),

  constraint flake_scorer_runs_error
    check ((status = 'error') = (error is not null and length(btrim(error)) > 0))
);

comment on table ouroboros.flake_scorer_runs is
  'One row per flake scorer pass per workspace (#326) — AT.3''s nightly job, observable: when it ran, the formula it applied, cases scored, state changes and why it failed.';
comment on column ouroboros.flake_scorer_runs.duration_ms is
  'finished_at - started_at in milliseconds, generated; null while running.';
comment on column ouroboros.flake_scorer_runs.state_changes is
  'How many of the cases scored changed state in this pass — never more than cases_scored.';

-- The last run of a workspace.
create index flake_scorer_runs_recent_idx
  on ouroboros.flake_scorer_runs (organization_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason.
--
--   * **An occurrence is written once.** The parse-time hook inserts it; a re-parse replaces
--     the case and the occurrence leaves with it. Nothing updates or deletes one directly.
--   * **Formulas are migrations.** A new version ships as a migration, so the app only reads.
--   * **Scores are rewritten by the scorer** and leave with their workspace or repository.
--   * **A scorer run fills in** from running to its outcome, and is kept.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert on ouroboros.test_case_history to ouroboros_app;
grant select on ouroboros.flake_score_formulas to ouroboros_app;
grant select, insert, update on ouroboros.flake_scores to ouroboros_app;
grant select, insert, update on ouroboros.flake_scorer_runs to ouroboros_app;
grant select on ouroboros.test_case_history_drift to ouroboros_app;
grant execute on function ouroboros.flake_score(text, text, integer, timestamptz),
                          ouroboros.flake_state_next(integer, text, numeric, integer)
  to ouroboros_app;
