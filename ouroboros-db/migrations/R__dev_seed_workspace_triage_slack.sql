-- R__dev_seed_workspace_triage_slack.sql — mockup 19 for acme-robotics: the Slack workspace, its
-- channels, who is who, the route rows, and `#ouroboros-loops`' stream as published records. A
-- development database and nowhere else (#534, BY.4, over #532's and #533's rows; the tables are
-- V130, V131 and V132).
--
-- [`docs/mockups/19-chatops.html`](../../docs/mockups/19-chatops.html) is reproduced **from rows
-- the other seeds already hold** — no loop, pull request, issue or decision is invented here, so
-- every ref resolves and the mirror's buttons go somewhere:
--
--   | The mockup                                      | Here                                          |
--   |-------------------------------------------------|-----------------------------------------------|
--   | `#ouroboros-loops · Slack · 24 members · v2.4`  | the connection's `install_meta` and channel   |
--   | 13:58 `✓ Loop #1846 finished — PR #512 merged`  | the merged loop of `#474` — the dashboard's   |
--   |        `14/14 checks · 11m cycle · fable`       |   run, with those very figures                |
--   | 14:07 `⏸ a question for you` → resolved 14:11   | the item Maya answered **from Slack**         |
--   | 14:11 `✓ Maya Chen answered: …`                 | that resolution                               |
--   | 14:12 `/ouro status` and its reply              | counted from runs, the queue and open items   |
--   | 14:13 `/ouro dry-run #486 feature-loop` + reply | a command, and a reply naming issue `#486`    |
--   | 14:31 `⟳ Loop #1847 build … green — 63/63`      | run `#482`, PR `#514`, its green test run     |
--   | the five route rows, stage transitions **off**  | five `custom:*` Slack routes, one disabled    |
--
-- **Where it departs, and why.** Each departure is a row that does not exist or that another seed
-- owns in a different state — decided on the ticket (2026-10-12):
--
--   * **Loop numbers are the universe's.** `#474`'s loop is `#1839` here (`1365 + issue`), not the
--     mockup's `#1846`; the card reads the run's own number.
--   * **The completion card has a run ref only.** Its `PR #512` is a figure on the run — there is
--     no `pull_requests` row for it and no canonical ticket `#474`, so neither can be a live ref.
--   * **The resolved question is a real answer.** Mockup 19 resolves the protected-path question
--     on `#479` with *allow once*; the inbox seed (#460) owns that item **open** — it is one of
--     mockup 16's three cards. So the resolved card is the question Maya really answered from
--     Slack in that seed (a resize review, `keep_size`), with her as its actor, an `edited_at` and
--     its system line. The protected-path item is seeded as the **open** card, after the
--     mockup's stream, so both states of a decision card have a fixture.
--   * **No cost, farm or dry-run figures that no row holds.** Runs carry no cost, so the card has
--     no `$0.94`; the status reply counts loops, queue, open questions and today's spend, and
--     leaves the farm line to the farm's own rule; the dry-run reply names the issue and the
--     workflow, and no dry run of `#486` is invented for it to point at.
--
-- **The stream carries the mockup's clock times**, on the day before the seed ran — 13:58, 14:07,
-- 14:11, 14:12, 14:12, 14:13, 14:13, 14:31 — rather than the times of the rows it is about. The
-- open card alone is stamped from its item, because it is live now.
--
-- **Routes are `custom:*` kinds**, so mockup 17's Settings rows (`weekly_insights` by email,
-- `loop_failures` by PagerDuty) are untouched. Since V133 (#536) the workspace's active Slack
-- connection unlocks them, so the four enabled ones deliver. *Every stage transition* is seeded
-- **disabled**: noisy, off by default.
--
-- **Who is who (#533).** Ken and Maya have linked Slack identities, each confirmed in an app
-- session; Ken is on call for decisions. Jorge's identity was linked by an admin and then
-- **revoked** — the fixture for the unlinked and revoked states.
--
-- **Nothing here is a credential.** `bot_token_sealed` is held by a CHECK to AD.1's sealed
-- `ouro.v1.1.<nonce>.<body>` envelope (#222), which is the only shape the column takes; this
-- one's body decodes to `dev-seed-value-not-a-real-bot-token`, as every seeded envelope's does.
-- SQL cannot seal — that needs the vault's key — so the seed exercises the column's rule, not a
-- decryption. No audit event is written: the audit seeds' counts are other tests' to keep.
--
-- **Why this name.** The cards are the triage inbox's items and the loops are the dashboard's,
-- so this file must sort after both: `dev_seed_workspace_triage_slack` sorts after
-- `dev_seed_workspace_triage_inbox`, the last.
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
-- …and Jorge's, which an admin assigned and Maya later revoked — kept, as a revoked link is.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_identity_links (id, organization_id, connection_id, platform_user_id,
                                           member_id, state, verified_via, display_name_cache,
                                           linked_at, revoked_at, revoked_by)
select '5eed009c-0000-4000-8000-000000000303'::uuid, conn.organization_id, conn.id,
       'U07JORGE', member."id", 'revoked', 'admin_assigned', person."name",
       conn.installed_at + interval '2 days', conn.installed_at + interval '9 days', maya."id"
  from ouroboros.chat_connections conn
  join ouroboros."user" person on person."email" = 'jorge@acme-robotics.dev'
  join ouroboros.member member on member."userId" = person."id"
                              and member."organizationId" = conn.organization_id
  join ouroboros."user" maya   on maya."email" = 'maya@acme-robotics.dev'
 where conn.id = '5eed009c-0000-4000-8000-000000000001'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- What gets published where — mockup 19's five rows. Stage transitions are off by default.
-- ---------------------------------------------------------------------------
insert into ouroboros.notification_routes (organization_id, kind, channel, enabled, chat_channel_id,
                                           dm_on_call, updated_by)
select ch.organization_id, seed.kind, 'slack', seed.enabled, ch.id, seed.dm_on_call, ken."id"
  from (values
         ('custom:loop-finished',      'C071LOOPS', true,  false),
         ('custom:blocking-questions', 'C071LOOPS', true,  true),
         ('custom:build-failures',     'C072ALERT', true,  false),
         ('custom:weekly-insights',    'C073LEADS', true,  false),
         ('custom:stage-transitions',  'C071LOOPS', false, false)
       ) as seed (kind, channel_id, enabled, dm_on_call)
  join ouroboros.chat_channels ch on ch.connection_id = '5eed009c-0000-4000-8000-000000000001'
                                 and ch.channel_id = seed.channel_id
  join ouroboros."user" ken       on ken."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 13:58 — the completion card: the merged loop of #474, with the run's own figures.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, card_kind,
                                     refs, facts, payload_digest, posted_at)
select '5eed009c-0000-4000-8000-000000000101'::uuid, ch.organization_id, ch.id,
       (extract(epoch from stamp.at))::numeric(13, 3)::text,
       'event_card', 'loop_finished',
       jsonb_build_array(
         jsonb_build_object('type', 'run', 'id', run.id::text, 'label', 'loop #' || run.loop_seq)),
       jsonb_build_object(
         'outcome', run.status,
         'issue_number', run.issue_number,
         'issue_title', run.issue_title,
         'pr_number', run.pr_number,
         'checks_passed', run.checks_passed,
         'checks_total', run.checks_total,
         'cycle_seconds', extract(epoch from run.finished_at - run.started_at)::integer,
         'model', run.model),
       encode(sha256(convert_to('loop_finished:' || run.id, 'UTF8')), 'hex'),
       stamp.at
  from ouroboros.chat_channels ch
  join ouroboros.runs run on run.organization_id = ch.organization_id
                         and run.issue_number = 474 and run.status = 'merged'
  cross join lateral (select date_trunc('day', now() - interval '1 day') + time '13:58' as at) stamp
 where ch.id = '5eed009c-0000-4000-8000-0000000000a1'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 14:07 → 14:11 — the question card, resolved: the item Maya answered from Slack, as the edit
-- left it. The outcome and the actor are that resolution's.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, card_kind,
                                     decision_item_id, refs, state, outcome, resolved_by, resolved_at,
                                     payload_digest, posted_at, edited_at)
