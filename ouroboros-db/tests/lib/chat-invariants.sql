-- chat-invariants.sql — the invariants mockup 19's seeded Chat Ops page is written against,
-- named (#534, BY.4).
--
-- R__dev_seed_workspace_triage_slack.sql seeds acme-robotics' Slack workspace, three channels,
-- the stream, five route rows, three identity links and the on-call designee. These are the
-- promises the page relies on that a later migration or seed could break without anything else
-- noticing:
--
--   * **Vocabularies are the issues'.** A connection's `platform` and `status`, a message's
--     `kind`, a command's `outcome` and `surface` — read from the CHECKs themselves, so a
--     constraint widened by accident fails here.
--   * **One active Slack connection per workspace**, by index and in the rows.
--   * **A retried publish is one row.** The dedupe key is in force and no two rows share it.
--   * **A platform user is one member, and a member one platform user**, among live links.
--   * **A command says who it acted as** (#539). A Slack command with an identity link records
--     the link's person, and a console command is of no connection.
--   * **On-call is reachable.** The rule is in force and every active designee has a linked
--     identity on an active Slack connection.
--   * **Every ref resolves.** No seeded or stored message names a row that is not there.
--   * **The page's fixtures are there.** The header's figures come from the connection row; the
--     question card is resolved with an actor and an edit, and its system line follows it; one
--     link is revoked; the bot token is a sealed envelope; and *every stage transition* is off.
--
-- **Every assertion's message starts with the name of the invariant it protects**, so a red build
-- says which guarantee went and tests/verify-chat-invariants.sh can require that name.
--
-- Run through tests/chat-invariants.sql, which owns the session and the transaction.

-- The values a named CHECK admits, read from the catalogue rather than restated.
create function pg_temp.chat_vocabulary(p_table text, p_constraint text) returns setof text
language sql stable as $$
  select m[1]
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conrelid = ('ouroboros.' || p_table)::regclass and c.conname = p_constraint
$$;

-- Whether a unique index of that name stands on that table.
create function pg_temp.chat_unique_index(p_table text, p_index text) returns boolean
language sql stable as $$
  select exists (select 1 from pg_indexes
                  where schemaname = 'ouroboros' and tablename = p_table and indexname = p_index
                    and indexdef like 'CREATE UNIQUE INDEX%')
$$;

-- Whether a trigger of that name is on that table and enabled.
create function pg_temp.chat_trigger_enabled(p_table text, p_trigger text) returns boolean
language sql stable as $$
  select exists (select 1 from pg_trigger
                  where tgrelid = ('ouroboros.' || p_table)::regclass and tgname = p_trigger
                    and tgenabled <> 'D')
$$;

select pg_temp.must_hold(
  exists (select 1 from ouroboros.chat_messages where id::text like '5eed009c-%'),
  'chat_seeded: the database holds the chat seed to probe — seed it with flyway.seed.toml');

-- ===========================================================================
-- 1. Vocabularies
-- ===========================================================================
select pg_temp.must_hold(
  (select array_agg(v order by v) = array['slack', 'teams']
     from pg_temp.chat_vocabulary('chat_connections', 'chat_connections_platform_known') v)
  and (select array_agg(v order by v) = array['active', 'error', 'revoked']
         from pg_temp.chat_vocabulary('chat_connections', 'chat_connections_status_known') v),
  'platform_status_vocabularies: a connection''s platform is slack | teams and its status active | revoked | error');

select pg_temp.must_hold(
  (select array_agg(v order by v) = array['command_reply', 'decision_card', 'event_card', 'system_line']
     from pg_temp.chat_vocabulary('chat_messages', 'chat_messages_kind_known') v)
  and (select array_agg(v order by v) = array['async_pending', 'denied', 'error', 'ok', 'unlinked']
         from pg_temp.chat_vocabulary('chat_commands', 'chat_commands_outcome_known') v)
  and (select array_agg(v order by v) = array['console', 'slack']
         from pg_temp.chat_vocabulary('chat_commands', 'chat_commands_surface_known') v),
  'message_command_vocabularies: a message is one of four kinds, a command''s outcome one of five and its surface slack | console');

-- ===========================================================================
-- 2. One active Slack connection per workspace
-- ===========================================================================
select pg_temp.must_hold(
  pg_temp.chat_unique_index('chat_connections', 'chat_connections_one_active_slack')
  and not exists (select 1 from ouroboros.chat_connections
                   where platform = 'slack' and status = 'active'
                   group by organization_id having count(*) > 1),
  'single_active_connection: a workspace has at most one active Slack connection, by index and in the rows');

-- ===========================================================================
-- 3. Dedupe
-- ===========================================================================
select pg_temp.must_hold(
  pg_temp.chat_unique_index('chat_messages', 'chat_messages_dedupe_key')
  and not exists (select 1 from ouroboros.chat_messages
                   group by channel_id, payload_digest, dedupe_bucket having count(*) > 1)
  and not exists (select 1 from ouroboros.chat_messages where payload_digest !~ '^[0-9a-f]{64}$'),
  'dedupe_digest_unique: no two messages of a channel share a payload digest within the hour, and the key that refuses it is in force');

-- ===========================================================================
-- 4. Identity links are one-to-one, both ways
-- ===========================================================================
select pg_temp.must_hold(
  pg_temp.chat_unique_index('chat_identity_links', 'chat_identity_links_platform_user_key')
  and not exists (select 1 from ouroboros.chat_identity_links where state <> 'revoked'
                   group by connection_id, platform_user_id having count(*) > 1),
  'link_unique_platform_user: a platform user maps to at most one live link per connection');

select pg_temp.must_hold(
  pg_temp.chat_unique_index('chat_identity_links', 'chat_identity_links_member_key')
  and not exists (select 1 from ouroboros.chat_identity_links
                   where state <> 'revoked' and member_id is not null
                   group by connection_id, member_id having count(*) > 1),
  'link_unique_member: a member has at most one live link per connection');

-- ===========================================================================
-- 5. On-call is someone a DM can reach
-- ===========================================================================
select pg_temp.must_hold(
  pg_temp.chat_trigger_enabled('on_call_assignments', 'on_call_assignments_designee_linked')
  and pg_temp.chat_unique_index('on_call_assignments', 'on_call_assignments_one_active')
  and not exists (
        select 1 from ouroboros.on_call_assignments a
         where a.active
           and not exists (select 1
                             from ouroboros.chat_identity_links link
                             join ouroboros.chat_connections conn on conn.id = link.connection_id
                            where link.member_id = a.member_id and link.state = 'linked'
                              and conn.organization_id = a.organization_id
                              and conn.platform = 'slack' and conn.status = 'active')),
  'on_call_linked: every active on-call designee has a linked identity on their workspace''s active Slack connection, and the rule is in force');

select pg_temp.must_hold(
  (select count(*) = 1 and bool_and(person."email" = 'ken@acme-robotics.dev' and a.scope = 'decisions')
     from ouroboros.on_call_assignments a
     join ouroboros.organization org on org."id" = a.organization_id and org."slug" = 'acme-robotics'
     join ouroboros.member member on member."id" = a.member_id
     join ouroboros."user" person on person."id" = member."userId"
    where a.active),
  'on_call_seeded: Ken is the one active on-call designee of acme-robotics, for decisions');

-- ===========================================================================
-- 6. Every ref resolves
-- ===========================================================================
select pg_temp.must_hold(
  pg_temp.chat_trigger_enabled('chat_messages', 'chat_messages_refs_resolve')
  and not exists (select 1
                    from ouroboros.chat_messages m, jsonb_array_elements(m.refs) r
                   where not ouroboros.decision_ref_resolves(m.organization_id, r))
  and (select count(*) >= 5 from ouroboros.chat_messages m, jsonb_array_elements(m.refs) r
        where m.id::text like '5eed009c-%'),
  'refs_resolve: every ref of every message names an existing row of its workspace, and the rule is in force');

-- ===========================================================================
-- 7. The page's fixtures
-- ===========================================================================
select pg_temp.must_hold(
  (select conn.status = 'active' and conn.install_meta ->> 'app_version' = 'v2.4'
          and ch.channel_name = 'ouroboros-loops' and ch.joined and ch.member_count = 24
     from ouroboros.chat_connections conn
     join ouroboros.chat_channels ch on ch.connection_id = conn.id and ch.purpose_tag = 'loops'
    where conn.id = '5eed009c-0000-4000-8000-000000000001')
  and (select array_agg(purpose_tag order by purpose_tag) = array['alerts', 'leads', 'loops']
         from ouroboros.chat_channels where connection_id = '5eed009c-0000-4000-8000-000000000001'),
  'header_from_connection: #ouroboros-loops · 24 members · app v2.4 are the connection''s and the channel''s own columns, beside #helios-alerts and #eng-leads');

select pg_temp.must_hold(
  exists (select 1 from pg_constraint
           where conrelid = 'ouroboros.chat_connections'::regclass
             and conname = 'chat_connections_bot_token_sealed')
  and (select bot_token_sealed ~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
         from ouroboros.chat_connections where id = '5eed009c-0000-4000-8000-000000000001')
  and not exists (select 1 from ouroboros.chat_connections
                   where bot_token_sealed is not null
                     and bot_token_sealed !~ '^ouro\.v1\.[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  'token_sealed: every stored bot token is AD.1''s sealed envelope, and the CHECK that requires it is in force');

-- The mockup's stream, at the mockup's clock times, in order.
select pg_temp.must_hold(
  (select array_agg(row order by at, row) = array[
            '13:58 event_card/loop_finished',
            '14:07 decision_card/resolved',
            '14:11 system_line',
            '14:12 command/status/ok',
            '14:12 command_reply',
            '14:13 command/dry-run/ok',
            '14:13 command_reply',
            '14:31 event_card/build_green']
     from (select m.posted_at as at,
                  to_char(m.posted_at, 'HH24:MI') || ' ' || m.kind
                    || case m.kind when 'event_card' then '/' || m.card_kind
                                   when 'decision_card' then '/' || m.state else '' end as row
             from ouroboros.chat_messages m
            where m.channel_id = '5eed009c-0000-4000-8000-0000000000a1'
              and m.id <> '5eed009c-0000-4000-8000-000000000102'
           union all
           select c.invoked_at, to_char(c.invoked_at, 'HH24:MI') || ' command/' || c.command || '/' || c.outcome
             from ouroboros.chat_commands c
            where c.channel_id = '5eed009c-0000-4000-8000-0000000000a1') stream),
  'stream_seeded: #ouroboros-loops holds mockup 19''s stream at 13:58, 14:07, 14:11, 14:12, 14:12, 14:13, 14:13 and 14:31, in order');

select pg_temp.must_hold(
  (select card.state = 'resolved' and card.outcome is not null and card.resolved_by is not null
          and card.edited_at is not null and card.edited_at > card.posted_at
          and line.decision_item_id = card.decision_item_id and line.refs = card.refs
          and line.posted_at >= card.resolved_at
     from ouroboros.chat_messages card
     join ouroboros.chat_messages line on line.id = '5eed009c-0000-4000-8000-000000000104'
                                      and line.kind = 'system_line'
    where card.id = '5eed009c-0000-4000-8000-000000000103' and card.kind = 'decision_card'),
  'resolved_card_fixture: the question card is seeded resolved, with an actor and an edited_at, and its system line follows about the same item');

select pg_temp.must_hold(
  (select count(*) = 1 from ouroboros.chat_messages
    where id = '5eed009c-0000-4000-8000-000000000102' and kind = 'decision_card' and state = 'open'),
  'open_card_fixture: one decision card is seeded open, so both states have a fixture');

select pg_temp.must_hold(
  (select array_agg(person."email" || ':' || link.state || ':' || link.verified_via order by person."email")
            = array['jorge@acme-robotics.dev:revoked:admin_assigned',
                    'ken@acme-robotics.dev:linked:oauth_session',
                    'maya@acme-robotics.dev:linked:oauth_session']
     from ouroboros.chat_identity_links link
     join ouroboros."user" person on person."id" = link.user_id
    where link.connection_id = '5eed009c-0000-4000-8000-000000000001')
  and (select revoked_at is not null and revoked_by is not null
         from ouroboros.chat_identity_links where id = '5eed009c-0000-4000-8000-000000000303'),
  'links_seeded: Ken and Maya are linked by oauth_session, and one link — Jorge''s — is revoked, kept with when and by whom');

-- Who a command acted as (#539): the link's person in Slack, and no console row is of a connection.
select pg_temp.must_hold(
  (select count(*) = 0
     from ouroboros.chat_commands c
     join ouroboros.chat_identity_links link on link.id = c.invoker_link_id
    where c.surface = 'slack' and link.user_id is not null
      and c.invoker_user_id is distinct from link.user_id)
  and (select count(*) = 0 from ouroboros.chat_commands
        where surface = 'console' and connection_id is not null)
  and (select count(*) = 2 and bool_and(person."email" = 'ken@acme-robotics.dev')
         from ouroboros.chat_commands c
         join ouroboros."user" person on person."id" = c.invoker_user_id
        where c.channel_id = '5eed009c-0000-4000-8000-0000000000a1'),
  'command_invoker_recorded: every Slack command with an identity link acts as that link''s person — the two seeded ones as Ken — and no console command has a connection');

select pg_temp.must_hold(
  (select array_agg(r.kind || ' → #' || ch.channel_name
                    || case when r.dm_on_call then ' + DM on-call' else '' end order by r.kind)
            = array['custom:blocking-questions → #ouroboros-loops + DM on-call',
                    'custom:build-failures → #helios-alerts',
                    'custom:loop-finished → #ouroboros-loops',
                    'custom:stage-transitions → #ouroboros-loops',
                    'custom:weekly-insights → #eng-leads']
     from ouroboros.notification_routes r
     join ouroboros.chat_channels ch on ch.id = r.chat_channel_id
    where ch.connection_id = '5eed009c-0000-4000-8000-000000000001'),
  'routes_seeded: mockup 19''s five route rows are bound to their channels, blocking questions with the on-call DM');

select pg_temp.must_hold(
  (select count(*) = 1 and bool_and(not r.enabled)
     from ouroboros.notification_routes r
     join ouroboros.organization org on org."id" = r.organization_id and org."slug" = 'acme-robotics'
    where r.kind = 'custom:stage-transitions'),
  'stage_transitions_off: the every-stage-transition route is seeded disabled — noisy, off by default');
