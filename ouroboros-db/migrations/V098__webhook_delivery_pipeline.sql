-- V098__webhook_delivery_pipeline.sql — the outbound webhook delivery pipeline (#487, BR.3).
--
-- V090 built an outbox for the Danger zone's `audit.workspace.*` events, and V094 built the
-- endpoint and delivery-log tables BR.3 delivers through. This migration is what the pipeline
-- itself needs from them:
--
--   1. **`webhook_outbox`** — V090's `audit_event_outbox`, renamed because it now carries all four
--      registered families. Every audit row writes `audit.<action>` here in its own transaction;
--      the decision and PR audit actions also write `decision.<event>` / `pr.<event>`; and run
--      transitions (opened, merged, canceled) write `run.*` in the transaction that moves the run.
--      `delivered_at` becomes `dispatched_at`: the dispatcher stamps it once every subscribed
--      endpoint has a delivery queued, which is not the same as every endpoint having the event.
--   2. **`webhook_endpoints`** gains an optional `description`, the **`registry_version`** it was
--      subscribed under (adding an event type to the REST registry is a new registry version, so
--      an existing subscription never starts receiving something it was not shown), and
--      subscriptions by **exact type** beside the `family.*` wildcards. Which concrete types exist
--      is the REST registry's question — the database holds the grammar.
--   3. **`webhook_deliveries`** gains what retries need: a **`delivery_key`** (the idempotency key
--      a receiver sees as `X-Ouro-Delivery`, the same on every attempt at one event for one
--      endpoint), **`next_attempt_at`** (when a pending attempt is due; present exactly while
--      pending), and a bounded **`error`** (why an attempt failed when there was no response to
--      read, such as a timeout or the SSRF policy refusing the address). At most one attempt per
--      key is pending, and attempt numbers do not repeat within a key.

-- ---------------------------------------------------------------------------
-- 1. webhook_outbox — every family, not only audit.*.
-- ---------------------------------------------------------------------------
alter table ouroboros.audit_event_outbox rename to webhook_outbox;
alter table ouroboros.webhook_outbox rename column delivered_at to dispatched_at;
alter table ouroboros.webhook_outbox rename constraint audit_event_outbox_pkey to webhook_outbox_pkey;
alter table ouroboros.webhook_outbox rename constraint audit_event_outbox_payload_object
  to webhook_outbox_payload_object;
alter index ouroboros.audit_event_outbox_undelivered_idx rename to webhook_outbox_undispatched_idx;
alter index ouroboros.audit_event_outbox_organization_idx rename to webhook_outbox_organization_idx;

alter table ouroboros.webhook_outbox drop constraint audit_event_outbox_event_type_grammar;

-- `audit.` keeps V090's shape (the family, then the audit action's own two parts); the other
-- three families are the family and at least one more part.
alter table ouroboros.webhook_outbox
  add constraint webhook_outbox_event_type_grammar
    check (event_type ~ '^audit\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
           or event_type ~ '^(decision|run|pr)(\.[a-z][a-z0-9_]*)+$');

comment on table ouroboros.webhook_outbox is
  'Events awaiting outbound webhook delivery (#489, widened by #487): one row per event, written in the transaction of the change it records — an audit row, a run transition. The dispatcher queues a delivery for every active endpoint subscribed to it, then stamps dispatched_at. No foreign key to organization: audit.workspace.purged is written after the workspace is gone.';
comment on column ouroboros.webhook_outbox.event_type is
  'audit.<audit action>, decision.<event>, run.<event> or pr.<event> — a type in the REST event registry.';
comment on column ouroboros.webhook_outbox.dispatched_at is
  'When every endpoint subscribed to the event had a delivery queued. Null while the event waits for the dispatcher.';

-- ---------------------------------------------------------------------------
-- 2. webhook_endpoints — description, registry version, exact-type subscriptions.
-- ---------------------------------------------------------------------------
alter table ouroboros.webhook_endpoints
  add column description text
    constraint webhook_endpoints_description_bounded
      check (btrim(description) = description and description <> '' and length(description) <= 280),
  add column registry_version integer not null default 1
    constraint webhook_endpoints_registry_version_positive
      check (registry_version >= 1);

comment on column ouroboros.webhook_endpoints.description is
  'What the endpoint is for, as the management sheet shows it. Optional; never the URL''s credentials.';
comment on column ouroboros.webhook_endpoints.registry_version is
  'The REST event-registry version the subscription was made under. An event type added in a later version is not delivered until the endpoint is moved to it.';

