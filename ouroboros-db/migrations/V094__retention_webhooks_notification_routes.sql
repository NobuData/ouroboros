-- V094__retention_webhooks_notification_routes.sql — retention tiers, outbound webhooks and org
-- notification routes: the three Settings tables mockup 17 renders that no plane had yet (#484).
--
-- BQ.5 (#484) seeds mockup 17 from real rows, and three of its cards had no table to seed:
--
--   1. **`retention_policies`** — the workspace card's *Data retention · 30 days* and the audit
--      card's *retained 400d*. One row per (workspace, data class), `days` bounded below per
--      class: **audit at least 90 days, every other class at least 7** (`retention_policies_days_floor`).
--      The schema BQ.3 (#482) specifies; the service the three sweeps read, and the defaults a
--      workspace with no row falls back to (30/30/30/400), are BQ.3's.
--   2. **`webhook_endpoints`** and **`webhook_deliveries`** — the integrations grid's
--      *Webhooks · 2 active* and the audit card's *Stream to SIEM ✓*. An endpoint is https-only,
--      subscribes to registered event families, and holds its HMAC signing key **sealed** under the
--      workspace DEK (an AD.1 `ouro.v1.…` envelope) — never in the clear, because signing needs the
--      key back, so a hash would not do. SIEM is **an endpoint subscribed to `audit.*` and flagged
--      `siem`**, at most one per workspace; the ✓ is derived from its deliveries, never stored.
--      The delivery log is one row per attempt. The schema BR.3 (#487) specifies; the delivery
--      pipeline, signing and SSRF policy are BR.3's, and it drains V090's `audit_event_outbox`.
--   3. **`notification_routes`** — the notifications card: org-level routes (*daily digest
--      09:00 → email*) above BN.3's per-person preferences. A route binds a kind to a channel.
--      Only `email` can be delivered in this build: Slack is mockup 19's and PagerDuty a v2
--      connector (BT.3), neither of which exists, so a route on either is **locked**, and
--      `notification_routes_effective` derives the lock and its reason (*connect PagerDuty
--      first*) rather than storing a sentence that could go stale. The schema BR.4 (#488)
--      specifies; the senders that read it are BR.4's.
--
-- These were built ahead of their REST tickets at the user's direction (the same call #489 made
-- for the outbox), so the seed joins the universe through real tables rather than literals.

-- ---------------------------------------------------------------------------
-- 1. retention_policies — one tier per data class.
-- ---------------------------------------------------------------------------
create table ouroboros.retention_policies (
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The four classes the card's select governs, or `custom:<slug>` for one a later plane adds.
  data_class      text        not null
                              constraint retention_policies_data_class_known
                                check (data_class in ('transcripts', 'build_logs', 'artifacts', 'audit')
                                       or data_class ~ '^custom:[a-z0-9][a-z0-9_-]{0,62}$'),

  -- Whole days. The floor is a compliance rule, not a preference: an audit trail kept for less
  -- than 90 days cannot answer a quarterly review, and a week is the least any loop data needs
  -- to survive a long weekend's investigation.
  days            integer     not null
                              constraint retention_policies_days_floor
                                check (days >= case when data_class = 'audit' then 90 else 7 end),

  updated_by      text        references ouroboros."user" ("id") on delete set null,
  updated_at      timestamptz not null default now(),

  constraint retention_policies_pkey primary key (organization_id, data_class)
);

create trigger retention_policies_touch_updated_at
  before update on ouroboros.retention_policies
  for each row execute function ouroboros.touch_updated_at();

comment on table ouroboros.retention_policies is
  'How long each class of a workspace''s data is kept (#484, schema for BQ.3 #482): one row per (workspace, data class). Bounded below per class — audit at least 90 days, everything else at least 7. A class with no row takes BQ.3''s default (30 days; audit 400).';
comment on column ouroboros.retention_policies.data_class is
  'transcripts | build_logs | artifacts | audit, or custom:<slug>. The workspace card''s one select writes the first three together.';
comment on column ouroboros.retention_policies.days is
  'Whole days kept. At least 90 for audit and 7 for every other class (retention_policies_days_floor).';

grant select, insert, update, delete on ouroboros.retention_policies to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 2. webhook_endpoints — where signed events go.
-- ---------------------------------------------------------------------------
create table ouroboros.webhook_endpoints (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- What the card and the delivery log call it: `SIEM · Splunk HEC`.
  name            text        not null
                              constraint webhook_endpoints_name_present
                                check (btrim(name) = name and name <> '' and length(name) <= 80),

  -- https only, and no user-info: a credential in a URL is a plaintext credential in a column.
  -- Which hosts may be reached (internal ranges, the self-hosted override) is BR.3's SSRF policy.
  url             text        not null
                              constraint webhook_endpoints_url_https
                                check (url ~ '^https://[^\s/?#@]+(/[^\s]*)?$' and length(url) <= 2048),

  -- The HMAC-SHA256 signing key, sealed under the workspace DEK. Never a hash (signing needs the
  -- key back) and never the key itself.
  hmac_key_sealed text        not null
                              constraint webhook_endpoints_hmac_key_envelope
                                check (hmac_key_sealed like 'ouro.v1.%'),

  -- The families this endpoint receives — at least one, each registered.
  event_families  jsonb       not null
                              constraint webhook_endpoints_event_families_array
                                check (jsonb_typeof(event_families) = 'array')
                              constraint webhook_endpoints_event_families_registered
                                check (jsonb_typeof(event_families) <> 'array'
                                       or (event_families <> '[]'::jsonb
                                           and event_families <@ '["audit.*", "decision.*", "run.*", "pr.*"]'::jsonb)),

  -- The SIEM route: the audit card's *Stream to SIEM* row reads this endpoint.
  siem            boolean     not null default false,

  -- Switched off without being deleted: its delivery history stays readable.
  active          boolean     not null default true,

  created_by      text        references ouroboros."user" ("id") on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint webhook_endpoints_name_unique unique (organization_id, name),

  -- The target of webhook_deliveries' workspace-scoped foreign key.
  constraint webhook_endpoints_id_organization_key unique (id, organization_id),

  constraint webhook_endpoints_siem_subscribes_audit
    check (not siem or event_families ? 'audit.*')
);

-- One SIEM route per workspace, so "the SIEM endpoint" is a question with one answer.
create unique index webhook_endpoints_one_siem_idx
  on ouroboros.webhook_endpoints (organization_id)
  where siem;

create trigger webhook_endpoints_touch_updated_at
  before update on ouroboros.webhook_endpoints
  for each row execute function ouroboros.touch_updated_at();

comment on table ouroboros.webhook_endpoints is
  'Outbound webhook endpoints (#484, schema for BR.3 #487): https-only, subscribed to registered event families (audit.*, decision.*, run.*, pr.*), signed with an HMAC key sealed under the workspace DEK. The SIEM route is the one endpoint flagged siem, which must subscribe to audit.*. "Webhooks · N active" counts active rows.';
comment on column ouroboros.webhook_endpoints.hmac_key_sealed is
  'The HMAC-SHA256 signing key as an AD.1 ouro.v1.… envelope. Never stored in the clear and never echoed by an API.';
comment on column ouroboros.webhook_endpoints.event_families is
  'Subscribed families: a non-empty subset of ["audit.*", "decision.*", "run.*", "pr.*"]. Widening the registry is a migration.';
comment on column ouroboros.webhook_endpoints.siem is
  'This endpoint is the workspace''s SIEM route — at most one, subscribed to audit.*. The audit card''s ✓ derives from its latest delivery.';

grant select, insert, update, delete on ouroboros.webhook_endpoints to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 3. webhook_deliveries — the delivery log, one row per attempt.
-- ---------------------------------------------------------------------------
create table ouroboros.webhook_deliveries (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  endpoint_id      uuid        not null,

  -- `audit.provider.rotated`, `pr.revision_pushed` — the family, then the event — or `ping`,
  -- the test delivery.
  event_type       text        not null
                               constraint webhook_deliveries_event_type_grammar
                                 check (event_type = 'ping'
                                        or event_type ~ '^(audit|decision|run|pr)(\.[a-z][a-z0-9_]*)+$'),

  -- The event delivered (an audit_events or audit_event_outbox id for audit.*). No foreign key:
  -- the log outlives the event's retention, as V090's outbox outlives its workspace.
  event_id         uuid,

  attempt          integer     not null
                               constraint webhook_deliveries_attempt_positive
                                 check (attempt >= 1),

  -- pending: in flight · succeeded: a 2xx · failed: will be retried · dead_lettered: retries
  -- exhausted, visible and redeliverable.
  status           text        not null
                               constraint webhook_deliveries_status_known
                                 check (status in ('pending', 'succeeded', 'failed', 'dead_lettered')),

  -- Null when no response arrived (a timeout, a refused connection).
  response_code    integer
                               constraint webhook_deliveries_response_code_http
                                 check (response_code between 100 and 599),

  latency_ms       integer
                               constraint webhook_deliveries_latency_nonnegative
                                 check (latency_ms >= 0),

  -- The bounded capture of the receiver's body, for the log's detail row.
  response_excerpt text
                               constraint webhook_deliveries_response_excerpt_bounded
                                 check (length(response_excerpt) <= 1024),

  attempted_at     timestamptz not null default now(),

  constraint webhook_deliveries_endpoint_fk
    foreign key (endpoint_id, organization_id)
    references ouroboros.webhook_endpoints (id, organization_id) on delete cascade,

  -- A status must agree with what came back: a success is a 2xx, a failure never is, and an
  -- attempt still in flight has no response yet.
  constraint webhook_deliveries_outcome_recorded
    check (case status
             when 'pending'   then response_code is null and latency_ms is null
             when 'succeeded' then response_code between 200 and 299
             else response_code is null or response_code not between 200 and 299
           end)
);

create index webhook_deliveries_endpoint_idx
  on ouroboros.webhook_deliveries (endpoint_id, attempted_at desc);

create index webhook_deliveries_organization_idx
  on ouroboros.webhook_deliveries (organization_id, attempted_at desc);

comment on table ouroboros.webhook_deliveries is
  'The webhook delivery log (#484, schema for BR.3 #487): one row per attempt — status, response code, latency and a bounded body excerpt. An endpoint is only ever sent events of a family it subscribes to (webhook_deliveries_family_subscribed), or the ping test event.';
comment on column ouroboros.webhook_deliveries.status is
  'pending | succeeded (a 2xx) | failed (retried) | dead_lettered (retries exhausted; redeliverable).';

grant select, insert, update on ouroboros.webhook_deliveries to ouroboros_app;

-- ---------------------------------------------------------------------------
-- An endpoint receives only what it subscribed to.
-- ---------------------------------------------------------------------------
create function ouroboros.webhook_delivery_family_subscribed() returns trigger
language plpgsql
as $$
declare
  families jsonb;
begin
  -- The test event goes anywhere; a malformed type is the grammar CHECK's complaint, not this one's
  -- (a BEFORE trigger fires ahead of every CHECK).
  if new.event_type = 'ping' or new.event_type !~ '^(audit|decision|run|pr)(\.[a-z][a-z0-9_]*)+$' then
    return new;
  end if;

  select event_families into families
    from ouroboros.webhook_endpoints
   where id = new.endpoint_id;

  -- No endpoint is the foreign key's complaint, not this one's.
  if families is null or families ? (split_part(new.event_type, '.', 1) || '.*') then
    return new;
  end if;

  raise exception
    'endpoint % is not subscribed to %', new.endpoint_id, split_part(new.event_type, '.', 1) || '.*'
    using errcode = 'check_violation', constraint = tg_name,
          hint = 'An endpoint is sent only the families in its event_families, and the ping test event.';
end;
$$;

comment on function ouroboros.webhook_delivery_family_subscribed() is
  'BEFORE INSERT OR UPDATE trigger for webhook_deliveries (#484): the delivered event''s family (the text before its first dot) is one the endpoint subscribes to, or the event is ping. Family filtering is exact. Raises class 23 naming the trigger.';

create trigger webhook_deliveries_family_subscribed
  before insert or update of event_type, endpoint_id on ouroboros.webhook_deliveries
  for each row execute function ouroboros.webhook_delivery_family_subscribed();

-- ---------------------------------------------------------------------------
-- 4. notification_routes — org-level routes, and the view that says which can deliver.
-- ---------------------------------------------------------------------------

-- Staged rather than one boolean expression: SQL does not promise `and`'s order, and a cast or a
-- regex over a value of the wrong type would raise where it should refuse (V093's lesson).
create function ouroboros.notification_route_config_valid(config jsonb) returns boolean
language plpgsql immutable strict parallel safe
as $$
begin
  if exists (select 1 from jsonb_object_keys(config) as k(key)
              where k.key not in ('time', 'weekday', 'recipients')) then
    return false;
  end if;

  if config ? 'time'
     and (jsonb_typeof(config -> 'time') <> 'string'
          or (config ->> 'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    return false;
  end if;

  if config ? 'weekday'
     and (jsonb_typeof(config -> 'weekday') <> 'string'
          or (config ->> 'weekday') not in ('monday', 'tuesday', 'wednesday', 'thursday',
                                            'friday', 'saturday', 'sunday')) then
    return false;
  end if;

  if config ? 'recipients' then
    if jsonb_typeof(config -> 'recipients') <> 'array'
       or jsonb_array_length(config -> 'recipients') = 0 then
      return false;
    end if;
    if exists (select 1 from jsonb_array_elements(config -> 'recipients') as r(value)
                where jsonb_typeof(r.value) <> 'string'
                   or (r.value #>> '{}') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function ouroboros.notification_route_config_valid(jsonb) is
  'Whether a notification route''s config holds only time (HH:MM), weekday (monday … sunday) and recipients (a non-empty list of email addresses), each well formed (#484).';

create table ouroboros.notification_routes (
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  kind            text        not null
                              constraint notification_routes_kind_known
                                check (kind in ('needs_you_dm', 'daily_digest', 'loop_failures', 'weekly_insights')
                                       or kind ~ '^custom:[a-z0-9][a-z0-9_-]{0,62}$'),

  channel         text        not null
                              constraint notification_routes_channel_known
                                check (channel in ('email', 'slack', 'pagerduty')),

  -- {time: "09:00", weekday: "monday", recipients: ["eng-leads@…"]} — each key optional.
  config          jsonb       not null default '{}'::jsonb
                              constraint notification_routes_config_object
                                check (jsonb_typeof(config) = 'object'),

  -- Whether the workspace wants this route. Whether it *can* deliver is the view's question.
  enabled         boolean     not null default true,

  updated_by      text        references ouroboros."user" ("id") on delete set null,
  updated_at      timestamptz not null default now(),

  constraint notification_routes_pkey primary key (organization_id, kind),

  constraint notification_routes_config_shape
    check (jsonb_typeof(config) <> 'object'
           or ouroboros.notification_route_config_valid(config))
);

comment on table ouroboros.notification_routes is
  'Org-level notification routes (#484, schema for BR.4 #488): one per (workspace, kind), bound to a channel. Read through notification_routes_effective, which derives whether the channel can deliver in this build.';
comment on column ouroboros.notification_routes.config is
  'Optional keys: time (HH:MM, UTC), weekday (monday … sunday), recipients (a non-empty list of email addresses). Nothing else.';

create trigger notification_routes_touch_updated_at
  before update on ouroboros.notification_routes
  for each row execute function ouroboros.touch_updated_at();

grant select, insert, update, delete on ouroboros.notification_routes to ouroboros_app;

-- The lock is derived, never stored. Only email delivers in this build: Slack is mockup 19's
-- (ChatOps) and PagerDuty a v2 connector (BT.3), and neither has a connection to bind to. When
-- one lands, its ticket replaces that branch with a join against its connections.
create view ouroboros.notification_routes_effective
  with (security_invoker = true) as
select r.organization_id,
       r.kind,
       r.channel,
       r.config,
       r.enabled,
       lock.reason                          as locked_reason,
       (lock.reason is not null)            as locked,
       (r.enabled and lock.reason is null)  as delivering,
       r.updated_by,
       r.updated_at
  from ouroboros.notification_routes r
  cross join lateral (
    select case r.channel
             when 'email'     then null
             when 'slack'     then 'connect Slack first'
             when 'pagerduty' then 'connect PagerDuty first'
           end as reason
  ) lock;

comment on view ouroboros.notification_routes_effective is
  'notification_routes with the lock derived (#484): a route whose channel has no connection in this build is locked with the reason the card prints (connect PagerDuty first), and delivering is enabled ∧ ¬locked. Email is the only channel that delivers until mockup 19 (Slack) and BT.3 (PagerDuty) land.';

grant select on ouroboros.notification_routes_effective to ouroboros_app;
