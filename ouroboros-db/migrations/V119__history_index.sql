-- V119__history_index.sql — the issue & PR history index and imported document sets (#618, CL.5).
--
-- Mockup 22's fourth tool row, and the citation it produces:
--
--   ▤ Issue & PR history index    3,412 issues · support tickets · churn interviews    ●
--   [19]  Support churn interviews Q2      issue-index://support/churn-2026-q2
--
-- Three things the research tool needs that the schema did not have:
--
--   * **A home for institutional memory that is not a ticket.** `document_imports` is one imported
--     set — churn interviews, say — and `document_import_items` its documents: text, labels, a date
--     and whatever else the file carried. A set is addressed `issue-index://<collection>/<name>`
--     and a document `issue-index://<collection>/<name>/<item>`, so the mockup's
--     `issue-index://support/churn-2026-q2` is a real locator.
--   * **Full-text search.** `history_index_document(title, body)` is the one definition of what is
--     searched (title weighted above body, English stemming), indexed with GIN on canonical
--     tickets, mirrored PRs and imported documents alike.
--   * **One corpus.** `history_index_entries` is the union the tool reads: every canonical ticket
--     (V030 — whichever tracker fed it), every mirrored PR (V052), every imported set and
--     document, in one shape with one locator rule.
--
-- **Tracker-agnostic by construction (decision V2).** The view never reads `ticket_sources.kind`.
-- A ticket's locator is `issue-index://<slug of its source's name>/<external_id>` — the name a
-- person gave the source, and the identity the tracker gave the ticket — so a Jira-sourced ticket
-- and a GitHub-sourced one are the same kind of row here, and a workspace that changes tracker
-- changes nothing in research. `repo` is whatever a provider's `meta` names as one
-- (`$.*.repo`, no provider named); for a PR, which has no `meta`, the second path segment of its
-- URL. Both are null where there is none, and a filter on `repo` then simply does not match.
--
-- A locator is not a key: two sources whose names slug alike, or a ticket whose id equals a set's
-- name, share one, and a lookup by locator answers every row it matches.
--
-- An imported document is never edited — it is what an investigation cited — so replacing a set
-- is removing it and importing it again.
--
-- Revert forward:
--   drop view ouroboros.history_index_entries;
--   drop table ouroboros.document_import_items;
--   drop table ouroboros.document_imports;
--   drop index ouroboros.tickets_history_index_idx;
--   drop index ouroboros.pull_requests_history_index_idx;
--   drop index ouroboros.pull_requests_organization_idx;
--   drop function ouroboros.history_index_document(text, text);
--   drop function ouroboros.history_index_key(text);
--   drop function ouroboros.history_index_slug(text);

-- ---------------------------------------------------------------------------
-- The locator's parts.
-- ---------------------------------------------------------------------------

-- A name as a locator's first segment: `GitHub · acme-robotics` → `github-acme-robotics`.
create function ouroboros.history_index_slug(label text)
returns text language sql immutable parallel safe as $$
  select coalesce(
    nullif(left(btrim(regexp_replace(lower(label), '[^a-z0-9]+', '-', 'g'), '-'), 64), ''),
    'source');
$$;

comment on function ouroboros.history_index_slug(text) is
  'A source''s display name as an issue-index:// locator''s first segment (#618): lower-cased, every run of other characters one hyphen, at most 64 characters; `source` when nothing is left.';

-- A tracker's identifier as a locator segment: `PROJ-142` stays, `a/b c` → `a_b_c`.
create function ouroboros.history_index_key(identifier text)
returns text language sql immutable parallel safe as $$
  select regexp_replace(identifier, '[^A-Za-z0-9._#-]', '_', 'g');
$$;

comment on function ouroboros.history_index_key(text) is
  'A tracker''s identifier as an issue-index:// locator segment (#618): every character V108''s locator rule refuses becomes an underscore.';

-- What is searched: the title above the body. The body is read up to 100 000 characters: a
-- tsvector may hold 1 MiB, an insert whose index expression passes that fails, and 100 000
-- characters of the densest text measured (distinct one-character, four-byte words) make a
-- vector of about 0.6 MiB — so no ticket the store accepts can fail to sync because of this
-- index.
create function ouroboros.history_index_document(title text, body text)
returns tsvector language sql immutable parallel safe as $$
  select setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A')
      || setweight(to_tsvector('english'::regconfig, left(coalesce(body, ''), 100000)), 'B');
$$;

comment on function ouroboros.history_index_document(text, text) is
  'The full-text document of a history-index entry (#618): its title (weight A) and the first 100 000 characters of its body (weight B), English stemming. The GIN indexes and the history_index_entries view share this one definition.';

-- ---------------------------------------------------------------------------
-- document_imports — one imported set.
-- ---------------------------------------------------------------------------
create table ouroboros.document_imports (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace that imported it, and the scope of every read. Cascade: a deleted workspace
  -- keeps nobody's interviews.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The locator's first segment — `support`. V108's index grammar.
  collection      text        not null
                              constraint document_imports_collection_format
                                check (collection ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),

  -- The locator's second segment — `churn-2026-q2`.
  name            text        not null
                              constraint document_imports_name_format
                                check (name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),

  -- What a citation of the whole set is titled — *Support churn interviews Q2*.
  title           text        not null
                              constraint document_imports_title_present
                                check (btrim(title) <> '' and length(title) <= 300),

  -- What the set is, in a paragraph — searched with the title.
  description     text
                              constraint document_imports_description_present
                                check (btrim(description) <> '' and length(description) <= 2000),

  -- How the file was read.
  format          text        not null
                              constraint document_imports_format
                                check (format in ('csv', 'markdown')),

  -- sha256 of the file as it was imported.
  content_hash    text        not null
                              constraint document_imports_content_hash
                                check (content_hash ~ '^sha256:[0-9a-f]{64}$'),

  -- Who imported it; kept as text so the record outlives the account.
  imported_by     text,

  created_at      timestamptz not null default now(),

  constraint document_imports_locator_key unique (organization_id, collection, name),
  constraint document_imports_id_organization_key unique (id, organization_id)
);

comment on table ouroboros.document_imports is
  'One imported document set (#618, CL.5) — churn interviews, say — addressed issue-index://<collection>/<name>. Its documents are document_import_items. Never edited: replacing a set is removing it and importing it again.';
comment on column ouroboros.document_imports.collection is
  'The locator''s first segment — support. Lower-case letters, digits, hyphen and underscore.';
comment on column ouroboros.document_imports.name is
  'The locator''s second segment — churn-2026-q2. Unique within the workspace''s collection.';
comment on column ouroboros.document_imports.content_hash is
  'sha256:<hex> of the imported file.';

-- ---------------------------------------------------------------------------
-- document_import_items — a set's documents.
-- ---------------------------------------------------------------------------
create table ouroboros.document_import_items (
  id              uuid        primary key default gen_random_uuid(),

  -- The set, and its workspace — composite, so a document cannot sit in another workspace's set.
  import_id       uuid        not null,
  organization_id text        not null,

  -- Its place in the file, from 1.
  position        integer     not null
                              constraint document_import_items_position
                                check (position between 1 and 2000),

  -- The locator's last segment — `acct-07`.
  item_key        text        not null
                              constraint document_import_items_key_format
                                check (item_key ~ '^[A-Za-z0-9][A-Za-z0-9._#-]{0,99}$'),

  title           text        not null
                              constraint document_import_items_title_present
                                check (btrim(title) <> '' and length(title) <= 300),

  -- The document's text. Bounded: a document is something a person could read.
  body            text        not null
                              constraint document_import_items_body_bounded
                                check (btrim(body) <> '' and octet_length(body) <= 65536),

  -- Labels, as on a ticket — what `aggregate` groups by.
  labels          jsonb       not null default '[]'::jsonb
                              constraint document_import_items_labels
                                check (ouroboros.jsonb_string_list_valid(labels, 100, 255)),

  -- When the document is from — the interview's date — or null when the file does not say.
  occurred_at     timestamptz,

  -- The file's other columns, as text.
  meta            jsonb       not null default '{}'::jsonb
                              constraint document_import_items_meta_shape
                                check (jsonb_typeof(meta) = 'object'
                                       and octet_length(meta::text) <= 8192),

  created_at      timestamptz not null default now(),

  constraint document_import_items_import_fk
    foreign key (import_id, organization_id)
    references ouroboros.document_imports (id, organization_id) on delete cascade,
  constraint document_import_items_key_key unique (import_id, item_key),
  constraint document_import_items_position_key unique (import_id, position)
);

comment on table ouroboros.document_import_items is
  'One document of an imported set (#618) — its text, labels, date and the file''s other columns — addressed issue-index://<collection>/<name>/<item_key>. At most 2 000 per set and 64 KiB each. Never updated: it is what an investigation cited.';
comment on column ouroboros.document_import_items.occurred_at is
  'When the document is from, as the file says; null when it does not. The index dates an undated document by its import.';

create trigger document_import_items_immutable
  before update on ouroboros.document_import_items
  for each row execute function ouroboros.citation_ledger_refuse_update();

create trigger document_imports_immutable
  before update on ouroboros.document_imports
  for each row execute function ouroboros.citation_ledger_refuse_update();

-- ---------------------------------------------------------------------------
-- Indexes — one full-text definition, three tables.
-- ---------------------------------------------------------------------------
create index tickets_history_index_idx
  on ouroboros.tickets using gin (ouroboros.history_index_document(title, body));

create index pull_requests_history_index_idx
  on ouroboros.pull_requests using gin (ouroboros.history_index_document(title, null));

create index document_import_items_history_index_idx
  on ouroboros.document_import_items using gin (ouroboros.history_index_document(title, body));

-- The index reads a workspace's PRs; V052 indexed them by source, run and ticket only.
create index pull_requests_organization_idx
  on ouroboros.pull_requests (organization_id, created_at desc);

create index document_import_items_organization_idx
  on ouroboros.document_import_items (organization_id, import_id);

-- ---------------------------------------------------------------------------
-- history_index_entries — the corpus, in one shape.
-- ---------------------------------------------------------------------------
create view ouroboros.history_index_entries as
  select t.organization_id,
         'ticket'::text                                             as kind,
         t.id                                                       as entry_id,
         ouroboros.history_index_slug(s.display_name)               as set_key,
         'issue-index://' || ouroboros.history_index_slug(s.display_name)
           || '/' || ouroboros.history_index_key(t.external_id)     as locator,
         t.external_key                                             as ref,
         t.title,
         t.body,
         t.state,
         t.labels,
         t.author,
         jsonb_path_query_first(t.meta, '$.*.repo') #>> '{}'        as repo,
         t.external_url                                             as url,
         t.source_created_at                                        as occurred_at,
         t.source_updated_at                                        as changed_at,
         '{}'::jsonb                                                as meta,
         ouroboros.history_index_document(t.title, t.body)          as document
    from ouroboros.tickets t
    join ouroboros.ticket_sources s on s.id = t.source_id
  union all
  select p.organization_id,
         'pr'::text,
         p.id,
         ouroboros.history_index_slug(s.display_name),
         'issue-index://' || ouroboros.history_index_slug(s.display_name)
           || '/pull/' || p.external_number,
         '#' || p.external_number,
         p.title,
         null::text,
         p.state,
         '[]'::jsonb,
         p.merged_by,
         nullif(split_part(regexp_replace(p.external_url, '^https?://[^/]+/', ''), '/', 2), ''),
         p.external_url,
         p.created_at,
         coalesce(p.merged_at, p.updated_at),
         '{}'::jsonb,
         ouroboros.history_index_document(p.title, null)
    from ouroboros.pull_requests p
    join ouroboros.ticket_sources s on s.id = p.source_id
  union all
  select d.organization_id,
         'document_set'::text,
         d.id,
         d.collection || '/' || d.name,
         'issue-index://' || d.collection || '/' || d.name,
         d.name,
         d.title,
         d.description,
         null::text,
         '[]'::jsonb,
         null::text,
         null::text,
         null::text,
         d.created_at,
         d.created_at,
         jsonb_build_object(
           'format', d.format,
           'documents', (select count(*) from ouroboros.document_import_items i
                          where i.import_id = d.id)),
         ouroboros.history_index_document(d.title, d.description)
    from ouroboros.document_imports d
  union all
  select i.organization_id,
         'document'::text,
         i.id,
         d.collection || '/' || d.name,
         'issue-index://' || d.collection || '/' || d.name || '/' || i.item_key,
         i.item_key,
         i.title,
         i.body,
         null::text,
         i.labels,
         null::text,
         null::text,
         null::text,
         coalesce(i.occurred_at, i.created_at),
         i.created_at,
         i.meta,
         ouroboros.history_index_document(i.title, i.body)
    from ouroboros.document_import_items i
    join ouroboros.document_imports d on d.id = i.import_id;

comment on view ouroboros.history_index_entries is
  'The issue & PR history index''s corpus (#618, CL.5): every canonical ticket, mirrored PR, imported document set and imported document of a workspace, in one shape — kind (ticket | pr | document_set | document), locator (issue-index://…), set_key (the source''s slug, or <collection>/<name>), title, body, state, labels, author, repo, url, occurred_at, and the full-text document. Never reads ticket_sources.kind: which tracker fed a ticket is invisible here (decision V2). Always read by organization_id.';

grant select, insert, delete on ouroboros.document_imports to ouroboros_app;
grant select, insert, delete on ouroboros.document_import_items to ouroboros_app;
grant select on ouroboros.history_index_entries to ouroboros_app;
