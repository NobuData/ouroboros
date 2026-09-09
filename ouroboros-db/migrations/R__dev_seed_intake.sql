-- R__dev_seed_intake.sql — mockup 03's backlog, as rows, in a development database and
-- nowhere else.
--
-- R__dev_seed.sql (#23) puts the *workspaces* in a development database and
-- R__dev_seed_dashboard.sql (#68) puts *what the loop has done* in it. This file puts the
-- **backlog Ouroboros has an opinion about** in it: the nine issues
-- [`docs/mockups/03-issues.html`](../../docs/mockups/03-issues.html) renders under
-- `BACKLOG · AS OUROBOROS SEES IT`, and the estimates behind their *Effort*, *Suggested
-- workflow* and *Routed model* columns — across `V014`'s `github_issues` and `V026`'s
-- `issue_estimates`, neither of which had a row in a development database before now.
--
-- All of it belongs to one repository, `acme-robotics / helios-firmware`, because that is
-- the repository the mockup's breadcrumb names and the one every screen drawn around this
-- backlog is scoped to. **The personal workspace gets nothing**, which is not an omission:
-- `kensuenobu` has two enabled repositories and no mirrored issue in either, and that is
-- the empty-state fixture N.6 (#120) renders against. An empty state with no data behind
-- it is a screenshot; this is the absence itself, in the same database as the presence.
--
-- The honesty rule the dashboard roadmap set in DASH-F.5 applies here unchanged:
-- **seeded parity for design review, truthful states everywhere else.** Every figure the
-- page head prints is an aggregate over these rows rather than a number stored beside
-- them, which is why the count below is 9 and not the mockup's 42 — see the next section.
--
-- Three properties make it safe to apply to a development database on every `up`, and
-- each of them is asserted by a test:
--
-- 1. **It cannot run in production.** Every statement carries `${ouro_dev_seed}`, which is
--    `false` in flyway.toml — the configuration `scripts/migrate`, CI and every hand-run
--    migration read — and `true` only in flyway.seed.toml, which only the development
--    compose stack loads by itself. With it false every statement below is
--    `insert … select … where false`: the migration applies, and applies as a no-op.
--
-- 2. **It is idempotent.** Every id is computed from a literal prefix and the row's own
--    issue number, so a second application computes the same ids, and every statement ends
--    `on conflict do nothing`, so it writes none of them. The estimates carry a second
--    guard as well, and it is not belt-and-braces: see *The guard is the `not exists`* at
--    the superseded-estimate statement, where the reason is a BEFORE trigger that fires
--    before any conflict can be detected.
--
-- 3. **It never fails on a database somebody has edited.** Parents are found by natural
--    key — the organization by slug, the repository by name, an issue by its number in
--    that repository — never by naming an id a second time, so a developer who deleted the
--    demo workspace gets a seed that quietly re-creates what it can.
--
-- **Ids.** `5eed…`, as everywhere: an id beginning `5eed` came from a seed. Two prefixes,
-- one per table, so a mirrored issue and an estimate of it are told apart on sight in a
-- log or a URL — and both are computed rather than written out, from values the file
-- already names:
--
--   | Rows                  | Id prefix   | Suffix                          |
--   |-----------------------|-------------|---------------------------------|
--   | `github_issues` (9)   | `5eed0018…` | issue number                    |
--   | `issue_estimates` (9) | `5eed0019…` | issue number, then the version  |
--
-- Nine estimates for eight issues: `#487` carries two, and the reason is in *One issue is
-- estimated twice* below. `gen_random_uuid()` appears nowhere, and tests/seed.test.sh
-- asserts it.
--
-- ---------------------------------------------------------------------------
-- **What the seed does not copy from the mockup, and why.**
-- ---------------------------------------------------------------------------
--
-- Four things on that page are design copy rather than data, and writing them into rows
-- would make the product remember a number it is supposed to compute — or claim a
-- provenance nothing produced. Each is called out here rather than left for whoever
-- eventually diffs the screen against the fixture and assumes the fixture is wrong.
--
-- * **The page head's *"42 open issues. 38 already sized."*** These nine rows compute to
--   **"9 open issues. 7 already sized."** — seven `sized`, one `estimating` (`#483`) and
--   one `needs_human` (`#490`), all nine `open`. That is the acceptance criterion, and it
--   is the seed's own truth: M.1 (#110) counts them, so a fixture of nine cannot honestly
--   render 42. Padding the mirror with thirty-three issues nothing draws would buy the
--   mockup's arithmetic at the price of a backlog no screen shows and no test can name.
--
-- * **The estimation trace's *"sized by claude-sonnet-5 · 2m ago · 41k tokens"*.**
--   Decision **K10** is that an estimate says what produced it, and what produced these is
--   `heuristic-v0` — a rule engine that called no model. So `trace.estimator` is
--   `heuristic-v0` on every row here and `trace.tokens_used` is `0`, which is the honest
--   answer for sizing that cost no tokens rather than a missing value (`V026` makes the
--   key non-nullable for exactly that reason). The *2m ago* is real: it is `#485`'s
--   `sized_at`, relative to `now()` like every other instant in this file.
--
-- * **The trace's *"signals: 3 similar closed issues · driver map · HIL test index"*.**
--   `trace.signals` is `[]` on every row, and this is the sharpest edge of K10. A signal
--   is a claim about *what the answer was retrieved from* — and there is no knowledge
--   layer yet to have retrieved anything. Seeding those three lines would be the exact lie
--   K10 forbids: a screen showing a provenance no component produced, which would then
--   pass its parity test on the day the retrieval behind it was still unwritten. They are
--   reserved for **O.4**'s seeds, which will have something to point at.
--
-- * **The `“…”` around the `#485` body excerpt.** The quotation marks are the panel's
--   presentation of a quotation — `.panel-body-excerpt` is a left-ruled italic blockquote
--   — not characters GitHub holds. `body` is a copy of what GitHub has (decision **K3**),
--   so the marks live in N.5's renderer and the text between them is what is stored.
--
-- ---------------------------------------------------------------------------
-- **The queue rows are DASH-F.5's, and this file writes none of them.**
-- ---------------------------------------------------------------------------
--
-- The mockup's *Status* column has four pills, and one of them — `queued` — is not a
-- `sizing_status`. `V014`'s vocabulary is decision K4's four: `unsized`, `estimating`,
-- `sized`, `needs_human`. *Queued* is a **presentation state**: M.3 (#112) creates
-- `queue_items` and an issue with one renders as queued. So an intake seed does not write
-- it — it writes `sized`, and the queue row is what turns it into a pill.
--
-- Those queue rows already exist. R__dev_seed_dashboard.sql (#68) seeds twelve, of which
-- six are in `helios-firmware`: `#485`, `#486`, `#488`, `#490`, `#491` and `#494`. The
-- ticket's rule is that they are **cross-referenced, not duplicated**, and the reason is
-- arithmetic rather than tidiness: *Queued issues* renders `12` over `est. 9h 40m`, both
-- of which are aggregates over exactly those twelve, so a thirteenth written from here
-- would break mockup 02 to decorate mockup 03. Three facts fall out of that, and all three
-- are easier to read here than to rediscover:
--
--   * **The seeded backlog presents more rows as queued than the mockup draws.** Mockup 03
--     shows `#486`, `#488` and `#489` queued; the rows that exist also queue `#485`,
--     `#490` and `#491`. The two mockups simply disagree — mockup 02's *Up next in queue*
--     card draws `#485` at position 1 while mockup 03's table calls the same issue
--     `sized` — and a seed cannot make both true of one database. It follows the rows that
--     exist, and this note is what M.1 (#110) and N.2 (#118) should read before assuming
--     their query is wrong.
--
--   * **`#494` is queued and is not mirrored here.** The nine are `#483`–`#491`; the queue
--     item for `#494` names an issue this mirror has not got. That is legitimate rather
--     than dangling — `queue_items` (V009) carries its own `issue_title` and holds no
--     foreign key to `github_issues`, precisely so the queue survives an issue leaving the
--     mirror — and it is a real case for M.3 and the dashboard card to be honest about.
--
--   * **`#487` and `#489` are queued in *other* repositories.** The dashboard seed's
--     `#487` is *Rate-limit telemetry uploads on cellular* in `helios-telemetry` and its
--     `#489` is *Console: surface OTA rollback history* in `helios-console`, both with
--     titles that have nothing to do with the ones below. Nothing is wrong: an issue
--     number is unique within a repository and meaningless outside it (`V014`'s
--     `github_issues_repo_number_key`), so every repository has its own `#489`. A read
--     that joins the queue to this mirror on `issue_number` alone and not on the
--     repository will produce nonsense, and this is the fixture that shows it.
--
-- ---------------------------------------------------------------------------
-- **The mockup's row order is not one of M.1's sorts, and the seed does not pretend.**
-- ---------------------------------------------------------------------------
--
-- M.1 (#110) documents `sort=effort` as *"chip order with unsized last"*. The mockup's
-- table runs M, M, S, L, M, L, XS, unsized, XL, which is not that ordering, nor
-- confidence, nor number, nor updated — it is a hand-laid page. What the seed can
-- guarantee, and does, is that **the sort is total**: no two issues share an
-- `(effort, confidence)` pair, so `effort` ascending with `confidence` descending puts
-- these rows in exactly one order — `#488` XS, `#491` S, `#485`/`#484`/`#489` M,
-- `#486`/`#487` L, `#490` XL, `#483` last — with no tie for a tie-break to decide
-- differently on two machines. A fixture whose order depends on the planner is a fixture
-- that makes a parity test flake.
--
-- ---------------------------------------------------------------------------
-- **One issue is estimated twice, and one estimate names no files.**
-- ---------------------------------------------------------------------------
--
-- `#487` carries **two versions**: a superseded `s` / 55% / `standard-fix` /
-- `ollama/qwen3-coder`, and the mockup's `l` / 71% / `feature-loop` / `claude-fable-5` in
-- force over it. Every visible field differs between them, deliberately. Decision **K4**
-- is that re-estimation is a new row and the highest version wins, and every reader of
-- this table implements that join — M.1's lateral, M.2's panel, N.5's card. Against a
-- fixture where every issue has exactly one estimate, a latest-wins join, a `min(version)`
-- join and a join that takes an arbitrary row are **indistinguishable**: all three pass.
-- One issue with two versions is the smallest fixture that can tell them apart, and the
-- version in force is still the mockup's, so nothing the page renders moves.
--
-- `#488`'s breakdown carries **`files: []`**, and that is a real answer rather than a gap.
-- `V026` makes the empty list valid on purpose — an estimator that cannot say which paths
-- a change touches says so — and the panel renders that absence instead of guessing. A
-- fixture in which every estimate happened to name files would leave that path unexercised
-- by the one dataset every screen is built against, which is the argument DASH-F.5 made
-- for its one unestimated queue item. A typo sweep across a manual is the honest case of
-- it. The other eight name paths, `#485`'s being the mockup's three.
--
-- ---------------------------------------------------------------------------
-- **What is not written, and is somebody else's to write.**
-- ---------------------------------------------------------------------------
--
-- `github_repos.issues_synced_at` and `issues_sync_cursor` (`V014`, decision **K2**) stay
-- null. They are the *sync's* record of itself — the freshness tag's source and the `since`
-- watermark the next poll sends to GitHub — and K.4's service (#102) is what stamps them.
-- A seed that stamped a cursor would hand the first real poll of a demo repository a
-- watermark no poll produced, and the poll would then skip everything behind it; a seed
-- that stamped only the timestamp would render *"synced 40s ago"* about a poll that never
-- ran. What the seed can honestly say is per-row and it says it: `github_issues.synced_at`
-- is `now() - 40 seconds` on all nine, so `max(synced_at)` over the repository's mirror is
-- the mockup's tag, computed from rows rather than remembered. M.1's `meta.syncedAt` can
-- read either, and this is the note that says which one has a value today.
--
-- `#483` gets **no estimate row at all**, which is what `estimating` means: the answer has
-- not been produced yet. The mockup's row shows `standard-fix` and `claude-sonnet-5` in
-- its workflow and model cells beside a `sizing…` effort, and those two cells are not
-- storable — `issue_estimates` has no partial row, because `effort` and `confidence` are
-- `not null` and an estimate is one answer rather than four fields that arrive separately.
-- So the seed leaves them empty and N.2 renders a mid-flight row from what exists.
--
-- ---------------------------------------------------------------------------
-- **The authors, since the mockup names one.**
-- ---------------------------------------------------------------------------
--
-- The panel's meta line is `#485 · opened 2d ago by field-support`, and that is the only
-- attribution the mockup gives. The other eight need one, so they get the demo cast:
-- `field-support` opens what the field reports, and `kensuenobu`, `maya-chen` and
-- `jorge-reyes` are the GitHub logins of the three people R__dev_seed.sql already seeds
-- into this workspace — a backlog whose authors are strangers to the member list would be
-- a fixture that could not test a *filed by* filter or an avatar.
--
-- The ninth is **`renovate[bot]`**, and it is the one author chosen for coverage rather
-- than for plausibility alone. `V028` (#102) widened this column precisely because a
-- GitHub App's login carries a literal `[bot]` suffix and the original rule refused it —
-- silently dropping every issue a bot files. A fixture of nine human logins would leave
-- the rule that was just fixed unexercised by the data every UI test reads, so the one
-- issue a dependency bot would plausibly open — the Zephyr 4.2 migration — is opened by
-- one.
--
-- Filed as issue #103 (K.5). Needs #99 (K.1), #100 (K.2); coordinates with #68
-- (DASH-F.5). Blocks #104 (K.6); feeds #110, #111, #114, #117, #119 and the #121 e2e leg.

-- ---------------------------------------------------------------------------
-- The nine issues.
--
-- Mockup 03's table, row for row — `#483` through `#491`, all `open`, all in
-- `acme-robotics / helios-firmware`. What each column is a copy of is decision **K3**:
-- `number`, `title`, `body`, `state`, `labels`, `author_login` and the three `gh_` values
-- are GitHub's, and `sizing_status` is the one column this product owns.
--
-- **`labels` is the detail panel's set, not the table cell's.** The mockup draws three
-- tags under `#485` in the table (`bug`, `i2c`, `watchdog`) and four in the panel
-- (`priority-high` as well). One issue has one label set, so the seed stores the panel's,
-- which is the acceptance criterion that says *field for field*; the table cell rendering
-- three of four is N.2's business and not a second row.
--
-- **The ages ascend with the issue number**, because a GitHub issue number is a counter:
-- `#483` is the oldest and `#491` the newest, `#485` is *opened 2d ago* as the panel says,
-- and the six issues above it therefore all fall inside those two days. `gh_updated_at` is
-- never before `gh_created_at` (`github_issues_updated_after_created`), and on `#488` the
-- two are equal — an issue nobody has touched since opening it, which is the boundary that
-- constraint permits and a fixture should contain.
--
-- **`gh_url` is composed from the joined rows rather than written out.** `V014` stores the
-- URL rather than deriving it because GitHub Enterprise Server serves the same issue from
-- another host — but a *seed* has no API response to copy one from, so it builds github.com's
-- shape from the org and repository it already joined to. Written out as a literal it would
-- be the one place in this file that names the demo repository twice, and a rename in
-- R__dev_seed.sql would leave nine links pointing at a repository that no longer exists.
--
-- **`#488` has no body.** `V014` makes the column nullable because GitHub's is: an issue
-- opened with a title and no description comes back with a null body, and the panel
-- renders that rather than an empty blockquote. Every other row carries the text an
-- estimator reads whole — `#485`'s being the mockup's, without the quotation marks the
-- panel adds.
--
-- Every instant is relative to `now()`, which is what keeps *opened 2d ago* true however
-- long after this file was written the stack is brought up. A literal date would be right
-- on the day it was typed and wrong on every day after it.
-- ---------------------------------------------------------------------------
insert into ouroboros.github_issues
  (id, organization_id, github_repo_id, number, title, body, state, labels,
   author_login, gh_created_at, gh_updated_at, gh_url, synced_at, sizing_status)
select ('5eed0018-0000-4000-8000-' || lpad(seed.number::text, 12, '0'))::uuid,
       org."id", repo.id, seed.number, seed.title, seed.body, 'open', seed.labels::jsonb,
       seed.author_login,
       now() - make_interval(hours => seed.opened_hours_ago),
       now() - make_interval(hours => seed.updated_hours_ago),
       'https://github.com/' || gh.login || '/' || repo.name || '/issues/' || seed.number,
       now() - interval '40 seconds',
       seed.sizing_status
  from (values
         (483, 'Telemetry frame drops when BLE and CAN both saturated',
          '["bug", "telemetry"]', 'jorge-reyes', 120, 1, 'estimating',
          'Under a full telemetry load the BLE notify queue and the CAN receive path contend for the same DMA channel, and frames are dropped without any counter moving. Reproduced on bench unit 12 with both radios at full duty.'),
         (484, 'Motor PID integral windup on wheel stall',
          '["bug", "motor-control"]', 'field-support', 72, 26, 'sized',
          'When a wheel stalls against an obstacle the PID integral term keeps accumulating, so the motor slams to full torque the moment the obstruction clears. Needs clamping and an anti-windup reset driven by the stall detector.'),
         (485, 'Watchdog reset on I²C bus lockup',
          '["bug", "i2c", "watchdog", "priority-high"]', 'field-support', 48, 3, 'sized',
          'Unit 07 in the Fremont pilot rebooted 14 times overnight. Logs show the IMU holding SDA low after a burst read; the bus never recovers and the hardware watchdog fires ~2 s later. We need a bus-recovery sequence (9 clock pulses + re-init) before the watchdog trips.'),
         (486, 'Expose battery health over BLE GATT service',
          '["enhancement", "ble"]', 'maya-chen', 44, 20, 'sized',
          'The pack reports state of health over the internal bus but nothing publishes it. Add a GATT characteristic alongside the existing battery level so the field app can read cycle count and health without a service cable.'),
         (487, 'Delta OTA updates for images larger than 1 MB',
          '["enhancement", "ota"]', 'maya-chen', 36, 12, 'sized',
          'Full-image OTA over cellular costs more than the update is worth once the firmware passes 1 MB. Ship a binary diff against the installed version, and fall back to a full image when the delta is larger than the target.'),
         (488, 'Typo sweep in operator manual + pairing guide',
          '["docs", "good-first-issue"]', 'kensuenobu', 30, 30, 'sized',
          null),
         (489, 'CAN arbitration-lost storm under full telemetry load',
          '["bug", "can-bus"]', 'jorge-reyes', 22, 4, 'sized',
          'With telemetry at full rate the CAN controller loses arbitration repeatedly, and the retry path starves the motor-control frames until the bus stops meeting its deadline. Reproduced across the Fremont pilot fleet with every sensor enabled.'),
         (490, 'Migrate build system to Zephyr RTOS 4.2',
          '["tech-debt", "zephyr"]', 'renovate[bot]', 14, 2, 'needs_human',
          'Zephyr 3.7 leaves support this year, and 4.2 moves the device-tree bindings and the west manifest. This touches every board file and the CI images at once, so it wants a human to sequence it rather than a single loop.'),
         (491, 'Add CRC32 to config persistence layer',
          '["bug", "tech-debt"]', 'kensuenobu', 6, 5, 'sized',
          'A partial write to the config partition currently reads back as a valid record. Add a CRC32 over each record and fall back to the factory defaults when it does not match.')
       ) as seed (number, title, labels, author_login,
                  opened_hours_ago, updated_hours_ago, sizing_status, body)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The superseded estimate — `#487` version 1, which no screen renders.
--
-- **Its own statement, and the order is the point.** `issue_estimates_version_monotonic`
-- (`V026`) refuses a version that is not above every version the issue already has, so
-- version 1 has to be inserted while version 1 is the highest there is. Folded into the
-- statement below it would depend on the order PostgreSQL evaluates a `values` list and on
-- whether a BEFORE trigger can see a row the same command inserted — two things nothing
-- promises, and a fixture that is correct by accident is a fixture that breaks on an
-- upgrade. Two statements, superseded first, makes the rule the file's rather than the
-- planner's.
--
-- Every visible field differs from the version that replaces it — a smaller effort, a
-- lower confidence, another workflow, another model, one file instead of five, `low` risk
-- instead of `high` — so a reader that returns this row instead of the next one is wrong
-- in a way a parity test can see rather than in a way it has to be told about.
--
-- **The guard is the `not exists`, and it is not decoration.** `on conflict do nothing`
-- resolves a duplicate *after* the row has been built, and a BEFORE INSERT trigger runs
-- before that — so a second application of this file would reach the monotonicity trigger
-- with a version the issue already has and **raise**, not skip. The predicate is the
-- trigger's own rule, evaluated a step earlier: if this issue already carries an estimate
-- at this version or above, there is nothing here to write. That also makes the seed
-- converge on a database somebody has estimated by hand — it declines rather than fails —
-- which is property 3, and which `on conflict do nothing` alone could not have given it.
-- ---------------------------------------------------------------------------
insert into ouroboros.issue_estimates
  (id, github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
   breakdown, risk, risk_note, trace, created_at)
select ('5eed0019-0000-4000-8000-' || lpad(seed.number::text, 10, '0')
                                   || lpad(seed.version::text, 2, '0'))::uuid,
       issue.id, seed.version, seed.effort, seed.confidence,
       seed.suggested_workflow, seed.routed_model,
       jsonb_build_object('files',       seed.files::jsonb,
                          'est_tokens',  seed.est_tokens,
                          'cycle_min',   seed.cycle_min,
                          'cycle_max',   seed.cycle_max,
                          'est_minutes', seed.est_minutes),
       seed.risk, seed.risk_note,
       jsonb_build_object('estimator',   'heuristic-v0',
                          'sized_at',    to_char((now() - make_interval(mins => seed.sized_mins_ago))
                                                   at time zone 'UTC',
                                                 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'tokens_used', 0,
                          'signals',     '[]'::jsonb),
       now() - make_interval(mins => seed.sized_mins_ago)
  from (values
         (487, 1, 's', 55, 'standard-fix', 'ollama/qwen3-coder',
          '["src/ota/transport.c"]', 60000, 6, 10, 20,
          'low', 'One transport-layer flag with a documented fallback to the full image.', 2100)
       ) as seed (number, version, effort, confidence, suggested_workflow, routed_model,
                  files, est_tokens, cycle_min, cycle_max, est_minutes,
                  risk, risk_note, sized_mins_ago)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
  join ouroboros.github_issues issue
    on issue.github_repo_id = repo.id and issue.number = seed.number
 where not exists (select 1
                     from ouroboros.issue_estimates prior
                    where prior.github_issue_id = issue.id
                      and prior.version >= seed.version)
   and ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The estimates in force — eight of them, one per issue the mockup sizes.
--
-- The *Effort* chip and its confidence, the *Suggested workflow* tag and the *Routed
-- model* pill, straight off the mockup's table; `#485`'s breakdown is the *AI Work
-- Breakdown* panel field for field — three files, `~180k` tokens, a `12–18 min` cycle,
-- `low` risk and the sentence under the meter.
--
--   | Issue  | Effort | Conf | Workflow      | Model               | Status        |
--   |--------|--------|-----:|---------------|---------------------|---------------|
--   | `#484` | M      |  88% | standard-fix  | cursor/composer-2   | sized         |
--   | `#485` | M      |  92% | standard-fix  | claude-fable-5      | sized         |
--   | `#486` | L      |  84% | feature-loop  | claude-sonnet-5     | sized, queued |
--   | `#487` | L      |  71% | feature-loop  | claude-fable-5      | sized         |
--   | `#488` | XS     |  98% | docs-loop     | ollama/qwen3-coder  | sized, queued |
--   | `#489` | M      |  78% | standard-fix  | claude-sonnet-5     | sized         |
--   | `#490` | XL     |  61% | deps-refresh  | claude-fable-5      | needs human   |
--   | `#491` | S      |  95% | standard-fix  | copilot/gpt-5-codex | sized         |
--
-- All five efforts and all three risk levels appear, which is what makes the CHECKs on
-- both columns something the fixture exercises rather than something only
-- `tests/constraints.sql` has ever seen.
--
-- **`est_minutes` is not a function of the effort chip**, and where a queue row exists it
-- is *that* row's number: `#485` 45, `#486` 90, `#488` 15, `#490` 180 and `#491` 30 are
-- what DASH-F.5 already queued, because M.3 (#112) copies `est_minutes` out of the
-- breakdown when it queues an issue and the two would otherwise disagree about the same
-- work. The four issues with no queue row are free, and they are deliberately not derived
-- from the chip either — `V009`'s argument, restated: the chip is a size and the estimate
-- is minutes, and deriving one from the other would make the dashboard's `est. 9h 40m` a
-- restatement of the chips rather than a second fact.
--
-- **`cycle_min`/`cycle_max` do not contain `est_minutes`, and are not meant to.** `#485`
-- is a `12–18 min` cycle beside 45 estimated minutes, which is the shape `V026`'s header
-- calls out: the wall clock of a job includes what happens either side of the model's part
-- of it. `est_tokens` is what the *work* will cost and has nothing to do with
-- `trace.tokens_used`, which is what *sizing* cost and is `0` here.
--
-- The `not exists` guard is the one the statement above explains, and it carries the same
-- weight here: without it the second application of this file raises inside
-- `issue_estimates_version_monotonic` instead of writing nothing.
-- ---------------------------------------------------------------------------
insert into ouroboros.issue_estimates
  (id, github_issue_id, version, effort, confidence, suggested_workflow, routed_model,
   breakdown, risk, risk_note, trace, created_at)
select ('5eed0019-0000-4000-8000-' || lpad(seed.number::text, 10, '0')
                                   || lpad(seed.version::text, 2, '0'))::uuid,
       issue.id, seed.version, seed.effort, seed.confidence,
       seed.suggested_workflow, seed.routed_model,
       jsonb_build_object('files',       seed.files::jsonb,
                          'est_tokens',  seed.est_tokens,
                          'cycle_min',   seed.cycle_min,
                          'cycle_max',   seed.cycle_max,
                          'est_minutes', seed.est_minutes),
       seed.risk, seed.risk_note,
       jsonb_build_object('estimator',   'heuristic-v0',
                          'sized_at',    to_char((now() - make_interval(mins => seed.sized_mins_ago))
                                                   at time zone 'UTC',
                                                 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                          'tokens_used', 0,
                          'signals',     '[]'::jsonb),
       now() - make_interval(mins => seed.sized_mins_ago)
  from (values
         (484, 1, 'm',  88, 'standard-fix', 'cursor/composer-2',
          '["drivers/motor_pid.c", "tests/unit/test_motor_pid.c"]',
          150000, 10, 16, 50,
          'medium', 'Touches the shared PID loop every drive mode runs through; the bench regression suite covers the stall case.', 1500),
         (485, 1, 'm',  92, 'standard-fix', 'claude-fable-5',
          '["drivers/i2c_recovery.c", "drivers/imu_bmi270.c", "tests/unit/test_i2c_lockup.c"]',
          180000, 12, 18, 45,
          'low', 'Isolated to the I²C driver path; full HIL coverage exists for bus recovery.', 2),
         (486, 1, 'l',  84, 'feature-loop', 'claude-sonnet-5',
          '["src/ble/gatt_battery.c", "src/ble/gatt_table.c", "include/battery_health.h", "tests/unit/test_gatt_battery.c"]',
          320000, 25, 40, 90,
          'medium', 'Adds a characteristic to a live GATT table; every existing pairing has to keep working across the change.', 1140),
         (487, 2, 'l',  71, 'feature-loop', 'claude-fable-5',
          '["src/ota/delta.c", "src/ota/transport.c", "src/ota/manifest.c", "tests/unit/test_ota_delta.c", "tests/hil/test_ota_cellular.c"]',
          410000, 30, 50, 110,
          'high', 'Rewrites the update path the field app and the factory line both depend on, and a half-applied delta has no rollback.', 660),
         (488, 1, 'xs', 98, 'docs-loop', 'ollama/qwen3-coder',
          '[]',
          25000, 3, 6, 15,
          'low', 'Documentation only; no code path changes and nothing to regress.', 1740),
         (489, 1, 'm',  78, 'standard-fix', 'claude-sonnet-5',
          '["drivers/can_arbitration.c", "src/telemetry/scheduler.c", "tests/hil/test_can_load.c"]',
          210000, 15, 25, 60,
          'medium', 'Arbitration handling sits under both the telemetry and the motor-control paths, and the failure only appears under load.', 180),
         (490, 1, 'xl', 61, 'deps-refresh', 'claude-fable-5',
          '["west.yml", "boards/helios_rev_c.dts", "boards/helios_rev_d.dts", "CMakeLists.txt", "ci/build-matrix.yml", "docs/porting-4.2.md"]',
          900000, 90, 150, 180,
          'high', 'Moves every board file and the CI images at once; a partial migration leaves nothing that builds.', 90),
         (491, 1, 's',  95, 'standard-fix', 'copilot/gpt-5-codex',
          '["src/config/persist.c", "tests/unit/test_config_crc.c"]',
          90000, 8, 14, 30,
          'low', 'Confined to the config record reader and writer, and the factory-default fallback it leans on is already exercised in HIL.', 240)
       ) as seed (number, version, effort, confidence, suggested_workflow, routed_model,
                  files, est_tokens, cycle_min, cycle_max, est_minutes,
                  risk, risk_note, sized_mins_ago)
  join ouroboros.organization org  on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh   on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo on repo.org_id = gh.id and repo.name = 'helios-firmware'
  join ouroboros.github_issues issue
    on issue.github_repo_id = repo.id and issue.number = seed.number
 where not exists (select 1
                     from ouroboros.issue_estimates prior
                    where prior.github_issue_id = issue.id
                      and prior.version >= seed.version)
   and ${ouro_dev_seed}
on conflict do nothing;
