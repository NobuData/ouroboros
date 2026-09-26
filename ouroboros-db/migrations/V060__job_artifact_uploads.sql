-- V060__job_artifact_uploads.sql — the job-scoped upload a build job's results leave its runner
-- by, and the globs that decide which files those are.
--
-- Filed as issue #330 (AT.2) of the Test Results roadmap (docs/ROADMAP_MOCKUP_11_TEST_RESULTS.md,
-- decision T4, option 3-A). Mockup 11's Artifacts card — `junit-build3.xml`,
-- `rig-capture-estop.csv · 2.1 MB`, `serial-console.log`, `coverage 87.4% (+0.6%)` — lists files
-- that exist on a runner first. V055 (#327) gave them a registry (`test_artifacts`); this is how
-- they get there.
--
--
-- Artifacts do not ride the control WebSocket (decision T4).
-- ---------------------------------------------------------------------------
--
-- The agent's one socket carries job control and heartbeats, and one 2 MB rig capture on it
-- degrades exactly the channel that decides whether a runner looks alive. So results leave by a
-- **job-scoped HTTPS request** — `POST /api/v1/farm/jobs/:id/artifacts` — authenticated by a
-- token minted with the job offer and good for that job alone.
--
--
-- `build_job_artifact_uploads` is the token's ledger and the upload's receipt.
-- ---------------------------------------------------------------------------
--
-- One row per build job, written when dispatch offers the job to a runner:
--
--   * `token_hash` is the SHA-256 of the upload token, hex. The token itself travels once, in the
--     `job.offer`, and is never stored. A job offered again — its first runner declined, or never
--     answered — is minted a fresh token over the same row, so the first runner's is dead.
--   * `expires_at` bounds it: the offer's answer window plus the job's wall-clock budget plus a
--     grace for the upload itself. Keeping a token after the job buys nothing.
--   * `closed_at` is **single use**. The upload that is accepted closes the row in the same
--     transaction that registers its files, and a closed row admits nothing again — a replay of
--     the same request, or of the token against anything, is refused.
--
-- Once closed, the row is the upload's receipt, and it is what AH.1's `build_jobs` gains as its
-- result linkage: the attempt it filled (`test_run_id`), the **manifest** — every file the agent
-- collected, including the ones it truncated or skipped and why — and the **warnings** the page
-- renders, of which a quota breach is one. A quota breach is a warning and never a job failure:
-- losing a build over an artifact quota is the wrong trade. And nothing is dropped silently: a
-- file that was cut short or left behind is in the manifest with its reason, because an
-- artifacts card missing a file it never mentions is worse than one that says it was too large.
--
--   token_hash   minted_at   expires_at   closed_at   test_run_id   manifest   warnings
--   open         set         set          null        null          null       []
--   closed       set         set          set         set¹          array      array
--
--   ¹ set when closed; set null afterwards only when the attempt is deleted.
--
-- Everything is frozen once closed (`build_job_artifact_uploads_lifecycle`), except the attempt
-- reference that `on delete set null` clears.
--
--
-- Which files: the globs.
-- ---------------------------------------------------------------------------
--
-- `runner_pools.artifact_globs` is what every build of a pool collects beyond the built-in set
-- (JUnit, `ouro-hil-results*.json`, lcov and cobertura reports) — a rig pool's
-- `captures/*.csv`, say. `build_jobs.artifact_globs` is the job's own snapshot: the pool's globs
-- plus whatever the submission declared (a `serial-console.log`), taken at submit time like the
-- rest of the job's configuration, so a pool edited later does not change what an earlier build
-- collects.
--
-- A glob is a path **relative to the job's working directory**: never absolute, never climbing
-- out with `..`, never a backslash (one spelling of a separator on every platform). The agent
-- refuses anything outside the workspace again when it collects; this is the same rule held by
-- the database so no writer can store one it would refuse.

-- ---------------------------------------------------------------------------
-- The glob list's shape — shared by the pool and the job.
-- ---------------------------------------------------------------------------
create function ouroboros.artifact_globs_valid(p_globs jsonb)
returns boolean
language sql
immutable
as $$
  select ouroboros.farm_text_set_valid(p_globs, 64)
     and not exists (
       select 1
         from jsonb_array_elements_text(p_globs) as glob
        where length(glob) > 256
           or glob like '/%'
           or glob ~ '(^|/)\.\.(/|$)'
           or glob ~ '[\\[:cntrl:]]'
     );
$$;

comment on function ouroboros.artifact_globs_valid(jsonb) is
  'True when the document is a set of at most 64 distinct globs, each 1–256 characters, relative to the job''s working directory: no leading /, no .. segment, no backslash, no control character (#330).';

alter table ouroboros.runner_pools
  add column artifact_globs jsonb not null default '[]'::jsonb,
  add constraint runner_pools_artifact_globs_shape
    check (ouroboros.artifact_globs_valid(artifact_globs));

comment on column ouroboros.runner_pools.artifact_globs is
  'Files every build of this pool uploads beyond the built-in result set — rig captures, serial logs (#330). Relative globs; see artifact_globs_valid().';

alter table ouroboros.build_jobs
  add column artifact_globs jsonb not null default '[]'::jsonb,
  add constraint build_jobs_artifact_globs_shape
    check (ouroboros.artifact_globs_valid(artifact_globs));

comment on column ouroboros.build_jobs.artifact_globs is
  'The pool''s artifact globs plus the submission''s own, snapshotted at submit (#330) — what this build''s runner collects beyond the built-in result set.';

-- ---------------------------------------------------------------------------
-- build_job_artifact_uploads — the token's ledger, then the upload's receipt.
-- ---------------------------------------------------------------------------
create table ouroboros.build_job_artifact_uploads (
  build_job_id     uuid        primary key,

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- SHA-256 of the upload token, lowercase hex. The token itself is never stored.
  token_hash       text        not null,
  minted_at        timestamptz not null default now(),
  expires_at       timestamptz not null,

  -- Single use: set by the accepted upload, never cleared.
  closed_at        timestamptz,

  -- The attempt the upload filled.
  test_run_id      uuid,

  -- Every collected file: stored, truncated or skipped, each with its reason.
  manifest         jsonb,

  -- What the page says about this upload — a quota breach, a truncation, a skipped file.
  warnings         jsonb       not null default '[]'::jsonb,

  -- Bytes written to the artifact store by the upload.
  stored_bytes     bigint      not null default 0,

  constraint build_job_artifact_uploads_job_fk
    foreign key (build_job_id, organization_id)
    references ouroboros.build_jobs (id, organization_id) on delete cascade,

  constraint build_job_artifact_uploads_test_run_fk
    foreign key (test_run_id, organization_id)
    references ouroboros.test_runs (id, organization_id) on delete set null (test_run_id),

  constraint build_job_artifact_uploads_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'),

  constraint build_job_artifact_uploads_expires_after_minted
    check (expires_at > minted_at),

  constraint build_job_artifact_uploads_closed_after_minted
    check (closed_at is null or closed_at >= minted_at),

  -- A receipt exists exactly when the upload closed; an open ledger holds nothing yet.
  constraint build_job_artifact_uploads_receipt
    check ((closed_at is null) = (manifest is null)
           and (closed_at is not null or (test_run_id is null and stored_bytes = 0
                                          and warnings = '[]'::jsonb))),

  constraint build_job_artifact_uploads_manifest_array
    check (manifest is null or jsonb_typeof(manifest) = 'array'),

  constraint build_job_artifact_uploads_warnings_array
    check (jsonb_typeof(warnings) = 'array'),

  constraint build_job_artifact_uploads_stored_bytes_non_negative
    check (stored_bytes >= 0)
);

comment on table ouroboros.build_job_artifact_uploads is
  'The job-scoped artifact upload (#330, AT.2, decision T4): the single-use token''s ledger while open, the upload''s receipt once closed — the attempt it filled, the manifest of every collected file (truncated and skipped included, with reasons) and the warnings the page renders. build_jobs'' result linkage.';
comment on column ouroboros.build_job_artifact_uploads.token_hash is
  'SHA-256 of the upload token minted with the job offer, lowercase hex. Re-minted when the job is offered again; the token itself is never stored.';
comment on column ouroboros.build_job_artifact_uploads.closed_at is
  'When the accepted upload closed the manifest. Single use: once set, no request with this job''s token is admitted again.';
comment on column ouroboros.build_job_artifact_uploads.manifest is
  'Every file the agent collected: [{name, status: stored|truncated|skipped, size_bytes, reason?, note?, artifact_id?}]. Null while open.';
comment on column ouroboros.build_job_artifact_uploads.warnings is
  'The upload''s job warnings: [{code, message, file?}] — artifact_quota_exceeded, artifact_truncated, artifact_skipped. A warning, never a job failure.';

create index build_job_artifact_uploads_test_run_idx
  on ouroboros.build_job_artifact_uploads (test_run_id)
  where test_run_id is not null;

create function ouroboros.build_job_artifact_uploads_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if new.build_job_id is distinct from old.build_job_id
     or new.organization_id is distinct from old.organization_id then
    raise exception 'upload ledger % belongs to its job', old.build_job_id
      using errcode = 'check_violation', constraint = 'build_job_artifact_uploads_frozen';
  end if;

  if old.closed_at is not null
     and (to_jsonb(new) - 'test_run_id') is distinct from (to_jsonb(old) - 'test_run_id') then
    raise exception 'upload of job % closed at % and its receipt is final', old.build_job_id, old.closed_at
      using errcode = 'check_violation', constraint = 'build_job_artifact_uploads_closed_final';
  end if;

  if old.closed_at is not null and new.test_run_id is not null
     and new.test_run_id is distinct from old.test_run_id then
    raise exception 'upload of job % closed into attempt % and cannot be moved', old.build_job_id, old.test_run_id
      using errcode = 'check_violation', constraint = 'build_job_artifact_uploads_closed_final';
  end if;

  return new;
end;
$$;

comment on function ouroboros.build_job_artifact_uploads_lifecycle() is
  'Holds an upload ledger to its job, and a closed one to its receipt (#330): after closed_at is set nothing changes except the attempt reference being set null by its deletion.';

create trigger build_job_artifact_uploads_lifecycle
  before update on ouroboros.build_job_artifact_uploads
  for each row execute function ouroboros.build_job_artifact_uploads_lifecycle();

-- ---------------------------------------------------------------------------
-- Grants. The ledger is minted (insert or re-mint) and closed; it is never deleted by the
-- application — it leaves with its job.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update on ouroboros.build_job_artifact_uploads to ouroboros_app;
grant execute on function ouroboros.artifact_globs_valid(jsonb) to ouroboros_app;
