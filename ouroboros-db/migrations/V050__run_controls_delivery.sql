-- V050__run_controls_delivery.sql — what AP.4's control queue needs from the schema beyond
-- V048's table: a terminal status an aborted run can rest at, and the steer's *remember this*
-- flag.
--
-- AP.4 (issue #306, docs/ROADMAP_MOCKUP_10_RUN_CONSOLE.md, decision **R6**) is the service
-- behind mockup 10's *Pause loop*, *Abort run* and the steering box. V048 already carries the
-- queue — the state machine, the TTL, the idempotency key and the audit trigger — so this
-- file is two small amendments, each forced by an acceptance criterion.
--
--
-- `canceled` — where an aborted run rests.
-- ---------------------------------------------------------------------------
--
-- *Abort mid-stage terminates the simulated lifecycle; the run reaches a terminal state and
-- the branch is preserved.* V008 gave a run three terminal statuses — `merged`,
-- `needs_human`, `failed` — and none of them is true of an abort:
--
--   * `failed` says the loop tried and could not, and the dashboard's *Recently closed* card
--     draws it as a failure of the agent. An abort is a person's decision, and rendering it as
--     the agent's failure would put a lie on the one card that summarises how the loop is
--     doing.
--   * `needs_human` says the loop is waiting for somebody. An aborted run is waiting for
--     nobody.
--
-- So the vocabulary gains a seventh word, and the roadmap's own: *"acked · canceled"* (AQ.2,
-- #310). It is terminal, which is the whole of what the second constraint below restates —
-- decision F2 makes *terminal* and *has a finish time* one fact, and a status added to one
-- half without the other would be a run that is closed and in neither card.
--
-- Both constraints keep their V008 names, because `tests/constraint-probes.test.sh` and every
-- `must_reject` in `tests/constraints.sql` name them: a constraint is found by its name.
--
-- The branch is preserved by nothing here, deliberately — `runs.branch_name` is not touched by
-- the abort and nothing in the schema deletes a branch. What is stated is the status.
--
--
-- `run_controls.remember` — the steer's *remember this* flag (#412 amendment on #306).
-- ---------------------------------------------------------------------------
--
-- Decision **K5** (docs/ROADMAP_MOCKUP_14_KNOWLEDGE.md) promotes what the loop already learns
-- into reviewable facts, and steers are one of its three sources. Most steers are specific to
-- their run — *"skip the HIL suite for now"* is not a lasting truth about the codebase — and
-- inferring which ones generalise from their text is exactly the guess BF.3 (#412) exists to
-- avoid. So the person says so: an explicit flag, false unless set, and **only on a steer**,
-- because a pause is not a thing anybody could remember.
--
-- The flag is a hint, not a confirmation: #412 turns a flagged steer into a candidate that
-- lands `awaiting review` like every other proposal. The facts tables are BE.2's (#406) and
-- do not exist yet; this column is what they will read.
--
-- It is part of **what was asked**, so it is frozen at insert with the rest of it. V048's
-- `run_controls_transition()` enumerates the frozen columns by name, so it is replaced below
-- with `remember` added to both of its row comparisons and nothing else changed.

-- ---------------------------------------------------------------------------
-- runs.status — seven words, four of them terminal.
-- ---------------------------------------------------------------------------
alter table ouroboros.runs drop constraint runs_status;
alter table ouroboros.runs
  add constraint runs_status
    check (status in ('coding', 'building', 'review',
                      'merged', 'needs_human', 'failed', 'canceled'));

alter table ouroboros.runs drop constraint runs_terminal_finished_at;
alter table ouroboros.runs
  add constraint runs_terminal_finished_at
    check ((status in ('merged', 'needs_human', 'failed', 'canceled')) = (finished_at is not null));

comment on column ouroboros.runs.status is
  'coding | building | review (active) · merged | needs_human | failed | canceled (terminal). Decision F2: terminal exactly when finished_at is set (runs_terminal_finished_at). canceled is an aborted run (V050, #306 AP.4) — a person''s decision, which is why it is not failed.';

comment on constraint runs_status on ouroboros.runs is
  'The seven statuses (V008, widened by V050 for #306). Everything downstream partitions rows by this column, so a value outside it would be a run in neither dashboard card.';

comment on constraint runs_terminal_finished_at on ouroboros.runs is
  'Decision F2: the four terminal statuses — merged, needs_human, failed, canceled — require finished_at, and the three active ones forbid it.';

-- ---------------------------------------------------------------------------
-- run_controls.remember — the steer's "remember this" flag.
-- ---------------------------------------------------------------------------
alter table ouroboros.run_controls
  add column remember boolean not null default false;

alter table ouroboros.run_controls
  add constraint run_controls_remember_belongs_to_steer
    check (not remember or kind = 'steer');

comment on column ouroboros.run_controls.remember is
  'The steer''s explicit "remember this" flag (#412 amendment on #306, decision K5). Only a flagged steer becomes a fact candidate, and the candidate still lands awaiting review — a hint, not a confirmation. False unless set, steer-only (run_controls_remember_belongs_to_steer), and frozen at insert by run_controls_transition() with the rest of what was asked.';

comment on constraint run_controls_remember_belongs_to_steer on ouroboros.run_controls is
  'Only a steer can be remembered (#306): a pause, a resume or an abort carries nothing a fact could be made of.';

-- ---------------------------------------------------------------------------
-- The state machine, with `remember` among the columns fixed at insert.
--
-- V048's function verbatim but for the two row comparisons, which now carry `remember`: the
-- erasure test (so forgetting who asked still moves nothing else) and the "what was asked"
-- test (so the flag cannot be set on a steer after it was sent). `create or replace` keeps the
-- trigger bound to it.
-- ---------------------------------------------------------------------------
create or replace function ouroboros.run_controls_transition()
returns trigger
language plpgsql
as $$
begin
  if new.requested_by is null and old.requested_by is not null
     and row(new.id, new.run_id, new.kind, new.payload, new.state, new.requested_at,
             new.delivered_at, new.acked_at, new.expires_at, new.ack_detail,
             new.idempotency_key, new.remember)
         is not distinct from
         row(old.id, old.run_id, old.kind, old.payload, old.state, old.requested_at,
             old.delivered_at, old.acked_at, old.expires_at, old.ack_detail,
             old.idempotency_key, old.remember)
  then
    return new;
  end if;

  if old.state in ('acked', 'expired', 'rejected') then
    raise exception
      'run control % is %, which is terminal', old.id, old.state
      using errcode = 'restrict_violation',
            constraint = 'run_controls_transition',
            hint = 'A control records an exchange that has finished (#301, decision R6). Submit another control rather than revising this one.';
  end if;

  if new.state is distinct from old.state
     and not (old.state = 'pending'   and new.state in ('delivered', 'expired', 'rejected')
           or old.state = 'delivered' and new.state in ('acked', 'expired'))
  then
    raise exception
      'run control % cannot move from % to %', old.id, old.state, new.state
      using errcode = 'restrict_violation',
            constraint = 'run_controls_transition',
            hint = 'Decision R6''s machine: pending → delivered | expired | rejected, delivered → acked | expired.';
  end if;

  if row(new.id, new.run_id, new.kind, new.payload, new.requested_by,
         new.requested_at, new.expires_at, new.idempotency_key, new.remember)
     is distinct from
     row(old.id, old.run_id, old.kind, old.payload, old.requested_by,
         old.requested_at, old.expires_at, old.idempotency_key, old.remember)
  then
    raise exception
      'run control % is a record of what was asked, and that cannot be revised', old.id
      using errcode = 'restrict_violation',
            constraint = 'run_controls_transition',
            hint = 'Only state, delivered_at, acked_at and ack_detail move after insert (#301). A queue whose entries can be edited in flight is a queue where "abort" was once "pause" and nobody can tell.';
  end if;

  return new;
end;
$$;

comment on function ouroboros.run_controls_transition() is
  'Decision R6''s state machine, enforced in the schema rather than in the service (#301, amended by V050 for #306): terminal states accept no update at all, transitions follow the five edges the diagram draws, and everything that describes what was ASKED — now including the steer''s remember flag — is fixed at insert. The one exception is requested_by going from a person to null with nothing else moving, the foreign key''s own ON DELETE SET NULL. So the guarantee is: what was asked, and what happened to it, cannot be rewritten; who asked can be forgotten.';
