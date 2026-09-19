-- V044__farm_log_ingest.sql — what log ingest has to remember so a build's log says, once and
-- truthfully, where its holes are; and the tombstone the retention sweep leaves.
--
-- AH.5 (#253) under epic #240, decision **B8**. V040 drew `build_log_chunks` for this ticket: the
-- chunk, its `seq`, the `byte_start` the cap trigger assigns, and the cap's own elision marker. Two
-- things it could not know yet, because they are about the *agent's* side of the pipe and about
-- chunks that never arrive, are here.
--
-- ---------------------------------------------------------------------------
-- An elision is data, rendered once — never text in the stream.
-- ---------------------------------------------------------------------------
--
-- A build log can lose bytes in four places, and each is reported rather than hidden:
--
--   1. **The agent's throttle** (AG.5, #247). The protocol's `log.chunk.dropped_bytes` is the
--      bytes the agent elided immediately before that chunk; `job.finish.log.dropped_bytes` is its
--      total, which also covers what it dropped after its last chunk — its own per-job cap.
--   2. **This service's per-workspace rate guard.** A chunk refused to keep one runaway build from
--      starving ingest for everybody else is not stored; its bytes are carried to the next chunk
--      that is.
--   3. **A lost frame.** `log.chunk` is not re-sent, so a chunk in flight when a socket died is
--      gone. `seq` is contiguous per job, so the gap is visible, but its size is not.
--   4. **The per-job cap** — V040's `build_log_chunk_cap()`, which clamps the stream and counts
--      everything after it onto `build_jobs.log_dropped_bytes`.
--
-- The console (AI.6, #261) draws one `[… N bytes elided]` marker per position, so the columns below
-- keep the figures *by position* rather than by cause. Before a chunk: `elided_bytes` (causes 1 and
-- 2, summed) and `missing_chunks` (cause 3). After the last stored byte — the **tail** — one figure,
-- `build_jobs.log_dropped_bytes`, which this migration widens from "what the cap refused" to
-- "everything elided after the last stored byte": the cap's count, plus the agent's own tail drops
-- and the rate guard's. That widening is the coordination the issue asks for. The agent's cap and
-- this service's cap both describe the end of the same log, and a reader that drew one marker for
-- each would claim two holes where there is one.
--
-- `build_jobs.log_agent_dropped_bytes` is the agent's running total as received, so a `job.finish`
-- can tell its tail drops from the ones already placed before a chunk: `finish.dropped − seen`.
-- `build_jobs.log_missing_chunks` is the tail's own lost frames: `job.finish.log.chunks` against
-- the chunks that arrived.
--
-- ---------------------------------------------------------------------------
-- The retention sweep deletes whole logs, and leaves a tombstone.
-- ---------------------------------------------------------------------------
--
-- V040's `retain_until` is set per chunk at write time — thirty days by default — so a policy that
-- changes later never retroactively deletes what was written under the old one. The sweep also
-- holds each workspace to a byte budget (`OURO_FARM_LOG_BUDGET_BYTES`). Either way it removes a
-- finished job's chunks **all at once**, never some of them: a log with its middle missing and no
-- marker saying so is worse than no log. `log_swept_at` records that it happened, so the read API
-- answers "this log was removed by retention" rather than an empty log that looks like a quiet
-- build. Only a finished job is ever swept, and `build_jobs_log_swept_when_finished` says so.

alter table ouroboros.build_log_chunks
  add column elided_bytes   bigint  not null default 0,
  add column missing_chunks integer not null default 0;

alter table ouroboros.build_log_chunks
  add constraint build_log_chunks_elided_bytes_non_negative
    check (elided_bytes >= 0),
  add constraint build_log_chunks_missing_chunks_non_negative
    check (missing_chunks >= 0);

comment on column ouroboros.build_log_chunks.elided_bytes is
  'Bytes elided immediately before this chunk (#253): the agent''s own throttle drops (the protocol''s log.chunk.dropped_bytes) plus any chunk this service''s per-workspace rate guard refused since the previous stored chunk. The console renders it as one elision marker at this chunk''s byte_start. Zero on an ordinary chunk.';
comment on column ouroboros.build_log_chunks.missing_chunks is
  'Chunks immediately before this one that never arrived (#253) — log.chunk is not re-sent, so a frame in flight when a socket died is lost, and seq''s contiguity is what makes the gap visible. Their size is unknown, so this counts them rather than guessing bytes.';

alter table ouroboros.build_jobs
  add column log_agent_dropped_bytes bigint      not null default 0,
  add column log_missing_chunks      integer     not null default 0,
  add column log_swept_at            timestamptz;

alter table ouroboros.build_jobs
  add constraint build_jobs_log_agent_dropped_non_negative
    check (log_agent_dropped_bytes >= 0),
  add constraint build_jobs_log_missing_chunks_non_negative
    check (log_missing_chunks >= 0),
  -- Only a finished job's log is ever removed. A running build swept from under the live card
  -- would render as a build that stopped talking.
  add constraint build_jobs_log_swept_when_finished
    check (log_swept_at is null or finished_at is not null);

comment on column ouroboros.build_jobs.log_dropped_bytes is
  'Bytes elided after the last stored byte of this job''s log — its tail (#249, widened by #253). The cap trigger counts what the per-job cap refused; log ingest adds the agent''s own tail drops (job.finish.log.dropped_bytes less what it had already placed before a chunk) and any chunk the rate guard refused with no later chunk to carry it. One figure, so the console draws one tail marker however many causes met at the end of the log.';
comment on column ouroboros.build_jobs.log_agent_dropped_bytes is
  'The agent''s elided bytes for this job as received so far (#253): every log.chunk''s dropped_bytes, then raised to job.finish.log.dropped_bytes. What lets a finish''s total be split into the drops already placed before a chunk and the tail.';
comment on column ouroboros.build_jobs.log_missing_chunks is
  'Chunks after the last one that arrived that never did (#253), from job.finish.log.chunks — lost frames at the tail, counted because their size is unknown.';
comment on column ouroboros.build_jobs.log_swept_at is
  'When the retention sweep removed this job''s log (#253) — all of it, never part. Null while the log is kept. Only a finished job is swept (build_jobs_log_swept_when_finished), and the read API answers "removed by retention" from this rather than an empty log that looks like a quiet build.';
comment on constraint build_jobs_log_swept_when_finished on ouroboros.build_jobs is
  'Only a finished job''s log is removed (#253). A running build swept from under the live card would read as a build that went silent.';

-- The budget sweep's read: a workspace's finished jobs that still hold a log, oldest first.
create index build_jobs_log_retained_idx
  on ouroboros.build_jobs (organization_id, finished_at)
  where log_swept_at is null and log_bytes > 0;

comment on index ouroboros.build_jobs_log_retained_idx is
  'The retention budget sweep (#253): each workspace''s finished jobs that still hold a log, oldest first. Partial, so it grows with the logs kept rather than with the build history.';
