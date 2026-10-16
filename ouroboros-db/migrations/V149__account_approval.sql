-- ===========================================================================
-- V149 — account approval: a stranger's account is held until an administrator approves it
-- ===========================================================================
--
-- Until now anybody with a GitHub account could sign in, and `active.organization.ts` gave them a
-- personal workspace on the spot. Account approval (a user request with no issue number, branch
-- `account-approval`) holds a **new** account as `pending` until an *application administrator*
-- — an email listed in `OURO_APP_ADMIN_EMAILS` — approves it. Three things are stored here:
--
--   1. **`"user".account_status`** and three companions saying when, by whom and why it was last
--      decided. `not null default 'approved'`, so every row that exists when this ships — seeded
--      people and every test fixture that inserts a `"user"` row directly — keeps working: those
--      accounts were never strangers. A sign-in that *creates* a user is decided by REST's
--      `databaseHooks.user.create.before` (`auth/account.approval.ts`) and never by this default:
--      an application administrator, then an email with a pending unexpired invitation, then a
--      pre-approved email are approved; everybody else is `pending`.
--
--      The rows found here are back-filled with reason `existing`, so the admin page can say why
--      an account it never decided is approved.
--
--      snake_case beside BetterAuth's camelCase on purpose: REST registers the column as a
--      BetterAuth `user.additionalFields` entry with `fieldName: "account_status"`, so
--      `session.user.accountStatus` reaches the guard without a query, and the column still reads
--      as this service's rather than the library's. The three companions are not BetterAuth
--      fields — only REST's admin routes read or write them.
--
--      **`"user".github_login`** rides along: the admin page names a stranger by their GitHub
--      login, and nothing stored it until now (`account."accountId"` is GitHub's numeric id).
--      It is BetterAuth field `githubLogin`, filled from the provider profile at creation.
--
--   2. **`app_preapproved_emails`** — addresses an administrator has let in ahead of their first
--      sign-in. Deployment-level: keyed by the address alone, with no organization.
--
--   3. **`app_account_events`** — the deployment-level audit of every decision. `audit_events`
--      (V022) needs an `organization_id`, and a held person has none, so these get a trail of
--      their own. Append-only by grant *and* by trigger, V022's two-part posture; there are no
--      foreign keys, so the trigger refuses both update and delete — a person removed later must
--      not take the record of their approval with them.
--
-- There is no row-level security anywhere in this schema; isolation is REST's tenant guard, and
-- these tables belong to no tenant. They are reached only through REST's `/api/v1/admin/*`
-- routes, which only an application administrator passes.
--
-- To undo (forward only — for a rehearsal against a copy):
--   drop table ouroboros.app_account_events; drop function ouroboros.app_account_events_refuse_change();
--   drop table ouroboros.app_preapproved_emails;
--   drop index ouroboros.user_account_status_held_idx;
--   alter table ouroboros."user" drop column github_login, drop column account_status_reason, drop column account_status_changed_by,
--     drop column account_status_changed_at, drop column account_status;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The account's status.
-- ---------------------------------------------------------------------------
alter table ouroboros."user"
  -- `approved` may use the product; `pending` waits for an administrator; `denied` was refused
  -- and stays blocked until somebody approves it after all.
  add column account_status text not null default 'approved'
    constraint user_account_status
      check (account_status in ('approved', 'pending', 'denied')),

  -- When the status was last decided. Null for a row that has only ever held the default.
  add column account_status_changed_at timestamptz,

  -- The administrator who decided it, as their lower-cased email — the identity
  -- OURO_APP_ADMIN_EMAILS names them by. Null for an automatic decision.
  add column account_status_changed_by text
    constraint user_account_status_changed_by_lower
      check (account_status_changed_by = lower(account_status_changed_by)),

  -- Why: the automatic reason (`existing`, `invited`, `preapproved`, `app_admin`, `held`) or the
  -- administrator's action (`approved_by_admin`, `denied_by_admin`). Null for a row inserted
  -- after this migration without a decision — a seed or a fixture taking the default.
  add column account_status_reason text
    constraint user_account_status_reason
      check (account_status_reason in ('existing', 'invited', 'preapproved', 'app_admin',
                                       'held', 'approved_by_admin', 'denied_by_admin')),

  -- The GitHub login the account first signed in with — `octocat`, without the `@` — so the
  -- admin page can say who a stranger is. Captured from the provider profile at creation and
  -- never refreshed (a login can be renamed; this is display only). Null for an account made
  -- any other way, and for every row that predates V149.
  add column github_login text
    constraint user_github_login_length
      check (char_length(github_login) between 1 and 100);

-- A reason must agree with the status it explains: a `pending` account was `held`, a `denied`
-- one was denied by an administrator, and every other reason explains an approval. Null passes,
-- for the undecided default.
alter table ouroboros."user"
  add constraint user_account_status_reason_matches
    check (account_status_reason is null
        or (account_status = 'pending' and account_status_reason = 'held')
        or (account_status = 'denied' and account_status_reason = 'denied_by_admin')
        or (account_status = 'approved'
            and account_status_reason in ('existing', 'invited', 'preapproved', 'app_admin',
                                          'approved_by_admin')));

-- Everybody here when this ships was never a stranger.
update ouroboros."user"
   set account_status_reason = 'existing',
       account_status_changed_at = now();

-- The admin page's two held lists, newest first. Partial, because approved accounts are the
-- overwhelming majority and the page never filters the index to them.
create index user_account_status_held_idx
  on ouroboros."user" (account_status, "createdAt" desc)
  where account_status <> 'approved';

comment on column ouroboros."user".account_status is
  'Account approval: approved (may use the product), pending (held until an application administrator — OURO_APP_ADMIN_EMAILS — approves it) or denied (refused; stays blocked until approved). Default approved, for every row that existed when V149 shipped and every direct insert; a sign-in that creates a user is decided by REST''s user.create.before hook (app admin, pending invitation, pre-approved email, else pending). An app admin is treated as approved whatever this says. Registered as the BetterAuth user field accountStatus.';
comment on column ouroboros."user".account_status_changed_at is
  'When account_status was last decided. Null when it has only ever held the default.';
comment on column ouroboros."user".account_status_changed_by is
  'The application administrator who decided account_status, as their lower-cased email. Null for an automatic decision.';
comment on column ouroboros."user".github_login is
  'The GitHub login at the account''s first sign-in, for the account-approval admin page. Display only — never refreshed, never an identifier (account."accountId" is). Registered as the BetterAuth user field githubLogin. Null for accounts made another way or before V149.';
comment on column ouroboros."user".account_status_reason is
  'Why account_status is what it is: existing, invited, preapproved, app_admin or held (automatic), approved_by_admin or denied_by_admin (an administrator). Must agree with the status (user_account_status_reason_matches); null for an undecided default.';

-- ---------------------------------------------------------------------------
-- 2. Pre-approved addresses.
-- ---------------------------------------------------------------------------
create table ouroboros.app_preapproved_emails (
  -- The address, lower-cased (BetterAuth stores "user".email lower-cased, so the match at
  -- sign-in is exact) and bare: one @, no spaces, no display name.
  email      text        not null primary key
                         constraint app_preapproved_emails_email_format
                           check (email = lower(email) and email ~ '^[^\s@<>]+@[^\s@<>]+$'),

  -- The administrator who added it, as their lower-cased email.
  added_by   text        not null
                         constraint app_preapproved_emails_added_by_lower
                           check (added_by = lower(added_by)),

  created_at timestamptz not null default now(),

  -- Why, in the administrator's words — "starts Monday". Optional.
  note       text
             constraint app_preapproved_emails_note_length
               check (char_length(note) <= 200)
);

comment on table ouroboros.app_preapproved_emails is
  'Account approval: addresses an application administrator let in ahead of their first sign-in. A new account with one of these emails is approved automatically (reason preapproved). Deployment-level — no organization. Written by POST/DELETE /api/v1/admin/preapproved-emails, each audited in app_account_events.';
comment on column ouroboros.app_preapproved_emails.email is
  'The address, lower-cased and bare.';
comment on column ouroboros.app_preapproved_emails.added_by is
  'The application administrator who added it, lower-cased email.';
comment on column ouroboros.app_preapproved_emails.note is
  'Optional, at most 200 characters.';

-- Added and removed by the admin routes; never edited in place.
grant select, insert, delete on ouroboros.app_preapproved_emails to ouroboros_app;

-- ---------------------------------------------------------------------------
-- 3. The deployment-level trail.
-- ---------------------------------------------------------------------------
create table ouroboros.app_account_events (
  id              uuid        primary key default gen_random_uuid(),

  -- When. No updated_at beside it, on V022's argument: an event that can be edited is not one.
  at              timestamptz not null default now(),

  -- The administrator, as their lower-cased email. Null when the system decided — a sign-in
  -- that was held.
  actor_email     text
                  constraint app_account_events_actor_lower
                    check (actor_email = lower(actor_email)),

  -- What happened.
  action          text        not null
                  constraint app_account_events_action
                    check (action in ('held', 'approved', 'denied',
                                      'preapproved_added', 'preapproved_removed')),

  -- The account it happened to — "user".id, deliberately without a foreign key: removing the
  -- person must not remove the record of their approval. Null for a pre-approved address that
  -- has no account yet.
  subject_user_id text,

  -- The address it happened to, kept even after the account is gone.
  subject_email   text        not null,

  -- Anything else worth keeping — the reason, a note, the previous status. An object.
  detail          jsonb       not null default '{}'::jsonb
                  constraint app_account_events_detail_object
                    check (jsonb_typeof(detail) = 'object')
);

create index app_account_events_at_idx on ouroboros.app_account_events (at desc);
create index app_account_events_subject_idx on ouroboros.app_account_events (subject_email, at desc);

comment on table ouroboros.app_account_events is
  'Account approval''s deployment-level audit — audit_events needs an organization and a held person has none. Append-only: the application role holds select and insert only, and a trigger refuses update and delete for every role. held (a sign-in waiting, actor null), approved, denied, preapproved_added, preapproved_removed.';
comment on column ouroboros.app_account_events.actor_email is
  'The application administrator, lower-cased email; null when the system decided.';
comment on column ouroboros.app_account_events.subject_user_id is
  'The account, "user".id — no foreign key, so the record outlives the person. Null for an address with no account.';
comment on column ouroboros.app_account_events.detail is
  'A JSON object: the reason, the previous status, a pre-approval note.';

-- Append-only, part one: the trigger, which a superuser connection (the compose stack, every
-- developer) cannot bypass the way it bypasses grants. Both verbs, because nothing here
-- cascades — V022 had to permit an update for its actor foreign key's set-null; this table has
-- no foreign key to permit.
create function ouroboros.app_account_events_refuse_change() returns trigger
language plpgsql as $$
begin
  raise exception 'app_account_events is append-only: % is refused', tg_op
    using errcode = 'integrity_constraint_violation',
          constraint = 'app_account_events_append_only';
end;
$$;

comment on function ouroboros.app_account_events_refuse_change() is
  'Refuses every UPDATE and DELETE on app_account_events, for every role including the owner (V149). The half of append-only that grants cannot enforce on a superuser connection.';

create trigger app_account_events_append_only
  before update or delete on ouroboros.app_account_events
  for each row execute function ouroboros.app_account_events_refuse_change();

comment on trigger app_account_events_append_only on ouroboros.app_account_events is
  'An account event cannot be revised or removed (V149).';

-- Append-only, part two: the grants. Stated revokes, as V022 states them, so a later blanket
-- grant has to delete these lines to widen what the table allows.
grant select, insert on ouroboros.app_account_events to ouroboros_app;
revoke update, delete on ouroboros.app_account_events from ouroboros_app;
revoke update, delete on ouroboros.app_account_events from public;
