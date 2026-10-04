-- V095__decision_resolutions_snooze_metrics.sql — resolution truth, snooze mechanics and the
-- weekly decision metrics (#458, BM.2, decisions X4 and X6).
--
-- Three of mockup 16's claims are numbers — *This week · 11 decisions · median answer time 41s ·
-- loops never waited longer than 6m* — and the resolved list says who answered what, how, and
-- that the re-size estimate was *auto-accepted by policy*. This migration is the rows they are
-- computed from:
--
--   1. **`run_blocks`** — the interval a run sat waiting on a decision item. Nothing recorded it
--      before: `runs.needs_human` is a terminal status, `run_stages` has no blocked status, and a
--      `run_controls` pause is a person's pause, not a wait on a question. One row per (item,
--      run): `blocked_at`, and `unblocked_at` once the run moves again. The run must be one the
--      item's refs name, so the wait is "joined from the run the item is about" and nothing else.
--      The run plane (BN.2's executor, AP.4's resume) writes these rows.
--   2. **`decision_resolutions`** — one per item (X4): which declared action ran, the resolver
--      class (`human` with the person, or `policy` with the policy's name), the channel it was
--      answered through, the note, what the handler did (`outcome`, the receipt), when, and two
--      **distinct spans**:
--
--        answer_latency  item.created_at → resolved_at. How long the question went unanswered.
--        loop_wait       run_blocks.blocked_at → the earlier of unblocked_at and resolved_at,
--                        the longest such span over the item's blocks. How long the loop was
--                        stuck. **Null when no run was blocked** — never zero.
--
--      A decision emitted at 09:11:34 and answered at 09:12:15 has a 41-second answer latency; if
--      its run only started waiting at 09:11:52 the loop waited 23 seconds. Both are stored so the
--      stat card's median and maximum are each over the span they claim.
--   3. **Snooze** (X6) — `snoozed_until`, `snoozed_by`, `snooze_reason` on `decision_items`, and
--      `decision_snooze_events`, the audit trail: one row per snooze, scope `item` or `all`, so
--      *Snooze all 1h* is one event that names the items it snoozed. Snooze changes **visibility,
--      never age**: `created_at` is already frozen by V093's `decision_items_pinned`, so an item
--      woken by `decision_items_wake` is as old as it ever was, and its answer latency counts the
--      snooze. The pill counts `open`, so it excludes snoozed items; the metrics count resolutions,
--      so they do not.
--   4. **`decision_metrics_weekly`** and **`decision_metrics_weekly_by_kind`** — per workspace and
--      UTC ISO week (Monday): decisions resolved, median answer latency, maximum loop wait,
--      auto-accept share, and per-kind medians (what BO.1's *~90 seconds* head estimate is
--      computed from). Registered in BI.1's methodology registry (#432, amendment) as family
--      `decisions`.
--
-- ---------------------------------------------------------------------------
-- The resolution rules
-- ---------------------------------------------------------------------------
--
--   - Exactly one resolver is named for its class (`decision_resolutions_resolver_class`): a
--     policy resolution names its policy and no person; a human one names no policy. A human
--     resolution must name its person when it is written (`decision_resolutions_human_named`) —
--     after that the person may be deleted and the column goes null (V048's posture: *who*
--     answered can be forgotten, *that a human answered* cannot).
--   - The action is one the pinned kind's `resolution_semantics.answered_by` lists, and it carries
--     a note exactly when the action takes one (`decision_resolutions_action_answers`).
--   - A policy may answer only an `auto_resolvable` kind (`decision_resolutions_policy_may_answer`)
--     — V093's guarantee that no policy turns a merge-class decision into an automatic one, held
--     at the row that would do it.
--   - Only an open or snoozed item can be resolved (`decision_resolutions_item_open`), at most
--     once (the primary key on `item_id` — BN.2's "first answer wins"), and resolving it marks it
--     `resolved` (`decision_resolutions_close_item`). Conversely an item is `resolved` exactly
--     when it has a resolution (`decision_items_resolution_agrees`, checked at commit) — a silent
--     resolution is how an autonomous system loses its owner's trust.
--   - The spans are computed, never written: `decision_resolutions_spans` sets both on insert,
--     and `run_blocks_refresh_loop_wait` recomputes `loop_wait` when a block is recorded or
--     closed after the answer. Otherwise a resolution is immutable
--     (`decision_resolutions_immutable`).
--
-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------
--
-- Flyway's community edition has no undo migrations, so this repository reverts forward. The
-- complete inverse:
--
--   delete from ouroboros.metric_definitions where family = 'decisions';
--   drop view ouroboros.decision_metrics_weekly;
--   drop view ouroboros.decision_metrics_weekly_by_kind;
--   drop function ouroboros.decision_items_wake(text, timestamptz);
--   drop function ouroboros.decision_items_snooze_all(text, timestamptz, text, text);
--   drop function ouroboros.decision_item_snooze(uuid, timestamptz, text, text);
--   drop table ouroboros.decision_snooze_events;
--   drop trigger decision_items_resolution_agrees on ouroboros.decision_items;
--   drop function ouroboros.decision_items_resolution_agrees();
--   drop table ouroboros.decision_resolutions;
--   drop function ouroboros.decision_resolutions_close_item();
--   drop function ouroboros.decision_resolutions_refuse_change();
--   drop function ouroboros.decision_resolutions_spans();
--   drop function ouroboros.decision_resolutions_human_named();
--   drop function ouroboros.decision_resolutions_policy_may_answer();
--   drop function ouroboros.decision_resolutions_action_answers();
--   drop function ouroboros.decision_resolutions_item_open();
--   drop table ouroboros.run_blocks;
--   drop function ouroboros.run_blocks_refresh_loop_wait();
--   drop function ouroboros.run_blocks_close_once();
--   drop function ouroboros.run_blocks_item_names_run();
--   drop function ouroboros.decision_loop_wait(uuid, timestamptz);
--   drop index ouroboros.decision_items_snoozed_idx;
--   alter table ouroboros.decision_items drop constraint decision_items_snooze_complete,
--     drop constraint decision_items_id_organization_key,
--     drop column snooze_reason, drop column snoozed_by, drop column snoozed_until;

-- ---------------------------------------------------------------------------
-- 1. Snooze columns on decision_items, and the composite key the new tables name.
-- ---------------------------------------------------------------------------

-- V093 had no snooze mechanics, so a `snoozed` item could only have been written by hand; it has
-- no expiry to wake at, so it is put back in the queue rather than invented one.
update ouroboros.decision_items set status = 'open' where status = 'snoozed';

alter table ouroboros.decision_items
  add column snoozed_until timestamptz,
  add column snoozed_by    text references ouroboros."user" ("id") on delete set null,
  add column snooze_reason text,

  -- A snoozed item says until when; every other item carries no snooze at all.
  add constraint decision_items_snooze_complete
    check ((status = 'snoozed') = (snoozed_until is not null)
           and (status = 'snoozed' or (snoozed_by is null and snooze_reason is null))
           and (snooze_reason is null
                or (btrim(snooze_reason) <> '' and length(snooze_reason) <= 500))),

  -- What run_blocks, decision_resolutions and decision_snooze_events reference, so a row of
  -- theirs can only name an item of its own workspace.
  add constraint decision_items_id_organization_key unique (id, organization_id);

comment on column ouroboros.decision_items.status is
  'open|snoozed|resolved|expired. The pill counts open, so it excludes snoozed items (X6). resolved exactly when the item has a decision_resolutions row (decision_items_resolution_agrees); snoozed exactly when snoozed_until is set.';
comment on column ouroboros.decision_items.snoozed_until is
  'When a snoozed item re-surfaces (decision_items_wake). Set exactly while status is snoozed. Snooze hides an item; it never touches created_at, so the age keeps counting (X6).';
comment on column ouroboros.decision_items.snoozed_by is
  'Who snoozed the item, while it is snoozed. Set null if the person is removed. The audit trail is decision_snooze_events.';
comment on column ouroboros.decision_items.snooze_reason is
  'Why it was snoozed, optional, while it is snoozed.';

-- The wake sweep and the snoozed count: snoozed items only, by when they wake.
create index decision_items_snoozed_idx
  on ouroboros.decision_items (organization_id, snoozed_until)
  where status = 'snoozed';

-- ---------------------------------------------------------------------------
-- 2. run_blocks — how long a run sat waiting on a decision.
-- ---------------------------------------------------------------------------
create table ouroboros.run_blocks (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The question the run is waiting on, and the run. Both in this workspace (composite keys).
  decision_item_id uuid        not null,
  run_id           uuid        not null,

  -- When the run stopped to wait, and when it moved again — null while it is still waiting.
  blocked_at       timestamptz not null,
  unblocked_at     timestamptz,

  created_at       timestamptz not null default now(),

  constraint run_blocks_item_fk
    foreign key (decision_item_id, organization_id)
    references ouroboros.decision_items (id, organization_id) on delete cascade,

  constraint run_blocks_run_fk
    foreign key (run_id, organization_id)
    references ouroboros.runs (id, organization_id) on delete cascade,

  -- One wait per (item, run); the item-first order is the loop-wait lookup's index.
  constraint run_blocks_item_run_key unique (decision_item_id, run_id),

  -- A wait has a length: a block that ended when it began did not happen.
  constraint run_blocks_unblocked_after_blocked
    check (unblocked_at is null or unblocked_at > blocked_at)
);

comment on table ouroboros.run_blocks is
  'The interval a run sat blocked on a decision item (#458, BM.2): blocked_at, and unblocked_at once it moved again. The run must be one the item''s refs name (run_blocks_item_names_run). decision_resolutions.loop_wait is computed from these rows — the honest measure of how long a loop was stuck, distinct from how long the question went unanswered. Written by the run plane (BN.2, AP.4).';
comment on column ouroboros.run_blocks.blocked_at is
  'When the run stopped to wait on the item. Fixed once written. May precede the item''s created_at — a run can stop before its plane files the question.';
comment on column ouroboros.run_blocks.unblocked_at is
  'When the run moved again; null while it is still waiting. Set once (run_blocks_close_once). A wait ends at the earlier of this and the item''s resolution.';

create index run_blocks_run_idx on ouroboros.run_blocks (run_id);

-- The longest wait over an item's blocks, ending at the earlier of the block's close and the
-- answer. Only blocks that began before the answer count, so every span is positive and an item
-- no run waited on has none: null, never zero.
create function ouroboros.decision_loop_wait(p_item_id uuid, p_resolved_at timestamptz)
returns interval
language sql stable strict parallel safe
as $$
  select max(least(coalesce(b.unblocked_at, p_resolved_at), p_resolved_at) - b.blocked_at)
    from ouroboros.run_blocks b
   where b.decision_item_id = p_item_id
     and b.blocked_at < p_resolved_at
$$;

comment on function ouroboros.decision_loop_wait(uuid, timestamptz) is
  'How long a loop waited on a decision answered at the given instant (#458): over the item''s run_blocks that began before the answer, the longest span from blocked_at to the earlier of unblocked_at and the answer. Null when no run was blocked on it — never zero.';

create function ouroboros.run_blocks_item_names_run() returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from ouroboros.decision_items i
                  where i.id = new.decision_item_id
                    and i.refs @> jsonb_build_array(jsonb_build_object('type', 'run',
                                                                       'id', new.run_id::text))) then
    raise exception 'run % is not one decision item % is about, so it cannot be blocked on it',
      new.run_id, new.decision_item_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.run_blocks_item_names_run() is
  'BEFORE INSERT OR UPDATE trigger for run_blocks (#458): the blocked run is one of the item''s run refs — loop_wait is joined from the run the item is about, and from no other. Raises class 23 naming the trigger.';

create trigger run_blocks_item_names_run
  before insert or update of decision_item_id, run_id on ouroboros.run_blocks
  for each row execute function ouroboros.run_blocks_item_names_run();

create function ouroboros.run_blocks_close_once() returns trigger
language plpgsql
as $$
begin
  if row(new.organization_id, new.decision_item_id, new.run_id, new.blocked_at, new.created_at)
     is distinct from
     row(old.organization_id, old.decision_item_id, old.run_id, old.blocked_at, old.created_at)
     or (old.unblocked_at is not null and new.unblocked_at is distinct from old.unblocked_at) then
    raise exception 'run block % is history: only its unblocked_at may be set, once', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.run_blocks_close_once() is
  'BEFORE UPDATE trigger for run_blocks (#458): a block''s item, run and blocked_at never change, and unblocked_at goes from null to a time once — so a wait cannot be shortened after it is measured. Raises class 23 naming the trigger.';

create trigger run_blocks_close_once
  before update on ouroboros.run_blocks
  for each row execute function ouroboros.run_blocks_close_once();

-- ---------------------------------------------------------------------------
-- 3. decision_resolutions — who answered, how, through which channel, and how fast.
-- ---------------------------------------------------------------------------
create table ouroboros.decision_resolutions (
  -- One resolution per item: the second answer is refused here (BN.2's 409).
  item_id            uuid        primary key,

  organization_id    text        not null
                                 references ouroboros.organization ("id") on delete cascade,

  -- Which declared action executed — one of the pinned kind's answered_by
  -- (decision_resolutions_action_answers).
  action_id          text        not null,

  -- human or policy; and exactly the matching one of the two names below.
  resolver           text        not null
                                 constraint decision_resolutions_resolver
                                   check (resolver in ('human', 'policy')),
  resolved_by_user   text        references ouroboros."user" ("id") on delete set null,
  resolved_by_policy text
                     constraint decision_resolutions_policy_ref_format
                       check (resolved_by_policy ~ '^[a-z][a-z0-9_]{0,62}$'
                              or resolved_by_policy ~ '^custom:[a-z0-9][a-z0-9_-]{0,62}$'),

  -- Where the answer came from. When BP.5's escalations arrive, this is what says whether one
  -- worked; it cannot be back-filled.
  channel            text        not null
                                 constraint decision_resolutions_channel
                                   check (channel in ('web', 'email', 'github', 'slack', 'push', 'api')),

  -- The return-to-loop note, the waiver rationale — exactly when the action takes a note.
  note               text
                     constraint decision_resolutions_note_bounded
                       check (btrim(note) <> '' and length(note) <= 2000),

  -- What the handler did, for the receipt: merge SHA, exception id, planning draft ref.
  outcome            jsonb       not null default '{}'::jsonb
                                 constraint decision_resolutions_outcome_object
                                   check (jsonb_typeof(outcome) = 'object'),

  resolved_at        timestamptz not null default now(),

  -- Computed by decision_resolutions_spans; any value written is replaced.
  answer_latency     interval    not null
                                 constraint decision_resolutions_answer_latency_nonnegative
                                   check (answer_latency >= interval '0'),
  loop_wait          interval
                     constraint decision_resolutions_loop_wait_positive
                       check (loop_wait > interval '0'),

  created_at         timestamptz not null default now(),

  constraint decision_resolutions_item_fk
    foreign key (item_id, organization_id)
    references ouroboros.decision_items (id, organization_id) on delete cascade,

  -- A policy resolution names its policy and nobody; a human one names no policy.
  constraint decision_resolutions_resolver_class
    check (case resolver
             when 'policy' then resolved_by_policy is not null and resolved_by_user is null
             when 'human'  then resolved_by_policy is null
           end)
);

comment on table ouroboros.decision_resolutions is
  'How each decision item was answered (#458, BM.2, decision X4): the action, the resolver class — human with the person, or policy with the policy''s name (auto-accepted by policy is a resolution, never a missing row) — the channel, the note, the handler''s outcome, and two distinct computed spans: answer_latency (item created → resolved) and loop_wait (how long its run sat blocked; null when none was). One per item; immutable but for the two derived exceptions in decision_resolutions_refuse_change.';
comment on column ouroboros.decision_resolutions.action_id is
  'The declared action that executed — one of the pinned kind''s resolution_semantics.answered_by.';
comment on column ouroboros.decision_resolutions.resolver is
  'human | policy. A policy resolution names resolved_by_policy and may only answer an auto_resolvable kind.';
comment on column ouroboros.decision_resolutions.resolved_by_user is
  'The person who answered. Required when a human resolution is written; set null if the person is later removed.';
comment on column ouroboros.decision_resolutions.resolved_by_policy is
  'The policy that answered — auto_accept_resize, or a custom:<slug> — set exactly for resolver policy. Rendered as "auto-accepted by policy".';
comment on column ouroboros.decision_resolutions.channel is
  'web | email | github | slack | push | api — where the answer came from.';
comment on column ouroboros.decision_resolutions.note is
  'The return-to-loop note or waiver rationale. Present exactly when the action takes_note.';
comment on column ouroboros.decision_resolutions.outcome is
  'What the handler actually did, for the receipt — {merge_sha}, {exception_id}, {draft_ref}. An object; {} when there is nothing to show.';
comment on column ouroboros.decision_resolutions.answer_latency is
  'resolved_at − the item''s created_at, computed. Includes any time the item spent snoozed (X6). The stat card''s median answer time is over this.';
comment on column ouroboros.decision_resolutions.loop_wait is
  'The longest run_blocks span over the item, ending at the earlier of unblocked_at and resolved_at (decision_loop_wait), computed and refreshed when a block is recorded late. Null when no run was blocked — never zero. The stat card''s "loops never waited longer than" is the maximum of this.';

-- The resolved-today list and the weekly views: a workspace's resolutions by time.
create index decision_resolutions_organization_resolved_idx
  on ouroboros.decision_resolutions (organization_id, resolved_at desc);

-- --- the write-time rules, one trigger each so each can be named and probed ---------------
create function ouroboros.decision_resolutions_item_open() returns trigger
language plpgsql
as $$
declare
  current_status text;
begin
  select i.status into current_status from ouroboros.decision_items i where i.id = new.item_id;

  -- No item at all is the foreign key's complaint, not this one's.
  if current_status is not null and current_status not in ('open', 'snoozed') then
    raise exception 'decision item % is %, so it cannot be answered', new.item_id, current_status
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_resolutions_item_open() is
  'BEFORE INSERT trigger for decision_resolutions (#458): only an open or snoozed item is answered — an expired one is not, and a resolved one already has its resolution. Raises class 23 naming the trigger.';

create trigger decision_resolutions_item_open
  before insert on ouroboros.decision_resolutions
  for each row execute function ouroboros.decision_resolutions_item_open();

create function ouroboros.decision_resolutions_action_answers() returns trigger
language plpgsql
as $$
declare
  semantics jsonb;
  actions   jsonb;
  takes     boolean;
begin
  select k.resolution_semantics, k.actions into semantics, actions
    from ouroboros.decision_items i
    join ouroboros.decision_kinds k on k.kind_id = i.kind_id and k.version = i.kind_version
   where i.id = new.item_id;

  if semantics is null then
    return new;
  end if;

  if not (semantics -> 'answered_by') ? new.action_id then
    raise exception 'action % does not answer this item (answered by %)',
      new.action_id, semantics -> 'answered_by'
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  select (a ->> 'takes_note')::boolean into takes
    from jsonb_array_elements(actions) a
   where a ->> 'id' = new.action_id;

  if takes and new.note is null then
    raise exception 'action % takes a note, and this resolution has none', new.action_id
      using errcode = 'check_violation', constraint = tg_name;
  elsif not takes and new.note is not null then
    raise exception 'action % takes no note, and this resolution carries one', new.action_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.decision_resolutions_action_answers() is
  'BEFORE INSERT trigger for decision_resolutions (#458): the action is one the item''s pinned kind lists in resolution_semantics.answered_by — never a link, never another kind''s — and the resolution carries a note exactly when that action takes one. Raises class 23 naming the trigger.';

create trigger decision_resolutions_action_answers
  before insert on ouroboros.decision_resolutions
  for each row execute function ouroboros.decision_resolutions_action_answers();

create function ouroboros.decision_resolutions_policy_may_answer() returns trigger
language plpgsql
as $$
declare
  kind      text;
  automatic boolean;
begin
  if new.resolver is distinct from 'policy' then
    return new;
  end if;

  select i.kind_id, (k.resolution_semantics ->> 'auto_resolvable')::boolean into kind, automatic
    from ouroboros.decision_items i
    join ouroboros.decision_kinds k on k.kind_id = i.kind_id and k.version = i.kind_version
   where i.id = new.item_id;

  if automatic is false then
    raise exception 'decision kind % is not auto-resolvable, so policy % cannot answer it',
      kind, new.resolved_by_policy
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_resolutions_policy_may_answer() is
  'BEFORE INSERT trigger for decision_resolutions (#458): a policy resolution is refused unless the item''s pinned kind is auto_resolvable — V093''s guarantee that no policy turns a human (or merge-class) decision into an automatic one, held where it would happen. Raises class 23 naming the trigger.';

create trigger decision_resolutions_policy_may_answer
  before insert on ouroboros.decision_resolutions
  for each row execute function ouroboros.decision_resolutions_policy_may_answer();

create function ouroboros.decision_resolutions_human_named() returns trigger
language plpgsql
as $$
begin
  if new.resolver = 'human' and new.resolved_by_user is null then
    raise exception 'a human resolution names the person who answered'
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_resolutions_human_named() is
  'BEFORE INSERT trigger for decision_resolutions (#458): a human resolution names its person when it is written. A trigger rather than part of decision_resolutions_resolver_class so the person can later be deleted (the column goes null) without the history refusing it. Raises class 23 naming the trigger.';

create trigger decision_resolutions_human_named
  before insert on ouroboros.decision_resolutions
  for each row execute function ouroboros.decision_resolutions_human_named();

create function ouroboros.decision_resolutions_spans() returns trigger
language plpgsql
as $$
begin
  select new.resolved_at - i.created_at into new.answer_latency
    from ouroboros.decision_items i where i.id = new.item_id;

  new.loop_wait := ouroboros.decision_loop_wait(new.item_id, new.resolved_at);
  return new;
end;
$$;

comment on function ouroboros.decision_resolutions_spans() is
  'BEFORE INSERT trigger for decision_resolutions (#458): computes answer_latency (resolved_at − the item''s created_at) and loop_wait (decision_loop_wait), replacing anything written — the stat card''s spans are computed, never reported.';

-- Named to run after the rules above (triggers fire in name order) — and it does not matter
-- if they did not: it only computes.
create trigger decision_resolutions_spans
  before insert on ouroboros.decision_resolutions
  for each row execute function ouroboros.decision_resolutions_spans();

create function ouroboros.decision_resolutions_refuse_change() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    -- The item's (or the workspace's) cascade is the one delete that reaches a resolution.
    if exists (select 1 from ouroboros.decision_items i where i.id = old.item_id) then
      raise exception 'decision resolution of item % is history and cannot be deleted', old.item_id
        using errcode = 'restrict_violation', constraint = tg_name;
    end if;
    return old;
  end if;

  if row(new.item_id, new.organization_id, new.action_id, new.resolver, new.resolved_by_policy,
         new.channel, new.note, new.outcome, new.resolved_at, new.answer_latency, new.created_at)
     is distinct from
     row(old.item_id, old.organization_id, old.action_id, old.resolver, old.resolved_by_policy,
         old.channel, old.note, old.outcome, old.resolved_at, old.answer_latency, old.created_at)
     -- The person can be forgotten (the foreign key's set null), never replaced.
     or (new.resolved_by_user is distinct from old.resolved_by_user and new.resolved_by_user is not null)
     -- The wait follows its blocks, and nothing else.
     or (new.loop_wait is distinct from old.loop_wait
         and new.loop_wait is distinct from ouroboros.decision_loop_wait(new.item_id, new.resolved_at)) then
    raise exception 'decision resolution of item % is history: what was answered, by whom, how and when cannot be rewritten',
      old.item_id
      using errcode = 'restrict_violation', constraint = tg_name,
            hint = 'See V095__decision_resolutions_snooze_metrics.sql (#458).';
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_resolutions_refuse_change() is
  'BEFORE UPDATE OR DELETE trigger for decision_resolutions (#458): a resolution is history. Two changes pass — resolved_by_user going null (the person was deleted) and loop_wait moving to what decision_loop_wait computes now (a block recorded after the answer) — and a delete passes only as its item''s cascade. Raises class 23 naming the trigger.';

create trigger decision_resolutions_immutable
  before update or delete on ouroboros.decision_resolutions
  for each row execute function ouroboros.decision_resolutions_refuse_change();

create function ouroboros.decision_resolutions_close_item() returns trigger
language plpgsql
as $$
begin
  update ouroboros.decision_items
     set status = 'resolved', snoozed_until = null, snoozed_by = null, snooze_reason = null
   where id = new.item_id;
  return null;
end;
$$;

comment on function ouroboros.decision_resolutions_close_item() is
  'AFTER INSERT trigger for decision_resolutions (#458): answering an item marks it resolved and drops any snooze — the pill and the queue follow the resolution, never a separate write.';

create trigger decision_resolutions_close_item
  after insert on ouroboros.decision_resolutions
  for each row execute function ouroboros.decision_resolutions_close_item();

-- --- loop_wait follows blocks recorded or closed after the answer -------------------------
create function ouroboros.run_blocks_refresh_loop_wait() returns trigger
language plpgsql
as $$
begin
  update ouroboros.decision_resolutions r
     set loop_wait = ouroboros.decision_loop_wait(r.item_id, r.resolved_at)
   where r.item_id = new.decision_item_id
     and r.loop_wait is distinct from ouroboros.decision_loop_wait(r.item_id, r.resolved_at);
  return null;
end;
$$;

comment on function ouroboros.run_blocks_refresh_loop_wait() is
  'AFTER INSERT OR UPDATE trigger for run_blocks (#458): when a block is written after its item was answered, the resolution''s loop_wait is recomputed, so the run plane''s write order cannot leave a stale wait.';

create trigger run_blocks_refresh_loop_wait
  after insert or update on ouroboros.run_blocks
  for each row execute function ouroboros.run_blocks_refresh_loop_wait();

-- --- an item is resolved exactly when it has a resolution -----------------------------------
create function ouroboros.decision_items_resolution_agrees() returns trigger
language plpgsql
as $$
declare
  current_status text;
  answered       boolean;
begin
  -- Checked at commit, so read the row as it is then, not as this event saw it.
  select i.status into current_status from ouroboros.decision_items i where i.id = new.id;
  if current_status is null then
    return null;
  end if;

  answered := exists (select 1 from ouroboros.decision_resolutions r where r.item_id = new.id);

  if (current_status = 'resolved') <> answered then
    raise exception 'decision item % is % but %', new.id, current_status,
      case when answered then 'has a resolution' else 'has no resolution' end
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'Resolve an item by inserting its decision_resolutions row (#458).';
  end if;
  return null;
end;
$$;

comment on function ouroboros.decision_items_resolution_agrees() is
  'Deferred constraint trigger for decision_items (#458, X4): at commit, an item is resolved exactly when it has a decision_resolutions row — no silent resolution, and no answered item put back in the queue. Raises class 23 naming the trigger.';

create constraint trigger decision_items_resolution_agrees
  after insert or update of status on ouroboros.decision_items
  deferrable initially deferred
  for each row execute function ouroboros.decision_items_resolution_agrees();

-- ---------------------------------------------------------------------------
-- 4. Snooze: the audit trail and the three operations.
-- ---------------------------------------------------------------------------
create table ouroboros.decision_snooze_events (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- One item, or every open item of the workspace (Snooze all 1h).
  scope           text        not null
                              constraint decision_snooze_events_scope
                                check (scope in ('item', 'all')),
  item_id         uuid,

  -- The items this event snoozed, so an `all` is reconstructable as one event. An audit line:
  -- no foreign key, so it outlives nothing it should not (the workspace's cascade is the delete).
  items           uuid[]      not null,

  actor           text        references ouroboros."user" ("id") on delete set null,
  "until"         timestamptz not null,
  reason          text
                  constraint decision_snooze_events_reason_bounded
                    check (btrim(reason) <> '' and length(reason) <= 500),

  created_at      timestamptz not null default now(),

  constraint decision_snooze_events_item_fk
    foreign key (item_id, organization_id)
    references ouroboros.decision_items (id, organization_id) on delete cascade,

  -- An item event names its one item; an all event names none and lists what it caught.
  constraint decision_snooze_events_scope_shape
    check (case scope
             when 'item' then item_id is not null and items = array[item_id]
             when 'all'  then item_id is null and cardinality(items) >= 1
                              and array_position(items, null) is null
           end),

  constraint decision_snooze_events_until_ahead
    check ("until" > created_at)
);

comment on table ouroboros.decision_snooze_events is
  'The snooze audit trail (#458, X6): one row per snooze — scope item (one item) or all (every open item of the workspace, listed in items) — with who, until when and why. Snooze all 1h is one row. Append-only: the service may insert and read, never revise.';
comment on column ouroboros.decision_snooze_events.items is
  'The items the event snoozed: exactly {item_id} for scope item, every item it caught for scope all.';
comment on column ouroboros.decision_snooze_events."until" is
  'When the snoozed items re-surface. After created_at.';

create index decision_snooze_events_organization_idx
  on ouroboros.decision_snooze_events (organization_id, created_at desc);

create function ouroboros.decision_item_snooze(
  p_item_id uuid,
  p_until   timestamptz,
  p_actor   text,
  p_reason  text default null
) returns uuid
language plpgsql
as $$
declare
  org      text;
  event_id uuid;
begin
  update ouroboros.decision_items
     set status = 'snoozed', snoozed_until = p_until, snoozed_by = p_actor, snooze_reason = p_reason
   where id = p_item_id and status in ('open', 'snoozed')
  returning organization_id into org;

  if org is null then
    raise exception 'decision item % is not open, so it cannot be snoozed', p_item_id
      using errcode = 'invalid_parameter_value';
  end if;

  insert into ouroboros.decision_snooze_events (organization_id, scope, item_id, items, actor, "until", reason)
  values (org, 'item', p_item_id, array[p_item_id], p_actor, p_until, p_reason)
  returning id into event_id;

  return event_id;
end;
$$;

comment on function ouroboros.decision_item_snooze(uuid, timestamptz, text, text) is
  'Snooze one open (or re-snooze one snoozed) decision item until p_until (#458, X6), recording a scope-item event. Hides the item from the pill; never touches created_at. Raises 22023 when the item is not open or snoozed; the event refuses an until that is not ahead. Returns the event id.';

create function ouroboros.decision_items_snooze_all(
  p_organization_id text,
  p_until           timestamptz,
  p_actor           text,
  p_reason          text default null
) returns uuid
language plpgsql
as $$
declare
  caught   uuid[];
  event_id uuid;
begin
  with snoozed as (
    update ouroboros.decision_items
       set status = 'snoozed', snoozed_until = p_until, snoozed_by = p_actor, snooze_reason = p_reason
     where organization_id = p_organization_id and status = 'open'
    returning id, created_at
  )
  select array_agg(id order by created_at, id) into caught from snoozed;

  if caught is null then
    return null;
  end if;

  insert into ouroboros.decision_snooze_events (organization_id, scope, item_id, items, actor, "until", reason)
  values (p_organization_id, 'all', null, caught, p_actor, p_until, p_reason)
  returning id into event_id;

  return event_id;
end;
$$;

comment on function ouroboros.decision_items_snooze_all(text, timestamptz, text, text) is
  'Snooze all (#458, X6): snoozes every open item of the workspace until p_until and records ONE scope-all event listing them, so the head''s Snooze all 1h is reconstructable. Returns the event id, or null (and records nothing) when nothing was open.';

create function ouroboros.decision_items_wake(p_organization_id text, p_at timestamptz default now())
returns integer
language plpgsql
as $$
declare
  woken integer;
begin
  update ouroboros.decision_items
     set status = 'open', snoozed_until = null, snoozed_by = null, snooze_reason = null
   where organization_id = p_organization_id
     and status = 'snoozed'
     and snoozed_until <= p_at;

  get diagnostics woken = row_count;
  return woken;
end;
$$;

comment on function ouroboros.decision_items_wake(text, timestamptz) is
  'Re-opens a workspace''s snoozed items whose snoozed_until has passed (#458, X6) and returns how many. The item keeps its original created_at — its age counted through the snooze. p_at defaults to now().';

-- ---------------------------------------------------------------------------
-- 5. The weekly decision metrics.
-- ---------------------------------------------------------------------------
create view ouroboros.decision_metrics_weekly_by_kind
  with (security_invoker = true) as
select r.organization_id,
       (date_trunc('week', r.resolved_at at time zone 'UTC'))::date            as week,
       i.kind_id,
       count(*)::integer                                                         as decisions,
       percentile_cont(0.5) within group (order by r.answer_latency)            as median_answer_latency
  from ouroboros.decision_resolutions r
  join ouroboros.decision_items i on i.id = r.item_id
 group by r.organization_id, (date_trunc('week', r.resolved_at at time zone 'UTC'))::date, i.kind_id;

comment on view ouroboros.decision_metrics_weekly_by_kind is
  'Per workspace, UTC ISO week (Monday) and decision kind (#458): decisions resolved and their median answer latency — what BO.1''s head estimate (~90 seconds for what is open) is computed from.';

create view ouroboros.decision_metrics_weekly
  with (security_invoker = true) as
with weekly as (
  select r.organization_id,
         (date_trunc('week', r.resolved_at at time zone 'UTC'))::date          as week,
         count(*)::integer                                                       as decisions,
         percentile_cont(0.5) within group (order by r.answer_latency)          as median_answer_latency,
         max(r.loop_wait)                                                        as max_loop_wait,
         (count(*) filter (where r.resolver = 'policy'))::integer                as policy_resolutions
    from ouroboros.decision_resolutions r
   group by r.organization_id, (date_trunc('week', r.resolved_at at time zone 'UTC'))::date
)
select w.organization_id,
       w.week,
       w.decisions,
       w.median_answer_latency,
       w.max_loop_wait,
       w.policy_resolutions,
       round(w.policy_resolutions::numeric / w.decisions, 4)                    as auto_accept_share,
       (select jsonb_object_agg(k.kind_id, extract(epoch from k.median_answer_latency)
                                order by k.kind_id)
          from ouroboros.decision_metrics_weekly_by_kind k
         where k.organization_id = w.organization_id and k.week = w.week)       as per_kind_median_answer_seconds
  from weekly w;

comment on view ouroboros.decision_metrics_weekly is
  'The Needs-You stat card (#458, BM.2): per workspace and UTC ISO week (Monday), decisions resolved, the median answer latency, the longest loop wait (null when no loop waited), policy resolutions and their share of the week, and each kind''s median answer latency in seconds. Every figure is over decision_resolutions — snoozed time included, since snooze never resets an item''s age.';

-- ---------------------------------------------------------------------------
-- 6. The methodology registry (#432, BI.1 — amendment).
--
-- Family `decisions`, like `calibration` (V077) and `scoreboard` (V082): computed from the source
-- plane per request by the views above and never on the daily grain, so no extractor fills them
-- and `metric_daily` holds no rows for them. `aggregation` is left to its default; it describes
-- re-windowing the daily grain, which none of these are on.
-- ---------------------------------------------------------------------------
insert into ouroboros.metric_definitions
  (metric_id, family, title, formula_text, source_planes, caveats, unit, is_rate, proxy)
values
  ('decisions_resolved', 'decisions', 'Decisions',
   'Decision items answered in the UTC week (Monday to Sunday), by a person or by a policy — one per item, counted on the day it was answered.',
   '{decision_resolutions}',
   'Items that expired unanswered are not counted. An item answered by a policy counts like one answered by a person; the auto-accept share says how many.',
   'count', false, false),

  ('decision_answer_latency', 'decisions', 'Median answer time',
   'The median, over the week''s answered items, of the time from the item being asked to it being answered.',
   '{decision_items,decision_resolutions}',
   'Time an item spent snoozed is included — snoozing hides an item, it does not stop its clock. This is how long the question waited, not how long a loop did: see the longest loop wait.',
   'duration_ms', false, false),

  ('decision_loop_wait_max', 'decisions', 'Longest loop wait',
   'The longest time, over the week''s answered items, that a run sat blocked on one: from when the run stopped to wait to the earlier of the answer and the run moving on.',
   '{run_blocks,decision_resolutions}',
   'Only items a run was blocked on have a wait; when none did, there is no figure rather than zero. A run can stop before its question is filed, so a wait can be longer than the answer time.',
   'duration_ms', false, false),

  ('decision_auto_accept_share', 'decisions', 'Auto-accepted share',
   'Decisions answered by a policy (auto-accepted, never silently) over all decisions answered in the week.',
   '{decision_resolutions}',
   'Only kinds declared auto-resolvable can be answered by a policy; merge-class decisions never are.',
   'pct', true, false),

  ('decision_answer_latency_by_kind', 'decisions', 'Median answer time by kind',
   'The median answer time of one decision kind''s items answered in the week.',
   '{decision_items,decision_resolutions}',
   'A kind answered a handful of times a week has a noisy median. Snoozed time is included, as for the overall median.',
   'duration_ms', false, false);

-- ---------------------------------------------------------------------------
-- The service role's grants. Resolutions and blocks are written, never deleted (cascades are);
-- the snooze trail is appended and read.
-- ---------------------------------------------------------------------------
grant select, insert, update on ouroboros.run_blocks to ouroboros_app;
grant select, insert, update on ouroboros.decision_resolutions to ouroboros_app;
grant select, insert on ouroboros.decision_snooze_events to ouroboros_app;
grant select on ouroboros.decision_metrics_weekly to ouroboros_app;
grant select on ouroboros.decision_metrics_weekly_by_kind to ouroboros_app;
grant execute on function ouroboros.decision_loop_wait(uuid, timestamptz) to ouroboros_app;
grant execute on function ouroboros.decision_item_snooze(uuid, timestamptz, text, text) to ouroboros_app;
grant execute on function ouroboros.decision_items_snooze_all(text, timestamptz, text, text) to ouroboros_app;
grant execute on function ouroboros.decision_items_wake(text, timestamptz) to ouroboros_app;
