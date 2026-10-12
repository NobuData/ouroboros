-- R__dev_seed_workspace_triage_slack.sql — acme-robotics' Slack workspace, its channels, and
-- mockup 19's six-message stream as published records. A development database and nowhere else
-- (#532, BY.2, with #533's identities and on-call; the tables are V130, V131 and V132).
--
-- [`docs/mockups/19-chatops.html`](../../docs/mockups/19-chatops.html) draws `#ouroboros-loops`
-- with six messages. Those are six rows, and this file writes them **about rows the other seeds
-- already hold** — no loop, pull request, issue or decision is invented here:
--
--   | The mockup's message                          | The seeded row it is written about          |
--   |-----------------------------------------------|---------------------------------------------|
--   | `✓ Loop … finished — PR … merged`             | the merged loop of issue `#520` and its PR   |
--   | `⏸ Build paused — a question for you` (open)  | the open *allow once* item on loop `#479`    |
--   | the same card, resolved                       | the item Maya answered **from Slack**        |
--   | `✓ Maya Chen answered: …`                     | that resolution                              |
--   | `/ouro status` and its reply                  | counted from runs, the queue and open items  |
--   | `⟳ Loop #1847 build … green`                  | run `#482`, PR `#514`, its green test run    |
--
-- So the digits are the seed's, not the mockup's: the mockup's `#1846 / PR #512` is here the
-- loop and PR of `#520`, and its `allow once` answer is the answer Maya really gave in the
-- inbox seed (`keep_size`, on a resize review, with `channel = 'slack'`). The open card is the
-- mockup's kind — `protected_path_allow_once`.
--
-- **Refs are copied or built from the rows they name**, so each resolves; and the command
-- reply's figures are counted, not typed. Every digest is a SHA-256 of what the row is about,
-- which is what makes a second apply collide rather than duplicate.
--
-- **Why this name.** The cards are the triage inbox's items, the loops are the metrics seed's
-- and the PR is the verification seed's, so this file must sort after all three:
-- `dev_seed_workspace_triage_slack` sorts after `dev_seed_workspace_triage_inbox`, the last.
--
-- **Nothing here is a credential.** `bot_token_sealed` is held by a CHECK to a sealed
-- `ouro.v1.1.<nonce>.<body>` envelope; this one's body decodes to
-- `dev-seed-value-not-a-real-bot-token`. No audit event is written: the audit seeds' counts are
-- other tests' to keep.
--
-- **Who is who (#533, BY.3).** Ken and Maya have linked Slack identities — both confirmed in an
-- app session — so the seeded command is Ken's by link, and Ken is the on-call designee for
-- decisions: mockup 19's `+ DM on-call` has someone to reach. Jorge has no link, which is the
-- page's *link your account* state.
--
-- Every statement carries `${ouro_dev_seed}`; every insert ends `on conflict do nothing`. Ids
-- are `5eed009c`.

-- ---------------------------------------------------------------------------
-- The installed workspace — mockup 19's header: `Slack · 24 members · Ouroboros app v2.4`.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_connections (id, organization_id, platform, workspace_id, workspace_name,
                                        bot_token_sealed, bot_user_id, install_meta, installed_by,
                                        installed_at, last_verified_at)
select '5eed009c-0000-4000-8000-000000000001'::uuid, org."id", 'slack', 'T024AB', 'acme-robotics',
       'ouro.v1.1.ZGV2LXNlZWQtbm9uY2U.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1ib3QtdG9rZW4',
       'U07OUROBOT',
       '{"scopes": ["chat:write", "commands", "channels:read", "users:read"],
         "app_id": "A07OUROBOROS", "app_version": "v2.4"}',
       ken."id", now() - interval '30 days', now() - interval '5 minutes'
  from ouroboros.organization org
  join ouroboros."user" ken on ken."email" = 'ken@acme-robotics.dev'
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Its channels — the three mockup 19's *What Gets Published Where* rows name.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_channels (id, organization_id, connection_id, platform, channel_id,
                                     channel_name, is_private, joined, joined_at, member_count,
                                     purpose_tag)
