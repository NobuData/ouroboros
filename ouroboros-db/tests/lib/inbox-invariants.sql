-- inbox-invariants.sql — the invariants mockup 16's Needs-You inbox is written against, named
-- (#460, BM.4).
--
-- The decision domain (V093, V095–V097) holds promises a later migration or seed could break
-- without the page noticing until a reviewer did:
--
--   * **Every vocabulary is exercised.** Each status, severity, resolver and channel a CHECK
--     admits, and each declared kind but the dormant spend_approval, is a seeded row — so a value
--     added to a vocabulary without a row (or a probe) to show it fails here.
--   * **Keys hold.** One item per (workspace, plane, source_ref); one resolution per item, and an
--     item is resolved exactly when it has one.
--   * **Tokens are hash-only and unique; exceptions are scoped.** A token is stored only as an
--     HMAC digest no other column could undo; an allow-once grant is for one run its card names,
--     one narrow path, within the workspace's TTL.
--   * **The stat card is arithmetic.** `decision_metrics_weekly` equals an oracle computed from the
--     raw rows, and the seeded week is the hand-computed 11 · 41s · 6m with one policy answer; the
--     head's estimate is the open cards' per-kind medians, 90 seconds.
--   * **The cards are the universe's.** Every ref resolves; the merge card's facts are PR #504's;
--     Allow once has a failing guardrail evaluation to clear; the pill excludes the snoozed item.
--
-- V093–V097 refuse most of these at write time, and constraints.sql asserts that against its own
-- fixtures. This fragment asks the same rules of **the seeded database's rows**.
-- tests/verify-inbox-invariants.sh removes each rule (or plants a drifted row) to prove each probe
-- goes red naming it.
--
-- **Every assertion's message starts with the name of the invariant it protects**, so a red build
-- says which guarantee went and the verifier can require that name.
--
-- Run through tests/inbox-invariants.sql, which owns the session and the transaction. Every write
-- here is a probe that must be refused, inside a transaction that is rolled back.

-- ===========================================================================
-- 1. Vocabularies
-- ===========================================================================

-- The values a named CHECK admits, read from the catalogue rather than restated — so widening a
-- vocabulary is what this notices.
create function pg_temp.inbox_vocabulary(p_table text, p_constraint text) returns setof text
language sql stable as $$
  select m[1]
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conrelid = ('ouroboros.' || p_table)::regclass and c.conname = p_constraint
$$;

select pg_temp.must_hold(
  exists (select 1 from ouroboros.decision_items where id::text like '5eed0082-%'),
  'decision_vocabularies_seeded: the database holds the inbox seed to probe — seed it with flyway.seed.toml');

select pg_temp.must_hold(
  not exists (select v from pg_temp.inbox_vocabulary('decision_items', 'decision_items_status') v
               where not exists (select 1 from ouroboros.decision_items i
                                  where i.id::text like '5eed0082-%' and i.status = v))
  and not exists (select v from pg_temp.inbox_vocabulary('decision_items', 'decision_items_severity') v
                   where not exists (select 1 from ouroboros.decision_items i
                                      where i.id::text like '5eed0082-%' and i.severity = v))
  and not exists (select v from pg_temp.inbox_vocabulary('decision_resolutions', 'decision_resolutions_resolver') v
                   where not exists (select 1 from ouroboros.decision_resolutions r
                                      where r.item_id::text like '5eed0082-%' and r.resolver = v))
  and not exists (select v from pg_temp.inbox_vocabulary('decision_resolutions', 'decision_resolutions_channel') v
                   where not exists (select 1 from ouroboros.decision_resolutions r
                                      where r.item_id::text like '5eed0082-%' and r.channel = v))
  and (select count(*) >= 2 from pg_temp.inbox_vocabulary('decision_resolutions', 'decision_resolutions_channel')),
  'decision_vocabularies_seeded: every status, severity, resolver and channel the CHECKs admit is a seeded row');

-- spend_approval is declared dormant (#461) — no plane asks it yet — and constraints.sql's V097
-- section files and renders one; every other declared kind is a seeded card.
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.decision_kinds_current k
               where k.kind_id <> 'spend_approval'
                 and not exists (select 1 from ouroboros.decision_items i
                                  where i.id::text like '5eed0082-%' and i.kind_id = k.kind_id)),
  'decision_vocabularies_seeded: every declared kind but the dormant spend_approval is a seeded card');

