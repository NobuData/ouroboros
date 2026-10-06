-- V108__citation_ledger.sql — the Research domain's citation ledger: the sources an investigation
-- archived, the versioned briefs it wrote, the claims in them, and which sources back which claim
-- (#609, CK.2).
--
-- Mockup 22's brief excerpt and its sources card are one promise — *every claim cited*:
--
--   "…the gap is control, not sensors[07] — Skylink applies wind-feedforward MPC in the final
--    2 m[12][31], while our approach controller has been unchanged in 14 months[git]"
--
--   SOURCES — 44 CITED
--   [07]  Skylink S4 docking module — teardown & sensor BOM    droneanalysts.example.com/s4-teardown
--   [19]  Churn interviews Q2 — 9 of 14 cite docking reliability  issue-index://support/churn-2026-q2
--   [git] dock_ctrl.c blame — gains last tuned 14 months ago   helios-firmware @ 8c1b2e4 · src/dock/dock_ctrl.c
--
-- This migration makes that promise structural (decision V3):
--
--   1. **`source_records`** — one archived source: the adapter that produced it, its kind, a
--      title, a **locator** validated per kind (an external URL, or an internal `issue-index://`,
--      `git://` or `telemetry://` URI with the same standing), when it was read, a **content
--      hash** of what was read, a **bounded excerpt** of it, and the `meta` that makes it
--      reproducible. A link is not a citation — what the product stands behind is what it
--      archived, so a record is never edited.
--   2. **`briefs`** — the investigation's brief, versioned: version 1, 2, … with the highest
--      current. The body is structured — paragraphs of spans, a span optionally naming the claim
--      it states — never free markdown, so a citation marker is rendered from data, not parsed.
--   3. **`brief_claims`** — each claim span: `finding` or `open_question`.
--   4. **`brief_claim_sources`** — which sources back which claim; many to many.
--   5. **`source_cite_counters`** — the per-investigation counter `cite_no` is drawn from, and the
--      running total of archived bytes the ledger's caps are checked against.
--
-- ---------------------------------------------------------------------------
-- Cite numbers: dense, stable, and coexisting with symbolic keys
-- ---------------------------------------------------------------------------
--
-- `[07]` appears in the brief and in the panel, and the two must agree on every render. So the
-- number is **stored**, on the record, at write — never computed from an ordering at read time,
-- which a new source would shift. `source_records_allocate_cite_no()` draws it from the
-- investigation's counter row, V106's mechanism for `RS-###`: concurrent writers serialise on
-- the row, a rollback returns its number, and the counter only moves forward. A supplied number
-- must be exactly the next one, so a seed can state `[07]` and still not leave a gap. Records
-- are never updated (`source_records_immutable`), so a number, once given, names that source
-- for good.
--
-- `[git]` is a `cite_key`: a symbolic alias a record may carry *as well as* its number, unique
-- per investigation. The panel renders the key where there is one.
--
-- ---------------------------------------------------------------------------
-- Archival bounds — a ledger, not a page cache
-- ---------------------------------------------------------------------------
--
--   bound                                    limit        enforced by
--   ---------------------------------------  -----------  ------------------------------------
--   one record's excerpt                     4 096 bytes  source_records_excerpt_bounded
--   one record's meta                        8 192 bytes  source_records_meta_shape
--   records per investigation                1 000        source_records_allocate_cite_no()
--   excerpt bytes per investigation          2 MiB        source_records_allocate_cite_no()
--
-- An excerpt is the passage a claim leans on, not the page; the content hash covers the whole of
-- what was read, so the excerpt can be short without the citation becoming unverifiable. RS-124's
-- 312 sources (mockup 22's largest) sit well inside both totals.
--
-- ---------------------------------------------------------------------------
-- The discipline: a finding is cited
-- ---------------------------------------------------------------------------
--
-- *"A claim without a citation cannot render as a finding"* (V3). The rule spans two tables — a
-- claim and its links are separate rows, written one after the other — so it cannot be a CHECK.
-- It is a **deferred constraint trigger**, `brief_claims_finding_cited`: at commit, every
-- `finding` claim written or un-linked in the transaction must have at least one link. Any
-- writer — REST, the engine, a seed — is held to it; an uncited candidate has to be written as
-- an `open_question` instead (#620's demotion path).
--
-- V106 left one more deferred rule here: `investigations_brief_exists` — an investigation is
-- `brief_ready` (or `issues_filed`, which follows it) only with a brief.
--
-- ---------------------------------------------------------------------------
-- One investigation per link
-- ---------------------------------------------------------------------------
--
-- Claims and links carry `investigation_id`, and every foreign key between the four tables is
-- composite on it, so a claim can cite only its own investigation's sources and a claim can
-- belong only to a brief of its own investigation. Workspace isolation follows from the
-- investigation, which is the workspace's.
--
-- Revert forward:
--   drop trigger investigations_brief_exists on ouroboros.investigations;
--   drop table ouroboros.brief_claim_sources, ouroboros.brief_claims, ouroboros.briefs,
--              ouroboros.source_records, ouroboros.source_cite_counters;
--   then drop every function this file creates.

-- ---------------------------------------------------------------------------
-- Shape helpers.
-- ---------------------------------------------------------------------------

-- source_locator_valid(kind, locator) — whether a locator is well-formed for its record kind.
--   kind    — web | competitor_diff | code | ticket | telemetry | doc
--   locator — the URL or internal URI
--   returns true when the locator matches the kind's pattern:
--     web, competitor_diff, doc  https?://host/…
--     ticket                     issue-index://<index>/<key>[/…], or an https?:// URL
--     code                       git://<repo>[/<repo>]@<sha, 7–40 hex>[/<path>][#L<n>[-L<m>]]
--     telemetry                  telemetry://<metric>[/<metric>…]/<window>, the window <n>h|d|w
--                                or <date>[T<time>Z]..<date>[T<time>Z]
create function ouroboros.source_locator_valid(kind text, locator text)
returns boolean language sql immutable as $$
  select coalesce(length(locator) <= 2048 and locator !~ '\s' and case kind
    when 'web'             then locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'competitor_diff' then locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'doc'             then locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'ticket'          then locator ~ '^issue-index://[a-z0-9][a-z0-9_-]*(/[A-Za-z0-9._#-]+)+$'
                             or locator ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'
    when 'code'            then locator ~ '^git://[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)?@[0-9a-f]{7,40}(/[A-Za-z0-9._-]+)*(#L[1-9][0-9]*(-L[1-9][0-9]*)?)?$'
                             and locator !~ '/\.\.?(/|#|$)'
    when 'telemetry'       then locator ~ '^telemetry://[a-z0-9][a-z0-9_.-]*(/[a-z0-9][a-z0-9_.-]*)*/([1-9][0-9]*[hdw]|[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z)?\.\.[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?Z)?)$'
    else false
  end, false);
$$;

comment on function ouroboros.source_locator_valid(text, text) is
  'True when a source locator is well-formed for its kind (#609): web/competitor_diff/doc an http(s) URL; ticket issue-index://<index>/<key> or an http(s) URL; code git://<repo>@<sha>[/<path>][#L<n>[-L<m>]]; telemetry telemetry://<metric>/<window> (<n>h|d|w or <date>..<date>). At most 2048 characters, no whitespace.';

-- brief_body_valid(body) — whether a brief body is exactly {paragraphs: [{spans: [span…]}…]},
-- where a span is {text} or {text, claim}: text non-blank, claim a span ref
-- (`^[a-z0-9][a-z0-9_-]{0,31}$`) used at most once in the body.
--   body — the jsonb value to inspect
--   returns true when it is a well-formed body with at least one paragraph of at least one span
create function ouroboros.brief_body_valid(body jsonb)
returns boolean language plpgsql immutable as $$
declare
  paragraph jsonb;
  span      jsonb;
  refs      text[] := '{}';
begin
  if not ouroboros.jsonb_keys_are(body, array['paragraphs'])
     or jsonb_typeof(body -> 'paragraphs') <> 'array'
     or jsonb_array_length(body -> 'paragraphs') = 0 then
    return false;
  end if;
  for paragraph in select p from jsonb_array_elements(body -> 'paragraphs') p loop
    if not ouroboros.jsonb_keys_are(paragraph, array['spans'])
       or jsonb_typeof(paragraph -> 'spans') <> 'array'
       or jsonb_array_length(paragraph -> 'spans') = 0 then
      return false;
    end if;
    for span in select s from jsonb_array_elements(paragraph -> 'spans') s loop
      if ouroboros.jsonb_keys_are(span, array['text', 'claim']) then
        if jsonb_typeof(span -> 'claim') <> 'string'
           or (span ->> 'claim') !~ '^[a-z0-9][a-z0-9_-]{0,31}$'
           or (span ->> 'claim') = any (refs) then
          return false;
        end if;
        refs := refs || (span ->> 'claim');
      elsif not ouroboros.jsonb_keys_are(span, array['text']) then
        return false;
      end if;
      if not ouroboros.jsonb_nonblank_string(span -> 'text') then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

comment on function ouroboros.brief_body_valid(jsonb) is
  'True when a brief body is exactly {paragraphs: [{spans: [{text} | {text, claim}]}]} — non-empty at each level, text non-blank, each claim span ref well-formed and unique in the body (#609).';

-- brief_body_claim_refs(body) — the claim span refs a brief body names, in reading order.
--   body — a brief body (anything else yields no refs)
--   returns the refs; empty when the body names none
create function ouroboros.brief_body_claim_refs(body jsonb)
returns text[] language sql immutable as $$
  select coalesce(array_agg(s ->> 'claim' order by p.i, x.j), '{}')
    from jsonb_array_elements(case when jsonb_typeof(body -> 'paragraphs') = 'array'
                                   then body -> 'paragraphs' else '[]'::jsonb end)
         with ordinality as p(paragraph, i),
         jsonb_array_elements(case when jsonb_typeof(p.paragraph -> 'spans') = 'array'
                                   then p.paragraph -> 'spans' else '[]'::jsonb end)
         with ordinality as x(s, j)
   where jsonb_typeof(x.s) = 'object' and x.s ? 'claim';
$$;

comment on function ouroboros.brief_body_claim_refs(jsonb) is
  'The claim span refs a brief body names, in reading order (#609).';

-- brief_deliverables_valid(deliverables) — whether a brief's deliverable refs are an object whose
-- keys are deliverables a playbook can produce besides the brief itself (matrix, draft_batch,
-- roadmap_doc, fix_draft) and whose values are non-blank refs.
--   deliverables — the jsonb value to inspect
--   returns true when well-formed (the empty object included)
create function ouroboros.brief_deliverables_valid(deliverables jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(deliverables) is distinct from 'object' then
    return false;
  end if;
  return not exists (select 1 from jsonb_each(deliverables) d
                      where d.key not in ('matrix', 'draft_batch', 'roadmap_doc', 'fix_draft')
                         or not ouroboros.jsonb_nonblank_string(d.value));
end;
$$;

comment on function ouroboros.brief_deliverables_valid(jsonb) is
  'True when a brief''s deliverables are an object of {matrix | draft_batch | roadmap_doc | fix_draft: non-blank ref} (#609).';

-- ---------------------------------------------------------------------------
-- source_cite_counters — the per-investigation cite counter and archive total.
-- ---------------------------------------------------------------------------
create table ouroboros.source_cite_counters (
  investigation_id uuid    primary key
                           references ouroboros.investigations (id) on delete cascade,

  -- The highest cite_no handed out in this investigation. Only ever rises.
  last_cite_no     integer not null
                           constraint source_cite_counters_last_cite_no_positive
                             check (last_cite_no >= 1),

  -- The excerpt bytes archived in this investigation so far.
  excerpt_bytes    bigint  not null default 0
                           constraint source_cite_counters_excerpt_bytes_nonnegative
                             check (excerpt_bytes >= 0)
);

comment on table ouroboros.source_cite_counters is
  'The per-investigation counter source_records.cite_no is drawn from, and the excerpt bytes archived so far (#609). Bumped inside the writing transaction, so concurrent writers serialise, a rollback returns its number, and numbers stay dense.';

-- ---------------------------------------------------------------------------
-- source_records — the archived sources.
-- ---------------------------------------------------------------------------
create table ouroboros.source_records (
  id               uuid        primary key default gen_random_uuid(),

  -- The investigation that read it. Cascade: the ledger is the investigation's.
  investigation_id uuid        not null
                               references ouroboros.investigations (id) on delete cascade,

  -- The adapter that produced it (CL.1's SPI) — a registered research_tools slug.
  tool_slug        text        not null
                               references ouroboros.research_tools (slug),

  kind             text        not null
                               constraint source_records_kind
                                 check (kind in ('web', 'competitor_diff', 'code', 'ticket',
                                                 'telemetry', 'doc')),

  -- The panel's title — "Skylink S4 docking module — teardown & sensor BOM".
  title            text        not null
                               constraint source_records_title_present
                                 check (btrim(title) <> '' and length(title) <= 300),

  -- Where it came from: an external URL or an internal URI, validated per kind.
  locator          text        not null,

  -- When it was read.
  retrieved_at     timestamptz not null,

  -- A digest of everything that was read, so the archive is provably unedited:
  -- sha256:<64 hex>.
  content_hash     text        not null
                               constraint source_records_content_hash_format
                                 check (content_hash ~ '^sha256:[0-9a-f]{64}$'),

  -- The archived extract a claim leans on — bounded (see the header).
  excerpt          text        not null
                               constraint source_records_excerpt_bounded
                                 check (btrim(excerpt) <> '' and octet_length(excerpt) <= 4096),

  -- Whatever makes the citation reproducible: the query, the window, the selector, job refs.
  meta             jsonb       not null default '{}'
                               constraint source_records_meta_shape
                                 check (jsonb_typeof(meta) = 'object'
                                        and octet_length(meta::text) <= 8192),

  -- The 07 of [07]: dense per investigation, allocated by source_records_allocate_cite_no().
  cite_no          integer     not null
                               constraint source_records_cite_no_positive check (cite_no >= 1),

  -- The git of [git]: an optional symbolic alias. Starts with a letter, so it never reads as a
  -- number.
  cite_key         text
                   constraint source_records_cite_key_format
                     check (cite_key ~ '^[a-z][a-z0-9_-]{0,15}$'),

  created_at       timestamptz not null default now(),

  constraint source_records_locator_valid
    check (ouroboros.source_locator_valid(kind, locator)),

  -- The panel, in order — and the uniqueness that makes [07] mean one thing.
  constraint source_records_investigation_cite_no_key unique (investigation_id, cite_no),
  constraint source_records_investigation_cite_key_key unique (investigation_id, cite_key),

  -- The target of brief_claim_sources' composite key.
  constraint source_records_investigation_id_key unique (investigation_id, id)
);

comment on table ouroboros.source_records is
  'The citation ledger (#609, CK.2; decision V3): one archived source per row — the adapter that read it, its kind, title, locator (URL or internal URI, validated per kind), when it was read, a content hash, a bounded excerpt and the meta that reproduces it. Numbered [cite_no] densely per investigation, optionally aliased [cite_key]. Never updated.';
comment on column ouroboros.source_records.tool_slug is
  'The research_tools slug of the adapter that produced the record.';
comment on column ouroboros.source_records.kind is
  'web | competitor_diff | code | ticket | telemetry | doc.';
comment on column ouroboros.source_records.locator is
  'An http(s) URL, or an internal URI with the same standing: issue-index://<index>/<key>, git://<repo>@<sha>/<path>#L<n>, telemetry://<metric>/<window>. Validated per kind (source_locator_valid).';
comment on column ouroboros.source_records.content_hash is
  'sha256:<hex> of everything that was read — the proof the archive has not been edited since.';
comment on column ouroboros.source_records.excerpt is
  'The archived extract, at most 4096 bytes; at most 2 MiB per investigation in all.';
comment on column ouroboros.source_records.meta is
  'What makes the citation reproducible — query, window, selector, job refs. An object of at most 8192 bytes.';
comment on column ouroboros.source_records.cite_no is
  'The [07] number: dense per investigation from 1, allocated at write, never changed.';
comment on column ouroboros.source_records.cite_key is
  'A symbolic alias such as [git], unique per investigation; the panel renders it where present.';

-- The ledger filters (investigation + kind) and cross-tool dedup (content_hash). The panel reads
-- source_records_investigation_cite_no_key.
create index source_records_investigation_kind_idx
  on ouroboros.source_records (investigation_id, kind);
create index source_records_content_hash_idx
  on ouroboros.source_records (content_hash);

-- --- cite_no allocation and the archive caps -------------------------------------
--
-- The counter row is the lock, V106's argument. `security definer` because the application role
-- has no grant on the counter; the search_path is pinned, every name is qualified, and `execute`
-- is revoked from public below.
create function ouroboros.source_records_allocate_cite_no()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  allocated integer;
  archived  bigint;
begin
  insert into ouroboros.source_cite_counters as c (investigation_id, last_cite_no, excerpt_bytes)
  values (new.investigation_id, 1, octet_length(new.excerpt))
  on conflict (investigation_id) do update
    set last_cite_no = c.last_cite_no + 1,
        excerpt_bytes = c.excerpt_bytes + octet_length(new.excerpt)
  returning c.last_cite_no, c.excerpt_bytes into allocated, archived;

  -- A supplied number keeps the ledger dense only if it is the one the counter would give.
  if new.cite_no is not null and new.cite_no <> allocated then
    raise exception 'source [%] of investigation % is not the next cite number, % — cite numbers are dense',
      new.cite_no, new.investigation_id, allocated
      using errcode = 'check_violation', constraint = 'source_records_cite_no_dense';
  end if;
  new.cite_no := allocated;

  if allocated > 1000 then
    raise exception 'investigation % already archives 1000 sources', new.investigation_id
      using errcode = 'check_violation', constraint = 'source_records_investigation_cap';
  end if;

  if archived > 2097152 then
    raise exception 'investigation % would archive % excerpt bytes, past the 2 MiB cap',
      new.investigation_id, archived
      using errcode = 'check_violation', constraint = 'source_records_investigation_cap';
  end if;

  return new;
end;
$$;

comment on function ouroboros.source_records_allocate_cite_no() is
  'Assigns source_records.cite_no from the investigation''s source_cite_counters row (#609) — serialised on that row, so numbers are dense and a rollback leaves no gap. A supplied cite_no must be exactly the next one. Refuses a record past the per-investigation caps (1000 records, 2 MiB of excerpts).';

create trigger source_records_allocate_cite_no
  before insert on ouroboros.source_records
  for each row execute function ouroboros.source_records_allocate_cite_no();

revoke execute on function ouroboros.source_records_allocate_cite_no() from public;

-- --- the archive is never edited ---------------------------------------------------
--
-- One function for the four ledger tables: a source, a brief version, a claim and a citation link
-- are each the record of what was read or said at the time. A new brief is a new version.
create function ouroboros.citation_ledger_refuse_update()
returns trigger language plpgsql as $$
begin
  raise exception '% rows are an archive and are never updated', tg_table_name
    using errcode = 'check_violation', constraint = tg_name;
end;
$$;

comment on function ouroboros.citation_ledger_refuse_update() is
  'Refuses any update of a source record, brief, claim or citation link (#609): the ledger is an archive, and a revised brief is a new version.';

create trigger source_records_immutable
  before update on ouroboros.source_records
  for each row execute function ouroboros.citation_ledger_refuse_update();

-- ---------------------------------------------------------------------------
-- briefs — versioned.
-- ---------------------------------------------------------------------------
create table ouroboros.briefs (
  id               uuid        primary key default gen_random_uuid(),

  investigation_id uuid        not null
                               references ouroboros.investigations (id) on delete cascade,

  -- 1, 2, 3, … per investigation; the highest is current, the rest are its history.
  version          integer     not null
                               constraint briefs_version_positive check (version >= 1),

  -- Paragraphs of spans; a span may name the claim it states. See brief_body_valid().
  body             jsonb       not null
                               constraint briefs_body_shape
                                 check (ouroboros.brief_body_valid(body)),

  -- Refs to what else the kind's playbook produced: matrix, draft_batch, roadmap_doc, fix_draft.
  deliverables     jsonb       not null default '{}'
                               constraint briefs_deliverables_shape
                                 check (ouroboros.brief_deliverables_valid(deliverables)),

  created_at       timestamptz not null default now(),

  constraint briefs_investigation_version_key unique (investigation_id, version),
  constraint briefs_investigation_id_key unique (investigation_id, id)
);

comment on table ouroboros.briefs is
  'An investigation''s brief, versioned (#609, CK.2): the highest version is current, the rest its history. The body is structured — paragraphs of spans, a span optionally naming its claim — so citation markers render from data. Never updated; a revision is a new version.';
comment on column ouroboros.briefs.version is
  '1, 2, … per investigation with no gap; the highest is current.';
comment on column ouroboros.briefs.body is
  '{paragraphs: [{spans: [{text} | {text, claim}]}]} — claim is the span ref a brief_claims row describes.';
comment on column ouroboros.briefs.deliverables is
  '{matrix | draft_batch | roadmap_doc | fix_draft: ref} — what else the playbook produced.';

-- A version is the next one: no gap, no going back. Two writers racing for the same version meet
-- at briefs_investigation_version_key.
create function ouroboros.briefs_version_next()
returns trigger language plpgsql as $$
declare
  expected integer;
begin
  select coalesce(max(version), 0) + 1 into expected
    from ouroboros.briefs where investigation_id = new.investigation_id;
  if new.version <> expected then
    raise exception 'brief version % of investigation % is not the next version, %',
      new.version, new.investigation_id, expected
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.briefs_version_next() is
  'Refuses a brief whose version is not one past the investigation''s current one (#609).';

create trigger briefs_version_next
  before insert on ouroboros.briefs
  for each row execute function ouroboros.briefs_version_next();

create trigger briefs_immutable
  before update on ouroboros.briefs
  for each row execute function ouroboros.citation_ledger_refuse_update();

-- ---------------------------------------------------------------------------
-- brief_claims — the claims a brief states.
-- ---------------------------------------------------------------------------
create table ouroboros.brief_claims (
  id               uuid        primary key default gen_random_uuid(),

  -- Carried so every key below can be composite on it — see the header.
  investigation_id uuid        not null,

  brief_id         uuid        not null,

  -- The span of the brief body that states this claim.
  span_ref         text        not null
                               constraint brief_claims_span_ref_format
                                 check (span_ref ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),

  -- A finding must be cited (brief_claims_finding_cited); an uncited candidate is an
  -- open_question.
  claim_type       text        not null
                               constraint brief_claims_claim_type
                                 check (claim_type in ('finding', 'open_question')),

  text             text        not null
                               constraint brief_claims_text_present
                                 check (btrim(text) <> ''),

  created_at       timestamptz not null default now(),

  constraint brief_claims_brief_fk
    foreign key (brief_id, investigation_id)
    references ouroboros.briefs (id, investigation_id) on delete cascade,

  constraint brief_claims_brief_span_key unique (brief_id, span_ref),
  constraint brief_claims_investigation_id_key unique (investigation_id, id)
);

comment on table ouroboros.brief_claims is
  'The claims a brief states (#609, CK.2): one per claim span of the body, a finding or an open question. A finding must have at least one citation by commit (brief_claims_finding_cited, decision V3). Never updated.';
comment on column ouroboros.brief_claims.span_ref is
  'The claim key of the brief body span stating this claim — present in the body (brief_claims_span_in_body).';
comment on column ouroboros.brief_claims.claim_type is
  'finding | open_question. A finding needs at least one citation; an uncited candidate is written as an open question (#620).';

-- The span a claim describes is one its brief's body names.
create function ouroboros.brief_claims_span_in_body()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from ouroboros.briefs b
                  where b.id = new.brief_id
                    and new.span_ref = any (ouroboros.brief_body_claim_refs(b.body))) then
    raise exception 'claim span % is not a claim span of brief %', new.span_ref, new.brief_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.brief_claims_span_in_body() is
  'Refuses a claim whose span_ref no span of its brief''s body names (#609).';

create trigger brief_claims_span_in_body
  before insert on ouroboros.brief_claims
  for each row execute function ouroboros.brief_claims_span_in_body();

create trigger brief_claims_immutable
  before update on ouroboros.brief_claims
  for each row execute function ouroboros.citation_ledger_refuse_update();

-- ---------------------------------------------------------------------------
-- brief_claim_sources — which sources back which claim.
-- ---------------------------------------------------------------------------
create table ouroboros.brief_claim_sources (
  investigation_id uuid not null,
  claim_id         uuid not null,
  source_id        uuid not null,

  constraint brief_claim_sources_pkey primary key (claim_id, source_id),

  constraint brief_claim_sources_claim_fk
    foreign key (investigation_id, claim_id)
    references ouroboros.brief_claims (investigation_id, id) on delete cascade,

  constraint brief_claim_sources_source_fk
    foreign key (investigation_id, source_id)
    references ouroboros.source_records (investigation_id, id) on delete cascade
);

comment on table ouroboros.brief_claim_sources is
  'Citation links (#609, CK.2): a claim cites a source of the same investigation. Many to many — a claim may cite several sources, a source may back several claims. Never updated.';

-- "Which claims does [07] back?" — the reverse of the primary key.
create index brief_claim_sources_source_idx
  on ouroboros.brief_claim_sources (source_id);

create trigger brief_claim_sources_immutable
  before update on ouroboros.brief_claim_sources
  for each row execute function ouroboros.citation_ledger_refuse_update();

-- ---------------------------------------------------------------------------
-- The deferred rules — checked at commit, because each spans two tables written one after the
-- other in the same transaction.
-- ---------------------------------------------------------------------------

-- A finding has at least one citation. Fires for a claim written, and for a link removed (the
-- owner's delete; the application role cannot delete). A claim no longer present — its brief or
-- investigation deleted in the same transaction — has nothing left to cite.
create function ouroboros.brief_claims_finding_cited()
returns trigger language plpgsql as $$
declare
  checked uuid;
begin
  -- Two statements rather than one CASE: PL/pgSQL plans an expression against the firing table's
  -- row type, and a brief_claims row has no claim_id.
  if tg_table_name = 'brief_claims' then
    checked := new.id;
  else
    checked := old.claim_id;
  end if;

  if exists (select 1 from ouroboros.brief_claims c
              where c.id = checked and c.claim_type = 'finding')
     and not exists (select 1 from ouroboros.brief_claim_sources l where l.claim_id = checked) then
    raise exception 'finding claim % has no citation — an uncited claim is an open question', checked
      using errcode = 'check_violation', constraint = 'brief_claims_finding_cited',
            hint = 'Link at least one source_records row through brief_claim_sources, or write the claim as an open_question (decision V3, #620).';
  end if;
  return null;
end;
$$;

comment on function ouroboros.brief_claims_finding_cited() is
  'Deferred to commit (#609, decision V3): refuses a finding claim with no brief_claim_sources link, whether the claim was written without one or its last link was removed.';

create constraint trigger brief_claims_finding_cited
  after insert on ouroboros.brief_claims
  deferrable initially deferred
  for each row execute function ouroboros.brief_claims_finding_cited();

create constraint trigger brief_claim_sources_finding_cited
  after delete on ouroboros.brief_claim_sources
  deferrable initially deferred
  for each row execute function ouroboros.brief_claims_finding_cited();

-- An investigation is brief_ready — or issues_filed, which follows it — only with a brief (V106
-- left this here). An investigation deleted in the same transaction has nothing to check.
create function ouroboros.investigations_brief_exists()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from ouroboros.investigations i
              where i.id = new.id and i.status in ('brief_ready', 'issues_filed'))
     and not exists (select 1 from ouroboros.briefs b where b.investigation_id = new.id) then
    raise exception 'investigation % is % without a brief', new.display_id, new.status
      using errcode = 'check_violation', constraint = 'investigations_brief_exists';
  end if;
  return null;
end;
$$;

comment on function ouroboros.investigations_brief_exists() is
  'Deferred to commit (#609, left by #608): refuses an investigation that is brief_ready or issues_filed with no briefs row.';

create constraint trigger investigations_brief_exists
  after insert or update of status on ouroboros.investigations
  deferrable initially deferred
  for each row execute function ouroboros.investigations_brief_exists();

-- ---------------------------------------------------------------------------
-- The application role.
--
-- The ledger is written and read, never edited or deleted — every table is an archive. The
-- counter has no grant: only the allocator writes it.
-- ---------------------------------------------------------------------------
grant select, insert on ouroboros.source_records to ouroboros_app;
grant select, insert on ouroboros.briefs to ouroboros_app;
grant select, insert on ouroboros.brief_claims to ouroboros_app;
grant select, insert on ouroboros.brief_claim_sources to ouroboros_app;
