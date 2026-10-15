-- ===========================================================================
-- V139 — token_usage: per-hop attribution for the chain executor (AF.2, #235)
-- ===========================================================================
--
-- `POST /internal/llm/invoke` writes one `token_usage` row per attempted hop. V010 and V020
-- record *which provider kind, which model, how many tokens, what it cost*; the requirements
-- doc's gap G2 names what a hop needs on top so that a fallback hop's tokens are never
-- attributed to the primary and a vote never inflates the call it reviewed:
--
--   connection_id           which provider connection actually served the hop
--   alias                   the routing alias the hop came from
--   hop                     its place in the executor's walk, zero-based — the `hop` every invoke
--                           event carries
--   stage                   the workflow stage / task kind the worker named
--   attempt                 the stage attempt, for the Messages facade (R9)
--   is_vote                 a second opinion an `add_vote` rule attached (R5)
--   cache_read_tokens       prompt tokens served from the provider's cache
--   cache_write_tokens      prompt tokens written to it
--   subject_kind/subject_id what the call is attributed to when it is not a run (below)
--   resolution_snapshot_id  the resolution the call executed (gap G1)
--
-- **Subjects.** `run_id` references `runs`, but three callers invoke for something that is
-- not a run: a Copilot session, a dry run and a research investigation. Each is attributed
-- through `subject_kind` + `subject_id` instead; a real run sets both (`'run'`, its id) as
-- well as `run_id`, so the per-run cap sums one column whatever the subject is. Text and no
-- reference, on V020's precedent: the subject's own row may be purged before the ledger.
--
-- Every column is nullable or defaulted, so every row written before this migration stays
-- what it was.
-- ===========================================================================

alter table ouroboros.token_usage
  -- Set null rather than cascade: deleting a connection must not delete spend.
  add column connection_id uuid
    references ouroboros.provider_connections (id) on delete set null,
  add column alias text,
  add column hop integer,
  add column stage text,
  add column attempt integer,
  add column is_vote boolean not null default false,
  add column cache_read_tokens integer not null default 0,
  add column cache_write_tokens integer not null default 0,
  add column subject_kind text,
  add column subject_id uuid,
  add column resolution_snapshot_id uuid
    references ouroboros.resolution_snapshots (id) on delete set null;

alter table ouroboros.token_usage
  add constraint token_usage_hop_nonnegative check (hop is null or hop >= 0),
  add constraint token_usage_attempt_positive check (attempt is null or attempt >= 1),
  add constraint token_usage_cache_tokens_nonnegative
    check (cache_read_tokens >= 0 and cache_write_tokens >= 0),
  add constraint token_usage_alias_length check (alias is null or length(alias) between 1 and 128),
  add constraint token_usage_stage_length check (stage is null or length(stage) between 1 and 64),
  add constraint token_usage_subject_kind
    check (subject_kind is null
           or subject_kind in ('run', 'copilot_session', 'dry_run', 'investigation')),
  -- Both or neither: a kind without an id attributes nothing.
  add constraint token_usage_subject_pair
    check ((subject_kind is null) = (subject_id is null)),
  -- A run subject is the row's own run.
  add constraint token_usage_run_subject
    check (subject_kind is distinct from 'run' or subject_id = run_id);

-- The per-run cap's read: *what has this subject spent so far*, once per invocation.
create index token_usage_subject_idx
  on ouroboros.token_usage (organization_id, subject_kind, subject_id)
  where subject_id is not null;

comment on column ouroboros.token_usage.connection_id is
  'The provider connection that served this hop (AF.2, #235). Null for rows from ingest.';
comment on column ouroboros.token_usage.alias is
  'The routing alias of the hop that served this usage — model_aliases.alias.';
comment on column ouroboros.token_usage.hop is
  'The hop''s zero-based place in the executor''s walk — the hop its invoke events carry.';
comment on column ouroboros.token_usage.stage is
  'The stage or task kind the worker named in runCtx.stage.';
comment on column ouroboros.token_usage.attempt is
  'The stage attempt, for calls made through the Messages-format facade (R9).';
comment on column ouroboros.token_usage.is_vote is
  'True for a vote''s own invocation, so it never inflates the primary call (R5).';
comment on column ouroboros.token_usage.cache_read_tokens is
  'Prompt tokens the provider served from its cache, as it reported them.';
comment on column ouroboros.token_usage.cache_write_tokens is
  'Prompt tokens the provider wrote to its cache, as it reported them.';
comment on column ouroboros.token_usage.subject_kind is
  'What this usage is attributed to: run, copilot_session, dry_run or investigation.';
comment on column ouroboros.token_usage.subject_id is
  'The id of the subject_kind row; equals run_id for a run.';
comment on column ouroboros.token_usage.resolution_snapshot_id is
  'The resolution this call executed (gap G1). Null where no snapshot was written.';
