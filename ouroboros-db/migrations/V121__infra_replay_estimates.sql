-- V121__infra_replay_estimates.sql — what "a similar build" means, the arithmetic over the builds
-- and test runs that match, and a stage row that can say "not enough history yet" (#561, CD.3).
--
-- A dry run never dispatches to the farm (decision W4). Its build and test rows are **replayed
-- from history**: `est. 4m 02s (214 similar builds, ±20s)` is arithmetic over builds this farm
-- actually ran, with the sample attached — never a model's guess. The estimator is a service in
-- `ouroboros-rest`; what lives here is everything two readers must agree on, so that the same key
-- means the same thing to the service, to the Details popover and to the dev seed:
--
--   1. **The similarity class.** Two builds are comparable when the workspace, the repository,
--      the pool, the executor and the **configuration class** match. The configuration class is
--      `build_config_class(executor, image, command)`: the container image **without its tag or
--      digest**, plus the command with its whitespace collapsed — so an SDK bump
--      (`zephyr-sdk:0.16` → `0.17`) keeps its history, while `west build …` and
--      `west build … -- -DCONFIG_…` stay apart. A shell build has no image; its class is its
--      command. All three are read from the job's own snapshot (V040), never through the pool.
--   2. **The sample.** `build_replay_sample()` and `test_replay_sample()` return the count, the
--      median and the spread of the matching history in a window. The spread is the **median
--      absolute deviation** — the median distance from the median — which is what the `±` on the
--      card means, and which one stuck build cannot move the way it moves a standard deviation.
--   3. **The policy.** `replay_estimate_policy()` is the window (30 days) and the sample floor
--      (20). Below the floor the honest answer is *insufficient history*, with the count found.
--   4. **The record.** V111 let a `replayed` stage row hold only a numeric estimate. It may now
--      also carry the window it was computed over (`window_days`), or — instead of a number —
--      `insufficient_history: true` with the count that was found.
--
-- Only **succeeded** builds are measured: a build that failed in fifty seconds did not take
-- fifty seconds to build. A test run counts when it is `complete` with a wall time, and belongs
-- to a run that was not driven by a simulator.
--
-- Cache context is reported beside the estimate, never folded into it: of the sampled builds
-- that reported ccache statistics, those whose hit rate is at least one half are *warm*, the rest
-- *cold*, and each side gets its own count and median — so a reader sees that a cold build is a
-- different animal, and the headline median is not silently a blend they cannot see.

-- ---------------------------------------------------------------------------
-- The policy
-- ---------------------------------------------------------------------------

-- replay_estimate_policy() — the window and the sample floor every replay estimate is held to.
--   returns one row: window_days — how far back history is read; sample_floor — the fewest
--   matching samples an estimate may rest on
create function ouroboros.replay_estimate_policy()
returns table (window_days integer, sample_floor integer)
language sql immutable as $$
  select 30, 20;
$$;

comment on function ouroboros.replay_estimate_policy() is
  'The window (days) and the sample floor of a replay estimate (#561, CD.3). Fewer matching samples than the floor is insufficient history: the estimator answers with the count it found and no number.';

-- ---------------------------------------------------------------------------
-- The similarity class
-- ---------------------------------------------------------------------------

-- build_image_name(image) — a container image reference without its tag or digest.
--   image — the reference, e.g. ghcr.io/acme/zephyr-sdk:0.16 or registry:5000/sdk@sha256:…
--   returns the repository part (ghcr.io/acme/zephyr-sdk, registry:5000/sdk); null for null
create function ouroboros.build_image_name(image text)
returns text language sql immutable as $$
  -- The digest goes first; then a tag is a colon with no slash after it, which is what keeps a
  -- registry's port (`registry:5000/sdk`) from being read as one.
  select regexp_replace(regexp_replace(btrim(image), '@.*$', ''), ':[^/:]*$', '');
$$;

comment on function ouroboros.build_image_name(text) is
  'A container image reference without its tag or digest (#561): the part of an image that survives an SDK bump, and half of a container build''s configuration class.';

-- build_config_class(executor, image, command) — a build's configuration class.
--   executor — container | shell, from the job's snapshot
--   image    — the job's image snapshot (null for a shell build)
--   command  — the job's command snapshot
--   returns `<image name> · <command>` for a container build and `<command>` for a shell one,
--   the command with its whitespace collapsed
create function ouroboros.build_config_class(executor text, image text, command text)
returns text language sql immutable as $$
  select case when executor = 'container'
              then ouroboros.build_image_name(image) || ' · '
              else '' end
         || regexp_replace(btrim(command), '\s+', ' ', 'g');
$$;

comment on function ouroboros.build_config_class(text, text, text) is
  'A build''s configuration class (#561, CD.3): the image without its tag plus the whitespace-collapsed command for a container build, the command alone for a shell build. With the workspace, repository, pool and executor it is the similarity key — the same job characteristics always give the same class.';

-- build_similarity_class(pool, repository, executor, image, command) — the similarity class as
-- the card and the popover print it.
--   pool, repository — their names
--   executor, image, command — as build_config_class() takes them
--   returns `<pool> · <repository> · <executor> · <configuration class>`
create function ouroboros.build_similarity_class(pool text, repository text, executor text,
                                                 image text, command text)
returns text language sql immutable as $$
  select pool || ' · ' || repository || ' · ' || executor || ' · '
         || ouroboros.build_config_class(executor, image, command);
$$;

comment on function ouroboros.build_similarity_class(text, text, text, text, text) is
  'The similarity class of a build as it is printed and stored on a replayed stage row (#561): pool · repository · executor · configuration class.';

-- test_suite_set(test_run) — the suite set of a test run.
--   p_test_run — the test run
--   returns its distinct suite names, sorted; the empty array for a run with no suites
create function ouroboros.test_suite_set(p_test_run uuid)
returns text[] language sql stable as $$
  select coalesce(array_agg(distinct s.name order by s.name), '{}')
    from ouroboros.test_suites s
   where s.test_run_id = p_test_run;
$$;

comment on function ouroboros.test_suite_set(uuid) is
  'The sorted, distinct suite names a test run reported (#561). Two test runs are comparable when the repository and this set match — so a full sweep is never averaged with a smoke run.';

-- test_similarity_class(repository, suites) — the similarity class of a test run as printed.
--   repository — its name
--   suites     — a suite set, as test_suite_set() returns it
--   returns `<repository> · tests · <suite> + <suite> …`
create function ouroboros.test_similarity_class(repository text, suites text[])
returns text language sql immutable as $$
  select repository || ' · tests · ' || array_to_string(suites, ' + ');
$$;

comment on function ouroboros.test_similarity_class(text, text[]) is
  'The similarity class of a test run as it is printed and stored on a replayed stage row (#561): repository · tests · the suite set.';

-- ---------------------------------------------------------------------------
-- The samples
-- ---------------------------------------------------------------------------

-- build_replay_sample(…) — the statistics of the builds similar to one, in a window.
--   p_organization_id — the workspace
--   p_github_repo_id  — the repository
--   p_pool_id         — the pool
--   p_executor, p_image, p_command — the configuration to match, as build_config_class() takes it
--   p_until           — the window's end (exclusive of nothing: a build finishing at it counts)
--   p_window_days     — the window's length
--   returns one row: sample_count; median_ms and spread_ms (the median absolute deviation), both
--   null when nothing matched; cache_measured, the sampled builds that reported ccache
--   statistics; warm_count / warm_median_ms for those with a hit rate of at least one half and
--   cold_count / cold_median_ms for the rest (a median is null when its count is 0)
create function ouroboros.build_replay_sample(p_organization_id text, p_github_repo_id uuid,
                                              p_pool_id uuid, p_executor text, p_image text,
                                              p_command text, p_until timestamptz,
                                              p_window_days integer)
returns table (sample_count bigint, median_ms bigint, spread_ms bigint, cache_measured bigint,
               warm_count bigint, warm_median_ms bigint, cold_count bigint, cold_median_ms bigint)
language sql stable as $$
  with sample as (
    select (extract(epoch from (j.finished_at - j.started_at)) * 1000)::bigint as ms,
           case when j.ccache_stats is null then null
                else (j.ccache_stats ->> 'hits')::numeric
                     / ((j.ccache_stats ->> 'hits')::numeric + (j.ccache_stats ->> 'misses')::numeric)
           end as hit_rate
      from ouroboros.build_jobs j
     where j.organization_id = p_organization_id
       and j.github_repo_id = p_github_repo_id
       and j.pool_id = p_pool_id
       and j.executor = p_executor
       and j.status = 'succeeded'
       and j.started_at is not null
       and j.finished_at > p_until - make_interval(days => p_window_days)
       and j.finished_at <= p_until
       and ouroboros.build_config_class(j.executor, j.image, j.command)
           = ouroboros.build_config_class(p_executor, p_image, p_command)
  ), centre as (
    select percentile_cont(0.5) within group (order by ms) as median from sample
  )
  select count(*),
         round((select median from centre))::bigint,
         round(percentile_cont(0.5) within group (order by abs(ms - (select median from centre))))::bigint,
         count(hit_rate),
         count(*) filter (where hit_rate >= 0.5),
         round(percentile_cont(0.5) within group (order by ms) filter (where hit_rate >= 0.5))::bigint,
         count(*) filter (where hit_rate < 0.5),
         round(percentile_cont(0.5) within group (order by ms) filter (where hit_rate < 0.5))::bigint
    from sample;
$$;

comment on function ouroboros.build_replay_sample(text, uuid, uuid, text, text, text, timestamptz, integer) is
  'The count, median and median absolute deviation of the start-to-finish wall time of the succeeded builds similar to one — same workspace, repository, pool, executor and configuration class — that finished in the window, with the warm (ccache hit rate ≥ ½) and cold halves of those that reported cache statistics counted and medianed apart (#561, CD.3). It applies no floor: the caller decides whether the count is enough to say a number.';

-- test_replay_sample(…) — the statistics of the test runs similar to a suite set, in a window.
--   p_organization_id — the workspace
--   p_github_repo_id  — the repository
--   p_suites          — the suite set to match; null takes the set of the repository's most
--                       recent measured test run
--   p_until, p_window_days — the window, as build_replay_sample() takes it
--   returns one row: suites, the set that was matched (null when none was given and the
--   repository has no measured test run); sample_count; median_ms and spread_ms of the wall
--   time, both null when nothing matched
create function ouroboros.test_replay_sample(p_organization_id text, p_github_repo_id uuid,
                                             p_suites text[], p_until timestamptz,
                                             p_window_days integer)
returns table (suites text[], sample_count bigint, median_ms bigint, spread_ms bigint)
language sql stable as $$
  with measured as (
    select t.id, t.wall_ms, t.started_at
      from ouroboros.test_runs t
      join ouroboros.runs r on r."id" = t.run_id and r.organization_id = t.organization_id
     where t.organization_id = p_organization_id
       and r.github_repo_id = p_github_repo_id
       and not r.simulated
       and t.status = 'complete'
       and t.wall_ms is not null
       and t.started_at <= p_until
  ), wanted as (
    select coalesce(
             (select array_agg(distinct name order by name) from unnest(p_suites) as name),
             (select ouroboros.test_suite_set(m.id) from measured m
               order by m.started_at desc, m.id limit 1)) as suites
  ), sample as (
    select m.wall_ms as ms
      from measured m, wanted w
     where m.started_at > p_until - make_interval(days => p_window_days)
       and ouroboros.test_suite_set(m.id) = w.suites
  ), centre as (
    select percentile_cont(0.5) within group (order by ms) as median from sample
  )
  select (select w.suites from wanted w),
         count(*),
         round((select median from centre))::bigint,
         round(percentile_cont(0.5) within group (order by abs(ms - (select median from centre))))::bigint
    from sample;
$$;

comment on function ouroboros.test_replay_sample(text, uuid, text[], timestamptz, integer) is
  'The count, median and median absolute deviation of the wall time of the complete, measured test runs of a repository that reported exactly a suite set and started in the window; runs driven by a simulator are not history (#561, CD.3). Given no suite set it takes the one the repository''s most recent measured test run reported. Test estimates rest on test history, never on build history.';

-- ---------------------------------------------------------------------------
-- The note, as the card prints it
-- ---------------------------------------------------------------------------

-- replay_duration_label(ms) — a duration the way the dry-run card writes one.
--   ms — milliseconds, rounded to the second
--   returns `20s`, `4m 02s`, `1h 03m 20s`
create function ouroboros.replay_duration_label(ms bigint)
returns text language sql immutable as $$
  with t as (select round(ms / 1000.0)::bigint as s)
  select case
           when s < 60 then s || 's'
           when s < 3600 then (s / 60) || 'm ' || lpad((s % 60)::text, 2, '0') || 's'
           else (s / 3600) || 'h ' || lpad(((s % 3600) / 60)::text, 2, '0') || 'm '
                || lpad((s % 60)::text, 2, '0') || 's'
         end
    from t;
$$;

comment on function ouroboros.replay_duration_label(bigint) is
  'A duration as the dry-run card writes it — 20s, 4m 02s, 1h 03m 20s (#561).';

-- replay_estimate_note(kind, estimate_ms, sample_count, spread_ms) — a replayed row's note.
--   kind         — what was sampled: `build` or `test`
--   estimate_ms  — the median; null for insufficient history
--   sample_count — the samples the estimate rests on, or the count found below the floor
--   spread_ms    — the median absolute deviation; null for insufficient history
--   returns `est. 4m 02s (214 similar builds, ±20s)`, or below the floor
--   `insufficient history — the first real build will measure this (7 similar builds found)`;
--   a test estimate says `test runs` and `test run`
create function ouroboros.replay_estimate_note(kind text, estimate_ms bigint, sample_count bigint,
                                               spread_ms bigint)
returns text language sql immutable as $$
  with noun as (select case kind when 'test' then 'test run' else 'build' end as one)
  select case
           when estimate_ms is null
             then 'insufficient history — the first real ' || one || ' will measure this ('
                  || sample_count || ' similar ' || one || case sample_count when 1 then '' else 's' end
                  || ' found)'
           else 'est. ' || ouroboros.replay_duration_label(estimate_ms) || ' (' || sample_count
                || ' similar ' || one || case sample_count when 1 then '' else 's' end
                || ', ±' || ouroboros.replay_duration_label(spread_ms) || ')'
         end
    from noun;
$$;

comment on function ouroboros.replay_estimate_note(text, bigint, bigint, bigint) is
  'A replayed dry-run row''s note (#561): the estimate with its sample and spread, or — with no estimate — the honest fallback naming the count that was found.';

-- ---------------------------------------------------------------------------
-- The record: a replayed row carries its window, or says it had too little history
-- ---------------------------------------------------------------------------

-- dry_run_stage_metrics_valid(how, metrics) — whether a stage's metrics fit its `how`.
--   Every stage may carry tokens, cost_cents, files_touched, simulated_writes, lines_added and
--   lines_removed (non-negative integers). A `replayed` stage must carry a non-blank
--   similarity_class and a sample_count, and then exactly one of:
--     * an estimate — estimate_ms and spread_ms, with sample_count ≥ 1; or
--     * insufficient_history: true — no estimate_ms and no spread_ms, sample_count ≥ 0.
--   Either may carry window_days (≥ 1), the window the sample was read over. No other stage may
--   carry any of these.
--   how     — the stage's how (llm | replayed | deterministic | skipped)
--   metrics — the jsonb value to inspect
--   returns true when well-formed
create or replace function ouroboros.dry_run_stage_metrics_valid(how text, metrics jsonb)
returns boolean language plpgsql immutable as $$
declare
  key text;
  replay_keys constant text[] := array['estimate_ms', 'sample_count', 'spread_ms', 'similarity_class',
                                       'window_days', 'insufficient_history'];
  count_keys constant text[] := array['tokens', 'cost_cents', 'files_touched', 'simulated_writes',
                                      'lines_added', 'lines_removed', 'estimate_ms', 'sample_count',
                                      'spread_ms', 'window_days'];
begin
  if jsonb_typeof(metrics) is distinct from 'object' then
    return false;
  end if;
  for key in select k from jsonb_object_keys(metrics) k loop
    if key = 'similarity_class' then
      if not ouroboros.jsonb_nonblank_string(metrics -> key) then
        return false;
      end if;
    elsif key = 'insufficient_history' then
      -- Present means true: a row that had enough history says so by carrying its estimate.
      if metrics -> key is distinct from 'true'::jsonb then
        return false;
      end if;
    elsif key = any (count_keys) then
      if not ouroboros.jsonb_nonneg_int(metrics -> key) then
        return false;
      end if;
    else
      return false;
    end if;
  end loop;

  if how <> 'replayed' then
    return not (metrics ?| replay_keys);
  end if;

  if not (metrics ?& array['sample_count', 'similarity_class']) then
    return false;
  end if;
  if metrics ? 'window_days' and (metrics ->> 'window_days')::bigint < 1 then
    return false;
  end if;
  if metrics ? 'insufficient_history' then
    return not (metrics ?| array['estimate_ms', 'spread_ms']);
  end if;
  return metrics ?& array['estimate_ms', 'spread_ms'] and (metrics ->> 'sample_count')::bigint >= 1;
end;
$$;

comment on function ouroboros.dry_run_stage_metrics_valid(text, jsonb) is
  'True when a stage''s metrics are an object of known keys — tokens, cost_cents, files_touched, simulated_writes, lines_added, lines_removed (non-negative integers) — and, exactly on a replayed stage, its basis: a non-blank similarity_class and a sample_count, with either the estimate (estimate_ms, spread_ms, sample_count ≥ 1) or insufficient_history: true and no number, and optionally the window_days it was read over (#557; the window and the insufficient form are #561''s).';

-- dry_run_stage_how_label() is unchanged: a replayed row reads `replayed from history` whether
-- or not history was enough to say a number.
