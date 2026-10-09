-- V116__source_skips.sql — the sources an investigation chose not to read, and why (#615, CL.2).
--
-- Mockup 22's web tool promises `robots-aware` on its card, and the web search & page reader
-- (#615) keeps the promise: a page whose robots.txt forbids it is not read. But a source silently
-- dropped makes a brief quietly less complete, so the skip is **recorded** — beside the ledger,
-- under the investigation, where the sources panel and the brief's reader can see it:
--
--   [07]  Skylink S4 docking module — teardown & sensor BOM     droneanalysts.example.com/s4-teardown
--   ⊘     skylink.example.com/dealers/pricing                    robots.txt disallows /dealers/
--   ⊘     arxiv.example.org/pdf/2605.11423.pdf                   papers tool arrives in v2
--
-- Two reasons, each a promise the tool makes rather than an error it hit:
--
--   * **`robots_denied`** — the site's robots.txt forbids the page to the research user agent.
--   * **`unsupported_type`** — the page is a type the tool does not read: a PDF waits for the docs,
--     standards & papers tool (#635, v2), and an image or an archive is not text.
--
-- A skip is not a source: it has no content, no hash and no cite number, and nothing may cite it.
-- It is written by the internal tool surface (`ResearchToolInvoker`) when a fetch is refused for
-- one of those reasons, once per investigation, tool, locator and reason — a second refusal of the
-- same page says nothing new. It is a record and is never edited.
--
-- Revert forward:
--   drop table ouroboros.source_skips;

create table ouroboros.source_skips (
  id               uuid        primary key default gen_random_uuid(),

  -- The investigation the page would have been read for. Cascade, as the ledger does.
  investigation_id uuid        not null
                               references ouroboros.investigations (id) on delete cascade,

  -- The tool that declined it — a research_tools slug.
  tool_slug        text        not null
                               references ouroboros.research_tools (slug),

  -- What was not read, as it was asked for.
  locator          text        not null
                               constraint source_skips_locator_format
                                 check (btrim(locator) <> '' and length(locator) <= 2048
                                        and locator !~ '\s'),

  reason           text        not null
                               constraint source_skips_reason
                                 check (reason in ('robots_denied', 'unsupported_type')),

  -- The note the panel shows — `robots.txt disallows /dealers/ for OuroborosResearch`,
  -- `papers tool arrives in v2`. Written for a person.
  note             text        not null
                               constraint source_skips_note_present
                                 check (btrim(note) <> '' and length(note) <= 500),

  -- Whatever makes the skip checkable — the matched rule, the content type.
  meta             jsonb       not null default '{}'
                               constraint source_skips_meta_shape
                                 check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 8192),

  skipped_at       timestamptz not null default now(),

  -- One record per investigation, tool, page and reason.
  constraint source_skips_investigation_locator_key
    unique (investigation_id, tool_slug, locator, reason)
);

comment on table ouroboros.source_skips is
  'Sources an investigation declined to read, and why (#615, CL.2): robots_denied (the site''s robots.txt forbids the page) or unsupported_type (a PDF waiting for the papers tool, #635, or a type that is not text). Not sources — no content, no cite number, never cited — but recorded so a brief''s gaps are visible rather than silent. One per investigation, tool, locator and reason; never edited.';
comment on column ouroboros.source_skips.locator is
  'The page as it was asked for — an http(s) URL for the web tool.';
comment on column ouroboros.source_skips.reason is
  'robots_denied | unsupported_type.';
comment on column ouroboros.source_skips.note is
  'What the sources panel shows beside the skip — robots.txt disallows /dealers/, papers tool arrives in v2.';
comment on column ouroboros.source_skips.meta is
  'What makes the skip checkable — the robots rule that matched, the content type. An object of at most 8192 bytes.';

create index source_skips_investigation_idx
  on ouroboros.source_skips (investigation_id, skipped_at);

-- source_skips_immutable() — a skip is a record: refuse every update.
create function ouroboros.source_skips_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'source skip % of investigation % is a record and is never edited',
    old.id, old.investigation_id
    using errcode = 'restrict_violation', constraint = tg_name;
end;
$$;

comment on function ouroboros.source_skips_immutable() is
  'Refuses every update of source_skips (#615): a skip is a record of what was not read.';

create trigger source_skips_immutable
  before update on ouroboros.source_skips
  for each row execute function ouroboros.source_skips_immutable();

grant select, insert on ouroboros.source_skips to ouroboros_app;
