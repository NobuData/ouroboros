-- V099__decision_action_attempts.sql — every press of a decision card's action, recorded (#462,
-- BN.2, decision X3).
--
-- BN.2's executor answers a card by calling the plane that owns the operation — AX.5's approval and
-- AX.4's merge plan, AX.3's waiver, AP.3's re-evaluation, AP.4's control queue, AL.4's drafts — and
-- only then writes V095's resolution. Three properties need a row of their own:
--
--   1. **A retried request does not execute twice.** A press carries an idempotency key; one
--      attempt per (item, key), so the retry finds the first attempt and answers with what it did.
--   2. **First answer wins, while it is still running.** A merge can take seconds; a second person
--      pressing *Approve & merge* in that window must be refused before any plane is called, not
--      after. At most one attempt per item is `running`, and the loser is told whose it is.
--   3. **A failing handler leaves the item open, with the failure on record.** The attempt ends
--      `failed` with the plane's error code; no resolution is written, so a half-executed merge is
--      never reported as answered.
--
-- And one amendment to V097: `decision_item_source_resolve` leaves an item alone while an attempt on
-- it is running. Otherwise *Approve & merge* would race its own consequence — the merge settles the
-- PR, the watcher closes the card as `policy(source_resolved)`, and the person's answer finds its
-- item already closed. The watcher sweeps again; by then the item is answered and the call is a
-- no-op.
--
-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------
--
-- Recreate V097's body of decision_item_source_resolve, then
--
--   drop table ouroboros.decision_action_attempts;

create table ouroboros.decision_action_attempts (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  item_id          uuid        not null,

  -- The declared action pressed — one of the pinned kind's answered_by (the executor checks it
  -- against the declaration; this column only holds its shape).
  action_id        text        not null
                               constraint decision_action_attempts_action_id_shape
                                 check (action_id ~ '^[a-z][a-z0-9_]{0,62}$'),

  -- Who pressed it. Required when written; forgotten if the person is deleted.
  actor_id         text        references ouroboros."user" ("id") on delete set null,

  channel          text        not null
                               constraint decision_action_attempts_channel
                                 check (channel in ('web', 'email', 'github', 'slack', 'push', 'api')),

  -- The client's key, or one the executor generated. One attempt per (item, key).
  idempotency_key  text        not null
                               constraint decision_action_attempts_idempotency_key_shape
                                 check (btrim(idempotency_key) = idempotency_key
                                        and idempotency_key <> '' and length(idempotency_key) <= 200),

  status           text        not null default 'running'
                               constraint decision_action_attempts_status
                                 check (status in ('running', 'succeeded', 'failed')),

  -- What the handler did — the card's receipt — once it succeeded.
  outcome          jsonb,

  -- Why it failed: the plane's stable code, its sentence and the HTTP status it answered with.
  error_code       text,
  error_message    text,
  error_status     integer,

  started_at       timestamptz not null default now(),
  finished_at      timestamptz,

  constraint decision_action_attempts_item_fk
    foreign key (item_id, organization_id)
    references ouroboros.decision_items (id, organization_id) on delete cascade,

  constraint decision_action_attempts_item_key unique (item_id, idempotency_key),

  constraint decision_action_attempts_outcome_object
    check (outcome is null or jsonb_typeof(outcome) = 'object'),

  -- running: nothing yet; succeeded: a receipt and no error; failed: an error and no receipt.
  constraint decision_action_attempts_status_shape
    check (case status
             when 'running'   then finished_at is null and outcome is null and error_code is null
             when 'succeeded' then finished_at is not null and outcome is not null
                                   and error_code is null and error_message is null
                                   and error_status is null
             when 'failed'    then finished_at is not null and outcome is null
                                   and error_code ~ '^[a-z][a-z0-9_]{0,62}$'
                                   and error_message is not null and btrim(error_message) <> ''
                                   and length(error_message) <= 2000
                                   and error_status between 400 and 599
           end),

  constraint decision_action_attempts_finished_after_started
    check (finished_at is null or finished_at >= started_at)
);

comment on table ouroboros.decision_action_attempts is
  'Every press of a decision card''s action (#462, BN.2, X3): who, which action, through which channel, under which idempotency key, and how it ended — running, succeeded with the handler''s receipt, or failed with the plane''s error. One attempt per (item, key), so a retry never executes twice; at most one running attempt per item (decision_action_attempts_one_running), so a second answer is refused before any plane is called. A failed attempt leaves its item open.';
comment on column ouroboros.decision_action_attempts.idempotency_key is
  'The client''s Idempotency-Key, or one the executor generated. Unique per item: a request repeated with the same key answers with the first attempt instead of pressing again.';
