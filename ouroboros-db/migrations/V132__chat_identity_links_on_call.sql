-- V132__chat_identity_links_on_call.sql — who a platform user is, and who escalations DM
-- (#533, BY.3).
--
-- Mockup 19's caption — *"Same permissions, same audit trail."* — is a mechanism only if a Slack
-- button press can be turned into a member. `U024AB` is not a member, holds no role and no
-- capability; every check in the product operates on one. Two tables:
--
--   chat_connections ──< chat_identity_links >── member      a platform user is a member
--   organization ──< on_call_assignments >── member          the human an escalation DMs
--
-- **A link is verified, never inferred.** `verified_via` says how — `oauth_session`,
-- `email_match_confirmed` or `admin_assigned` — and a `linked` row cannot exist without it
-- (`chat_identity_links_linked_is_verified`). An email match is an assist the person confirms
-- in the app, not a rule.
--
-- **Pending is a durable, single-use handshake.** A `pending` row carries the SHA-256 of its
-- link token — never the token — and an `expires_at`. Becoming `linked` clears both, so the
-- token works once; a pending row past its expiry cannot become linked at all
-- (`chat_identity_links_transition`). The handshake starts on the platform, so a pending row
-- may not know its member yet; a linked one always does.
--
-- **Unlinked is one indexed read.** `chat_identity_links_platform_user_key` is unique on
-- (connection, platform user) among rows that are not revoked — the rule *a platform user is at
-- most one member* and the lookup every button press makes are the same index.
-- `chat_identity_links_member_key` is the other direction: a member has at most one identity
-- per connection.
--
-- **Revocation revokes; it does not erase.** A revoked row stays, with `revoked_at` and
-- `revoked_by`, and is final: a person who links again gets a new row, and the commands invoked
-- under the old one keep pointing at it. The application role holds no `delete`.
--
-- **A member who leaves is revoked by the database.** `member` is BetterAuth's table and its row
-- is deleted when someone is removed from a workspace. `chat_identity_links_member_removed`
-- revokes their links and clears `member_id` itself (the key is deferred and takes no action). So that the row still names
-- a person afterwards, it carries `user_id` — copied from the member when the link is made
-- (`chat_identity_links_member_resolve`, which also refuses a member of another workspace).
--
-- **`chat_commands.invoker_link_id` gets its foreign key**, as V131 left it for this migration:
-- a command's invoker link is one of its own connection's. Deferred, without an action — a
-- connection's delete removes commands and links by different cascade paths (V112's lesson).
--
-- **On-call is someone reachable.** `on_call_assignments` has one active designee per
-- (workspace, scope) — `on_call_assignments_one_active` — and `scope` is an open slug defaulting
-- to `decisions`, so CB.3's rotations (#548) add scopes rather than a column. Mockup 19's route
-- promises a DM, so:
--
--   * **activation requires a live link** — `on_call_assignments_designee_linked` refuses to make
--     active a member with no `linked` identity on the workspace's active Slack connection;
--   * **a designee who becomes unreachable stands down** — when their link is revoked
--     (`chat_identity_links_stand_down`) or they are removed from the workspace, their active
--     assignments are switched off by the database. On-call is then empty rather than a dead end.
--     A connection that goes to `error` or `revoked` touches no assignment: that is the
--     platform's state, re-checked at the next activation.
--
-- **Audit.** The services write the entries (BZ.1 #535 for a link and an unlink, BZ.4 #538 for a
-- reassignment), as V131's commands do. The vocabulary, so every writer uses one:
--
--   chat.identity_linked     subject_type chat_identity_link   detail.chat = {connection_id, …}
--   chat.identity_unlinked   subject_type chat_identity_link
--   chat.on_call_assigned    subject_type on_call_assignment
--
-- **Retention.** Links and assignments are configuration and attribution, not telemetry: in no
-- BQ.3 (#482) class, swept by nothing, gone with their workspace.
--
-- To undo (forward only — for a rehearsal against a copy):
--   alter table ouroboros.chat_commands drop constraint chat_commands_invoker_link_fk;
--   drop trigger chat_identity_links_member_removed on ouroboros.member;
--   drop table ouroboros.on_call_assignments;
--   drop table ouroboros.chat_identity_links;
--   drop function ouroboros.chat_identity_links_member_removed(), ouroboros.chat_identity_links_stand_down(),
--                 ouroboros.chat_identity_links_member_resolve(), ouroboros.chat_identity_links_transition(),
--                 ouroboros.on_call_assignments_designee_linked();

-- ---------------------------------------------------------------------------
-- 1. chat_identity_links — a platform user is a member.
-- ---------------------------------------------------------------------------
create table ouroboros.chat_identity_links (
  id                 uuid        primary key default gen_random_uuid(),

  organization_id    text        not null,
  connection_id      uuid        not null,

  -- The platform's own id for the person (`U024AB`) — what a button press arrives with.
  platform_user_id   text        not null
                                 constraint chat_identity_links_platform_user_id_present
                                   check (platform_user_id ~ '^\S{1,64}$'),

  -- The member this identity acts as. Null while a handshake is pending and its member is not
  -- yet known, and after the member has left the workspace. The key takes no action and is
  -- deferred: chat_identity_links_member_removed revokes the link and clears this itself, and a
  -- workspace's delete removes members and links by different cascade paths.
  member_id          text
                                 constraint chat_identity_links_member_id_fkey
                                   references ouroboros.member ("id") deferrable initially deferred,

  -- The person behind the member, kept when the member row is gone. Set from the member.
  user_id            text        references ouroboros."user" ("id") on delete set null,

  state              text        not null default 'pending'
                                 constraint chat_identity_links_state_known
                                   check (state in ('linked', 'pending', 'revoked')),

  -- How the link was established. A linked row always says.
  verified_via       text
                                 constraint chat_identity_links_verified_via_known
                                   check (verified_via in ('oauth_session', 'email_match_confirmed',
                                                           'admin_assigned')),

  -- The platform's display name, for rendering a system line without a round-trip.
  display_name_cache text
                                 constraint chat_identity_links_display_name_present
                                   check (btrim(display_name_cache) = display_name_cache
                                          and display_name_cache <> ''
                                          and length(display_name_cache) <= 255),

  -- A pending handshake: SHA-256 of its single-use token, and when it stops working.
  link_token_hash    text
                                 constraint chat_identity_links_token_hash_sha256
                                   check (link_token_hash ~ '^[0-9a-f]{64}$'),
  expires_at         timestamptz,

  linked_at          timestamptz,
  revoked_at         timestamptz,
  revoked_by         text        references ouroboros."user" ("id") on delete set null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint chat_identity_links_connection_fk
    foreign key (connection_id, organization_id)
    references ouroboros.chat_connections (id, organization_id) on delete cascade,

  -- The target of chat_commands' connection-scoped foreign key.
  constraint chat_identity_links_id_connection_key unique (id, connection_id),

  -- No path makes a linked row without a member, a verification and a moment.
  constraint chat_identity_links_linked_is_verified
    check (state <> 'linked'
           or (member_id is not null and verified_via is not null and linked_at is not null)),

  -- Pending is exactly "holds a live handshake": a token hash and an expiry, and nothing verified.
  constraint chat_identity_links_pending_handshake
    check (case state
             when 'pending' then link_token_hash is not null and expires_at is not null
                                 and verified_via is null and linked_at is null
             else link_token_hash is null and expires_at is null
           end),

  constraint chat_identity_links_revocation_recorded
    check (case state
             when 'revoked' then revoked_at is not null
             else revoked_at is null and revoked_by is null
           end)
);

-- A platform user is at most one member — and the lookup every interaction makes.
create unique index chat_identity_links_platform_user_key
  on ouroboros.chat_identity_links (connection_id, platform_user_id)
  where state <> 'revoked';

-- A member has at most one identity on a connection.
create unique index chat_identity_links_member_key
  on ouroboros.chat_identity_links (connection_id, member_id)
  where state <> 'revoked' and member_id is not null;

-- The confirmation flow finds a handshake by its token's hash.
create unique index chat_identity_links_token_hash_key
  on ouroboros.chat_identity_links (link_token_hash)
  where link_token_hash is not null;

-- "Is this member linked?" — the on-call rule's read, and the member's removal.
create index chat_identity_links_member_idx
  on ouroboros.chat_identity_links (member_id)
  where member_id is not null;

-- chat_identity_links_member_resolve() — BEFORE INSERT OR UPDATE OF member_id trigger: the
-- member is one of the link's own workspace, and the row remembers the person behind it.
--   returns the row with user_id set from the member; raises class 23 naming the trigger when
--   the member is another workspace's
create function ouroboros.chat_identity_links_member_resolve() returns trigger
language plpgsql
as $$
declare
  person text;
  home   text;
begin
  -- The member's departure nulls member_id; user_id is what is kept, so it is left alone.
  if new.member_id is null then
    return new;
  end if;

  select m."userId", m."organizationId" into person, home
    from ouroboros.member m where m."id" = new.member_id;

  -- A member that does not exist is the foreign key's to refuse, with its own name.
  if not found then
    return new;
  end if;

  if home <> new.organization_id then
    raise exception 'member % belongs to workspace %, not to the link''s workspace %',
      new.member_id, home, new.organization_id
      using errcode = 'foreign_key_violation', constraint = tg_name;
  end if;

  new.user_id := person;
  return new;
end;
$$;

comment on function ouroboros.chat_identity_links_member_resolve() is
  'BEFORE INSERT OR UPDATE OF member_id trigger for chat_identity_links (#533): the member belongs to the link''s own workspace, and user_id is copied from the member so the row still names a person after the member row is deleted. Raises class 23 naming the trigger.';

create trigger chat_identity_links_member_resolve
  before insert or update of member_id, organization_id on ouroboros.chat_identity_links
  for each row execute function ouroboros.chat_identity_links_member_resolve();

-- chat_identity_links_transition() — BEFORE UPDATE trigger: the states a link moves through.
--   returns the row; raises class 23 naming the trigger for a move that is not allowed
create function ouroboros.chat_identity_links_transition() returns trigger
language plpgsql
as $$
begin
  if new.connection_id <> old.connection_id or new.platform_user_id <> old.platform_user_id then
    raise exception 'a link''s connection and platform user never change — revoke it and link again'
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.state = 'revoked' and new.state <> 'revoked' then
    raise exception 'a revoked link is final — linking again is a new row, so the old one keeps its history'
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.state = 'linked' and new.state = 'pending' then
    raise exception 'a linked identity does not go back to pending'
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.state = 'pending' and new.state = 'linked' and old.expires_at <= now() then
    raise exception 'this link handshake expired at % — start a new one', old.expires_at
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.chat_identity_links_transition() is
  'BEFORE UPDATE trigger for chat_identity_links (#533): pending → linked only before the handshake expires; linked never returns to pending; revoked is final; the connection and platform user never change. Raises class 23 naming the trigger.';

create trigger chat_identity_links_transition
  before update on ouroboros.chat_identity_links
  for each row execute function ouroboros.chat_identity_links_transition();

create trigger chat_identity_links_touch_updated_at
  before update on ouroboros.chat_identity_links
  for each row execute function ouroboros.touch_updated_at();

comment on table ouroboros.chat_identity_links is
  'A platform user is a member (#533, BY.3): one row per established or attempted identity on a chat connection. linked always says how (verified_via); pending holds a hashed single-use token and an expiry; revoked is kept, final, and still attributable. Looked up by (connection_id, platform_user_id) among non-revoked rows — one indexed read. Configuration, not telemetry: in no retention class (#482).';
comment on column ouroboros.chat_identity_links.member_id is
  'The member this platform user acts as. Null while a pending handshake does not know it yet, and after the member has left the workspace (the link is revoked first).';
comment on column ouroboros.chat_identity_links.user_id is
  'The person behind the member, copied from it when member_id is set. Kept when the member row is deleted, so commands invoked under a revoked link still name someone.';
comment on column ouroboros.chat_identity_links.state is
  'linked | pending | revoked. pending → linked (before expires_at) or revoked; linked → revoked; revoked is final.';
comment on column ouroboros.chat_identity_links.verified_via is
  'How the link was established: oauth_session (confirmed in an authenticated app session), email_match_confirmed (an email match the person confirmed) or admin_assigned. Never null on a linked row.';
comment on column ouroboros.chat_identity_links.display_name_cache is
  'The platform''s display name at last sight — for the system line "Maya Chen answered", without a platform round-trip. A label, never an identity.';
comment on column ouroboros.chat_identity_links.link_token_hash is
  'SHA-256 (hex) of a pending handshake''s single-use token. Never the token. Cleared when the row leaves pending, which is what makes the token work once.';
comment on index ouroboros.chat_identity_links_platform_user_key is
  'A platform user maps to at most one non-revoked link per connection (#533) — and the single indexed read behind every interaction''s "who is this?".';
comment on index ouroboros.chat_identity_links_member_key is
  'A member has at most one non-revoked identity per connection (#533).';

-- No delete: revocation is a state.
grant select, insert, update on ouroboros.chat_identity_links to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 2. on_call_assignments — the human an escalation DMs.
-- ---------------------------------------------------------------------------
create table ouroboros.on_call_assignments (
  id              uuid        primary key default gen_random_uuid(),

  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The designee. Null only once they have left the workspace — by then the row is inactive.
  -- Deferred and without an action, for chat_identity_links.member_id's reasons.
  member_id       text
                              constraint on_call_assignments_member_id_fkey
                                references ouroboros.member ("id") deferrable initially deferred,

  -- What they are on call for. `decisions` in MVP; CB.3's rotations (#548) add scopes.
  scope           text        not null default 'decisions'
                              constraint on_call_assignments_scope_slug
                                check (scope ~ '^[a-z][a-z0-9_:-]{0,62}$'),

  active          boolean     not null default true,

  assigned_by     text        references ouroboros."user" ("id") on delete set null,
  assigned_at     timestamptz not null default now(),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint on_call_assignments_active_has_member
    check (not active or member_id is not null)
);

-- Exactly one designee in force per (workspace, scope).
create unique index on_call_assignments_one_active
  on ouroboros.on_call_assignments (organization_id, scope)
  where active;

create index on_call_assignments_member_idx
  on ouroboros.on_call_assignments (member_id)
  where member_id is not null;

-- on_call_assignments_designee_linked() — BEFORE INSERT OR UPDATE trigger: an assignment being
-- made active names a member with a linked identity on the workspace's active Slack connection.
--   returns the row; raises class 23 naming the trigger when the designee cannot be DMed
create function ouroboros.on_call_assignments_designee_linked() returns trigger
language plpgsql
as $$
begin
  if not new.active or new.member_id is null then
    return new;
  end if;

  -- Only an activation is checked: an already-active row being edited elsewhere is not re-tried.
  if tg_op = 'UPDATE' and old.active
     and new.member_id = old.member_id and new.organization_id = old.organization_id then
    return new;
  end if;

  if not exists (
       select 1
         from ouroboros.chat_identity_links link
         join ouroboros.chat_connections conn on conn.id = link.connection_id
        where link.member_id = new.member_id
          and link.state = 'linked'
          and conn.organization_id = new.organization_id
          and conn.platform = 'slack'
          and conn.status = 'active') then
    raise exception 'member % has no linked identity on workspace %''s active Slack connection, so an on-call DM could not reach them',
      new.member_id, new.organization_id
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'Link the member''s Slack account first, or connect Slack.';
  end if;

  return new;
end;
$$;

comment on function ouroboros.on_call_assignments_designee_linked() is
  'BEFORE INSERT OR UPDATE trigger for on_call_assignments (#533): an assignment becomes active only for a member with a linked identity on the workspace''s active Slack connection — the DM target is never a dead end. Raises class 23 naming the trigger.';

create trigger on_call_assignments_designee_linked
  before insert or update of active, member_id, organization_id on ouroboros.on_call_assignments
  for each row execute function ouroboros.on_call_assignments_designee_linked();

create trigger on_call_assignments_touch_updated_at
  before update on ouroboros.on_call_assignments
  for each row execute function ouroboros.touch_updated_at();

comment on table ouroboros.on_call_assignments is
  'The designated human escalations DM (#533, BY.3): at most one active assignment per (workspace, scope). Activation requires a linked identity on the workspace''s active Slack connection; a designee whose link is revoked, or who leaves, is stood down by the database. Earlier assignments stay as inactive rows.';
comment on column ouroboros.on_call_assignments.scope is
  'What the designee is on call for — a slug, decisions by default. An open vocabulary: CB.3''s rotations (#548) add scopes without a migration.';
comment on column ouroboros.on_call_assignments.active is
  'Whether this assignment is in force. One per (organization_id, scope) at a time; reassigning is switching one off and adding another.';
comment on index ouroboros.on_call_assignments_one_active is
  'Exactly one on-call designee is in force per (workspace, scope) (#533).';

-- No delete: an assignment that ended is inactive.
grant select, insert, update on ouroboros.on_call_assignments to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 3. Becoming unreachable: a revoked link and a departed member stand the designee down.
-- ---------------------------------------------------------------------------

-- chat_identity_links_stand_down() — AFTER UPDATE OF state trigger: a link that was linked and
-- is now revoked switches off its member's active on-call assignments in that workspace.
--   returns null (an AFTER trigger)
create function ouroboros.chat_identity_links_stand_down() returns trigger
language plpgsql
as $$
begin
  update ouroboros.on_call_assignments a
     set active = false
   where a.organization_id = old.organization_id
     and a.member_id = old.member_id
     and a.active;
  return null;
end;
$$;

comment on function ouroboros.chat_identity_links_stand_down() is
  'AFTER UPDATE trigger for chat_identity_links (#533): when a linked identity is revoked, its member''s active on-call assignments in that workspace are switched off — on-call is left empty rather than pointing at someone a DM cannot reach.';

create trigger chat_identity_links_stand_down
  after update of state on ouroboros.chat_identity_links
  for each row
  when (old.state = 'linked' and new.state = 'revoked' and old.member_id is not null)
  execute function ouroboros.chat_identity_links_stand_down();

-- chat_identity_links_member_removed() — BEFORE DELETE trigger on member: a member leaving a
-- workspace has their identity links revoked and their on-call assignments switched off, and the
-- member pointer cleared on both.
--   returns the member row, so the delete goes ahead
create function ouroboros.chat_identity_links_member_removed() returns trigger
language plpgsql
as $$
begin
  -- The whole workspace is going: its links and assignments leave by their own cascades, and
  -- there is nothing left to keep a revoked row for.
  if not exists (select 1 from ouroboros.organization o where o."id" = old."organizationId") then
    return old;
  end if;

  update ouroboros.on_call_assignments a
     set active = false,
         member_id = null
   where a.member_id = old."id";

  -- Revoked where it was not already, and the pointer cleared on every row: user_id is what
  -- keeps naming the person.
  update ouroboros.chat_identity_links link
     set state = 'revoked',
         revoked_at = coalesce(link.revoked_at, now()),
         link_token_hash = null,
         expires_at = null,
         member_id = null
   where link.member_id = old."id";

  return old;
end;
$$;

comment on function ouroboros.chat_identity_links_member_removed() is
  'BEFORE DELETE trigger on member (#533): a member removed from a workspace has their chat identity links revoked (kept, with user_id still naming the person) and their on-call assignments switched off, and member_id cleared on both — the foreign keys take no action of their own. Does nothing when the workspace itself is being deleted.';

create trigger chat_identity_links_member_removed
  before delete on ouroboros.member
  for each row execute function ouroboros.chat_identity_links_member_removed();

-- ---------------------------------------------------------------------------
-- 4. chat_commands.invoker_link_id — the foreign key V131 left for this migration.
-- ---------------------------------------------------------------------------
alter table ouroboros.chat_commands
  add constraint chat_commands_invoker_link_fk
    foreign key (invoker_link_id, connection_id)
    references ouroboros.chat_identity_links (id, connection_id)
    deferrable initially deferred;

comment on constraint chat_commands_invoker_link_fk on ouroboros.chat_commands is
  'A command''s invoker link is one of its own connection''s (#533). Deferred, so a connection''s delete — which removes commands and links by different cascades — is checked once both are gone; no action, because a link is revoked, never deleted.';
comment on column ouroboros.chat_commands.invoker_link_id is
  'The invoker''s chat identity link (chat_identity_links, #533) — one of this command''s connection''s. Null for an unlinked attempt and for a console invocation. A revoked link stays, so the command stays attributable.';