-- ===========================================================================
-- 2. Keys
-- ===========================================================================
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.decision_items
               group by organization_id, idempotency_key having count(*) > 1),
  'decision_items_idempotent: no workspace holds two items with one (plane, source_ref)');

select pg_temp.must_reject(
  $$insert into ouroboros.decision_items
      (organization_id, kind_id, kind_version, payload, refs, emitted_by, source_ref)
    select organization_id, kind_id, kind_version, payload, refs, emitted_by, source_ref
      from ouroboros.decision_items where id = '5eed0082-0000-4000-8000-000000000001'$$,
  'decision_items_idempotent: a second merge card for PR #504 is refused', 'decision_items_idempotency_key');

select pg_temp.must_hold(
  not exists (select 1 from ouroboros.decision_resolutions group by item_id having count(*) > 1)
  and not exists (select 1 from ouroboros.decision_items i
                   where (i.status = 'resolved')
                         <> exists (select 1 from ouroboros.decision_resolutions r where r.item_id = i.id)),
  'decision_resolutions_one_per_item: every resolved item has exactly one resolution, and no other item has any');

select pg_temp.must_hold(
  (select array_agg(a.attname order by a.attname) = array['item_id']::name[]
     from pg_constraint c
     join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'ouroboros.decision_resolutions'::regclass and c.contype = 'p'),
  'decision_resolutions_one_per_item: the resolution is keyed by its item alone');

-- ===========================================================================
-- 3. Tokens and exceptions
-- ===========================================================================

-- A token row carries a digest, the key's name, and lifecycle stamps — no column a raw token could
-- sit in. A new text column is a place one could, so the set is closed.
select pg_temp.must_hold(
  (select array_agg(column_name::text order by column_name)
          = array['action_id', 'channel', 'created_at', 'expires_at', 'hash_algorithm',
                  'hash_key_ref', 'id', 'item_id', 'organization_id', 'requires_confirm',
                  'revoke_reason', 'revoked_at', 'token_hash', 'used_at', 'user_id']
     from information_schema.columns
    where table_schema = 'ouroboros' and table_name = 'action_tokens')
  and not exists (select 1 from ouroboros.action_tokens t where t.token_hash !~ '^[0-9a-f]{64}$'),
  'action_tokens_hash_only: a token is stored as a 64-hex HMAC digest and nothing else a token could be read back from');

select pg_temp.must_reject(
  $$insert into ouroboros.action_tokens
      (organization_id, item_id, action_id, user_id, token_hash, hash_key_ref, channel,
       requires_confirm, expires_at)
    select i.organization_id, i.id, 'approve_merge', u."id", 'orb_act_plaintext-token', 'dev-seed-key',
           'email', true, now() + interval '1 hour'
      from ouroboros.decision_items i, ouroboros."user" u
     where i.id = '5eed0082-0000-4000-8000-000000000001' and u.email = 'ken@acme-robotics.dev'$$,
  'action_tokens_hash_only: a token written as itself is refused', 'action_tokens_hash_hex');

select pg_temp.must_reject(
  $$insert into ouroboros.action_tokens
      (organization_id, item_id, action_id, user_id, token_hash, hash_key_ref, channel,
       requires_confirm, expires_at)
    select i.organization_id, i.id, 'approve_merge', u."id", repeat('ab', 32), 'dev-seed-key',
           'email', true, now() + interval '1 hour'
      from ouroboros.decision_items i, ouroboros."user" u
     where i.id = '5eed0082-0000-4000-8000-000000000001'
       and u.email in ('ken@acme-robotics.dev', 'maya@acme-robotics.dev')$$,
  'action_tokens_hash_only: two tokens with one digest are refused — a hash names one token', 'action_tokens_hash_unique');

select pg_temp.must_hold(
  not exists (select 1 from ouroboros.guardrail_exceptions e
               where strpos(e.path_glob, '**') > 0
                  or e.expires_at > e.created_at
                       + (select t.exception_max_ttl from ouroboros.decision_ttl_settings(e.organization_id) t)
                  or not exists (select 1 from ouroboros.decision_items i
                                  where i.id = e.granted_via
                                    and i.refs @> jsonb_build_array(jsonb_build_object('type', 'run',
                                                                      'id', e.run_id::text)))),
  'guardrail_exceptions_scoped: every stored grant is one narrow path, within the TTL, for a run its card names');

