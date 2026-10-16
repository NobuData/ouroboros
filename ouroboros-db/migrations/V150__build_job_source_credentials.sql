-- ===========================================================================
-- V150 — the source credential a build runner redeems for one checkout (#991, AG.7)
-- ===========================================================================
--
-- A real runner checks out `job.offer.repository` before it runs the command (#991). A public
-- repository clones anonymously; a private one needs the workspace's GitHub token — and that
-- token must not ride the offer, which is a recorded frame, nor sit in a workspace or a log.
--
-- Decision L9 (docs/ROADMAP_OOE_LIVE_LOOP.md): the runner receives a short-lived credential for
-- one checkout, by a one-call hand-over. The hand-over is the artifact upload's shape (V060,
-- decision T4) turned around:
--
--   dispatch ── mints a ticket, stores its hash here, puts the TICKET on the offer
--   runner   ── POST /api/v1/farm/jobs/<id>/source-credential   Authorization: Bearer <ticket>
--   rest     ── one row, unexpired, not yet redeemed ──▶ redeemed_at = now()
--               opens the workspace's GitHub token in request scope, answers it once
--   runner   ── one fetch, then the credential is dropped; the job never sees it
--
-- `build_job_source_credentials` is the ticket's ledger: one row per build job, written when
-- dispatch offers the job to a runner.
--   * `token_hash` is the SHA-256 of the ticket, hex. The ticket itself travels once, in the
--     `job.offer`, and is never stored. A job offered again — its first runner declined, or never
--     answered — is minted a fresh ticket over the same row, so the first runner's is dead.
--   * `expires_at` bounds it: the offer's answer window plus a grace for the checkout to start.
--     A ticket a runner has not redeemed by then was never going to be.
--   * `redeemed_at` is **single use**. The redemption that is answered sets it in the same
--     statement that reads the row, and a redeemed row admits nothing again — a replay of the
--     ticket, from anyone, is refused.
--
-- No row is written for a workspace with no GitHub token: that repository is cloned anonymously,
-- and a private one fails on the runner with a sentence that says so.
--
-- Revert forward:
--   drop table ouroboros.build_job_source_credentials;
-- ===========================================================================

create table ouroboros.build_job_source_credentials (
  build_job_id     uuid        primary key,
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,
  -- SHA-256 of the ticket, lowercase hex. The ticket itself is never stored.
  token_hash       text        not null,
  minted_at        timestamptz not null default now(),
  expires_at       timestamptz not null,
  -- Single use: set by the redemption that was answered, never cleared.
  redeemed_at      timestamptz,
  constraint build_job_source_credentials_job_fk
    foreign key (build_job_id, organization_id)
    references ouroboros.build_jobs (id, organization_id) on delete cascade,
  constraint build_job_source_credentials_token_hash_shape
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint build_job_source_credentials_expires_after_minted
    check (expires_at > minted_at),
  constraint build_job_source_credentials_redeemed_after_minted
    check (redeemed_at is null or redeemed_at >= minted_at)
);

comment on table ouroboros.build_job_source_credentials is
  'The ledger of the single-use ticket a build runner redeems for its checkout''s git credential (#991, decision L9): one row per build job, the ticket''s hash, its expiry, and when it was redeemed. The credential it answers is the workspace''s own GitHub token, opened in request scope and never stored here.';
comment on column ouroboros.build_job_source_credentials.token_hash is
  'SHA-256 of the ticket the job.offer carried, lowercase hex. Re-minted over the same row when the job is offered again.';
comment on column ouroboros.build_job_source_credentials.expires_at is
  'When the ticket stops being honoured: the offer''s answer window plus a grace for the checkout to start.';
comment on column ouroboros.build_job_source_credentials.redeemed_at is
  'When the ticket was redeemed. Set once, by the redemption that was answered; a redeemed row refuses every later presentation.';

-- A redeemed ticket is frozen: nothing about what was asked may be rewritten, and a redemption
-- cannot be undone. A fresh mint over an unredeemed row is the one update allowed.
create function ouroboros.build_job_source_credentials_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if old.redeemed_at is not null then
    raise exception 'build_job_source_credentials % was redeemed and is frozen', old.build_job_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  if new.build_job_id <> old.build_job_id or new.organization_id <> old.organization_id then
    raise exception 'build_job_source_credentials % keeps its job and workspace', old.build_job_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

create trigger build_job_source_credentials_lifecycle
  before update on ouroboros.build_job_source_credentials
  for each row execute function ouroboros.build_job_source_credentials_lifecycle();

comment on function ouroboros.build_job_source_credentials_lifecycle() is
  'Freezes a redeemed ticket row (#991): a redemption is single use and cannot be rewritten or undone; an unredeemed row may only be re-minted in place.';
