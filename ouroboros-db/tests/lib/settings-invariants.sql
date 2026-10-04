-- settings-invariants.sql — the invariants mockup 17's Settings page is written against, named
-- (#484, BQ.5).
--
-- The settings schemas hold promises a later migration could relax without any test noticing:
--
--   * **Policy versions are immutable.** "policy v7" in an audit line must name what v7 said then.
--     An UPDATE of a published version must fail, and every stored version must hold the
--     document envelope (the five core rules, `{enabled, conditions}`, integer-cent caps).
--     The JSON Schema half is ci/db's org-policy-schema step over the same rows.
--   * **Capabilities are explicit.** `member_capabilities.can_approve_loops` exists, is a
--     not-null boolean, and has no column default — a written row says yes or no, and no row
--     means the role default (REST). A new service account holds no scopes until given some.
--   * **Retention has a floor.** Audit at least 90 days, every other class at least 7.
--   * **No plaintext secrets.** A webhook signing key is only ever a sealed envelope, no other
--     webhook column could hold one, and a service key is only ever its SHA-256 digest.
--   * **Truth is derived.** A webhook is only ever sent a family it subscribed to; only email
--     delivers in this build, so a Slack or PagerDuty route never reads as delivering; and every
--     seeded audit line's subject resolves to a row in its own workspace.
--
-- V091, V092 and V094 refuse most of these at write time, and constraints.sql asserts that where
-- each migration lives. This fragment reads the same rules over **the seeded database's rows**,
-- and asks the behaviour of the seeded rows themselves (an UPDATE of the seeded v7 must fail).
-- tests/verify-settings-invariants.sh removes each rule and plants the row it refused, to prove
-- each probe goes red naming it.
--
-- **Every assertion's message starts with the name of the invariant it protects**, so a red build
-- says which guarantee went and the verifier can require that name.
--
-- Run through tests/settings-invariants.sql, which owns the session and the transaction. Every
-- write here is a probe that must be refused, inside a transaction that is rolled back.

-- ===========================================================================
-- 1. Policy versions
-- ===========================================================================

-- --- a published version is never revised or deleted --------------------------------------------
select pg_temp.must_hold(
  exists (select 1 from ouroboros.org_policy_versions),
  'org_policy_versions_immutable: the database holds published policy versions to probe — seed it with flyway.seed.toml');

select pg_temp.must_raise(
  $$update ouroboros.org_policy_versions
       set document = jsonb_set(document, '{auto_merge,enabled}', 'false')
     where version = (select max(version) from ouroboros.org_policy_versions)$$,
  '23001',
  'org_policy_versions_immutable: an UPDATE of a published version fails — "policy v7" names what v7 said');

select pg_temp.must_raise(
  $$delete from ouroboros.org_policy_versions where version = 1$$,
  '23001',
  'org_policy_versions_immutable: a published version is deleted only with its workspace');

-- --- every stored version holds the envelope ----------------------------------------------------
select pg_temp.must_hold(
  not exists (
    select 1
      from ouroboros.org_policy_versions v
     where jsonb_typeof(v.document) <> 'object'
        or not (v.document ?& array['auto_merge', 'human_review', 'protected_paths',
                                     'spend_guard', 'dry_run_new_repos'])
        or exists (select 1 from jsonb_each(v.document) rule(id, body)
                    where (rule.id not in ('auto_merge', 'human_review', 'protected_paths',
                                           'spend_guard', 'dry_run_new_repos')
                           and rule.id !~ '^custom:[a-z0-9][a-z0-9_-]{0,62}$')
                       or jsonb_typeof(rule.body) <> 'object'
                       or jsonb_typeof(rule.body -> 'enabled') is distinct from 'boolean'
                       or jsonb_typeof(rule.body -> 'conditions') is distinct from 'object')
        or exists (select 1 from jsonb_each(v.document #> '{spend_guard,conditions}') cap(name, value)
                    where cap.name in ('per_run_cap_cents', 'monthly_cap_cents')
                      and (jsonb_typeof(cap.value) <> 'number'
                           or cap.value::numeric <> trunc(cap.value::numeric)
                           or cap.value::numeric < 1))),
  'org_policy_versions_envelope: every stored version has the five core rules, each {enabled, conditions}, and integer-cent caps');

-- --- the handle points at the newest -------------------------------------------------------------
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.org_policies handle
               where handle.current_version is distinct from
                     (select max(v.version) from ouroboros.org_policy_versions v
                       where v.organization_id = handle.organization_id)),
  'org_policies_current_is_latest: every policy is in force at its newest published version');

-- ===========================================================================
-- 2. Capabilities
-- ===========================================================================
select pg_temp.must_hold(
  (select c.data_type = 'boolean' and c.is_nullable = 'NO' and c.column_default is null
     from information_schema.columns c
    where c.table_schema = 'ouroboros' and c.table_name = 'member_capabilities'
      and c.column_name = 'can_approve_loops'),
  'member_capabilities_explicit: can_approve_loops is a not-null boolean with no default — a row says yes or no, no row means the role''s');

