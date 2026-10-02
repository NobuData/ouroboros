-- analyzer-invariants.sql — the invariants the Build Analyzer's page is written against, named
-- (#509, BU.4).
--
-- Mockup 18 trusts its rows completely: a chip is a finding's first candidate, a card is a
-- suggestion as composed, the predicted-vs-measured row is a measurement's two numbers and its
-- verdict, and the meta strip's `Analyzed by` is the run's provenance. V080, V081 and V085 refuse
-- the bad versions of those rows at write time. A later migration could relax any of those
-- rules without a single test noticing — the seed would still be green, because the seed is
-- not where the bad row would come from. So each rule is stated here as a property of the
-- **stored rows**, in every workspace:
--
--   * **The vocabularies.** A finding type no renderer knows, a suggestion kind no card has.
--   * **The lifecycle.** Born open; applied with its audit event, never a draft or a spike;
--     dismissed by someone, for a reason; drafted into a batch of its own workspace, and only a
--     draft or a spike.
--   * **Evidence resolves.** Every `{kind, id}` a finding cites names a real row of its
--     workspace — a Details sheet that clicks through to nothing is a claim, not evidence.
--   * **Confidence is bounded** — on findings and suggestions — and a finding's basis is the
--     shape the scoring popover renders.
--   * **Predictions are write-once.** A measurement's prediction is the applied suggestion's
--     impact, frozen together at the apply; one that differs was rewritten afterwards.
--   * **Verdicts reproduce.** A closed measurement's verdict is V085's arithmetic over its own
--     stored numbers and bands, and a calibration factor is the formula over its measurements.
--   * **No LLM cost without an LLM** — and no seeded run in the demo workspace names one at all,
--     because no model has run (decision A3).
--   * **Identity is derived.** A suggestion's identity is the one its cited findings derive.
--
-- The second half asks the catalogue by name, the planning and insights probes' reason: a
-- stored-row probe over a table nobody planted into is green whether its rule exists or not.
--
-- **Every assertion's message starts with the name of the invariant it protects**, so a red run
-- says which guarantee went, and tests/verify-analyzer-invariants.sh can require that name.
--
-- Run through tests/analyzer-invariants.sql, which owns the session and the transaction. It
-- writes nothing.

-- ===========================================================================
-- 1. The rows the database holds
-- ===========================================================================

-- --- the vocabularies ----------------------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.analysis_findings
               where not (finding_type in ('change_point', 'log_signature', 'config_usage',
                                           'cache_window', 'queue_correlation', 'waiver_cite',
                                           'workflow_outcome')
                          or finding_type ~ '^custom:[a-z][a-z0-9_]{0,62}$')),
  'analysis_findings_type_known: every stored finding is one of the seven families or a custom:<name> — no chip without a renderer');

select pg_temp.must_hold(
  not exists (select 1 from ouroboros.analysis_suggestions
               where kind not in ('build_process', 'workflow', 'ticket_draft')),
  'analysis_suggestions_kind_known: every stored suggestion is a build-process change, a workflow change or a ticket draft');

-- --- the A4 lifecycle -----------------------------------------------------------------------------
select pg_temp.must_hold(
  not exists (
    select 1 from ouroboros.analysis_suggestions s
     where case s.status
             when 'open' then s.resolved_at is not null or s.resolved_by is not null
                              or s.resolution_reason is not null or s.applied_event_id is not null
                              or s.draft_batch_id is not null
             when 'applied' then s.kind = 'ticket_draft' or s.needs_spike or s.resolved_at is null
                              or not exists (select 1 from ouroboros.audit_events e
                                              where e.id = s.applied_event_id
                                                and e.organization_id = s.organization_id
                                                and e.action = 'analysis_suggestion.applied'
                                                and e.subject_type = 'analysis_suggestion'
                                                and e.subject_id = s.id::text)
             when 'dismissed' then s.resolution_reason is null or s.resolved_at is null
             when 'drafted' then not (s.kind = 'ticket_draft' or s.needs_spike) or s.resolved_at is null
                              or not exists (select 1 from ouroboros.draft_batches b
                                              where b.id = s.draft_batch_id
                                                and b.organization_id = s.organization_id)
             else true
           end),
  'analysis_suggestions_lifecycle: every stored suggestion is open and unresolved, applied with its own audit event, dismissed with a reason, or drafted into a batch of its workspace — and only drafts and spikes are drafted');

-- --- evidence resolves ----------------------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1
                from ouroboros.analysis_findings f, jsonb_array_elements(f.evidence_refs) ref
               where not ouroboros.analysis_evidence_ref_valid(ref)
                  or not ouroboros.analysis_evidence_ref_resolves(f.organization_id, ref)),
  'analysis_findings_evidence_resolves: every stored evidence reference names a real row of its workspace');

