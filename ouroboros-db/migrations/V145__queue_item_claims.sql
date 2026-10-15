-- ===========================================================================
-- V145 — the engine claims the head of a workspace's queue (#91, J.3 narrowed)
-- ===========================================================================
--
-- V009 left the queue as rows nothing consumed ("the engine consuming the head of the queue is
-- v2, #54"). This is the consuming half, as #91's DG.1 amendment narrowed it:
--
--   engine ── POST /internal/queue/claim {workspace, worker, key} ──▶ REST
--             lock the head (lowest position, unleased or lease expired) `for update skip locked`
--             lease it: claim_token, claimed_by, claimed_at, claim_expires_at, claim_key
--   engine ── POST /internal/runs {…, queueItem: {id, claimToken}} ──▶ REST
--             the same transaction that opens the run removes the item (and closes the gap)
--             and records it as runs.queue_item_id
--
-- **A lease, not a removal.** A worker that dies between the claim and the open loses nothing:
-- the lease runs out and the item is claimable again. A claim never moves an item, so the queue
-- the backlog shows keeps its order while an item is held — it is shown as claimed.
--
-- **The claim's idempotency key is the lease's own.** A claim has no run yet, so AP.1's
-- `run_ingest_receipts` (keyed by run) cannot hold it. A claim replayed with the same key
-- answers the item that key already leases instead of taking the next one — so a lost response
-- never costs a second item.
--
-- **Admission is not here.** Whether an item may be claimed at all — the deployment switch
-- (DG.2), the workspace's pause (#489), and DI.4's dry-run policy, confirmation and concurrency
-- ceiling (#1312) — is ouroboros-rest's decision at claim time; this migration only gives the
-- claim somewhere to write.
--
-- Revert forward:
--   alter table ouroboros.queue_items drop column claimed_at, drop column claim_expires_at,
--     drop column claimed_by, drop column claim_token, drop column claim_key;
--   drop index ouroboros.queue_items_claim_key;
--   recreate runs_with_stage without queue_item_id; alter table ouroboros.runs drop column queue_item_id;
-- ===========================================================================

alter table ouroboros.queue_items
  add column claimed_at       timestamptz,
  add column claim_expires_at timestamptz,
  add column claimed_by       text,
  add column claim_token      uuid,
  add column claim_key        text,
  -- All five or none: a lease is one thing.
  add constraint queue_items_claim_whole
    check ((claimed_at is null) = (claim_expires_at is null)
       and (claimed_at is null) = (claimed_by is null)
       and (claimed_at is null) = (claim_token is null)
       and (claimed_at is null) = (claim_key is null)),
  add constraint queue_items_claim_after
    check (claim_expires_at is null or claim_expires_at > claimed_at),
  add constraint queue_items_claimed_by_shape
    check (claimed_by is null or (length(claimed_by) between 1 and 128 and claimed_by !~ '^\s|\s$')),
  add constraint queue_items_claim_key_shape
    check (claim_key is null or (length(claim_key) between 1 and 128 and claim_key !~ '^\s|\s$'));

comment on column ouroboros.queue_items.claimed_at is
  'When an engine worker leased this item (#91). Null for an item nobody holds.';
comment on column ouroboros.queue_items.claim_expires_at is
  'When the lease runs out. An item whose lease has expired is claimable again; nothing clears the columns but the next claim.';
comment on column ouroboros.queue_items.claimed_by is
  'The worker that holds the lease, as it named itself.';
comment on column ouroboros.queue_items.claim_token is
  'The lease''s secret: opening a run from the item (POST /internal/runs with queueItem) must present it.';
comment on column ouroboros.queue_items.claim_key is
  'The claim''s idempotency key. A claim replayed with it answers this item rather than taking another.';

-- The claim's read — a workspace's lowest position among items nobody holds or whose lease ran
-- out — walks `queue_items_organization_position_key` (V009) in order and filters the lease on
-- the way; a second index on the same leading columns would only compete with it for the
-- dashboard's queue read, which constraints.sql holds to that key.

-- A key leases one item at a time within a workspace.
create unique index queue_items_claim_key
  on ouroboros.queue_items (organization_id, claim_key) where claim_key is not null;

-- --- runs: which queue item a run was opened from ------------------------------------------
alter table ouroboros.runs add column queue_item_id uuid;

comment on column ouroboros.runs.queue_item_id is
  'The queue item the run was opened from (#91), or null for a run opened without one. No foreign key: opening the run removes the item.';

-- `runs_with_stage` carries the new column too — V049's reason: a read moves from `runs` to the
-- view by changing one word, so the view has every column `runs` has (V141's definition, plus one).
create or replace view ouroboros.runs_with_stage as
select run.id,
       run.organization_id,
       run.github_repo_id,
       run.issue_number,
       run.issue_title,
       run.workflow_tag,
       run.model,
       run.status,
       coalesce(current_stage.stage_label, run.stage_label) as stage_label,
       coalesce(current_stage.stage_index, run.stage_index) as stage_index,
       coalesce(current_stage.stage_total, run.stage_total) as stage_total,
       run.started_at,
       run.finished_at,
       run.pr_number,
       run.checks_passed,
       run.checks_total,
       run.created_at,
       run.updated_at,
       run.loop_seq,
       run.branch_name,
       run.workflow_version_pin,
       run.simulated,
       run.event_seq,
       run.event_bytes,
       run.event_cap,
       run.event_byte_cap,
       run.events_elided_at,
       run.merge_strategy,
       run.reserved_build_job_id,
       run.event_hint,
       run.change_set_seq,
       run.playbook_id,
       run.events_swept_at,
       run.origin,
       run.queue_item_id
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299, #300, #303, #407, #482, #1313 and #91). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';
