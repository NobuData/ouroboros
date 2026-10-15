-- ===========================================================================
-- V140 — harness_credentials: the run-scoped credential a stage harness holds (DH.2, #1303)
-- ===========================================================================
--
-- A stage harness (the Claude Agent SDK, DH.3 #1308) makes its own model calls. It is given
-- no provider key: it is pointed at `ouroboros-rest`'s Anthropic Messages-format facade
-- (`/internal/harness/anthropic/v1/messages`) and presents one of these instead, as its
-- `ANTHROPIC_API_KEY`. The facade resolves the alias it is bound to, unwraps the real key for
-- one request scope, and meters the call (SECURITY_MODEL.md § 4).
--
-- One row per minted credential:
--
--   token_hash      sha-256 of the token. The token itself is shown once, at minting, and
--                   never stored — a database read is not a credential.
--   run_id, stage,  what it is bound to. A call is attributed to all of them, and a
--   alias, attempt  credential minted for one alias cannot invoke another.
--   expires_at      short-lived: the control plane mints it for two hours.
--   revoked_at      set when the stage ends; a revoked credential is refused at once.
--   reconciliation  the harness's own per-model totals at session end, compared with the
--                   usage rows this credential wrote — stored, so a difference is surfaced
--                   rather than averaged away.
--
-- `token_usage.harness_credential_id` ties each facade call's usage row to the credential, so
-- the reconciliation compares exactly the calls that credential made.
-- ===========================================================================

create table ouroboros.harness_credentials (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, as everything a workspace owns.
  organization_id  text        not null
    references ouroboros.organization (id) on delete cascade,

  -- The run it was minted for. A credential outlives no run.
  run_id           uuid        not null
    references ouroboros.runs (id) on delete cascade,

  -- The stage (or routed task kind) and the routing alias it may call.
  stage            text        not null,
  alias            text        not null,

  -- The stage attempt, 1-based — what each usage row is attributed to.
  attempt          integer     not null default 1,

  token_hash       bytea       not null unique,

  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,

  reconciliation   jsonb,
  reconciled_at    timestamptz,

  constraint harness_credentials_stage_length check (length(stage) between 1 and 64),
  constraint harness_credentials_alias_length check (length(alias) between 1 and 128),
  constraint harness_credentials_attempt_positive check (attempt >= 1),
  -- A sha-256 digest, nothing shorter: a truncated hash is a weaker credential.
  constraint harness_credentials_hash_length check (octet_length(token_hash) = 32),
  constraint harness_credentials_expires_after_created check (expires_at > created_at),
  constraint harness_credentials_reconciled_pair
    check ((reconciliation is null) = (reconciled_at is null))
);

-- The run belongs to the workspace the credential names — the same rule V010 keeps for
-- token_usage, so a credential can never attribute spend across workspaces.
create function ouroboros.harness_credentials_run_in_workspace() returns trigger
  language plpgsql as $$
begin
  if not exists (
    select 1 from ouroboros.runs r
     where r.id = new.run_id and r.organization_id = new.organization_id
  ) then
    raise exception 'harness credential run % is not in workspace %', new.run_id, new.organization_id
      using errcode = '23514', constraint = 'harness_credentials_run_in_workspace';
  end if;

  return new;
end;
$$;

create trigger harness_credentials_run_in_workspace
  before insert or update of organization_id, run_id on ouroboros.harness_credentials
  for each row execute function ouroboros.harness_credentials_run_in_workspace();

create index harness_credentials_run_idx on ouroboros.harness_credentials (run_id);

alter table ouroboros.token_usage
  add column harness_credential_id uuid
    references ouroboros.harness_credentials (id) on delete set null;

create index token_usage_harness_credential_idx
  on ouroboros.token_usage (harness_credential_id)
  where harness_credential_id is not null;

comment on table ouroboros.harness_credentials is
  'Run-scoped credentials a stage harness presents to the Anthropic Messages facade (DH.2, #1303).';
comment on column ouroboros.harness_credentials.token_hash is
  'sha-256 of the token; the token is shown once at minting and never stored.';
comment on column ouroboros.harness_credentials.reconciliation is
  'The harness''s per-model totals at session end beside the recorded usage, with the differences.';
comment on column ouroboros.token_usage.harness_credential_id is
  'The harness credential whose facade call this usage row records (DH.2, #1303).';
