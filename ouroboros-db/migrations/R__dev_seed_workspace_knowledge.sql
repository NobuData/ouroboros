-- R__dev_seed_workspace_knowledge.sql — mockup 14's Knowledge page as rows: six skills, five
-- facts, three playbooks, the environment recipe, and the injection records every usage number
-- on the page is counted from, in a development database and nowhere else.
--
-- [`docs/mockups/14-knowledge.html`](../../docs/mockups/14-knowledge.html) is the whole page:
-- `6 active` skills, `2 awaiting review` facts, `3 recipes`, and every derived figure beside
-- them. Filed as issue #409 (BE.5), the last issue of epic BE of the Knowledge roadmap
-- (docs/ROADMAP_MOCKUP_14_KNOWLEDGE.md). It stands on V069 (#405), V071 (#406), V072 (#407) and
-- V073 (#408), and on the `#482` universe the other seeds built: the runs (#68, #302), PR `#514`
-- (#356), the canonical tickets (#275) and the intake estimates (#103).
--
-- ---------------------------------------------------------------------------
-- **Every usage number is counted, and none is written down.**
-- ---------------------------------------------------------------------------
--
-- The shortcut would be to store `48` and let the row look right. V071 exists so that cannot
-- happen: usage is counted from `context_injections`, and no table has a column to put a count
-- in. So this file works backwards — it writes the injection records a real month of context
-- assembly would have written, and the page's figures fall out of them:
--
--   | Surface                     | Reads                                                     |
--   |-----------------------------|-----------------------------------------------------------|
--   | `used 48×`, `used 12×`      | count of `context_injections` rows whose `fact_ids` hold the fact |
--   | `was used 31×`              | `previous_use_count`, snapshotted at expiry **from that same count** |
--   | `61% of runs`               | 11 of the 18 helios-firmware runs with a manifest carried a version of the skill |
--   | `every run`                 | every run with a manifest in the skill's scope carried it |
--   | `every PR`                  | exactly the in-scope runs that opened a pull request carried it |
--   | `physical tests`            | exactly the in-scope runs that took HIL measurements carried it |
--   | `—`                         | no manifest carried it (the draft)                        |
--   | `run 9×` · `14×` · `3×`     | count of `runs` whose `playbook_id` names the playbook     |
--   | `v12 · 2d ago`              | `skills.current_version` and that version's `published_at` |
--   | `confirmed by Ken, 6w ago`  | `facts.confirmed_by` and `confirmed_at`                   |
--
-- The used-by rule, in the order a reader applies it, over the runs that carry at least one
-- manifest (the denominator is *runs context was assembled for*, not every row of `runs`): no
-- run carried the skill → `—`; every in-scope run did → `every run`; exactly the in-scope runs
-- with a `pr_number` did → `every PR`; exactly the in-scope runs with HIL measurements did →
-- `physical tests`; otherwise the rounded share → `61% of runs`. tests/seed.sql applies it and
-- gets the mockup's six cells; tests/seed.test.sh refuses the figures as literals in this file.
--
-- **The lock, the tint and the tag are columns, not flags written for the page.** `hil-safety`
-- is locked because `required = true` (V069's `skills_required_enabled` holds it on);
-- `power-budget-checks` is tinted because `draft = true` (and is switched off, as the mockup
-- draws it); `repo-map` reads `auto-generated nightly` because `origin = 'generated'` and its
-- sixty versions are one a night, unattributed, as the #415 generator will publish them.
--
-- ---------------------------------------------------------------------------
-- **The five facts, and the story each one tells.**
-- ---------------------------------------------------------------------------
--
--   1. *CI needs `west update` before first build of the day* — confirmed by Ken 42 days ago
--      (`6w`), workspace-wide, with a `dependency` anchor on `west`. It rides in **every
--      manifest assembled since**, 48 of them: the three oldest launches predate it.
--   2. *Tests under `tests/hil/` require rig reservation via `rig claim`* — confirmed by Maya 21
--      days ago (`3w`), helios-firmware, anchored on `tests/hil/**`. It rides in the twelve
--      manifests of the runs whose work touched that tree: the two live loops at the rig
--      (`#482`, `#479`) and `#471`, `#334` and `#310`.
--   3. *Team prefers `k_msgq` over `k_fifo` in ISR paths* — **proposed** by BF.3's
--      correction-note proposer (#412) from Ken's note on Build 1 of run `#482` (Loop #1847),
--      citing that run, PR `#514` and the classification, and saying so honestly: `from
--      correction note (run #1847)`, not the mockup's `from PR #514 review cycle`, which is the
--      richer extraction #423 will make. Running the proposer over this seed reports it
--      `already_proposed` — this row is its output.
--   4. *PID gains live in `config/control.yaml`, not in headers* — **proposed**, observed in
--      loop #1847, citing the run.
--   5. *Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`* — imported from `CLAUDE.md` 199 days ago,
--      anchored on `platform_version zephyr-4.0`, used by every helios-firmware run manifest
--      and three of the estimates. When this file applies, the sweep flags it `stale` (no
--      actor) and Ken expires it with *"Zephyr 4.1 migration"*; the `previous_use_count`
--      written in that statement is `count(*)` over the injection records, so `was used 31×`
--      is a snapshot of a count and never a typed number. Its expiry is also what leaves it
--      re-learnable: V071's `facts_relearn_from_expired` accepts a proposal naming an
--      expired fact, and the mockup's **Re-learn** is that insert.
--
-- Which confirmed facts ride in a given manifest is the assembler's trim decision (BF.5,
-- #414), and this file records outcomes rather than modelling a policy. It holds the two rules
-- any outcome must: **nothing is injected before it was confirmed or published** — each
-- manifest carries the skill version in force at its own instant (so `#482`'s manifests carry
-- `zephyr-conventions` v12, and a launch nine days ago carries v11) — and **only confirmed
-- facts and published versions of non-draft skills are injected**, which V071's trigger
-- refuses otherwise.
--
-- ---------------------------------------------------------------------------
-- **Decisions taken on #409, rather than guessed.**
-- ---------------------------------------------------------------------------
--
--   1. **Five more runs.** The three launch counts are 26 runs whose `playbook_id` is set, and
--      each launch runs its playbook's workflow. Twenty-one of them are #68's runs, tagged here
--      by `update` (the column is V072's and nothing else reads it); `CVE bump` needs fourteen
--      `deps-refresh` runs and the workspace has nine, so the other five (`#290`–`#294`) are
--      inserted here, merged, 33 to 57 days ago — outside every window the dashboard (7 and 14
--      days) and the workflows rail (30 days) count over. tests/seed.sql counts 58 runs and
--      scopes its whole-history assertions to the fourteen days #68 seeded.
--   2. **Maya, not Priya.** The mockup's second fact was *"confirmed by Priya"*; Priya is a
--      pending invitation in mockup 17 rather than a member, so Maya confirms it.
--   3. **The mockup's lines, resolvable refs.** A fact confirmed three or six weeks ago cannot
--      cite a run — #68's history is fourteen days deep — and PR `#498` is not mirrored. So the
--      two confirmed facts keep the mockup's provenance *line* word for word and cite canonical
--      tickets that predate their confirmation (`#552`, the BLE stack bump whose manifest
--      change broke the farm's first builds, and `#560`, the conformance tests on the bench
--      DK). The proposals cite run `#482` and PR `#514`, and the expired fact its import.
--   4. **`{run, classification}` is `{run, pull_request}`.** V071's typed refs have no
--      `classification` kind, so the correction-note proposal cites the run whose
--      classification carried the note and the PR under review — the roadmap's own sketch.
--   5. **The fact audit is stamped when this file applies.** `fact_transitions.at` is
--      `clock_timestamp()` by V071's design and the audit refuses writes of its own, so every
--      transition row here is dated at seed time. The ages the page prints come from
--      `confirmed_at`, which the confirming write sets.
--   6. **`every PR` and `physical tests` are run-level.** The live loops have no open-PR or HIL
--      stage yet, so the two phrases are derived from what a run *did* — opened a pull request,
--      took a HIL measurement — rather than from a stage key.
--   7. **The env recipe is the mockup's**, `git@github.com:acme-robotics/helios-firmware` as
--      the manifest remote, at v3 after one detected draft and two edits by Ken.
--
-- ---------------------------------------------------------------------------
-- **Ids, order, and the three properties every seed holds.**
-- ---------------------------------------------------------------------------
--
--   | Table                        | Ids                    | Built from                        |
--   |------------------------------|------------------------|-----------------------------------|
--   | `skills` (6)                 | `5eed0042…`            | the table's row, 1–6              |
--   | `skill_versions` (82)        | `5eed0043…`            | skill · version                   |
--   | `facts` (5)                  | `5eed0044…`            | the card's row, 1–5               |
--   | `fact_anchors` (5)           | `5eed0045…`            | the fact                          |
--   | `playbooks` (3)              | `5eed0046…`            | the card's row, 1–3               |
--   | `runs` (5)                   | #68's `5eed0009…`      | the issue number                  |
--   | `context_injections` (51)    | `5eed0048…`            | consumer · run or estimate · stage |
--   | `env_recipes` (3)            | `5eed0047…`            | the version                       |
--
-- The file is named `workspace_knowledge` for its sort position, as `ticket_planning` was: the
-- playbooks pin `R__dev_seed_workflows.sql`'s versions, the facts cite the planning and
-- verification seeds' rows, and the injections hang off the dashboard, run-console and intake
-- seeds' — so it must sort after every one of them, and `knowledge` alone would sort before
-- `providers`. tests/seed.test.sh asserts the whole order.
--
-- 1. **It cannot run in production.** Every statement carries `${ouro_dev_seed}`.
-- 2. **It is idempotent.** Every insert ends `on conflict do nothing`, and every update is guarded
--    by `is distinct from` or by the state it moves away from, so a second pass writes nothing.
--    The two version inserts carry the workflows seed's `not exists` guard, because their
--    next-version triggers are BEFORE triggers and raise before a conflict is looked for. The
--    injection insert re-reads which facts are confirmed, so a second pass after the expiry
--    offers rows without the expired fact — rows whose ids already exist.
-- 3. **It never fails on a database somebody has edited.** Parents are found by natural key —
--    the workspace by slug, people by email, runs by issue number, tickets by key, the PR by
--    number, workflows by slug, estimates by their issue — so a missing parent writes nothing.

-- ---------------------------------------------------------------------------
-- The six skills — mockup 14's table, top to bottom.
--
-- `name` is the slug, because the table's first cell renders the slug. The pointer to the
-- version in force is written by the third statement, once the versions exist (V069's
-- `skills_current_version_fk`, the workflows seed's reason). `created_at` is a day before each
-- skill's first version.
-- ---------------------------------------------------------------------------
insert into ouroboros.skills (id, organization_id, slug, name, description, scope, repo_ref,
                              enabled, required, draft, origin, created_at)
select ('5eed0042-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", seed.slug, seed.slug, seed.description, seed.scope,
       case seed.scope when 'repo' then 'acme-robotics/helios-firmware' end,
       seed.enabled, seed.required, seed.draft, seed.origin,
       now() - make_interval(days => seed.created_days_ago)
  from (values
         (1, 'zephyr-conventions',  'Kconfig, devicetree & ISR-safety house rules',
          'repo', true,  false, false, 'authored',   80),
         (2, 'repo-map',            'Module & ownership map of the source tree',
          'repo', true,  false, false, 'generated',  61),
         (3, 'pr-etiquette',        'PR title format, changelog entry, reviewer ping rules',
          'org',  true,  false, false, 'authored',  100),
         -- The locked switch: required, and therefore enabled (skills_required_enabled).
         (4, 'hil-safety',          'Hardware-in-loop interlocks before any motor spins',
          'repo', true,  true,  false, 'authored',  141),
         (5, 'commit-style',        'Conventional commits, 72-char body wrap, sign-off',
          'org',  true,  false, false, 'authored',  131),
         -- The tinted row: a draft, switched off, never injected.
         (6, 'power-budget-checks', 'Flag changes that raise idle current above 120 µA',
          'repo', false, false, true,  'authored',    1)
       ) as seed (ordinal, slug, description, scope, enabled, required, draft, origin,
                  created_days_ago)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The version histories — 82 rows.
--
-- `zephyr-conventions` v1–v12 a week apart, v12 two days ago (`v12 · 2d ago`) and the one that
-- drops the legacy-timer rule for Zephyr 4.1; `repo-map` v1–v60, one a day with the newest seven
-- hours before the seed, unattributed and noted `Nightly rebuild` — the generator's history;
-- `pr-etiquette` v4 three weeks ago; `hil-safety` v3; `commit-style` v2 61 days ago (`2mo`); and
-- `power-budget-checks` v1 twenty minutes ago — a draft *skill* whose first version is
-- published, which is V069's distinction between the skill's lifecycle and a draft version.
--
-- Ordered by skill and version, and guarded by *"a version at or above this one exists"*,
-- because `skill_versions_next_version` is a BEFORE trigger — R__dev_seed_workflows.sql's
-- statement and its reason.
-- ---------------------------------------------------------------------------
insert into ouroboros.skill_versions (id, skill_id, version, body, frontmatter, published_at,
                                      published_by, change_note, created_at, updated_at)
select ('5eed0043-0000-4000-8000-' || lpad(seed.ordinal::text, 4, '0')
                                   || lpad(seed.version::text, 8, '0'))::uuid,
       skill.id, seed.version,
       seed.body || E'\n\n_' || seed.change_note || '._\n',
       seed.frontmatter::jsonb,
       now() - make_interval(mins => seed.published_mins_ago),
       publisher."id",
       seed.change_note,
       now() - make_interval(mins => seed.published_mins_ago),
       now() - make_interval(mins => seed.published_mins_ago)
  from (
         -- zephyr-conventions: a version a week, v12 two days ago.
         select 1 as ordinal, v.version,
                E'# Zephyr conventions\n\n'
                || E'- Kconfig: a new option defaults to `n` and lives in its subsystem''s own '
                || E'`Kconfig`, never only in `prj.conf`.\n'
                || E'- Devicetree: reference nodes by label (`DT_NODELABEL`), never by path.\n'
                || E'- ISR safety: nothing that can block runs in an ISR; hand work to a thread '
                || E'through `k_msgq` or `k_work`.' as body,
                '{"name": "zephyr-conventions", "description": "Kconfig, devicetree & ISR-safety house rules", "scope": "repo", "load": "on_trigger", "triggers": ["Kconfig", "devicetree", "ISR"]}' as frontmatter,
                (2 + 7 * (12 - v.version)) * 1440 as published_mins_ago,
                case when v.version % 3 = 0 then 'maya@acme-robotics.dev'
                     else 'ken@acme-robotics.dev' end as publisher_email,
                case v.version
                  when 1  then 'First publish'
                  when 12 then 'Zephyr 4.1: drop the CONFIG_LEGACY_TIMER rule'
                  else 'Rule ' || v.version || ' from review feedback' end as change_note
           from generate_series(1, 12) as v (version)
         union all
         -- repo-map: the nightly generator — sixty rebuilds, nobody's.
         select 2, v.version,
                E'# Repository map\n\n'
                || E'| Path | Owner | Purpose |\n|---|---|---|\n'
                || E'| `app/` | firmware | application threads and the main loop |\n'
                || E'| `drivers/` | platform | board and peripheral drivers |\n'
                || E'| `subsys/telemetry/` | telemetry | the CAN and BLE frame pipeline |\n'
                || E'| `tests/hil/` | hil | rig-driven hardware tests |',
                '{"name": "repo-map", "description": "Module & ownership map of the source tree", "scope": "repo", "load": "always"}',
                (60 - v.version) * 1440 + 420,
                null,
                'Nightly rebuild'
           from generate_series(1, 60) as v (version)
         union all
         select 3, v.version,
                E'# PR etiquette\n\n'
                || E'- Title: `<area>: <imperative summary>`, at most 72 characters.\n'
                || E'- Every PR adds one CHANGELOG line.\n'
                || E'- Ping the owning team from the repo map; never more than two reviewers.',
                '{"name": "pr-etiquette", "description": "PR title format, changelog entry, reviewer ping rules", "scope": "org", "load": "on_trigger", "triggers": ["pull request"]}',
                (21 + 26 * (4 - v.version)) * 1440,
                'jorge@acme-robotics.dev',
                case v.version when 1 then 'First publish' else 'Reviewer rules, revision ' || v.version end
           from generate_series(1, 4) as v (version)
         union all
         select 4, v.version,
                E'# HIL safety\n\n'
                || E'- Claim the rig (`rig claim`) before any test that drives a motor.\n'
                || E'- The e-stop loop must be armed and read back before power is applied.\n'
                || E'- Never raise a current limit in a HIL fixture to make a test pass.',
                '{"name": "hil-safety", "description": "Hardware-in-loop interlocks before any motor spins", "scope": "repo", "load": "on_trigger", "triggers": ["HIL", "rig", "motor"]}',
                (40 + 50 * (3 - v.version)) * 1440,
                'ken@acme-robotics.dev',
                case v.version when 1 then 'First publish' else 'Interlock rules, revision ' || v.version end
           from generate_series(1, 3) as v (version)
         union all
         select 5, v.version,
                E'# Commit style\n\n'
                || E'- Conventional commits: `type(scope): summary`.\n'
                || E'- Wrap the body at 72 characters.\n'
                || E'- Every commit carries a `Signed-off-by` line.',
                '{"name": "commit-style", "description": "Conventional commits, 72-char body wrap, sign-off", "scope": "org", "load": "always"}',
                (61 + 69 * (2 - v.version)) * 1440,
                'maya@acme-robotics.dev',
                case v.version when 1 then 'First publish' else 'Require sign-off' end
           from generate_series(1, 2) as v (version)
         union all
         -- The draft skill's first version, twenty minutes ago.
         select 6, 1,
                E'# Power budget checks\n\n'
                || E'- Flag any change that raises measured idle current above 120 µA.\n'
                || E'- Deep-sleep paths must release every peripheral clock they took.',
                '{"name": "power-budget-checks", "description": "Flag changes that raise idle current above 120 µA", "scope": "repo", "load": "on_trigger", "triggers": ["power", "sleep"]}',
                20,
                'maya@acme-robotics.dev',
                'First draft for review'
       ) as seed (ordinal, version, body, frontmatter, published_mins_ago, publisher_email,
                  change_note)
  join ouroboros.organization org   on org."slug" = 'acme-robotics'
  join ouroboros.skills       skill on skill.organization_id = org."id"
                                   and skill.id = ('5eed0042-0000-4000-8000-'
                                                   || lpad(seed.ordinal::text, 12, '0'))::uuid
  -- Left: the generator publishes as nobody.
  left join ouroboros."user" publisher on publisher."email" = seed.publisher_email
 where not exists (select 1
                     from ouroboros.skill_versions prior
                    where prior.skill_id = skill.id
                      and prior.version >= seed.version)
   and ${ouro_dev_seed}
 order by seed.ordinal, seed.version
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The pointers — the version in force, which is the highest here and still a pointer.
-- ---------------------------------------------------------------------------
update ouroboros.skills skill
   set current_version = seed.current_version
  from (values (1, 12), (2, 60), (3, 4), (4, 3), (5, 2), (6, 1)) as seed (ordinal, current_version),
       ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and skill.organization_id = org."id"
   and skill.id = ('5eed0042-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid
   and exists (select 1 from ouroboros.skill_versions v
                where v.skill_id = skill.id and v.version = seed.current_version)
   and skill.current_version is distinct from seed.current_version
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The five facts, born proposed — V071 accepts nothing else at insert.
--
-- The provenance line is the card's text; the refs are what it stands for, each found by
-- natural key so an edited database drops a ref rather than failing (V071's resolver refuses a
-- ref that names no row). A manual fact names its author as the creation's actor; a
-- correction-note proposal and an import have no person behind their creation.
-- ---------------------------------------------------------------------------
insert into ouroboros.facts (id, organization_id, repo_ref, text, proposer, provenance,
                             status_changed_by, created_at)
select ('5eed0044-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", seed.repo_ref, seed.text, seed.proposer,
       jsonb_build_object(
         'line', seed.line,
         'refs', (select coalesce(jsonb_agg(ref.doc order by ref.n), '[]'::jsonb)
                    from (select 1 as n, jsonb_build_object('kind', 'ticket', 'id', t.id::text) as doc
                            from ouroboros.tickets t
                           where t.organization_id = org."id" and t.external_key = seed.ticket_key
                          union all
                          select 2, jsonb_build_object('kind', 'run', 'id', run.id::text)
                            from ouroboros.runs run
                           where seed.cites_run
                             and run.organization_id = org."id" and run.issue_number = 482
                          union all
                          select 3, jsonb_build_object('kind', 'pull_request', 'id', pr.id::text)
                            from ouroboros.pull_requests pr
                           where seed.cites_pr
                             and pr.organization_id = org."id" and pr.external_number = 514
                          union all
                          select 4, jsonb_build_object('kind', 'classification',
                                                       'id', classification.id::text)
                            from ouroboros.failure_classifications classification
                           where seed.proposer = 'correction_note'
                             and classification.organization_id = org."id"
                             and classification.id = '5eed0037-0000-4000-8000-000000048201'
                          union all
                          select 5, jsonb_build_object('kind', 'import', 'file', 'CLAUDE.md',
                                                       'section', 'Kconfig')
                           where seed.proposer = 'import') as ref)),
       author."id",
       now() - make_interval(mins => seed.created_mins_ago)
  from (values
         (1, null::text, 'CI needs `west update` before first build of the day',
          'manual', 'from build-farm failure pattern', '#552', false, false,
          'ken@acme-robotics.dev', 44 * 1440),
         (2, 'acme-robotics/helios-firmware',
          'Tests under `tests/hil/` require rig reservation via `rig claim`',
          'manual', 'from PR #498 review cycle', '#560', false, false,
          'maya@acme-robotics.dev', 23 * 1440),
         (3, 'acme-robotics/helios-firmware',
          'Team prefers `k_msgq` over `k_fifo` in ISR paths',
          'correction_note', 'from correction note (run #1847)', null, true, true,
          null, 1),
         (4, 'acme-robotics/helios-firmware',
          'PID gains live in `config/control.yaml`, not in headers',
          'manual', 'observed in loop #1847', null, true, false,
          'jorge@acme-robotics.dev', 2),
         (5, 'acme-robotics/helios-firmware',
          'Zephyr 4.0 needs `CONFIG_LEGACY_TIMER`',
          'import', 'imported from CLAUDE.md', null, false, false,
          null, 200 * 1440)
       ) as seed (ordinal, repo_ref, text, proposer, line, ticket_key, cites_run, cites_pr,
                  author_email, created_mins_ago)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  left join ouroboros."user" author on author."email" = seed.author_email
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Three of them confirmed — "and you approve". The person is both the stamp the card prints
-- and the actor V071's audit records (facts_transition_actor requires one).
-- ---------------------------------------------------------------------------
update ouroboros.facts fact
   set status            = 'confirmed',
       confirmed_by      = confirmer."id",
       confirmed_at      = now() - make_interval(days => seed.confirmed_days_ago),
       status_changed_by = confirmer."id"
  from (values
         (1, 'ken@acme-robotics.dev',  42),
         (2, 'maya@acme-robotics.dev', 21),
         (5, 'ken@acme-robotics.dev', 199)
       ) as seed (ordinal, confirmer_email, confirmed_days_ago),
       ouroboros.organization org,
       ouroboros."user" confirmer
 where org."slug" = 'acme-robotics'
   and confirmer."email" = seed.confirmer_email
   and fact.organization_id = org."id"
   and fact.id = ('5eed0044-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid
   and fact.status = 'proposed'
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- Why each fact can expire (K4). The legacy-timer anchor is the one the sweep evaluated when it
-- fired, so it carries a `last_checked_at`; the others have not been checked yet.
-- ---------------------------------------------------------------------------
insert into ouroboros.fact_anchors (id, fact_id, kind, value, last_checked_at)
select ('5eed0045-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       fact.id, seed.kind, seed.value,
       case when seed.checked then now() end
  from (values
         (1, 'dependency',       'west',                false),
         (2, 'path_glob',        'tests/hil/**',        false),
         (3, 'path_glob',        'subsys/telemetry/**', false),
         (4, 'path_glob',        'config/control.yaml', false),
         (5, 'platform_version', 'zephyr-4.0',          true)
       ) as seed (ordinal, kind, value, checked)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.facts fact on fact.organization_id = org."id"
                           and fact.id = ('5eed0044-0000-4000-8000-'
                                          || lpad(seed.ordinal::text, 12, '0'))::uuid
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The three playbooks — mockup 14's recipes card.
--
-- Each pins a published version of the workflow its launches ran (V072's
-- `playbooks_workflow_version_fk`): `Flaky test hunt` on `standard-fix@v14` — re-pinned three
-- days ago when v14 shipped, which is its `updated_at` and the pin `#482` runs under — `CVE
-- bump` on `deps-refresh@v1`, `New driver bring-up` on `feature-loop@v1`. Only the first was
-- created from a past run (`#316`, a telemetry fix that went well); the other two were written
-- by hand, and V072 allows a null `source_run_id` for exactly that. The driver recipe forces
-- `zephyr-conventions` on, which assembly honours in helios-firmware and ignores elsewhere.
-- ---------------------------------------------------------------------------
insert into ouroboros.playbooks (id, organization_id, name, description, workflow_id,
                                 workflow_version, skill_overrides, context_preset,
                                 source_run_id, issue_filter, created_at, updated_at)
select ('5eed0046-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", seed.name, seed.description, wf.id, seed.workflow_version,
       case when seed.forces_zephyr
            then jsonb_build_object('enable', jsonb_build_array(
                   ('5eed0042-0000-4000-8000-' || lpad('1', 12, '0'))))
            else '{}'::jsonb end,
       seed.context_preset::jsonb,
       source.id,
       seed.issue_filter::jsonb,
       now() - make_interval(days => seed.created_days_ago),
       now() - make_interval(days => seed.updated_days_ago)
  from (values
         (1, 'Flaky test hunt', 'Finds & fixes the flakiest test in the suite',
          'standard-fix', 14, false,
          '{"steer_notes": ["Rank the suite by flake score and fix the flakiest test; quarantine nothing without a root cause."]}',
          316, '{"labels": ["bug", "tests"]}', 15, 3),
         (2, 'CVE bump', 'Patch a vulnerable dep + prove no API break',
          'deps-refresh', 1, false,
          '{"steer_notes": ["Bump to the patched release only, and prove the public API is unchanged."]}',
          null, '{"labels": ["dependencies", "deps", "security"]}', 60, 60),
         (3, 'New driver bring-up', 'Scaffold + HIL smoke test on the bench rig',
          'feature-loop', 1, true,
          '{"steer_notes": ["Scaffold the driver behind a devicetree binding, then prove it with a HIL smoke test on the bench rig."]}',
          null, '{"repos": ["acme-robotics/helios-firmware"]}', 15, 15)
       ) as seed (ordinal, name, description, workflow_slug, workflow_version, forces_zephyr,
                  context_preset, source_issue_number, issue_filter, created_days_ago,
                  updated_days_ago)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.workflows    wf  on wf.organization_id = org."id" and wf.slug = seed.workflow_slug
  left join ouroboros.runs source on source.organization_id = org."id"
                                 and source.issue_number = seed.source_issue_number
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Five older CVE-bump launches — decision 1 in the header.
--
-- #68's recipe: id and `loop_seq` from the issue number, merged at `Merged · 6/6` with every
-- check passing, a PR numbered the issue plus 100. Issues `#290`–`#294` sit below #68's
-- `#300`–`#345`, and every instant is older than thirty days, so no window any other page counts
-- over contains them.
-- ---------------------------------------------------------------------------
insert into ouroboros.runs (id, organization_id, github_repo_id, issue_number, issue_title,
                            loop_seq, workflow_tag, model, status,
                            stage_label, stage_index, stage_total,
                            started_at, finished_at, pr_number, checks_passed, checks_total,
                            playbook_id)
select ('5eed0009-0000-4000-8000-' || lpad(seed.issue_number::text, 12, '0'))::uuid,
       org."id", repo.id, seed.issue_number, seed.issue_title,
       1365 + seed.issue_number, 'deps-refresh', seed.model, 'merged',
       'Merged', 6, 6,
       now() - make_interval(days => seed.days_ago, secs => seed.cycle_seconds),
       now() - make_interval(days => seed.days_ago),
       seed.issue_number + 100, 13, 13,
       playbook.id
  from (values
         (290, 'Bump littlefs past the superblock overflow fix',      'ollama/qwen3-coder',  57,  780),
         (291, 'Bump mbedTLS for the X.509 parsing advisory',         'copilot/gpt-5-codex', 50,  900),
         (292, 'Bump the BLE controller for the pairing advisory',    'ollama/qwen3-coder',  46,  840),
         (293, 'Bump tinycbor for the decoder bounds fix',            'ollama/qwen3-coder',  38,  720),
         (294, 'Bump MCUboot for the image-header validation fix',    'copilot/gpt-5-codex', 33,  960)
       ) as seed (issue_number, issue_title, model, days_ago, cycle_seconds)
  join ouroboros.organization org      on org."slug" = 'acme-robotics'
  join ouroboros.github_orgs  gh       on gh.organization_id = org."id" and gh.login = 'acme-robotics'
  join ouroboros.github_repos repo     on repo.org_id = gh.id and repo.name = 'helios-firmware'
  join ouroboros.playbooks    playbook on playbook.organization_id = org."id"
                                      and playbook.name = 'CVE bump'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The other twenty-one launches are #68's runs, each running its playbook's workflow:
-- nine `standard-fix` runs through `Flaky test hunt` (`#482` among them, on its v14 pin), the
-- nine `deps-refresh` runs through `CVE bump`, and three `feature-loop` runs through `New driver
-- bring-up`. Six of the nine flaky hunts and every deps bump are helios-firmware's.
-- ---------------------------------------------------------------------------
update ouroboros.runs run
   set playbook_id = playbook.id
  from (values
         (482, 'Flaky test hunt'), (471, 'Flaky test hunt'), (343, 'Flaky test hunt'),
         (334, 'Flaky test hunt'), (310, 'Flaky test hunt'), (300, 'Flaky test hunt'),
         (340, 'Flaky test hunt'), (303, 'Flaky test hunt'), (329, 'Flaky test hunt'),
         (476, 'CVE bump'), (341, 'CVE bump'), (324, 'CVE bump'), (320, 'CVE bump'),
         (313, 'CVE bump'), (302, 'CVE bump'), (336, 'CVE bump'), (330, 'CVE bump'),
         (307, 'CVE bump'),
         (479, 'New driver bring-up'), (465, 'New driver bring-up'), (331, 'New driver bring-up')
       ) as seed (issue_number, playbook_name),
       ouroboros.organization org,
       ouroboros.playbooks playbook
 where org."slug" = 'acme-robotics'
   and playbook.organization_id = org."id"
   and playbook.name = seed.playbook_name
   and run.organization_id = org."id"
   and run.issue_number = seed.issue_number
   and run.playbook_id is distinct from playbook.id
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The injection records — 51 manifests, and the only place any usage number comes from.
--
-- Three consumers, V071's three:
--
--   * `run_stage` — every model stage the three live loops have started (a stage with a
--     `max_attempts` is an `llm` node, the only kind that assembles context): ten manifests.
--   * `playbook` — one per launch, at the run's start: twenty-six.
--   * `estimator` — one per estimate the intake and planning seeds wrote: fifteen, every one of
--     them helios-firmware work.
--
-- What each manifest carries is decided below, per skill and per fact, and the header says why.
-- Skill versions are the ones in force at the manifest's instant; facts are the confirmed ones,
-- re-read, so a second pass after the expiry cannot offer an unconfirmed fact.
--
-- Ids: `5eed0048…` then the consumer (1 stage, 2 playbook, 3 estimator) and its key — the
-- issue, position and attempt of a stage, the issue of a launch, the estimate's own suffix.
-- ---------------------------------------------------------------------------
insert into ouroboros.context_injections (id, organization_id, consumer, estimate_id,
                                          run_stage_id, run_id, skill_version_ids, fact_ids,
                                          manifest_hash, injected_at)
select manifest.id, manifest.organization_id, manifest.consumer, manifest.estimate_id,
       manifest.run_stage_id, manifest.run_id, skills.ids, facts.ids,
       encode(sha256(convert_to(manifest.consumer || '|' || array_to_string(skills.ids, ',')
                                || '|' || array_to_string(facts.ids, ','), 'UTF8')), 'hex'),
       manifest.injected_at
  from (
         -- The live loops' model stages.
         select ('5eed0048-0000-4000-8000-1' || lpad(run.issue_number::text, 5, '0')
                 || lpad(stage."position"::text, 3, '0') || lpad(stage.attempt::text, 3, '0'))::uuid
                  as id,
                run.organization_id, 'run_stage' as consumer, null::uuid as estimate_id,
                stage.id as run_stage_id, run.id as run_id, stage.started_at as injected_at,
                run.issue_number, null::integer as estimate_issue,
                repo.name = 'helios-firmware' as in_helios, run.pr_number is not null as opened_pr
           from ouroboros.runs run
           join ouroboros.run_stages   stage on stage.run_id = run.id
           join ouroboros.github_repos repo  on repo.id = run.github_repo_id
          where run.finished_at is null
            and stage.max_attempts is not null
            and stage.started_at is not null
         union all
         -- One manifest per playbook launch.
         select ('5eed0048-0000-4000-8000-2' || lpad(run.issue_number::text, 11, '0'))::uuid,
                run.organization_id, 'playbook', null, null, run.id, run.started_at,
                run.issue_number, null,
                repo.name = 'helios-firmware', run.pr_number is not null
           from ouroboros.runs run
           join ouroboros.github_repos repo on repo.id = run.github_repo_id
          where run.playbook_id is not null
         union all
         -- One manifest per estimate: the intake chips and the planning batch's drafts.
         select ('5eed0048-0000-4000-8000-3' || right(estimate.id::text, 11))::uuid,
                coalesce(issue.organization_id, batch.organization_id), 'estimator',
                estimate.id, null, null, estimate.created_at,
                null, issue.number, true, false
           from ouroboros.issue_estimates estimate
           left join ouroboros.github_issues issue on issue.id = estimate.github_issue_id
           left join ouroboros.ticket_drafts draft on draft.id = estimate.draft_id
           left join ouroboros.draft_batches batch on batch.id = draft.batch_id
       ) as manifest
  join ouroboros.organization org on org."id" = manifest.organization_id
  cross join lateral (
         -- Each skill that rode, at the version in force when the manifest was assembled.
         select coalesce(array_agg(in_force.id order by skill.slug), '{}') as ids
           from ouroboros.skills skill
           cross join lateral (select v.id
                                 from ouroboros.skill_versions v
                                where v.skill_id = skill.id
                                  and v.version is not null
                                  and v.published_at <= manifest.injected_at
                                order by v.version desc
                                limit 1) as in_force
          where skill.organization_id = org."id"
            and not skill.draft
            and case skill.slug
                  -- Every run's manifests, and no estimate's.
                  when 'commit-style'       then manifest.run_id is not null
                  -- Every helios-firmware manifest, the estimates' included.
                  when 'repo-map'           then manifest.in_helios
                  -- Every run that opened a pull request.
                  when 'pr-etiquette'       then manifest.opened_pr
                  -- Every run that took HIL measurements.
                  when 'hil-safety'         then exists (
                         select 1
                           from ouroboros.test_runs tr
                           join ouroboros.test_suites suite on suite.test_run_id = tr.id
                           join ouroboros.test_cases tc on tc.test_suite_id = suite.id
                           join ouroboros.hil_measurements m on m.test_case_id = tc.id
                          where tr.run_id = manifest.run_id)
                  -- Eleven of the eighteen helios-firmware runs: Kconfig, devicetree and ISR work.
                  when 'zephyr-conventions' then manifest.issue_number
                                                   in (482, 479, 476, 471, 343, 341, 334, 324,
                                                       320, 310, 300)
                  else false
                end
       ) as skills
  cross join lateral (
         -- Each confirmed fact that rode — never one confirmed after the manifest's instant.
         select coalesce(array_agg(fact.id order by fact.id), '{}') as ids
           from ouroboros.facts fact
          where fact.organization_id = org."id"
            and fact.status = 'confirmed'
            and fact.confirmed_at <= manifest.injected_at
            and case fact.id
                  -- `west update`: every manifest since it was confirmed.
                  when '5eed0044-0000-4000-8000-000000000001' then true
                  -- The rig claim: the runs whose work touched tests/hil/.
                  when '5eed0044-0000-4000-8000-000000000002'
                    then manifest.issue_number in (482, 479, 471, 334, 310)
                  -- The legacy timer: every helios-firmware run, and the three estimates whose
                  -- issues touch the Zephyr build (the I²C lockup, the CAN storm, 4.2).
                  when '5eed0044-0000-4000-8000-000000000005'
                    then (manifest.run_id is not null and manifest.in_helios)
                         or manifest.estimate_issue in (485, 489, 490)
                  else false
                end
       ) as facts
 where org."slug" = 'acme-robotics'
   and ${ouro_dev_seed}
 order by manifest.injected_at, manifest.id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The legacy-timer fact's end — confirmed → stale → expired.
--
-- The sweep flags it: its `platform_version` anchor on `zephyr-4.0` stopped holding when the
-- repository moved to 4.1. The sweep is nobody, so `status_changed_by` is cleared in the same
-- statement — V071's audit copies whatever the column holds.
-- ---------------------------------------------------------------------------
update ouroboros.facts fact
   set status            = 'stale',
       status_changed_by = null,
       status_reason     = 'platform_version anchor zephyr-4.0 no longer holds'
  from ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and fact.organization_id = org."id"
   and fact.id = '5eed0044-0000-4000-8000-000000000005'
   and fact.status = 'confirmed'
   and ${ouro_dev_seed};

-- Ken agrees, and the count is snapshotted from the injection records in the same statement —
-- the `was used 31×` the struck-through row renders from then on.
update ouroboros.facts fact
   set status             = 'expired',
       expired_reason     = 'Zephyr 4.1 migration',
       status_reason      = 'Zephyr 4.1 migration',
       status_changed_by  = ken."id",
       previous_use_count = (select count(*)
                               from ouroboros.context_injections injection
                              where injection.fact_ids @> array[fact.id])
  from ouroboros.organization org,
       ouroboros."user" ken
 where org."slug" = 'acme-robotics'
   and ken."email" = 'ken@acme-robotics.dev'
   and fact.organization_id = org."id"
   and fact.id = '5eed0044-0000-4000-8000-000000000005'
   and fact.status = 'stale'
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The environment recipe — the Repo Profile card's Environment block, at v3.
--
-- v1 is the draft BB.1's west pack would detect from `west.yml` (no person); Ken's two edits make
-- it the mockup's four ordered commands. Ordered and guarded by version for
-- `env_recipes_next_version`, the skill versions' reason.
-- ---------------------------------------------------------------------------
insert into ouroboros.env_recipes (id, organization_id, repo_ref, version, commands, source,
                                   updated_by, updated_at)
select ('5eed0047-0000-4000-8000-' || lpad(seed.version::text, 12, '0'))::uuid,
       org."id", 'acme-robotics/helios-firmware', seed.version, seed.commands::jsonb,
       seed.source, editor."id",
       now() - make_interval(days => seed.days_ago)
  from (values
         (1, 'detected', null, 60,
          '[{"command": "west init -m git@github.com:acme-robotics/helios-firmware", "comment": "manifest repo"},
            {"command": "west update"}]'),
         (2, 'edited', 'ken@acme-robotics.dev', 30,
          '[{"command": "west init -m git@github.com:acme-robotics/helios-firmware", "comment": "manifest repo"},
            {"command": "west update --narrow -o=--depth=1", "comment": "shallow module fetch"},
            {"command": "zephyr-sdk-install 0.17.1 --toolchains arm-zephyr-eabi", "comment": "SDK + ARM toolchain"}]'),
         (3, 'edited', 'ken@acme-robotics.dev', 9,
          '[{"command": "west init -m git@github.com:acme-robotics/helios-firmware", "comment": "manifest repo"},
            {"command": "west update --narrow -o=--depth=1", "comment": "shallow module fetch"},
            {"command": "zephyr-sdk-install 0.17.2 --toolchains arm-zephyr-eabi", "comment": "SDK + ARM toolchain"},
            {"command": "ccache --set-config=max_size=8G", "comment": "shared build cache"}]')
       ) as seed (version, source, editor_email, days_ago, commands)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  left join ouroboros."user" editor on editor."email" = seed.editor_email
 where not exists (select 1
                     from ouroboros.env_recipes prior
                    where prior.organization_id = org."id"
                      and prior.repo_ref = 'acme-robotics/helios-firmware'
                      and prior.version >= seed.version)
   and ${ouro_dev_seed}
 order by seed.version
on conflict do nothing;
