-- R__dev_seed_workflows.sql — mockup 04's studio as rows: the five workflows the rail
-- lists, and `standard-fix`'s twelve-node canvas at v14, in a development database and
-- nowhere else.
--
-- The eighth development seed. R__dev_seed.sql (#23) is *who exists*,
-- R__dev_seed_dashboard.sql (#68) is *what the loop has done*, R__dev_seed_intake.sql
-- (#103) is *what it has an opinion about next*, R__dev_seed_providers.sql (#221) is *what
-- it is allowed to call*, R__dev_seed_routing.sql (#192) is *how it decides which one to
-- call*, R__dev_seed_audit.sql (#225) is *who touched the keys*, R__dev_seed_sources.sql
-- (#138) is *where the work comes from* — and this is **what it does with it**. All of it
-- belongs to `acme-robotics`, the workspace every mockup is drawn in, which is
-- R__dev_seed_providers.sql's rule and for its reason.
--
-- V029 (#132) created `workflows` and `workflow_versions` and said in as many words that
-- nothing wrote them yet. P.3 (#134) is the create-and-publish endpoint; this is the seed,
-- and between them those two tables stop being a schema nobody has exercised.
--
--   | Rows                     | Id prefix   | Suffix                                     |
--   |--------------------------|-------------|--------------------------------------------|
--   | `workflows` (5)          | `5eed001b…` | the rail's ordinal, 1–5                    |
--   | `workflow_versions` (19) | `5eed001c…` | the rail's ordinal, then the version (0 = the draft) |
--
-- Three properties make it safe to apply to a development database on every `up`, and each
-- of them is asserted by a test:
--
--   1. **It cannot run in production.** Every statement ends `${ouro_dev_seed}`, which is
--      `false` in flyway.toml and `true` only in flyway.seed.toml — so under the ordinary
--      configuration the two inserts are `insert … select … where false`, the update matches
--      no row, and the file writes nothing.
--   2. **It is idempotent.** Every id is computed from the rail's ordinal and the version
--      rather than generated, both inserts end `on conflict do nothing`, and the update
--      carries `is distinct from` — so a second application matches no row and does not even
--      move `updated_at` through the touch trigger. The versions insert needs **one guard
--      more than a conflict clause**, because `workflow_version_next` is a BEFORE trigger and
--      raises before PostgreSQL looks at the key; see the statement itself.
--   3. **It never fails on a database somebody has edited.** The workspace is found by slug,
--      the publishers by email and each version by its workflow's slug, rather than by
--      repeating another seed's ids.
--
-- ---------------------------------------------------------------------------
-- Three statements, because the two tables point at each other.
-- ---------------------------------------------------------------------------
--
-- `workflow_versions.workflow_id` references `workflows`, and `workflows.current_version`
-- references `workflow_versions (workflow_id, version)` — V029's one `alter`, added after
-- both tables exist for exactly this reason. A row cannot therefore arrive with its pointer
-- already set: the version it would point at does not exist yet.
--
-- So the entities land first with a **null** pointer, the history lands second, and a third
-- statement moves each pointer onto the version in force. That third statement is the only
-- `update` in any seed in this module, and it carries the two things that make it behave
-- like the inserts around it: the `${ouro_dev_seed}` guard, and `current_version is distinct
-- from` — without which a second `migrate` would match five rows, change nothing in them,
-- and still move `updated_at` through `workflows_touch_updated_at`.
--
-- One consequence is worth stating rather than leaving to be discovered: **`workflows
-- .updated_at` is the moment the seed applied**, not a moment in the fiction, because the
-- pointer update stamps it and `ouroboros.touch_updated_at()` ignores any value a statement
-- supplies. `created_at` *is* in the fiction — it is when each workflow's first version was
-- published — and the mockup's *Last edited 2h ago* is neither of them: it is the draft's
-- `updated_at`, which is what `workflows.resources.ts` renders and what the section on the
-- draft below is about.
--
-- ---------------------------------------------------------------------------
-- The rail's order is `created_at`, so the dates are the order.
-- ---------------------------------------------------------------------------
--
-- P.4's listing reads `order by created_at asc, slug asc`
-- (`ouroboros-rest/src/modules/workflows/stats.repository.ts`), so the mockup's rail —
-- `standard-fix`, `feature-loop`, `deps-refresh`, `docs-loop`, `hotfix-p0` — is a statement
-- about *when each workflow was created*, and reproducing it is a matter of dating them in
-- that order rather than of sorting them anywhere. They are 120, 96, 72, 54 and 27 days old,
-- and each one's `created_at` is the instant its own v1 was published, which is the only
-- reading under which a workflow is as old as its history.
--
-- ---------------------------------------------------------------------------
-- `standard-fix` has fourteen versions because v14 is a *number*, not a label.
-- ---------------------------------------------------------------------------
--
-- The mockup's page head carries a `v14` chip and a **Publish v15** button, and V029 holds
-- version numbers **dense from 1** in a trigger (`workflow_version_next`): the next version
-- of a workflow whose highest is 13 is 14, and nothing may skip to it. So *v14, active* is
-- not one row with a 14 in it — it is fourteen rows, and the seed writes all fourteen.
--
-- That turns the ticket's *"version history depth ≥ 2"* into something the fixture has by
-- construction. What it does **not** turn into a licence is thirteen invented redesigns: a
-- seed that fabricated a different graph per version would be thirteen documents to keep
-- valid against the DSL schema for no reader's benefit. So the history is **one predecessor,
-- changed thirteen times in one small, true way each**:
--
--   * **v1–v13 are the six-node loop** — trigger, analyze, plan, implement, build, open PR —
--     and each version raises the implement stage's token budget by 20k, from 140k at v1 to
--     380k at v13. Every change note names exactly the number its document carries, so no note
--     describes a change that was not made.
--   * **v14 is the canvas mockup 04 draws**, node for node and edge for edge, and the change
--     note is the shape of that publish: the effort re-check branch, the split path back to
--     the queue, the test and self-review stages, and the checks gate that loops back to
--     implement.
--
-- The six-node predecessor is also the resolution of a disagreement the mockup has with
-- itself, and it is worth reading the P.4 caption note beside it (#135): the rail's caption
-- says `6 stages` next to a canvas of **twelve** nodes. A stage is a node — the toolbar's
-- **Add stage** adds one, the inspector's **Delete stage** deletes one, and mockup 20 counts
-- the same way — so the two cannot both be true of one document, and #135 left the choice to
-- this seed. The choice is: **seed the twelve-node canvas the ticket asks for and let the
-- caption read `12 stages · auto-merge`**, which is the honest caption for the document in
-- force. The six-stage document the mockup's string was written for is not discarded by that
-- choice — it is *v13*, and every version before it, which is where a document that is no
-- longer in force belongs. The other four rail captions are node counts already and are
-- reproduced exactly.
--
-- ---------------------------------------------------------------------------
-- The publishers, including the one that is nobody.
-- ---------------------------------------------------------------------------
--
-- `published_by` is nullable and `on delete set null` because *"a version can be published by
-- something other than a person — a seed, a template import"*, and a fixture in which every
-- version has a publisher would leave that column's null case to a unit test. So **v1 of
-- `standard-fix` has no publisher**: it is the template the workflow was created from, which
-- is the state **Browse templates** leaves behind, and its change note says so. The rest name
-- Ken, Maya or Jorge — three publishers, so *published by* is a column with more than one
-- answer in it.
--
-- ---------------------------------------------------------------------------
-- The draft, and why `standard-fix` has one.
-- ---------------------------------------------------------------------------
--
-- The page head reads *Last edited 2h ago* beside **Publish v15**, and neither is a property
-- of v14. `WorkflowDraft.updatedAt` is *"the mockup's Last edited, or null when there is no
-- draft"*, so the head the mockup draws is the head of a workflow **with a draft open** —
-- which is also what the canvas is showing, since the studio edits the draft rather than the
-- published version.
--
-- So `standard-fix` carries one, stamped two hours ago, and its document **is** v14's: that
-- is exactly what P.3's *"start editing"* leaves behind, a copy of the version in force that
-- nobody has changed yet. The canvas therefore renders the mockup's graph whether the studio
-- opens the draft or the version in force, which is what makes the acceptance criterion
-- *"renders the mockup graph from seeds alone"* true of both readings. The other four
-- workflows have no draft, so both halves of `workflow_versions_one_draft_idx` — a workflow
-- with a draft and a workflow without — exist in one workspace.
--
-- ---------------------------------------------------------------------------
-- What the rail then says, and the one number that is not the mockup's.
-- ---------------------------------------------------------------------------
--
-- P.4 computes all five captions from these rows and nothing is stored:
--
--   | Workflow       | Nodes | Terminal            | Caption                     |
--   |----------------|------:|---------------------|-----------------------------|
--   | `standard-fix` |    12 | open PR & auto-merge | `12 stages · auto-merge`   |
--   | `feature-loop` |     7 | open PR & auto-merge | `7 stages · auto-merge`    |
--   | `deps-refresh` |     5 | needs review         | `5 stages · needs review`  |
--   | `docs-loop`    |     4 | open PR & auto-merge | `4 stages · auto-merge`    |
--   | `hotfix-p0`    |     5 | (paused)             | `5 stages · paused`        |
--
-- `standard-fix` ends in two places — *Open PR & auto-merge* and *Back to queue* — and P.4's
-- precedence picks the furthest outcome, which is why its caption reads `auto-merge` and not
-- `back to queue`. `hotfix-p0` is `paused`, which replaces the behaviour rather than joining
-- it, and is the same fact as the rail's err-dot.
--
-- **The head's *used by 61% of runs* is not reachable and the seed does not fake it.** That
-- figure is a share of `runs`, which is R__dev_seed_dashboard.sql's fifty-three rows in the
-- trailing thirty days; twenty-two of them carry `standard-fix`, so the honest subline is
-- **`used by 42% of runs`**. No retagging produces 61% either: 61% of 53 runs is 32.33, and
-- there is no integer count of runs that rounds to it — 32 gives 60% and 33 gives 62% — so
-- reaching the mockup's string would mean changing how many runs the workspace has performed,
-- which is mockup 02's number and four of its cards' arithmetic. `tests/seed.sql` asserts 22
-- of 53, so an edit to either seed that moves the subline fails a test rather than a design
-- review.
--
-- **`hotfix-p0` has never run**, and that is the fifth fixture rather than a gap: the
-- dashboard seed's runs carry decision K5's four tags and none carries this one, so the rail's
-- paused entry is also the only workflow whose usage line is a zero — `used by 0% of runs`,
-- which is what P.4 renders for a workflow that demonstrably did not run in a workspace that
-- did. The four shares are 42, 28, 17 and 13, and with that zero they sum to 100 over 53 runs,
-- because every tag the dashboard seed wrote is now a workflow that exists.
--
-- ---------------------------------------------------------------------------
-- The documents are the DSL, and one of them is a committed fixture.
-- ---------------------------------------------------------------------------
--
-- Every definition below is a P.2 document (#133, `schemas/workflow-dsl/v1.json`): one
-- trigger, at least one terminal, every node reachable from the trigger, a condition on every
-- branch edge and none on a default one, and a `loop` edge that goes back up the graph.
-- `tests/seed.test.sh` parses all six documents out of this file and validates them against
-- the committed schema, so a seeded definition that drifted from the grammar fails the
-- module's suite; P.6 (#137) puts the same check in `ci/db`.
--
-- `standard-fix` v14 is **byte-for-byte the committed fixture**
-- `schemas/workflow-dsl/fixtures/valid/standard-fix.json`, which is that canvas node for node
-- — positions, chips, edge kinds and the dashed loop-back included. It is written out here
-- rather than read from there because a Flyway migration is SQL and cannot read a file, so
-- the drift that copy invites is closed the other way: `tests/seed.test.sh` compares the two
-- documents and fails if they differ. Edit one and the suite tells you about the other.
--
-- Filed as issue #136 (P.5). Needs #23 (the workspaces and the people), #133 (the DSL) and
-- V029's tables; coordinates with #103 for the `#485` dry-run fixture. Read by #137, by
-- epics R and S, and by the #154 e2e leg. Asserted in tests/seed.sql and tests/seed.test.sh.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The five entities the rail lists.
--
-- `name` is the slug on all five, because that is what mockup 04 renders in both places it
-- names a workflow — the rail's `.wf-name` and the page head's `h1` both read `standard-fix`.
-- V029 allows them to differ and expects them often not to; here they do not.
--
-- `current_version` is left null and set by the third statement — see the header. `status` is
-- `active` on four and `paused` on `hotfix-p0`, which is the rail's err-dot and its
-- `5 stages · paused` caption, both drawn from this one column.
--
-- `created_at` is the instant each workflow's v1 was published, which is also the rail's
-- order: P.4 lists `order by created_at asc, slug asc`.
-- ---------------------------------------------------------------------------
insert into ouroboros.workflows (id, organization_id, slug, name, status, created_at)
select ('5eed001b-0000-4000-8000-' || lpad(seed.ordinal::text, 12, '0'))::uuid,
       org."id", seed.slug, seed.slug, seed.status,
       now() - make_interval(days => seed.created_days_ago)
  from (values
         -- The mockup's rail, top to bottom, oldest first.
         (1, 'standard-fix', 'active', 120),
         (2, 'feature-loop', 'active',  96),
         (3, 'deps-refresh', 'active',  72),
         (4, 'docs-loop',    'active',  54),
         -- The err-dot fixture. Paused rather than archived: archived is the soft delete and
         -- would take the row off the rail, which is the opposite of what this one is for.
         (5, 'hotfix-p0',    'paused',  27)
       ) as seed (ordinal, slug, status, created_days_ago)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
 where ${ouro_dev_seed}
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The history: nineteen rows, of which one is a draft.
--
-- Fourteen versions of `standard-fix` — v1–v13 the six-node predecessor with a budget that
-- grows, v14 the mockup's canvas — one v1 apiece for the other four workflows, and the draft
-- `standard-fix` is being edited through. See the header for all four of those decisions.
--
-- **`order by seed.slug, seed.version` is a correctness rule, not a tidy output.**
-- `workflow_version_next` refuses any published version that is not exactly one above the
-- highest that workflow already has, and it evaluates that per row as the row is written. A
-- statement that offered v14 before v13 would be refused by the trigger, naming the version
-- it expected. Nulls sort last, so the draft is written after the version it was copied from,
-- which is the order a draft comes into existence in anyway.
--
-- The two documents `standard-fix` needs are CTEs rather than literals repeated inline: the
-- canvas is written once and used twice — as v14 and as the draft — so the two cannot drift
-- into disagreeing about what the studio is editing.
-- ---------------------------------------------------------------------------
with canvas (definition) as (values (
  -- schemas/workflow-dsl/fixtures/valid/standard-fix.json, verbatim. tests/seed.test.sh
  -- compares the two and fails if they differ; P.6 (#137) validates it against the schema in
  -- ci/db besides. Twelve nodes at the positions mockup 04 draws them at, twelve edges, and
  -- the last of those is the dashed loop-back from the gate to implement.
  $standard_fix_v14$
  {
    "dsl_version": "1.0",
    "trigger": {
      "event": "ticket_queued",
      "conditions": { "effort_lte": "m" }
    },
    "nodes": [
      {
        "id": "issue-queued",
        "type": "trigger",
        "title": "Issue queued",
        "description": "Runs when a sized issue with effort at most M reaches the queue.",
        "position": { "x": 24, "y": 40 },
        "config": {}
      },
      {
        "id": "analyze",
        "type": "llm",
        "title": "Understand & scope",
        "description": "Reads the issue against a map of the repository and states what the change touches.",
        "position": { "x": 306, "y": 40 },
        "config": {
          "mode": "skill",
          "skill": "repo-map",
          "prompt_template": "Scope the issue.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}\n\nName the files the change will touch and the risks you can see.",
          "routing": { "pinned_model": { "alias": "coder-std" } },
          "limits": { "max_retries": 2, "token_budget": 200000 },
          "permissions": { "push_fixup": false, "touch_ci": false }
        }
      },
      {
        "id": "effort-recheck",
        "type": "flow",
        "title": "Effort re-check",
        "description": "Re-estimates after scoping; work that grew past M is split rather than attempted.",
        "position": { "x": 588, "y": 40 },
        "config": {
          "kind": "decision",
          "predicate": { "kind": "effort", "op": "lte", "value": "m" }
        }
      },
      {
        "id": "plan",
        "type": "llm",
        "title": "Write attack plan",
        "description": "Turns the scope into an ordered plan the implement stage is held to.",
        "position": { "x": 588, "y": 230 },
        "config": {
          "mode": "prompt",
          "prompt_template": "Write the attack plan.\n\nScope: {{analyze}}\n\nOrder the steps and name every file each one touches.",
          "routing": { "pinned_model": { "alias": "coder-max" } },
          "limits": { "max_retries": 2, "token_budget": 200000 },
          "permissions": { "push_fixup": false, "touch_ci": false }
        }
      },
      {
        "id": "split",
        "type": "llm",
        "title": "Split into subtasks",
        "description": "Creates linked issues for work that is larger than this loop accepts.",
        "position": { "x": 306, "y": 230 },
        "config": {
          "mode": "prompt",
          "prompt_template": "Split the issue into subtasks no larger than M.\n\nIssue: {{issue.title}}\nScope: {{analyze}}",
          "routing": { "inherit_task": "split" },
          "limits": { "max_retries": 1, "token_budget": 120000 },
          "permissions": { "push_fixup": false, "touch_ci": false }
        }
      },
      {
        "id": "back-to-queue",
        "type": "term",
        "title": "Back to queue",
        "description": "The split subtasks are queued and this run ends.",
        "position": { "x": 32, "y": 260 },
        "config": { "action": "back_to_queue", "options": {} }
      },
      {
        "id": "implement",
        "type": "llm",
        "title": "Code the change",
        "description": "Writes the change described by the attack plan onto a fresh branch.",
        "position": { "x": 588, "y": 420 },
        "config": {
          "mode": "skill",
          "skill": "zephyr-conventions",
          "prompt_template": "Implement the approved plan.\n\nIssue: {{issue.title}}\nPlan:  {{plan}}\nRules: touch only files named in the plan; follow the skill.",
          "routing": { "inherit_task": "implement" },
          "limits": { "max_retries": 2, "token_budget": 400000 },
          "permissions": { "push_fixup": true, "touch_ci": false }
        }
      },
      {
        "id": "build",
        "type": "infra",
        "title": "Build farm · pool A",
        "description": "Builds the branch on the pool the workspace reserves for this loop.",
        "position": { "x": 306, "y": 420 },
        "config": { "runner_pool": "pool-a" }
      },
      {
        "id": "test",
        "type": "infra",
        "title": "Run test suite",
        "description": "Runs the suite the repository declares for a native build.",
        "position": { "x": 24, "y": 420 },
        "config": { "runner_pool": "pool-a", "command": "twister -p native_sim" }
      },
      {
        "id": "review",
        "type": "llm",
        "title": "Self-review diff",
        "description": "Reads its own diff against the plan before anything is offered for merge.",
        "position": { "x": 24, "y": 630 },
        "config": {
          "mode": "prompt",
          "prompt_template": "Review the diff against the plan.\n\nPlan: {{plan}}\nDiff: {{diff}}\n\nReport anything the plan did not ask for.",
          "routing": { "pinned_model": { "alias": "coder-max" } },
          "limits": { "max_retries": 1, "token_budget": 200000 },
          "permissions": { "push_fixup": true, "touch_ci": false }
        }
      },
      {
        "id": "checks-green",
        "type": "flow",
        "title": "Checks green?",
        "description": "Holds until build, test and review all pass; a failure returns to implement.",
        "position": { "x": 306, "y": 630 },
        "config": {
          "kind": "gate",
          "predicate": {
            "kind": "checks",
            "op": "all_passed",
            "names": ["build", "test", "review"]
          }
        }
      },
      {
        "id": "open-pr",
        "type": "term",
        "title": "Open PR & auto-merge",
        "description": "Opens the pull request and lets it merge itself once the required checks are green.",
        "position": { "x": 588, "y": 630 },
        "config": {
          "action": "open_pr_automerge",
          "options": { "merge_method": "squash", "delete_branch": true }
        }
      }
    ],
    "edges": [
      { "from": "issue-queued", "to": "analyze", "kind": "default" },
      { "from": "analyze", "to": "effort-recheck", "kind": "default" },
      {
        "from": "effort-recheck",
        "to": "plan",
        "kind": "branch",
        "label": "≤ M ↓",
        "condition": { "kind": "effort", "op": "lte", "value": "m" }
      },
      {
        "from": "effort-recheck",
        "to": "split",
        "kind": "branch",
        "label": "> M ↘",
        "condition": { "kind": "effort", "op": "gt", "value": "m" }
      },
      { "from": "split", "to": "back-to-queue", "kind": "default" },
      { "from": "plan", "to": "implement", "kind": "default" },
      { "from": "implement", "to": "build", "kind": "default" },
      { "from": "build", "to": "test", "kind": "default" },
      { "from": "test", "to": "review", "kind": "default" },
      { "from": "review", "to": "checks-green", "kind": "default" },
      {
        "from": "checks-green",
        "to": "open-pr",
        "kind": "branch",
        "label": "pass →",
        "condition": { "kind": "checks", "op": "all_passed" }
      },
      {
        "from": "checks-green",
        "to": "implement",
        "kind": "loop",
        "label": "fail ↺",
        "condition": { "kind": "checks", "op": "any_failed" }
      }
    ]
  }
  $standard_fix_v14$::jsonb
)),
     predecessor (definition) as (values (
  -- The six-node loop `standard-fix` ran for thirteen versions, and the document mockup 04's
  -- `6 stages` caption is true of — see the header. `nodes[3]` is the implement stage, which
  -- is the path `jsonb_set` below writes the version's token budget into; the literal here is
  -- v1's, so the document is a valid one on its own and the budget is the only thing a
  -- version changes.
  $standard_fix_v1$
  {
    "dsl_version": "1.0",
    "trigger": {
      "event": "ticket_queued",
      "conditions": { "effort_lte": "m" }
    },
    "nodes": [
      {
        "id": "issue-queued",
        "type": "trigger",
        "title": "Issue queued",
        "description": "Runs when a sized issue with effort at most M reaches the queue.",
        "position": { "x": 24, "y": 40 },
        "config": {}
      },
      {
        "id": "analyze",
        "type": "llm",
        "title": "Understand & scope",
        "description": "Reads the issue against a map of the repository and states what the change touches.",
        "position": { "x": 306, "y": 40 },
        "config": {
          "mode": "skill",
          "skill": "repo-map",
          "prompt_template": "Scope the issue.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}\n\nName the files the change will touch and the risks you can see.",
          "routing": { "pinned_model": { "alias": "coder-std" } },
          "limits": { "max_retries": 2, "token_budget": 200000 },
          "permissions": { "push_fixup": false, "touch_ci": false }
        }
      },
      {
        "id": "plan",
        "type": "llm",
        "title": "Write attack plan",
        "description": "Turns the scope into an ordered plan the implement stage is held to.",
        "position": { "x": 588, "y": 40 },
        "config": {
          "mode": "prompt",
          "prompt_template": "Write the attack plan.\n\nScope: {{analyze}}\n\nOrder the steps and name every file each one touches.",
          "routing": { "pinned_model": { "alias": "coder-max" } },
          "limits": { "max_retries": 2, "token_budget": 200000 },
          "permissions": { "push_fixup": false, "touch_ci": false }
        }
      },
      {
        "id": "implement",
        "type": "llm",
        "title": "Code the change",
        "description": "Writes the change described by the attack plan onto a fresh branch.",
        "position": { "x": 588, "y": 230 },
        "config": {
          "mode": "skill",
          "skill": "zephyr-conventions",
          "prompt_template": "Implement the approved plan.\n\nIssue: {{issue.title}}\nPlan:  {{plan}}\nRules: touch only files named in the plan; follow the skill.",
          "routing": { "inherit_task": "implement" },
          "limits": { "max_retries": 2, "token_budget": 140000 },
          "permissions": { "push_fixup": true, "touch_ci": false }
        }
      },
      {
        "id": "build",
        "type": "infra",
        "title": "Build farm · pool A",
        "description": "Builds the branch on the pool the workspace reserves for this loop.",
        "position": { "x": 306, "y": 230 },
        "config": { "runner_pool": "pool-a" }
      },
      {
        "id": "open-pr",
        "type": "term",
        "title": "Open PR & auto-merge",
        "description": "Opens the pull request and lets it merge itself once the required checks are green.",
        "position": { "x": 24, "y": 230 },
        "config": {
          "action": "open_pr_automerge",
          "options": { "merge_method": "squash", "delete_branch": true }
        }
      }
    ],
    "edges": [
      { "from": "issue-queued", "to": "analyze", "kind": "default" },
      { "from": "analyze", "to": "plan", "kind": "default" },
      { "from": "plan", "to": "implement", "kind": "default" },
      { "from": "implement", "to": "build", "kind": "default" },
      { "from": "build", "to": "open-pr", "kind": "default" }
    ]
  }
  $standard_fix_v1$::jsonb
))
insert into ouroboros.workflow_versions
    (id, workflow_id, version, definition, published_at, published_by, change_note,
     created_at, updated_at)
select ('5eed001c-0000-4000-8000-' || lpad(seed.ordinal::text, 2, '0')
                                   || lpad(coalesce(seed.version, 0)::text, 10, '0'))::uuid,
       wf.id, seed.version, seed.definition,
       -- Null exactly while `version` is null, which is what makes the draft the draft
       -- (`workflow_versions_version_publish_stamp`).
       case when seed.version is null then null else seed.stamp end,
       publisher."id", seed.change_note,
       seed.stamp,
       -- A published version's last-edited time is where publishing left it; the draft's is
       -- the mockup's *Last edited 2h ago*. The touch trigger fires on update only, so both
       -- are written here.
       seed.stamp
  from (
         -- v1–v13 of `standard-fix`: the predecessor, with the one change each version made.
         select 1, 'standard-fix', n,
                jsonb_set(predecessor.definition,
                          '{nodes,3,config,limits,token_budget}',
                          to_jsonb(120000 + n * 20000)),
                now() - make_interval(days => 3 + (14 - n) * 9),
                -- v1 is the template import, and has no publisher. See the header.
                case when n = 1      then null
                     when n in (5, 10) then 'maya@acme-robotics.dev'
                     else                   'ken@acme-robotics.dev' end,
                case when n = 1 then 'Imported from the standard-fix template.'
                     else 'Raise the implement stage''s token budget to '
                          || ((120000 + n * 20000) / 1000)::text || 'k.' end
           from generate_series(1, 13) as n
           cross join predecessor

         union all

         -- v14: the canvas mockup 04 draws, and the version in force.
         select 1, 'standard-fix', 14, canvas.definition,
                now() - make_interval(days => 3),
                'ken@acme-robotics.dev',
                'Add the effort re-check branch and the split path back to the queue, the '
                || 'test and self-review stages, and the checks gate that loops back to '
                || 'implement. Raise the implement budget to 400k.'
           from canvas

         union all

         -- The draft: v14's document, untouched, opened two hours ago. The row that makes the
         -- page head's *Last edited 2h ago* and **Publish v15** true at the same time.
         select 1, 'standard-fix', null::integer, canvas.definition,
                now() - make_interval(hours => 2),
                null, null
           from canvas

         union all
         -- `feature-loop` — seven stages, the rail's `7 stages · auto-merge`. The longer loop
         -- larger work takes: it designs before it plans, and its gate loops back to implement
         -- rather than handing the work anywhere.
         select 2, 'feature-loop', 1,
                $feature_loop_v1$
                {
                  "dsl_version": "1.0",
                  "trigger": {
                    "event": "ticket_queued",
                    "conditions": { "labels": ["enhancement"] }
                  },
                  "nodes": [
                    {
                      "id": "issue-queued",
                      "type": "trigger",
                      "title": "Issue queued",
                      "description": "Runs when an issue labelled enhancement reaches the queue, at any size.",
                      "position": { "x": 24, "y": 40 },
                      "config": {}
                    },
                    {
                      "id": "design",
                      "type": "llm",
                      "title": "Design the change",
                      "description": "States what the feature does, where it lives, and what it must not break.",
                      "position": { "x": 306, "y": 40 },
                      "config": {
                        "mode": "skill",
                        "skill": "repo-map",
                        "prompt_template": "Design the feature.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}\n\nName the interfaces it adds and the callers it changes.",
                        "routing": { "inherit_task": "analyze" },
                        "limits": { "max_retries": 2, "token_budget": 250000 },
                        "permissions": { "push_fixup": false, "touch_ci": false }
                      }
                    },
                    {
                      "id": "plan",
                      "type": "llm",
                      "title": "Write the build plan",
                      "description": "Orders the design into steps small enough to build and review one at a time.",
                      "position": { "x": 588, "y": 40 },
                      "config": {
                        "mode": "prompt",
                        "prompt_template": "Write the build plan.\n\nDesign: {{design}}\n\nOrder the steps and name every file each one touches.",
                        "routing": { "inherit_task": "plan" },
                        "limits": { "max_retries": 2, "token_budget": 250000 },
                        "permissions": { "push_fixup": false, "touch_ci": false }
                      }
                    },
                    {
                      "id": "implement",
                      "type": "llm",
                      "title": "Code the change",
                      "description": "Builds the plan step by step onto a fresh branch.",
                      "position": { "x": 588, "y": 230 },
                      "config": {
                        "mode": "skill",
                        "skill": "zephyr-conventions",
                        "prompt_template": "Build the next step of the plan.\n\nPlan: {{plan}}\nRules: touch only files named in the plan; follow the skill.",
                        "routing": { "inherit_task": "implement" },
                        "limits": { "max_retries": 3, "token_budget": 400000 },
                        "permissions": { "push_fixup": true, "touch_ci": false }
                      }
                    },
                    {
                      "id": "build",
                      "type": "infra",
                      "title": "Build farm · pool A",
                      "description": "Builds and tests the branch on the pool the workspace reserves for this loop.",
                      "position": { "x": 306, "y": 230 },
                      "config": { "runner_pool": "pool-a", "command": "twister -p native_sim" }
                    },
                    {
                      "id": "checks-green",
                      "type": "flow",
                      "title": "Checks green?",
                      "description": "Holds until the build passes; a failure returns to implement.",
                      "position": { "x": 24, "y": 230 },
                      "config": {
                        "kind": "gate",
                        "predicate": { "kind": "checks", "op": "all_passed", "names": ["build"] }
                      }
                    },
                    {
                      "id": "open-pr",
                      "type": "term",
                      "title": "Open PR & auto-merge",
                      "description": "Opens the pull request and lets it merge itself once the required checks are green.",
                      "position": { "x": 24, "y": 420 },
                      "config": {
                        "action": "open_pr_automerge",
                        "options": { "merge_method": "squash", "delete_branch": true }
                      }
                    }
                  ],
                  "edges": [
                    { "from": "issue-queued", "to": "design", "kind": "default" },
                    { "from": "design", "to": "plan", "kind": "default" },
                    { "from": "plan", "to": "implement", "kind": "default" },
                    { "from": "implement", "to": "build", "kind": "default" },
                    { "from": "build", "to": "checks-green", "kind": "default" },
                    {
                      "from": "checks-green",
                      "to": "open-pr",
                      "kind": "branch",
                      "label": "pass →",
                      "condition": { "kind": "checks", "op": "all_passed" }
                    },
                    {
                      "from": "checks-green",
                      "to": "implement",
                      "kind": "loop",
                      "label": "fail ↺",
                      "condition": { "kind": "checks", "op": "any_failed" }
                    }
                  ]
                }
                $feature_loop_v1$::jsonb,
                now() - make_interval(days => 96),
                'maya@acme-robotics.dev',
                'First publish of the feature loop.'

         union all
         -- `deps-refresh` — five stages, and the rail's one `needs review` caption. It is the
         -- loop that deliberately does **not** merge its own work: a dependency bump that
         -- builds and tests green still wants a person to look at it, which is what
         -- `needs_review` means and why this fixture exists.
         select 3, 'deps-refresh', 1,
                $deps_refresh_v1$
                {
                  "dsl_version": "1.0",
                  "trigger": {
                    "event": "ticket_queued",
                    "conditions": { "labels": ["dependencies", "tech-debt"] }
                  },
                  "nodes": [
                    {
                      "id": "issue-queued",
                      "type": "trigger",
                      "title": "Issue queued",
                      "description": "Runs when a dependency or tech-debt issue reaches the queue.",
                      "position": { "x": 24, "y": 40 },
                      "config": {}
                    },
                    {
                      "id": "bump",
                      "type": "llm",
                      "title": "Bump and migrate",
                      "description": "Moves the pin and follows the upstream migration notes through the call sites.",
                      "position": { "x": 306, "y": 40 },
                      "config": {
                        "mode": "prompt",
                        "prompt_template": "Bump the dependency the issue names and migrate the call sites.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}\n\nChange nothing the upgrade does not require.",
                        "routing": { "inherit_task": "implement" },
                        "limits": { "max_retries": 2, "token_budget": 300000 },
                        "permissions": { "push_fixup": true, "touch_ci": true }
                      }
                    },
                    {
                      "id": "build",
                      "type": "infra",
                      "title": "Build farm · pool A",
                      "description": "Builds every board the manifest names against the new pin.",
                      "position": { "x": 588, "y": 40 },
                      "config": { "runner_pool": "pool-a" }
                    },
                    {
                      "id": "test",
                      "type": "infra",
                      "title": "Run test suite",
                      "description": "Runs the suite the repository declares for a native build.",
                      "position": { "x": 588, "y": 230 },
                      "config": { "runner_pool": "pool-a", "command": "twister -p native_sim" }
                    },
                    {
                      "id": "hand-off",
                      "type": "term",
                      "title": "Hand to a reviewer",
                      "description": "A dependency move is opened for a person to read, never merged by the loop.",
                      "position": { "x": 306, "y": 230 },
                      "config": { "action": "needs_review", "options": {} }
                    }
                  ],
                  "edges": [
                    { "from": "issue-queued", "to": "bump", "kind": "default" },
                    { "from": "bump", "to": "build", "kind": "default" },
                    { "from": "build", "to": "test", "kind": "default" },
                    { "from": "test", "to": "hand-off", "kind": "default" }
                  ]
                }
                $deps_refresh_v1$::jsonb,
                now() - make_interval(days => 72),
                'ken@acme-robotics.dev',
                'First publish of the dependency refresh loop.'

         union all

         -- `docs-loop` — four stages, the shortest loop on the rail. The only workflow whose
         -- trigger carries two conditions, which is what makes the `conditions` object's
         -- "all of them must hold" reading something the fixture exercises.
         select 4, 'docs-loop', 1,
                $docs_loop_v1$
                {
                  "dsl_version": "1.0",
                  "trigger": {
                    "event": "ticket_queued",
                    "conditions": { "effort_lte": "s", "labels": ["docs"] }
                  },
                  "nodes": [
                    {
                      "id": "issue-queued",
                      "type": "trigger",
                      "title": "Issue queued",
                      "description": "Runs when a small documentation issue reaches the queue.",
                      "position": { "x": 24, "y": 40 },
                      "config": {}
                    },
                    {
                      "id": "write",
                      "type": "llm",
                      "title": "Write the change",
                      "description": "Makes the documentation change the issue asks for, and nothing beside it.",
                      "position": { "x": 306, "y": 40 },
                      "config": {
                        "mode": "prompt",
                        "prompt_template": "Make the documentation change.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}\n\nTouch no code, and keep the existing voice.",
                        "routing": { "inherit_task": "docs" },
                        "limits": { "max_retries": 1, "token_budget": 120000 },
                        "permissions": { "push_fixup": true, "touch_ci": false }
                      }
                    },
                    {
                      "id": "prose-lint",
                      "type": "infra",
                      "title": "Prose lint",
                      "description": "Runs the style and link checks the repository declares for its documentation.",
                      "position": { "x": 588, "y": 40 },
                      "config": { "runner_pool": "pool-b", "command": "vale docs/" }
                    },
                    {
                      "id": "open-pr",
                      "type": "term",
                      "title": "Open PR & auto-merge",
                      "description": "Opens the pull request and lets it merge itself once the required checks are green.",
                      "position": { "x": 588, "y": 230 },
                      "config": {
                        "action": "open_pr_automerge",
                        "options": { "merge_method": "squash", "delete_branch": true }
                      }
                    }
                  ],
                  "edges": [
                    { "from": "issue-queued", "to": "write", "kind": "default" },
                    { "from": "write", "to": "prose-lint", "kind": "default" },
                    { "from": "prose-lint", "to": "open-pr", "kind": "default" }
                  ]
                }
                $docs_loop_v1$::jsonb,
                now() - make_interval(days => 54),
                'jorge@acme-robotics.dev',
                'First publish of the documentation loop.'

         union all
         -- `hotfix-p0` — five stages, and the workflow the rail draws an err-dot beside. Its
         -- document is published and complete; what makes it `5 stages · paused` is the
         -- entity's `status`, one statement above, and nothing in here. That separation is the
         -- point of the fixture: a paused workflow is a switched-off one, not a broken one.
         --
         -- Its trigger **overlaps `standard-fix`'s on purpose**: `priority-high` is one of the
         -- labels the intake seed puts on `#485`, so two of this workspace's workflows would
         -- accept that ticket and only one of them is switched on. R.1's rule — that a trigger
         -- is evaluated for `active` workflows, which is the same rule P.4's registry applies
         -- to the assign menu — therefore has a fixture where it decides something, rather
         -- than one where every ticket happens to match a single workflow.
         select 5, 'hotfix-p0', 1,
                $hotfix_p0_v1$
                {
                  "dsl_version": "1.0",
                  "trigger": {
                    "event": "ticket_queued",
                    "conditions": { "labels": ["p0", "priority-high"] }
                  },
                  "nodes": [
                    {
                      "id": "issue-queued",
                      "type": "trigger",
                      "title": "Issue queued",
                      "description": "Runs when an incident issue reaches the queue, at any size.",
                      "position": { "x": 24, "y": 40 },
                      "config": {}
                    },
                    {
                      "id": "patch",
                      "type": "llm",
                      "title": "Write the hotfix",
                      "description": "Writes the smallest change that stops the incident, and leaves the cleanup to a follow-up.",
                      "position": { "x": 306, "y": 40 },
                      "config": {
                        "mode": "skill",
                        "skill": "zephyr-conventions",
                        "prompt_template": "Write the smallest change that stops this incident.\n\nIssue: {{issue.title}}\nBody:  {{issue.body}}\n\nRefactor nothing; follow the skill.",
                        "routing": { "inherit_task": "implement" },
                        "limits": { "max_retries": 1, "token_budget": 250000 },
                        "permissions": { "push_fixup": true, "touch_ci": false }
                      }
                    },
                    {
                      "id": "smoke",
                      "type": "infra",
                      "title": "Run the smoke suite",
                      "description": "Runs the short suite an incident fix has to pass before anybody looks at it.",
                      "position": { "x": 588, "y": 40 },
                      "config": { "runner_pool": "pool-a", "command": "twister -p native_sim -T tests/smoke" }
                    },
                    {
                      "id": "checks-green",
                      "type": "flow",
                      "title": "Smoke green?",
                      "description": "Holds until the smoke suite passes; a failure returns to the patch stage.",
                      "position": { "x": 588, "y": 230 },
                      "config": {
                        "kind": "gate",
                        "predicate": { "kind": "checks", "op": "all_passed", "names": ["smoke"] }
                      }
                    },
                    {
                      "id": "open-pr",
                      "type": "term",
                      "title": "Open PR & auto-merge",
                      "description": "Opens the pull request and merges it whole, so the incident fix stays one commit.",
                      "position": { "x": 306, "y": 230 },
                      "config": {
                        "action": "open_pr_automerge",
                        "options": { "merge_method": "merge", "delete_branch": false }
                      }
                    }
                  ],
                  "edges": [
                    { "from": "issue-queued", "to": "patch", "kind": "default" },
                    { "from": "patch", "to": "smoke", "kind": "default" },
                    { "from": "smoke", "to": "checks-green", "kind": "default" },
                    {
                      "from": "checks-green",
                      "to": "open-pr",
                      "kind": "branch",
                      "label": "pass →",
                      "condition": { "kind": "checks", "op": "all_passed" }
                    },
                    {
                      "from": "checks-green",
                      "to": "patch",
                      "kind": "loop",
                      "label": "fail ↺",
                      "condition": { "kind": "checks", "op": "any_failed" }
                    }
                  ]
                }
                $hotfix_p0_v1$::jsonb,
                now() - make_interval(days => 27),
                'ken@acme-robotics.dev',
                'First publish of the incident loop.'
       ) as seed (ordinal, slug, version, definition, stamp, publisher_email, change_note)
  join ouroboros.organization org on org."slug" = 'acme-robotics'
  join ouroboros.workflows    wf  on wf.organization_id = org."id" and wf.slug = seed.slug
  -- Left, not inner: v1 of `standard-fix` names no publisher, and an inner join would drop
  -- the row rather than record that nobody pressed the button.
  left join ouroboros."user" publisher on publisher."email" = seed.publisher_email
 -- **`on conflict do nothing` is not enough on its own here**, and that is worth stating
 -- rather than discovering: `workflow_version_next` is a BEFORE trigger, so on a second
 -- application it raises — *"the next version of workflow … is v2, not v1"* — before
 -- PostgreSQL ever looks at the conflicting key. R__dev_seed_intake.sql needs exactly this
 -- guard against `issue_estimates_version_monotonic` and for exactly this reason.
 --
 -- Written as *"a version at or above this one already exists"* rather than as *"this id
 -- exists"*, which is what also makes it converge on a hand-edited database: a workflow whose
 -- history somebody truncated to v5 gets v6 onwards written, each one the next number, rather
 -- than a statement that fails on the first row it offers. Nulls are the draft, and the second
 -- disjunct is that row's version of the same question.
 where not exists (select 1
                     from ouroboros.workflow_versions prior
                    where prior.workflow_id = wf.id
                      and (prior.version >= seed.version
                           or (seed.version is null and prior.version is null)))
   and ${ouro_dev_seed}
 order by seed.slug, seed.version
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The pointers — the `v14` chip, and the four that read `v1`.
--
-- The third statement, and the only `update` in any seed in this module. See the header for
-- why it cannot be folded into the first one: `workflows.current_version` references
-- `workflow_versions (workflow_id, version)`, so the version has to exist before the pointer
-- can name it.
--
-- `is distinct from` is what makes this idempotent in the sense the other seeds get from
-- `on conflict do nothing`: on a second application every row already holds its number, no
-- row matches, and `workflows_touch_updated_at` — which stamps from the server clock and
-- ignores whatever a statement supplies — never fires.
--
-- It is deliberately **not** `max(version)`. V029 is emphatic that the pointer is a pointer
-- and not a cache of the highest number, so the seed states which version is in force the
-- same way a rollback would: by writing the number.
-- ---------------------------------------------------------------------------
update ouroboros.workflows wf
   set current_version = seed.current_version
  from (values
         (1, 'standard-fix', 14),
         (2, 'feature-loop',  1),
         (3, 'deps-refresh',  1),
         (4, 'docs-loop',     1),
         (5, 'hotfix-p0',     1)
       ) as seed (ordinal, slug, current_version),
       ouroboros.organization org
 where org."slug" = 'acme-robotics'
   and wf.organization_id = org."id"
   and wf.slug = seed.slug
   and wf.current_version is distinct from seed.current_version
   and ${ouro_dev_seed};
