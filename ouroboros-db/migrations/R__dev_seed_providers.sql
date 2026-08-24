-- R__dev_seed_providers.sql — mockup 07, card for card, in a development database and
-- nowhere else.
--
-- The third development seed, and it answers the third question: R__dev_seed.sql (#23) is
-- *who exists*, R__dev_seed_dashboard.sql (#68) is *what the loop has done*, and this is
-- **what the loop is allowed to call**. All of it belongs to `acme-robotics`, which is the
-- workspace every mockup is drawn in.
--
-- docs/mockups/07-providers.html draws five cards, and every part of each one that is not
-- a live API call is a column here:
--
--   | Card                          | kind                | Cap  | This month | Models |
--   |-------------------------------|---------------------|-----:|-----------:|-------:|
--   | Anthropic Claude              | `anthropic`         | $600 |    $412.80 |      4 |
--   | Cursor                        | `cursor`            | $120 |     $64.10 |      1 |
--   | GitHub Copilot                | `copilot`           |  $95 |     $76.00 |      1 |
--   | OpenAI-compatible · local vLLM| `openai_compatible` |    — |      $0.00 |      2 |
--   | Ollama · workstation          | `ollama`            |    — |      $0.00 |      3 |
--
-- Filed as issue #221 (AC.6). The schema it fills is V015 (#189) as extended by V017.
--
-- ---------------------------------------------------------------------------
-- The three seeds share one workspace, and the numbers have to add up across them.
-- ---------------------------------------------------------------------------
--
-- **The meters are not this file's rows alone.** A card's *This month* figure is calendar-
-- month spend over `token_usage`, and R__dev_seed_dashboard.sql already writes twelve
-- events dated *today* — $11.40 of Anthropic, $5.40 of Copilot, $1.80 of Cursor and three
-- unpriced Ollama events. R__dev_seed_routing.sql (#192) then writes the **routed** calls
-- mockup 06's matrix is computed from. All of those are inside the current month too, so
-- what this file writes is the **remainder**:
--
--   | Provider    | #68 today | #192 routed |     here | month total | mockup  |
--   |-------------|----------:|------------:|---------:|------------:|--------:|
--   | `anthropic` |    $11.40 |      $22.25 |  $379.15 |    $412.80  | $412.80 |
--   | `cursor`    |     $1.80 |       $0.00 |   $62.30 |     $64.10  |  $64.10 |
--   | `copilot`   |     $5.40 |       $1.80 |   $68.80 |     $76.00  |  $76.00 |
--   | `ollama`    |  unpriced |  zero-price | unpriced |      $0.00  |   $0.00 |
--
-- Cursor is untouched by that third column because no task kind routes its *primary* hop
-- to `second-opinion`: the alias is a review vote a rule adds, so #192 seeds no spend on
-- it and this file still owns the whole of the Cursor meter.
--
-- The Ollama token count works the same way: 500 000 today, plus 600 000 of routed `docs`
-- calls from #192, plus 1 000 000 here is the card's *2.1M tokens on-box*. What changed
-- with #192 is the **vLLM** card. It used to have no usage rows at all, and its *no
-- metered spend* line was a zero written as an absence; mockup 06's `commit-msg` row reads
-- `$0.00`, and decision M7 says that figure may only come from real zero-price rows, so
-- #192 gives vLLM `cost_cents = 0` events — priced, and priced at nothing. The card still
-- renders `$0.00 · no metered spend`, and now says so because the calls were metered and
-- cost nothing rather than because nobody looked. See #192's header on why *unpriced* and
-- *zero-priced* have to stay tellable apart.
--
-- **Nothing here lands on today**, and that is a rule rather than an accident: mockup 02's
-- *Token spend · today* card is exactly #68's twelve events, and a row of this file inside
-- the current UTC day would change a number that seed's own assertions pin. So every event
-- below is placed in `[window_start, today 00:00 UTC)` — see the insert for how the window
-- is chosen, including on the first of a month, when *earlier this month* is an empty
-- range and the rows fall on the last day of the previous one instead. On that one day the
-- meters read the day's spend alone; on the other twenty-seven to thirty they are the
-- mockup's figures exactly. Both branches are asserted in tests/seed.sql.
--
-- R__dev_seed_routing.sql (#192) is the fourth seed, and it hangs off this one: mockup 06's
-- aliases, routes and chains name these connections. It finds them by natural key —
-- workspace slug and `kind` — so nothing there has to repeat an id from the table below,
-- and its file name sorts after `dev_seed_providers` for the same reason this one sorts
-- after `dev_seed_dashboard` (see the ordering note in tests/seed.test.sh).
--
-- ---------------------------------------------------------------------------
-- Ids, and the three properties every seed here has.
-- ---------------------------------------------------------------------------
--
-- Three prefixes, on the convention R__dev_seed.sql set — an id beginning `5eed` came from
-- a seed, and the two hex digits after it say which table:
--
--   | Rows                       | Id                                              |
--   |----------------------------|-------------------------------------------------|
--   | `provider_connections` (5) | `5eed000c-0000-4000-8000-` + card number 1–5    |
--   | `provider_models` (11)     | `5eed000d-0000-4000-8000-` + ordinal 1–11       |
--   | `token_usage` (11)         | `5eed000e-0000-4000-8000-` + ordinal 1–11       |
--
-- It **cannot run in production** (every statement ends `and ${ouro_dev_seed}`, which is
-- `false` in flyway.toml), it is **idempotent** (every id is a literal and every statement
-- ends `on conflict do nothing`), and it **never fails on a database somebody has edited**
-- (children find their parents by natural key — the workspace by slug, the person by
-- email, a connection by its kind and name). The long form of all three is in
-- R__dev_seed.sql's header; tests/seed.test.sh asserts them over this file too.
--
-- ---------------------------------------------------------------------------
-- The credentials are envelopes, and they are not keys.
-- ---------------------------------------------------------------------------
--
-- `credentials_encrypted` is envelope-only by CHECK (V015), so the three cloud connections
-- carry a well-formed `ouro.v1.1.<nonce>.<ciphertext>` value whose base64url body decodes
-- to the words *dev-seed-value-not-a-real-credential-…*. It is **not decryptable**: a real
-- envelope is AES-256-GCM under a workspace DEK bound to the row's id (AD.1, #222), and no
-- SQL file can produce one. What it is for is that the card renders its masked key row, and
-- that the column's rule is exercised by the data a developer actually has.
--
-- So *Reveal* against a seeded connection fails in the designed way rather than showing a
-- key, which is the honest outcome for demo data and is what AD.2 (#223) has to handle
-- anyway for a value sealed under a rotated-away version. The two local connections carry
-- **null**, because a local provider needs no credential — the mockup draws vLLM's key
-- field as *optional, no auth configured* and gives Ollama none at all.

-- ---------------------------------------------------------------------------
-- The five connections.
--
-- `capability_note` is the card's second line verbatim (V017 says why it is stored rather
-- than composed), `enabled` is the switch — every one of the mockup's five is on — and
-- `status` is the *health* the pills draw: four `active`, and `error` for Copilot, whose
-- card reads *degraded upstream* with `△ 503 upstream · retrying` in its foot. The two are
-- independent by design, and the demo happens to show only the *on* half of that; the
-- combination a card has to draw carefully — enabled and unhealthy — is Copilot's.
--
-- `created_at` is the meta row's date (*Added by Ken · 2026-06-12*), so it is a literal
-- rather than a window: the mockup prints a date, and a date that moved with the stack's
-- clock would be a different screen every day. `last_used_at` is the other half of that
-- line and *is* relative, because *last used 3m ago* is only true if it is measured from
-- now.
--
-- `base_url` is set where the connection genuinely has an address: the two local ones,
-- which V015 requires it for, and nothing else. The hostnames on the Anthropic and Cursor
-- cards are part of their capability line, not a proxy somebody configured.
--
-- `health` carries **what the last check measured**, which is what mockup 06's `.phealth`
-- strip prints and what V015's own header spells out chip for chip — `Anthropic ● 42ms`,
-- `GitHub Copilot ⚠ degraded · elevated latency`, `OpenAI-compatible ● vLLM local`,
-- `Ollama ● workstation · 3 models`. V015 requires a `last_checked_at` beside any content,
-- so every row has one: these connections have been checked, minutes ago, which is what a
-- running stack looks like.
--
-- **Mockup 07's `✓ 200 · 38ms` is not this column**, which is the correction #192 (Y.4)
-- makes to the values this file first carried. That note sits beside the *Test connection*
-- button and is the result of a probe somebody just clicked — a transient reply, not a
-- stored snapshot — so the two screens read different things and only one of them is a
-- column. Storing the button's reply here left the strip printing `38ms` where the design
-- says `42ms`, and left Cursor claiming a latency mockup 06 deliberately shows nothing for.
--
-- Two rows therefore say *nothing was measured* in the only way V015 permits. Cursor keeps
-- an **empty** `health`: its chip is a name and a dot, and the way to say no latency was
-- taken is to leave the key out rather than to write a zero. The two local rows carry no
-- `latency_ms` either, for the reason Z.3 (#196) states as `ProviderCheck.reportsLatency`:
-- a daemon on loopback answers in a time dominated by the interface, and an unvarying
-- `0ms` printed beside Anthropic's real `42ms` teaches a reader to ignore both. What they
-- carry instead is what their chips actually print — vLLM's `detail`, and Ollama's model
-- count beside the machine it runs on.
-- ---------------------------------------------------------------------------
insert into ouroboros.provider_connections
    (id, organization_id, kind, display_name, base_url, credentials_encrypted,
     status, last_checked_at, health, monthly_cap_cents, added_by, last_used_at,
     capability_note, enabled, created_at)
select seed.id::uuid, org."id", seed.kind, seed.display_name, seed.base_url,
       seed.credentials, seed.status, now() - seed.checked_ago::interval,
       seed.health::jsonb, seed.cap_cents, person."id",
       now() - seed.used_ago::interval, seed.capability_note, true,
       seed.added_on::timestamptz
  from (values
         ('5eed000c-0000-4000-8000-000000000001', 'anthropic', 'Anthropic Claude',
          null, 'ouro.v1.1.c2VlZC1ub25jZS0x.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWFudGhyb3BpYw',
          'active', '2 minutes', '{"latency_ms": 42}', 60000, '3 minutes',
          'api.anthropic.com · primary coding lane', '2026-06-12 16:20:00+00'),
         ('5eed000c-0000-4000-8000-000000000002', 'cursor', 'Cursor',
          null, 'ouro.v1.1.c2VlZC1ub25jZS0y.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWN1cnNvcg',
          'active', '4 minutes', '{}', 12000, '26 minutes',
          'api.cursor.com · used for second-opinion reviews', '2026-07-02 10:05:00+00'),
         ('5eed000c-0000-4000-8000-000000000003', 'copilot', 'GitHub Copilot',
          null, 'ouro.v1.1.c2VlZC1ub25jZS0z.ZGV2LXNlZWQtdmFsdWUtbm90LWEtcmVhbC1jcmVkZW50aWFsLWNvcGlsb3Q',
          'error', '90 seconds', '{"detail": "elevated latency"}', 9500, '72 minutes',
          'billed through GitHub org acme-robotics', '2026-06-18 09:40:00+00'),
         ('5eed000c-0000-4000-8000-000000000004', 'openai_compatible',
          'OpenAI-compatible · local vLLM', 'http://10.0.4.20:8000/v1', null,
          'active', '3 minutes', '{"detail": "vLLM local"}', null, '9 minutes',
          'self-hosted · A100 ×2', '2026-05-30 14:12:00+00'),
         ('5eed000c-0000-4000-8000-000000000005', 'ollama', 'Ollama · workstation',
          'http://ken-station.local:11434', null,
          'active', '1 minute', '{"models": 3, "detail": "workstation"}', null, '41 seconds',
          'zero-cost lane — used for docs & commit messages', '2026-05-14 08:55:00+00')
       ) as seed (id, kind, display_name, base_url, credentials, status, checked_ago,
                  health, cap_cents, used_ago, capability_note, added_on)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros."user" person on person."email" = 'ken@acme-robotics.dev'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- What discovery found — the chips, and the Ollama pull-list.
--
-- Eleven rows, and each one is a chip or a pull-list line on a card: Anthropic's four
-- models, one apiece for Cursor and Copilot, vLLM's two, and the three models on the
-- workstation. `model_id` is the provider's own string and `display` is what the chip
-- prints, which is why the local ones differ — `llama-4-maverick` is served as
-- `local/llama-4-maverick`.
--
-- `size_bytes` is only ever set for the Ollama models, because only a locally-pulled model
-- has an on-disk size. The three are the mockup's `19 GB`, `63 GB` and `9.1 GB` in bytes,
-- base ten, which is the unit Ollama itself prints — the UI (AE.4, #230) does the
-- formatting, and this column stays a fact.
--
-- `meta.context_tokens` is the same key `model_prices.meta` carries (V012), so a caller
-- joining a discovered model to its price is not made to translate; the Anthropic rows also
-- carry `"tier": "priority"`, which is the *real signal* behind that card's `priority tier`
-- pill. Nothing invents a tier for the other four connections.
--
-- `discovered_at` is minutes ago rather than a literal: it is what mockup 21 renders as
-- *listed live from the provider*, and a fixed date would make a freshly started stack look
-- like it had not talked to a provider in months.
-- ---------------------------------------------------------------------------
insert into ouroboros.provider_models
    (id, provider_connection_id, model_id, display, size_bytes, meta, discovered_at)
select ('5eed000d-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid,
       conn.id, seed.model_id, seed.display, seed.size_bytes, seed.meta::jsonb,
       now() - seed.found_ago::interval
  from (values
         ( 1, 'anthropic', 'Anthropic Claude', 'claude-fable-5', 'claude-fable-5',
          null::bigint, '{"context_tokens": 1000000, "tier": "priority"}', '4 minutes'),
         ( 2, 'anthropic', 'Anthropic Claude', 'claude-opus-5', 'claude-opus-5',
          null, '{"context_tokens": 1000000, "tier": "priority"}', '4 minutes'),
         ( 3, 'anthropic', 'Anthropic Claude', 'claude-sonnet-5', 'claude-sonnet-5',
          null, '{"context_tokens": 1000000, "tier": "priority"}', '4 minutes'),
         ( 4, 'anthropic', 'Anthropic Claude', 'claude-haiku-4-5', 'claude-haiku-4-5',
          null, '{"context_tokens": 200000, "tier": "priority"}', '4 minutes'),
         ( 5, 'cursor', 'Cursor', 'composer-2', 'cursor/composer-2',
          null, '{"context_tokens": 200000}', '6 minutes'),
         ( 6, 'copilot', 'GitHub Copilot', 'gpt-5-codex', 'copilot/gpt-5-codex',
          null, '{"context_tokens": 128000}', '11 minutes'),
         ( 7, 'openai_compatible', 'OpenAI-compatible · local vLLM',
          'llama-4-maverick', 'local/llama-4-maverick',
          null, '{"context_tokens": 1000000}', '5 minutes'),
         ( 8, 'openai_compatible', 'OpenAI-compatible · local vLLM',
          'deepseek-v3.2', 'local/deepseek-v3.2',
          null, '{"context_tokens": 163840}', '5 minutes'),
         ( 9, 'ollama', 'Ollama · workstation', 'qwen3-coder:32b', 'qwen3-coder:32b',
          19000000000, '{"context_tokens": 262144}', '2 minutes'),
         (10, 'ollama', 'Ollama · workstation', 'llama4:scout', 'llama4:scout',
          63000000000, '{"context_tokens": 10485760}', '2 minutes'),
         (11, 'ollama', 'Ollama · workstation', 'phi4:14b', 'phi4:14b',
          9100000000, '{"context_tokens": 16384}', '2 minutes')
       ) as seed (n, kind, display_name, model_id, display, size_bytes, meta, found_ago)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.provider_connections conn
    on conn.organization_id = org."id"
   and conn.kind = seed.kind
   and conn.display_name = seed.display_name
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Earlier this month — the spend the meters are made of.
--
-- Eleven events, and they are the *remainder* the header's table works out: with #68's
-- twelve of today and #192's routed calls added, the calendar month totals $412.80 of
-- Anthropic, $64.10 of Cursor and $76.00 of Copilot, and 2.1M Ollama tokens that cost
-- nothing because they ran on a workstation. `cost_cents` is null on the two Ollama rows
-- for the reason V010 made the column nullable and #68 used it: *unpriced* is not *free of
-- charge*, and a local model has no price to record. #192's local rows say the other thing
-- — `cost_cents = 0`, a call that was priced and priced at nothing — and the two are meant
-- to sit side by side in one workspace, because the honesty rule DASH-J.4 (#92) enforces
-- is only testable where both states exist.
--
-- These are also the three figures **#192 must not disturb**, which is why it takes its
-- routed spend out of this file's share rather than adding to it. Change an amount here and
-- the month meters move; the arithmetic that keeps them still is the header's table.
--
-- The amounts are recorded facts about demo calls, not arithmetic over
-- `R__model_price_catalog.sql` — the same choice #68 made, and the reason #92 will find
-- nothing here to re-price that it did not write. `model` is the provider's own id, which
-- is what `provider_models` above now makes checkable; #68's rows predate that catalog and
-- keep the namespaced spellings they were written with. Everything that reads spend per
-- provider groups by the `provider` column, which both files spell the same way.
--
-- **The window.** Every event is placed strictly before today's UTC midnight, because
-- mockup 02's *today* card is #68's twelve events and nothing else: `occurred_at` is
-- `start + (today 00:00 − start) × n/12`, so eleven ordinals land inside the window and
-- none on its far edge. `start` is the later of the month's first instant and thirteen days
-- ago — except on the first of a month, when *earlier this month* is empty and the window
-- is yesterday instead, which is the one day the meters read the day's spend alone. The
-- alternative was a seed whose row count changed with the date, and a fixture that is
-- eleven rows on some days and none on others is a fixture no test can pin.
-- ---------------------------------------------------------------------------
insert into ouroboros.token_usage
    (id, organization_id, run_id, provider, model, tokens_in, tokens_out,
     cost_cents, occurred_at)
select ('5eed000e-0000-4000-8000-' || lpad(seed.n::text, 12, '0'))::uuid,
       org."id", null, seed.provider, seed.model,
       seed.tokens_total / 5 * 4, seed.tokens_total / 5, seed.cost_cents,
       month_window.start_at
         + (utc.day_start - month_window.start_at) * (seed.n::double precision / 12)
  from (values
         ( 1, 'anthropic', 'claude-fable-5',  10000000, 18000.0000),
         ( 2, 'anthropic', 'claude-opus-5',    8000000, 14000.0000),
         ( 3, 'anthropic', 'claude-sonnet-5',  6000000,  5915.0000),
         ( 4, 'cursor',    'composer-2',       2000000,  3200.0000),
         ( 5, 'cursor',    'composer-2',       1500000,  2000.0000),
         ( 6, 'cursor',    'composer-2',        900000,  1030.0000),
         ( 7, 'copilot',   'gpt-5-codex',      2400000,  3500.0000),
         ( 8, 'copilot',   'gpt-5-codex',      1600000,  2400.0000),
         ( 9, 'copilot',   'gpt-5-codex',      1000000,   980.0000),
         (10, 'ollama',    'qwen3-coder:32b',   625000,  null),
         (11, 'ollama',    'qwen3-coder:32b',   375000,  null)
       ) as seed (n, provider, model, tokens_total, cost_cents)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  cross join (select date_trunc('month', now() at time zone 'utc') at time zone 'utc',
                     date_trunc('day',   now() at time zone 'utc') at time zone 'utc')
          as utc (month_start, day_start)
  cross join lateral (select case
                              when utc.month_start < utc.day_start
                              then greatest(utc.month_start,
                                            utc.day_start - interval '13 days')
                              else utc.day_start - interval '1 day'
                            end)
          as month_window (start_at)
 where ${ouro_dev_seed}
on conflict do nothing;
