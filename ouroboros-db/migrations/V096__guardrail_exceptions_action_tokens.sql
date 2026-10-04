-- V096__guardrail_exceptions_action_tokens.sql — the scoped, expiring, single-use guardrail
-- exception behind mockup 16's *Allow once*, and the hash-only action tokens that let a decision
-- be answered from an email (#459, BM.3, decisions X3 and X5).
--
-- ---------------------------------------------------------------------------
-- 1. guardrail_exceptions — "Allow once" has to mean once.
-- ---------------------------------------------------------------------------
--
-- AP.3's protected-path evaluation (#305, #380) had two answers: allowed or not. A grant is the
-- narrowest object the schema can express — **this run, this path glob, granted by this person
-- through this decision item, expiring at this time, consumable exactly once**:
--
--   - `run_id` — always one run, of the grant's own workspace (composite key). Another run
--     touching the same path is still refused.
--   - `path_glob` — the narrowest expression (`boot/rollback_flag.c`); a `**` is refused outright,
--     because a grant that opens a whole tree is the "unprotect this path" switch this table
--     exists not to be.
--   - `granted_via` — the decision item that authorised it, required and about this run (its refs
--     name the run): the audit chain back to the card.
--   - `expires_at` — after `created_at` and at most the workspace's
--     `guardrail_exception_max_ttl_minutes` later (default 24 hours, never more than 7 days).
--   - `used_at` + `used_by_evaluation` — **single use**, set together by
--     `guardrail_exception_consume`, which AP.3 calls with the `allowed_paths` evaluation that used
--     it: card → grant → consumption. A TTL alone would let a retry loop write the path again
--     inside the window; the recorded consumption blocks the second attempt.
--   - `revoked_at` + `revoked_by` — withdrawable before use, never after.
--
-- Everything else about a grant is fixed when it is written (`guardrail_exceptions_history`).
--
-- ---------------------------------------------------------------------------
-- 2. action_tokens — a link in a mail that performs an action is a bearer credential.
-- ---------------------------------------------------------------------------
--
--   - **Hash only.** `token_hash` is the HMAC-SHA256 of the token under a key the vault holds
--     (AD.1), as 64 hex characters; `hash_algorithm` and `hash_key_ref` record how, so keys can be
--     rotated. There is no column a plaintext token could be written to, and no function takes
--     one — `constraints.sql` asserts the column list and the writers' arguments, and
--     `tests/action-tokens.test.sh` greps the migrations.
--   - **One live token per (item, action, user)** (`action_tokens_live_key`). Minting through
--     `action_token_mint` supersedes the live one first.
--   - **Short-lived**: `expires_at` is `created_at` plus the workspace's
--     `action_token_ttl_minutes` (default 48 hours), set by the mint and bounded by a trigger.
--   - **Single-use**: `action_token_use` marks a live token used and reports why any other was
--     refused — `expired`, `used` or `revoked` are three different answers (BN.3 renders three
--     designed errors), read the same way through `action_tokens_state`.
--   - **Revoked the instant the item stops asking**, by any route: a resolution through any
--     channel, or expiry (`decision_items_revoke_tokens`).
--   - **`requires_confirm`** is copied from the item's kind (`merge_class`) and nothing else
--     (X5): a merge-class token never merges on its own — it lands on a page that demands a
--     session. The caller cannot set it.
--
-- ---------------------------------------------------------------------------
-- 3. The two TTL settings, on workspace_settings.
-- ---------------------------------------------------------------------------
--
-- `ouroboros_app` cannot read `workspace_settings`, so the triggers read the two values through
-- `decision_ttl_settings`, a definer function that answers for one workspace and nothing else
-- (added to `constraints.sql`'s closed list of definer functions).
--
-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------
--
--   drop trigger decision_items_revoke_tokens on ouroboros.decision_items;
--   drop function ouroboros.decision_items_revoke_tokens();
--   drop view ouroboros.action_tokens_state;
--   drop function ouroboros.action_token_use(text);
--   drop function ouroboros.action_token_mint(uuid, text, text, text, text, text, text);
--   drop table ouroboros.action_tokens;
--   drop function ouroboros.action_tokens_history();
--   drop function ouroboros.action_tokens_derive();
--   drop view ouroboros.guardrail_exceptions_live;
--   drop function ouroboros.guardrail_exception_consume(uuid, uuid);
--   drop table ouroboros.guardrail_exceptions;
--   drop function ouroboros.guardrail_exceptions_history();
--   drop function ouroboros.guardrail_exceptions_granted();
--   drop function ouroboros.decision_ttl_settings(text);
--   (and V041's workspace_settings_effective, re-created without the two columns)
--   alter table ouroboros.workspace_settings drop column action_token_ttl_minutes,
--     drop column guardrail_exception_max_ttl_minutes;

-- ---------------------------------------------------------------------------
-- 3. The settings (first, because both tables' triggers read them).
-- ---------------------------------------------------------------------------
alter table ouroboros.workspace_settings
  add column guardrail_exception_max_ttl_minutes integer not null default 1440
    constraint workspace_settings_guardrail_exception_max_ttl_bounded
      check (guardrail_exception_max_ttl_minutes between 1 and 10080),
  add column action_token_ttl_minutes integer not null default 2880
    constraint workspace_settings_action_token_ttl_bounded
      check (action_token_ttl_minutes between 5 and 10080);

comment on column ouroboros.workspace_settings.guardrail_exception_max_ttl_minutes is
  'The longest an allow-once guardrail exception may live, in minutes (#459): default 1440 (24 hours), between 1 minute and 7 days. No indefinite grants.';
comment on column ouroboros.workspace_settings.action_token_ttl_minutes is
  'How long an emailed action token lives, in minutes (#459): default 2880 (48 hours), between 5 minutes and 7 days.';

create or replace view ouroboros.workspace_settings_effective
  with (security_invoker = true) as
select o."id"                                     as organization_id,
       coalesce(s.auto_merge_on_checks, false)    as auto_merge_on_checks,
       (s.organization_id is not null)            as is_explicit,
       s.updated_at,
       s.updated_by,
       coalesce(s.runner_bearer_fallback, false)  as runner_bearer_fallback,

       -- Appended, as V041's column was; the defaults restated here are asserted equal to the
       -- columns' in constraints.sql.
       coalesce(s.guardrail_exception_max_ttl_minutes, 1440) as guardrail_exception_max_ttl_minutes,
       coalesce(s.action_token_ttl_minutes, 2880)            as action_token_ttl_minutes
  from ouroboros.organization o
  left join ouroboros.workspace_settings s
    on s.organization_id = o."id";

create function ouroboros.decision_ttl_settings(p_organization_id text)
returns table (exception_max_ttl interval, action_token_ttl interval)
language sql
stable
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
  select make_interval(mins => coalesce(s.guardrail_exception_max_ttl_minutes, 1440)),
         make_interval(mins => coalesce(s.action_token_ttl_minutes, 2880))
    from (select p_organization_id as organization_id) w
    left join ouroboros.workspace_settings s on s.organization_id = w.organization_id
$$;

comment on function ouroboros.decision_ttl_settings(text) is
  'One workspace''s two decision TTLs (#459): the longest an allow-once exception may live and how long an action token lives, defaults resolved. Runs as its owner because the service role cannot read workspace_settings; answers for the named workspace only; search_path pinned; executable by the service only.';

revoke execute on function ouroboros.decision_ttl_settings(text) from public;

-- ---------------------------------------------------------------------------
-- 1. guardrail_exceptions.
-- ---------------------------------------------------------------------------
create table ouroboros.guardrail_exceptions (
  id                 uuid        primary key default gen_random_uuid(),

  organization_id    text        not null
                                 references ouroboros.organization ("id") on delete cascade,

  -- Always exactly one run.
  run_id             uuid        not null,

  -- The narrowest expression of what is permitted: a repository-relative path or glob, no `**`.
  path_glob          text        not null
                                 constraint guardrail_exceptions_path_glob_narrow
                                   check (ouroboros.decision_ref_path_valid(path_glob)
                                          and strpos(path_glob, '**') = 0),

  -- The person who said yes (required when written; forgotten if they are deleted) and the
  -- decision item they said it through (required — no grant without its card).
  granted_by         text        references ouroboros."user" ("id") on delete set null,
  granted_via        uuid        not null,

  expires_at         timestamptz not null,

  -- Single use: when, and by which evaluation. Set together, once.
  used_at            timestamptz,
  used_by_evaluation uuid        references ouroboros.guardrail_evaluations (id),

  -- Withdrawn before use.
  revoked_at         timestamptz,
  revoked_by         text        references ouroboros."user" ("id") on delete set null,

  created_at         timestamptz not null default now(),

  constraint guardrail_exceptions_run_fk
    foreign key (run_id, organization_id)
    references ouroboros.runs (id, organization_id) on delete cascade,

  constraint guardrail_exceptions_granted_via_fk
    foreign key (granted_via, organization_id)
    references ouroboros.decision_items (id, organization_id) on delete cascade,

  constraint guardrail_exceptions_expires_after_created
    check (expires_at > created_at),

  constraint guardrail_exceptions_use_recorded
    check ((used_at is null) = (used_by_evaluation is null)),

  constraint guardrail_exceptions_used_or_revoked
    check (used_at is null or revoked_at is null),

  constraint guardrail_exceptions_revoker_only_when_revoked
    check (revoked_at is not null or revoked_by is null)
);

comment on table ouroboros.guardrail_exceptions is
  'Allow-once guardrail exceptions (#459, BM.3, decision X3): one run, one narrow path glob, granted by a person through a decision item, expiring within the workspace''s maximum TTL, consumed exactly once by an AP.3 allowed_paths evaluation (guardrail_exception_consume) or revoked before use. Never a standing unprotect switch.';
comment on column ouroboros.guardrail_exceptions.path_glob is
  'What the grant permits — boot/rollback_flag.c, never boot/**. Repository-relative (V067''s grammar); ** is refused.';
comment on column ouroboros.guardrail_exceptions.granted_via is
  'The decision item that authorised the grant — required, of this workspace, and about this run.';
comment on column ouroboros.guardrail_exceptions.expires_at is
  'When the grant lapses unused. After created_at and within workspace_settings.guardrail_exception_max_ttl_minutes of it.';
comment on column ouroboros.guardrail_exceptions.used_at is
  'When AP.3 consumed the grant. Set once, with used_by_evaluation; a used grant permits nothing again.';
comment on column ouroboros.guardrail_exceptions.used_by_evaluation is
  'The allowed_paths evaluation of this run that consumed the grant — the last link of card → grant → consumption.';

-- What AP.3 reads on every evaluation: a run's unspent, unrevoked grants. Expiry cannot be in an
-- index predicate (now() is not immutable), so it is the read's filter (guardrail_exceptions_live).
create index guardrail_exceptions_live_idx
  on ouroboros.guardrail_exceptions (organization_id, run_id)
  where used_at is null and revoked_at is null;

create index guardrail_exceptions_granted_via_idx
  on ouroboros.guardrail_exceptions (granted_via);

create function ouroboros.guardrail_exceptions_granted() returns trigger
language plpgsql
as $$
declare
  ceiling interval;
begin
  if new.granted_by is null then
    raise exception 'a guardrail exception names the person who granted it'
      using errcode = 'check_violation', constraint = 'guardrail_exceptions_granted_by_named';
  end if;

  if not exists (select 1 from ouroboros.decision_items i
                  where i.id = new.granted_via
                    and i.refs @> jsonb_build_array(jsonb_build_object('type', 'run',
                                                                       'id', new.run_id::text))) then
    -- A missing item is the foreign key's complaint; an item about another run is this one's.
    if exists (select 1 from ouroboros.decision_items i where i.id = new.granted_via) then
      raise exception 'decision item % is not about run %, so it cannot grant an exception on it',
        new.granted_via, new.run_id
        using errcode = 'check_violation', constraint = 'guardrail_exceptions_granted_for_run';
    end if;
  end if;

  select exception_max_ttl into ceiling from ouroboros.decision_ttl_settings(new.organization_id);

  if new.expires_at > new.created_at + ceiling then
    raise exception 'a guardrail exception lives at most % in this workspace, not %',
      ceiling, new.expires_at - new.created_at
      using errcode = 'check_violation', constraint = 'guardrail_exceptions_ttl_bounded';
  end if;

  return new;
end;
$$;

comment on function ouroboros.guardrail_exceptions_granted() is
  'BEFORE INSERT trigger for guardrail_exceptions (#459): the grant names its granter (guardrail_exceptions_granted_by_named), its decision item is about its run (guardrail_exceptions_granted_for_run), and it expires within the workspace''s maximum TTL (guardrail_exceptions_ttl_bounded). Raises class 23 naming the rule.';

create trigger guardrail_exceptions_granted
  before insert on ouroboros.guardrail_exceptions
  for each row execute function ouroboros.guardrail_exceptions_granted();

create function ouroboros.guardrail_exceptions_history() returns trigger
language plpgsql
as $$
declare
  judged uuid;
begin
  if row(new.id, new.organization_id, new.run_id, new.path_glob, new.granted_via, new.expires_at,
         new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.run_id, old.path_glob, old.granted_via, old.expires_at,
         old.created_at)
     or (new.granted_by is distinct from old.granted_by and new.granted_by is not null)
     or (old.used_at is not null
         and row(new.used_at, new.used_by_evaluation) is distinct from row(old.used_at, old.used_by_evaluation))
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.revoked_by is not null and new.revoked_by is distinct from old.revoked_by
         and new.revoked_by is not null) then
    raise exception 'guardrail exception % is fixed once granted: only its consumption or revocation is recorded, once',
      old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- Consumed by an allowed_paths evaluation of this very run.
  if new.used_by_evaluation is not null and old.used_by_evaluation is null then
    select e.run_id into judged
      from ouroboros.guardrail_evaluations e
     where e.id = new.used_by_evaluation and e."check" = 'allowed_paths';

    if judged is distinct from new.run_id then
      raise exception 'guardrail exception % can only be consumed by an allowed_paths evaluation of run %',
        old.id, old.run_id
        using errcode = 'check_violation', constraint = 'guardrail_exceptions_consumed_by_own_run';
    end if;
  end if;

  return new;
end;
$$;

comment on function ouroboros.guardrail_exceptions_history() is
  'BEFORE UPDATE trigger for guardrail_exceptions (#459): what was granted never changes; consumption (used_at with used_by_evaluation) and revocation are each recorded once; the granter and revoker can be forgotten, never replaced; and the consuming evaluation is an allowed_paths verdict of the grant''s own run (guardrail_exceptions_consumed_by_own_run). Raises class 23.';

create trigger guardrail_exceptions_history
  before update on ouroboros.guardrail_exceptions
  for each row execute function ouroboros.guardrail_exceptions_history();

create view ouroboros.guardrail_exceptions_live
  with (security_invoker = true) as
select e.id, e.organization_id, e.run_id, e.path_glob, e.granted_by, e.granted_via, e.expires_at,
       e.created_at
  from ouroboros.guardrail_exceptions e
 where e.used_at is null
   and e.revoked_at is null
   and e.expires_at > now();

comment on view ouroboros.guardrail_exceptions_live is
  'The grants AP.3 may still consume (#459): unused, unrevoked and unexpired. Read per run; consume with guardrail_exception_consume.';

create function ouroboros.guardrail_exception_consume(p_exception_id uuid, p_evaluation_id uuid)
returns boolean
language plpgsql
as $$
declare
  consumed uuid;
begin
  update ouroboros.guardrail_exceptions e
     set used_at = now(), used_by_evaluation = p_evaluation_id
   where e.id = p_exception_id
     and e.used_at is null
     and e.revoked_at is null
     and e.expires_at > now()
     and e.run_id = (select g.run_id from ouroboros.guardrail_evaluations g
                      where g.id = p_evaluation_id)
  returning e.id into consumed;

  return consumed is not null;
end;
$$;

comment on function ouroboros.guardrail_exception_consume(uuid, uuid) is
  'Consume an allow-once grant for an AP.3 evaluation (#459, the #305 amendment): true when the grant was live — unused, unrevoked, unexpired — and belongs to the evaluation''s run, and is now spent; false otherwise, so an expired, used, revoked or other-run grant permits nothing. Atomic: two evaluations racing for one grant cannot both consume it.';

-- ---------------------------------------------------------------------------
-- 2. action_tokens.
-- ---------------------------------------------------------------------------
create table ouroboros.action_tokens (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- What it answers, and for whom: one item, one of its answering actions, one person.
  item_id          uuid        not null,
  action_id        text        not null,
  user_id          text        not null references ouroboros."user" ("id") on delete cascade,

  -- HMAC-SHA256 of the token under a vault-held key, hex. Never the token.
  token_hash       text        not null
                               constraint action_tokens_hash_hex
                                 check (token_hash ~ '^[0-9a-f]{64}$'),
  hash_algorithm   text        not null default 'hmac-sha256'
                               constraint action_tokens_hash_algorithm
                                 check (hash_algorithm in ('hmac-sha256')),
  -- Which key hashed it, for rotation: an identifier, never key material.
  hash_key_ref     text        not null
                               constraint action_tokens_hash_key_ref_format
                                 check (hash_key_ref ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'),

  -- The send that minted it — the receipt says where the answer came from.
  channel          text        not null
                               constraint action_tokens_channel
                                 check (channel in ('web', 'email', 'github', 'slack', 'push', 'api')),

  -- From the kind's merge_class, never from the caller (X5).
  requires_confirm boolean     not null,

  expires_at       timestamptz not null,
  used_at          timestamptz,
  revoked_at       timestamptz,
  revoke_reason    text
                   constraint action_tokens_revoke_reason
                     check (revoke_reason in ('superseded', 'item_closed', 'withdrawn')),

  created_at       timestamptz not null default now(),

  constraint action_tokens_item_fk
    foreign key (item_id, organization_id)
    references ouroboros.decision_items (id, organization_id) on delete cascade,

  constraint action_tokens_hash_unique unique (token_hash),

  constraint action_tokens_expires_after_created
    check (expires_at > created_at),

  constraint action_tokens_revocation_complete
    check ((revoked_at is null) = (revoke_reason is null)),

  constraint action_tokens_used_or_revoked
    check (used_at is null or revoked_at is null),

  constraint action_tokens_used_before_expiry
    check (used_at is null or used_at < expires_at)
);

comment on table ouroboros.action_tokens is
  'Single-use action tokens for answering a decision from a channel (#459, BM.3, decision X5): one item × answering action × person, hash-only (HMAC-SHA256 under a vault key, algorithm and key ref recorded), short-lived (workspace action_token_ttl_minutes), one live token per (item, action, user), revoked the moment the item stops asking, and requires_confirm copied from the kind''s merge_class. Minted by action_token_mint, spent by action_token_use.';
comment on column ouroboros.action_tokens.token_hash is
  'HMAC-SHA256 of the token, 64 hex characters. The token itself is shown once, in the send, and stored nowhere.';
comment on column ouroboros.action_tokens.hash_key_ref is
  'Which vault key produced token_hash — an identifier for rotation, never key material.';
comment on column ouroboros.action_tokens.requires_confirm is
  'True exactly for a merge-class kind (X5), derived from the declaration: the token lands on a page that demands a session and never merges on its own.';
comment on column ouroboros.action_tokens.revoke_reason is
  'superseded (a newer token was minted for the same item, action and person), item_closed (the item was resolved through any channel, or expired), or withdrawn.';

-- One live token per (item, action, user). Also the index the revocations walk.
create unique index action_tokens_live_key
  on ouroboros.action_tokens (item_id, action_id, user_id)
  where used_at is null and revoked_at is null;

create function ouroboros.action_tokens_derive() returns trigger
language plpgsql
as $$
declare
  semantics   jsonb;
  merge_kind  boolean;
  item_status text;
  ttl         interval;
begin
  select k.resolution_semantics, k.merge_class, i.status into semantics, merge_kind, item_status
    from ouroboros.decision_items i
    join ouroboros.decision_kinds k on k.kind_id = i.kind_id and k.version = i.kind_version
   where i.id = new.item_id;

  -- No item is the foreign key's complaint.
  if semantics is null then
    return new;
  end if;

  if not (semantics -> 'answered_by') ? new.action_id then
    raise exception 'action % does not answer this item, so no token can carry it', new.action_id
      using errcode = 'check_violation', constraint = 'action_tokens_action_answers';
  end if;

  if item_status not in ('open', 'snoozed') then
    raise exception 'decision item % is %, so no token can be minted for it', new.item_id, item_status
      using errcode = 'check_violation', constraint = 'action_tokens_item_open';
  end if;

  select action_token_ttl into ttl from ouroboros.decision_ttl_settings(new.organization_id);

  if new.expires_at > new.created_at + ttl then
    raise exception 'an action token lives at most % in this workspace', ttl
      using errcode = 'check_violation', constraint = 'action_tokens_ttl_bounded';
  end if;

  -- The declaration decides, whatever the caller sent.
  new.requires_confirm := merge_kind;
  return new;
end;
$$;

comment on function ouroboros.action_tokens_derive() is
  'BEFORE INSERT trigger for action_tokens (#459): the action answers the item''s pinned kind (action_tokens_action_answers), the item is still asking (action_tokens_item_open), the token expires within the workspace''s TTL (action_tokens_ttl_bounded), and requires_confirm is the kind''s merge_class — set here, overriding the caller (X5).';

create trigger action_tokens_derive
  before insert on ouroboros.action_tokens
  for each row execute function ouroboros.action_tokens_derive();

create function ouroboros.action_tokens_history() returns trigger
language plpgsql
as $$
begin
  if row(new.id, new.organization_id, new.item_id, new.action_id, new.user_id, new.token_hash,
         new.hash_algorithm, new.hash_key_ref, new.channel, new.requires_confirm, new.expires_at,
         new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.item_id, old.action_id, old.user_id, old.token_hash,
         old.hash_algorithm, old.hash_key_ref, old.channel, old.requires_confirm, old.expires_at,
         old.created_at)
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.revoked_at is not null
         and row(new.revoked_at, new.revoke_reason) is distinct from row(old.revoked_at, old.revoke_reason)) then
    raise exception 'action token % is fixed once minted: only its use or revocation is recorded, once', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.action_tokens_history() is
  'BEFORE UPDATE trigger for action_tokens (#459): what a token answers, for whom, its hash and its expiry never change; its use and its revocation are each recorded once. Raises class 23 naming the trigger.';

create trigger action_tokens_history
  before update on ouroboros.action_tokens
  for each row execute function ouroboros.action_tokens_history();

create function ouroboros.action_token_mint(
  p_item_id        uuid,
  p_action_id      text,
  p_user_id        text,
  p_token_hash     text,
  p_hash_key_ref   text,
  p_channel        text,
  p_hash_algorithm text default 'hmac-sha256'
) returns uuid
language plpgsql
as $$
declare
  org      text;
  ttl      interval;
  token_id uuid;
begin
  select organization_id into org from ouroboros.decision_items where id = p_item_id;

  if org is null then
    raise exception 'no decision item %', p_item_id
      using errcode = 'foreign_key_violation', constraint = 'action_tokens_item_fk';
  end if;

  select action_token_ttl into ttl from ouroboros.decision_ttl_settings(org);

  -- Supersede: the live token for this (item, action, user), if any, stops working first.
  update ouroboros.action_tokens
     set revoked_at = now(), revoke_reason = 'superseded'
   where item_id = p_item_id and action_id = p_action_id and user_id = p_user_id
     and used_at is null and revoked_at is null;

  insert into ouroboros.action_tokens
    (organization_id, item_id, action_id, user_id, token_hash, hash_algorithm, hash_key_ref,
     channel, requires_confirm, expires_at)
  values
    (org, p_item_id, p_action_id, p_user_id, p_token_hash, p_hash_algorithm, p_hash_key_ref,
     p_channel, false, now() + ttl)
  returning id into token_id;

  return token_id;
end;
$$;

comment on function ouroboros.action_token_mint(uuid, text, text, text, text, text, text) is
  'Mint an action token (#459): takes the token''s HMAC (never the token), revokes the live token for the same item, action and person as superseded, and inserts the new one expiring after the workspace''s action_token_ttl_minutes. requires_confirm comes from the kind. Returns the token id.';

create function ouroboros.action_token_use(p_token_hash text)
returns table (token_id uuid, item_id uuid, action_id text, user_id text,
               requires_confirm boolean, outcome text)
language plpgsql
as $$
declare
  t ouroboros.action_tokens%rowtype;
begin
  select * into t from ouroboros.action_tokens a where a.token_hash = p_token_hash for update;

  if t.id is null then
    return query select null::uuid, null::uuid, null::text, null::text, null::boolean, 'unknown'::text;
    return;
  end if;

  if t.used_at is not null then
    outcome := 'used';
  elsif t.revoked_at is not null then
    outcome := 'revoked';
  elsif t.expires_at <= now() then
    outcome := 'expired';
  else
    update ouroboros.action_tokens a set used_at = now() where a.id = t.id;
    outcome := 'accepted';
  end if;

  return query select t.id, t.item_id, t.action_id, t.user_id, t.requires_confirm, outcome;
end;
$$;

comment on function ouroboros.action_token_use(text) is
  'Spend an action token by its hash (#459): accepted (and now used) when it was live; otherwise used, revoked or expired — three answers BN.3 renders as three designed errors — or unknown. Returns the token''s item, action, person and requires_confirm: a requires_confirm token must still be confirmed in a session before anything merges (X5).';

create view ouroboros.action_tokens_state
  with (security_invoker = true) as
select a.id, a.organization_id, a.item_id, a.action_id, a.user_id, a.channel, a.requires_confirm,
       a.expires_at, a.used_at, a.revoked_at, a.revoke_reason, a.created_at,
       case when a.used_at is not null    then 'used'
            when a.revoked_at is not null then 'revoked'
            when a.expires_at <= now()    then 'expired'
            else 'live'
       end as state
  from ouroboros.action_tokens a;

comment on view ouroboros.action_tokens_state is
  'Every action token with its state (#459): live, used, revoked (with revoke_reason) or expired — distinguishable, never one "invalid". The hash is deliberately not selected.';

-- --- revoked the instant the item stops asking, whichever channel answered it ---------------
create function ouroboros.decision_items_revoke_tokens() returns trigger
language plpgsql
as $$
begin
  update ouroboros.action_tokens
     set revoked_at = now(), revoke_reason = 'item_closed'
   where item_id = new.id and used_at is null and revoked_at is null;
  return null;
end;
$$;

comment on function ouroboros.decision_items_revoke_tokens() is
  'AFTER UPDATE OF status trigger for decision_items (#459): when an item is resolved — through any channel, by any resolver — or expires, every outstanding token for it is revoked as item_closed.';

create trigger decision_items_revoke_tokens
  after update of status on ouroboros.decision_items
  for each row
  when (new.status in ('resolved', 'expired') and old.status is distinct from new.status)
  execute function ouroboros.decision_items_revoke_tokens();

-- ---------------------------------------------------------------------------
-- The service role's grants. Grants and tokens are written and moved through their lives,
-- never deleted (the run's, item's and workspace's cascades are).
-- ---------------------------------------------------------------------------
grant select, insert, update on ouroboros.guardrail_exceptions to ouroboros_app;
grant select on ouroboros.guardrail_exceptions_live to ouroboros_app;
grant select, insert, update on ouroboros.action_tokens to ouroboros_app;
grant select on ouroboros.action_tokens_state to ouroboros_app;
grant execute on function ouroboros.decision_ttl_settings(text) to ouroboros_app;
grant execute on function ouroboros.guardrail_exception_consume(uuid, uuid) to ouroboros_app;
grant execute on function ouroboros.action_token_mint(uuid, text, text, text, text, text, text) to ouroboros_app;
grant execute on function ouroboros.action_token_use(text) to ouroboros_app;
