-- research-invariants.sql — the disciplines mockup 22's seeded Research page relies on, named
-- (#613, CK.6).
--
-- R__dev_seed_research.sql and R__dev_seed_workspace_research.sql seed the four investigations,
-- their ledgers and briefs, the capability matrix, the regression watch and the roadmap doc. Those
-- rows are only as honest as the rules V106, V108, V112, V113 and V115 hold them to, and every one
-- of those rules spans tables or services — so a later migration could relax one without anything
-- else noticing. Each invariant below is asked twice: of the seeded rows, and of a write the rule
-- must refuse (attempted inside a savepoint, so nothing is kept).
--
--   * **finding_cited** — no finding claim stands without a citation, and an uncited finding is
--     refused at commit (`brief_claims_finding_cited`, V108; decision V3).
--   * **matrix_cell_cited** — no matrix cell other than `unknown` stands without a citation, and
--     a cell moved off `unknown` without one is refused at commit (`matrix_cells_cited`, V112; V7).
--   * **watch_vocabulary** — a watch item's `severity` is `err | warn | ok` and its `status` the
--     eight lifecycle states, read from the CHECKs themselves.
--   * **watch_transitions** — the lifecycle is held: a skipped step, a `bisected` without a bisect
--     result and a `fixed_merged` without a PR are refused (V115).
--   * **doc_version_immutable** — a roadmap doc version is never edited (V113).
--   * **investigation_seq_dense** — a workspace's RS numbers are dense and its counter is at the
--     highest; tests/verify-investigation-seq.sh proves gaplessness under concurrency (V106).
--   * **source_locator_valid** — every seeded locator is well-formed for its kind, and a malformed
--     one is refused (V108).
--
-- **Every assertion's message starts with the name of the invariant it protects**, so a red build
-- says which guarantee went and tests/verify-research-invariants.sh can require that name.
--
-- Run through tests/research-invariants.sql, which owns the session and the transaction.

-- The values a named CHECK admits, read from the catalogue rather than restated.
create function pg_temp.research_vocabulary(p_table text, p_constraint text) returns setof text
language sql stable as $$
  select m[1]
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conrelid = ('ouroboros.' || p_table)::regclass and c.conname = p_constraint
$$;

select pg_temp.must_hold(
  exists (select 1 from ouroboros.regression_watch_items where id::text like '5eed0096-%')
  and exists (select 1 from ouroboros.source_records where id::text like '5eed0085-%'),
  'research_seeded: the database holds the research seeds to probe — seed it with flyway.seed.toml');

-- ---------------------------------------------------------------------------
-- finding_cited
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.brief_claims c
               where c.claim_type = 'finding'
                 and not exists (select 1 from ouroboros.brief_claim_sources l where l.claim_id = c.id)),
  'finding_cited: no seeded finding claim stands without a citation');

select pg_temp.must_reject(
  $q$do $x$ begin
    insert into ouroboros.briefs (id, investigation_id, version, body)
    select '5eed0f00-0000-4000-8000-000000000001', inv.id,
           (select max(version) + 1 from ouroboros.briefs b where b.investigation_id = inv.id),
           '{"paragraphs": [{"spans": [{"text": "An uncited finding.", "claim": "probe-uncited"}]}]}'
      from ouroboros.investigations inv where inv.id = '5eed0091-0000-4000-8000-000000000118';
    insert into ouroboros.brief_claims (investigation_id, brief_id, span_ref, claim_type, text)
    values ('5eed0091-0000-4000-8000-000000000118', '5eed0f00-0000-4000-8000-000000000001',
            'probe-uncited', 'finding', 'An uncited finding.');
    -- Named only while it exists: dropped, the write is simply accepted, which is the failure.
    if exists (select 1 from pg_trigger where tgname = 'brief_claims_finding_cited') then
      execute 'set constraints ouroboros.brief_claims_finding_cited immediate';
    end if;
  end $x$ $q$,
  'finding_cited: a finding claim written without a citation is refused at commit',
  'brief_claims_finding_cited');

-- ---------------------------------------------------------------------------
-- matrix_cell_cited
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.matrix_cells c
               where c.status <> 'unknown'
                 and not exists (select 1 from ouroboros.matrix_cell_sources l where l.cell_id = c.id))
  and exists (select 1 from ouroboros.matrix_cells c where c.status = 'unknown'),
  'matrix_cell_cited: every seeded cell but the honest unknown is cited, and the unknown is there');

select pg_temp.must_reject(
  $q$do $x$ begin
    update ouroboros.matrix_cells set status = 'none'
     where id = (select id from ouroboros.matrix_cells where status = 'unknown' order by id limit 1);
    -- Named only while it exists: dropped, the write is simply accepted, which is the failure.
    if exists (select 1 from pg_trigger where tgname = 'matrix_cells_cited') then
      execute 'set constraints ouroboros.matrix_cells_cited immediate';
    end if;
  end $x$ $q$,
  'matrix_cell_cited: a cell moved off unknown without a citation is refused at commit',
  'matrix_cells_cited');

