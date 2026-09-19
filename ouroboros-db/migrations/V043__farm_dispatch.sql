-- V043__farm_dispatch.sql — a pool's default command, which build dispatch falls back to.
--
-- AH.4 (#252) under epic #240. `POST /api/v1/farm/jobs` takes a pool, a repository, a ref, a
-- commit and a command — *"or the pool default"*, and AI.5's (#260) submit dialog prefills the
-- command field from it. V040 gave a pool its executor, its image and its environment
-- allow-list, but not the command its builds usually run, so there was nothing to fall back to
-- and nothing to prefill. This is that column, and only that: everything else dispatch needs —
-- the queue, the offer, the retry chain, the per-runner queue depth — V040 already drew.
--
-- ---------------------------------------------------------------------------
-- The command is stored as text, in the form `build_jobs.command` already holds.
-- ---------------------------------------------------------------------------
--
-- The wire carries argv (`job.offer.command`, docs/RUNNER_PROTOCOL.md) and the API takes argv,
-- because a string that a splitter has to cut into words is a build that fails for a reason
-- nobody can see. What is *stored* is the argv's canonical rendering: each word as itself when
-- it is plain, and single-quoted POSIX-style when it is not — `west build -b helios_mainboard
-- app`, or `sh -c 'make all'`. `ouroboros-rest`'s `farm/dispatch/command.ts` renders it and reads
-- it back as the exact inverse, refusing anything its renderer could not have produced, so no
-- user-typed string is ever split.
--
-- Text rather than a jsonb array for one reason: it is the same form as the job's own snapshot.
-- A submission that falls back to the pool's default copies this value onto `build_jobs.command`
-- unchanged, and a pool default that had to be converted on the way would be a second place for
-- the two to disagree.
--
-- Nullable, because a pool with no usual command is ordinary: its submissions name one, and a
-- submission that does not is refused with `farm_command_required` rather than guessed at.

alter table ouroboros.runner_pools
  add column default_command text;

-- Bounded and not blank. A blank default is a pool whose every fallback submission would be
-- dispatched with no program to run, and the agent would fail it as an executor error — a
-- farm fault reported against a build.
alter table ouroboros.runner_pools
  add constraint runner_pools_default_command_shape
    check (default_command is null
           or (char_length(default_command) between 1 and 8192
               and default_command ~ '[^[:space:]]'));

comment on column ouroboros.runner_pools.default_command is
  'The command a build of this pool runs when its submission names none (#252, AH.4) — AI.5''s (#260) prefilled command. Stored as the canonical rendering of an argv (plain words bare, others single-quoted), the same form build_jobs.command holds, so a fallback submission copies it unchanged; ouroboros-rest''s farm/dispatch/command.ts reads it back as argv and never splits free text. Null when the pool has no usual command, in which case a submission must name one.';

comment on constraint runner_pools_default_command_shape on ouroboros.runner_pools is
  'A pool''s default command is 1–8192 characters and not blank (#252). A blank default would dispatch every fallback submission with nothing to run, and the agent would report it as an executor error: a farm fault charged to a build.';
