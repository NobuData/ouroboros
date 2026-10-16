-- ===========================================================================
-- V152 — whether a mirrored pull request is a draft (#1311, DI.3)
-- ===========================================================================
--
-- DI.3 opens a live run's pull request, and it **always** opens it as a draft: a loop's PR is a
-- proposal that cannot merge until a person marks it ready. Until this migration the mirror could
-- not say so — the host reported `draft` on every pull, and V052's columns dropped it — so the PR
-- page had no way to show that a PR it renders cannot merge yet.
--
--   column   written by                                 what it says
--   ──────────────────────────────────────────────────────────────────────────────────────────
--   draft    the mirror sync, on every sync             the host holds the PR as a draft
--            (PrMirrorRepository.applySync)
--            the draft publisher, at link time          …and a loop-opened PR is one: the
--            (POST /internal/runs/:id/pull-request)     publisher refuses to link any other
--
-- **Not null, default false.** Every row mirrored before this migration was synced from a host
-- that may have held it as a draft; the next sync corrects it. False is the reading a row had
-- implicitly until now (V052 rendered every PR as ready), so no back-fill is invented here.
--
-- **The ingestion ledger learns its ninth operation, `run.pull_request`.** The engine asks the
-- control plane to open the run's draft PR (`POST /internal/runs/:id/pull-request`)
-- idempotency-keyed like every other engine write; the receipt is written in the transaction that
-- links the PR to the run.
--
-- No view enumerates `pull_requests`' columns (`pr_revision_attempts`, `pr_gate_results_latest`
-- and `history_index_entries` name the columns they read), so none is recreated.
--
-- To undo (forward only — for a rehearsal against a copy):
--   recreate run_ingest_receipts_operation with V151's list;
--   alter table ouroboros.pull_requests drop column draft;
-- ===========================================================================

alter table ouroboros.pull_requests
  add column draft boolean not null default false;

comment on column ouroboros.pull_requests.draft is
  'Whether the host holds this PR as a draft — one that cannot merge until someone marks it ready (#1311, DI.3). Written by the mirror sync from the host''s PR on every sync, and set true by the draft publisher when it links a loop-opened PR to its run (a loop PR is always a draft). False for rows mirrored before V152 until their next sync.';

-- ---------------------------------------------------------------------------
-- The ingestion ledger's ninth operation (V049's rule: a ninth is an edit to
-- openapi.internal.yaml, this list and tests/constraints.sql in one change).
-- ---------------------------------------------------------------------------
alter table ouroboros.run_ingest_receipts
  drop constraint run_ingest_receipts_operation,
  add constraint run_ingest_receipts_operation
    check (operation in ('run.create',
                         'run.stage_transition',
                         'run.events',
                         'run.files',
                         'run.commits',
                         'run.resources',
                         'run.finish',
                         'run.push_result',
                         'run.pull_request'));

comment on constraint run_ingest_receipts_operation on ouroboros.run_ingest_receipts is
  'The nine operations openapi.internal.yaml publishes as idempotency-keyed (#303, #160 added run.finish, #1310 run.push_result, #1311 run.pull_request). Closed, so a typo in a service is a refused write rather than a silently separate idempotency namespace. The push grant is not one: its answer carries a credential no receipt may store.';
