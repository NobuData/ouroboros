-- V107__copilot_sessions_messages.sql — the Workflow Copilot's conversation as a durable record:
-- sessions bound to the draft they edit, and the ordered messages of each — bubbles, the choice
-- questions with their answers, and the tool activity behind every reply (#555, CC.1).
--
-- Mockup 20's conversation card is six messages:
--
--   Ken      "security patches: always a second model's review, never auto-merge, prove the CVE
--             is actually fixed"
--   Copilot  drafted security-patch · explains the invented exploit-verify stage
--            ① what triggers it?  (label:security ✓) (CVE pattern in title)
--            ② may it read the GitHub Advisory DB?  (Yes ✓) (No)
--   Ken      "label security. yes. also cap spend at $5 a run."
--   Copilot  added the spend guard · proposes a dry run on #489
--   Ken      dry run #489
--   Copilot  "2m 41s, $0.31, zero side effects — two improvement suggestions below the results →"
--
-- A conversation that writes production workflows is an audit record: the DSL says *what* the
-- workflow does, this transcript says *why*, and which of it the human explicitly agreed to. So:
--
--   1. **`copilot_sessions`** — one conversation, bound to the workflow whose shared draft it
--      edits (WF-P.3). `status` is `active | promoted | discarded`; closing never deletes the
--      transcript. `model_provenance` is the resolved alias per exchange (Z.1), the head's
--      model pill. `draft_name` is the `draft: security-patch` tag.
--   2. **`copilot_messages`** — the exchange, ordered by `seq`. `choices` holds the `ask_user`
--      questions as data (prompt, options, `selected`, `answered_at`) so the answered ✓ state
--      is recoverable; `tool_trace` holds the operations proposed / applied / bounced (with the
--      validator's message), the reads performed and the dry runs proposed; `tokens_in`,
--      `tokens_out` and `cost_cents` are per exchange, and `cost_cents` is **null** when the
--      exchange was not priced — never a fabricated zero.
--
-- ---------------------------------------------------------------------------
-- One active session per draft
-- ---------------------------------------------------------------------------
--
-- Two conversations editing one draft through typed operations would interleave revisions with
-- no coherent provenance. `copilot_sessions_one_active` is a partial unique index on
-- `(workflow_id) where status = 'active'`, so the rule is the database's, and a retry that
-- races past a service's check is refused all the same. tests/verify-copilot-sessions.sh races
-- two inserts to prove it, and shows that without the index both get through.
--
-- ---------------------------------------------------------------------------
-- Why `seq` is drawn from the session row
-- ---------------------------------------------------------------------------
--
-- A streamed reply must persist in a deterministic place, and history pagination
-- (`where seq < $cursor order by seq desc`) must not miss a message that commits after the page
-- was read. Both need `seq` to be handed out in commit order, which `max + 1` does not do.
--
-- So `copilot_sessions.last_seq` is the session's counter, and `copilot_messages_allocate_seq()`
-- bumps it inside the appending transaction:
--
--   - **Concurrent appends serialise** on the session row's lock — the second waits for the
--     first to commit or roll back. So a reader that has seen `seq = n` committed has seen every
--     message below it: a page boundary never moves under a concurrent append.
--   - **A rollback leaves no gap**: the bump is part of the transaction.
--   - **`seq` only rises**: the counter never moves back, and a supplied `seq` is refused —
--     the allocator is the only author of the order.
--   - **A closed session takes no new messages**: the same row lock reads the status, so an
--     append cannot slip in beside a promote.
--
-- The application role cannot write `last_seq` (column grants below); the allocator runs as the
-- owner, V106's argument for `investigations_allocate_seq()`.
--
-- ---------------------------------------------------------------------------
-- Retention — the chat class
-- ---------------------------------------------------------------------------
--
-- Both tables belong to the retention plane (BQ.3, #482) as two `custom:*` classes, which
-- `retention_policies` stores without a schema change:
--
--   class                          what it governs
--   ----------------------------   ----------------------------------------------------------
--   custom:copilot-chat            a discarded session and its messages
--   custom:copilot-chat-promoted   a promoted session and its messages — it explains a
--                                  published workflow, so it is kept at least as long
--
-- `copilot_sessions_sweep()` is the sweep's one write, and the application role has no `delete`
-- on either table. It removes closed sessions (messages cascade) whose `closed_at` is before the
-- class's cutoff, and a promoted transcript's cutoff is never later than the chat cutoff — so a
-- promoted transcript cannot be swept before a discarded one would be, whatever the tiers say.
-- An `active` session is never swept: it is the conversation a draft is being edited in.
--
-- Revert forward:
--   drop table ouroboros.copilot_messages, ouroboros.copilot_sessions;
--   then drop every function this file creates.

-- ---------------------------------------------------------------------------
-- Shape helpers. Immutable, so the CHECKs below can call them; plpgsql with early returns, for
-- V106's reason — a wrong-typed value must come back `false` so the CHECK names itself.
-- ---------------------------------------------------------------------------

-- jsonb_nonblank_string(value) — whether a jsonb value is a string with something in it.
--   value — the jsonb value to inspect (may be null)
--   returns true for a string that is not empty or whitespace; false for anything else
create function ouroboros.jsonb_nonblank_string(value jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(value) = 'string' and btrim(value #>> '{}') <> '', false);
$$;

comment on function ouroboros.jsonb_nonblank_string(jsonb) is
  'True when a jsonb value is a string that is not blank (#555). Null and every other type are false.';

-- copilot_model_provenance_valid(provenance) — whether a session's model provenance is an array
-- of {seq, alias, model_id}, one per priced exchange, in strictly rising seq order.
--   provenance — the jsonb value to inspect
--   returns true when well-formed (the empty array included)
create function ouroboros.copilot_model_provenance_valid(provenance jsonb)
returns boolean language plpgsql immutable as $$
declare
  entry    jsonb;
  previous bigint := 0;
begin
  if jsonb_typeof(provenance) is distinct from 'array' then
    return false;
  end if;
  for entry in select e from jsonb_array_elements(provenance) e loop
    if not (ouroboros.jsonb_keys_are(entry, array['seq', 'alias', 'model_id'])
            and ouroboros.jsonb_nonneg_int(entry -> 'seq')
            and ouroboros.jsonb_nonblank_string(entry -> 'alias')
            and ouroboros.jsonb_nonblank_string(entry -> 'model_id')) then
      return false;
    end if;
    if (entry ->> 'seq')::bigint <= previous then
      return false;
    end if;
    previous := (entry ->> 'seq')::bigint;
  end loop;
  return true;
end;
$$;

comment on function ouroboros.copilot_model_provenance_valid(jsonb) is
  'True when a value is a JSON array of exactly {seq, alias, model_id} — seq a positive integer, strictly rising; alias and model_id non-blank strings (#555).';

-- copilot_choices_valid(choices) — whether a message's choice questions have the shape the chip
-- rows render: a non-empty array of exactly {prompt, options, selected, answered_at}, where
-- options are two or more distinct non-blank strings, and selected and answered_at are either
-- both null (unanswered) or an option and an ISO-8601 timestamp (answered).
--   choices — the jsonb value to inspect
--   returns true when well-formed
create function ouroboros.copilot_choices_valid(choices jsonb)
returns boolean language plpgsql immutable as $$
declare
  question jsonb;
begin
  if jsonb_typeof(choices) is distinct from 'array' or jsonb_array_length(choices) = 0 then
    return false;
  end if;
  for question in select q from jsonb_array_elements(choices) q loop
    if not (ouroboros.jsonb_keys_are(question, array['prompt', 'options', 'selected', 'answered_at'])
            and ouroboros.jsonb_nonblank_string(question -> 'prompt')
            and jsonb_typeof(question -> 'options') = 'array') then
      return false;
    end if;
    if jsonb_array_length(question -> 'options') < 2
       or exists (select 1 from jsonb_array_elements(question -> 'options') o
                   where not ouroboros.jsonb_nonblank_string(o))
       or (select count(*) <> count(distinct o) from jsonb_array_elements(question -> 'options') o) then
      return false;
    end if;
    if jsonb_typeof(question -> 'selected') = 'null' and jsonb_typeof(question -> 'answered_at') = 'null' then
      continue;
    end if;
    if not (jsonb_typeof(question -> 'selected') = 'string'
            and question -> 'options' @> jsonb_build_array(question -> 'selected')
            and jsonb_typeof(question -> 'answered_at') = 'string'
            and (question ->> 'answered_at')
                  ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$') then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function ouroboros.copilot_choices_valid(jsonb) is
  'True when a value is a non-empty JSON array of ask_user questions, each exactly {prompt, options, selected, answered_at}: options two or more distinct non-blank strings; selected and answered_at both null, or one of the options and an ISO-8601 timestamp (#555).';

-- copilot_choices_questions(choices) — a choices value with every answer blanked out: what the
-- copilot asked, without what the human chose. Two values with equal questions differ at most in
-- their answers.
--   choices — a jsonb array of questions (anything else is returned as it is)
--   returns the same array with selected and answered_at set to null in every question
create function ouroboros.copilot_choices_questions(choices jsonb)
returns jsonb language sql immutable as $$
  select case when jsonb_typeof(choices) = 'array' then
           coalesce((select jsonb_agg(case when jsonb_typeof(q) = 'object'
                                           then q || '{"selected": null, "answered_at": null}'
                                           else q end order by i)
                       from jsonb_array_elements(choices) with ordinality as x(q, i)), '[]')
         else choices end;
$$;

comment on function ouroboros.copilot_choices_questions(jsonb) is
  'The choices value with selected and answered_at nulled in every question — the questions without their answers (#555).';

-- copilot_tool_trace_valid(trace) — whether a message's tool trace is exactly
-- {operations, reads, dry_run_proposals}, each an array:
--   operations         — {op: {kind, …}, outcome: proposed|applied|bounced, validator_message?};
--                        validator_message is a non-blank string on a bounce and absent otherwise
--   reads              — {tool, …}: one read the copilot performed (catalog, skills, the draft)
--   dry_run_proposals  — {ticket, …}: a dry run the copilot offered, e.g. {"ticket": "#489"}
--   trace — the jsonb value to inspect
--   returns true when well-formed (every array may be empty)
create function ouroboros.copilot_tool_trace_valid(trace jsonb)
returns boolean language plpgsql immutable as $$
declare
  item jsonb;
begin
  if not ouroboros.jsonb_keys_are(trace, array['operations', 'reads', 'dry_run_proposals'])
     or jsonb_typeof(trace -> 'operations') <> 'array'
     or jsonb_typeof(trace -> 'reads') <> 'array'
     or jsonb_typeof(trace -> 'dry_run_proposals') <> 'array' then
    return false;
  end if;

  for item in select e from jsonb_array_elements(trace -> 'operations') e loop
    if jsonb_typeof(item) <> 'object' then
      return false;
    end if;
    if exists (select 1 from jsonb_object_keys(item) k
                where k not in ('op', 'outcome', 'validator_message'))
       or jsonb_typeof(item -> 'op') is distinct from 'object'
       or not ouroboros.jsonb_nonblank_string(item -> 'op' -> 'kind')
       or jsonb_typeof(item -> 'outcome') is distinct from 'string'
       or item ->> 'outcome' not in ('proposed', 'applied', 'bounced') then
      return false;
    end if;
    if (item ->> 'outcome' = 'bounced') <> ouroboros.jsonb_nonblank_string(item -> 'validator_message')
       or (item ->> 'outcome' <> 'bounced' and item ? 'validator_message') then
      return false;
    end if;
  end loop;

  for item in select e from jsonb_array_elements(trace -> 'reads') e loop
    if not ouroboros.jsonb_nonblank_string(item -> 'tool') then
      return false;
    end if;
  end loop;

  for item in select e from jsonb_array_elements(trace -> 'dry_run_proposals') e loop
    if not ouroboros.jsonb_nonblank_string(item -> 'ticket') then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

comment on function ouroboros.copilot_tool_trace_valid(jsonb) is
  'True when a value is exactly {operations, reads, dry_run_proposals} of arrays (#555): each operation {op: {kind, …}, outcome proposed|applied|bounced, validator_message — non-blank on a bounce, absent otherwise}; each read {tool, …}; each dry-run proposal {ticket, …}.';

-- ---------------------------------------------------------------------------
-- copilot_sessions — one conversation, bound to the draft it edits.
-- ---------------------------------------------------------------------------
create table ouroboros.copilot_sessions (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, as everything a workspace owns.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The workflow whose shared draft (WF-P.3) this conversation edits — of this workspace, by
  -- the composite key below. Cascade: the transcript explains that workflow and goes with it.
  workflow_id      uuid        not null,

  -- active while the conversation edits the draft; promoted when the draft was published from
  -- it; discarded when the draft was thrown away. Closing never deletes the transcript.
  status           text        not null default 'active'
                               constraint copilot_sessions_status
                                 check (status in ('active', 'promoted', 'discarded')),

  -- The resolved alias per exchange (Z.1) — the head's model pill. Appended to, never rewritten
  -- (copilot_sessions_transition).
  model_provenance jsonb       not null default '[]'
                               constraint copilot_sessions_model_provenance_shape
                                 check (ouroboros.copilot_model_provenance_valid(model_provenance)),

  -- The `draft: security-patch` tag. The workflow slug grammar, so the tag and the slug it
  -- usually matches are spelt alike.
  draft_name       text        not null
                               constraint copilot_sessions_draft_name_format
                                 check (draft_name ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(draft_name) <= 64),

  -- Who started the conversation. Set null if the person is removed; the transcript stays.
  created_by       text        references ouroboros."user" ("id") on delete set null,

  created_at       timestamptz not null default now(),

  -- When the session was promoted or discarded. Null exactly while it is active.
  closed_at        timestamptz,

  -- The highest message seq handed out — the next is last_seq + 1. Written only by
  -- copilot_messages_allocate_seq(); see the header.
  last_seq         integer     not null default 0
                               constraint copilot_sessions_last_seq_nonnegative
                                 check (last_seq >= 0),

  constraint copilot_sessions_workflow_fk
    foreign key (workflow_id, organization_id)
    references ouroboros.workflows (id, organization_id) on delete cascade,

  constraint copilot_sessions_closed_when_not_active
    check ((status = 'active') = (closed_at is null)),

  constraint copilot_sessions_closed_after_created
    check (closed_at is null or closed_at >= created_at),

  -- The target of copilot_messages' composite key: a message only ever belongs to a session of
  -- its own workspace.
  constraint copilot_sessions_id_organization_key unique (id, organization_id)
);

comment on table ouroboros.copilot_sessions is
  'One Workflow Copilot conversation (#555, CC.1), bound to the workflow whose shared draft it edits. At most one active session per workflow (copilot_sessions_one_active). Promoting or discarding closes it without deleting the transcript. Retention: custom:copilot-chat when discarded, custom:copilot-chat-promoted when promoted, through copilot_sessions_sweep().';
comment on column ouroboros.copilot_sessions.workflow_id is
  'The workflow whose shared draft this conversation edits (WF-P.3), of the same workspace.';
comment on column ouroboros.copilot_sessions.status is
  'active | promoted | discarded. Only active → promoted and active → discarded; both are terminal.';
comment on column ouroboros.copilot_sessions.model_provenance is
  'The resolved alias per exchange (Z.1): [{seq, alias, model_id}], seq rising. Appended to, never rewritten — the head''s model pill reads the last entry.';
comment on column ouroboros.copilot_sessions.draft_name is
  'The draft tag the conversation card shows — draft: security-patch.';
comment on column ouroboros.copilot_sessions.closed_at is
  'When the session was promoted or discarded; null exactly while active. The retention sweep cuts on it.';
comment on column ouroboros.copilot_sessions.last_seq is
  'The highest copilot_messages.seq handed out in this session. Written only by copilot_messages_allocate_seq().';

-- One active conversation per draft — the acceptance criterion, at the database.
create unique index copilot_sessions_one_active
  on ouroboros.copilot_sessions (workflow_id)
  where status = 'active';

comment on index ouroboros.copilot_sessions_one_active is
  'At most one active copilot session per workflow draft (#555): two conversations cannot interleave revisions on one draft.';

-- A workflow's conversation history, newest first; the workspace's own index leads with it so
-- every read is org-scoped.
create index copilot_sessions_organization_workflow_idx
  on ouroboros.copilot_sessions (organization_id, workflow_id, created_at desc);

-- The retention sweep: closed sessions by when they closed.
create index copilot_sessions_closed_idx
  on ouroboros.copilot_sessions (organization_id, closed_at)
  where status <> 'active';

-- --- identity and lifecycle on update ----------------------------------------
create function ouroboros.copilot_sessions_transition()
returns trigger language plpgsql as $$
begin
  if new.organization_id <> old.organization_id or new.workflow_id <> old.workflow_id
     or new.created_at <> old.created_at
     or (new.created_by is distinct from old.created_by and new.created_by is not null) then
    raise exception 'copilot session % keeps its workspace, workflow, author and start', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.status <> old.status and not (old.status = 'active' and new.status in ('promoted', 'discarded')) then
    raise exception 'copilot session % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.status = old.status and new.closed_at is distinct from old.closed_at then
    raise exception 'copilot session % keeps when it closed', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.last_seq < old.last_seq then
    raise exception 'copilot session % cannot move its message counter back', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- Provenance is appended to: every entry already recorded stays as it was, in place. A
  -- malformed value is the shape CHECK's to refuse, by name.
  if ouroboros.copilot_model_provenance_valid(new.model_provenance)
     and (jsonb_array_length(new.model_provenance) < jsonb_array_length(old.model_provenance)
          or exists (select 1 from jsonb_array_elements(old.model_provenance) with ordinality o(e, i)
                      where new.model_provenance -> (i::int - 1) is distinct from o.e)) then
    raise exception 'copilot session % model provenance is appended to, never rewritten', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.copilot_sessions_transition() is
  'Refuses a session update outside active → promoted | discarded, a change of workspace, workflow, start or author (other than the user FK''s set-null), a moved closed_at, a counter moving back, or a rewrite of recorded model provenance (#555).';

create trigger copilot_sessions_transition
  before update on ouroboros.copilot_sessions
  for each row execute function ouroboros.copilot_sessions_transition();

-- ---------------------------------------------------------------------------
-- copilot_messages — the exchange, in order.
-- ---------------------------------------------------------------------------
create table ouroboros.copilot_messages (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace, carried so every read is org-scoped without a join, and held to the
  -- session's own by the composite key below.
  organization_id text        not null,

  session_id      uuid        not null,

  -- The message's place in its session: 1, 2, 3, … in commit order. Allocated by
  -- copilot_messages_allocate_seq(); a supplied value is refused.
  seq             integer     not null
                              constraint copilot_messages_seq_positive check (seq >= 1),

  -- Who spoke: the person (right-aligned bubble) or the copilot.
  role            text        not null
                              constraint copilot_messages_role
                                check (role in ('user', 'copilot')),

  -- The bubble's text. Empty only while a reply is still streaming or was interrupted.
  body            text        not null default '',

  -- The ask_user questions this reply carried — the chip rows. See copilot_choices_valid().
  choices         jsonb
                              constraint copilot_messages_choices_shape
                                check (choices is null or ouroboros.copilot_choices_valid(choices)),

  -- The tool activity behind this reply. See copilot_tool_trace_valid().
  tool_trace      jsonb       not null default '{"operations": [], "reads": [], "dry_run_proposals": []}'
                              constraint copilot_messages_tool_trace_shape
                                check (ouroboros.copilot_tool_trace_valid(tool_trace)),

  -- What the exchange consumed and cost. Null when it was not metered or not priced: an
  -- unpriced exchange is null, never a fabricated 0.
  tokens_in       integer     constraint copilot_messages_tokens_in_nonnegative
                                check (tokens_in >= 0),
  tokens_out      integer     constraint copilot_messages_tokens_out_nonnegative
                                check (tokens_out >= 0),
  cost_cents      integer     constraint copilot_messages_cost_nonnegative
                                check (cost_cents >= 0),

  -- streaming while a reply is being written; complete once it is; interrupted when the stream
  -- ended early and what arrived is all there is.
  status          text        not null default 'complete'
                              constraint copilot_messages_status
                                check (status in ('streaming', 'complete', 'interrupted')),

  created_at      timestamptz not null default now(),

  constraint copilot_messages_session_fk
    foreign key (session_id, organization_id)
    references ouroboros.copilot_sessions (id, organization_id) on delete cascade,

  -- Ordered and unique per session; also the pagination index (`seq < $cursor order by seq desc`).
  constraint copilot_messages_session_seq_key unique (session_id, seq),

  -- A finished bubble says something.
  constraint copilot_messages_body_when_complete
    check (status <> 'complete' or btrim(body) <> ''),

  -- What a person types arrives whole: no streaming, no questions, no tools, no tokens, no cost.
  constraint copilot_messages_user_plain
    check (role <> 'user'
           or (status = 'complete' and choices is null
               and tool_trace = '{"operations": [], "reads": [], "dry_run_proposals": []}'
               and tokens_in is null and tokens_out is null and cost_cents is null)),

  -- Token counts are metered together.
  constraint copilot_messages_tokens_paired
    check ((tokens_in is null) = (tokens_out is null)),

  -- A cost on an exchange nothing was metered for is a fabricated cost.
  constraint copilot_messages_cost_metered
    check (cost_cents is null or tokens_in is not null)
);

comment on table ouroboros.copilot_messages is
  'The messages of a copilot session in order (#555, CC.1): bubbles, ask_user choice questions with their answers, and the tool trace behind each reply. seq is allocated in commit order per session. Retention follows the session (copilot_sessions_sweep()).';
comment on column ouroboros.copilot_messages.seq is
  'The message''s place in its session, from 1 — monotonic in commit order, never supplied, so history pagination is stable under concurrent appends.';
comment on column ouroboros.copilot_messages.role is
  'user | copilot.';
comment on column ouroboros.copilot_messages.choices is
  'The ask_user questions this reply carried: [{prompt, options, selected, answered_at}]. Copilot replies only. Once the reply is no longer streaming the questions are frozen and each may be answered once.';
comment on column ouroboros.copilot_messages.tool_trace is
  '{operations: [{op, outcome proposed|applied|bounced, validator_message on a bounce}], reads: [{tool, …}], dry_run_proposals: [{ticket, …}]} — how this reply came to be. Frozen once the reply is no longer streaming.';
comment on column ouroboros.copilot_messages.tokens_in is
  'Prompt tokens of this exchange; null when not metered (and always for a user message).';
comment on column ouroboros.copilot_messages.tokens_out is
  'Completion tokens of this exchange; null when not metered (and always for a user message).';
comment on column ouroboros.copilot_messages.cost_cents is
  'What this exchange cost, in cents. Null when it was not priced — never a fabricated 0 — and only ever set on a metered exchange (copilot_messages_cost_metered).';
comment on column ouroboros.copilot_messages.status is
  'streaming | complete | interrupted. streaming → complete | interrupted only; a user message is always complete.';

-- --- seq allocation ----------------------------------------------------------
--
-- The session row is the lock: a second append to the same session waits here until the first
-- commits or rolls back. `security definer` because the application role cannot write
-- `last_seq`; the search_path is pinned, every name is qualified, and `execute` is revoked from
-- public below.
create function ouroboros.copilot_messages_allocate_seq()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  session_status text;
begin
  if new.seq is not null then
    raise exception 'a copilot message''s seq is allocated, not supplied'
      using errcode = 'check_violation', constraint = 'copilot_messages_seq_allocated';
  end if;

  update ouroboros.copilot_sessions
     set last_seq = last_seq + 1
   where id = new.session_id and organization_id = new.organization_id
  returning last_seq, status into new.seq, session_status;

  if not found then
    raise exception 'copilot session % does not exist in workspace %', new.session_id, new.organization_id
      using errcode = 'foreign_key_violation', constraint = 'copilot_messages_session_fk';
  end if;

  if session_status <> 'active' then
    raise exception 'copilot session % is %, and takes no new messages', new.session_id, session_status
      using errcode = 'check_violation', constraint = 'copilot_messages_session_active';
  end if;

  return new;
end;
$$;

comment on function ouroboros.copilot_messages_allocate_seq() is
  'Assigns copilot_messages.seq from its session''s last_seq (#555) — serialised on the session row, so concurrent appends commit in seq order and a rollback leaves no gap. Refuses a supplied seq, an unknown session and a closed one.';

create trigger copilot_messages_allocate_seq
  before insert on ouroboros.copilot_messages
  for each row execute function ouroboros.copilot_messages_allocate_seq();

revoke execute on function ouroboros.copilot_messages_allocate_seq() from public;

-- --- identity, streaming and answers on update ---------------------------------
create function ouroboros.copilot_messages_transition()
returns trigger language plpgsql as $$
begin
  if new.organization_id <> old.organization_id or new.session_id <> old.session_id
     or new.seq <> old.seq or new.role <> old.role or new.created_at <> old.created_at then
    raise exception 'copilot message % keeps its session, place, role and time', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.status <> old.status and not (old.status = 'streaming' and new.status in ('complete', 'interrupted')) then
    raise exception 'copilot message % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- Measurements are recorded once: a token count or cost may arrive late, but never change.
  if (old.tokens_in is not null and new.tokens_in is distinct from old.tokens_in)
     or (old.tokens_out is not null and new.tokens_out is distinct from old.tokens_out)
     or (old.cost_cents is not null and new.cost_cents is distinct from old.cost_cents) then
    raise exception 'copilot message % keeps the tokens and cost it recorded', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- While a reply streams it is still being written. After that, what it said and did is the
  -- record: only its questions may be answered.
  if old.status <> 'streaming' then
    if new.body <> old.body or new.tool_trace <> old.tool_trace then
      raise exception 'copilot message % is %; its text and tool trace are final', old.id, old.status
        using errcode = 'check_violation', constraint = tg_name;
    end if;

    if new.choices is distinct from old.choices then
      -- A malformed value is the shape CHECK's to refuse, by name.
      if new.choices is not null and not ouroboros.copilot_choices_valid(new.choices) then
        return new;
      end if;
      if new.choices is null or old.choices is null
         or ouroboros.copilot_choices_questions(new.choices)
              is distinct from ouroboros.copilot_choices_questions(old.choices)
         or exists (select 1 from jsonb_array_elements(old.choices) with ordinality o(q, i)
                     where jsonb_typeof(o.q -> 'selected') <> 'null'
                       and new.choices -> (i::int - 1) is distinct from o.q) then
        raise exception 'copilot message % may only answer its open questions, each once', old.id
          using errcode = 'check_violation', constraint = tg_name;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function ouroboros.copilot_messages_transition() is
  'Refuses a message update that changes its session, seq, role or time; moves status other than streaming → complete | interrupted; alters a recorded token count or cost; or, once the message is no longer streaming, changes its body or tool trace, its questions, or an answer already given (#555).';

create trigger copilot_messages_transition
  before update on ouroboros.copilot_messages
  for each row execute function ouroboros.copilot_messages_transition();

-- ---------------------------------------------------------------------------
-- The retention sweep — the chat class's one write.
-- ---------------------------------------------------------------------------

-- copilot_sessions_sweep(organization_id, chat_cutoff, promoted_cutoff, limit) — remove a
-- workspace's closed copilot sessions past their class's cutoff, with their messages.
--   p_organization_id — the workspace
--   p_chat_cutoff     — RetentionPolicyService's cutoff for custom:copilot-chat (discarded)
--   p_promoted_cutoff — its cutoff for custom:copilot-chat-promoted; a promoted session is cut
--                       at the earlier of the two, so it is never swept before a discarded one
--   p_limit           — the most sessions to remove in one call, oldest first
--   returns (sessions, messages) removed
create function ouroboros.copilot_sessions_sweep(p_organization_id text, p_chat_cutoff timestamptz,
                                                 p_promoted_cutoff timestamptz, p_limit integer)
returns table (sessions integer, messages integer)
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  doomed uuid[];
begin
  -- The custom-class floor, beneath the service: no cutoff may reach inside the last seven days.
  if p_chat_cutoff > now() - interval '7 days' or p_promoted_cutoff > now() - interval '7 days' then
    raise exception 'a copilot chat cutoff of % / % is inside the 7-day retention floor',
      p_chat_cutoff, p_promoted_cutoff
      using errcode = 'check_violation',
            constraint = 'copilot_sessions_sweep_cutoff_floor',
            hint = 'The cutoffs are RetentionPolicyService''s now() - days for custom:copilot-chat and custom:copilot-chat-promoted, and a custom tier is at least 7 days (#482).';
  end if;

  if p_limit is null or p_limit < 1 then
    raise exception 'a copilot chat sweep removes at least one session per call, not %', p_limit
      using errcode = 'check_violation', constraint = 'copilot_sessions_sweep_limit';
  end if;

  select coalesce(array_agg(s.id), '{}')
    into doomed
    from (select session.id
            from ouroboros.copilot_sessions session
           where session.organization_id = p_organization_id
             and session.status <> 'active'
             and session.closed_at < case session.status
                                       when 'promoted' then least(p_promoted_cutoff, p_chat_cutoff)
                                       else p_chat_cutoff
                                     end
           order by session.closed_at
           limit p_limit
             for update skip locked) s;

  messages := (select count(*) from ouroboros.copilot_messages m where m.session_id = any (doomed));
  delete from ouroboros.copilot_sessions where id = any (doomed);
  sessions := cardinality(doomed);
  return next;
end;
$$;

comment on function ouroboros.copilot_sessions_sweep(text, timestamptz, timestamptz, integer) is
  'The copilot chat retention sweep''s one write (#555): removes at most p_limit of the workspace''s closed sessions (and their messages), oldest first — discarded ones closed before p_chat_cutoff, promoted ones closed before the earlier of p_promoted_cutoff and p_chat_cutoff. Never an active session. Refuses a cutoff inside the 7-day floor. Runs as the owner because the application role cannot delete from either table.';

revoke execute on function ouroboros.copilot_sessions_sweep(text, timestamptz, timestamptz, integer) from public;
grant execute on function ouroboros.copilot_sessions_sweep(text, timestamptz, timestamptz, integer) to ouroboros_app;

-- ---------------------------------------------------------------------------
-- The application role.
--
-- Sessions are started and closed, messages appended, streamed into and answered — none is
-- deleted by the application, because the transcript is the record. `last_seq` and
-- `copilot_messages.seq` are the allocator's alone: no insert or update grant reaches them
-- (an insert that names `seq` is refused by the allocator besides).
-- ---------------------------------------------------------------------------
grant select on ouroboros.copilot_sessions to ouroboros_app;
grant insert (id, organization_id, workflow_id, status, model_provenance, draft_name, created_by,
              created_at, closed_at)
  on ouroboros.copilot_sessions to ouroboros_app;
grant update (status, model_provenance, draft_name, closed_at)
  on ouroboros.copilot_sessions to ouroboros_app;

grant select on ouroboros.copilot_messages to ouroboros_app;
grant insert (id, organization_id, session_id, role, body, choices, tool_trace, tokens_in,
              tokens_out, cost_cents, status, created_at)
  on ouroboros.copilot_messages to ouroboros_app;
grant update (body, choices, tool_trace, tokens_in, tokens_out, cost_cents, status)
  on ouroboros.copilot_messages to ouroboros_app;
