-- copilot-invariants.sql — the invariants mockup 20's seeded copilot page is written against,
-- named (#558, CC.4).
--
-- R__dev_seed_workspace_copilot.sql seeds the security-patch conversation, its v0.3 draft, the
-- dry run on #489 and its two suggestions. These are the promises the page relies on that a later
-- migration or seed could break without anything else noticing:
--
--   * **Vocabularies are the issue's.** A suggestion's `source` is `rule | llm` and its `status`
--     `open | applied | ignored`, read from the CHECKs themselves.
--   * **A confidence has a basis.** Every suggestion's confidence carries a basis naming its method
--     and inputs, and the CHECK that requires it is in force.
--   * **Evidence is never empty.** No seeded suggestion stands on `{}`.
--   * **Proposed operations apply.** Every seeded suggestion's `proposed_ops` folds over the seeded
--     draft (`dry_run_suggestion_preview`) without an error — their DSL validity is ci/db's parity
--     step; this is that they apply.
--   * **The 81% basis is real.** The replay-disagreement suggestion's basis equals the
--     `review_replay_pairs` it names.
--   * **References resolve.** The dry run's ticket is #489's canonical twin of the intake mirror,
--     its session is a conversation about its workflow, and every suggestion's dry run exists.
--   * **W7's warnings are present.** The seeded draft loads `skill:advisory-db`, which no skill
--     names, and routes `exploit-verify` by a task no task kind names.
--
-- **Every assertion's message starts with the name of the invariant it protects**, so a red build
-- says which guarantee went and tests/verify-copilot-invariants.sh can require that name.
--
-- Run through tests/copilot-invariants.sql, which owns the session and the transaction.

-- The values a named CHECK admits, read from the catalogue rather than restated.
create function pg_temp.copilot_vocabulary(p_table text, p_constraint text) returns setof text
language sql stable as $$
  select m[1]
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conrelid = ('ouroboros.' || p_table)::regclass and c.conname = p_constraint
$$;

select pg_temp.must_hold(
  exists (select 1 from ouroboros.dry_run_suggestions where id::text like '5eed008c-%'),
  'copilot_seeded: the database holds the copilot seed to probe — seed it with flyway.seed.toml');

-- ===========================================================================
-- 1. Vocabularies
-- ===========================================================================
select pg_temp.must_hold(
  (select array_agg(v order by v) = array['llm', 'rule']
     from pg_temp.copilot_vocabulary('dry_run_suggestions', 'dry_run_suggestions_source') v)
  and (select array_agg(v order by v) = array['applied', 'ignored', 'open']
         from pg_temp.copilot_vocabulary('dry_run_suggestions', 'dry_run_suggestions_status') v),
  'suggestion_vocabularies: a suggestion''s source is rule | llm and its status open | applied | ignored');

-- ===========================================================================
-- 2. Confidence has a basis; evidence is not empty
-- ===========================================================================
select pg_temp.must_hold(
  exists (select 1 from pg_constraint
           where conrelid = 'ouroboros.dry_run_suggestions'::regclass
             and conname = 'dry_run_suggestions_confidence_basis'
             and pg_get_constraintdef(oid) like '%dry_run_confidence_basis_valid(confidence_basis)%')
  and not exists (select 1 from ouroboros.dry_run_suggestions s
                   where not ouroboros.dry_run_confidence_basis_valid(s.confidence_basis)),
  'confidence_has_basis: every suggestion''s confidence carries a basis naming its method and inputs');

select pg_temp.must_hold(
  not exists (select 1 from ouroboros.dry_run_suggestions s
               where s.id::text like '5eed008c-%' and s.evidence = '{}'::jsonb),
  'evidence_not_empty: no seeded suggestion stands on an empty evidence object');

-- ===========================================================================
-- 3. Proposed operations apply to the seeded draft
-- ===========================================================================
create function pg_temp.copilot_ops_apply(p_suggestion uuid) returns boolean
language plpgsql as $$
begin
  return ouroboros.dry_run_suggestion_preview(p_suggestion) is not null;
exception
  when others then
    return false;
end;
$$;

select pg_temp.must_hold(
  not exists (select 1 from ouroboros.dry_run_suggestions s
               where s.id::text like '5eed008c-%' and not pg_temp.copilot_ops_apply(s.id)),
  'proposed_ops_apply: every seeded suggestion''s operations fold over the seeded draft without an error');

select pg_temp.must_hold(
  (select bool_and((ouroboros.dry_run_suggestion_preview(s.id) -> 'nodes') @>
                   jsonb_build_array(jsonb_build_object('id', 'has-cve')))
     from ouroboros.dry_run_suggestions s where s.rule_id = 'deterministic-skip')
  and (select bool_and(not exists (
                 select 1 from jsonb_array_elements(ouroboros.dry_run_suggestion_preview(s.id) -> 'nodes') n
                  where n ->> 'id' in ('review-primary', 'review-second')
                    and n #>> '{config,skill}' is distinct from 'pr-etiquette'))
         from ouroboros.dry_run_suggestions s where s.rule_id = 'replay-disagreement'),
  'proposed_ops_apply: the 93% suggestion adds the has-cve decision and the 81% loads pr-etiquette into both reviewers');

-- ===========================================================================
-- 4. The 81% basis is the replays
-- ===========================================================================
select pg_temp.must_hold(
  (select bool_and(pairs.total >= 1
                   and (s.confidence_basis #>> '{inputs,pairs}')::int = pairs.total
                   and (s.confidence_basis #>> '{inputs,style_disagreements}')::int = pairs.style)
     from ouroboros.dry_run_suggestions s
     cross join lateral (
       select count(*)::int as total,
              (count(*) filter (where p.disagreement_class = 'style'))::int as style
         from ouroboros.review_replay_pairs p
        where p.replay_set::text = s.confidence_basis #>> '{inputs,replay_set}') pairs
    where s.rule_id = 'replay-disagreement'),
  'replay_basis_real: the reviewer-pair suggestion''s basis equals the review_replay_pairs it names');

-- ===========================================================================
-- 5. References resolve to the shared universe
-- ===========================================================================
select pg_temp.must_hold(
  (select bool_and(t.external_key = '#489'
                   and exists (select 1 from ouroboros.github_issues g
                                join ouroboros.github_repos repo on repo.id = g.github_repo_id
                                                                and repo.name = 'helios-firmware'
                                where g.organization_id = t.organization_id and g.number = 489
                                  and g.title = t.title)
                   and s.workflow_id = r.workflow_id)
     from ouroboros.dry_runs r
     join ouroboros.tickets t           on t.id = r.ticket_id
     join ouroboros.copilot_sessions s  on s.id = r.session_id
    where r.id::text like '5eed008b-%')
  and not exists (select 1 from ouroboros.dry_run_suggestions s
                   where s.id::text like '5eed008c-%'
                     and not exists (select 1 from ouroboros.dry_runs r where r.id = s.dry_run_id)),
  'refs_resolve: the dry run names #489''s twin of the intake mirror and a session about its workflow, and every suggestion its dry run');

-- ===========================================================================
-- 6. W7's unresolved references are present
-- ===========================================================================
select pg_temp.must_hold(
  (select bool_or(n #>> '{config,skill}' = 'advisory-db')
          and bool_or(n #>> '{config,routing,inherit_task}' = 'exploit-verify')
          and not exists (select 1 from ouroboros.skills k
                           where k.organization_id = wf.organization_id
                             and 'advisory-db' in (k.slug, k.name))
          and not exists (select 1 from ouroboros.task_kinds k
                           where k.organization_id = wf.organization_id and k.name = 'exploit-verify')
     from ouroboros.workflows wf
     join ouroboros.workflow_versions v on v.workflow_id = wf.id and v.version is null,
          jsonb_array_elements(v.definition -> 'nodes') n
    where wf.id::text like '5eed0089-%'
    group by wf.organization_id),
  'w7_unresolved: the seeded draft references skill:advisory-db and the exploit-verify task, and neither resolves');