select pg_temp.must_hold(
  (select c.column_default = '''[]''::jsonb' and c.is_nullable = 'NO'
     from information_schema.columns c
    where c.table_schema = 'ouroboros' and c.table_name = 'service_accounts'
      and c.column_name = 'scopes'),
  'service_accounts_least_privilege: a new service account holds no scopes until it is given some');

-- ===========================================================================
-- 3. Retention
-- ===========================================================================
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.retention_policies p
               where p.days < case when p.data_class = 'audit' then 90 else 7 end),
  'retention_policies_floor: every stored tier keeps audit at least 90 days and everything else at least 7');

select pg_temp.must_reject(
  $$update ouroboros.retention_policies set days = 30 where data_class = 'audit'$$,
  'retention_policies_floor: an audit tier below 90 days is refused', 'retention_policies_days_floor');

select pg_temp.must_reject(
  $$update ouroboros.retention_policies set days = 3 where data_class = 'transcripts'$$,
  'retention_policies_floor: a transcript tier below 7 days is refused', 'retention_policies_days_floor');

-- ===========================================================================
-- 4. No plaintext secrets
-- ===========================================================================
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.webhook_endpoints e where e.hmac_key_sealed not like 'ouro.v1.%')
  and (select array_agg(c.column_name::text) = array['hmac_key_sealed']
         from information_schema.columns c
        where c.table_schema = 'ouroboros' and c.table_name in ('webhook_endpoints', 'webhook_deliveries')
          and c.column_name ~ '(secret|key|token|password|credential)'),
  'webhook_keys_sealed: every stored signing key is a sealed envelope, and hmac_key_sealed is the only webhook column that could hold a key');

select pg_temp.must_reject(
  $$update ouroboros.webhook_endpoints set hmac_key_sealed = 'whsec_plaintext-signing-key'$$,
  'webhook_keys_sealed: a plaintext signing key is refused', 'webhook_endpoints_hmac_key_envelope');

select pg_temp.must_hold(
  not exists (select 1 from ouroboros.service_tokens t
               where t.token_hash !~ '^[0-9a-f]{64}$' or t.hint_sealed not like 'ouro.v1.%')
  and (select array_agg(c.column_name::text order by c.column_name)
              = array['created_at', 'created_by', 'hint_sealed', 'id', 'last_used_at', 'organization_id',
                      'revoked_at', 'service_account_id', 'token_hash']
         from information_schema.columns c
        where c.table_schema = 'ouroboros' and c.table_name = 'service_tokens'),
  'service_tokens_hash_only: every stored service key is its SHA-256 and a sealed hint, and no column could hold the key itself');

select pg_temp.must_reject(
  $$update ouroboros.service_tokens set token_hash = 'orb_svc_plaintext'$$,
  'service_tokens_hash_only: a key stored as itself is refused', 'service_tokens_hash_hex');

-- ===========================================================================
-- 5. Derived truth
-- ===========================================================================
select pg_temp.must_hold(
  not exists (select 1 from ouroboros.webhook_deliveries d
                join ouroboros.webhook_endpoints e on e.id = d.endpoint_id
               where d.event_type <> 'ping'
                 and not e.event_families ? (split_part(d.event_type, '.', 1) || '.*')),
  'webhook_deliveries_family_subscribed: every stored delivery is of a family its endpoint subscribes to');

select pg_temp.must_hold(
  not exists (select 1 from ouroboros.notification_routes_effective r
               where r.channel <> 'email' and (r.delivering or not r.locked or r.locked_reason is null)),
  'notification_routes_lock_derived: only email delivers in this build — every Slack or PagerDuty route reads locked, with a reason');

-- Seeded audit lines only (`5eed…` ids): a developer's own trail may name things since deleted —
-- provider.deleted is exactly that event.
select pg_temp.must_hold(
  not exists (
    select 1
      from ouroboros.audit_events e
     where e.id::text like '5eed%'
       and e.subject_type in ('pr_revision', 'provider_connection', 'org_policy', 'run', 'runner')
       and not case e.subject_type
                 when 'pr_revision' then exists (
                   select 1 from ouroboros.pr_revisions rev
                     join ouroboros.pull_requests pr on pr.id = rev.pr_id
                    where rev.id::text = e.subject_id and pr.organization_id = e.organization_id)
                 when 'provider_connection' then exists (
                   select 1 from ouroboros.provider_connections c
                    where c.id::text = e.subject_id and c.organization_id = e.organization_id)
                 when 'org_policy' then exists (
                   select 1 from ouroboros.org_policies p
                    where p.organization_id = e.subject_id and e.subject_id = e.organization_id)
                 when 'run' then exists (
                   select 1 from ouroboros.runs r
                    where r.id::text = e.subject_id and r.organization_id = e.organization_id)
                 when 'runner' then exists (
                   select 1 from ouroboros.runners r
                    where r.id::text = e.subject_id and r.organization_id = e.organization_id)
               end),
  'settings_audit_subjects_resolve: every seeded audit line''s PR, credential, policy, run and runner is a row in its own workspace');
