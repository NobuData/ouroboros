-- V077__estimate_outcomes.sql — `estimate_outcomes`: every merged loop joined to the estimate that
-- governed it, so *"89% of issues land within their predicted band"* is a measurement of the
-- estimator rather than a compliment to it (#435, BI.4, decision I7).
--
-- The intake estimator (#100) predicts an effort and a cycle band — `breakdown.cycle_min` and
-- `cycle_max`, in minutes. Nothing checked whether those predictions came true. This table is
-- that check: one row per merged loop PR, written when the merge is observed, carrying what was
-- predicted, what happened, and whether the second fell inside the first.
--
-- ===========================================================================
-- THE GOVERNING ESTIMATE — the one in force when the work was queued
-- ===========================================================================
--
-- An issue can be re-estimated: the nightly job (#281) re-sizes backlogs and estimates get
-- revised. Grading an outcome against the *latest* estimate would grade the estimator on
-- hindsight — a band revised after the work started would score well for reasons that have
-- nothing to do with prediction. So `ouroboros.record_estimate_outcome()` below joins:
--
--   1. **The queue instant.** The issue's `queue_items.enqueued_at` when that row exists and is
--      no later than the loop's start; otherwise the loop's `runs.started_at`. The fallback is
--      the latest instant the work can have been queued, so it can only choose an *earlier*
--      estimate, never a later one.
--   2. **The estimate in force at that instant.** The newest `issue_estimates` row
--      (`created_at <= queued_at`) whose subject is the PR's canonical ticket (V038) or the
--      mirrored GitHub issue the loop ran on (V026) — the two subjects the intake surfaces size.
--      `created_at` rather than `trace.sized_at`: an answer is in force from when it was stored,
--      not from when an escalated estimator (#123) produced it.
--
-- `queued_at` is stored on the row, so every grade can be audited against the instant it used.
--
-- ===========================================================================
-- THE ACTUAL — the lead-time definition, in one function
-- ===========================================================================
--
-- *Actual duration* is the DORA lead time (`metric_definitions.lead_time`, V076): from the loop
-- starting on the issue to its pull request merging. Not the run's wall clock, which stops at
-- the run's own terminal state. `ouroboros.lead_time_ms()` is that definition, and the only
-- one: this table's fill calls it, and #433's DORA extractor must call it too, so calibration
-- and lead time describe the same interval and cannot disagree.
--
-- ===========================================================================
-- THE GRADE — arithmetic the database does, not a value a writer supplies
-- ===========================================================================
--
-- `within_band` and `deviation_ms` are `generated always … stored` (V018's and V045's answer
-- to "derived, never typed"): PostgreSQL computes them from the predicted band and the actual,
-- and refuses any statement that supplies them. So the grade cannot disagree with its inputs.
--
--   within_band  = actual_duration_ms between cycle_min × 60 000 and cycle_max × 60 000
--                  (inclusive — a band of 12–18 min contains exactly 12 and 18 min)
--   deviation_ms = actual_duration_ms − (cycle_min + cycle_max) × 30 000
--                  (signed distance from the band's midpoint: positive ran over, negative under;
--                   12–18 min with an actual of 14m20s is −40 000)
--
-- Deviation is from the midpoint rather than from the nearer edge so it is non-zero inside the
-- band too: *"L-effort issues run 12% over"* is a bias in where outcomes land, and an
-- edge-distance would read every in-band outcome as no bias at all.
--
-- ===========================================================================
-- UNESTIMATED IS RECORDED, NOT SKIPPED
-- ===========================================================================
--
-- A merged loop with no governing estimate gets a row with every `predicted_*` column null, and
-- so a null grade. Unestimated work is itself a useful count, and a table that dropped it would
-- make the within-band rate look like it covered work it never saw. The predicted columns are
-- all set or all null (`estimate_outcomes_prediction_whole`), and an `estimate_id` implies a
-- prediction.
--
-- `estimate_id` is `on delete set null` and the predicted columns are a snapshot: a grade
-- outlives the estimate row it was taken from (an estimate goes when its ticket does), and a
-- row whose `estimate_id` was nulled that way is still an *estimated* outcome.
--
-- ===========================================================================
-- IDEMPOTENT
-- ===========================================================================
--
-- One row per merged PR (`estimate_outcomes_pr_key`). The fill is an upsert on it, so a
-- replayed merge event re-derives the same row rather than adding a second; every input it
-- reads is fixed once the PR has merged.

-- ---------------------------------------------------------------------------
-- lead_time_ms — the one lead-time definition.
-- ---------------------------------------------------------------------------
create function ouroboros.lead_time_ms(loop_started_at timestamptz, merged_at timestamptz)
returns bigint
language sql
immutable
parallel safe
as $$
  select floor(extract(epoch from (merged_at - loop_started_at)) * 1000)::bigint
$$;

comment on function ouroboros.lead_time_ms(timestamptz, timestamptz) is
  'The DORA lead time in whole milliseconds — loop start (runs.started_at) to merge (pull_requests.merged_at), metric_definitions.lead_time''s definition (#435). estimate_outcomes.actual_duration_ms is this; the DORA extractor (#433) must call it too, so the two cannot disagree.';

-- A PR's id is unique alone; the pair is what a composite reference holding a row to the PR's
-- workspace needs.
alter table ouroboros.pull_requests
  add constraint pull_requests_id_organization_key unique ("id", organization_id);

-- ---------------------------------------------------------------------------
-- estimate_outcomes
-- ---------------------------------------------------------------------------
create table ouroboros.estimate_outcomes (
  id                  uuid        primary key default gen_random_uuid(),

  organization_id     text        not null
                                  references ouroboros.organization ("id") on delete cascade,

  -- The merged PR. Composite with the workspace, so a row cannot name another workspace's PR;
  -- cascades with it.
  pr_id               uuid        not null,

  -- The canonical ticket the PR closed, when it names one — the PR's own `ticket_id` at fill.
  ticket_id           uuid        references ouroboros.tickets (id) on delete set null,

  -- The governing estimate (see the header), or null for unestimated work.
  estimate_id         uuid        references ouroboros.issue_estimates (id) on delete set null,

  -- The instant the governing estimate was chosen at.
  queued_at           timestamptz not null,

  -- What the governing estimate predicted, snapshotted. All set or all null.
  predicted_effort    text
                      constraint estimate_outcomes_predicted_effort
                        check (predicted_effort in ('xs', 's', 'm', 'l', 'xl')),
  predicted_cycle_min integer,
  predicted_cycle_max integer,

  -- Lead time — ouroboros.lead_time_ms(runs.started_at, merged_at).
  actual_duration_ms  bigint      not null
                      constraint estimate_outcomes_actual_nonnegative
                        check (actual_duration_ms >= 0),

  -- The grade. Generated — see THE GRADE. Null exactly when unestimated.
  within_band         boolean
                      generated always as (
                        actual_duration_ms between predicted_cycle_min::bigint * 60000
                                               and predicted_cycle_max::bigint * 60000
                      ) stored,
  deviation_ms        bigint
                      generated always as (
                        actual_duration_ms
                          - (predicted_cycle_min::bigint + predicted_cycle_max::bigint) * 30000
                      ) stored,

  merged_at           timestamptz not null,

  -- When the fill last wrote the row; a replay sets it again.
  computed_at         timestamptz not null default now(),

  constraint estimate_outcomes_pr_fk
    foreign key (pr_id, organization_id)
    references ouroboros.pull_requests ("id", organization_id) on delete cascade,

  constraint estimate_outcomes_pr_key unique (pr_id),

  constraint estimate_outcomes_prediction_whole
    check (num_nulls(predicted_effort, predicted_cycle_min, predicted_cycle_max) in (0, 3)),

  constraint estimate_outcomes_estimate_has_prediction
    check (estimate_id is null or predicted_effort is not null),

  constraint estimate_outcomes_band_order
    check (predicted_cycle_min is null
           or (predicted_cycle_min >= 0 and predicted_cycle_min <= predicted_cycle_max))
);

comment on table ouroboros.estimate_outcomes is
  'Estimator calibration (#435, BI.4, decision I7) — one row per merged loop PR, joined to the estimate in force when the work was queued (never a later revision), with the lead-time actual and a generated grade. Unestimated merges are rows with a null prediction, not omissions. Written by ouroboros.record_estimate_outcome().';
comment on column ouroboros.estimate_outcomes.ticket_id is
  'The canonical ticket the PR closed, copied from pull_requests.ticket_id at fill; null when the PR names none.';
comment on column ouroboros.estimate_outcomes.estimate_id is
  'The governing estimate — the newest issue_estimates row for the ticket or the mirrored issue created no later than queued_at. Null for unestimated work, or once the estimate row is deleted (the prediction snapshot stays).';
comment on column ouroboros.estimate_outcomes.queued_at is
  'The instant the governing estimate was chosen at: queue_items.enqueued_at when it is no later than the loop''s start, else runs.started_at.';
comment on column ouroboros.estimate_outcomes.predicted_effort is
  'The governing estimate''s effort (xs | s | m | l | xl); null when unestimated. The report slices by it.';
comment on column ouroboros.estimate_outcomes.predicted_cycle_min is
  'The governing estimate''s breakdown.cycle_min, in minutes; null when unestimated.';
comment on column ouroboros.estimate_outcomes.predicted_cycle_max is
  'The governing estimate''s breakdown.cycle_max, in minutes; null when unestimated.';
comment on column ouroboros.estimate_outcomes.actual_duration_ms is
  'Lead time, ouroboros.lead_time_ms(runs.started_at, merged_at) — the DORA definition, not the run''s wall clock.';
comment on column ouroboros.estimate_outcomes.within_band is
  'Generated: the actual lies inside [cycle_min, cycle_max] minutes, inclusive. Null when unestimated.';
comment on column ouroboros.estimate_outcomes.deviation_ms is
  'Generated and signed: actual minus the band''s midpoint. Positive ran over, negative ran under. Null when unestimated.';

-- The report: one workspace, a window of merges.
create index estimate_outcomes_organization_merged_idx
  on ouroboros.estimate_outcomes (organization_id, merged_at);

-- The two set-null references, so deleting a ticket or an estimate does not scan the table.
create index estimate_outcomes_ticket_idx
  on ouroboros.estimate_outcomes (ticket_id) where ticket_id is not null;
create index estimate_outcomes_estimate_idx
  on ouroboros.estimate_outcomes (estimate_id) where estimate_id is not null;

-- ---------------------------------------------------------------------------
-- record_estimate_outcome — the fill, one merged PR at a time.
-- ---------------------------------------------------------------------------
create function ouroboros.record_estimate_outcome(p_organization_id text, p_pr_id uuid)
returns setof ouroboros.estimate_outcomes
language sql
volatile
as $$
  with loop_pr as (
    -- A merged PR a loop opened, in the workspace asking. Anything else is not a merged loop.
    select pr."id"          as pr_id,
           pr.organization_id,
           pr.ticket_id,
           pr.merged_at,
           r.started_at     as loop_started_at,
           r.github_repo_id,
           r.issue_number
      from ouroboros.pull_requests pr
      join ouroboros.runs r
        on r."id" = pr.run_id and r.organization_id = pr.organization_id
     where pr."id" = p_pr_id
       and pr.organization_id = p_organization_id
       and pr.state = 'merged'
  ),
  queued as (
    select l.*,
           coalesce(
             (select max(q.enqueued_at)
                from ouroboros.queue_items q
               where q.organization_id = l.organization_id
                 and q.github_repo_id = l.github_repo_id
                 and q.issue_number = l.issue_number
                 and q.enqueued_at <= l.loop_started_at),
             l.loop_started_at) as queued_at
      from loop_pr l
  ),
  governed as (
    select qd.*, e."id" as estimate_id, e.effort,
           (e.breakdown ->> 'cycle_min')::integer as cycle_min,
           (e.breakdown ->> 'cycle_max')::integer as cycle_max
      from queued qd
      left join lateral (
        select candidate.*
          from ouroboros.issue_estimates candidate
         where candidate.created_at <= qd.queued_at
           and (candidate.ticket_id = qd.ticket_id
                or candidate.github_issue_id in (
                     select gi."id"
                       from ouroboros.github_issues gi
                      where gi.organization_id = qd.organization_id
                        and gi.github_repo_id = qd.github_repo_id
                        and gi.number = qd.issue_number))
         order by candidate.created_at desc, candidate.version desc
         limit 1
      ) e on true
  )
  insert into ouroboros.estimate_outcomes
    (organization_id, pr_id, ticket_id, estimate_id, queued_at, predicted_effort,
     predicted_cycle_min, predicted_cycle_max, actual_duration_ms, merged_at)
  select organization_id, pr_id, ticket_id, estimate_id, queued_at, effort,
         cycle_min, cycle_max, ouroboros.lead_time_ms(loop_started_at, merged_at), merged_at
    from governed
  on conflict (pr_id) do update
    set ticket_id           = excluded.ticket_id,
        estimate_id         = excluded.estimate_id,
        queued_at           = excluded.queued_at,
        predicted_effort    = excluded.predicted_effort,
        predicted_cycle_min = excluded.predicted_cycle_min,
        predicted_cycle_max = excluded.predicted_cycle_max,
        actual_duration_ms  = excluded.actual_duration_ms,
        merged_at           = excluded.merged_at,
        computed_at         = now()
  returning *
$$;

comment on function ouroboros.record_estimate_outcome(text, uuid) is
  'The calibration fill (#435): upserts the estimate_outcomes row for one merged loop PR of the workspace — governing estimate chosen at queue time, actual by lead_time_ms(). Returns the row, or no row when the PR is not a merged loop PR of that workspace. Idempotent: a replay re-derives the same row.';

-- ---------------------------------------------------------------------------
-- The registry's calibration rows (V076's methodology registry).
-- ---------------------------------------------------------------------------
insert into ouroboros.metric_definitions
  (metric_id, family, title, formula_text, source_planes, caveats, unit, is_rate, proxy)
values
  ('estimate_within_band_rate', 'calibration', 'Estimator calibration',
   'Merged loops whose lead time fell inside the cycle band of the estimate in force when the work was queued, divided by merged loops that had such an estimate.',
   '{estimates,runs,pull_requests}',
   'The estimate graded is the one in force at queue time, never a later revision. Unestimated merges are left out of both sides and counted separately. Lead time starts when the loop does, so time spent waiting in the queue is not in the actual.',
   'pct', true, false),

  ('estimate_within_band_rate_by_effort', 'calibration', 'Estimator calibration by effort',
   'The within-band rate computed separately for each predicted effort (XS–XL): merged loops of that effort inside their band, divided by merged loops estimated at that effort.',
   '{estimates,runs,pull_requests}',
   'Sliced by the effort predicted at queue time, not the effort the work turned out to need. A slice with few merges swings widely.',
   'pct', true, false),

  ('estimate_band_bias', 'calibration', 'Band bias by effort',
   'For each predicted effort, the sum of every merged loop''s signed distance from its band''s midpoint divided by the sum of the band midpoints. Positive means the work ran over its prediction; negative means under.',
   '{estimates,runs,pull_requests}',
   'Signed, so the calibration report computes it from estimate_outcomes rather than storing it in metric_daily, whose values are non-negative. It measures direction and size of bias, not how many loops missed their band.',
   'pct', true, false);

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
-- The fill runs as the caller, so the service writes the table through the function.
grant select, insert, update on ouroboros.estimate_outcomes to ouroboros_app;
grant execute on function ouroboros.lead_time_ms(timestamptz, timestamptz) to ouroboros_app;
grant execute on function ouroboros.record_estimate_outcome(text, uuid) to ouroboros_app;
