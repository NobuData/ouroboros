-- V066__pull_request_sync_stamp.sql — `pull_requests.synced_at`: when the host was last asked
-- about a PR, whether or not anything had changed.
--
-- Filed as issue #370 (AY.8, the PR page's states and its e2e leg) of the PR Verification
-- roadmap (docs/ROADMAP_MOCKUP_12_PR_VERIFICATION.md). Its *sync lag* state is DASH-I.7's
-- banner (#86): the host is the truth for a PR's content (V052, decision V1), so a page whose
-- sync has stalled is showing an older PR while looking current, and the banner says when the
-- host was last heard. Nothing on the row said that.
--
--
-- Why `updated_at` could not be the stamp.
-- ---------------------------------------------------------------------------
--
-- `updated_at` says *the mirror changed*, and the sync (#357) keeps it meaning that by not
-- writing an unchanged PR at all. A PR nobody has pushed to since Tuesday has an `updated_at`
-- of Tuesday whether the host was asked a minute ago or never again, so it cannot tell *quiet*
-- from *stalled* — which is the one question the banner exists to answer.
--
--   | column       | moved by                                   | says                        |
--   |--------------|--------------------------------------------|-----------------------------|
--   | `updated_at` | a write that changed the row               | the mirror changed          |
--   | `synced_at`  | every sync, including one that found       | the host was asked, and     |
--   |              | nothing changed                            | answered                    |
--
-- **Nullable, with no default**, for V014's reason (`github_repos.issues_synced_at`): `now()`
-- would assert a sync that never happened. A PR written by anything but the sync — the
-- development seed's #514 — has never been synced, and says so.
--
--
-- The stamp must not move `updated_at`.
-- ---------------------------------------------------------------------------
--
-- V052's `pull_requests_touch_updated_at` fires on every update, so stamping an unchanged PR
-- would move `updated_at` on every sync: the listing's *most recently updated first* would
-- become *most recently synced*, and `updated_at` would stop meaning what the table above says.
-- The trigger is therefore recreated to fire only when something other than the stamp changed.
-- The comparison is of the whole row less the stamp, so a column a later migration adds is
-- covered without this trigger being edited again.
--
-- `updated_at` itself stays inside the comparison, and that is deliberate: V001's rule is that
-- the column is the server's to set, so a statement that supplies one — alone, or beside the
-- stamp — still fires the trigger and has its value overwritten. Only a statement that leaves
-- every other column as it found it goes unstamped.

alter table ouroboros.pull_requests
  add column synced_at timestamptz;

comment on column ouroboros.pull_requests.synced_at is
  'Sync-owned. When the SPI sync (#357) last asked the host about this PR and was answered (#370) — the source of the PR page''s sync-lag banner. Null until the first sync; moved by a sync that found nothing changed, which does not move updated_at.';

alter table ouroboros.pull_requests
  add constraint pull_requests_synced_after_created
    check (synced_at is null or synced_at >= created_at);

comment on constraint pull_requests_synced_after_created on ouroboros.pull_requests is
  'A PR is not synced before it is mirrored (#370).';

-- ---------------------------------------------------------------------------
-- `updated_at` moves when the row did — not when only the sync stamp did.
-- ---------------------------------------------------------------------------
drop trigger pull_requests_touch_updated_at on ouroboros.pull_requests;

create trigger pull_requests_touch_updated_at
  before update on ouroboros.pull_requests
  for each row
  when ((to_jsonb(new) - 'synced_at') is distinct from (to_jsonb(old) - 'synced_at'))
  execute function ouroboros.touch_updated_at();

comment on trigger pull_requests_touch_updated_at on ouroboros.pull_requests is
  'Stamps updated_at when anything but the sync stamp changed (#370): a sync that found nothing new moves synced_at and leaves updated_at where it was, so updated_at keeps meaning that the mirror changed. A supplied updated_at is itself a change, and is overwritten.';