select '5eed009c-0000-4000-8000-000000000103'::uuid, ch.organization_id, ch.id,
       (extract(epoch from stamp.posted))::numeric(13, 3)::text,
       'decision_card', item.kind_id, item.id, item.refs, 'resolved',
       answer.action_id, answer.resolved_by_user, stamp.answered,
       encode(sha256(convert_to('decision_card:' || item.id || ':' || answer.action_id, 'UTF8')), 'hex'),
       stamp.posted, stamp.answered
  from ouroboros.chat_channels ch
  join ouroboros.decision_items item         on item.organization_id = ch.organization_id
                                            and item.id = '5eed0082-0000-4000-8000-000000000104'
  join ouroboros.decision_resolutions answer on answer.item_id = item.id
                                            and answer.channel = 'slack'
                                            and answer.resolver = 'human'
  cross join lateral (select date_trunc('day', now() - interval '1 day') + time '14:07' as posted,
                             date_trunc('day', now() - interval '1 day') + time '14:11' as answered) stamp
 where ch.id = '5eed009c-0000-4000-8000-0000000000a1'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 14:11 — the system line the answer added under it, about the same item.
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
-- 14:12 and 14:13 — Ken's two commands, typed in the channel. The invoker is his identity link.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_commands (id, organization_id, connection_id, channel_id, invoker_link_id,
                                     platform_user_id, surface, command, args, raw_text, outcome,
                                     result_ref, invoked_at, completed_at)