select pg_temp.must_reject(
  $$insert into ouroboros.guardrail_exceptions
      (organization_id, run_id, path_glob, granted_by, granted_via, expires_at)
    select i.organization_id, (i.refs -> 0 ->> 'id')::uuid, 'boot/**', u."id", i.id,
           now() + interval '1 hour'
      from ouroboros.decision_items i, ouroboros."user" u
     where i.id = '5eed0082-0000-4000-8000-000000000002' and u.email = 'ken@acme-robotics.dev'$$,
  'guardrail_exceptions_scoped: Allow once on loop #1844 never grants boot/**', 'guardrail_exceptions_path_glob_narrow');

select pg_temp.must_reject(
  $$insert into ouroboros.guardrail_exceptions
      (organization_id, run_id, path_glob, granted_by, granted_via, expires_at)
    select i.organization_id, (i.refs -> 0 ->> 'id')::uuid, i.payload ->> 'path', u."id", i.id,
           now() + interval '30 days'
      from ouroboros.decision_items i, ouroboros."user" u
     where i.id = '5eed0082-0000-4000-8000-000000000002' and u.email = 'ken@acme-robotics.dev'$$,
  'guardrail_exceptions_scoped: a grant outliving the workspace''s TTL is refused', 'guardrail_exceptions_ttl_bounded');

select pg_temp.must_reject(
  $$insert into ouroboros.guardrail_exceptions
      (organization_id, run_id, path_glob, granted_by, granted_via, expires_at)
    select i.organization_id, other.id, i.payload ->> 'path', u."id", i.id, now() + interval '1 hour'
      from ouroboros.decision_items i, ouroboros."user" u, ouroboros.runs other
     where i.id = '5eed0082-0000-4000-8000-000000000002' and u.email = 'ken@acme-robotics.dev'
       and other.organization_id = i.organization_id and other.loop_seq = 1847$$,
  'guardrail_exceptions_scoped: the allow-once card grants nothing on another loop', 'guardrail_exceptions_granted_for_run');

-- ===========================================================================
-- 4. The stat card and the head
-- ===========================================================================

-- The oracle, from the raw rows: latency is resolved − asked, the wait is each block cut at the
-- answer, both recomputed here rather than read back from the columns the view aggregates.
select pg_temp.must_hold(
  not exists (
    (select w.organization_id, w.week, w.decisions, w.median_answer_latency, w.max_loop_wait,
            w.policy_resolutions
       from ouroboros.decision_metrics_weekly w)
    except
    (select r.organization_id, (date_trunc('week', r.resolved_at at time zone 'UTC'))::date,
            count(*)::integer,
            percentile_cont(0.5) within group (order by r.resolved_at - i.created_at),
            max((select max(least(coalesce(b.unblocked_at, r.resolved_at), r.resolved_at) - b.blocked_at)
                   from ouroboros.run_blocks b
                  where b.decision_item_id = i.id and b.blocked_at < r.resolved_at)),
            (count(*) filter (where r.resolver = 'policy'))::integer
       from ouroboros.decision_resolutions r
       join ouroboros.decision_items i on i.id = r.item_id
      where r.action_id <> 'source_resolved'
      group by r.organization_id, (date_trunc('week', r.resolved_at at time zone 'UTC'))::date)),
  'decision_metrics_oracle: decision_metrics_weekly equals the count, median answer time, longest wait and policy share recomputed from the raw rows');

select pg_temp.must_hold(
  (select w.decisions = 11
          and w.median_answer_latency = interval '41 seconds'
          and w.max_loop_wait = interval '6 minutes'
          and w.policy_resolutions = 1
     from ouroboros.decision_metrics_weekly w
    where w.organization_id = '5eed0001-0000-4000-8000-000000000001'
      and w.week = (select (date_trunc('week', max(r.resolved_at) at time zone 'UTC'))::date
                      from ouroboros.decision_resolutions r
                     where r.item_id::text like '5eed0082-%')),
  'decision_metrics_oracle: the seeded week is the hand-computed 11 decisions · median 41s · longest wait 6m · one policy answer');