comment on column ouroboros.decision_action_attempts.outcome is
  'What the owning plane did — {merge_sha} or {merge: armed}, {exception_id}, {draft_batch_id}, {control_id} — present exactly when the attempt succeeded. Copied into the resolution''s outcome as the card''s receipt.';
comment on column ouroboros.decision_action_attempts.error_code is
  'The plane''s stable error code (merge_plan_not_armable, forbidden, decision_action_unbound) — present exactly when the attempt failed.';

create unique index decision_action_attempts_one_running
  on ouroboros.decision_action_attempts (item_id)
  where status = 'running';

comment on index ouroboros.decision_action_attempts_one_running is
  'First answer wins (#462): at most one attempt per item is running, so two people pressing at once cannot both reach a plane.';

create index decision_action_attempts_organization_idx
  on ouroboros.decision_action_attempts (organization_id, started_at desc);

-- A person's attempt names them when written; a finished attempt is history.
create function ouroboros.decision_action_attempts_guard() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.actor_id is null then
      raise exception 'a decision action attempt names the person who pressed it'
        using errcode = 'check_violation', constraint = 'decision_action_attempts_actor_named';
    end if;
    if new.status <> 'running' then
      raise exception 'a decision action attempt starts running'
        using errcode = 'check_violation', constraint = 'decision_action_attempts_starts_running';
    end if;
    return new;
  end if;

  if row(new.id, new.organization_id, new.item_id, new.action_id, new.channel, new.idempotency_key,
         new.started_at)
     is distinct from
     row(old.id, old.organization_id, old.item_id, old.action_id, old.channel, old.idempotency_key,
         old.started_at)
     or (new.actor_id is distinct from old.actor_id and new.actor_id is not null)
     or (old.status <> 'running'
         and row(new.status, new.outcome, new.error_code, new.error_message, new.error_status,
                 new.finished_at)
             is distinct from
             row(old.status, old.outcome, old.error_code, old.error_message, old.error_status,
                 old.finished_at)) then
    raise exception 'decision action attempt % is history: only a running attempt may finish, once', old.id
      using errcode = 'check_violation', constraint = 'decision_action_attempts_history';
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_action_attempts_guard() is
  'BEFORE INSERT OR UPDATE trigger for decision_action_attempts (#462): an attempt is written running and names its person (decision_action_attempts_actor_named, decision_action_attempts_starts_running); afterwards only a running attempt may finish, once, and nothing about what was pressed changes (decision_action_attempts_history) — the person may only be forgotten. Raises class 23 naming the rule.';

create trigger decision_action_attempts_guard
  before insert or update on ouroboros.decision_action_attempts
  for each row execute function ouroboros.decision_action_attempts_guard();

-- ---------------------------------------------------------------------------
-- The out-of-band closure waits for an answer in flight.
-- ---------------------------------------------------------------------------
create or replace function ouroboros.decision_item_source_resolve(
  p_item_id uuid,
  p_channel text,
  p_outcome jsonb default '{}'::jsonb
) returns boolean
language plpgsql
as $$
declare
  org text;
begin
  -- Locked, so a person answering at the same instant and this closure cannot both write: the
  -- second sees a resolved item and does nothing (the primary key would refuse it anyway).
  select i.organization_id into org
    from ouroboros.decision_items i
   where i.id = p_item_id and i.status in ('open', 'snoozed')
     for update;

  if org is null then
    return false;
  end if;

  -- A person's answer is running (#462): it owns the outcome. The watcher sweeps again later and
  -- finds the item answered.
  if exists (select 1 from ouroboros.decision_action_attempts a
              where a.item_id = p_item_id and a.status = 'running') then
    return false;
  end if;

  insert into ouroboros.decision_resolutions
    (item_id, organization_id, action_id, resolver, resolved_by_policy, channel, outcome)
  values
    (p_item_id, org, 'source_resolved', 'policy', 'source_resolved', p_channel,
     coalesce(p_outcome, '{}'::jsonb))
  on conflict (item_id) do nothing;

  return found;
end;
$$;

comment on function ouroboros.decision_item_source_resolve(uuid, text, jsonb) is
  'Close a decision item whose source was settled out of band (#461, X4): a PR merged or closed on its host, a run that ended, a fact reviewed elsewhere. Writes the resolution policy(source_resolved) with the reserved action, the channel the settlement came through and an outcome receipt ({"source": "pr_merged"}). True when it closed the item; false when the item was not open or snoozed (already answered, expired, or not there), or while a person''s answer to it is running (#462) — so a watcher may call it as often as it likes. Invoker''s rights.';

grant select, insert, update on ouroboros.decision_action_attempts to ouroboros_app;
