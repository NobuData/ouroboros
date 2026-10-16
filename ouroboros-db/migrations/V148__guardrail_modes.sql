-- ===========================================================================
-- V148 — guardrail modes: block or warn, per check, per workspace (#315, AR.1)
-- ===========================================================================
--
-- Until AR.1 a failed guardrail check was *evaluation, not enforcement*: the change-set answer
-- said `needsHuman`, and nothing stopped a stage. AR.1 makes a fail stop the stage — and with
-- that comes the question a workspace has to be able to answer for itself: **which failures
-- stop the run, and which are only shown?** (decision 1 of #315.)
--
--   1. **`guardrail_modes (organization_id, "check") → mode`** — one row per check a workspace
--      has chosen a mode for. `block` (a fail makes the run need a person) or `warn` (a fail is
--      drawn on the Guardrails card in a warn tone and the run carries on). **No row is
--      `block`**: a workspace that never chose is enforced, and the absent row is the default
--      rather than four rows every workspace has to be given. Set through
--      `PATCH /api/v1/settings/guardrails` (owner or admin); there is no settings screen.
--
--      A small table rather than four columns on `workspace_settings`: the four checks are a
--      closed vocabulary V048 already names (`guardrail_evaluations_check`), and a row keyed by
--      that vocabulary is the same map the API answers — where four columns would be a fifth
--      copy of the list in `workspace_settings_effective`, every fixture that builds one, and
--      every later migration that recreates that view.
--
--   2. **`guardrail_evaluations.mode`** — the mode **in force when the verdict was made**, stamped
--      by the evaluator from (1). A snapshot, for V048's argument at `policy_ref`: a verdict is
--      answerable for the rule it applied, so a workspace that switches `secrets` to `warn`
--      tomorrow does not rewrite today's block into a warning. `not null default 'block'`, so
--      every row written before this migration — and every writer that does not know about it
--      — reads as what it was at the time: enforced on paper.
--
--   3. **`v_run_guardrails_latest.mode`** — appended (a `create or replace view` may add columns
--      at the end and may not reorder them), so the run console can draw a warn-mode fail
--      differently from a block.
--
--   4. **`sync_intervention_events` counts only `block` fails.** V079 files the first failure of
--      each check as a `guardrail` (or `policy_gate`) intervention, and lists the failed checks
--      in a needs-human handoff's context. A warn-mode fail asks nobody for anything — the run
--      did not stop — so it is not an intervention and does not explain a handoff. The body is
--      V079's with `and g.mode = 'block'` on both reads and nothing else changed.
--
-- To undo (forward only — for a rehearsal against a copy):
--   create or replace function ouroboros.sync_intervention_events(uuid) … (V079's body);
--   drop view ouroboros.v_run_guardrails_latest; create view … (V048's body); re-grant select;
--   alter table ouroboros.guardrail_evaluations drop column mode;
--   drop table ouroboros.guardrail_modes;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The workspace's modes.
-- ---------------------------------------------------------------------------
create table ouroboros.guardrail_modes (
  -- Owning workspace. Cascade, as everything a workspace owns.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- Which check — V048's closed vocabulary, restated because a CHECK cannot reference another
  -- table's CHECK. Quoted, as V048 quotes it.
  "check"         text        not null
                              constraint guardrail_modes_check
                                check ("check" in ('allowed_paths', 'ci_config', 'secrets', 'review_required')),

  -- `block`: a fail makes the run need a person. `warn`: a fail is shown and the run goes on.
  mode            text        not null default 'block'
                              constraint guardrail_modes_mode
                                check (mode in ('block', 'warn')),

  -- Who last set it. Set null when the person is removed; null for a seeded row.
  updated_by      text        references ouroboros."user" ("id") on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  primary key (organization_id, "check")
);

comment on table ouroboros.guardrail_modes is
  'Whether a failed guardrail check stops a run (block) or is only shown (warn), per check per workspace (#315, AR.1, decision 1). A check with no row is block — a workspace that never chose is enforced. Read by the guardrail evaluator, which stamps each verdict''s mode (guardrail_evaluations.mode); set by PATCH /api/v1/settings/guardrails, owner or admin, audited as workspace.guardrail_modes_changed.';
comment on column ouroboros.guardrail_modes."check" is
  'One of the four guardrail checks: allowed_paths, ci_config, secrets, review_required (V048''s vocabulary).';
comment on column ouroboros.guardrail_modes.mode is
  'block — a fail sets needsHuman on the change-set answer and the executor halts the stage; warn — a fail is drawn on the Guardrails card in a warn tone and the run carries on.';
comment on column ouroboros.guardrail_modes.updated_by is
  'Who last set the mode; null once that person is removed, or for a seeded row.';

create trigger guardrail_modes_touch_updated_at
  before update on ouroboros.guardrail_modes
  for each row execute function ouroboros.touch_updated_at();

-- Stored and re-stored by the settings route; a workspace's rows leave with the workspace, and
-- nothing in the product removes one (setting `block` again is an update), so no `delete`.
grant select, insert, update on ouroboros.guardrail_modes to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 2. The mode each verdict was made under.
-- ---------------------------------------------------------------------------
alter table ouroboros.guardrail_evaluations
  add column mode text not null default 'block'
    constraint guardrail_evaluations_mode
      check (mode in ('block', 'warn'));

comment on column ouroboros.guardrail_evaluations.mode is
  'The workspace''s mode for this check when the verdict was made (#315) — block or warn, from guardrail_modes (no row = block). A snapshot, like policy_ref: changing the mode later does not rewrite history. Rows from before V148 read block.';

-- ---------------------------------------------------------------------------
-- 3. The card's read carries it. V048's body, with `mode` appended.
-- ---------------------------------------------------------------------------
create or replace view ouroboros.v_run_guardrails_latest as
select distinct on (evaluation.run_id, evaluation."check")
       evaluation.id,
       evaluation.run_id,
       evaluation."check",
       evaluation.verdict,
       evaluation.evidence,
       evaluation.ruleset_version,
       evaluation.policy_ref,
       evaluation.evaluated_at,
       evaluation.change_set_seq,
       evaluation.mode
  from ouroboros.guardrail_evaluations evaluation
 order by evaluation.run_id,
          evaluation."check",
          evaluation.evaluated_at desc,
          evaluation.change_set_seq desc nulls last,
          evaluation.id desc;

comment on column ouroboros.v_run_guardrails_latest.mode is
  'The mode the latest verdict was made under (#315): a fail in block mode stopped the run, a fail in warn mode was only shown.';

-- ---------------------------------------------------------------------------
-- 4. A warn-mode fail is not an intervention. V079's body, `g.mode = 'block'` on both reads.
-- ---------------------------------------------------------------------------
create or replace function ouroboros.sync_intervention_events(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  run     ouroboros.runs%rowtype;
  context text[];
begin
  select * into run from ouroboros.runs where id = p_run_id;
  if not found then
    return;
  end if;

  -- Human failure classifications of the run's cases.
  perform ouroboros.upsert_intervention_event(
            c.organization_id, run.id, 'classification', c.id::text, c.created_at,
            array_remove(array['class:' || c.class, 'subtype:' || c.subtype], null))
     from ouroboros.failure_classifications c
     join ouroboros.test_cases tc  on tc.id = c.test_case_id
     join ouroboros.test_suites ts on ts.id = tc.test_suite_id
     join ouroboros.test_runs tr   on tr.id = ts.test_run_id
    where tr.run_id = run.id and c.actor = 'human';

  -- Waivers.
  perform ouroboros.upsert_intervention_event(
            w.organization_id, run.id, 'waiver', w.id::text, w.created_at, '{}')
     from ouroboros.pr_waivers w
    where w.run_id = run.id;

  -- The first block-mode failure of each guardrail check; review_required is the policy gate.
  -- A warn-mode fail (#315) stopped nothing, so it is nobody's intervention.
  perform ouroboros.upsert_intervention_event(
            run.organization_id, run.id,
            case when f."check" = 'review_required' then 'policy_gate' else 'guardrail' end,
            run.id::text || '/' || f."check", f.at, array['check:' || f."check"])
     from (select g."check", min(g.evaluated_at) as at
             from ouroboros.guardrail_evaluations g
            where g.run_id = run.id and g.verdict = 'fail' and g.mode = 'block'
            group by g."check") f;

  -- The needs-human handoff, explained by the run's context: the current classification of every
  -- case it ran, the block-mode checks it failed, and the signals of its table-less events.
  select coalesce(array_agg(distinct s order by s), '{}') into context
    from (select unnest(array_remove(array['class:' || c.class, 'subtype:' || c.subtype], null))
            from ouroboros.failure_classifications c
            join ouroboros.test_cases tc  on tc.id = c.test_case_id
            join ouroboros.test_suites ts on ts.id = tc.test_suite_id
            join ouroboros.test_runs tr   on tr.id = ts.test_run_id
           where tr.run_id = run.id and c.superseded_by is null
          union
          select 'check:' || g."check"
            from ouroboros.guardrail_evaluations g
           where g.run_id = run.id and g.verdict = 'fail' and g.mode = 'block'
          union
          select unnest(e.signals)
            from ouroboros.intervention_events e
           where e.run_id = run.id and e.source = 'vote_block') as t(s);

  if run.status = 'needs_human' then
    perform ouroboros.upsert_intervention_event(
              run.organization_id, run.id, 'needs_human_run', run.id::text, run.finished_at,
              context);
  else
    -- A loop resumed after its handoff keeps its event; only the explanation is refreshed.
    update ouroboros.intervention_events
       set signals = context
     where source = 'needs_human_run' and source_ref = run.id::text
       and signals is distinct from context;
  end if;
end;
$$;

comment on function ouroboros.sync_intervention_events(uuid) is
  'Re-derives one run''s intervention events from its source records (#434) — human classifications, waivers, first block-mode guardrail failures per check (review_required as policy_gate; a warn-mode fail is not an intervention, #315) and the needs-human handoff with the run''s context — upserting on (source, source_ref). Idempotent: a replay creates nothing. Never deletes an event. Every source-plane hook calls it.';
