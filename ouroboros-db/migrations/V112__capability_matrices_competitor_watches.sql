-- V112__capability_matrices_competitor_watches.sql — the Research domain's capability matrices and
-- the competitor watch registry whose archived diffs they cite (#610, CK.3).
--
-- Mockup 22's featured card puts a matrix beside RS-127's brief, and its tools list a tracker:
--
--   CAPABILITY                              HELIOS (US)    SKYLINK      AEROMESH     NOVUM       GAP
--   Docking in >8 m/s gusts                 ◐ partial      ● shipping   ◐ partial    ○ none      HIGH
--   Visual-inertial approach (no beacon)    ○ none         ● shipping   ● shipping   ◐ beta      HIGH
--   Abort & retry recovery logic            ◐ partial      ● shipping   ◐ partial    ○ none      MED
--   OTA resilience (A/B + rollback)         ◐ in flight    ● shipping   ○ none       ○ none      WIP
--   Recovery beacon over BLE                ● shipping     ○ none       ? unknown    ○ none      LEAD
--
--   ⌖ Competitor tracker    4 rivals watched · release notes, changelogs, filings
--
-- Both are evidence rather than markup, and this migration makes them so:
--
--   1. **`competitors`** — the workspace's rivals: a name and `meta` (site, aliases, notes).
--   2. **`competitor_watches`** — what is watched for each: a `source_kind` (`release_notes`,
--      `changelog`, `github_releases`, `rss`, `filings`, `page`), a URL, an optional `selector`
--      scoping the diff, a `cadence` (`hourly`, `daily`, `weekly`), `enabled`, and
--      `render_required` — set when a page turns out to be JS-rendered, which v1 cannot fetch
--      (#637 serves it in v2). Marking it is honest and breaks nothing.
--   3. **`competitor_snapshots`** — the archive: a content hash, a ref to the archived content, and
--      the `diff` against the watch's previous snapshot. Decision **V9**: a live rival page is not
--      citable — rivals rewrite changelogs — but an archived diff is, and it is dated.
--   4. **`source_records.snapshot_id`** — the link from V108's ledger: a `competitor_diff` source
--      names the snapshot whose diff it cites, and only a `competitor_diff` source does.
--   5. **`capability_matrices`**, **`matrix_rows`**, **`matrix_cells`**, **`matrix_cell_sources`**
--      — one matrix per investigation; its capabilities in order, each with a gap severity and the
--      derivation that produced it; a cell per subject (us, or a rival column); and the citations
--      behind each cell.
--   6. **`competitor_tracker_summary`** — the tracker's sub-line, computed from the registry.
--
-- ---------------------------------------------------------------------------
-- A matrix is twenty claims, so it is held to the brief's discipline
-- ---------------------------------------------------------------------------
--
-- Decision **V7**: every cell that says something about a product carries at least one citation,
-- and `? unknown` is a first-class state — an honest *we did not find out* — rather than a blank
-- that reads as *no*. So two rules hold at commit, as **deferred constraint triggers** (the rule
-- spans tables written one after the other, like V108's `brief_claims_finding_cited`):
--
--   * `matrix_cells_cited` — a cell whose status is not `unknown` has a `matrix_cell_sources` link,
--     whether the cell was written without one, moved off `unknown`, or lost its last link.
--   * `matrix_rows_complete` — every row has exactly one cell per subject: us, and each rival column
--     of its matrix. A missing cell is the blank V7 forbids; it has to be written as `unknown`.
--
-- The cells cite sources of their own investigation only — the keys are composite on it, V108's
-- pattern.
--
-- ---------------------------------------------------------------------------
-- Columns, subjects and severities
-- ---------------------------------------------------------------------------
--
-- The rival columns are the matrix's `rivals` — competitor ids, left to right, after us — so the
-- card's `Skylink · AeroMesh · Novum` order is stored, not inferred. `us_label` is the first
-- column's name (`Helios`); the card adds `(us)`. A cell's subject is `competitor_id`: null for us,
-- otherwise one of the matrix's rivals (`matrix_cells_subject_in_matrix`).
--
-- `gap_severity` (`high | med | low | wip | lead`) is a conclusion about distance from the best
-- rival, and the same cells can support different conclusions (rows one and three above). So it is
-- stored **with** `severity_derivation`, the inputs that produced it, and a severity cannot change
-- without its derivation changing too (`matrix_rows_severity_rederived`). The derivation itself is
-- CM.2's (#621) service; the schema keeps the record.
--
-- ---------------------------------------------------------------------------
-- Snapshots form a chain per watch
-- ---------------------------------------------------------------------------
--
-- A watch's first snapshot has no `previous_id`; every later one names the latest before it.
-- Constraints keep the chain linear — one first snapshot per watch, one successor per snapshot,
-- the previous one of the same watch — and `competitor_snapshots_chain` keeps it honest: a
-- successor is taken later than its predecessor, and it carries a `diff` exactly when its content
-- hash differs. Two snapshots of a changed page therefore produce one diff, on the second. An
-- unchanged page can still be recorded (no diff) so `last_snapshot_at`, which the insert keeps
-- current, says when it was last looked at. Snapshots are an archive and are never updated.
--
-- Revert forward:
--   drop view ouroboros.competitor_tracker_summary;
--   alter table ouroboros.source_records drop column snapshot_id;
--   drop table ouroboros.matrix_cell_sources, ouroboros.matrix_cells, ouroboros.matrix_rows,
--              ouroboros.capability_matrices, ouroboros.competitor_snapshots,
--              ouroboros.competitor_watches, ouroboros.competitors;
--   then drop every function this file creates.

-- ---------------------------------------------------------------------------
-- Shape helpers.
-- ---------------------------------------------------------------------------

-- competitor_meta_valid(meta) — whether a competitor's meta is an object of at most the keys
-- `site` (an http(s) URL), `aliases` (an array of up to 20 distinct non-blank names, each at most
-- 120 characters) and `notes` (a non-blank string of at most 2000 characters), 8 KiB at most.
--   meta — the jsonb value to inspect
--   returns true when well-formed (the empty object included)
create function ouroboros.competitor_meta_valid(meta jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(meta) is distinct from 'object' or octet_length(meta::text) > 8192
     or exists (select 1 from jsonb_object_keys(meta) k where k not in ('site', 'aliases', 'notes')) then
    return false;
  end if;
  if meta ? 'site' and not (jsonb_typeof(meta -> 'site') = 'string'
                            and ouroboros.source_locator_valid('web', meta ->> 'site')) then
    return false;
  end if;
  if meta ? 'notes' and not (ouroboros.jsonb_nonblank_string(meta -> 'notes')
                             and length(meta ->> 'notes') <= 2000) then
    return false;
  end if;
  if meta ? 'aliases' then
    if jsonb_typeof(meta -> 'aliases') <> 'array' or jsonb_array_length(meta -> 'aliases') > 20
       or exists (select 1 from jsonb_array_elements(meta -> 'aliases') a
                   where not ouroboros.jsonb_nonblank_string(a) or length(a #>> '{}') > 120)
       or (select count(distinct lower(a #>> '{}')) from jsonb_array_elements(meta -> 'aliases') a)
          <> jsonb_array_length(meta -> 'aliases') then
      return false;
    end if;
  end if;
  return true;
end;
$$;

comment on function ouroboros.competitor_meta_valid(jsonb) is
  'True when a competitor''s meta is an object of at most {site: http(s) URL, aliases: [≤ 20 distinct non-blank names ≤ 120 chars], notes: non-blank ≤ 2000 chars}, 8 KiB at most (#610).';

-- competitor_source_kind_label(kind) — how the tracker's sub-line names a watched source kind.
--   kind — a competitor_watches.source_kind
--   returns the plural label (`release notes`, `changelogs`, …); null for an unknown kind
create function ouroboros.competitor_source_kind_label(kind text)
returns text language sql immutable as $$
  select case kind
    when 'release_notes'   then 'release notes'
    when 'changelog'       then 'changelogs'
    when 'github_releases' then 'GitHub releases'
    when 'rss'             then 'RSS feeds'
    when 'filings'         then 'filings'
    when 'page'            then 'pages'
  end;
$$;

comment on function ouroboros.competitor_source_kind_label(text) is
  'The tracker sub-line''s label for a watch source kind — release notes, changelogs, GitHub releases, RSS feeds, filings, pages (#610).';

-- ---------------------------------------------------------------------------
-- competitors — the workspace's rivals.
-- ---------------------------------------------------------------------------
create table ouroboros.competitors (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, as everything a workspace owns.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The column header — "Skylink".
  name            text        not null
                              constraint competitors_name_present
                                check (btrim(name) <> '' and length(name) <= 120),

  -- {site, aliases, notes} — see competitor_meta_valid().
  meta            jsonb       not null default '{}'
                              constraint competitors_meta_shape
                                check (ouroboros.competitor_meta_valid(meta)),

  created_at      timestamptz not null default now(),

  constraint competitors_organization_id_key unique (organization_id, id)
);

comment on table ouroboros.competitors is
  'A workspace''s rivals (#610, CK.3; decision V9) — the subjects of capability matrix columns and the owners of watched sources. Name unique per workspace, case-insensitively.';
comment on column ouroboros.competitors.meta is
  '{site: http(s) URL, aliases: [names], notes} — every key optional.';

-- One "Skylink" per workspace, however it is capitalised.
create unique index competitors_organization_name_key
  on ouroboros.competitors (organization_id, lower(name));

-- ---------------------------------------------------------------------------
-- competitor_watches — what is watched for each rival.
-- ---------------------------------------------------------------------------
create table ouroboros.competitor_watches (
  id               uuid        primary key default gen_random_uuid(),

  -- The rival. Cascade: a watch is the rival's — though a cited snapshot holds it (see below).
  competitor_id    uuid        not null
                               references ouroboros.competitors (id) on delete cascade,

  source_kind      text        not null
                               constraint competitor_watches_source_kind
                                 check (source_kind in ('release_notes', 'changelog',
                                                        'github_releases', 'rss', 'filings',
                                                        'page')),

  -- The watched page, feed or API endpoint.
  url              text        not null
                               constraint competitor_watches_url_valid
                                 check (ouroboros.source_locator_valid('web', url)),

  -- The scoped diff region — a CSS/XPath selector; null watches the whole document.
  selector         text
                   constraint competitor_watches_selector_present
                     check (btrim(selector) <> '' and length(selector) <= 500),

  cadence          text        not null default 'daily'
                               constraint competitor_watches_cadence
                                 check (cadence in ('hourly', 'daily', 'weekly')),

  -- When the latest snapshot was taken; kept current by competitor_snapshots_touch_watch().
  last_snapshot_at timestamptz,

  enabled          boolean     not null default true,

  -- The page needs a JS render tier v1 does not have (#637, v2). Marked, not hidden: the watch
  -- stays registered and the tracker does not count it as watched.
  render_required  boolean     not null default false,

  created_at       timestamptz not null default now(),

  constraint competitor_watches_target_key
    unique nulls not distinct (competitor_id, source_kind, url, selector)
);

comment on table ouroboros.competitor_watches is
  'A rival''s watched source (#610, CK.3; decision V9): source kind, URL, optional selector scoping the diff, cadence, enabled, and render_required for a JS-rendered page v1 cannot fetch (#637). Snapshots of it are the citable archive.';
comment on column ouroboros.competitor_watches.source_kind is
  'release_notes | changelog | github_releases | rss | filings | page.';
comment on column ouroboros.competitor_watches.selector is
  'The CSS/XPath region the diff is scoped to; null for the whole document.';
comment on column ouroboros.competitor_watches.cadence is
  'hourly | daily | weekly — how often the scheduler (#616) snapshots it.';
comment on column ouroboros.competitor_watches.last_snapshot_at is
  'The latest snapshot''s taken_at, kept by the snapshot insert; null before the first.';
comment on column ouroboros.competitor_watches.render_required is
  'The page is JS-rendered and needs v2''s render tier (#637). Such a watch is not counted as watched.';

-- The scheduler's question (#616): which enabled, fetchable watches are due, oldest first.
create index competitor_watches_due_idx
  on ouroboros.competitor_watches (last_snapshot_at nulls first)
  where enabled and not render_required;

-- ---------------------------------------------------------------------------
-- competitor_snapshots — the archive, and the diffs that are citable.
-- ---------------------------------------------------------------------------
create table ouroboros.competitor_snapshots (
  id           uuid        primary key default gen_random_uuid(),

  watch_id     uuid        not null
                           references ouroboros.competitor_watches (id) on delete cascade,

  -- The watch's snapshot before this one; null for its first.
  previous_id  uuid,

  -- A digest of the archived content: sha256:<64 hex>.
  content_hash text        not null
                           constraint competitor_snapshots_content_hash_format
                             check (content_hash ~ '^sha256:[0-9a-f]{64}$'),

  -- Where the archived content is kept — an object-store key or URI, never the page itself.
  content_ref  text        not null
                           constraint competitor_snapshots_content_ref_present
                             check (btrim(content_ref) <> '' and length(content_ref) <= 1024
                                    and content_ref !~ '\s'),

  -- The change against the previous snapshot, scoped by the watch's selector. Present exactly
  -- when the content hash differs from the previous one's (competitor_snapshots_chain).
  diff         text
               constraint competitor_snapshots_diff_bounded
                 check (btrim(diff) <> '' and octet_length(diff) <= 65536),

  taken_at     timestamptz not null,

  created_at   timestamptz not null default now(),

  constraint competitor_snapshots_watch_id_key unique (watch_id, id),

  -- The previous snapshot is the same watch's, and has one successor at most.
  constraint competitor_snapshots_previous_fk
    foreign key (watch_id, previous_id) references ouroboros.competitor_snapshots (watch_id, id),
  constraint competitor_snapshots_previous_key unique (previous_id),

  constraint competitor_snapshots_diff_has_previous check (diff is null or previous_id is not null)
);

comment on table ouroboros.competitor_snapshots is
  'Archived snapshots of a watched source (#610, CK.3; decision V9), one chain per watch: content hash, archived content ref, and the diff against the previous snapshot when the content changed. A competitor_diff source record cites one by snapshot_id. Never updated.';
comment on column ouroboros.competitor_snapshots.previous_id is
  'The same watch''s previous snapshot; null only for its first.';
comment on column ouroboros.competitor_snapshots.content_ref is
  'Where the archived content is stored (object-store key or URI).';
comment on column ouroboros.competitor_snapshots.diff is
  'The selector-scoped change against the previous snapshot — present exactly when the content hash changed. At most 64 KiB.';

-- One first snapshot per watch: every other one names its predecessor.
create unique index competitor_snapshots_first_key
  on ouroboros.competitor_snapshots (watch_id) where previous_id is null;

-- A watch's history, newest first (#616's `changes(rival, window)`).
create index competitor_snapshots_watch_taken_idx
  on ouroboros.competitor_snapshots (watch_id, taken_at desc);

-- A successor is later than its predecessor, and carries a diff exactly when the content changed.
create function ouroboros.competitor_snapshots_chain()
returns trigger language plpgsql as $$
declare
  previous ouroboros.competitor_snapshots;
begin
  if new.previous_id is null then
    return new;
  end if;
  select * into previous from ouroboros.competitor_snapshots p
   where p.id = new.previous_id and p.watch_id = new.watch_id;
  if not found then
    -- competitor_snapshots_previous_fk reports it.
    return new;
  end if;
  if new.taken_at <= previous.taken_at then
    raise exception 'snapshot taken at % is not after its previous snapshot, taken at %',
      new.taken_at, previous.taken_at
      using errcode = 'check_violation', constraint = 'competitor_snapshots_chain';
  end if;
  if (new.content_hash <> previous.content_hash) <> (new.diff is not null) then
    raise exception 'a snapshot carries a diff exactly when its content changed (changed: %, diff: %)',
      new.content_hash <> previous.content_hash, new.diff is not null
      using errcode = 'check_violation', constraint = 'competitor_snapshots_chain';
  end if;
  return new;
end;
$$;

comment on function ouroboros.competitor_snapshots_chain() is
  'Refuses a snapshot taken no later than its previous one, or one whose diff is present when the content hash did not change or absent when it did (#610).';

create trigger competitor_snapshots_chain
  before insert on ouroboros.competitor_snapshots
  for each row execute function ouroboros.competitor_snapshots_chain();

-- The watch says when it was last looked at.
create function ouroboros.competitor_snapshots_touch_watch()
returns trigger language plpgsql as $$
begin
  update ouroboros.competitor_watches w
     set last_snapshot_at = new.taken_at
   where w.id = new.watch_id
     and (w.last_snapshot_at is null or w.last_snapshot_at < new.taken_at);
  return null;
end;
$$;

comment on function ouroboros.competitor_snapshots_touch_watch() is
  'Moves competitor_watches.last_snapshot_at forward to a new snapshot''s taken_at (#610).';

create trigger competitor_snapshots_touch_watch
  after insert on ouroboros.competitor_snapshots
  for each row execute function ouroboros.competitor_snapshots_touch_watch();

-- V108's archive rule: a snapshot is the record of what was read at the time.
create trigger competitor_snapshots_immutable
  before update on ouroboros.competitor_snapshots
  for each row execute function ouroboros.citation_ledger_refuse_update();

-- ---------------------------------------------------------------------------
-- source_records.snapshot_id — a competitor_diff source cites an archived diff.
-- ---------------------------------------------------------------------------
--
-- No action on delete, so a cited snapshot (and the watch and rival above it) cannot be deleted
-- out from under the ledger. Deferred to commit: a workspace delete reaches the snapshot through
-- its rivals and the source through its investigations, two cascades that PostgreSQL checks one
-- at a time, and only at commit are both sides gone. A competitor_diff source must name a
-- snapshot and only it may: V108 has no writer of that kind yet (#616 is the first), so no
-- existing row is affected.
alter table ouroboros.source_records
  add column snapshot_id uuid,
  add constraint source_records_snapshot_fk
    foreign key (snapshot_id) references ouroboros.competitor_snapshots (id)
    deferrable initially deferred,
  add constraint source_records_competitor_diff_snapshot
    check ((kind = 'competitor_diff') = (snapshot_id is not null));

comment on column ouroboros.source_records.snapshot_id is
  'The competitor_snapshots row whose diff a competitor_diff source cites (#610, decision V9) — required for that kind, absent for every other. The snapshot has a diff and belongs to the investigation''s workspace.';

create index source_records_snapshot_idx
  on ouroboros.source_records (snapshot_id) where snapshot_id is not null;

-- The cited snapshot is a diff, of the investigation's own workspace.
create function ouroboros.source_records_snapshot_cited()
returns trigger language plpgsql as $$
begin
  if new.snapshot_id is null then
    return new;
  end if;
  if not exists (select 1
                   from ouroboros.competitor_snapshots s
                   join ouroboros.competitor_watches w on w.id = s.watch_id
                   join ouroboros.competitors c        on c.id = w.competitor_id
                   join ouroboros.investigations i     on i.organization_id = c.organization_id
                  where s.id = new.snapshot_id and s.diff is not null
                    and i.id = new.investigation_id) then
    raise exception 'source cites snapshot %, which is not a diff of investigation %''s workspace',
      new.snapshot_id, new.investigation_id
      using errcode = 'check_violation', constraint = 'source_records_snapshot_cited',
            hint = 'A competitor_diff source cites the snapshot that carries the diff — the second of two (decision V9).';
  end if;
  return new;
end;
$$;

comment on function ouroboros.source_records_snapshot_cited() is
  'Refuses a source whose snapshot_id names a snapshot with no diff, or one of another workspace''s rivals (#610).';

create trigger source_records_snapshot_cited
  before insert on ouroboros.source_records
  for each row execute function ouroboros.source_records_snapshot_cited();

-- ---------------------------------------------------------------------------
-- capability_matrices — one per investigation.
-- ---------------------------------------------------------------------------
create table ouroboros.capability_matrices (
  id               uuid        primary key default gen_random_uuid(),

  -- The investigation whose deliverable it is. Cascade: the matrix is the investigation's.
  investigation_id uuid        not null
                               references ouroboros.investigations (id) on delete cascade,

  title            text        not null
                               constraint capability_matrices_title_present
                                 check (btrim(title) <> '' and length(title) <= 200),

  -- The first column's name — "Helios"; the card adds "(us)".
  us_label         text        not null
                               constraint capability_matrices_us_label_present
                                 check (btrim(us_label) <> '' and length(us_label) <= 120),

  -- The rival columns, left to right: competitors of the investigation's workspace, distinct
  -- (capability_matrices_rivals_valid).
  rivals           uuid[]      not null
                               constraint capability_matrices_rivals_bounded
                                 check (cardinality(rivals) between 1 and 12
                                        and array_position(rivals, null) is null),

  created_at       timestamptz not null default now(),

  constraint capability_matrices_investigation_key unique (investigation_id),

  -- The target of matrix_cells' composite key.
  constraint capability_matrices_id_investigation_key unique (id, investigation_id)
);

comment on table ouroboros.capability_matrices is
  'An investigation''s capability matrix (#610, CK.3; decision V7): a title, the us column''s label and the rival columns in order. At most one per investigation.';
comment on column ouroboros.capability_matrices.us_label is
  'The us column''s header — "Helios"; rendered "Helios (us)".';
comment on column ouroboros.capability_matrices.rivals is
  'The rival columns, left to right: distinct competitors of the investigation''s workspace, 1 to 12.';

-- The rival columns are distinct rivals of the investigation's own workspace.
create function ouroboros.capability_matrices_rivals_valid()
returns trigger language plpgsql as $$
begin
  if (select count(distinct r) from unnest(new.rivals) r) <> cardinality(new.rivals)
     or exists (select 1 from unnest(new.rivals) r
                 where not exists (select 1
                                     from ouroboros.competitors c
                                     join ouroboros.investigations i on i.organization_id = c.organization_id
                                    where c.id = r and i.id = new.investigation_id)) then
    raise exception 'matrix rivals must be distinct competitors of investigation %''s workspace',
      new.investigation_id
      using errcode = 'check_violation', constraint = 'capability_matrices_rivals_valid';
  end if;
  return new;
end;
$$;

comment on function ouroboros.capability_matrices_rivals_valid() is
  'Refuses matrix rival columns that repeat a competitor or name one outside the investigation''s workspace (#610).';

create trigger capability_matrices_rivals_valid
  before insert or update of rivals, investigation_id on ouroboros.capability_matrices
  for each row execute function ouroboros.capability_matrices_rivals_valid();

-- ---------------------------------------------------------------------------
-- matrix_rows — the capabilities, in order, each with its gap.
-- ---------------------------------------------------------------------------
create table ouroboros.matrix_rows (
  id                  uuid        primary key default gen_random_uuid(),

  matrix_id           uuid        not null
                                  references ouroboros.capability_matrices (id) on delete cascade,

  -- "Docking in >8 m/s gusts".
  capability          text        not null
                                  constraint matrix_rows_capability_present
                                    check (btrim(capability) <> '' and length(capability) <= 200),

  -- Top to bottom.
  sort_order          integer     not null
                                  constraint matrix_rows_sort_order_nonnegative
                                    check (sort_order >= 0),

  gap_severity        text        not null
                                  constraint matrix_rows_gap_severity
                                    check (gap_severity in ('high', 'med', 'low', 'wip', 'lead')),

  -- The inputs that produced the severity — never stored without them.
  severity_derivation text        not null
                                  constraint matrix_rows_severity_derivation_present
                                    check (btrim(severity_derivation) <> ''
                                           and length(severity_derivation) <= 1000),

  created_at          timestamptz not null default now(),

  constraint matrix_rows_matrix_sort_key unique (matrix_id, sort_order),
  constraint matrix_rows_matrix_capability_key unique (matrix_id, capability),

  -- The target of matrix_cells' composite key.
  constraint matrix_rows_id_matrix_key unique (id, matrix_id)
);

comment on table ouroboros.matrix_rows is
  'A capability matrix''s rows (#610, CK.3; decision V7): the capability, its position, and the gap severity stored with the derivation that produced it. Every row has one cell per subject by commit (matrix_rows_complete).';
comment on column ouroboros.matrix_rows.gap_severity is
  'high | med | low | wip | lead — the distance from the best rival; rendered HIGH, MED, LOW, WIP, LEAD.';
comment on column ouroboros.matrix_rows.severity_derivation is
  'The inputs the severity was derived from (us vs best rival, and what else weighed). Changes whenever the severity does.';

-- A severity is a conclusion; a new one needs the derivation that reached it.
create function ouroboros.matrix_rows_severity_rederived()
returns trigger language plpgsql as $$
begin
  if new.gap_severity <> old.gap_severity
     and new.severity_derivation = old.severity_derivation then
    raise exception 'row % changes severity % → % without a new derivation',
      new.id, old.gap_severity, new.gap_severity
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.matrix_rows_severity_rederived() is
  'Refuses a change of gap_severity that keeps the old severity_derivation (#610).';

create trigger matrix_rows_severity_rederived
  before update on ouroboros.matrix_rows
  for each row execute function ouroboros.matrix_rows_severity_rederived();

-- ---------------------------------------------------------------------------
-- matrix_cells — one per row and subject.
-- ---------------------------------------------------------------------------
create table ouroboros.matrix_cells (
  id               uuid        primary key default gen_random_uuid(),

  -- Carried so the keys below can be composite on them — see the header.
  investigation_id uuid        not null,
  matrix_id        uuid        not null,

  row_id           uuid        not null,

  -- The subject: null is us, otherwise one of the matrix's rivals (matrix_cells_subject_in_matrix).
  -- No action on delete — a rival a matrix cites cannot be removed from under it — checked at
  -- commit, for source_records_snapshot_fk's reason: a workspace delete reaches the rival and the
  -- cell by two cascades.
  competitor_id    uuid,

  status           text        not null
                               constraint matrix_cells_status
                                 check (status in ('shipping', 'partial', 'none', 'unknown', 'wip')),

  -- The label beside the glyph when it is not the status — "in flight", "beta".
  note             text
                   constraint matrix_cells_note_present
                     check (btrim(note) <> '' and length(note) <= 60),

  created_at       timestamptz not null default now(),

  constraint matrix_cells_row_fk
    foreign key (row_id, matrix_id)
    references ouroboros.matrix_rows (id, matrix_id) on delete cascade,
  constraint matrix_cells_matrix_fk
    foreign key (matrix_id, investigation_id)
    references ouroboros.capability_matrices (id, investigation_id) on delete cascade,
  constraint matrix_cells_competitor_fk
    foreign key (competitor_id) references ouroboros.competitors (id)
    deferrable initially deferred,

  constraint matrix_cells_row_subject_key unique nulls not distinct (row_id, competitor_id),

  -- The target of matrix_cell_sources' composite key.
  constraint matrix_cells_investigation_id_key unique (investigation_id, id)
);

comment on table ouroboros.matrix_cells is
  'A capability matrix''s cells (#610, CK.3; decision V7): one per row and subject — us (competitor_id null) or a rival column. Status shipping | partial | none | unknown | wip; anything but unknown is cited by commit (matrix_cells_cited).';
comment on column ouroboros.matrix_cells.competitor_id is
  'The subject: null for us, else one of the matrix''s rivals.';
comment on column ouroboros.matrix_cells.status is
  'shipping ● | partial ◐ | none ○ | unknown ? | wip ◐. unknown is the honest "we did not find out" and needs no citation; every other status needs one.';
comment on column ouroboros.matrix_cells.note is
  'The label shown in place of the status word — "in flight", "beta".';

-- "Which matrices name this rival?" — and the foreign key's delete check.
create index matrix_cells_competitor_idx
  on ouroboros.matrix_cells (competitor_id) where competitor_id is not null;

-- A rival cell is one of its matrix's columns.
create function ouroboros.matrix_cells_subject_in_matrix()
returns trigger language plpgsql as $$
begin
  if new.competitor_id is not null
     and not exists (select 1 from ouroboros.capability_matrices m
                      where m.id = new.matrix_id and new.competitor_id = any (m.rivals)) then
    raise exception 'competitor % is not a column of matrix %', new.competitor_id, new.matrix_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.matrix_cells_subject_in_matrix() is
  'Refuses a cell whose competitor is not one of its matrix''s rival columns (#610).';

create trigger matrix_cells_subject_in_matrix
  before insert or update of competitor_id, matrix_id on ouroboros.matrix_cells
  for each row execute function ouroboros.matrix_cells_subject_in_matrix();

-- ---------------------------------------------------------------------------
-- matrix_cell_sources — the citations behind a cell.
-- ---------------------------------------------------------------------------
create table ouroboros.matrix_cell_sources (
  investigation_id uuid not null,
  cell_id          uuid not null,
  source_id        uuid not null,

  constraint matrix_cell_sources_pkey primary key (cell_id, source_id),

  constraint matrix_cell_sources_cell_fk
    foreign key (investigation_id, cell_id)
    references ouroboros.matrix_cells (investigation_id, id) on delete cascade,

  constraint matrix_cell_sources_source_fk
    foreign key (investigation_id, source_id)
    references ouroboros.source_records (investigation_id, id) on delete cascade
);

comment on table ouroboros.matrix_cell_sources is
  'Citation links for capability matrix cells (#610, CK.3): a cell cites sources of its own investigation, many to many. A cell that is not unknown keeps at least one (matrix_cells_cited).';

-- "Which cells does [12] back?" — the reverse of the primary key.
create index matrix_cell_sources_source_idx
  on ouroboros.matrix_cell_sources (source_id);

-- ---------------------------------------------------------------------------
-- The deferred rules — checked at commit, because each spans tables written one after the other.
-- ---------------------------------------------------------------------------

-- A cell that is not unknown is cited. Fires for a cell written or re-statused, and for a link
-- removed. A cell no longer present — its matrix or investigation deleted in the same transaction
-- — has nothing left to cite.
create function ouroboros.matrix_cells_cited()
returns trigger language plpgsql as $$
declare
  checked uuid;
begin
  -- Two statements rather than one CASE: PL/pgSQL plans an expression against the firing table's
  -- row type, and a matrix_cells row has no cell_id.
  if tg_table_name = 'matrix_cells' then
    checked := new.id;
  else
    checked := old.cell_id;
  end if;

  if exists (select 1 from ouroboros.matrix_cells c where c.id = checked and c.status <> 'unknown')
     and not exists (select 1 from ouroboros.matrix_cell_sources l where l.cell_id = checked) then
    raise exception 'matrix cell % states a status with no citation — an uncited cell is unknown', checked
      using errcode = 'check_violation', constraint = 'matrix_cells_cited',
            hint = 'Link at least one source_records row through matrix_cell_sources, or write the cell as unknown (decision V7).';
  end if;
  return null;
end;
$$;

comment on function ouroboros.matrix_cells_cited() is
  'Deferred to commit (#610, decision V7): refuses a matrix cell whose status is not unknown and that has no matrix_cell_sources link — written without one, moved off unknown, or stripped of its last.';

create constraint trigger matrix_cells_cited
  after insert or update of status on ouroboros.matrix_cells
  deferrable initially deferred
  for each row execute function ouroboros.matrix_cells_cited();

create constraint trigger matrix_cell_sources_cited
  after delete on ouroboros.matrix_cell_sources
  deferrable initially deferred
  for each row execute function ouroboros.matrix_cells_cited();

-- Every row has one cell per subject: us and each rival column. Fires for a row written, a cell
-- removed or moved, and the columns changed. A row or matrix no longer present has nothing to
-- check.
create function ouroboros.matrix_rows_complete()
returns trigger language plpgsql as $$
declare
  checked_matrix uuid;
  checked_row    uuid;
  incomplete     record;
begin
  if tg_table_name = 'matrix_rows' then
    checked_matrix := new.matrix_id;
    checked_row := new.id;
  elsif tg_table_name = 'matrix_cells' then
    checked_matrix := old.matrix_id;
    checked_row := old.row_id;
  else
    checked_matrix := new.id;
  end if;

  select r.capability, m.id as matrix_id into incomplete
    from ouroboros.matrix_rows r
    join ouroboros.capability_matrices m on m.id = r.matrix_id
   where r.matrix_id = checked_matrix
     and (checked_row is null or r.id = checked_row)
     and ((select count(*) from ouroboros.matrix_cells c
            where c.row_id = r.id
              and (c.competitor_id is null or c.competitor_id = any (m.rivals)))
          <> 1 + cardinality(m.rivals)
          -- A cell left behind for a column the matrix no longer has.
          or exists (select 1 from ouroboros.matrix_cells c
                      where c.row_id = r.id and c.competitor_id <> all (m.rivals)))
   limit 1;

  if found then
    raise exception 'matrix % row "%" lacks a cell for one of its subjects — a blank is not an answer',
      incomplete.matrix_id, incomplete.capability
      using errcode = 'check_violation', constraint = 'matrix_rows_complete',
            hint = 'Write one cell per subject (us and every rival column); an unanswered one is unknown (decision V7).';
  end if;
  return null;
end;
$$;

comment on function ouroboros.matrix_rows_complete() is
  'Deferred to commit (#610, decision V7): refuses a matrix row without exactly one cell for us and each rival column of its matrix — after a row is written, a cell removed or moved, or the columns changed.';

create constraint trigger matrix_rows_complete
  after insert on ouroboros.matrix_rows
  deferrable initially deferred
  for each row execute function ouroboros.matrix_rows_complete();

create constraint trigger matrix_cells_complete
  after delete or update of row_id, competitor_id on ouroboros.matrix_cells
  deferrable initially deferred
  for each row execute function ouroboros.matrix_rows_complete();

create constraint trigger capability_matrices_complete
  after update of rivals on ouroboros.capability_matrices
  deferrable initially deferred
  for each row execute function ouroboros.matrix_rows_complete();

-- ---------------------------------------------------------------------------
-- competitor_tracker_summary — the tracker's sub-line, from the registry.
-- ---------------------------------------------------------------------------
--
-- `4 rivals watched · release notes, changelogs, filings`: a rival is watched when it has an
-- enabled watch v1 can fetch (not render_required), and the kinds are those watches' kinds in the
-- vocabulary's order. A workspace with nothing watched has no row.
create view ouroboros.competitor_tracker_summary
  with (security_invoker = true) as
select s.organization_id, s.rivals_watched, s.watches_enabled, s.source_kinds,
       s.rivals_watched || case when s.rivals_watched = 1 then ' rival' else ' rivals' end
         || ' watched · '
         || array_to_string(array(select ouroboros.competitor_source_kind_label(k)
                                    from unnest(s.source_kinds) with ordinality as u(k, ord)
                                   order by u.ord), ', ')
         as sub_line
  from (select c.organization_id,
               count(distinct c.id)::integer as rivals_watched,
               count(*)::integer             as watches_enabled,
               -- The kinds present, in the vocabulary's order (array_agg is the outer query's).
               array(select v.kind
                       from unnest(array['release_notes', 'changelog', 'github_releases', 'rss',
                                         'filings', 'page']) with ordinality as v(kind, ord)
                      where v.kind = any (array_agg(w.source_kind))
                      order by v.ord)        as source_kinds
          from ouroboros.competitors c
          join ouroboros.competitor_watches w on w.competitor_id = c.id
                                             and w.enabled and not w.render_required
         group by c.organization_id) s;

comment on view ouroboros.competitor_tracker_summary is
  'The competitor tracker''s sub-line per workspace (#610, CK.3) — rivals with an enabled, fetchable watch, the enabled watches, their source kinds in vocabulary order, and the rendered "4 rivals watched · release notes, changelogs, filings". render_required and disabled watches are not counted.';

-- ---------------------------------------------------------------------------
-- The application role.
--
-- The registry is managed (#616's CRUD); snapshots are an archive, written and read; the matrix is
-- built and revised but not deleted piecemeal — a citation link may be removed, the deferred rule
-- holding what remains.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on ouroboros.competitors to ouroboros_app;
grant select, insert, update, delete on ouroboros.competitor_watches to ouroboros_app;
grant select, insert on ouroboros.competitor_snapshots to ouroboros_app;
grant select, insert, update on ouroboros.capability_matrices to ouroboros_app;
grant select, insert, update on ouroboros.matrix_rows to ouroboros_app;
grant select, insert, update on ouroboros.matrix_cells to ouroboros_app;
grant select, insert, delete on ouroboros.matrix_cell_sources to ouroboros_app;
grant select on ouroboros.competitor_tracker_summary to ouroboros_app;