select ('5eed009c-0000-4000-8000-0000000000' || seed.n)::uuid, conn.organization_id, conn.id,
       conn.platform, seed.channel_id, seed.channel_name, seed.is_private, true,
       conn.installed_at + interval '1 minute', seed.member_count, seed.purpose_tag
  from (values
         ('a1', 'C071LOOPS', 'ouroboros-loops', false, 24, 'loops'),
         ('a2', 'C072ALERT', 'helios-alerts',   false, 11, 'alerts'),
         ('a3', 'C073LEADS', 'eng-leads',       true,   5, 'leads')
       ) as seed (n, channel_id, channel_name, is_private, member_count, purpose_tag)
  join ouroboros.chat_connections conn on conn.id = '5eed009c-0000-4000-8000-000000000001'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Who is who — Ken's and Maya's Slack identities, each confirmed in an app session (#533).
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_identity_links (id, organization_id, connection_id, platform_user_id,
                                           member_id, state, verified_via, display_name_cache,
                                           linked_at)
select ('5eed009c-0000-4000-8000-0000000003' || seed.n)::uuid, conn.organization_id, conn.id,
       seed.platform_user_id, member."id", 'linked', 'oauth_session', person."name",
       conn.installed_at + seed.after
  from (values
         ('01', 'U07KEN',  'ken@acme-robotics.dev',  interval '5 minutes'),
         ('02', 'U07MAYA', 'maya@acme-robotics.dev', interval '1 day')
       ) as seed (n, platform_user_id, email, after)
  join ouroboros.chat_connections conn on conn.id = '5eed009c-0000-4000-8000-000000000001'
  join ouroboros."user" person         on person."email" = seed.email
  join ouroboros.member member         on member."userId" = person."id"
                                      and member."organizationId" = conn.organization_id
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- On call for decisions — Ken, whom Maya designated. Mockup 19's `+ DM on-call` reaches him.
-- ---------------------------------------------------------------------------
insert into ouroboros.on_call_assignments (id, organization_id, member_id, scope, active,
                                           assigned_by, assigned_at)
select '5eed009c-0000-4000-8000-000000000401'::uuid, link.organization_id, link.member_id,
       'decisions', true, maya."id", link.linked_at + interval '2 days'
  from ouroboros.chat_identity_links link
  join ouroboros."user" maya on maya."email" = 'maya@acme-robotics.dev'
 where link.id = '5eed009c-0000-4000-8000-000000000301'
   and link.state = 'linked'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 1. The completion card — the merged loop of #520, its pull request and its issue.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, card_kind,
                                     refs, facts, payload_digest, posted_at)
select '5eed009c-0000-4000-8000-000000000101'::uuid, ch.organization_id, ch.id,
       (extract(epoch from run.finished_at + interval '5 seconds'))::numeric(13, 3)::text,
       'event_card', 'loop_finished',
       jsonb_build_array(
         jsonb_build_object('type', 'run',    'id', run.id::text,    'label', 'loop #' || run.loop_seq),
         jsonb_build_object('type', 'pr',     'id', pr.id::text,     'label', 'PR #' || pr.external_number),
         jsonb_build_object('type', 'ticket', 'id', ticket.id::text, 'label', 'issue ' || ticket.external_key)),
       jsonb_build_object('outcome', pr.state),
       encode(sha256(convert_to('loop_finished:' || run.id, 'UTF8')), 'hex'),
       run.finished_at + interval '5 seconds'
  from ouroboros.chat_channels ch
  join ouroboros.runs run          on run.organization_id = ch.organization_id
                                  and run.issue_number = 520 and run.status = 'merged'
  join ouroboros.pull_requests pr  on pr.run_id = run.id and pr.state = 'merged'
  join ouroboros.tickets ticket    on ticket.id = pr.ticket_id
 where ch.id = '5eed009c-0000-4000-8000-0000000000a1'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. The question card, open — the inbox's own *allow once* item, with the item's own refs.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, card_kind,
                                     decision_item_id, refs, state, payload_digest, posted_at)
select '5eed009c-0000-4000-8000-000000000102'::uuid, ch.organization_id, ch.id,
       (extract(epoch from item.created_at + interval '2 seconds'))::numeric(13, 3)::text,
       'decision_card', item.kind_id, item.id, item.refs, 'open',
       encode(sha256(convert_to('decision_card:' || item.id, 'UTF8')), 'hex'),
       item.created_at + interval '2 seconds'
  from ouroboros.chat_channels ch
  join ouroboros.decision_items item on item.organization_id = ch.organization_id
                                    and item.id = '5eed0082-0000-4000-8000-000000000002'
                                    and item.status = 'open'
 where ch.id = '5eed009c-0000-4000-8000-0000000000a1'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. The question card, resolved — the item Maya answered from Slack, as the edit left it.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, card_kind,
                                     decision_item_id, refs, state, outcome, resolved_by, resolved_at,
                                     payload_digest, posted_at, edited_at)
select '5eed009c-0000-4000-8000-000000000103'::uuid, ch.organization_id, ch.id,
       (extract(epoch from item.created_at + interval '2 seconds'))::numeric(13, 3)::text,
       'decision_card', item.kind_id, item.id, item.refs, 'resolved',
       answer.action_id, answer.resolved_by_user, answer.resolved_at,
       encode(sha256(convert_to('decision_card:' || item.id || ':' || answer.action_id, 'UTF8')), 'hex'),
       item.created_at + interval '2 seconds', answer.resolved_at + interval '1 second'
  from ouroboros.chat_channels ch
  join ouroboros.decision_items item         on item.organization_id = ch.organization_id
                                            and item.id = '5eed0082-0000-4000-8000-000000000104'
  join ouroboros.decision_resolutions answer on answer.item_id = item.id
                                            and answer.channel = 'slack'
                                            and answer.resolver = 'human'
 where ch.id = '5eed009c-0000-4000-8000-0000000000a1'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. …and the system line the answer added under it.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, card_kind,
                                     decision_item_id, refs, facts, payload_digest, posted_at)
