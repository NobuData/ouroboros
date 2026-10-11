-- V127__research_tool_settings.sql — where a workspace's configuration of a research tool
-- lives (#629, CN.3).
--
-- Mockup 22's tools card draws a health dot per tool, and a dot is an answer about *this
-- workspace's configuration* of the tool: CL.1's `healthCheck(config, secret)` (#614) answers
-- `not_configured` — the idle dot, with its `enable` button — for a workspace that stored
-- nothing. CL.1 left the storage to the ticket that builds the enable flow, and this is it:
--
--   research_tool_settings (organization_id, tool_slug) → config, credentials_encrypted
--
-- One row per workspace per tool. **A row is what "enabled" means**: a tool whose schema
-- requires nothing (`code`, `tickets`, `telemetry`, `competitor`) is enabled by a row holding
-- `{}`, and a workspace with no row reads the idle dot whatever the tool needs.
--
-- **The credential follows V015/V030, for their reasons.** `credentials_encrypted` is the
-- vault's text envelope and nothing else (`research_tool_settings_credentials_sealed`), so no
-- writer can store a key in the clear; it is nullable, because most tools need none; and read
-- paths select `research_tool_settings_public`, which does not carry the column — it answers
-- `has_credential` instead, which is all a card may know about a key.
--
-- **`config` is an object and no further.** Its grammar is the adapter's `configSchema()`,
-- checked by the service at write; a grammar spelled here would be one tool's under a neutral
-- name (V030's argument for `ticket_sources.config`).
--
-- **No `delete` grant.** The enable flow stores and re-stores; nothing in the product switches
-- a tool off yet, and a workspace's rows leave with the workspace.
--
-- To undo (forward only — for a rehearsal against a copy):
--   drop view ouroboros.research_tool_settings_public;
--   drop table ouroboros.research_tool_settings;

create table ouroboros.research_tool_settings (
  -- Owning workspace. Cascade, as everything a workspace owns.
  organization_id       text        not null
                                    references ouroboros.organization ("id") on delete cascade,

  -- The tool — a `research_tools` slug (V106), so a slug no adapter answers to is refused.
  tool_slug             text        not null
                                    references ouroboros.research_tools (slug) on delete cascade,

  -- The non-secret settings, in the tool's `configSchema()` vocabulary.
  config                jsonb       not null default '{}'
                                    constraint research_tool_settings_config_object
                                      check (jsonb_typeof(config) = 'object'),

  -- The sealed credential, or null for a tool that needs none. V015's constraint, verbatim.
  credentials_encrypted text
                                    constraint research_tool_settings_credentials_sealed
                                      check (credentials_encrypted is null
                                             or credentials_encrypted ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),

  -- Who last stored it. Set null when the person is removed.
  updated_by            text        references ouroboros."user" ("id") on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  primary key (organization_id, tool_slug)
);

comment on table ouroboros.research_tool_settings is
  'A workspace''s configuration of one research tool (#629, CN.3) — what CL.1''s healthCheck() and every tool call are handed. A row is what "enabled" means: absent row = the idle dot. Never holds a credential in the clear: credentials_encrypted is envelope-only by CHECK, and read paths select research_tool_settings_public, which does not carry the column.';
comment on column ouroboros.research_tool_settings.tool_slug is
  'The adapter slug — web, competitor, code, tickets, telemetry, or one an organisation registers.';
comment on column ouroboros.research_tool_settings.config is
  'Non-secret settings in the tool''s configSchema() vocabulary. An object and no further — the per-tool shape is the adapter''s to declare and the service''s to enforce at write.';
comment on column ouroboros.research_tool_settings.credentials_encrypted is
  'The sealed credential (the schema field marked x-ouroboros-secret), or null for a tool that needs none. The vault''s text envelope, always — a plaintext key cannot be stored here by any writer.';
comment on column ouroboros.research_tool_settings.updated_by is
  'Who last stored the configuration; null once that person is removed, or for a seeded row.';
comment on constraint research_tool_settings_credentials_sealed on ouroboros.research_tool_settings is
  'The credential is one of the vault''s envelopes, always — V015''s posture, for its reason: a rule about every writer rather than about the one service that is supposed to encrypt.';

create trigger research_tool_settings_touch_updated_at
  before update on ouroboros.research_tool_settings
  for each row execute function ouroboros.touch_updated_at();

-- What read paths select: every column but the credential, and whether one is stored.
create view ouroboros.research_tool_settings_public as
  select organization_id,
         tool_slug,
         config,
         credentials_encrypted is not null as has_credential,
         updated_by,
         created_at,
         updated_at
    from ouroboros.research_tool_settings;

comment on view ouroboros.research_tool_settings_public is
  'research_tool_settings without credentials_encrypted (#629) — what the tools card reads, so the sealed credential is absent rather than merely unselected; has_credential says only that one is stored. tests/constraints.sql asserts the column list.';

grant select, insert, update on ouroboros.research_tool_settings to ouroboros_app;
grant select on ouroboros.research_tool_settings_public to ouroboros_app;
