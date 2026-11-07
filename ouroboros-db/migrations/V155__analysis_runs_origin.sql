-- ===========================================================================
-- V155 — the data origin an analysis read (#2022)
-- ===========================================================================
--
-- DJ.2 (#1315) made the analyzer's corpus read `live` rows only, so a workspace whose history is
-- all demo data — the development seed, and the e2e stack built on it — had nothing to analyse,
-- and its seeded analyses drew no chart. The dashboard and Insights answer the same question with
-- `?origin=` (DJ.3, #1316); this migration lets the analyzer do the same, with DJ.2's rule kept:
-- **one analysis reads one origin**, never a sum of two.
--
--   column   what it says
--   ──────────────────────────────────────────────────────────────────────────────────────────
--   origin   the one origin whose builds, loops, test runs, waivers and rollups the run read —
--            and so the origin of every finding and suggestion it produced. Scheduled and
--            every-N runs are always `live`; only a person asks for another.
--
-- A row that states none gets `ouroboros.data_origin_default()` (V141): `seeded` inside a seed
-- file, `live` everywhere else.
--
-- **Back-fill.** A seeded run is told by its `5eed` id, as V141 told seeded runs; every other run
-- read `live` rows (DJ.2) and is `live`.
--
-- **The one-running guard** moves to (workspace, repository, origin): a person analysing the demo
-- corpus must not block the live scheduler, and the two never share a corpus.
-- ===========================================================================

alter table ouroboros.analysis_runs
  add column origin text default ouroboros.data_origin_default();

update ouroboros.analysis_runs
   set origin = case when id::text like '5eed%' then 'seeded' else 'live' end;

alter table ouroboros.analysis_runs
  alter column origin set not null,
  add constraint analysis_runs_origin_known check (origin in ('live', 'simulated', 'seeded'));

comment on column ouroboros.analysis_runs.origin is
  'The one data origin the run read — and so the origin of its findings and suggestions (#2022). Scheduled runs are live.';

drop index ouroboros.analysis_runs_one_running;

-- THE GUARD: at most one running analysis per (workspace, repository, origin).
create unique index analysis_runs_one_running
  on ouroboros.analysis_runs (organization_id, repo_ref, origin)
  where status = 'running';

drop index ouroboros.analysis_runs_repo_recent_idx;

-- The page's read: the latest runs of a repository, over one origin.
create index analysis_runs_repo_recent_idx
  on ouroboros.analysis_runs (organization_id, repo_ref, origin, started_at desc);