select ('5eed009c-0000-4000-8000-0000000002' || seed.n)::uuid, ch.organization_id, ch.connection_id,
       ch.id, link.id, link.platform_user_id, 'slack', seed.command, seed.args, seed.raw_text, 'ok',
       jsonb_build_object('message', '5eed009c-0000-4000-8000-0000000001' || seed.reply),
       date_trunc('day', now() - interval '1 day') + seed.at,
       date_trunc('day', now() - interval '1 day') + seed.at + seed.took
  from (values
         ('01', 'status',  '{}'::jsonb, '/ouro status',
          '05', time '14:12', interval '1 second'),
         ('02', 'dry-run', '{"issue": 486, "workflow": "feature-loop"}', '/ouro dry-run #486 feature-loop',
          '07', time '14:13', interval '20 seconds')
       ) as seed (n, command, args, raw_text, reply, at, took)
  join ouroboros.chat_channels ch on ch.id = '5eed009c-0000-4000-8000-0000000000a1'
  join ouroboros.chat_identity_links link on link.id = '5eed009c-0000-4000-8000-000000000301'
                                         and link.connection_id = ch.connection_id
 where ${ouro_dev_seed}
on conflict do nothing;

-- A database seeded before #533 holds the status command with no link. Named now that there is
-- one — and only then, so applying this twice writes nothing.
update ouroboros.chat_commands cmd
   set invoker_link_id = link.id
  from ouroboros.chat_identity_links link
 where cmd.id = '5eed009c-0000-4000-8000-000000000201'
   and cmd.invoker_link_id is null
   and link.id = '5eed009c-0000-4000-8000-000000000301'
   and link.connection_id = cmd.connection_id
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- 14:12 — the status reply: loops live, issues queued, questions open and today's spend, counted.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, facts,
                                     payload_digest, posted_at)
