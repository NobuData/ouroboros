-- V022__audit_events.sql — `audit_events`: who did what to which credential, from where,
-- and when. Append-only, and never carrying the thing that was done to.
--
-- Filed as issue #225 (AD.4), the credential audit trail. Needs V005 (#707, `organization`
-- and `"user"`) and V015 (#189, the `provider_connections` rows most of these events are
-- about).
--
-- ---------------------------------------------------------------------------
-- **This table is #26's, landed early.** Scaffolding
-- [#26](https://github.com/NobuData/ouroboros/issues/26) — *[3.8] Audit log table & write
-- path* — is where `audit_events` was first specified, and it is 🟣 v2. AD.4 is 🟢 MVP,
-- because decision **P5** puts credential auditing in v1: a page that reveals and rotates
-- keys while keeping no record of who did it fails its own stated security posture, and
-- *"we'll add audit later"* means the first months of a credential store's history are
-- simply gone.
--
-- Two tables would have been the cheap way out of that ordering, and would have left
-- somebody reconciling `provider_audit` with `audit_events` in v2. So the coordination was
-- made at filing time and is recorded here: **the shape below is #26's**, column for column
-- —
--
--   > `audit_events` (tenant fk, actor user fk nullable, action, subject type/id, jsonb
--   > detail, occurred_at; BRIN index on time), insert-only grant for the application role
--
-- — with exactly one addition AD.4 needs and #26 did not name, `ip`, argued for in its own
-- comment below. When #26 lands it inherits this table and writes `member.added` and
-- `tenant.updated` into it; nothing in that issue has to migrate anything, and there is one
-- audit schema rather than two.
--
-- The two spellings that differ from #26's sketch are both deliberate and both trivial to
-- read: the role is `ouroboros_app` rather than `ouro_app`, following the value
-- `OURO_DB_USER` actually carries and the schema's own name, and the BRIN index is
-- **deliberately not created** — see the index section for why an index nothing reads is a
-- cost rather than a preparation.
--
-- ---------------------------------------------------------------------------
-- The invariant that matters most: no audit event ever contains secret material.
-- ---------------------------------------------------------------------------
--
-- An audit trail that recorded *what a revealed key was* would be the single most dangerous
-- table in this database — a plaintext archive of every credential the vault (V013, #222)
-- exists to keep out of it, indexed by time and actor for convenience.
--
-- Nothing in the shape below can hold one by accident. `action` and `subject_type` are
-- constrained to an identifier grammar; `subject_id` is a row id; `actor_id` is a `"user"`
-- id; `ip` is an `inet`. That leaves `detail`, which is the only free-form column and is
-- therefore the only one a mistake could reach — so the rule is enforced where a mistake
-- would be made rather than here: `ouroboros-rest`'s audit module builds every payload from
-- a closed set of fields, `ouroboros/no-secret-logging` refuses a field whose name says
-- otherwise, and `audit.secrecy.spec.ts` greps the rows a full lifecycle actually writes
-- against the vault's own redaction vocabulary. A CHECK cannot do that job: it would be a
-- pattern match against the shapes of the credentials we happen to know about, which is a
-- test that passes for every provider nobody thought of.
--
-- What the column *is* constrained to is being an object, so the grep has somewhere to
-- stand: `jsonb_typeof(detail) = 'object'` means a reader can enumerate keys rather than
-- discovering that one writer stored a bare string.
--
-- ---------------------------------------------------------------------------
-- Append-only, and what actually enforces it.
-- ---------------------------------------------------------------------------
--
-- An event that can be revised is not an event, and an audit trail whose subject can edit it
-- is theatre. Two mechanisms, because neither covers the other's case:
--
--   * **Grants** — `ouroboros_app` is granted `select` and `insert` on this table and
--     nothing else, and `update`/`delete` are revoked from `public` besides. This is AD.4's
--     acceptance criterion in the words it is written in, and it is the posture a
--     deployment that connects as a non-owner role gets for free.
--
--   * **A trigger, for the case grants cannot cover.** The compose stack and every developer
--     machine connect as `ouroboros`, which is the database's *owner* and a superuser — and
--     a superuser bypasses every grant in the catalogue. A rule that is true in production
--     and false on the machine where the code is written is a rule nobody can test, so
--     `audit_events_no_update` refuses an `update` from any role at all, superusers
--     included.
--
-- **Both of this table's foreign keys are why the trigger is shaped the way it is**, and
-- neither exception is a softening of append-only. A referential action is a statement the
-- database issues on its own behalf, and a trigger that refused them would not be protecting
-- the trail — it would be making the parent rows undeletable.
--
--   * **`organization_id` cascades**, so the trigger covers `update` and not `delete`.
--     Deleting a workspace takes its audit history with it, on the same reasoning
--     `tenant_keys` (V013) cascades: removing a tenant has to actually remove the tenant, and
--     history that outlived the workspace it describes would be a retention surprise rather
--     than an audit trail. A `before delete` trigger would not enforce append-only; it would
--     make workspace deletion fail. Deletion is refused by grant instead, which is where AD.4
--     puts it and where it does not collide with the cascade.
--
--   * **`actor_id` sets null**, which is implemented as an `update` — so the trigger permits
--     exactly that one, and nothing else. See its body: the attribution may be *erased* and
--     no other column may move, so the guarantee is stated precisely rather than
--     approximately — *what happened cannot be rewritten; who did it can be forgotten*. That
--     is a right-to-erasure request answered by the schema rather than by a script.
--
-- ---------------------------------------------------------------------------
-- **Nothing writes this table from SQL** — `ouroboros-rest`'s `AuditService`
-- (`src/modules/audit/`) is the only writer, and `GET /api/v1/providers/audit` the only
-- reader. `R__dev_seed_audit.sql` seeds a development history so the trail sheet has
-- something to render; it is `false` in production like every other seed.
--
-- House snake_case throughout — decision A4. `organization` and `"user"` are referenced by
-- their quoted camelCase `"id"` because those are BetterAuth's columns.

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------
create table ouroboros.audit_events (
  -- Surrogate key. An event has no natural one: two reveals of the same credential by the
  -- same person in the same millisecond are two events, and any key made of the columns
  -- below would collapse them into one.
  --
  -- It is also the page's tiebreaker — see the index — so ordering by it is deterministic
  -- rather than merely usually stable.
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace the event happened in, and the column every read filters on first.
  --
  -- **Cascade.** A workspace's audit trail is that workspace's, and deleting the workspace
  -- deletes it — the same posture V013 takes with its keys. See the header on why this is
  -- also the reason there is no `before delete` trigger.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- **Who did it** — `"user"."id"`, `on delete set null`.
  --
  -- Nullable for two independent reasons, and both of them occur in this trail. Some events
  -- have no person behind them at all: `credential.lease_granted` is a worker being told how
  -- to reach a local provider, authenticated by a service key rather than by a session, and
  -- naming a user there would be inventing one. And a person who leaves has to be
  -- removable without taking the record of what they did with them — which is why this is
  -- `set null` and not `cascade`, on `route_revisions.actor`'s (V021) argument: cascading
  -- would delete the audit trail of everybody who has ever left, which is the opposite of
  -- what an audit trail is for.
  --
  -- Deliberately not additionally constrained to a member of this workspace, on V011's and
  -- V021's argument: membership is revocable, and re-checking it later would make a
  -- historical row unwritable because of somebody's resignation. Whether they were *allowed*
  -- at the time is the endpoint's question (AD.2's role gate), asked when it mattered.
  actor_id        text        references ouroboros."user" ("id") on delete set null,

  -- **What happened** — `provider.revealed`, `credential.lease_granted`, and in v2 the
  -- `member.added` and `tenant.updated` #26 names.
  --
  -- `family.event`, lower snake on both sides, enforced. Plain text rather than an enum per
  -- the house rule — adding an event later must be an ordinary application release and not a
  -- migration — but *not* free text: the whole value of a trail is that
  -- `where action = 'provider.revealed'` finds every reveal, and one writer spelling it
  -- `provider.reveal` or `Provider.Revealed` makes that query quietly wrong rather than
  -- loudly broken. The grammar is the cheapest rule that catches that class of typo without
  -- pinning the vocabulary.
  action          text        not null
                              constraint audit_events_action_grammar
                              check (action ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),

  -- **What it happened to** — the kind of thing, and its id.
  --
  -- Two columns rather than one polymorphic foreign key, which is #26's shape and is the
  -- only shape that works here: the subject of `provider.rotated` is a
  -- `provider_connections` row, the subject of `credential.lease_granted` is a run that this
  -- schema does not own, and the subject of #26's `tenant.updated` is the workspace itself.
  -- No single FK can point at all three, and three nullable FKs would be three columns of
  -- which two are always null.
  --
  -- The cost is real and is accepted knowingly: **there is no referential integrity here,
  -- and there must not be.** An event about a connection has to survive the connection being
  -- deleted — `provider.deleted` is precisely the event whose subject no longer exists — so
  -- a foreign key would make the most important row in the trail the one row that cannot be
  -- written. `subject_type` is what a reader joins on when the row still exists.
  --
  -- Same grammar as `action`'s left-hand side, for the same reason.
  subject_type    text        not null
                              constraint audit_events_subject_type_grammar
                              check (subject_type ~ '^[a-z][a-z0-9_]*$'),

  -- The subject's id, as text — a uuid for a connection, a run id for a lease, an
  -- `organization."id"` for #26's workspace events.
  --
  -- Nullable, because an event can be about a *kind* of thing rather than an instance: a
  -- failed add has no connection id to name, since AD.2 writes nothing to
  -- `provider_connections` unless the provider agreed first. Text rather than uuid so the
  -- column can hold BetterAuth's text ids as well as this schema's uuids.
  subject_id      text,

  -- **Where from** — the client address the operation arrived from.
  --
  -- The one column #26's sketch does not name, and the one AD.4 could not do without: *the
  -- key was revealed at 14:02 by Ken* and *the key was revealed at 14:02 by Ken from an
  -- address nobody at this company has ever used* are different sentences, and the second is
  -- the one an incident is opened on.
  --
  -- `inet` rather than text, for two reasons a text column gives up: it **refuses** the
  -- arbitrary string a forwarded header can carry, so a value in this column is an address
  -- rather than something that was once claimed to be one; and it makes *everything from this
  -- subnet* an operator (`<<`) rather than a `like` against a prefix, which is the query an
  -- investigation actually runs.
  --
  -- What it does **not** do is fold an IPv4-mapped IPv6 address. PostgreSQL keeps
  -- `::ffff:10.0.4.20` distinct from `10.0.4.20`, and `<<` against an IPv4 subnet does not
  -- match the mapped form — so storing what the socket said would split one host across two
  -- spellings and quietly halve the answer to a subnet question. A dual-stack listener reports
  -- every IPv4 client that way, which makes this the normal case rather than the exotic one,
  -- so `ouroboros-rest` unwraps the mapping before it writes: see
  -- `src/modules/audit/audit.context.ts`, which is the only writer and carries the test for it.
  --
  -- Nullable, because an address is not always knowable — a request that arrived over a
  -- socket with no peer address, or through a proxy this deployment has not been told to
  -- trust, has no honest value here, and recording the proxy's own address as the client's
  -- would be worse than recording nothing.
  ip              inet,

  -- **The rest of what happened**, as a document: the step-up method a reveal was satisfied
  -- with, the fields a settings change wrote, whether a rotation succeeded.
  --
  -- The one free-form column, and therefore the one the *no secret material* invariant is
  -- about. See the header: the rule is enforced by the writer and by a grep test over what
  -- the writer actually wrote, because a CHECK could only pattern-match the credential
  -- shapes somebody thought of.
  --
  -- Constrained to an object so a reader can enumerate keys, and defaulted to an empty one
  -- so *there was nothing more to say* is a document rather than a null every reader has to
  -- test for.
  detail          jsonb       not null default '{}'::jsonb
                              constraint audit_events_detail_is_object
                              check (jsonb_typeof(detail) = 'object'),

  -- **When.** No `updated_at` beside it and no touch trigger, on V021's argument: an event
  -- is an event, and one that can be edited is not one. The trigger below makes that
  -- structural rather than conventional.
  occurred_at     timestamptz not null default now()
);

comment on table ouroboros.audit_events is
  'The platform audit trail (#26''s shape, landed early by #225/AD.4): who did what to which subject, from where, and when. Append-only — the application role holds select and insert only, and audit_events_no_update refuses a revision from any role including the owner. Never holds secret material: detail is built from a closed field set by ouroboros-rest''s AuditService and grep-tested against the vault''s redaction vocabulary. Written only by that service; read by GET /api/v1/providers/audit and, in v2, by #26''s own surface.';
comment on column ouroboros.audit_events.organization_id is
  'The workspace the event happened in, and the leading column of every read. ON DELETE CASCADE — a workspace''s trail goes with the workspace, on the same reasoning tenant_keys cascades, and the reason there is no before-delete trigger here.';
comment on column ouroboros.audit_events.actor_id is
  'Who did it — "user".id, ON DELETE SET NULL. Null when nobody did: credential.lease_granted is a worker authenticated by a service key, not a person. Set-null rather than cascade because removing a person must not remove the record of what they did.';
comment on column ouroboros.audit_events.action is
  'What happened, as family.event in lower snake — provider.revealed, credential.lease_granted, #26''s member.added. Text with a grammar CHECK rather than an enum: adding an event is an application release, but a writer that spells it Provider.Revealed makes every filter on the trail quietly wrong.';
comment on column ouroboros.audit_events.subject_type is
  'The kind of thing the event was about — provider_connection, run, organization. Half of a deliberately non-referential subject: an event about a connection must outlive the connection, and provider.deleted is exactly the row a foreign key would make unwritable.';
comment on column ouroboros.audit_events.subject_id is
  'The subject''s id, as text — a uuid here, a BetterAuth text id there. Null when the event names a kind rather than an instance: a refused add has no connection id, because nothing was written.';
comment on column ouroboros.audit_events.ip is
  'The client address the operation arrived from — the column #26 did not name and AD.4 could not do without. inet rather than text: it refuses a string that is not an address, and makes "everything from this subnet" the << operator rather than a prefix match. PostgreSQL does not fold ::ffff:10.0.4.20 into 10.0.4.20, so ouroboros-rest unwraps the mapping before writing; storing what a dual-stack socket said would split one host across two spellings. Null when no address is honestly knowable, which is better than recording a proxy''s.';
comment on column ouroboros.audit_events.detail is
  'The rest of what happened — step-up method, fields written, whether a rotation succeeded. The only free-form column and therefore the only one the no-secret-material invariant is about; enforced by the writer and by a grep test over the rows it writes, because a CHECK can only match the credential shapes somebody thought of. An object by CHECK, so a reader can enumerate keys.';
comment on column ouroboros.audit_events.occurred_at is
  'When it happened. There is no updated_at: an event that can be edited is not one, and audit_events_no_update makes that structural.';
comment on constraint audit_events_action_grammar on ouroboros.audit_events is
  'family.event in lower snake (#225). The cheapest rule that catches a misspelled event name without pinning the vocabulary a later release may extend.';
comment on constraint audit_events_subject_type_grammar on ouroboros.audit_events is
  'Lower snake identifier (#225) — the same rule as action''s left-hand side, for the same reason.';
comment on constraint audit_events_detail_is_object on ouroboros.audit_events is
  'detail is a jsonb object (#225), so the secrecy grep and every reader can enumerate keys rather than discovering that one writer stored a bare string.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- One, and it is the only read this table has: **a workspace's events, newest first**, which
-- is `GET /api/v1/providers/audit` and the first read of any question that starts *who
-- touched this key*. `id` is in the key as the tiebreaker, so two events inside the same
-- millisecond page deterministically rather than swapping places between requests — the same
-- shape, for the same reason, as `route_revisions_organization_created_at_idx` (V021).
--
-- **The endpoint's three filters need no index of their own.** Connection, actor and action
-- all narrow a set that has already entered through this index's leading column, and a
-- workspace's trail is small enough that the remaining work is a filter over a few pages of
-- heap rather than a scan of the table.
--
-- **#26's BRIN on `occurred_at` is deliberately not created here.** It is the right index
-- for a whole-table sweep by time — a retention job deleting everything older than a year —
-- and nothing sweeps this table yet, because nothing prunes it yet. V021's header states the
-- rule this follows: an index nothing reads is still an index every insert maintains. The
-- job that wants it is #26's or a retention ticket's, and adding a BRIN then costs one
-- `create index` against a table whose shape does not change.
-- ---------------------------------------------------------------------------
create index audit_events_organization_occurred_at_idx
  on ouroboros.audit_events (organization_id, occurred_at desc, id desc);

comment on index ouroboros.audit_events_organization_occurred_at_idx is
  'A workspace''s events, newest first (#225) — the trail endpoint''s page and the first read of any "who touched this key" question. id breaks the tie so two events in the same millisecond page deterministically. The endpoint''s connection/actor/action filters narrow a set that has already entered through the leading column.';

-- ---------------------------------------------------------------------------
-- Append-only, part one: the trigger.
--
-- See the header for why both halves exist and why this one covers `update` alone. The
-- function is `audit_events`-specific rather than a general `ouroboros.refuse_update()`,
-- because the message is the useful part: somebody who hits this needs to be told that the
-- table is append-only by design, not that an update was refused.
-- ---------------------------------------------------------------------------
create function ouroboros.audit_events_refuse_update() returns trigger
language plpgsql
as $$
begin
  -- The one update this table permits, and it is not a revision: `actor_id` going from a
  -- person to null, with every other column untouched.
  --
  -- That statement is **the foreign key's own**. `on delete set null` is implemented as an
  -- UPDATE of the child row, so a trigger that refused every update would not be making this
  -- table append-only — it would be making `delete from "user"` fail, and a schema in which a
  -- person cannot be removed because they once revealed a key is not a privacy posture
  -- anybody would choose.
  --
  -- It is narrow on purpose. What may change is the attribution and nothing else, and it may
  -- only ever be *erased*: null to a name is refused, one name to another is refused, and a
  -- payload edited in the same statement is refused whatever happens to the actor. So the
  -- guarantee this table actually makes is stated exactly — *what happened cannot be
  -- rewritten; who did it can be forgotten* — which is what a right-to-erasure request needs
  -- and is all it needs.
  --
  -- The application role cannot reach even this: it holds no `update` grant at all (see the
  -- grants below), so the only writer that can erase an attribution is whoever owns the
  -- schema, deliberately.
  if new.actor_id is null and old.actor_id is not null
     and row(new.id, new.organization_id, new.action, new.subject_type,
             new.subject_id, new.ip, new.detail, new.occurred_at)
         is not distinct from
         row(old.id, old.organization_id, old.action, old.subject_type,
             old.subject_id, old.ip, old.detail, old.occurred_at)
  then
    return new;
  end if;

  raise exception
    'ouroboros.audit_events is append-only: an audit event cannot be revised'
    using errcode = 'restrict_violation',
          detail  = format('refused update of event %s (%s) in organization %s',
                           old.id, old.action, old.organization_id),
          hint    = 'Record a correcting event instead; only actor_id may be cleared, and only by the foreign key''s own set-null. See V022__audit_events.sql (#225).';
end;
$$;

comment on function ouroboros.audit_events_refuse_update() is
  'Refuses every UPDATE on audit_events except clearing actor_id (#225). The half of the append-only posture that grants cannot enforce: the development stack connects as the database owner, and a superuser bypasses every grant — so a rule that only lived in the catalogue would be true in production and false on the machine the code is written on. The one exception is the actor foreign key''s own ON DELETE SET NULL, which is an UPDATE: what happened cannot be rewritten, who did it can be forgotten.';

create trigger audit_events_no_update
  before update on ouroboros.audit_events
  for each row execute function ouroboros.audit_events_refuse_update();

comment on trigger audit_events_no_update on ouroboros.audit_events is
  'An audit event cannot be revised (#225), for any role including the owner — with one exception, the actor foreign key''s own set-null, because erasing an attribution is not revising an event. There is deliberately no delete counterpart: organization_id cascades, and a before-delete trigger would not enforce append-only — it would make deleting a workspace fail.';

-- ---------------------------------------------------------------------------
-- Append-only, part two: the grants.
--
-- `ouroboros_app` is the role a deployment that separates *migrating* from *running* should
-- connect the API as — Flyway owns the schema, the application reads and writes rows. This
-- migration creates it if it is absent, so the grant below has a grantee in every
-- environment, and grants it **nothing but** `select` and `insert` on this table.
--
-- Creating a role from a migration is unusual enough to say why rather than to leave the
-- reader to guess: the alternative is a grant against a role that may not exist, which fails
-- the migration on a fresh database. Guarded with a catalogue lookup rather than with an
-- exception handler, matching V000's `create schema` guard — a role is cluster-wide, so on a
-- cluster hosting a second Ouroboros database it is already there, and that must be an
-- ordinary no-op rather than a warning.
--
-- It is created `nologin` and with no password. This migration decides what the role *may
-- do*, and it must not be the thing that decides whether it can be connected as: an operator
-- who wants to use it grants `login` and a credential themselves, deliberately, and an
-- operator who does not is left with a role nobody can authenticate as.
--
-- The MVP's compose stack still connects as `ouroboros` — see the header on the trigger that
-- makes append-only true there too.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ouroboros_app') then
    execute 'create role ouroboros_app nologin';
  end if;
end
$$;

comment on role ouroboros_app is
  'The role ouroboros-rest connects as where a deployment separates migrating from running (#225). Created NOLOGIN and unprivileged: what it may do is decided by grants in migrations, whether it may connect is the operator''s decision. Holds select and insert on audit_events and nothing else — the append-only posture AD.4 specifies.';

grant usage on schema ouroboros to ouroboros_app;
grant select, insert on ouroboros.audit_events to ouroboros_app;

-- Stated rather than assumed. `create table` grants nothing to anybody but the owner, so
-- both of these are no-ops today — and that is exactly why they are written: a later
-- migration that grants the role a table-wide `all privileges` should have to delete these
-- two lines to do it, rather than silently widening what this table allows.
revoke update, delete on ouroboros.audit_events from ouroboros_app;
revoke update, delete on ouroboros.audit_events from public;
