-- V042__farm_gateway.sql — what the agent gateway has to remember: the ledger that makes a
-- terminal frame apply exactly once, and the hostname a runner reports when it connects.
--
-- AH.3 (#251) under epic #240. The gateway is the server half of the runner protocol
-- (`docs/RUNNER_PROTOCOL.md`, AG.1 #243): it authenticates a runner's WebSocket against V041's
-- certificates, reads its heartbeats into V040's `runners` row, and receives the frames that
-- end a build. Almost everything it writes already has a column — `status`, `last_seen_at`,
-- `telemetry`, `agent_version`, `capabilities` — because V040 was drawn for it. Two things were
-- not, and each has its section below: a **ledger of terminal frames**, which is the protocol's
-- exactly-once rule made durable, and **`runners.hostname`**, which `hello` reports and nothing
-- stored.
--
-- ---------------------------------------------------------------------------
-- The terminal-frame ledger is the receiver's half of resume, and it is a table because it
-- has to outlive the process.
-- ---------------------------------------------------------------------------
--
-- The failure being survived is narrow and certain: an agent writes `job.finish`, the socket
-- dies before the `receipt` comes back, and the agent — which cannot know whether the frame
-- arrived — sends it again after reconnecting, byte for byte, envelope id included (§ 5 of the
-- protocol document). A gateway that treated the second copy as a second result would finish
-- one build twice, and mockup 08's `19 clean · 3 retried · 1 failed` would stop adding up with
-- nothing to say why.
--
-- The protocol's answer is two rules, one per end, and this table is the receiver's:
--
--   1. **Record, then answer.** The frame's envelope id is inserted here in the same
--      transaction that applies it to its `build_jobs` row, and the `receipt` is written only
--      after that commits. A crash between the two leaves a recorded frame the agent re-sends
--      and is told is a duplicate — never an acknowledged frame nobody kept.
--   2. **Keyed on the frame, not the session.** A reconnect that could not resume its session
--      still delivers the frame it was holding, so the key is `(runner_id, frame_id)` and a
--      session appears nowhere in it.
--
-- The primary key is what makes the rule a property of the database rather than of the code
-- that checks it. Two copies of one frame arriving at once — on a socket being replaced and on
-- the one replacing it — both attempt the insert, and exactly one of them creates a row; the
-- other waits on the index, finds the row, and is answered `duplicate: true` without touching
-- the job. There is no read-then-write for a race to fall between.
--
-- **Keyed per runner rather than globally**, because the id is chosen by the agent. A ULID is
-- 80 random bits after its timestamp, so two agents minting the same one is not the concern;
-- the concern is that a key shared across workspaces would let one runner's frame be answered
-- as a duplicate of another's, which is a cross-tenant effect however unlikely its trigger. The
-- composite foreign key onto `runners` carries `organization_id` for V040's reason.
--
-- **A frame is recorded even when it changes nothing.** A `job.finish` naming a job that is not
-- this runner's, not in this workspace, or already finished is still recorded and still
-- receipted — the agent has to be allowed to stop re-sending it — with `applied = false` and,
-- where the job was not this runner's to finish, `job_id` null. That column pair is the answer
-- to *did this frame finish a build?*, and `runner_terminal_frames_applied_names_job` makes a
-- `true` that names no job a row PostgreSQL refuses.
--
-- **Retention is the job's.** The protocol asks for at least the resume window and says that
-- in practice the ledger should live as long as the job record, because an entry is cheap and
-- the alternative is a duplicate accepted as new. Rows are never deleted by anything but a
-- workspace's own deletion, and they are **append-only**: `runner_terminal_frames_no_update`
-- refuses every UPDATE, for V022's argument — a recorded delivery is a fact about something
-- that happened. There is no delete counterpart, for V024's reason: `organization_id`
-- cascades, and a delete-refusing trigger would make removing a workspace fail rather than
-- protect anything.
--
-- `frame_type` is an enum of one, `job.finish`, mirroring the protocol's own
-- `receipt.of_type`: a second terminal message cannot be added without this constraint — and
-- that contract — changing with it.
--
-- ---------------------------------------------------------------------------
-- `runners.hostname` is recognition, never identity.
-- ---------------------------------------------------------------------------
--
-- `hello.hostname` is what the machine calls itself, and the protocol is explicit that it is
-- *for recognition, never for identity*: the certificate is the identity, and the runner's
-- `name` is what an operator chose and may have changed since. The issue asks for it to be
-- recorded all the same, because *which box is `forge-02`?* is the first question anybody asks
-- of a fleet table, and the answer is on the machine rather than in the enrollment. Nullable,
-- because a runner enrolled and never connected has not said; bounded at the protocol's own
-- 1–253 characters, which is also DNS's ceiling for a name.

-- ---------------------------------------------------------------------------
-- runners.hostname
-- ---------------------------------------------------------------------------
alter table ouroboros.runners
  add column hostname text;

alter table ouroboros.runners
  add constraint runners_hostname_length
    check (hostname is null or char_length(hostname) between 1 and 253);

comment on column ouroboros.runners.hostname is
  'What the machine called itself in its last `hello` (#251, AH.3) — for recognition, never for identity: the certificate is the identity and `name` is what an operator chose. Null until the runner has connected once.';

comment on constraint runners_hostname_length on ouroboros.runners is
  'A reported hostname is 1–253 characters (#251) — the protocol''s own bound on `hello.hostname`, which is also DNS''s ceiling for a name. An empty string would render as a blank where the fleet table promises a machine.';

-- ---------------------------------------------------------------------------
-- runner_terminal_frames
-- ---------------------------------------------------------------------------
create table ouroboros.runner_terminal_frames (
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,
  runner_id       uuid        not null,
  frame_id        text        not null,
  frame_type      text        not null,
  job_id          uuid,
  applied         boolean     not null,
  received_at     timestamptz not null default now(),
  constraint runner_terminal_frames_pkey primary key (runner_id, frame_id),
  constraint runner_terminal_frames_runner_fk
    foreign key (runner_id, organization_id)
    references ouroboros.runners (id, organization_id) on delete no action,
  constraint runner_terminal_frames_job_fk
    foreign key (job_id, organization_id)
    references ouroboros.build_jobs (id, organization_id) on delete no action,
  constraint runner_terminal_frames_frame_id_ulid
    check (frame_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  constraint runner_terminal_frames_frame_type
    check (frame_type in ('job.finish')),
  constraint runner_terminal_frames_applied_names_job
    check (not applied or job_id is not null)
);

comment on table ouroboros.runner_terminal_frames is
  'The gateway''s ledger of terminal frames (#251, AH.3) — the receiver''s half of the runner protocol''s resume rule (docs/RUNNER_PROTOCOL.md § 5). Every `job.finish` an agent delivers is recorded here by its envelope id, in the same transaction that applies it, before its `receipt` is written; a re-send after a dropped socket finds its row and is answered `duplicate: true` instead of finishing the build a second time. Append-only, and never pruned ahead of the job it names.';

comment on column ouroboros.runner_terminal_frames.frame_id is
  'The terminal frame''s envelope id — a ULID the agent minted once and repeats verbatim on every re-send, which is what makes it an idempotency key. Unique per runner, not per session: a reconnect that could not resume still delivers the frame it was holding.';

comment on column ouroboros.runner_terminal_frames.job_id is
  'The build the frame finished, when it named one of this runner''s jobs in this workspace. Null when it did not — an unknown job, or another runner''s — which is recorded rather than refused so the agent can stop re-sending.';

comment on column ouroboros.runner_terminal_frames.applied is
  'Whether recording this frame changed its job. False for a frame naming a job that was not this runner''s or had already finished: the delivery is a fact worth keeping, and so is the fact that it finished nothing.';

comment on constraint runner_terminal_frames_pkey on ouroboros.runner_terminal_frames is
  'One row per frame per runner (#251) — the exactly-once rule as a property of the database. Two copies of a frame arriving at once both attempt the insert and exactly one creates a row; the other is answered as a duplicate and never touches the job.';

comment on constraint runner_terminal_frames_applied_names_job on ouroboros.runner_terminal_frames is
  'A frame that changed a job names it (#251). `applied` with no `job_id` would be a finished build nobody can find — the one row this ledger exists to make impossible to lose.';

create function ouroboros.runner_terminal_frames_refuse_update() returns trigger
language plpgsql
as $$
begin
  raise exception
    'ouroboros.runner_terminal_frames is append-only: a recorded delivery cannot be revised'
    using errcode = 'restrict_violation',
          detail  = format('refused update of frame %s from runner %s in organization %s',
                           old.frame_id, old.runner_id, old.organization_id),
          hint    = 'A terminal frame was delivered or it was not; nothing about that can change. See V042__farm_gateway.sql (#251).';
end;
$$;

comment on function ouroboros.runner_terminal_frames_refuse_update() is
  'Refuses every UPDATE on runner_terminal_frames (#251), for any role including the owner — V022''s argument about a record of something that happened, and V024''s shape: organization_id cascades, so no statement in the schema ever needs to revise a row here.';

create trigger runner_terminal_frames_no_update
  before update on ouroboros.runner_terminal_frames
  for each row execute function ouroboros.runner_terminal_frames_refuse_update();

comment on trigger runner_terminal_frames_no_update on ouroboros.runner_terminal_frames is
  'A recorded terminal frame cannot be revised (#251). No delete counterpart, for V024''s reason: the workspace cascades, and a delete-refusing trigger would make removing one fail rather than protect the ledger.';

create index runner_terminal_frames_job_idx
  on ouroboros.runner_terminal_frames (job_id)
  where job_id is not null;

comment on index ouroboros.runner_terminal_frames_job_idx is
  'The frames that finished a build, by build (#251) — what AH.4 (#252) and AH.7 (#255) read to ask *how many times was this job finished?*, whose only correct answer is one. Partial because the frames that named no job are never looked up that way.';
