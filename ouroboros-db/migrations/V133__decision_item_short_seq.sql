-- V133__decision_item_short_seq.sql — the number a person types to name a decision (#537, BZ.3).
--
-- Mockup 19's command table has one row that names a decision item:
--
--     /ouro answer q-231 allow          answer a blocking question
--
-- and nothing in V093's `decision_items` can be typed. An item's identity is a uuid, and its
-- other key — (plane, source_ref) — is `guardrails:run:<uuid>:path:boot/rollback_flag.c`. So
-- every item gets a short number, per workspace, and the id people see and type is
--
--     'q-' || short_seq
--
-- One column, `decision_items.short_seq`, and three rules about it:
--
--   * **The database assigns it.** `decision_items_short_seq_allocate` gives a new item its
--     workspace's highest number plus one, and refuses an insert that brings a number of its own.
--     No caller chooses one — not `decision_item_emit`, not a plane inserting directly, not a
--     seed — so there is no path by which two writers can disagree about what `q-231` is.
--   * **It never changes.** `decision_items_short_seq_fixed` refuses any update that moves it,
--     the way V093's `decision_items_pinned` refuses a re-pin. A `q-231` somebody read in a
--     channel an hour ago is the same question when they answer it.
--   * **It is unique per workspace** (`decision_items_organization_short_seq_key`), which is
--     also the index `/ouro answer q-231` is one read of. Two workspaces both have a `q-1`.
--
--
-- The allocator is V045's, not V106's — and why.
-- ---------------------------------------------------------------------------
--
-- This schema already allocates a per-workspace number twice. V045's `runs.loop_seq` takes a
-- transaction-scoped advisory lock keyed on the workspace and reads `max + 1`; V106's
-- `investigations.seq` bumps a row in a counter table. The counter table is the stronger of the
-- two and the wrong one here, for a reason particular to this table: **an item is filed by an
-- upsert.** `decision_item_emit` is `insert … on conflict (organization_id, idempotency_key) do
-- update`, a plane calls it every time it re-evaluates the thing it is asking about, and a
-- BEFORE INSERT trigger fires for the proposed row *before* the conflict is found. A counter
-- bumped there stays bumped when the insert turns into an update, so every refresh of an open
-- card would spend a number and a workspace with eleven questions would be handing out `q-4816`.
-- `max + 1` computes a number the refreshed row simply does not take: nothing is spent.
--
-- So: `pg_advisory_xact_lock(<this allocator>, <workspace>)`, then `max(short_seq) + 1`.
-- Concurrent inserts into one workspace serialise on the lock and see each other's numbers;
-- different workspaces do not contend; commit or rollback releases it. The unique key is what
-- makes that safe rather than merely careful (V045's words): two writers that somehow computed
-- the same number cannot both commit.
--
-- **Never reused — and what that rests on.** `max + 1` hands a number out again only if the
-- item holding the workspace's highest number is deleted, and nothing deletes an item:
-- `ouroboros_app` holds select, insert and update on this table and no delete (V093), no
-- retention class sweeps it, and resolving, expiring or snoozing an item keeps its row.
-- An item leaves only with its workspace, and the numbers go with it. A number allocated by a
-- transaction that then rolls back was never shown to anyone and is the next one handed out.
--
--
-- The back-fill.
-- ---------------------------------------------------------------------------
--
-- Items that already exist are numbered in the order they were asked — `created_at`, then `id`
-- so the order is total — per workspace, before `not null` and the unique key are applied. The
-- table's own triggers are switched off for that one statement: it changes no fact any of them
-- guards, `touch_updated_at` would stamp every item in the database as edited today, and
-- `decision_items_refs_resolve` would refuse the whole migration over any old item whose run or
-- PR has since been deleted (a ref outlives its target by design, V093). Foreign keys and the
-- table's CHECKs are not triggers of that kind and stay on.
--
--
-- Not changed.
-- ---------------------------------------------------------------------------
--
-- `decision_item_emit` and `decision_items_rendered` are untouched: the function names its
-- insert columns and the view names its select list, so neither sees the new column. A reader
-- that wants the short number reads it from the table. No lookup function is added — resolving
-- `q-231` is `where organization_id = $1 and short_seq = 231`, on the unique key.
--
-- Grants: none to add. `ouroboros_app` already has select, insert and update on the table, and
-- a column added to it is covered; the two trigger functions are called by nobody.
--
-- To undo (forward only — for a rehearsal against a copy):
--   drop trigger decision_items_short_seq_fixed on ouroboros.decision_items;
--   drop trigger decision_items_short_seq_allocate on ouroboros.decision_items;
--   drop function ouroboros.decision_items_short_seq_fixed();
--   drop function ouroboros.decision_items_short_seq_allocate();
--   alter table ouroboros.decision_items drop column short_seq;

-- ---------------------------------------------------------------------------
-- 1. The column, back-filled in the order the questions were asked.
-- ---------------------------------------------------------------------------
alter table ouroboros.decision_items
  add column short_seq integer;

alter table ouroboros.decision_items disable trigger user;

update ouroboros.decision_items i
   set short_seq = numbered.seq
  from (select id,
               row_number() over (partition by organization_id
                                  order by created_at, id) as seq
          from ouroboros.decision_items) numbered
 where numbered.id = i.id;

alter table ouroboros.decision_items enable trigger user;

alter table ouroboros.decision_items
  alter column short_seq set not null;

alter table ouroboros.decision_items
  -- `q-0` is not an id anybody types.
  add constraint decision_items_short_seq_positive
    check (short_seq > 0),

  -- One number per workspace, once — and the index `/ouro answer q-231` reads. Read backwards
  -- it is also where the allocator takes `max(short_seq)` from.
  add constraint decision_items_organization_short_seq_key
    unique (organization_id, short_seq);

comment on column ouroboros.decision_items.short_seq is
  'The short id people type in chat (#537): q-231 is ''q-'' || short_seq, as in /ouro answer q-231 allow_once. Per workspace, counting from 1, assigned by the database when the item is filed (decision_items_short_seq_allocate) — an insert cannot supply one — and fixed from then on (decision_items_short_seq_fixed). Never reused: an item keeps its row when it is resolved, expired or snoozed, and leaves only with its workspace.';
comment on constraint decision_items_organization_short_seq_key on ouroboros.decision_items is
  'One short number per workspace, once (#537) — the lookup behind q-231, and what makes the allocator safe under concurrency rather than merely careful.';

-- ---------------------------------------------------------------------------
-- 2. Assigning it. See the header for why this is V045's allocator.
--
-- Named to sort after the table's other BEFORE INSERT triggers (default_severity,
-- payload_conforms, ref_shape, refs_resolve), so an item one of them refuses never takes the
-- workspace's lock.
-- ---------------------------------------------------------------------------
create function ouroboros.decision_items_short_seq_allocate() returns trigger
language plpgsql
as $$
declare
  highest integer;
begin
  if new.short_seq is not null then
    raise exception
      'a decision item''s short number is assigned by the database, not supplied (got %)',
      new.short_seq
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'Leave short_seq out of the insert. See V133__decision_item_short_seq.sql (#537).';
  end if;

  -- Two keys, as V045 takes them: a constant naming this allocator, so the lock collides with
  -- no other advisory lock in the application, and the workspace, so only writers racing for
  -- the same counter wait for each other.
  perform pg_advisory_xact_lock(hashtext('ouroboros.decision_items.short_seq'),
                                hashtext(new.organization_id));

  select max(short_seq) into highest
    from ouroboros.decision_items
   where organization_id = new.organization_id;

  new.short_seq := coalesce(highest, 0) + 1;

  return new;
end;
$$;

comment on function ouroboros.decision_items_short_seq_allocate() is
  'BEFORE INSERT trigger for decision_items (#537): assigns short_seq — the 231 of q-231 — as the workspace''s highest plus one, under a transaction-scoped advisory lock keyed on the workspace so concurrent inserts serialise instead of colliding on decision_items_organization_short_seq_key. Refuses an insert that supplies a number (class 23, naming the trigger). A decision_item_emit that refreshes an existing item spends no number.';

create trigger decision_items_short_seq_allocate
  before insert on ouroboros.decision_items
  for each row execute function ouroboros.decision_items_short_seq_allocate();

-- ---------------------------------------------------------------------------
-- 3. Fixed once assigned.
-- ---------------------------------------------------------------------------
create function ouroboros.decision_items_short_seq_fixed() returns trigger
language plpgsql
as $$
begin
  if new.short_seq is distinct from old.short_seq then
    raise exception
      'decision item % is q-% and stays q-%: a short number never changes',
      old.id, old.short_seq, old.short_seq
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'See V133__decision_item_short_seq.sql (#537).';
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_items_short_seq_fixed() is
  'BEFORE UPDATE trigger for decision_items (#537): short_seq is fixed at filing, so the q-231 somebody read in a channel is the same question when they answer it. Raises class 23 naming the trigger.';

create trigger decision_items_short_seq_fixed
  before update on ouroboros.decision_items
  for each row execute function ouroboros.decision_items_short_seq_fixed();