-- The head's estimate: each open card costs its kind's median answer time this week, or the
-- week's median when nobody answered that kind this week (#460).
select pg_temp.must_hold(
  (select sum(coalesce(k.median_answer_latency, w.median_answer_latency)) = interval '90 seconds'
     from ouroboros.decision_items i
     join ouroboros.decision_metrics_weekly w
       on w.organization_id = i.organization_id
      and w.week = (select (date_trunc('week', max(r.resolved_at) at time zone 'UTC'))::date
                      from ouroboros.decision_resolutions r
                     where r.organization_id = i.organization_id)
     left join ouroboros.decision_metrics_weekly_by_kind k
       on k.organization_id = i.organization_id and k.week = w.week and k.kind_id = i.kind_id
    where i.organization_id = '5eed0001-0000-4000-8000-000000000001' and i.status = 'open'),
  'decision_metrics_oracle: the head''s estimate is the open cards'' per-kind medians — 41 + 8 + 41 = about 90 seconds');

-- ===========================================================================
-- 5. The cards are the universe's
-- ===========================================================================
select pg_temp.must_hold(
  not exists (select 1
                from ouroboros.decision_items i
                cross join lateral jsonb_array_elements(i.refs) ref
               where i.id::text like '5eed0082-%'
                 and not ouroboros.decision_ref_resolves(i.organization_id, ref)),
  'inbox_refs_resolve: every ref of every seeded item names a real row of its own workspace');

select pg_temp.must_hold(
  (select (i.payload ->> 'added')::integer = pr.additions
          and (i.payload ->> 'removed')::integer = pr.deletions
          and (i.payload ->> 'files')::integer = pr.changed_files
          and (i.payload ->> 'checks_passed')::integer
              = (select count(*) from ouroboros.pr_gate_results_latest g
                  where g.revision_id = rev.id and g.required and g.gate_key <> 'human_approval'
                    and g.verdict in ('green', 'waived', 'not_required'))
          and (i.payload ->> 'checks_total')::integer
              = (select count(*) from ouroboros.pr_gate_results_latest g
                  where g.revision_id = rev.id and g.required and g.gate_key <> 'human_approval')
          and i.payload ->> 'matrix_state'
              = case when (select bool_and(c.status in ('verified', 'waived'))
                             from ouroboros.pr_criteria c where c.pr_id = pr.id)
                     then 'all ✓' else 'incomplete' end
     from ouroboros.decision_items i
     join ouroboros.pull_requests pr
       on i.refs @> jsonb_build_array(jsonb_build_object('type', 'pr', 'id', pr.id::text))
     join ouroboros.pr_revisions rev
       on rev.pr_id = pr.id
      and rev.revision_seq = (select max(r.revision_seq) from ouroboros.pr_revisions r where r.pr_id = pr.id)
    where i.id = '5eed0082-0000-4000-8000-000000000001'),
  'merge_card_matches_pr: the merge card''s checks, matrix and diff stat are PR #504''s, as its verification page reads them');

select pg_temp.must_hold(
  (select latest.verdict = 'fail'
          and latest.evidence ->> 'path' = i.payload ->> 'path'
          and exists (select 1 from ouroboros.run_blocks b
                       where b.decision_item_id = i.id and b.run_id = latest.run_id
                         and b.unblocked_at is null)
     from ouroboros.decision_items i
     join ouroboros.v_run_guardrails_latest latest
       on latest.run_id = (i.refs -> 0 ->> 'id')::uuid and latest."check" = 'allowed_paths'
    where i.id = '5eed0082-0000-4000-8000-000000000002' and i.status = 'open'),
  'allow_once_has_stop: the open allow-once card''s loop is stopped by a failing allowed_paths verdict on its path, and blocked on the card');

select pg_temp.must_hold(
  (select count(*) filter (where i.status = 'open'
                              or (i.status = 'snoozed' and i.snoozed_until <= now())) = 3
          and count(*) filter (where i.status = 'snoozed' and i.snoozed_until > now()
                                 and exists (select 1 from ouroboros.decision_snooze_events e
                                              where i.id = any (e.items) and e."until" = i.snoozed_until)) = 1
     from ouroboros.decision_items i
    where i.organization_id = '5eed0001-0000-4000-8000-000000000001'),
  'pill_excludes_snoozed: the pill counts three — the snoozed item is hidden until its time, and its snooze is audited');
