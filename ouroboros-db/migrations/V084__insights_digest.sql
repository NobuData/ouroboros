-- V084__insights_digest.sql — `insights_digest_subscriptions`, `insights_digest_schedules`,
-- `insights_digest_runs` and `insights_digest_sends`: who asked for the weekly Insights email,
-- when a workspace's goes out, and what was sent to whom (#440, BJ.4, decision I9).
--
-- Mockup 15's head has an **Email weekly digest** action. The email it leads to says what the
-- page says — it is assembled from the page's own payload (#438), so nothing here stores a
-- metric. What this migration stores is the part a payload cannot hold: consent, a schedule,
-- and a record.
--
-- ===========================================================================
-- OPT-IN IS A ROW
-- ===========================================================================
--
-- A subscription is one row per (workspace, person). There is no `enabled` column: a person is
-- subscribed because the row exists and unsubscribed because it does not, so "nobody is
-- subscribed until they ask" is the state of an empty table rather than a default somebody
-- could change. The digest is a workspace's numbers, which is why the workspace is part of the
-- key — a person in two workspaces subscribes to each on its own.
--
-- Membership is deliberately *not* a foreign key here. BetterAuth owns `member`, and a
-- subscription that outlives a membership is harmless as long as nothing sends to it; the send
-- path joins `member` every time, so a removed person stops receiving on the next run.
--
-- ===========================================================================
-- THE SCHEDULE IS A WEEKLY SLOT, IN UTC
-- ===========================================================================
--
-- One row per workspace: ISO day of week and time of day, as V080's `analysis_schedules`
-- stores them. No row means the default — Monday 09:00 UTC — which the service applies; the
-- table holds only a choice somebody made.
--
-- ===========================================================================
-- A RUN IS CLAIMED ONCE, AND SAYS WHAT IT SENT
-- ===========================================================================
--
-- `insights_digest_runs` has one row per (workspace, slot). The unique key is the claim: two
-- replicas that both find a slot due insert the same key and one of them wins. The run then
-- stores the assembled content **once** (`content`, with the window and content version it was
-- assembled for), and every send and retry of that run renders from it. That is what makes the
-- audit true: a retry an hour later cannot print different numbers from the ones the run row
-- says were sent.
--
-- ===========================================================================
-- A SEND IS CLAIMED BEFORE IT IS SENT
-- ===========================================================================
--
-- `insights_digest_sends` has one row per (run, person, attempt), inserted **before** the mail
-- leaves, in status `claimed`. The unique key is what stops two replicas mailing one person;
-- the row carries the hash of the unsubscribe token the mail will contain, so a mail that was
-- delivered a moment before a crash still has a link that works. The sender then settles the
-- row `sent` or `failed`, and that is the only change a row ever sees — apart from the person
-- foreign key's own set-null, which forgets *who* without rewriting *what* (V022's rule).
--
-- The recipient address is kept after the person is removed. This table is the answer to
-- "what was sent, to whom, for which window", and an answer that forgets the address is not
-- one. The workspace cascade still takes everything with it.

-- ---------------------------------------------------------------------------
-- insights_digest_subscriptions — opt-in, one row per (workspace, person).
-- ---------------------------------------------------------------------------
create table ouroboros.insights_digest_subscriptions (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace whose numbers the person asked for. Cascade: a deleted workspace takes its
  -- subscriptions with it.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The subscriber. Cascade: the subscription belongs to the person.
  user_id         text        not null
                              references ouroboros."user" ("id") on delete cascade,

  -- When they opted in. A run only mails people subscribed at or before its slot.
  created_at      timestamptz not null default now(),

  constraint insights_digest_subscriptions_member_key
    unique (organization_id, user_id)
);

comment on table ouroboros.insights_digest_subscriptions is
  'Who asked for the weekly Insights email (#440, decision I9) — one row per (workspace, person). The row is the consent: no row, no mail. Membership is checked at send time against BetterAuth''s member table, not here.';
