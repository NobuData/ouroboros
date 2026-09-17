-- R__dev_seed_ticket_planning.sql — mockup 09's Planning page, as rows, in a development
-- database and nowhere else.
--
-- The ninth development seed. R__dev_seed_sources.sql (#138) says *where the work comes from*;
-- this file puts in **the work itself and the plan over it**: the canonical backlog that
-- mockup 09's *Tracker Sync* and *Backlog Health* cards count, the five lanes of its
-- *Roadmap* gantt, and the six-draft OTA batch of its *Generate Tickets* card
-- ([`docs/mockups/09-planning.html`](../../docs/mockups/09-planning.html)). All of it belongs to
-- `acme-robotics`. **The personal workspace `kensuenobu` gets nothing** — no ticket, no lane,
-- no batch — and that absence is AM.5's (#287) guidance-path fixture and the case in which
-- the generator footer's `$` is omitted (decision N10). `acme-labs` gets nothing either.
--
-- Named `ticket_planning` for its *sort order* as much as its subject: Flyway applies
-- repeatable migrations in the order of their descriptions, and every ticket here hangs off
-- the GitHub source R__dev_seed_sources.sql creates. `dev_seed_ticket_planning` sorts after
-- `dev_seed_sources`; `dev_seed_planning` would sort before it, and on a database migrated
-- from empty every insert below would join to nothing. tests/seed.test.sh asserts the order.
--
-- ---------------------------------------------------------------------------
-- **Every number the page prints is computed. None is stored.**
-- ---------------------------------------------------------------------------
--
-- The rows are shaped so that the mockup's figures *fall out* of the obvious aggregates, and
-- the file contains none of the figures themselves (tests/seed.test.sh refuses them):
--
--   | Rendered                              | Computed from                                     |
--   |---------------------------------------|---------------------------------------------------|
--   | `42 open` · `two-way sync · 42 issues`| `tickets` in the GitHub source with state `open`  |
--   | Sized `38/42`                         | open tickets whose `sizing_status` is `sized`     |
--   | Blocked `4`                           | open tickets with an **open** blocker (V035)      |
--   | Stale > 30d `6`                       | open tickets, `source_updated_at < now() - 30d`   |
--   | `12 issues · 8 done` … `7 · 0`        | `planning_epic_progress` (V036)                   |
--   | `✓ all sized`                         | every selected draft has an estimate row          |
--   | `~3 days of loop time`                | Σ `breakdown.est_minutes` = 4 320 min = 3.0 days  |
--   | `$14 est. spend`                      | Σ `est_tokens` × the bundled input rate (N10)     |
--   | TODAY in the second month column      | lane months relative to `date_trunc('month', now())` |
--
-- **Sized is the pipeline's column, not an estimate row.** `issue_estimates` has exactly two
-- kinds of subject — a mirrored `github_issues` row or a `ticket_drafts` row (V034, decision
-- N3) — and no reference to a canonical ticket, so the only per-ticket record of what the
-- shared pipeline concluded is `tickets.sizing_status` (V030 kept V014's vocabulary verbatim
-- for exactly that reason). Thirty-eight open tickets are `sized` and the other four
-- `unsized`, which is also the backlog AL.5's (#281) nightly job is meant to pick up. The
-- drafts, which *can* carry estimate rows, carry them.
--
-- **Each metric has a row built to tell a right answer from a nearly-right one.**
--
--   * *Blocked* — `#551` is blocked by two open tickets and counts **once**; `#550` is blocked
--     only by `#545`, which is **closed**, so its blocker is resolved and it does not count;
--     `#556` and `#565` are blocked through `synced` edges, so a count over `planned` alone
--     reads 2. `count(*)` over edges reads 6; the answer is 4.
--   * *Stale* — `#540`–`#545`, `#552` and `#553` are closed and untouched for over a month,
--     so a count that forgets `state = 'open'` reads 14; `#585` was updated 28 days ago and is the near miss on the
--     other side of the threshold.
--   * *Sized* — the ten closed tickets are all `sized`, so a count that forgets the state
--     reads 48/52.
--   * *Chips* — ten tickets (`#582`–`#591`) belong to no lane, so a chip computed over the
--     source rather than through `epic_tickets` is wrong for every lane.
--
-- ---------------------------------------------------------------------------
-- **Coordinated with INTAKE-K.5 (#103) and DASH-F.5 (#68).**
-- ---------------------------------------------------------------------------
--
-- R__dev_seed_intake.sql mirrors nine issues, `#483`–`#491`, into `github_issues`, and
-- R__dev_seed_dashboard.sql's runs and queue items name issues `#300`–`#345` and
-- `#465`–`#496`. The canonical tickets here are **`#540`–`#591`** — no number any other seed
-- uses — and they live in `tickets`, a different table. So mockup 03's head still computes
-- *"9 open issues. 7 already sized."* over its mirror while mockup 09 computes 42/38 over
-- the canonical backlog, and neither seed's arithmetic moves the other's. Copying the nine
-- intake issues into `tickets` was the alternative, and R__dev_seed_sources.sql's header
-- already explains why one backlog in two tables is the copy that drifts.
--
-- ---------------------------------------------------------------------------
-- **The TODAY marker lands in the second column because the months are relative.**
-- ---------------------------------------------------------------------------
--
-- The mockup draws Jul–Dec with TODAY ≈ 26% into Aug. What that layout *means* is that the
-- first lane started last month and the current month is the second column, so every range
-- is an offset from `date_trunc('month', now())` rather than a 2026 literal: OTA hardening is
-- −1…+1, BLE provisioning 0…+2, Motor control +1…+3, Fleet telemetry +2…+4. A literal would
-- put the marker off the right-hand edge of the gantt the first month after it was typed.
-- `roadmap_window` is composed from the same two offsets, so the card's `Q3–Q4 2026` tag
-- reads whatever quarters the lanes actually span today. *Zephyr 4.2 migration* has **null
-- months** (V036's paired nulls — the dashed, unscoped lane) and status `proposed`, the affix
-- the mockup prints beside it.
--
-- ---------------------------------------------------------------------------
-- **The `$` exists because the rates do (decision N10).**
-- ---------------------------------------------------------------------------
--
-- No price is written here. Each draft's `routed_model` is a `model_id` that one of
-- `acme-robotics`' aliases (R__dev_seed_routing.sql) binds, so AL.4's summary resolves its
-- connection kind and prices it through `ouroboros.model_price()` against the bundled
-- catalog (R__model_price_catalog.sql): `claude-fable-5` at 1000¢ and `claude-sonnet-5` at
-- 200¢ per 1M input tokens, and `qwen3-coder:32b` on `ollama`, which is `free`. The tokens
-- are chosen so the priced subtotal is 1 000 + 400 + 0 = 1 400¢, which the footer prints as
-- `$14`. The empty personal workspace has no batch and no alias, so nothing there resolves a
-- rate and its footer has no `$` to print. Seeding an org override instead
-- would have put a row into mockup 21's registry that its own seed does not account for.
--
-- ---------------------------------------------------------------------------
-- **What is deliberately not written.**
-- ---------------------------------------------------------------------------
--
-- * **No `epic_mirrors`.** Nothing has been pushed: the batch is `sized`, every draft is
--   `pending`, and a mirror is the record *of* a push (AL.3, #279). A seeded parent issue
--   would send the first real push looking for a container nobody created.
-- * **No Linear source.** The *Tracker Sync* card's third row is `not connected` with a
--   **connect ↗** CTA, and that row is rendered from the *absence* of a `linear` source.
-- * **Source sync stamps stay null.** R__dev_seed_sources.sql's rule: `ticket_sources.synced_at`
--   and `sync_cursor` are the sync loop's record of itself. Each ticket carries its own
--   `synced_at`, 40 seconds ago, which is what a freshness tag can honestly read.
-- * **No draft is superseded, edited or pushed**, and the batch has no author: `created_by` is
--   null for a seeded batch (V034). The mockup's page is the moment between sizing and push.
--
-- **Ids.** `5eed…`, as everywhere, one prefix per table and a suffix computed from a value
-- each row already names — `gen_random_uuid()` appears nowhere:
--
--   | Rows                        | Id prefix   | Suffix                                     |
--   |-----------------------------|-------------|--------------------------------------------|
--   | `tickets` (52)              | `5eed001d…` | issue number                               |
--   | `ticket_dependencies` (10)  | `5eed001e…` | blocker then blocked (numbers or ordinals) |
--   | `planning_epics` (5)        | `5eed001f…` | `sort_order`                               |
--   | `epic_tickets` (42)         | `5eed0020…` | the linked ticket's number                 |
--   | `draft_batches` (1)         | `5eed0021…` | 1                                          |
--   | `ticket_drafts` (6)         | `5eed0022…` | the draft's ordinal in the batch           |
--   | `issue_estimates` (6)       | `5eed0023…` | the draft's ordinal, then the version      |
--
-- The same three properties as every seed, each asserted by a test: every statement ends
-- `${ouro_dev_seed}` so it writes nothing outside a development database; every insert ends
-- `on conflict … do nothing`, with a `not exists` guard where a BEFORE trigger would raise
-- first; and every parent from another seed is found by natural key — the workspace by slug,
-- the source by kind and name — never by repeating its id.
--
-- Filed as issue #275 (AK.4). Needs #273 (AK.2), #274 (AK.3); coordinates with #103 (INTAKE-K.5)
-- and #68 (DASH-F.5). Blocks #276 (AK.5); feeds #281, #282, #283, #284, #285, #286 and #288.
-- Asserted in tests/seed.sql and tests/seed.test.sh.

-- ---------------------------------------------------------------------------
-- The canonical backlog — fifty-two tickets in the GitHub source.
--
-- `#540`–`#581` are the four scheduled lanes' work, in lane order (twelve, nine, fourteen,
-- seven); `#582`–`#591` are backlog no lane has claimed. Ten are `closed` — eight in OTA
-- hardening, two in BLE provisioning — so forty-two are open.
--
-- Shaped the way Q.3's GitHub mapping (#140) writes a row, so a real sync over the same issue
-- would upsert rather than duplicate: `external_id` is the number as text, `external_key` is
-- `#<number>`, `external_url` is the issue's github.com link composed from the source's own
-- `config.login` and the repository, and `meta` is `{"github": {"owner", "repo"}}`. Bodies are
-- null, which is GitHub's own answer for an issue opened with a title and nothing else.
--
-- Ages ascend with the number, as issue numbers do. `source_updated_at` is never before
-- `source_created_at` (`tickets_updated_after_created`), and on the four newest — the unsized
-- ones, opened this week — the two are equal. Every instant is relative to `now()`.
-- ---------------------------------------------------------------------------
insert into ouroboros.tickets
  (id, organization_id, source_id, external_id, external_key, external_url, title, body,
   state, labels, author, source_created_at, source_updated_at, synced_at, sizing_status,
   meta)
select ('5eed001d-0000-4000-8000-' || lpad(seed.number::text, 12, '0'))::uuid,
       org."id", src.id, seed.number::text, '#' || seed.number,
       'https://github.com/' || (src.config->>'login') || '/' || seed.repo || '/issues/'
         || seed.number,
       seed.title, null, seed.state, seed.labels::jsonb, seed.author,
       now() - make_interval(days => seed.opened_days_ago),
       now() - make_interval(days => seed.updated_days_ago),
       now() - interval '40 seconds',
       seed.sizing_status,
       jsonb_build_object('github', jsonb_build_object('owner', src.config->>'login',
                                                       'repo',  seed.repo))
  from (values
         (540, 'helios-firmware', 'closed', 'sized', 180, 150, 'maya-chen', '["ota", "bootloader"]',
          'Bootloader: reserve a second image slot in the flash layout'),
         (541, 'helios-firmware', 'closed', 'sized', 177, 147, 'kensuenobu', '["ota"]',
          'Image header: add version and slot-generation fields'),
         (542, 'helios-firmware', 'closed', 'sized', 174, 144, 'jorge-reyes', '["ota", "bootloader"]',
          'Size the MCUboot scratch partition for swap-with-scratch'),
         (543, 'helios-firmware', 'closed', 'sized', 171, 141, 'maya-chen', '["ota", "enhancement"]',
          'OTA transport: resume an interrupted download from the last chunk'),
         (544, 'helios-firmware', 'closed', 'sized', 168, 138, 'kensuenobu', '["ota", "security"]',
          'Verify the signed update manifest with ed25519'),
         (545, 'helios-firmware', 'closed', 'sized', 165, 135, 'jorge-reyes', '["ota", "bug"]',
          'Flash driver: erase-before-write guard on the slot boundary'),
         (546, 'helios-firmware', 'closed', 'sized', 162,  20, 'field-support', '["ota", "watchdog"]',
          'Watchdog: extend the timeout while an image is being copied'),
         (547, 'helios-firmware', 'closed', 'sized', 159,   9, 'maya-chen', '["ota", "telemetry"]',
          'Publish OTA progress events on the telemetry channel'),
         (548, 'helios-firmware', 'open', 'sized', 156,  10, 'jorge-reyes', '["ota", "power"]',
          'Tune the brown-out threshold for writes during flashing'),
         (549, 'helios-firmware', 'open', 'sized', 153,  11, 'kensuenobu', '["ota", "bootloader"]',
          'Persist swap state across a reset in the middle of an image copy'),
         (550, 'helios-firmware', 'open', 'sized', 150,   1, 'maya-chen', '["ota", "security"]',
          'Anti-rollback counter in OTP fuses'),
         (551, 'helios-firmware', 'open', 'sized', 147,   2, 'field-support', '["ota", "fleet"]',
          'Fleet canary: stage an update to 5% of units first'),
         (552, 'helios-firmware', 'closed', 'sized', 144,  60, 'jorge-reyes', '["ble", "deps"]',
          'BLE: move the stack to a release with LE Secure Connections'),
         (553, 'helios-firmware', 'closed', 'sized', 141,  35, 'maya-chen', '["ble"]',
          'Allocate UUIDs for the provisioning GATT service'),
         (554, 'helios-firmware', 'open', 'sized', 138,   5, 'maya-chen', '["ble", "enhancement"]',
          'Out-of-band pairing through the NFC tag on the enclosure'),
         (555, 'helios-firmware', 'open', 'sized', 135,   6, 'kensuenobu', '["ble", "security"]',
          'Hand Wi-Fi credentials over an encrypted characteristic'),
         (556, 'helios-firmware', 'open', 'sized', 132,   7, 'jorge-reyes', '["ble"]',
          'Provisioning state machine: retry and timeout paths'),
         (557, 'helios-firmware', 'open', 'sized', 129,   8, 'field-support', '["ble", "enhancement"]',
          'Factory-reset gesture clears every bonded device'),
         (558, 'helios-console', 'open', 'sized', 126,   9, 'maya-chen', '["ble", "console"]',
          'Field app: provisioning QR code format v2'),
         (559, 'helios-firmware', 'open', 'sized', 123,  10, 'kensuenobu', '["ble", "security"]',
          'Rate-limit pairing attempts'),
         (560, 'helios-firmware', 'open', 'sized', 120,  11, 'jorge-reyes', '["ble", "tests"]',
          'Provisioning conformance tests on the nRF52840 DK'),
         (561, 'helios-firmware', 'open', 'sized', 117,  45, 'jorge-reyes', '["motor-control", "tech-debt"]',
          'Split the motor driver into HAL and control layers'),
         (562, 'helios-firmware', 'open', 'sized', 114,   2, 'kensuenobu', '["motor-control", "tech-debt"]',
          'Replace the fixed-point PID with a configurable controller'),
         (563, 'helios-firmware', 'open', 'sized', 111,  38, 'jorge-reyes', '["motor-control", "tech-debt"]',
          'Encoder: move quadrature decoding out of the ISR'),
         (564, 'helios-firmware', 'open', 'sized', 108,   4, 'maya-chen', '["motor-control"]',
          'Current sensing: calibrate ADC offsets at boot'),
         (565, 'helios-firmware', 'open', 'sized', 105,   5, 'jorge-reyes', '["motor-control", "enhancement"]',
          'Field-oriented control for the BLDC wheel motors'),
         (566, 'helios-firmware', 'open', 'sized', 102,   6, 'kensuenobu', '["motor-control"]',
          'Motor parameter tables per hardware revision'),
         (567, 'helios-firmware', 'open', 'sized',  99,   7, 'field-support', '["motor-control"]',
          'Stall-detection threshold per load profile'),
         (568, 'helios-firmware', 'open', 'sized',  96,   8, 'maya-chen', '["motor-control", "tests"]',
          'Unit tests for the controller step response'),
         (569, 'helios-firmware', 'open', 'sized',  93,   9, 'jorge-reyes', '["motor-control", "enhancement"]',
          'Trapezoidal velocity profiles for docking'),
         (570, 'helios-firmware', 'open', 'sized',  90,  10, 'kensuenobu', '["motor-control", "tech-debt"]',
          'Remove the legacy PWM timer abstraction'),
         (571, 'helios-firmware', 'open', 'sized',  87,  11, 'field-support', '["motor-control"]',
          'Thermal derating curve for the motor drivers'),
         (572, 'helios-firmware', 'open', 'sized',  84,   1, 'jorge-reyes', '["motor-control", "can-bus"]',
          'Surface motor fault codes over CAN diagnostics'),
         (573, 'helios-firmware', 'open', 'sized',  81,   2, 'maya-chen', '["motor-control"]',
          'Hold the control loop to a deterministic 1 kHz'),
         (574, 'helios-firmware', 'open', 'sized',  78,   3, 'kensuenobu', '["motor-control", "docs"]',
          'Motor control architecture notes and diagrams'),
         (575, 'helios-console', 'open', 'sized',  75,  52, 'maya-chen', '["telemetry", "console"]',
          'Fleet map with each units last known position'),
         (576, 'helios-telemetry', 'open', 'sized',  72,   5, 'jorge-reyes', '["telemetry"]',
          'Batch telemetry uploads by unit and hour'),
         (577, 'helios-console', 'open', 'sized',  69,   6, 'field-support', '["telemetry", "console"]',
          'Battery health trend chart per unit'),
         (578, 'helios-telemetry', 'open', 'sized',  66,   7, 'field-support', '["telemetry", "watchdog"]',
          'Alert on repeated watchdog resets'),
         (579, 'helios-console', 'open', 'sized',  63,   8, 'kensuenobu', '["telemetry", "console"]',
          'Firmware version distribution panel'),
         (580, 'helios-console', 'open', 'sized',  60,   9, 'maya-chen', '["telemetry", "console"]',
          'Export fleet telemetry as CSV'),
         (581, 'helios-console', 'open', 'sized',  57,  10, 'kensuenobu', '["console", "security"]',
          'Dashboard access roles for field support'),
         (582, 'helios-firmware', 'open', 'sized',  54,  40, 'field-support', '["bug", "storage"]',
          'Log rotation corrupts the last record on power loss'),
         (583, 'helios-telemetry', 'open', 'sized',  51,  33, 'jorge-reyes', '["bug", "telemetry"]',
          'Clock drift between units exceeds 2 s per day'),
         (584, 'helios-console', 'open', 'sized',  48,  47, 'field-support', '["bug", "console"]',
          'Console: pagination breaks past 1,000 units'),
         (585, 'atlas-scheduler', 'open', 'sized',  45,  28, 'maya-chen', '["enhancement"]',
          'Honour per-site maintenance windows'),
         (586, 'helios-firmware', 'open', 'sized',  42,   4, 'jorge-reyes', '["power"]',
          'Reduce idle current draw in deep sleep'),
         (587, 'helios-firmware', 'open', 'sized',  39,   5, 'kensuenobu', '["enhancement", "good-first-issue"]',
          'Shell command to dump the partition table'),
         (588, 'helios-telemetry', 'open', 'unsized',   6,   6, 'maya-chen', '["telemetry", "enhancement"]',
          'Compress telemetry frames with heatshrink'),
         (589, 'helios-console', 'open', 'unsized',   5,   5, 'field-support', '["bug", "console"]',
          'Console: status pill contrast in dark mode'),
         (590, 'atlas-scheduler', 'open', 'unsized',   4,   4, 'jorge-reyes', '["enhancement"]',
          'Jitter the retry backoff for charging docks'),
         (591, 'helios-firmware', 'open', 'unsized',   3,   3, 'kensuenobu', '["docs"]',
          'Document GPIO assignments for rev D boards')
       ) as seed (number, repo, state, sizing_status, opened_days_ago, updated_days_ago,
                  author, labels, title)
  join ouroboros.organization   org on org."slug" = 'acme-robotics'
  join ouroboros.ticket_sources src on src.organization_id = org."id"
                                   and src.kind = 'github'
                                   and src.display_name = 'GitHub · acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The Blocked meter's edges — six between canonical tickets.
--
-- Four open tickets have an open blocker; one more has only a closed one; and two of the six
-- edges are `synced` — mirrored back from GitHub's own relations — because AL.5 counts both
-- origins. See *Each metric has a row built to tell…* in the header for what each edge is
-- there to catch. The graph is acyclic: `#548 → #549 → #551 ← #550 ← #545`, `#554 → #556`,
-- `#562 → #565`.
-- ---------------------------------------------------------------------------
insert into ouroboros.ticket_dependencies
  (id, organization_id, blocker_ticket_id, blocked_ticket_id, origin)
select ('5eed001e-0000-4000-8000-' || lpad(seed.blocker::text, 6, '0')
                                   || lpad(seed.blocked::text, 6, '0'))::uuid,
       org."id", blocker.id, blocked.id, seed.origin
  from (values
         (548, 549, 'planned'),
         (549, 551, 'planned'),
         (550, 551, 'planned'),
         (545, 550, 'planned'),
         (554, 556, 'synced'),
         (562, 565, 'synced')
       ) as seed (blocker, blocked, origin)
  join ouroboros.organization   org on org."slug" = 'acme-robotics'
  join ouroboros.ticket_sources src on src.organization_id = org."id"
                                   and src.kind = 'github'
                                   and src.display_name = 'GitHub · acme-robotics'
  join ouroboros.tickets blocker on blocker.source_id = src.id
                                and blocker.external_id = seed.blocker::text
  join ouroboros.tickets blocked on blocked.source_id = src.id
                                and blocked.external_id = seed.blocked::text
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The roadmap — five lanes of *Helios 2.1*.
--
-- The mockup's tints, order and statuses, with months as offsets from the current month (see
-- the header). `on conflict (id)` rather than a bare `on conflict`: the sort-order key is
-- deferrable, and PostgreSQL refuses a targetless `on conflict` on a table carrying one — the
-- same reason R__dev_seed_dashboard.sql names its arbiter for `queue_items`.
--
-- `roadmap_window` is the tag beside the card head: the quarter of the first lane's start and
-- of the last lane's end, with the year printed once when both fall in it.
-- ---------------------------------------------------------------------------
insert into ouroboros.planning_epics
  (id, organization_id, name, tint, start_month, end_month, status, sort_order,
   roadmap_name, roadmap_window)
select ('5eed001f-0000-4000-8000-' || lpad(seed.sort_order::text, 12, '0'))::uuid,
       org."id", seed.name, seed.tint,
       (date_trunc('month', now()) + make_interval(months => seed.start_offset))::date,
       (date_trunc('month', now()) + make_interval(months => seed.end_offset))::date,
       seed.status, seed.sort_order, 'Helios 2.1',
       'Q' || extract(quarter from span.first_month)
         || case when extract(year from span.first_month) = extract(year from span.last_month)
                 then ''
                 else ' ' || extract(year from span.first_month)
            end
         || '–Q' || extract(quarter from span.last_month)
         || ' ' || extract(year from span.last_month)
  from (values
         (1, 'OTA hardening',             'accent',  -1,    1,    'active'),
         (2, 'BLE provisioning v2',       'model',    0,    2,    'active'),
         (3, 'Motor control refactor',    'warn',     1,    3,    'active'),
         (4, 'Fleet telemetry dashboard', 'ok',       2,    4,    'active'),
         (5, 'Zephyr 4.2 migration',      'neutral', null, null, 'proposed')
       ) as seed (sort_order, name, tint, start_offset, end_offset, status)
  cross join (select (date_trunc('month', now()) - interval '1 month')::date  as first_month,
                     (date_trunc('month', now()) + interval '4 months')::date as last_month
             ) as span
  join ouroboros.organization org on org."slug" = 'acme-robotics'
 where ${ouro_dev_seed}
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The lanes' tickets — what `planning_epic_progress` computes each chip from.
--
-- Contiguous number ranges per lane, so the link table is four lines rather than forty-two:
-- OTA hardening `#540`–`#551` (twelve, eight closed), BLE provisioning `#552`–`#560` (nine, two
-- closed), Motor control `#561`–`#574` (fourteen, none closed), Fleet telemetry `#575`–`#581`
-- (seven, none closed). The Zephyr lane has no tickets, which the view's left joins render as
-- `0 · 0` and the card as `unscoped`.
-- ---------------------------------------------------------------------------
insert into ouroboros.epic_tickets (id, epic_id, ticket_id)
select ('5eed0020-0000-4000-8000-' || lpad(ticket.external_id, 12, '0'))::uuid,
       epic.id, ticket.id
  from (values
         (1, 540, 551),
         (2, 552, 560),
         (3, 561, 574),
         (4, 575, 581)
       ) as seed (sort_order, first_number, last_number)
  join ouroboros.organization   org  on org."slug" = 'acme-robotics'
  join ouroboros.planning_epics epic on epic.organization_id = org."id"
                                    and epic.roadmap_name = 'Helios 2.1'
                                    and epic.sort_order = seed.sort_order
  join ouroboros.ticket_sources src  on src.organization_id = org."id"
                                    and src.kind = 'github'
                                    and src.display_name = 'GitHub · acme-robotics'
  join ouroboros.tickets ticket on ticket.source_id = src.id
                               and ticket.external_id::integer
                                   between seed.first_number and seed.last_number
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The OTA batch — one press of *Generate Tickets*.
--
-- The mockup's prompt, verbatim, and an outline written in AL.1's (#277) `outline-v0` grammar
-- that parses into exactly the six drafts below: one bullet per draft, `blocks:` for each
-- dependency note, and a bracketed marker for each workflow tag. Targeted at the GitHub
-- source with milestone *Helios 2.1*, *Auto-size* on and *Queue XS/S* off, as the mockup's
-- toggles are; in the OTA hardening lane; and `sized`, because every draft is.
-- ---------------------------------------------------------------------------
insert into ouroboros.draft_batches
  (id, organization_id, source_prompt, outline, planner, target_source_id, target_milestone,
   auto_size, queue_small, status, epic_id, created_by, created_at)
select '5eed0021-0000-4000-8000-000000000001'::uuid, org."id",
       'We need OTA updates to survive power loss mid-flash: staged A/B partitions, checksum '
         || 'verification before swap, automatic rollback, and a recovery beacon over BLE if '
         || 'both slots are bad.',
       '- Partition table & bootloader slot flag for A/B scheme  blocks: OTA-3  [feature-loop]' || chr(10)
         || '- SHA-256 checksum verification before slot swap  blocks: OTA-3  [feature-loop]' || chr(10)
         || '- Rollback state machine on failed boot confirmation  blocks: OTA-5  [feature-loop]' || chr(10)
         || '- BLE recovery beacon when both slots fail checksum  blocks: OTA-5  [feature-loop]' || chr(10)
         || '- Power-loss integration tests on HIL rig (kill power mid-flash)  [hil-verify]' || chr(10)
         || '- Operator docs: recovery procedure & beacon pairing  [docs-loop]',
       'outline-v0', src.id, 'Helios 2.1', true, false, 'sized', epic.id, null,
       now() - interval '25 minutes'
  from ouroboros.organization org
  join ouroboros.ticket_sources src  on src.organization_id = org."id"
                                    and src.kind = 'github'
                                    and src.display_name = 'GitHub · acme-robotics'
  join ouroboros.planning_epics epic on epic.organization_id = org."id"
                                    and epic.roadmap_name = 'Helios 2.1'
                                    and epic.sort_order = 1
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The six drafts — the mockup's rows, all selected, all pending, all as the planner wrote them.
-- ---------------------------------------------------------------------------
insert into ouroboros.ticket_drafts
  (id, batch_id, local_key, title, body, selected, suggested_workflow, push_state,
   provenance, created_at)
select ('5eed0022-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       batch.id, 'OTA-' || seed.ordinal, seed.title, null, true, seed.suggested_workflow,
       'pending', 'planned', batch.created_at
  from (values
         (1, 'Partition table & bootloader slot flag for A/B scheme',          'feature-loop'),
         (2, 'SHA-256 checksum verification before slot swap',                 'feature-loop'),
         (3, 'Rollback state machine on failed boot confirmation',             'feature-loop'),
         (4, 'BLE recovery beacon when both slots fail checksum',              'feature-loop'),
         (5, 'Power-loss integration tests on HIL rig (kill power mid-flash)', 'hil-verify'),
         (6, 'Operator docs: recovery procedure & beacon pairing',             'docs-loop')
       ) as seed (ordinal, title, suggested_workflow)
  join ouroboros.draft_batches batch on batch.id = '5eed0021-0000-4000-8000-000000000001'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The drafts' dependency notes — `blocks OTA-3` twice, `blocks OTA-5` twice.
--
-- Draft-to-draft and `planned`, which is what AL.3's push rewrites to ticket references in
-- the transaction that creates the issues. Suffixed `9…` so a draft edge's id cannot collide
-- with a ticket edge's, whose suffixes begin with a zero.
-- ---------------------------------------------------------------------------
insert into ouroboros.ticket_dependencies
  (id, organization_id, blocker_draft_id, blocked_draft_id, origin)
select ('5eed001e-0000-4000-8000-9' || lpad(seed.blocker::text, 5, '0')
                                    || lpad(seed.blocked::text, 6, '0'))::uuid,
       batch.organization_id, blocker.id, blocked.id, 'planned'
  from (values
         (1, 3),
         (2, 3),
         (3, 5),
         (4, 5)
       ) as seed (blocker, blocked)
  join ouroboros.draft_batches batch on batch.id = '5eed0021-0000-4000-8000-000000000001'
  join ouroboros.ticket_drafts blocker on blocker.batch_id = batch.id
                                      and blocker.local_key = 'OTA-' || seed.blocker
  join ouroboros.ticket_drafts blocked on blocked.batch_id = batch.id
                                      and blocked.local_key = 'OTA-' || seed.blocked
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The drafts' estimates — why the pill says `✓ all sized`, and what the footer sums.
--
-- One version each, through `issue_estimates.draft_id` (decision N3: one sizer, one table),
-- and never through anything planning-specific. The efforts are the mockup's chips (L, M, L,
-- M, M, XS); the provenance is `heuristic-v0` with no tokens spent and no signals, decision
-- K10's honesty exactly as R__dev_seed_intake.sql applies it.
--
--   | Draft   | Effort | Routed model      | est_tokens | ¢ / 1M in | ¢      | est_minutes |
--   |---------|--------|-------------------|-----------:|----------:|-------:|------------:|
--   | `OTA-1` | L      | `claude-fable-5`  |    450 000 |      1000 |    450 |       1 080 |
--   | `OTA-2` | M      | `claude-sonnet-5` |    700 000 |       200 |    140 |         600 |
--   | `OTA-3` | L      | `claude-fable-5`  |    550 000 |      1000 |    550 |       1 140 |
--   | `OTA-4` | M      | `claude-sonnet-5` |    650 000 |       200 |    130 |         660 |
--   | `OTA-5` | M      | `claude-sonnet-5` |    650 000 |       200 |    130 |         720 |
--   | `OTA-6` | XS     | `qwen3-coder:32b` |     40 000 |  free (0) |      0 |         120 |
--
-- The minutes are loop wall-clock across build, HIL and review rather than model time, which
-- is why an L runs most of a day; V026's header draws the same line between `est_minutes` and
-- the cycle range.
--
-- **The `not exists` is the guard, as in R__dev_seed_intake.sql.** V034's
-- `issue_estimates_draft_version_monotonic` is a BEFORE INSERT trigger, so a second application
-- would reach it with a version the draft already has and raise before `on conflict` could
-- skip the row. The predicate is that trigger's rule evaluated a step earlier.
-- ---------------------------------------------------------------------------
insert into ouroboros.issue_estimates
  (id, draft_id, version, effort, confidence, suggested_workflow, routed_model, breakdown,
   risk, risk_note, trace, created_at)
select ('5eed0023-0000-4000-8000-' || lpad(seed.ordinal::text, 10, '0')
                                   || lpad(seed.version::text, 2, '0'))::uuid,
       draft.id, seed.version, seed.effort, seed.confidence, draft.suggested_workflow,
       seed.routed_model,
       jsonb_build_object('files',       seed.files::jsonb,
                          'est_tokens',  seed.est_tokens,
                          'cycle_min',   seed.cycle_min,
                          'cycle_max',   seed.cycle_max,
                          'est_minutes', seed.est_minutes),
       seed.risk, seed.risk_note,
       jsonb_build_object('estimator',   'heuristic-v0',
                          'sized_at',    to_char((batch.created_at + make_interval(secs => seed.ordinal * 20))
                                                   at time zone 'UTC',
                                                 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'tokens_used', 0,
                          'signals',     '[]'::jsonb),
       batch.created_at + make_interval(secs => seed.ordinal * 20)
  from (values
         (1, 1, 'l',  81, 'claude-fable-5',
          '["partitions/helios_rev_d.yml", "src/boot/slot_flag.c", "tests/unit/test_slot_flag.c"]',
          450000, 45, 75, 1080,
          'high', 'Changes the flash layout every installed unit boots from; a mistake here is a brick, not a bug.'),
         (2, 1, 'm',  88, 'claude-sonnet-5',
          '["src/ota/verify_sha256.c", "src/ota/swap.c", "tests/unit/test_verify_sha256.c"]',
          700000, 25, 45, 600,
          'medium', 'Sits on the swap path, but the hash primitive already ships in the bootloader.'),
         (3, 1, 'l',  74, 'claude-fable-5',
          '["src/boot/rollback.c", "src/boot/confirm.c", "tests/unit/test_rollback.c", "tests/hil/test_boot_confirm.c"]',
          550000, 50, 90, 1140,
          'high', 'A state machine that decides which image boots; every transition needs a power-cut test.'),
         (4, 1, 'm',  83, 'claude-sonnet-5',
          '["src/ble/recovery_beacon.c", "src/boot/recovery_mode.c", "tests/unit/test_recovery_beacon.c"]',
          650000, 30, 50, 660,
          'medium', 'Runs only when both slots are bad, which is the path least exercised in the field.'),
         (5, 1, 'm',  79, 'claude-sonnet-5',
          '["tests/hil/test_power_loss_flash.py", "tests/hil/rig/relay_cut.py"]',
          650000, 35, 60, 720,
          'medium', 'Needs the HIL rig''s relay board; flaky timing turns a real failure into a retry.'),
         (6, 1, 'xs', 97, 'qwen3-coder:32b',
          '["docs/operator/recovery.md", "docs/operator/beacon-pairing.md"]',
          40000, 3, 6, 120,
          'low', 'Documentation only; no code path changes.')
       ) as seed (ordinal, version, effort, confidence, routed_model, files, est_tokens,
                  cycle_min, cycle_max, est_minutes, risk, risk_note)
  join ouroboros.draft_batches batch on batch.id = '5eed0021-0000-4000-8000-000000000001'
  join ouroboros.ticket_drafts draft on draft.batch_id = batch.id
                                    and draft.local_key = 'OTA-' || seed.ordinal
 where not exists (select 1
                     from ouroboros.issue_estimates prior
                    where prior.draft_id = draft.id
                      and prior.version >= seed.version)
   and ${ouro_dev_seed}
on conflict do nothing;
