-- V117__competitor_watch_checks.sql — the competitor tracker's schedule and its archive (#616, CL.3).
--
-- V112 (#610) gave the tracker its registry and its snapshot chain; #616 runs it. Two things the
-- scheduler needs that V112 did not have:
--
--   * **Each watch's last check, and the next.** `next_check_at` is when the scheduler may look
--     again — the cadence with jitter after a check, a shorter back-off after a failure — and it is
--     stored, so a restart picks up where the schedule was rather than checking every watch at
--     once. `last_checked_at` / `last_outcome` / `last_note` say what the latest check found, in
--     words a person can read: a JS-rendered page is marked `render_required` **with its note**
--     ("needs the render tier — arrives in v2"), never left as a silently empty snapshot.
--     `last_success_at` is when a check last read the source — what the tool's health ages.
--   * **What was archived.** A snapshot's `content_ref` names the archive; this migration keeps the
--     selector-scoped text the snapshot hashed in `competitor_snapshot_contents`, which the next
--     check diffs against. Its sha256 must be the snapshot's `content_hash` — the archive is the
--     thing the hash describes, not a copy of something else.
--
-- An unchanged check writes no snapshot: the chain holds changes (and each watch's first read),
-- `last_success_at` holds liveness.
--
-- Revert forward:
--   drop table ouroboros.competitor_snapshot_contents;
--   drop function ouroboros.competitor_snapshot_contents_hash();
--   drop index ouroboros.competitor_watches_next_check_idx;
--   alter table ouroboros.competitor_watches
--     drop constraint competitor_watches_checked_together,
--     drop column next_check_at, drop column last_checked_at, drop column last_success_at,
--     drop column last_outcome, drop column last_note;

alter table ouroboros.competitor_watches
  -- When the scheduler may check the watch next; null means as soon as it can (a new watch).
  add column next_check_at   timestamptz,

  -- The latest check, whatever it found.
  add column last_checked_at timestamptz,

  -- The latest check that read the source (first, changed or unchanged).
  add column last_success_at timestamptz,

  -- What the latest check found.
  add column last_outcome    text
             constraint competitor_watches_last_outcome
               check (last_outcome in ('first', 'changed', 'unchanged', 'failed',
                                       'render_required', 'unsupported', 'robots_denied')),

  -- Why, in a sentence — the honest note a person reads beside the watch.
  add column last_note       text
             constraint competitor_watches_last_note_present
               check (btrim(last_note) <> '' and length(last_note) <= 500),

  -- A check has an outcome; an outcome belongs to a check.
  add constraint competitor_watches_checked_together
    check ((last_checked_at is null) = (last_outcome is null)
           and (last_note is null or last_checked_at is not null));

comment on column ouroboros.competitor_watches.next_check_at is
  'When the scheduler (#616) may check the watch next — its cadence with jitter after a check, a back-off after a failure; null for a watch never scheduled.';
comment on column ouroboros.competitor_watches.last_checked_at is
  'When the latest check ran, whatever it found (#616).';
comment on column ouroboros.competitor_watches.last_success_at is
  'When a check last read the source — first, changed or unchanged (#616). The tracker''s health ages it.';
comment on column ouroboros.competitor_watches.last_outcome is
  'first | changed | unchanged | failed | render_required | unsupported | robots_denied — what the latest check found (#616).';
comment on column ouroboros.competitor_watches.last_note is
  'The latest check''s note — why it failed, or why the source cannot be read yet (#616). At most 500 characters.';

-- The scheduler's question: which enabled, fetchable watches are due, never-scheduled first.
create index competitor_watches_next_check_idx
  on ouroboros.competitor_watches (next_check_at nulls first)
  where enabled and not render_required;

-- ---------------------------------------------------------------------------
-- competitor_snapshot_contents — the scoped text a snapshot hashed.
-- ---------------------------------------------------------------------------
create table ouroboros.competitor_snapshot_contents (
  -- The snapshot. Cascade: the archive is the snapshot's.
  snapshot_id uuid        primary key
                          references ouroboros.competitor_snapshots (id) on delete cascade,

  -- The selector-scoped text, normalised — what the next snapshot is diffed against.
  content     text        not null
                          constraint competitor_snapshot_contents_bounded
                            check (octet_length(content) <= 1048576),

  created_at  timestamptz not null default now()
);

comment on table ouroboros.competitor_snapshot_contents is
  'The archived, selector-scoped text of a competitor snapshot (#616, CL.3) — what its content_hash is the sha256 of, and what the next snapshot is diffed against. At most 1 MiB. Never updated.';

-- The archive is the thing the hash describes.
create function ouroboros.competitor_snapshot_contents_hash()
returns trigger language plpgsql as $$
declare
  expected text;
begin
  select s.content_hash into expected
    from ouroboros.competitor_snapshots s
   where s.id = new.snapshot_id;
  if not found then
    -- The foreign key reports it.
    return new;
  end if;
  if expected <> 'sha256:' || encode(sha256(convert_to(new.content, 'UTF8')), 'hex') then
    raise exception 'archived content does not hash to snapshot %''s content_hash', new.snapshot_id
      using errcode = 'check_violation', constraint = 'competitor_snapshot_contents_hash';
  end if;
  return new;
end;
$$;

comment on function ouroboros.competitor_snapshot_contents_hash() is
  'Refuses archived content whose sha256 is not its snapshot''s content_hash (#616).';

create trigger competitor_snapshot_contents_hash
  before insert on ouroboros.competitor_snapshot_contents
  for each row execute function ouroboros.competitor_snapshot_contents_hash();

-- An archive is the record of what was read at the time.
create trigger competitor_snapshot_contents_immutable
  before update on ouroboros.competitor_snapshot_contents
  for each row execute function ouroboros.citation_ledger_refuse_update();

grant select, insert on ouroboros.competitor_snapshot_contents to ouroboros_app;