select '5eed009c-0000-4000-8000-000000000104'::uuid, card.organization_id, card.channel_id,
       (extract(epoch from card.resolved_at + interval '1 second'))::numeric(13, 3)::text,
       'system_line', card.card_kind, card.decision_item_id, card.refs,
       jsonb_build_object('action', card.outcome, 'answered_by', person."name"),
       encode(sha256(convert_to('system_line:' || card.id || ':' || card.outcome, 'UTF8')), 'hex'),
       card.resolved_at + interval '1 second'
  from ouroboros.chat_messages card
  join ouroboros."user" person on person."id" = card.resolved_by
 where card.id = '5eed009c-0000-4000-8000-000000000103'
   and card.state = 'resolved'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 5. `/ouro status`, typed in the channel by Ken — the invoker is his identity link.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_commands (id, organization_id, connection_id, channel_id, invoker_link_id,
                                     platform_user_id, surface, command, args, raw_text, outcome,
                                     result_ref, invoked_at, completed_at)
select '5eed009c-0000-4000-8000-000000000201'::uuid, ch.organization_id, ch.connection_id, ch.id,
       link.id, link.platform_user_id, 'slack', 'status', '{}', '/ouro status', 'ok',
       jsonb_build_object('message', '5eed009c-0000-4000-8000-000000000105'),
       now() - interval '12 minutes', now() - interval '12 minutes' + interval '1 second'
  from ouroboros.chat_channels ch
  join ouroboros.chat_identity_links link on link.id = '5eed009c-0000-4000-8000-000000000301'
                                         and link.connection_id = ch.connection_id
 where ch.id = '5eed009c-0000-4000-8000-0000000000a1'
   and ${ouro_dev_seed}
on conflict do nothing;

-- A database seeded before #533 holds that command with no link. Named now that there is one —
-- and only then, so applying this twice writes nothing.
update ouroboros.chat_commands cmd
   set invoker_link_id = link.id
  from ouroboros.chat_identity_links link
 where cmd.id = '5eed009c-0000-4000-8000-000000000201'
   and cmd.invoker_link_id is null
   and link.id = '5eed009c-0000-4000-8000-000000000301'
   and link.connection_id = cmd.connection_id
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- 6. …and its reply: loops live, issues queued and questions open, counted when it was sent.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, facts,
                                     payload_digest, posted_at)
select '5eed009c-0000-4000-8000-000000000105'::uuid, cmd.organization_id, cmd.channel_id,
       (extract(epoch from cmd.completed_at))::numeric(13, 3)::text,
       'command_reply',
       jsonb_build_object(
         'loops_live', (select count(*) from ouroboros.runs r
                         where r.organization_id = cmd.organization_id
                           and r.status in ('coding', 'building', 'review')),
         'queued',     (select count(*) from ouroboros.queue_items q
                         where q.organization_id = cmd.organization_id),
         'needs_you',  (select count(*) from ouroboros.decision_items i
                         where i.organization_id = cmd.organization_id and i.status = 'open')),
       encode(sha256(convert_to('command_reply:' || cmd.id, 'UTF8')), 'hex'),
       cmd.completed_at
  from ouroboros.chat_commands cmd
 where cmd.id = '5eed009c-0000-4000-8000-000000000201'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. The build card — Loop #1847 (run #482), its pull request, and its all-green test run's count.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, card_kind,
                                     refs, facts, payload_digest, posted_at)
select '5eed009c-0000-4000-8000-000000000106'::uuid, ch.organization_id, ch.id,
       (extract(epoch from now() - interval '6 minutes'))::numeric(13, 3)::text,
       'event_card', 'build_green',
       jsonb_build_array(
         jsonb_build_object('type', 'run', 'id', run.id::text, 'label', 'loop #' || run.loop_seq),
         jsonb_build_object('type', 'pr',  'id', pr.id::text,  'label', 'PR #' || pr.external_number)),
       jsonb_build_object('passed', green.passed, 'total', green.total),
       encode(sha256(convert_to('build_green:' || run.id, 'UTF8')), 'hex'),
       now() - interval '6 minutes'
  from ouroboros.chat_channels ch
  join ouroboros.runs run         on run.organization_id = ch.organization_id and run.issue_number = 482
  join ouroboros.pull_requests pr on pr.id = '5eed003a-0000-4000-8000-000000000514'
                                 and pr.organization_id = ch.organization_id
  join ouroboros.test_runs green  on green.id = '5eed0031-0000-4000-8000-000000004824'
                                 and green.run_id = run.id
                                 and green.status = 'complete' and green.passed = green.total
 where ch.id = '5eed009c-0000-4000-8000-0000000000a1'
   and ${ouro_dev_seed}
on conflict do nothing;