-- Staged rather than one boolean expression (V093's lesson): a regex over a value of the wrong
-- jsonb type would raise where it should refuse.
create function ouroboros.webhook_subscription_valid(families jsonb) returns boolean
language plpgsql immutable strict parallel safe
as $$
begin
  if jsonb_typeof(families) <> 'array'
     or jsonb_array_length(families) = 0
     or jsonb_array_length(families) > 64 then
    return false;
  end if;

  return not exists (
    select 1
      from jsonb_array_elements(families) as f(value)
     where jsonb_typeof(f.value) <> 'string'
        or not ((f.value #>> '{}') ~ '^(audit|decision|run|pr)\.\*$'
                or (f.value #>> '{}') ~ '^(audit|decision|run|pr)(\.[a-z][a-z0-9_]*)+$'));
end;
$$;

comment on function ouroboros.webhook_subscription_valid(jsonb) is
  'Whether a webhook subscription list is 1–64 entries, each a family wildcard (audit.*, decision.*, run.*, pr.*) or one concrete event type of those families (#487). Whether the type exists is the REST registry''s check.';

alter table ouroboros.webhook_endpoints drop constraint webhook_endpoints_event_families_registered;

alter table ouroboros.webhook_endpoints
  add constraint webhook_endpoints_event_families_registered
    check (jsonb_typeof(event_families) <> 'array'
           or ouroboros.webhook_subscription_valid(event_families));

comment on column ouroboros.webhook_endpoints.event_families is
  'Subscriptions: 1–64 entries, each a family wildcard (audit.*, decision.*, run.*, pr.*) or an exact event type of one of them (#487). Matching is exact — a family wildcard covers its own family only.';

-- An exact-type subscription is a subscription too.
create or replace function ouroboros.webhook_delivery_family_subscribed() returns trigger
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
  if families is null
     or families ? (split_part(new.event_type, '.', 1) || '.*')
     or families ? new.event_type then
    return new;
  end if;

  raise exception
    'endpoint % is not subscribed to %', new.endpoint_id, new.event_type
    using errcode = 'check_violation', constraint = tg_name,
          hint = 'An endpoint is sent only the families or exact types in its event_families, and the ping test event.';
end;
$$;

comment on function ouroboros.webhook_delivery_family_subscribed() is
  'BEFORE INSERT OR UPDATE trigger for webhook_deliveries (#484, #487): the delivered event''s family wildcard or its exact type is one the endpoint subscribes to, or the event is ping. Family filtering is exact. Raises class 23 naming the trigger.';

-- ---------------------------------------------------------------------------
-- 3. webhook_deliveries — idempotency key, retry schedule, failure reason.
-- ---------------------------------------------------------------------------
alter table ouroboros.webhook_deliveries
  add column delivery_key uuid not null default gen_random_uuid(),
  add column next_attempt_at timestamptz,
  add column error text
    constraint webhook_deliveries_error_bounded
      check (length(error) <= 512);

-- A pending attempt is waiting for a time; a settled one is not.
alter table ouroboros.webhook_deliveries
  add constraint webhook_deliveries_next_attempt_iff_pending
    check ((status = 'pending') = (next_attempt_at is not null));

-- One attempt in flight per (event, endpoint), and attempt numbers never repeat.
create unique index webhook_deliveries_one_pending_idx
  on ouroboros.webhook_deliveries (delivery_key)
  where status = 'pending';

create unique index webhook_deliveries_key_attempt_idx
  on ouroboros.webhook_deliveries (delivery_key, attempt);

-- The dispatcher's read: every attempt now due.
create index webhook_deliveries_due_idx
  on ouroboros.webhook_deliveries (next_attempt_at)
  where status = 'pending';

comment on column ouroboros.webhook_deliveries.delivery_key is
  'The idempotency key — X-Ouro-Delivery. The same on every attempt (retry or redelivery) at one event for one endpoint, so a receiver can drop a duplicate.';
comment on column ouroboros.webhook_deliveries.next_attempt_at is
  'When a pending attempt is due. Present exactly while status = pending (webhook_deliveries_next_attempt_iff_pending).';
comment on column ouroboros.webhook_deliveries.error is
  'Why the attempt failed, at most 512 characters: a timeout, a refused connection, the SSRF policy, or the HTTP status. Never a credential.';
comment on column ouroboros.webhook_deliveries.status is
  'pending (due at next_attempt_at) | succeeded (a 2xx) | failed (not a 2xx; retried unless it was a ping) | dead_lettered (retries exhausted, or a redelivery failed; visible and redeliverable).';
