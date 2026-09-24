-- V059__test_coverage_summary.sql — the parsed coverage summary on a coverage artifact, and the
-- per-attempt percentage and delta mockup 11's artifacts row reads.
--
--     coverage 87.4% (+0.6%) ↗
--
-- Filed under issue #328 (AS.5), whose acceptance criterion is that `87.4% (+0.6%)` **computes**
-- from two seeded rows rather than being typed. Decision **T9** of the Test Results roadmap
-- (docs/ROADMAP_MOCKUP_11_TEST_RESULTS.md) makes coverage *"a parsed summary (percent + delta vs
-- previous attempt) from uploaded reports"*, and V055 (#327) registered the coverage file as a
-- `test_artifacts` row of kind `coverage` — but gave the summary nowhere to live. This is that
-- place.
--
--
-- Counts, never percentages.
-- ---------------------------------------------------------------------------
--
-- A coverage report is two numbers — lines covered and lines instrumented — and every figure the
-- card prints is arithmetic over them. So the artifact stores `lines_covered` and `lines_total`,
-- and a percentage stored beside them would be the second place for it to be wrong. Both are
-- required exactly when `kind = 'coverage'` (`test_artifacts_coverage_counts`), covered never
-- exceeds instrumented, and an empty report — nothing instrumented — is refused, because it has
-- no percentage at all rather than a percentage of zero.
--
-- They are frozen with the rest of the file's description: V055's `test_artifacts_lifecycle`
-- compares every column but `storage_ref`, `retained_until` and `expired_at`, so a re-count is a
-- new upload, never an edit.
--
--
-- The delta is against the previous attempt that has coverage.
-- ---------------------------------------------------------------------------
--
-- `test_run_coverage` is one row per attempt with coverage: the attempt's counts (summed over its
-- coverage artifacts — a report split per module is still one attempt's coverage), its
-- percentage to one decimal, and the delta against the **latest earlier attempt of the same run
-- that has coverage** — `null` when there is none. A tombstoned artifact still counts: expiry
-- deletes the bytes, not the fact the summary records.
--
-- The delta is computed from the unrounded ratios and rounded once, so it cannot drift from the
-- two percentages by a rounding step taken twice.

alter table ouroboros.test_artifacts
  add column lines_covered integer,
  add column lines_total   integer,
  add constraint test_artifacts_coverage_counts
    check ((kind = 'coverage') = (lines_covered is not null)
           and (kind = 'coverage') = (lines_total is not null)),
  add constraint test_artifacts_coverage_counts_sane
    check (lines_total is null
           or (lines_total > 0 and lines_covered >= 0 and lines_covered <= lines_total));

comment on column ouroboros.test_artifacts.lines_covered is
  'Lines the coverage report marks covered (#328, decision T9). Set exactly when kind is coverage; never more than lines_total.';
comment on column ouroboros.test_artifacts.lines_total is
  'Lines the coverage report instruments (#328, decision T9). Set exactly when kind is coverage; greater than zero — an empty report has no percentage.';

-- ---------------------------------------------------------------------------
-- The artifacts row's percentage and delta, per attempt.
-- ---------------------------------------------------------------------------
create view ouroboros.test_run_coverage as
with per_attempt as (
  select t.id                          as test_run_id,
         t.organization_id,
         t.run_id,
         t.attempt_seq,
         sum(a.lines_covered)::bigint  as lines_covered,
         sum(a.lines_total)::bigint    as lines_total
    from ouroboros.test_runs t
    join ouroboros.test_artifacts a on a.test_run_id = t.id and a.kind = 'coverage'
   group by t.id
),
with_previous as (
  select p.*,
         lag(p.lines_covered) over w as previous_covered,
         lag(p.lines_total)   over w as previous_total,
         lag(p.attempt_seq)   over w as previous_attempt_seq
    from per_attempt p
  window w as (partition by p.run_id order by p.attempt_seq)
)
select test_run_id,
       organization_id,
       run_id,
       attempt_seq,
       lines_covered,
       lines_total,
       round(100.0 * lines_covered / lines_total, 1)                         as percent,
       previous_attempt_seq,
       case when previous_total is null then null
            else round(100.0 * lines_covered / lines_total
                       - 100.0 * previous_covered / previous_total, 1) end   as delta
  from with_previous;

comment on view ouroboros.test_run_coverage is
  'One row per attempt with a coverage artifact (#328, decision T9): lines covered and instrumented summed over its coverage artifacts, the percentage to one decimal, and the delta in percentage points against the latest earlier attempt of the same run with coverage (null when none) — the artifacts row''s "coverage 87.4% (+0.6%)", computed rather than stored.';

grant select on ouroboros.test_run_coverage to ouroboros_app;