comment on column ouroboros.insights_digest_subscriptions.created_at is
  'When the person opted in. A run mails only people subscribed at or before its slot, so subscribing never triggers a late copy of this week''s digest.';

-- The person foreign key's referencing side.
create index insights_digest_subscriptions_user_idx
  on ouroboros.insights_digest_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- insights_digest_schedules — a workspace's weekly slot. No row = Monday 09:00 UTC.
-- ---------------------------------------------------------------------------
create table ouroboros.insights_digest_schedules (
  -- One schedule per workspace. Cascade: a deleted workspace takes it along.
  organization_id text        primary key
                              references ouroboros.organization ("id") on delete cascade,

  -- ISO day of week, 1 = Monday … 7 = Sunday.
  weekly_day      smallint    not null default 1
                              constraint insights_digest_schedules_weekly_day_range
                                check (weekly_day between 1 and 7),

  -- Time of day in UTC, to the minute.
  weekly_time     time        not null default '09:00'
                              constraint insights_digest_schedules_weekly_time_minute
                                check (extract(second from weekly_time) = 0),

  -- Who last changed it; null after the person is removed.
  updated_by      text        references ouroboros."user" ("id") on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table ouroboros.insights_digest_schedules is
  'When a workspace''s weekly Insights email goes out (#440) — ISO day of week and UTC time of day. A workspace with no row uses the default, Monday 09:00 UTC, which the service applies.';
comment on column ouroboros.insights_digest_schedules.weekly_day is
  'ISO day of week, 1 = Monday … 7 = Sunday.';
comment on column ouroboros.insights_digest_schedules.weekly_time is
  'Time of day in UTC, whole minutes.';
comment on column ouroboros.insights_digest_schedules.updated_by is
  'The person who last saved the schedule; null once they are removed.';

create trigger insights_digest_schedules_touch_updated_at
  before update on ouroboros.insights_digest_schedules
  for each row execute function ouroboros.touch_updated_at();

-- The updated_by foreign key's referencing side.
create index insights_digest_schedules_updated_by_idx
  on ouroboros.insights_digest_schedules (updated_by) where updated_by is not null;

-- ---------------------------------------------------------------------------
-- insights_digest_runs — one row per (workspace, slot); the content it sent, stored once.
-- ---------------------------------------------------------------------------
create table ouroboros.insights_digest_runs (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The scheduled instant this run is for. With the workspace, the claim.
  slot_at         timestamptz not null,

  -- What was assembled: the page's own window, the content version, and the assembly itself.
  -- All four are null until the run assembles, and are set together, once.
  window_from     date,
  window_to       date,
  content_version integer
                  constraint insights_digest_runs_content_version_positive
                    check (content_version >= 1),
  content         jsonb
                  constraint insights_digest_runs_content_object
                    check (jsonb_typeof(content) = 'object'),

  started_at      timestamptz not null default now(),

  -- Set when nobody is left to mail or retry.
  completed_at    timestamptz,

  constraint insights_digest_runs_slot_key
    unique (organization_id, slot_at),

  -- The composite key a send's foreign key names, so a send's run is its workspace's.
  constraint insights_digest_runs_scope_key
    unique (id, organization_id),

  constraint insights_digest_runs_assembled_together
    check ((content is null) = (window_from is null)
       and (content is null) = (window_to is null)
       and (content is null) = (content_version is null)),

  constraint insights_digest_runs_window_ordered
    check (window_from <= window_to),

  -- A run that never assembled sent nothing, so it has nothing to be complete about.
  constraint insights_digest_runs_complete_has_content
    check (completed_at is null or content is not null)
);

comment on table ouroboros.insights_digest_runs is
  'One weekly Insights email run per (workspace, slot) (#440). The unique key is the claim across replicas; content is the assembly every send of the run renders from, stored once with its window and content version, so the audit names exactly what was sent.';
comment on column ouroboros.insights_digest_runs.slot_at is
  'The scheduled instant the run is for.';
comment on column ouroboros.insights_digest_runs.window_from is
  'First UTC day of the window the content covers — the Insights page''s own 7-day window.';
comment on column ouroboros.insights_digest_runs.window_to is
  'Last UTC day of the window; partial when the slot is before the day ends.';
comment on column ouroboros.insights_digest_runs.content_version is
  'The digest content version the assembly was built under. It moves when the assembly''s shape or wording rules change.';
comment on column ouroboros.insights_digest_runs.content is
  'The assembled digest: what every mail of this run prints. Set once; never revised.';
comment on column ouroboros.insights_digest_runs.completed_at is
  'When the run had nobody left to mail or retry. Null while it is open.';

-- Holds a run to its record: its identity never moves, its content is set once, and it
-- completes once.
create function ouroboros.insights_digest_runs_guard()
returns trigger language plpgsql as $$
begin
  if row(new.id, new.organization_id, new.slot_at, new.started_at)
     is distinct from row(old.id, old.organization_id, old.slot_at, old.started_at) then
    raise exception 'digest run % cannot change which workspace or slot it is for', old.id
      using errcode = 'check_violation', constraint = 'insights_digest_runs_guard';
  end if;

  if old.content is not null
     and row(new.content, new.window_from, new.window_to, new.content_version)
         is distinct from row(old.content, old.window_from, old.window_to, old.content_version) then
    raise exception 'digest run % already assembled its content; it cannot be revised', old.id
      using errcode = 'check_violation', constraint = 'insights_digest_runs_guard';
  end if;

  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'digest run % already completed', old.id
      using errcode = 'check_violation', constraint = 'insights_digest_runs_guard';
  end if;

  return new;
end;
$$;

comment on function ouroboros.insights_digest_runs_guard() is
  'Refuses to move a digest run''s workspace, slot or start, to revise content once assembled, or to change a completion (#440). Raises 23514 naming insights_digest_runs_guard.';

create trigger insights_digest_runs_guard
  before update on ouroboros.insights_digest_runs
  for each row execute function ouroboros.insights_digest_runs_guard();

-- ---------------------------------------------------------------------------
-- insights_digest_sends — one row per (run, person, attempt): claimed, then sent or failed.
-- ---------------------------------------------------------------------------
create table ouroboros.insights_digest_sends (
  id                     uuid        primary key default gen_random_uuid(),

  organization_id        text        not null
                                     references ouroboros.organization ("id") on delete cascade,

  -- The run, held to this row's workspace by the composite key below.
  run_id                 uuid        not null,

  -- The recipient as a person. Set null when they are removed; the address below stays.
  user_id                text        references ouroboros."user" ("id") on delete set null,

  -- The address the mail was sent to, as it was at the time.
  recipient              text        not null
                                     constraint insights_digest_sends_recipient_present
                                       check (btrim(recipient) <> '' and length(recipient) <= 320),

  -- 1 for the first try; a retry of a failed send is the next number.
  attempt                smallint    not null
                                     constraint insights_digest_sends_attempt_positive
                                       check (attempt >= 1),

  status                 text        not null default 'claimed'
                                     constraint insights_digest_sends_status_known
                                       check (status in ('claimed', 'sent', 'failed')),

  -- The Message-ID header: the same for every attempt at one (run, person), so a receiver can
  -- collapse a duplicate.
  message_id             text        not null
                                     constraint insights_digest_sends_message_id_present
                                       check (btrim(message_id) <> ''),

  -- SHA-256 of the unsubscribe token this attempt's mail carries. The token itself is never
  -- stored.
  unsubscribe_token_hash text        not null
                                     constraint insights_digest_sends_token_hash_shape
                                       check (unsubscribe_token_hash ~ '^[0-9a-f]{64}$'),

  -- Why a failed attempt failed.
  error                  text,

  claimed_at             timestamptz not null default now(),
  settled_at             timestamptz,

  constraint insights_digest_sends_run_fkey
    foreign key (run_id, organization_id)
    references ouroboros.insights_digest_runs (id, organization_id) on delete cascade,

  -- The claim: one row per attempt at one person in one run.
  constraint insights_digest_sends_attempt_key
    unique (run_id, user_id, attempt),

  constraint insights_digest_sends_token_key
    unique (unsubscribe_token_hash),

  constraint insights_digest_sends_settled_stamped
    check ((status = 'claimed') = (settled_at is null)),

  constraint insights_digest_sends_error_on_failure
    check ((status = 'failed') = (error is not null))
);

comment on table ouroboros.insights_digest_sends is
  'The weekly Insights email''s send audit (#440): one row per (run, person, attempt), inserted as claimed before the mail leaves and settled sent or failed. Window and content version are the run''s. The recipient address outlives the person; the workspace cascade removes everything.';
comment on column ouroboros.insights_digest_sends.user_id is
  'The recipient. Set null when the person is removed — the address stays as the record of where the mail went.';
comment on column ouroboros.insights_digest_sends.recipient is
  'The address the mail was sent to.';
comment on column ouroboros.insights_digest_sends.attempt is
  '1 for the first try; each retry of a failed attempt is the next number.';
comment on column ouroboros.insights_digest_sends.status is
  'claimed | sent | failed. A row is inserted claimed and settled exactly once.';
comment on column ouroboros.insights_digest_sends.message_id is
  'The Message-ID header, identical across attempts at one (run, person).';
comment on column ouroboros.insights_digest_sends.unsubscribe_token_hash is
  'SHA-256 (hex) of the unsubscribe token in this attempt''s mail. Stored before sending, so a delivered mail always has a working link.';
comment on column ouroboros.insights_digest_sends.error is
  'Why the attempt failed. Present exactly when status is failed.';

-- The person foreign key's referencing side.
create index insights_digest_sends_user_idx
  on ouroboros.insights_digest_sends (user_id) where user_id is not null;

-- Holds a send to its record. Two updates are allowed: settling a claim, and the person
-- foreign key's own set-null (an UPDATE — see V022).
create function ouroboros.insights_digest_sends_guard()
returns trigger language plpgsql as $$
begin
  -- Forgetting who, with nothing else touched.
  if new.user_id is null and old.user_id is not null
     and row(new.id, new.organization_id, new.run_id, new.recipient, new.attempt, new.status,
             new.message_id, new.unsubscribe_token_hash, new.error, new.claimed_at, new.settled_at)
         is not distinct from
         row(old.id, old.organization_id, old.run_id, old.recipient, old.attempt, old.status,
             old.message_id, old.unsubscribe_token_hash, old.error, old.claimed_at, old.settled_at)
  then
    return new;
  end if;

  -- Settling a claim, with the claim itself untouched.
  if old.status = 'claimed' and new.status in ('sent', 'failed')
     and row(new.id, new.organization_id, new.run_id, new.user_id, new.recipient, new.attempt,
             new.message_id, new.unsubscribe_token_hash, new.claimed_at)
         is not distinct from
         row(old.id, old.organization_id, old.run_id, old.user_id, old.recipient, old.attempt,
             old.message_id, old.unsubscribe_token_hash, old.claimed_at)
  then
    return new;
  end if;

  raise exception 'digest send % is a record: it may only be settled once', old.id
    using errcode = 'check_violation', constraint = 'insights_digest_sends_guard';
end;
$$;

comment on function ouroboros.insights_digest_sends_guard() is
  'Refuses every UPDATE of a digest send except settling a claimed row as sent or failed, and the person foreign key''s own set-null (#440). Raises 23514 naming insights_digest_sends_guard.';

create trigger insights_digest_sends_guard
  before update on ouroboros.insights_digest_sends
  for each row execute function ouroboros.insights_digest_sends_guard();

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
-- A subscription is created and removed, never edited.
grant select, insert, delete on ouroboros.insights_digest_subscriptions to ouroboros_app;
grant select, insert, update on ouroboros.insights_digest_schedules to ouroboros_app;
-- Runs and sends are records: written, settled, never deleted by the service.
grant select, insert, update on ouroboros.insights_digest_runs to ouroboros_app;
grant select, insert, update on ouroboros.insights_digest_sends to ouroboros_app;