-- --- confidence -----------------------------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.analysis_findings
               where confidence not between 0 and 100
                  or not ouroboros.analysis_confidence_basis_valid(confidence_basis))
  and not exists (select 1 from ouroboros.analysis_suggestions where confidence not between 0 and 100),
  'analysis_confidence_bounded: every stored finding and suggestion scores 0–100, and every finding states its basis');

-- --- predictions are write-once ------------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1
                from ouroboros.suggestion_measurements m
                join ouroboros.analysis_suggestions s on s.id = m.suggestion_id
               where (m.predicted ->> 'delta')::numeric is distinct from (s.impact ->> 'estimate')::numeric
                  or m.predicted -> 'basis' is distinct from s.impact -> 'basis'
                  or m.applied_at is distinct from s.resolved_at),
  'suggestion_measurements_prediction_frozen: every stored prediction is its applied suggestion''s impact, as frozen at the apply');

-- --- verdicts and factors reproduce --------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.suggestion_measurements m
               where m.verdict <> 'pending'
                 and m.verdict is distinct from ouroboros.suggestion_measurement_verdict(
                       (m.predicted ->> 'delta')::numeric, (m.measured ->> 'delta')::numeric,
                       m.verdict_under_below, m.verdict_over_above,
                       jsonb_array_length(m.confounds) > 0)),
  'suggestion_measurements_verdict_computed: every stored verdict is the arithmetic over its own numbers and bands');

select pg_temp.must_hold(
  not exists (
    select 1 from ouroboros.analyzer_calibration c,
           ouroboros.analyzer_calibration_inputs(c.organization_id, c.repo_ref, c.analyzer,
                                                 c.impact_class) i
     where (c.sample_count, c.factor)
           is distinct from (i.sample_count, round(i.measured_sum / nullif(i.predicted_sum, 0), 4))),
  'analyzer_calibration_derived: every stored factor is the formula over its cell''s cleanly closed measurements');

-- --- no LLM cost without an LLM -----------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.analysis_runs
               where llm_cost_cents is not null
                 and not jsonb_path_exists(analyzer_set, '$.analyzers[*] ? (@.kind == "llm")'))
  and not exists (select 1 from ouroboros.analysis_runs r
                    join ouroboros.organization org on org."id" = r.organization_id
                   where org."slug" = 'acme-robotics'
                     and (r.llm_cost_cents is not null
                          or jsonb_path_exists(r.analyzer_set, '$.analyzers[*] ? (@.kind == "llm")'))),
  'analysis_runs_no_llm_cost: no stored run carries a cost without an LLM analyzer, and no seeded run names or bills one');

-- --- identity is derived -------------------------------------------------------------------------
select pg_temp.must_hold(
  not exists (
    select 1 from ouroboros.analysis_suggestions s
     where exists (select 1 from ouroboros.analysis_suggestion_findings l where l.suggestion_id = s.id)
       and s.identity_key is distinct from ouroboros.analysis_suggestion_identity(
             s.kind, array(select f.identity_key from ouroboros.analysis_suggestion_findings l
                             join ouroboros.analysis_findings f on f.id = l.finding_id
                            where l.suggestion_id = s.id))),
  'analysis_suggestions_identity_derived: every stored suggestion carries the identity its cited findings derive');

-- ===========================================================================
-- 2. The catalogue, by name
-- ===========================================================================

select pg_temp.must_hold(
  (select count(*) = 8 from pg_constraint
    where conname in ('analysis_findings_type_known', 'analysis_suggestions_kind_known',
                      'analysis_findings_confidence_range', 'analysis_suggestions_confidence_range',
                      'analysis_suggestions_applied_has_event', 'analysis_suggestions_drafted_has_batch',
                      'suggestion_measurements_verdict_computed', 'analysis_runs_cost_needs_llm')
      and connamespace = 'ouroboros'::regnamespace and contype = 'c'),
  'analysis_catalogue: the vocabulary, confidence, lifecycle-linkage, verdict and LLM-cost checks are all still declared');

select pg_temp.must_hold(
  (select count(*) = 6 from pg_trigger
    where tgname in ('analysis_findings_write_guard', 'analysis_suggestions_lifecycle_guard',
                     'analysis_suggestions_identity_holds', 'suggestion_measurements_guard',
                     'analyzer_calibration_traces', 'analyzer_calibration_history_guard')
      and not tgisinternal and tgenabled <> 'D'),
  'analysis_catalogue: the write guard, the lifecycle guard, identity, the measurement guard and the calibration trail are all still declared and enabled');