-- ---------------------------------------------------------------------------
-- watch_vocabulary
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select array_agg(v order by v) from pg_temp.research_vocabulary('regression_watch_items', 'regression_watch_items_severity') v)
    = array['err', 'ok', 'warn']
  and (select array_agg(v order by v) from pg_temp.research_vocabulary('regression_watch_items', 'regression_watch_items_status') v)
    = array['bisected', 'bisecting', 'detected', 'dismissed', 'fix_drafted', 'fix_running', 'fixed_merged',
            'investigation_open'],
  'watch_vocabulary: a watch item''s severity is err|warn|ok and its status the eight lifecycle states');

select pg_temp.must_hold(
  (select bool_and(severity in ('err', 'warn', 'ok')) from ouroboros.regression_watch_items),
  'watch_vocabulary: every seeded watch item''s severity is in the vocabulary');

-- ---------------------------------------------------------------------------
-- watch_transitions
-- ---------------------------------------------------------------------------
select pg_temp.must_reject(
  $q$update ouroboros.regression_watch_items set status = 'fixed_merged',
            pr_ref = '{"pull_request_id": "5eed0098-0000-4000-8000-000000000641", "key": "#641"}'
      where id = '5eed0096-0000-4000-8000-000000000102'$q$,
  'watch_transitions: a fix still drafted cannot jump to merged',
  'regression_watch_items_transition');

select pg_temp.must_reject(
  $q$do $x$ begin
    insert into ouroboros.regression_watch_items (id, organization_id, baseline_id, current, drift_value, drift_unit, severity)
    select '5eed0f00-0000-4000-8000-000000000002', b.organization_id, b.id, b."window", 1, '%', 'warn'
      from ouroboros.regression_baselines b where b.id = '5eed0096-0000-4000-8000-000000000003';
    update ouroboros.regression_watch_items set status = 'bisecting' where id = '5eed0f00-0000-4000-8000-000000000002';
    update ouroboros.regression_watch_items set status = 'bisected' where id = '5eed0f00-0000-4000-8000-000000000002';
  end $x$ $q$,
  'watch_transitions: bisected requires a bisect result',
  'regression_watch_items_bisected_has_result');

select pg_temp.must_reject(
  $q$update ouroboros.regression_watch_items set status = 'fixed_merged'
      where id = '5eed0096-0000-4000-8000-000000000101'$q$,
  'watch_transitions: fixed_merged requires a PR reference',
  'regression_watch_items_merged_has_pr');

select pg_temp.must_hold(
  (select bool_and((status <> 'bisected' or bisect_result is not null)
                   and (status <> 'fixed_merged' or pr_ref is not null)
                   and (status not in ('fix_drafted', 'fix_running') or fix_ticket_ref is not null))
     from ouroboros.regression_watch_items),
  'watch_transitions: every seeded watch item carries what its state requires');

-- ---------------------------------------------------------------------------
-- doc_version_immutable
-- ---------------------------------------------------------------------------
select pg_temp.must_reject(
  $q$update ouroboros.roadmap_doc_versions set markdown = '# hand-edited'
      where id = '5eed0097-0000-4000-8000-000000001001'$q$,
  'doc_version_immutable: a roadmap doc version is never edited',
  'roadmap_doc_versions_no_update');

-- ---------------------------------------------------------------------------
-- investigation_seq_dense
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select bool_and(w.numbers = w.span and w.counter = w.highest)
     from (select inv.organization_id, count(*) as numbers, max(inv.seq) - min(inv.seq) + 1 as span,
                  max(inv.seq) as highest,
                  (select c.last_seq from ouroboros.investigation_seq_counters c
                    where c.organization_id = inv.organization_id) as counter
             from ouroboros.investigations inv group by inv.organization_id) w),
  'investigation_seq_dense: every workspace''s RS numbers are dense and its counter is at the highest');

-- ---------------------------------------------------------------------------
-- source_locator_valid
-- ---------------------------------------------------------------------------
select pg_temp.must_hold(
  (select bool_and(ouroboros.source_locator_valid(s.kind, s.locator)) from ouroboros.source_records s),
  'source_locator_valid: every seeded source locator is well-formed for its kind');

select pg_temp.must_reject(
  $q$insert into ouroboros.source_records (investigation_id, tool_slug, kind, title, locator, retrieved_at,
                                           content_hash, excerpt)
     values ('5eed0091-0000-4000-8000-000000000121', 'code', 'code', 'A path, not a git locator',
             'helios-firmware/src/motor/motor_pid.c', now(),
             'sha256:' || repeat('0', 64), 'x')$q$,
  'source_locator_valid: a code source whose locator is not a git:// URI is refused',
  'source_records_locator_valid');
