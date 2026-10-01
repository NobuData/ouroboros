-- V082__scoreboard_registry.sql — the methodology registry's entries for mockup 15's MODEL
-- SCOREBOARD (BJ.3, #439, decisions I1, I6 and I10).
--
-- The scoreboard is the routing decision's feedback loop: one row per task kind × the model that
-- served it, with the merge-untouched rate, the cost of a success and its trend. Every column renders
-- a popover, and a popover is a registry entry (decision I1). Four columns, four entries:
--
--   * **Merge-untouched %** is `merged_untouched_rate` (V076) and nothing new. Decision I6 says the
--     number has *one* definition, and the KPI row already owns it — a second entry would be the
--     second definition the decision exists to prevent. The scoreboard computes it with the same
--     SQL predicate the throughput extractor fills it with (`ouroboros-rest`
--     `insights/untouched.sql.ts`), over the row's merges.
--   * **`scoreboard_merged`** is the row itself: what groups a merge into it (task kind × the
--     resolution's serving hop), what *fallback* means, and the low-sample threshold.
--   * **`scoreboard_cost_per_success`** is the `$ / success` column and its denominator.
--   * **`scoreboard_trend`** is the arrow and the window it compares against.
--
-- Family `scoreboard`, like `calibration` (V077): the scoreboard is computed from the source planes
-- per request (`insights/scoreboard/`) and is **not** on the daily grain — no extractor fills
-- these, so `metric_daily` never holds a row for them (and `MetricsService.window` refuses them).
-- A row per (task kind, model, hop) per day would be a dimension the grain has no kind for, and
-- the rate has to be recomposed across the window anyway.
--
-- The `aggregation` column is left to its default (V078: `ratio` for a rate, `sum` otherwise); it
-- describes re-windowing the daily grain, which none of these are on.

insert into ouroboros.metric_definitions
  (metric_id, family, title, formula_text, source_planes, caveats, unit, is_rate, proxy)
values
  ('scoreboard_merged', 'scoreboard', 'Scoreboard sample',
   'Merged loop PRs backing a scoreboard row. A merge belongs to a row for every task kind its run resolved: the row is the task kind, the model of the hop that served it (the last kept hop the executor tried, else the first kept hop) and that hop''s place in the resolved chain. Hop 1 is the primary; any later hop is a fallback.',
   '{resolution_snapshots,runs,pull_requests}',
   'A fallback row describes the work its primary could not do, so a lower untouched rate there is expected rather than damning. A row backed by fewer than 10 merges is shown with a low-sample badge: its rate is noise, not a ranking. One run that resolved implement and review counts in both rows.',
   'count', false, false),

  ('scoreboard_cost_per_success', 'scoreboard', 'Cost per success',
   'Priced usage the row''s runs spent on its task kind inside the window, divided by the row''s merges in the window. Spend on loops that never merged is counted, so failure has a price.',
   '{token_usage,resolution_snapshots,pull_requests}',
   'Shown in dollars only when every token in the row was priced; with any unpriced usage the row shows tokens per success instead, never a partial dollar figure. A local model priced at zero shows $0.00, which is true. Usage no task kind was recorded for is in no row.',
   'cents', false, false),

  ('scoreboard_trend', 'scoreboard', 'Scoreboard trend',
   'The row''s merge-untouched rate in this window minus the same row''s rate in the prior window of equal length (the N UTC days before): up when higher, down when lower, flat when equal.',
   '{resolution_snapshots,pull_requests}',
   'Flat with no arrow when the prior window has no merges for the row, as well as when the rate did not move. The arrow says which way, not whether the move is significant; read it beside the sample.',
   'pct', true, false);
