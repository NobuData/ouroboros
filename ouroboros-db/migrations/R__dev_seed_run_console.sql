-- R__dev_seed_run_console.sql — mockup 10's Run Console, as rows, in a development database
-- and nowhere else.
--
-- R__dev_seed.sql (#23) puts the *workspaces* in a development database and
-- R__dev_seed_dashboard.sql (#68) puts the **dashboard** in it — fifty-three runs, of which
-- three are live, and the stage history the three of them carry. One of those three is
-- `#482`, *Fix flaky CAN-bus telemetry test*, and
-- [`docs/mockups/10-run-detail.html`](../../docs/mockups/10-run-detail.html) is a whole page
-- about it. This file is that page.
--
-- Filed as issue #302 (AO.5), the last issue of the Run Console roadmap
-- (docs/ROADMAP_MOCKUP_10_RUN_CONSOLE.md), and it stands on all four of its schema issues:
-- V045's `run_stages` (#298), V046's `run_events` (#299), V047's `run_files`, `run_commits`
-- and the two `runs` columns (#300), and V048's `guardrail_evaluations` (#301).
--
-- ---------------------------------------------------------------------------
-- **Why a seed, and why a mid-flight one.**
-- ---------------------------------------------------------------------------
--
-- Design review should not require a running simulator. Somebody opening the console on a
-- fresh compose stack should see the mockup — the transcript with its diffs, the stepper
-- caught mid-attempt, the meters part-filled — because that is how the page gets reviewed,
-- screenshotted and regression-tested cheaply, and because AP.5's driver (#307) is not the
-- thing every UI issue in this roadmap should have to wait for.
--
-- The state being reproduced is specifically a **mid-flight** one, which is the awkward one
-- to seed. `#482` is 12m 40s in; three stages are done, one is on its second attempt after a
-- gate sent the loop backwards, and four are untouched; its transcript's last entry is still
-- running at 47 of 63 cases. Static fixtures of that shape tend to look plausible and
-- disagree with themselves — durations that do not sum, a token count that does not match
-- the meter beside it, an elapsed time that drifts every time somebody opens the page a week
-- later.
--
-- **So every instant here is written as an offset into the run**, and `runs.started_at` is
-- the only clock any of them reads. Read off the mockup, the page is a run that began at
-- `14:00:00` and was drawn at `14:12:40`, so *seconds into the run* is the mockup's own
-- timestamp minus `14:00:00`:
--
--     0s ──────────────────────── the run ─────────────────────── 760s = 12m 40s
--     │ 4      76       201                    460  475                │
--     ├queued─┬─analyze─┬──plan───┬──implement 1──┬──implement 2───────┤
--     │ 0m 04s  1m 12s    2m 05s  │   ✗ failed    │    ● active        │
--     │                                        ↑ 468s: the gate, ↺
--     │
--     │ transcript   131   206   242   280   312   468   495   570   739
--     │              plan  read  model edit  tests GATE  model edit  tests ●
--
-- The stage boundaries are R__dev_seed_dashboard.sql's, in the same frame; this file writes
-- the nine transcript instants, the two commits at `300` and `580`, the four usage rows at
-- `40`, `140`, `360` and `640`, and the guardrail evaluation at `590`.
--
-- **Anchored to the run rather than to `now()`, which is not the same thing.** Both seeds
-- are relative to `now()`, but they are two Flyway migrations and therefore two
-- transactions, so their `now()`s differ by however long the run in between took — a tenth
-- of a second on a laptop, more on a loaded CI runner. Offsets from `now()` would put the
-- transcript a variable distance inside the run it belongs to, and the page's own arithmetic
-- — *the transcript opens 2m 11s in and spans 10m 08s* — would be approximately true instead
-- of true. `run.started_at + make_interval(…)` makes it exact at every hour of every day,
-- which is what *recompute-stable relative to `now()`* has to mean for a page that draws
-- durations. tests/seed.sql asserts both of those figures to the second.
--
-- ---------------------------------------------------------------------------
-- **The honesty rule, and decision R8.**
-- ---------------------------------------------------------------------------
--
-- The rule this roadmap is written under is that **no number exists outside the seeds**, and
-- its corollary — decision **R8** — is that no number exists *twice*. Every figure mockup 10
-- renders is a row here or an aggregate over rows here, and the aggregate is computed by
-- whatever renders it rather than remembered in a column:
--
--   | Surface                          | Reads                                             |
--   |----------------------------------|---------------------------------------------------|
--   | *Loop #1847*                     | `runs.loop_seq`, written by #68                   |
--   | *standard-fix v14*               | `runs.workflow_tag` + `runs.workflow_version_pin` |
--   | *elapsed 12m 40s*, *Wall clock*  | `now() - runs.started_at`                         |
--   | *branch loop/482-canbus-flake*   | `runs.branch_name`                                |
--   | Stage timeline, `attempt 2/3`    | `run_stages`, seeded by #68                       |
--   | the stepper's warn note          | `run_stages.note`, *generated* from the transition|
--   | Agent transcript                 | `run_events`, ordered by its dense `seq`          |
--   | *3 files*, `+38 −12`             | `count()` and the columns of `run_files`          |
--   | `a41c9e2`, `7f03b8d`             | `run_commits`, ordered by `seq`                   |
--   | *will squash on merge*           | `runs.merge_strategy`                             |
--   | *212k / 400k budget*             | `sum(token_usage)` / `run_stages.token_budget`    |
--   | *$1.14 / $2.50 cap*              | `sum(token_usage.cost_cents)` / `routes.max_cost_cents_per_run` |
--   | *forge-02 reserved*              | `runs.reserved_build_job_id` → the job's runner   |
--   | Guardrails, four rows            | `v_run_guardrails_latest`                         |
--   | *Policy: standard-fix v14*       | `runs.workflow_tag` + `guardrail_evaluations.policy_ref` |
--
-- Two of those are worth saying out loud, because they are the two a seed is most tempted to
-- write as a number:
--
--   * **The `400k` budget is already on the stage row** — `run_stages.token_budget`, pinned
--     from `standard-fix v14`'s DSL limits by #68 — and the `$2.50` cap is already on the
--     route — `routes.max_cost_cents_per_run = 250` on `implement-primary`, seeded by #192.
--     This file writes neither. The meters divide a sum by a policy that was already there,
--     which is what makes the console's numbers answerable to the pages that set them.
--   * **`212k` and `$1.14` are a `sum` over `token_usage`**, not a counter on `runs`. Four
--     rows, one per model stage this run has spent anything in, and they add up. See that
--     statement's header for what had to move in the dashboard seed to make room for them
--     without moving the day's total.
--
-- ---------------------------------------------------------------------------
-- **Decision R4: the watermark.**
-- ---------------------------------------------------------------------------
--
-- Everything the driver writes, this seed writes the same way — including the `simulated`
-- flag. `runs.simulated` is set to `true` **before** a single transcript entry is written,
-- and `run_events_append()` then raises each entry's own flag to the run's, exactly as it
-- does for the simulator. So the seeded run wears the same watermark a scripted one does,
-- and the JSONL export (`ouroboros.run_events_jsonl`) carries `"simulated": true` on every
-- line of it.
--
-- That ordering is not a convenience. `runs_simulated_is_fixed()` refuses to move the flag
-- once the run has written anything, on the ground that a run whose header disagrees with
-- its lines is worse than one with no header — so the update below *has* to come first, and
-- would fail loudly if a later edit moved it after the transcript.
--
-- A seeded transcript that looked like real model output and carried no watermark would be
-- the exact fabrication R4 exists to prevent, and the reason the flag is here rather than in
-- a comment is that a comment is not queryable.
--
-- ---------------------------------------------------------------------------
-- **Why this is a file of its own, and why it is named to sort where it does.**
-- ---------------------------------------------------------------------------
--
-- Flyway applies repeatable migrations after every versioned one, **in the order of their
-- descriptions**. Every row here finds its parents by natural key — the workspace by slug,
-- the run by issue number, the build job by its farm number — so this must run after the
-- seeds that create them: `dev_seed` (the workspace), `dev_seed_dashboard` (the run and its
-- stages) and `dev_seed_farm` (the reservation's job). `dev_seed_run_console` sorts after all
-- three and before `dev_seed_sources`, which it does not depend on, and tests/seed.test.sh
-- asserts the whole order by comparing descriptions — so a rename fails the pull request
-- rather than the console.
--
-- A file rather than more of R__dev_seed_dashboard.sql because they answer different
-- questions and change on different days: that one is *what the loop has done*, across
-- fifty-three runs and four read-model tables, and this is *one run, in detail*, across five
-- tables that did not exist when it was written. The two are coordinated in three places and
-- each is commented where it happens — the `implement` attempt boundaries and the
-- `claude-fable-5` ledger row there, and `forge-02`'s queue depth in the farm seed.
--
-- **Ids.** `5eed…`, as everywhere: an id beginning `5eed` came from a seed. Five prefixes,
-- one per table, so a row is identifiable on sight in a log or a URL, and every one is
-- computed from a literal and the row's own ordinal rather than written out — so a second
-- application computes the same ids and writes none of them.
--
--   | Table                          | Ids          | Built from                          |
--   |--------------------------------|--------------|-------------------------------------|
--   | `run_events` (9)               | `5eed002b…`  | the issue number, then the entry's seq |
--   | `run_files` (3)                | `5eed002c…`  | the issue number, then the file's ordinal |
--   | `run_commits` (2)              | `5eed002d…`  | the issue number, then the commit's seq |
--   | `token_usage` (4)              | `5eed002e…`  | the issue number, then the row's ordinal |
--   | `guardrail_evaluations` (4)    | `5eed002f…`  | the issue number, then the check's ordinal |
--
-- The three properties every seed in this directory holds, each asserted by a test:
--
-- 1. **It cannot run in production.** Every statement carries `${ouro_dev_seed}`, which is
--    `false` in flyway.toml — the configuration `scripts/migrate`, CI and every hand-run
--    migration read — and `true` only in flyway.seed.toml, which only the development
--    compose stack loads by itself.
--
-- 2. **It is idempotent.** Every insert ends `on conflict do nothing` and the one `update`
--    is idempotent by construction. The transcript needs one thing more, and the farm seed's
--    log chunks need it for the same reason: `run_events_append()` is a **before** trigger
--    that moves `runs.event_seq` and `runs.event_bytes`, and a before trigger fires whether
--    or not the row it prepared is then discarded by `on conflict`. A second application
--    would therefore leave the run's counters describing a transcript twice the size of the
--    one it has. The `not exists` guard on that statement is what makes `migrate` twice
--    leave them where the first pass left them.
--
-- 3. **It never fails on a database somebody has edited.** Parents are found by natural key,
--    never by naming an id twice, so a developer who deleted the demo workspace gets a seed
--    that quietly re-creates what it can — and one who deleted the run gets a file that
--    writes nothing at all rather than one that fails.

-- ---------------------------------------------------------------------------
-- The page head, and the two snapshots under it.
--
-- Five columns on `runs`, of which `loop_seq` is already there (`1365 + 482 = 1847`, written
-- by #68 so that `Loop #1847` is the same number in every database):
--
--   * **`branch_name`** — `loop/482-canbus-flake`, which the head prints and which R7's
--     *Take over in IDE* dialog will hand somebody as a checkout command.
--   * **`workflow_version_pin`** — `14`. The head's `standard-fix v14` tag is this and
--     `workflow_tag` composed, never a string: the slug half is already on the run and a
--     second copy of it here would be a second place for it to be wrong. A snapshot rather
--     than a join, on V008's decision **F8**: the workflow can be republished, renamed or
--     deleted, and a closed run must still answer for what it actually ran under.
--   * **`merge_strategy`** — `squash`, which is the Changes card's *will squash on merge*
--     tag. The DSL spells it `auto-squash` in `open_pr_automerge`'s options; V047 stores the
--     method and not the switch, so the value is `squash` and the *auto* is the node.
--   * **`simulated`** — `true`, decision **R4**, and this is the statement that must run
--     before the transcript. See the header.
--   * **`reserved_build_job_id`** — the farm's `#483`, queued on `forge-02` and held for
--     this run. R__dev_seed_farm.sql writes the job and argues the reservation; this writes
--     the pointer, because it sorts after that file and V047 put the column on `runs`.
--
-- An `update` and not an insert: `#68` owns the run row, and a seed that tried to own it
-- twice would be two files racing to describe one loop. It is idempotent because an update
-- to the values already there is a no-op — including `simulated`, which
-- `runs_simulated_is_fixed()` allows through unchanged however much transcript exists.
-- ---------------------------------------------------------------------------
update ouroboros.runs run
   set branch_name          = 'loop/482-canbus-flake',
       workflow_version_pin = 14,
       merge_strategy       = 'squash',
       simulated            = true,
       reserved_build_job_id = job.id
  from ouroboros.organization org
  join ouroboros.build_jobs job on job.organization_id = org."id" and job.number = 483
 where run.organization_id = org."id"
   and org."slug" = 'acme-robotics'
   and run.issue_number = 482
   and ${ouro_dev_seed};

-- ---------------------------------------------------------------------------
-- The agent transcript — nine entries, and the shapes the card draws them as.
--
-- Decision **R3**: the transcript is *typed, not a log*. The actor chip, the tool tag, the
-- diff block and the progress meter exist because a reader at 3 a.m. is skimming for the
-- moment things turned, so the store carries the structure and the console queries it
-- instead of parsing prose out of a body. That is why every entry below names an `actor`,
-- most name a `stage_key` and an `attempt`, the tool entries name a `tool_tag`, the model
-- entries name a `model_id`, and the two diffs and the two test runs put their content in
-- `payload` rather than in `body`.
--
-- **`seq` is not written here.** `run_events_append()` allocates it densely per run, which is
-- what AP.2's `?after=` pages by, and a seed that supplied its own numbers would be
-- asserting the allocator's answer rather than using it. What the seed supplies instead is
-- the **order**, and the `order by` is load-bearing for the reason the farm seed's log chunks
-- found the hard way (#262): a multi-row `insert … select` over a join promises no order, and
-- the trigger numbers rows as they reach it, so an unordered insert would hand the mockup's
-- nine instants sequence numbers that disagree with their own clock. tests/seed.sql asserts
-- both orders agree.
--
-- **The bodies are the mockup's, and the numbers in them are not.** Entry 5's card prints
-- *2 passed, 1 flaked → retrying under load profile* and entry 9's prints *running… 47/63
-- cases* over a meter at 74%. The sentence is the tool's own result text and is stored; the
-- `47`, the `63` and the `74%` are one fact, so `payload.progress` holds `{done, total}` and
-- the console divides. A width stored beside the fraction it was computed from is the second
-- place for it to be wrong.
--
-- **The diff hunks carry no markers.** `−` and `+` are what `kind` means, so the text of a
-- `del` line is the code and not the code with a minus sign on it. V046's
-- `run_events_payload_hunks_typed` holds every hunk to `{ctx|del|add}` and a string, which is
-- the whole of what the renderer needs to know.
--
-- **The gate entry belongs to the gate, not to the stage it sent the loop back to.** Its
-- `stage_key` is `checks-green` — the same node `run_stages.returned_from_stage_key` names on
-- attempt 2 — and it falls at `468` seconds, in the gap between attempt 1 ending at `460` and
-- attempt 2 beginning at `475`. That gap is why R__dev_seed_dashboard.sql's attempt boundaries moved when this
-- file landed; its header says so where the numbers are.
--
-- `simulated` is passed explicitly as well as inherited. The trigger would raise it from the
-- run either way — that is R4's mechanism, and the run's flag is set by the statement above —
-- but a transcript fixture whose watermark depended on reading another statement's effect is
-- a fixture that tests nothing about its own rows.
-- ---------------------------------------------------------------------------
insert into ouroboros.run_events (id, run_id, ts, actor, stage_key, attempt,
                                  tool_tag, model_id, body, payload, simulated)
select ('5eed002b-0000-4000-8000-' || lpad('482', 6, '0')
                                   || lpad(entry.seq::text, 6, '0'))::uuid,
       run.id,
       run.started_at + make_interval(secs => entry.secs_in),
       entry.actor, entry.stage_key, entry.attempt,
       entry.tool_tag, entry.model_id, entry.body, entry.payload::jsonb, true
  from (values
         -- 14:02:11 · PLAN — the root cause, written before any file was opened.
         (1, 131, 'plan', 'plan', 1, null, null,
          'Root cause: test asserts on frame order; CAN driver ISR can reorder under load.',
          null),

         -- 14:03:26 · TOOL read_file — the body is the path, which is what the card prints.
         (2, 206, 'tool', 'implement', 1, 'read_file', null,
          'drivers/can/telemetry_buf.c',
          null),

         -- 14:04:02 · CLAUDE-FABLE-5 — a model entry, so `model_id` and the stage it reasoned
         -- in are both required by run_events_model_provenance. Decision R4's provenance.
         (3, 242, 'model', 'implement', 1, null, 'claude-fable-5',
          'The buffer uses a bare k_fifo shared between the RX ISR and the telemetry thread. '
          'k_fifo gives no ordering guarantee once the ISR preempts a partially completed put '
          '— that matches the flake signature. Switching to a k_msgq with an explicit '
          'per-frame sequence number lets the consumer detect and tolerate reorder.',
          null),

         -- 14:04:40 · TOOL edit_file — the first diff payload, eight hunks. The path is the
         -- body (the card draws it as a faint chip in the head) and the code is the payload,
         -- so neither is stored twice.
         (4, 280, 'tool', 'implement', 1, 'edit_file', null,
          'drivers/can/telemetry_buf.c',
          '{"hunks": [
              {"kind": "ctx", "text": "/* telemetry frame path */"},
              {"kind": "del", "text": "static struct k_fifo tel_fifo;"},
              {"kind": "del", "text": "k_fifo_put(&tel_fifo, tx_frame);"},
              {"kind": "del", "text": "rx = k_fifo_get(&tel_fifo, K_FOREVER);"},
              {"kind": "add", "text": "K_MSGQ_DEFINE(tel_msgq, sizeof(struct tel_frame), CONFIG_TEL_QUEUE_DEPTH, 4);"},
              {"kind": "add", "text": "tx_frame->seq = atomic_inc(&tel_seq);"},
              {"kind": "add", "text": "k_msgq_put(&tel_msgq, tx_frame, K_NO_WAIT);"},
              {"kind": "add", "text": "k_msgq_get(&tel_msgq, &rx, K_FOREVER);"}
            ]}'),

         -- 14:05:12 · TOOL run_tests — the command is the body, the outcome is the payload,
         -- and `severity` is what draws the result line in amber rather than the console
         -- pattern-matching the word "flaked" out of a sentence.
         (5, 312, 'tool', 'implement', 1, 'run_tests', null,
          'twister -T tests/telemetry',
          '{"severity": "warn",
            "result": "2 passed, 1 flaked → retrying under load profile"}'),

         -- 14:07:48 · GATE — the transition itself, at the instant between the two attempts.
         -- The stepper's warn note is *not* this text: V045 composes that from the columns on
         -- the stage row, so the two say the same thing without either being the other's copy.
         (6, 468, 'gate', 'checks-green', 1, null, null,
          'test flake reproduced — returning to implement (attempt 2) ↺',
          null),

         -- 14:08:15 · CLAUDE-FABLE-5 — attempt 2's reasoning, and the first entry that carries
         -- `attempt = 2`.
         (7, 495, 'model', 'implement', 2, null, 'claude-fable-5',
          'The reorder window is in the ISR fast path; sequence numbers must be assigned '
          'before the enqueue, not after — a consumer scheduled between the put and the '
          'increment still observes a stale seq.',
          null),

         -- 14:09:30 · TOOL edit_file — the second diff payload, five hunks.
         (8, 570, 'tool', 'implement', 2, 'edit_file', null,
          'drivers/can/isr_fastpath.c',
          '{"hunks": [
              {"kind": "del", "text": "k_msgq_put(&tel_msgq, &frame, K_NO_WAIT);"},
              {"kind": "del", "text": "frame.seq = atomic_inc(&tel_seq);   /* too late: consumer may run first */"},
              {"kind": "add", "text": "frame.seq = atomic_inc(&tel_seq);   /* assign before enqueue */"},
              {"kind": "add", "text": "int ret = k_msgq_put(&tel_msgq, &frame, K_NO_WAIT);"},
              {"kind": "add", "text": "__ASSERT(ret == 0, \"tel msgq overflow in ISR\");"}
            ]}'),

         -- 14:12:19 · TOOL run_tests, **live** — the entry the card outlines in cyan and draws
         -- a pulsing meter under. `47/63` is one fact stored once; the 74% is the division.
         (9, 739, 'tool', 'implement', 2, 'run_tests', null,
          'twister -T tests/telemetry --load-profile',
          '{"state": "running", "progress": {"done": 47, "total": 63}}')
       ) as entry (seq, secs_in, actor, stage_key, attempt, tool_tag, model_id, body, payload)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs         run on run.organization_id = org."id"
                                 and run.issue_number = 482
 where ${ouro_dev_seed}
   and not exists (select 1 from ouroboros.run_events existing
                    where existing.run_id = run.id)
 order by entry.seq
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Changes so far — the three files, with the mockup's counts.
--
-- `3 files`, `+38 −12`, `+9 −3`, `+21 −0`. The card's *3 files* tag is `count(*)` over these
-- rows and the totals under it are `sum()`, which is decision **R8** again: no aggregate of
-- them is stored anywhere, so there is nothing to drift.
--
-- Two of the three are `modified` and the test file is `added`, which is the only reading its
-- `−0` allows and the one `run_files_added_removes_nothing` enforces. The counts are
-- **cumulative against the run's base**, not deltas — V047's upsert semantics — so the two
-- files the transcript edits twice carry one row each with the total, which is why
-- `telemetry_buf.c` is `+38 −12` and not the sum of two hunks.
--
-- `last_reported_at` comes from the column default: the change-set was reported when the
-- second commit landed, and the default is close enough to that for a fixture whose whole
-- point is to be relative to `now()`.
-- ---------------------------------------------------------------------------
insert into ouroboros.run_files (id, run_id, path, additions, deletions, status)
select ('5eed002c-0000-4000-8000-' || lpad('482', 6, '0')
                                   || lpad(changed.ordinal::text, 6, '0'))::uuid,
       run.id, changed.path, changed.additions, changed.deletions, changed.status
  from (values
         (1, 'drivers/can/telemetry_buf.c',        38, 12, 'modified'),
         (2, 'drivers/can/isr_fastpath.c',          9,  3, 'modified'),
         (3, 'tests/telemetry/test_frame_order.c', 21,  0, 'added')
       ) as changed (ordinal, path, additions, deletions, status)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs         run on run.organization_id = org."id"
                                 and run.issue_number = 482
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The two commits, in the order the card draws them.
--
-- `a41c9e2` is the first attempt's work — the k_fifo replaced by a k_msgq — and lands at `300`
-- seconds, between the edit at `280` and the test run at `312` that found the flake anyway.
-- `7f03b8d` is the second attempt's, at `580`, just after its edit at `570`. So the
-- commits sit inside the transcript rather than beside it, and the reservation on `forge-02`
-- names `7f03b8d` as the commit it would build.
--
-- `seq` is the card's order and the unique key beside the sha, because a commit is immutable
-- and a redelivered report is a no-op rather than an update. No count of these is stored on
-- `runs`; the card counts the rows.
-- ---------------------------------------------------------------------------
insert into ouroboros.run_commits (id, run_id, sha, message, seq, committed_at)
select ('5eed002d-0000-4000-8000-' || lpad('482', 6, '0')
                                   || lpad(revision.seq::text, 6, '0'))::uuid,
       run.id, revision.sha, revision.message, revision.seq,
       run.started_at + make_interval(secs => revision.secs_in)
  from (values
         (1, 'a41c9e2', 'can: replace telemetry k_fifo with k_msgq + frame seq', 300),
         (2, '7f03b8d', 'can: assign frame seq in ISR before enqueue',           580)
       ) as revision (seq, sha, message, secs_in)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs         run on run.organization_id = org."id"
                                 and run.issue_number = 482
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Resources — the ledger the token meter and the cost meter are sums over.
--
-- The card reads `212k / 400k budget` and `$1.14 / $2.50 cap`. The two denominators are
-- already in the database and are not written here — `run_stages.token_budget` is `400000` on
-- every model stage of this run (pinned from `standard-fix v14`'s DSL limits by #68) and
-- `routes.max_cost_cents_per_run` is `250` on `implement-primary` (seeded by #192, and the
-- only route the mockups give a cap to). What this writes is the **numerator**: four
-- `token_usage` rows, one per model stage the run has spent anything in, totalling exactly
-- `212 000` tokens and `114` cents.
--
--     analyze     24 000    12¢
--     plan        38 000    20¢
--     implement 1 90 000    48¢      ← the attempt that failed, and still cost
--     implement 2 60 000    34¢      ← in flight
--     ─────────────────────────
--                212 000   114¢      = 212k, $1.14
--
-- **Four rows rather than one**, because the meter is a `sum` and a fixture of one row would
-- leave the summing untested; and because an attempt that failed still spent, which is the
-- thing a per-run counter would quietly lose when the loop returned from the gate.
--
-- **What had to move to make room.** R__dev_seed_dashboard.sql's ledger already attributed
-- `900 000` tokens and `540` cents of `claude-fable-5` spend to this run, from before it had
-- a Resources card to answer for, and mockup 02's *Token spend · today* is `4.2M ≈ $18.60
-- across 4 providers` — a figure these rows must not move. So that row keeps the remainder
-- and drops its attribution: `688 000` tokens, `426` cents, no run. 688 + 212 is 900 and
-- 426 + 114 is 540, so the day is untouched, the run is right, and neither number was
-- invented to make the other work. That file's header says the same thing from its side.
-- (#356 later took another 72 000 tokens and 38 cents from it for mockup 12's spend, so the
-- row now holds 616 000 and 388, and this meter reads the PR page's 284k / $1.52 — see
-- R__dev_seed_verification.sql's decision 3.)
--
-- **`task_kind` and `latency_ms` stay null**, as they are on every row the dashboard and
-- provider seeds write. The 370 rows of R__dev_seed_routing.sql are the *routed* ledger
-- mockup 06's matrix is computed from, and they are deliberately all before today; a row
-- here carrying a kind would join that matrix and move a p50 nobody asked it to.
--
-- **`occurred_at` is clamped into the current UTC day.** Each row's natural instant is inside
-- the stage that spent it, which is inside the last 12m 40s — and 12m 40s before `now()` is
-- *yesterday* if the stack comes up at 00:05 UTC. `token_usage_daily` fixes the day to UTC,
-- so an unclamped row would fall out of the day whose total it is part of, and the dashboard
-- would read `4.0M` once a night. `greatest(…, day start)` is what keeps every row inside
-- both windows at once: never before the day, never before the run, never after `now()`.
-- ---------------------------------------------------------------------------
insert into ouroboros.token_usage (id, organization_id, run_id, provider, model,
                                   tokens_in, tokens_out, cost_cents, occurred_at)
select ('5eed002e-0000-4000-8000-' || lpad('482', 6, '0')
                                   || lpad(spend.ordinal::text, 6, '0'))::uuid,
       org."id", run.id, 'anthropic', 'claude-fable-5',
       spend.tokens_total / 5 * 4, spend.tokens_total / 5, spend.cost_cents,
       greatest(run.started_at + make_interval(secs => spend.secs_in), utc_day.day_start)
  from (values
         (1, 'analyze',     24000,  12.0000,  40),
         (2, 'plan',        38000,  20.0000, 140),
         (3, 'implement/1', 90000,  48.0000, 360),
         (4, 'implement/2', 60000,  34.0000, 640)
       ) as spend (ordinal, stage, tokens_total, cost_cents, secs_in)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs         run on run.organization_id = org."id"
                                 and run.issue_number = 482
  cross join (select date_trunc('day', now() at time zone 'utc') at time zone 'utc')
          as utc_day (day_start)
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Guardrails — the card's four rows, and the one that is not a pass.
--
-- Decision **R5**, as rows: three passes and a `not_applicable`, evaluated against the
-- change-set the three `run_files` rows above are, under the policy the run is pinned to.
--
--   * **`allowed_paths`** and **`ci_config`** pass with no evidence. Null is *nothing to
--     show*, which is the ordinary case for a pass — a check that found nothing has no path
--     to name, and an empty object would be a claim that it looked somewhere in particular.
--   * **`secrets`** passes and records `ruleset_version = 'v3'`, which is what makes a
--     re-run comparable: the same diff under a newer ruleset is the explanation for a
--     verdict that changed while the code did not.
--   * **`review_required`** is `not_applicable` and not a pass. The card draws it as `○`
--     with *Human review not required (auto-merge eligible)*, and *"this did not apply to
--     you"* and *"you were checked and were fine"* are different things to tell somebody.
--     It carries no `change_set_seq`, because it is not a judgement about a change-set — the
--     latest-per-check view orders nulls last for exactly this row.
--
-- **`policy_ref = 14` on all four**, which is the deliberate second copy V048 argues for: a
-- verdict is answerable for the policy it applied, and reading `runs.workflow_version_pin` at
-- render time would answer a question about the run when the question was about the
-- evaluation. The card's footer — *Policy: standard-fix v14 · tenant acme-robotics* — is the
-- run's slug, this number and the workspace, composed; the slug half is not copied here.
--
-- **One round, not two.** The table is history and `v_run_guardrails_latest` is what the card
-- reads, so a seed *could* write a superseded `fail` underneath to exercise the view. It does
-- not: the mockup shows a clean run, and tests/constraints.sql already drives re-evaluation
-- against a fixture built for it. A seed that invented a failure the page does not draw would
-- be a number outside the mockup, which is the rule this whole file is written under.
--
-- `evaluated_at` is `590` seconds into the run, just after the second commit at `580` — the
-- checks run on a reported change-set, and the change-set was complete when that commit landed.
-- ---------------------------------------------------------------------------
insert into ouroboros.guardrail_evaluations (id, run_id, "check", verdict, ruleset_version,
                                             policy_ref, change_set_seq, evaluated_at)
select ('5eed002f-0000-4000-8000-' || lpad('482', 6, '0')
                                   || lpad(guard.ordinal::text, 6, '0'))::uuid,
       run.id, guard."check", guard.verdict, guard.ruleset_version,
       14, guard.change_set_seq, run.started_at + make_interval(secs => 590)
  from (values
         (1, 'allowed_paths',   'pass',           null,   1),
         (2, 'ci_config',       'pass',           null,   1),
         (3, 'secrets',         'pass',           'v3',   1),
         (4, 'review_required', 'not_applicable', null, null)
       ) as guard (ordinal, "check", verdict, ruleset_version, change_set_seq)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.runs         run on run.organization_id = org."id"
                                 and run.issue_number = 482
 where ${ouro_dev_seed}
on conflict do nothing;