select '5eed009c-0000-4000-8000-000000000105'::uuid, cmd.organization_id, cmd.channel_id,
       (extract(epoch from cmd.completed_at))::numeric(13, 3)::text,
       'command_reply',
       jsonb_strip_nulls(jsonb_build_object(
         'loops_live', (select count(*) from ouroboros.runs r
                         where r.organization_id = cmd.organization_id
                           and r.status in ('coding', 'building', 'review')),
         'queued',     (select count(*) from ouroboros.queue_items q
                         where q.organization_id = cmd.organization_id),
         'needs_you',  (select count(*) from ouroboros.decision_items i
                         where i.organization_id = cmd.organization_id and i.status = 'open'),
         'spend_today_cents', (select sum(u.cost_cents)::bigint from ouroboros.token_usage_daily u
                                where u.organization_id = cmd.organization_id
                                  and u.day = (now() at time zone 'UTC')::date))),
       encode(sha256(convert_to('command_reply:' || cmd.id, 'UTF8')), 'hex'),
       cmd.completed_at
  from ouroboros.chat_commands cmd
 where cmd.id = '5eed009c-0000-4000-8000-000000000201'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 14:13 — the dry-run reply: which issue and which workflow. The issue is a live ref.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, refs, facts,
                                     payload_digest, posted_at)
select '5eed009c-0000-4000-8000-000000000107'::uuid, cmd.organization_id, cmd.channel_id,
       (extract(epoch from cmd.completed_at))::numeric(13, 3)::text,
       'command_reply',
       jsonb_build_array(
         jsonb_build_object('type', 'ticket', 'id', ticket.id::text, 'label', 'issue ' || ticket.external_key)),
       jsonb_build_object('workflow', workflow.slug, 'issue_title', ticket.title),
       encode(sha256(convert_to('command_reply:' || cmd.id, 'UTF8')), 'hex'),
       cmd.completed_at
  from ouroboros.chat_commands cmd
  join ouroboros.tickets ticket     on ticket.organization_id = cmd.organization_id
                                   and ticket.external_key = '#' || (cmd.args ->> 'issue')
  join ouroboros.workflows workflow on workflow.organization_id = cmd.organization_id
                                   and workflow.slug = cmd.args ->> 'workflow'
 where cmd.id = '5eed009c-0000-4000-8000-000000000202'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 14:31 — the build card: Loop #1847 (run #482), its pull request, its all-green test run's count.
-- ---------------------------------------------------------------------------
insert into ouroboros.chat_messages (id, organization_id, channel_id, platform_ts, kind, card_kind,
                                     refs, facts, payload_digest, posted_at)
select '5eed009c-0000-4000-8000-000000000106'::uuid, ch.organization_id, ch.id,
       (extract(epoch from stamp.at))::numeric(13, 3)::text,
       'event_card', 'build_green',
       jsonb_build_array(
         jsonb_build_object('type', 'run', 'id', run.id::text, 'label', 'loop #' || run.loop_seq),
         jsonb_build_object('type', 'pr',  'id', pr.id::text,  'label', 'PR #' || pr.external_number)),
       jsonb_build_object('passed', green.passed, 'total', green.total),
       encode(sha256(convert_to('build_green:' || run.id, 'UTF8')), 'hex'),
       stamp.at
  from ouroboros.chat_channels ch
  join ouroboros.runs run         on run.organization_id = ch.organization_id and run.issue_number = 482
  join ouroboros.pull_requests pr on pr.id = '5eed003a-0000-4000-8000-000000000514'
                                 and pr.organization_id = ch.organization_id
  join ouroboros.test_runs green  on green.id = '5eed0031-0000-4000-8000-000000004824'
                                 and green.run_id = run.id
                                 and green.status = 'complete' and green.passed = green.total
  cross join lateral (select date_trunc('day', now() - interval '1 day') + time '14:31' as at) stamp
 where ch.id = '5eed009c-0000-4000-8000-0000000000a1'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- After the mockup's stream — the question that is open now: the inbox's own *allow once* item,
-- with the item's own refs and its own moment.
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
