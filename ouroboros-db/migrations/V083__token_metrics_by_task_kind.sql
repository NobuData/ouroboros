-- V083__token_metrics_by_task_kind.sql — the methodology registry's entries for mockup 15's
-- TOKENS BY STAGE card, and the dimension it is broken out by (BJ.2, #438, decisions I1 and I8).
--
-- The card draws six bars — implement, review, plan, analyze, test-gen, docs — and one line:
-- *"≈ 4.6M tokens per merged PR · 31% served by local models at $0."* Until now neither had a
-- registry entry, so neither had a popover, an extractor or a row on the daily grain: V078's cost
-- family holds every token (`tokens`) and the unpriced part (`unpriced_tokens`), and nothing that
-- says *what the tokens were spent on* or *where they were served*. Two entries close that:
--
--   * **`tokens_by_task_kind`** — `tokens`, broken out by the task kind the usage was recorded
--     for (`token_usage.task_kind`, V020). The mockup's "stage" is the routing matrix's task
--     kind: `implement`, `review`, `plan`, … are `task_kinds.name`, not `run_stages.stage_key`,
--     which is why this needs a dimension kind of its own rather than reusing `stage`. A stage is
--     where a loop *is*; a task kind is what a model was *asked for*, and one stage can ask for
--     several.
--   * **`local_tokens`** — the part of `tokens` served by a provider that runs on the workspace's
--     own hardware. It is the numerator of the line's local share; the denominator is `tokens`.
--
-- Both are sums on the daily grain and both belong to the `cost` family, so the cost extractor
-- fills them in the same pass that fills `tokens` (`ouroboros-rest`
-- `insights/rollup/extractors/cost.extractor.ts`) and a window re-derives them by adding days.
--
-- ---------------------------------------------------------------------------
-- What each rule is for
-- ---------------------------------------------------------------------------
--
--   * **`task_kind` joins the dimension vocabulary** (`metric_definitions_dimension_kind_known`).
--     The vocabulary stays closed — a dimension kind is a promise about what a row's label means,
--     and V078's shape guard holds every row to its definition's kind.
--   * **The labels are not a closed list.** A workspace names its own task kinds (V016), as it
--     names its own suites, so `tokens_by_task_kind` rows carry whatever name the usage carried.
--     Only `cause` and `effort` are closed vocabularies (`tests/lib/insights-invariants.sql`).
--   * **Usage with no task kind is in no bar.** `token_usage.task_kind` is nullable — usage
--     recorded outside a routed call has none — and a dimensioned row needs a label, so such
--     usage is counted by `tokens` and by no row here. The bars may therefore sum to less than the
--     card's total, and the caveat says so rather than inventing an "other" bar.
--   * **Local is where the model ran, not what it cost.** A local model priced at zero is priced:
--     its tokens are in `local_tokens` and its $0 is in `cost_cents`. `unpriced_tokens` is a
--     different set — usage whose cost is unknown — and the two overlap only by coincidence.

alter table ouroboros.metric_definitions
  drop constraint metric_definitions_dimension_kind_known,
  add constraint metric_definitions_dimension_kind_known
    check (dimension_kind in ('stage', 'suite', 'effort', 'cause', 'task_kind'));

comment on column ouroboros.metric_definitions.dimension_kind is
  'What a dimensioned metric''s rows are broken out by — stage, suite, effort, cause or task_kind — or null for an undimensioned metric. metric_daily_shape_guard holds every row to it.';

insert into ouroboros.metric_definitions
  (metric_id, family, title, formula_text, source_planes, caveats, unit, is_rate, proxy,
   aggregation, dimension_kind)
values
  ('tokens_by_task_kind', 'cost', 'Tokens by stage',
   'Input plus output tokens on this day, by the task kind the usage was recorded for — implement, review, plan and so on, as the routing matrix names them.',
   '{usage}',
   'Usage recorded with no task kind is counted in Tokens and in no bar here, so the bars can sum to less than the total. A task kind is what a model was asked for, not the loop stage it ran in: one stage can ask for several.',
   'tokens', false, false, 'sum', 'task_kind'),

  ('local_tokens', 'cost', 'Tokens served locally',
   'Input plus output tokens on this day served by a provider running on the workspace''s own hardware — a local model server rather than a hosted API.',
   '{usage}',
   'Local is where the model ran, not what it cost: a local model priced at zero is still priced, and unpriced usage is a different set. The share of Tokens this covers is the local share.',
   'tokens', false, false, 'sum', null);
