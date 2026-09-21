-- V048__run_guardrails_and_controls.sql — `guardrail_evaluations`, the verdicts that carry
-- evidence but never the thing the evidence is about, and `run_controls`, the durable
-- ack-tracked queue behind *Pause loop*, *Abort run* and the steering box.
--
-- Mockup 10 (docs/mockups/10-run-detail.html) draws both. The card, bottom of the right-hand
-- column:
--
--     GUARDRAILS                                        ● clean
--       ✓ Diff confined to allowed paths
--       ✓ No CI config touched
--       ✓ Secrets scan clean
--       ○ Human review not required (auto-merge eligible)
--       ──────────────────────────────────────────────────────
--       Policy: standard-fix v14 · tenant acme-robotics
--
-- and the controls, in the page head and under the transcript:
--
--     [ Pause loop ]  [ Abort run ]
--     ┌──────────────────────────────────────────────────────┐  [ Send ]
--     │ Steer the loop — e.g. "prefer a fix inside the ISR…" │
--     └──────────────────────────────────────────────────────┘
--
-- Filed as issue #301 (AO.4), the fourth issue of the Run Console roadmap
-- (docs/ROADMAP_MOCKUP_10_RUN_CONSOLE.md). It needs AO.1 (#298) for `runs`' console columns
-- and AD.4 (#225) for the audit shape every control write lands in.
--
-- Two tables, and each of them is defined by a failure mode rather than by a card.
--
--
-- ---------------------------------------------------------------------------
-- **R5 — a verdict is only useful with evidence, and evidence is where a secret gets
-- written into a database.**
-- ---------------------------------------------------------------------------
--
-- *"Secrets scan: fail"* tells somebody there is a problem and nothing whatever about where.
-- *"Fail — `drivers/can/telemetry_buf.c:214`, rule `aws-access-key-id`"* tells them what to
-- do. So the verdicts carry evidence, and the obvious way to make that evidence useful is to
-- include the text that matched — which would write a live credential into this database, into
-- every backup of it, and into every log line that ever renders the row.
--
-- Roadmap decision **R5** is therefore a hard rule: **evidence carries the location and the
-- rule id, never the value.** This file enforces it with constraints rather than with a
-- convention, in three layers, because each one covers what the one before it cannot:
--
--   1. **A closed key set.** `evidence` may hold `path`, `line`, `rule_id`, `glob` and
--      `detail`, and nothing else — so there is no `value`, no `match`, no `secret` and no
--      `matched_text` for a writer to reach for. Expressed as `evidence - <the five> = '{}'`,
--      which is a pure jsonb operator and therefore legal in a CHECK where the natural
--      `not exists (select … jsonb_object_keys …)` is not.
--
--   2. **A type and a shape per key**, because a key named `path` with no shape is a free-text
--      field with a misleading name. `line` is a *number*; `rule_id` is a lower-case
--      hyphenated identifier from the ruleset's own vocabulary; `path` is repository-relative
--      and segment-clean, the same grammar `run_files.path` (V047) is held to, because these
--      two columns name the same files.
--
--   3. **No opaque token in any string value.** The layer that catches the case the first two
--      cannot: a credential pasted into `detail`, which is the one key whose job is prose.
--
-- The third needs its argument stated, because V022's header rejects the thing it looks like.
-- V022 refuses to pattern-match credentials in `audit_events.detail`, and it is right to: a
-- catalogue of the credential shapes somebody thought of is a test that passes for every
-- provider nobody thought of. **This is the opposite rule.** It does not describe secrets at
-- all; it describes *evidence*, which is a much narrower thing. Evidence names a place and a
-- rule — paths have separators and extensions, rule ids are short and hyphenated, globs have
-- slashes and stars, details are sentences with spaces in them. **None of those contains an
-- unbroken twenty-character run of letters and digits.** Every credential does, because a
-- credential that did not would be guessable. So the rule is a statement about what belongs in
-- this column, and it holds for the provider nobody has thought of precisely because it never
-- mentions one.
--
-- The token's alphabet is `[A-Za-z0-9+=]`, so `/`, `.`, `-`, `_` and whitespace all break a
-- run: `tests/telemetry/test_frame_order.c` is four short tokens and
-- `forge_16C7e42F292c6912E7710c838347Ae178B4a` is one long one. Twenty is the length of an AWS
-- access key id, which makes it the shortest thing anybody needs this to catch.
--
-- **What the three layers do not do**, said here rather than discovered later: they keep a
-- secret out of the *table*, and they cannot keep it out of the *refusal*. PostgreSQL reports a
-- check violation with `DETAIL: Failing row contains (…)`, so a writer that tried to store a
-- credential has sent one to its own error log on the way to being refused. That is worth
-- knowing and is not worth softening the constraint for: the row is the thing that is kept,
-- indexed, backed up and rendered, and an error is the thing an operator sees once and a
-- writer fixes. The defence against the payload ever being built is #305's, where V022 puts
-- it — these constraints are what makes a mistake there loud instead of permanent.
--
-- **Re-evaluation, and why the history stays.** A run reports its change-set many times
-- (V047's upsert), and each report re-runs the four checks. The card shows the **latest**
-- verdict per check; the rows are never replaced, so the sequence *fail → fixed → pass* is
-- recoverable afterwards, which is the sequence somebody asks about. `v_run_guardrails_latest`
-- is the card's read and the table is the record.
--
--
-- ---------------------------------------------------------------------------
-- **R6 — a control that disappears is worse than no control.**
-- ---------------------------------------------------------------------------
--
-- The moment somebody needs *Abort run* is the moment the executor is busy, wedged, or
-- half-way through a tool call — which is precisely when a fire-and-forget RPC fails. So
-- decision **R6** puts controls on a durable queue with acknowledgments. The row records what
-- was asked, whether it was delivered, whether the executor acked it and with what effect, and
-- whether it expired unanswered, so the console can say *"acknowledged — paused"* and *"no
-- response"* and mean both rather than rendering the two the same way.
--
--     [*] --> pending: POST /controls
--     pending   --> delivered: executor fetch / push
--     delivered --> acked: ack + effect detail
--     delivered --> expired: TTL elapsed
--     pending   --> expired: TTL elapsed
--     pending   --> rejected: policy / state refusal
--
-- That machine is enforced here rather than in the service, because a state machine kept by
-- one writer is a state machine the second writer does not know about. `run_controls_transition()`
-- refuses every edge the diagram does not draw, and refuses **any** change to a row that has
-- reached `acked`, `expired` or `rejected` — a terminal state is terminal.
--
-- **TTL** is `expires_at`, set at insert and swept to `expired` by a plain indexed query. The
-- sweep is deliberately not a scheduler, a `pg_cron` job or a background worker: those are
-- deployment questions, and a schema that answered them would be a schema with an operational
-- dependency in it. What this file owes the sweep is that it can be written as one statement
-- that touches only the rows it changes — `run_controls_expiry_idx` is that, a partial index
-- carrying `expires_at` and `id` over the two states a sweep can find work in, which an
-- index-only scan answers.
--
-- **Audit.** Every control write lands in `audit_events` in AD.4's shape, by trigger.
--
--   * **This amends V022's *"nothing writes this table from SQL"*,** knowingly. That sentence
--     was written when `ouroboros-rest`'s `AuditService` was the only writer and the events
--     were about credentials. A control is different in one way that matters: the acceptance
--     criterion is *an audit row exists for every control*, and a rule the schema keeps cannot
--     be forgotten by the next writer — the sweep, a support script, AP.4's delivery loop.
--     `AuditService` remains the only writer of every other family of event.
--
--   * **The body cannot contain the steer text.** It is built from four fields — the run, the
--     kind, the state, and `has_payload`, a *boolean* — so *"a steer was requested and it
--     carried text"* is recorded and the text itself has nowhere to go. Not a redaction pass
--     over a free-form document, which is a thing that can be got wrong; there is simply no
--     string field in the object. `ack_detail` is deliberately absent from it too: it is the
--     executor's own sentence, and the one place a well-meaning writer could echo the steering
--     back.
--
--   * **The actor is the requester on the request and nobody on the transitions.** A delivery,
--     an ack and an expiry are not things a person did, and naming the requester as the actor
--     of an event they did not cause would be inventing one — V022's rule for
--     `credential.lease_granted`, for its reason. Who asked stays answerable through
--     `subject_id`, which is the control's own row.
--
-- Two names in this file are the issue's rather than this schema's, and both are kept
-- deliberately.
--
-- `v_run_guardrails_latest` carries a `v_` prefix no other view here does — `runs_with_stage`,
-- `run_stage_current`, `token_usage_daily`. The tidier name would have been
-- `run_guardrails_latest`, and it is not worth a name that differs from the one the issue, the
-- service ticket (#305) and the card ticket (#313) were all written against: a view is found by
-- the name somebody searches for.
--
-- House snake_case otherwise — decision A4 — with the one quoted identifier this schema has
-- had to add for itself: `"check"`. The issue and the roadmap both name the column `check`,
-- which is a reserved word, so it is quoted here and everywhere it is read. Renaming it would
-- have been the tidier schema and the wrong one: the four values are a vocabulary the API, the
-- service and the card all say out loud, and a column whose name differs from the word
-- everybody uses is a translation somebody has to remember.

-- ---------------------------------------------------------------------------
-- guardrail_evaluations — one verdict, with its evidence, as of one evaluation.
-- ---------------------------------------------------------------------------
create table ouroboros.guardrail_evaluations (
  id              uuid        primary key default gen_random_uuid(),

  -- The run these checks were run against, and — V045's and V047's choice — the whole of this
  -- row's tenancy: a verdict has no meaning apart from the run it judged, and every read
  -- enters through a run. Cascade, because a verdict about work nobody can reach is not a
  -- verdict.
  run_id          uuid        not null
                              references ouroboros.runs (id) on delete cascade,

  -- **Which of the four checks this is.** The card draws one row per value, in this order, and
  -- the vocabulary is closed because the card has a sentence for each of them and none for a
  -- fifth. Quoted: see the header.
  "check"         text        not null,

  -- **What it decided.** `pass` and `fail` are the two the tick and the cross render;
  -- `not_applicable` is the mockup's `○` — *Human review not required (auto-merge eligible)* —
  -- which is a **third** answer rather than a pass, because *this did not apply to you* and
  -- *you were checked and were fine* are different things to tell somebody; and `pending` is a
  -- check that has been scheduled and has not answered yet, which is what the card draws while
  -- a change-set is being evaluated.
  verdict         text        not null,

  -- **Where, and by which rule — never what.** See the header for the three layers below and
  -- the argument for the third. Null is *nothing to show*: a `pass` usually has no evidence,
  -- because there is no offending path to name.
  evidence        jsonb,

  -- The version of the ruleset that produced this verdict — `v3` for the secrets ruleset
  -- (option 3-A). What makes a re-run comparable: *the same diff under a newer ruleset* is the
  -- explanation for a verdict that changed without the code changing, and without this column
  -- it is an explanation nobody can check.
  --
  -- Null where the check has no ruleset of its own: `review_required` is read from the pinned
  -- workflow's policy and the routing votes, and `allowed_paths` from the stage permissions
  -- (WF-P.9) — both of which `policy_ref` already versions.
  ruleset_version text,

  -- **The pinned workflow version the policy was read from** — the `14` of the card's
  -- *standard-fix v14*, numbered as `workflow_versions.version` numbers them and as
  -- `runs.workflow_version_pin` (V045) holds it.
  --
  -- A second copy of the run's pin, and the one place in this schema that is the right call: a
  -- verdict is answerable for the policy **it applied**, and reading the run's pin at render
  -- time would answer a question about the run when the question was about the evaluation. The
  -- two agree in the ordinary case and the disagreement is the interesting row — a verdict
  -- evaluated before a correction to the pin, which is a thing that can happen before a run
  -- starts.
  --
  -- The slug half stays on the run (`workflow_tag`, opaque by decision F8), so the card's
  -- footer is composed from the two and this column is not a second copy of the name.
  policy_ref      integer,

  -- When the checks ran. The card's *latest* is this column's `max`, and there is no
  -- `created_at` beside it: an evaluation is written once, at the moment it was made, so the
  -- row's clock and the evaluation's clock are one instant named once — V047's argument at
  -- `run_files.last_reported_at`.
  evaluated_at    timestamptz not null default now(),

  -- **Which report of the change-set was judged.** An executor reports its diff repeatedly
  -- (V047), and each report re-runs these checks; this is the report's own number, so the
  -- history reads as a sequence rather than as a pile.
  --
  -- Null when the evaluation was not of a numbered report — `review_required` is a policy
  -- question that can be answered before a run has changed a file, and a `1` there would be a
  -- report that never happened. The view orders it `nulls last` for exactly that reason.
  change_set_seq  integer,

  -- --- the two vocabularies -----------------------------------------------------
  constraint guardrail_evaluations_check
    check ("check" in ('allowed_paths', 'ci_config', 'secrets', 'review_required')),

  constraint guardrail_evaluations_verdict
    check (verdict in ('pass', 'fail', 'not_applicable', 'pending')),

  -- --- evidence, layer one: a closed key set ------------------------------------
  --
  -- An object first, on V022's argument at `audit_events.detail`: a reader — and the test
  -- below — can enumerate the keys of an object, and cannot enumerate the keys of a bare
  -- string somebody stored instead.
  constraint guardrail_evaluations_evidence_is_object
    check (evidence is null or jsonb_typeof(evidence) = 'object'),

  -- And then the set itself. There is no field a secret value could be placed in, and this is
  -- the constraint that says so: `evidence - array[…]` deletes every permitted key, what is
  -- left is what the writer invented, and the only acceptable remainder is nothing at all.
  --
  -- Written as an operator rather than as `not exists (select 1 from jsonb_object_keys(…))`
  -- because a CHECK may not contain a subquery, and `jsonb_delete(jsonb, text[])` is immutable,
  -- which a CHECK requires.
  --
  -- A `case` rather than an `or`, because `jsonb - text[]` raises *"cannot delete from scalar"*
  -- on a bare string — a runtime error rather than a constraint violation, and therefore not
  -- the refusal a caller can catch. `case` guarantees the branch is not evaluated; a
  -- short-circuiting `or` is the planner's courtesy rather than the language's promise.
  -- `guardrail_evaluations_evidence_is_object` is what rejects the scalar.
  constraint guardrail_evaluations_evidence_closed_keys
    check (case
             when evidence is null or jsonb_typeof(evidence) <> 'object' then true
             else evidence - array['path', 'line', 'rule_id', 'glob', 'detail'] = '{}'::jsonb
           end),

  -- --- evidence, layer two: a type and a shape per key --------------------------
  --
  -- A key named `path` with no shape is a free-text field with a misleading name, so each of
  -- the five is held to what it claims to be. `line` is the clearest of them: it is a *number*,
  -- and a number is a place a credential cannot go at all.
  constraint guardrail_evaluations_evidence_types
    check (evidence is null
           or (coalesce(jsonb_typeof(evidence -> 'path'),    'string') = 'string'
           and coalesce(jsonb_typeof(evidence -> 'rule_id'), 'string') = 'string'
           and coalesce(jsonb_typeof(evidence -> 'glob'),    'string') = 'string'
           and coalesce(jsonb_typeof(evidence -> 'detail'),  'string') = 'string'
           and coalesce(jsonb_typeof(evidence -> 'line'),    'number') = 'number')),

  -- A line number counts from 1, and is a whole number of them.
  --
  -- Guarded by the same `case` the closed-key rule uses, and for a sharper reason than
  -- evaluation safety: **only one constraint should be able to refuse a given row**, or the
  -- name a test asserts on becomes whichever of two PostgreSQL happened to evaluate first. A
  -- credential planted in `line` is a *type* error, and this rule stands aside so it is
  -- reported as one.
  constraint guardrail_evaluations_evidence_line_positive
    check (case
             when evidence is null or jsonb_typeof(evidence -> 'line') <> 'number' then true
             else (evidence ->> 'line') ~ '^[0-9]+$' and (evidence ->> 'line')::bigint >= 1
           end),

  -- The same grammar V047 holds `run_files.path` to, because the two columns name the same
  -- files: repository-relative, forward slashes, no leading one, no `..` segment. A rule
  -- written for `drivers/` is not a rule anybody wrote for `/drivers/`, and evidence that named
  -- the file differently from the change-set row would be evidence nobody could join.
  constraint guardrail_evaluations_evidence_path_shape
    check (evidence is null
           or evidence ->> 'path' is null
           or (btrim(evidence ->> 'path') = evidence ->> 'path'
               and evidence ->> 'path' <> ''
               and length(evidence ->> 'path') <= 1024
               and evidence ->> 'path' !~ '^/'
               and evidence ->> 'path' !~ '(^|/)\.\.(/|$)')),

  -- A rule id is a name out of the ruleset's own vocabulary — `aws-access-key-id` — not a
  -- sentence and not a payload. Lower-case hyphenated, bounded, so one rule cannot become two
  -- ids by case.
  constraint guardrail_evaluations_evidence_rule_id_shape
    check (evidence is null
           or evidence ->> 'rule_id' is null
           or (evidence ->> 'rule_id' ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
               and length(evidence ->> 'rule_id') <= 64)),

  -- The allowed-path rule that decided it — `drivers/can/**`. Shaped only to the extent of
  -- being present and bounded: a glob is a pattern, and patterns are the one thing here whose
  -- grammar belongs to whoever wrote the workflow.
  constraint guardrail_evaluations_evidence_glob_shape
    check (evidence is null
           or evidence ->> 'glob' is null
           or (btrim(evidence ->> 'glob') <> '' and length(evidence ->> 'glob') <= 256)),

  -- The sentence a person reads. Bounded, because evidence is a pointer and not a report.
  constraint guardrail_evaluations_evidence_detail_shape
    check (evidence is null
           or evidence ->> 'detail' is null
           or (btrim(evidence ->> 'detail') <> '' and length(evidence ->> 'detail') <= 512)),

  -- --- evidence, layer three: no opaque token -----------------------------------
  --
  -- The layer the header argues for. A statement about what evidence looks like — a place and a
  -- rule, all of it broken up by `/`, `.`, `-`, `_` or a space — and therefore a statement that
  -- holds against a credential format nobody here has heard of. Twenty is the length of an AWS
  -- access key id.
  constraint guardrail_evaluations_evidence_no_opaque_token
    check (evidence is null
           or (coalesce(evidence ->> 'path',    '') !~ '[A-Za-z0-9+=]{20,}'
           and coalesce(evidence ->> 'rule_id', '') !~ '[A-Za-z0-9+=]{20,}'
           and coalesce(evidence ->> 'glob',    '') !~ '[A-Za-z0-9+=]{20,}'
           and coalesce(evidence ->> 'detail',  '') !~ '[A-Za-z0-9+=]{20,}')),

  -- --- the rest of the shapes ---------------------------------------------------
  --
  -- A check that has not answered has nothing to show. Without this, a `pending` row could
  -- carry the evidence of the verdict before it and the card would draw last time's offending
  -- path under this time's spinner.
  constraint guardrail_evaluations_pending_has_no_evidence
    check (verdict <> 'pending' or evidence is null),

  constraint guardrail_evaluations_ruleset_version_shape
    check (ruleset_version is null
           or (btrim(ruleset_version) = ruleset_version
               and ruleset_version <> ''
               and length(ruleset_version) <= 64)),

  -- Numbered as workflow_versions numbers them: dense from 1 (V029).
  constraint guardrail_evaluations_policy_ref_positive
    check (policy_ref is null or policy_ref >= 1),

  constraint guardrail_evaluations_change_set_seq_positive
    check (change_set_seq is null or change_set_seq >= 1)
);

comment on table ouroboros.guardrail_evaluations is
  'The four guardrail verdicts mockup 10''s Guardrails card draws, one row per evaluation (#301, AO.4, decision R5) — history, not state: a run reports its change-set many times and each report re-runs the checks, so the rows accumulate and v_run_guardrails_latest is what the card reads. Evidence carries the location and the rule id and NEVER the matched value, enforced in three layers: a closed key set, a type and a shape per key, and a refusal of any unbroken twenty-character alphanumeric run — the last of which is a statement about what evidence looks like rather than a catalogue of credential formats, which is why it holds for the provider nobody thought of.';
comment on column ouroboros.guardrail_evaluations.run_id is
  'The run these checks judged, and the whole of this row''s tenancy — V045''s and V047''s choice, since a verdict has no meaning apart from the run it is about. ON DELETE CASCADE.';
comment on column ouroboros.guardrail_evaluations."check" is
  'allowed_paths | ci_config | secrets | review_required — which of the card''s four rows this is (#301). Quoted because check is a reserved word: the issue, the API and the card all say the word out loud, and a column spelled differently from the word everybody uses is a translation somebody has to remember.';
comment on column ouroboros.guardrail_evaluations.verdict is
  'pass | fail | not_applicable | pending (#301). not_applicable is the mockup''s ○ — "Human review not required (auto-merge eligible)" — and is a third answer rather than a pass, because "this did not apply to you" and "you were checked and were fine" are different things to tell somebody. pending is a check that has been scheduled and has not answered.';
comment on column ouroboros.guardrail_evaluations.evidence is
  'Where, and by which rule — never what (#301, decision R5). Closed to {path, line, rule_id, glob, detail}, typed and shaped per key, and refused any unbroken twenty-character alphanumeric run. Null is "nothing to show", which is the ordinary case for a pass.';
comment on column ouroboros.guardrail_evaluations.ruleset_version is
  'The version of the ruleset that produced this verdict — v3 for the secrets ruleset. What makes a re-run comparable: the same diff under a newer ruleset is the explanation for a verdict that changed while the code did not. Null where the check has no ruleset of its own, which policy_ref already versions.';
comment on column ouroboros.guardrail_evaluations.policy_ref is
  'The pinned workflow version the policy was read from — the 14 of the card''s "standard-fix v14" (#301). A deliberate second copy of runs.workflow_version_pin: a verdict is answerable for the policy it applied, and reading the run''s pin at render time would answer a question about the run when the question was about the evaluation. The slug half stays on runs.workflow_tag, so this is not a second copy of the name.';
comment on column ouroboros.guardrail_evaluations.evaluated_at is
  'When the checks ran, and what the card''s "latest" is the max of (#301). No created_at beside it: an evaluation is written once, at the moment it was made.';
comment on column ouroboros.guardrail_evaluations.change_set_seq is
  'Which report of the change-set was judged (#301) — the report''s own number, so re-evaluation history reads as a sequence rather than a pile. Null when the evaluation was not of a numbered report, which review_required can be, and the latest-per-check view orders it nulls last for that reason.';
comment on constraint guardrail_evaluations_evidence_closed_keys on ouroboros.guardrail_evaluations is
  'evidence holds only path, line, rule_id, glob and detail (#301, decision R5) — so there is no value, match, secret or matched_text field for a writer to reach for. Written as jsonb subtraction because a CHECK may not contain the subquery the natural spelling would need.';
comment on constraint guardrail_evaluations_evidence_no_opaque_token on ouroboros.guardrail_evaluations is
  'No evidence string may contain an unbroken twenty-character run of letters, digits, + or = (#301). Not a catalogue of credential shapes, which V022 rejects for good reason — a statement about what evidence is: a place and a rule, broken up by slashes, dots, hyphens, underscores and spaces. Every credential is such a run, because one that was not would be guessable.';
comment on constraint guardrail_evaluations_pending_has_no_evidence on ouroboros.guardrail_evaluations is
  'A check that has not answered has nothing to show (#301). Without it a pending row could carry the previous verdict''s evidence, and the card would draw last time''s offending path under this time''s spinner.';

-- The card's read, and the view's. Leading `run_id` and `"check"` are the `distinct on`;
-- `evaluated_at desc` is what makes the first row of each group the latest one, and the two
-- tie-breakers after it make *first* deterministic rather than merely usually stable —
-- `change_set_seq desc nulls last` because a later report is a later verdict, and `id desc`
-- because two evaluations written in the same instant of the same report still have an order.
--
-- `nulls last` is stated rather than left to the default: in a `desc` index PostgreSQL orders
-- nulls *first*, and a view whose `order by` disagreed with its index by one word would sort
-- every read instead of walking it.
--
-- Leading `run_id` also makes this the index the `runs` cascade deletes through, which is why
-- the table carries no second index on `run_id` alone.
create index guardrail_evaluations_run_check_latest_idx
  on ouroboros.guardrail_evaluations
     (run_id, "check", evaluated_at desc, change_set_seq desc nulls last, id desc);

comment on index ouroboros.guardrail_evaluations_run_check_latest_idx is
  'The Guardrails card''s read (#301): one run''s checks, latest first within each. Also what v_run_guardrails_latest''s DISTINCT ON walks instead of sorting, and the index the runs cascade deletes through — which is why there is no second index on run_id alone.';

-- ---------------------------------------------------------------------------
-- v_run_guardrails_latest — the card's four rows.
--
-- `distinct on (run_id, "check")` with the ordering above: one row per check per run, the
-- latest one, whatever happened before it. The history stays in the table, which is the whole
-- point of the pair — *fail → fixed → pass* is recoverable, and the card is still four rows.
-- ---------------------------------------------------------------------------
create view ouroboros.v_run_guardrails_latest as
select distinct on (evaluation.run_id, evaluation."check")
       evaluation.id,
       evaluation.run_id,
       evaluation."check",
       evaluation.verdict,
       evaluation.evidence,
       evaluation.ruleset_version,
       evaluation.policy_ref,
       evaluation.evaluated_at,
       evaluation.change_set_seq
  from ouroboros.guardrail_evaluations evaluation
 order by evaluation.run_id,
          evaluation."check",
          evaluation.evaluated_at desc,
          evaluation.change_set_seq desc nulls last,
          evaluation.id desc;

comment on view ouroboros.v_run_guardrails_latest is
  'The latest verdict per check per run (#301, AO.4) — mockup 10''s Guardrails card, exactly four rows for a fully evaluated run however many times its change-set was reported. DISTINCT ON over guardrail_evaluations_run_check_latest_idx; the rows it passes over stay in the table, so fail → fixed → pass is recoverable.';

-- ---------------------------------------------------------------------------
-- run_controls — the durable queue behind Pause, Resume, Abort and Steer.
-- ---------------------------------------------------------------------------
create table ouroboros.run_controls (
  id              uuid        primary key default gen_random_uuid(),

  -- The run being controlled, and the whole of this row's tenancy. Cascade: a control for a
  -- run that no longer exists is not a control. The audit row outlives both — see the trigger.
  run_id          uuid        not null
                              references ouroboros.runs (id) on delete cascade,

  -- **What was asked.** `pause` and `resume` are the head's toggle, `abort` its red button
  -- (which AP.4 gates behind a typed confirmation — a control is the record of the decision,
  -- not the dialog), and `steer` the box under the transcript.
  kind            text        not null,

  -- **The steering text**, and null for every other kind. Held to the kind by constraint
  -- rather than by convention: a `pause` carrying a paragraph is a control somebody wrote a
  -- sentence into and nothing will ever read, and a `steer` carrying nothing is the button
  -- that did nothing.
  --
  -- It does not appear in the audit body. See the header.
  payload         text,

  -- **Where it has got to.** The five states of decision R6's machine, and the reason the
  -- console can distinguish *acknowledged* from *sent* from *no response* instead of drawing
  -- all three as success. Every row starts here.
  state           text        not null default 'pending',

  -- **Who asked.** Null for a control nobody asked for — an expiry sweep asks for nothing, and
  -- AR.4's ChatOps path may act for a workspace rather than a person — and `on delete set null`
  -- rather than cascade, on V021's and V022's argument: removing somebody must not remove the
  -- record of the run they aborted.
  --
  -- Deliberately not additionally constrained to a member of this workspace: membership is
  -- revocable, and re-checking it later would make a historical row unwritable because of
  -- somebody's resignation. Whether they were allowed at the time is AP.4's question, asked
  -- when it mattered.
  requested_by    text        references ouroboros."user" ("id") on delete set null,

  -- When it was asked, when it reached the executor, and when the executor answered. Three
  -- separate instants because the gaps between them are the thing the console renders: a
  -- control that was delivered four minutes ago and has not been acked is a different sentence
  -- from one submitted four minutes ago and never fetched.
  requested_at    timestamptz not null default now(),
  delivered_at    timestamptz,
  acked_at        timestamptz,

  -- **The TTL.** Not null, and with no default: how long a control is worth trying to deliver
  -- is AP.4's policy and differs by kind, and a default here would be this file quietly
  -- deciding it. What the column being `not null` does decide is that **no control may be
  -- written without an expiry** — a control that can sit `pending` for ever is precisely the
  -- failure the sweep exists to prevent, and it would be invisible to it.
  expires_at      timestamptz not null,

  -- What the ack said — *"steering applied to attempt 2"*, or why a control was refused. The
  -- executor's own sentence, which is why it is the one field of this row the audit body
  -- deliberately does not carry.
  ack_detail      text,

  -- **The caller's name for this submission.** Two presses of *Pause loop*, or one press and
  -- the retry of a request whose response was lost, must be one control rather than two — so
  -- a writer supplies a key and writes `on conflict (run_id, idempotency_key) do nothing`.
  --
  -- Defaulted to a fresh uuid rather than left nullable, so that *"I did not tell you this was
  -- a retry"* is a key that collides with nothing rather than a null that collides with every
  -- other null's absence of a rule. Not null, because a unique index over nulls guarantees
  -- nothing at all.
  idempotency_key text        not null default gen_random_uuid()::text,

  -- --- one control per submission ------------------------------------------------
  --
  -- The acceptance criterion in one line: a duplicate submission is a no-op. Scoped to the run,
  -- because a key is a name for *this* request against *this* loop and two runs of the same
  -- workspace have no reason to share a namespace.
  --
  -- Leading `run_id`, so this is also the index the `runs` cascade deletes through.
  constraint run_controls_run_idempotency_key unique (run_id, idempotency_key),

  -- --- the two vocabularies --------------------------------------------------------
  constraint run_controls_kind
    check (kind in ('pause', 'resume', 'abort', 'steer')),

  constraint run_controls_state
    check (state in ('pending', 'delivered', 'acked', 'expired', 'rejected')),

  -- --- the payload belongs to one kind ---------------------------------------------
  constraint run_controls_payload_belongs_to_steer
    check ((kind = 'steer') = (payload is not null)),

  constraint run_controls_payload_shape
    check (payload is null
           or (btrim(payload) <> '' and length(payload) <= 4096)),

  -- --- the clocks agree with the state ---------------------------------------------
  --
  -- `delivered` and `acked` have been delivered; `pending` and `rejected` have not, which is
  -- what the state diagram says — a rejection is a refusal to accept the control at all, and
  -- a refusal after delivery would be an ack with a bad outcome. `expired` is the one state
  -- that is honestly either: a control can time out before it was fetched or after.
  constraint run_controls_delivery_clock
    check (case state
             when 'delivered' then delivered_at is not null
             when 'acked'     then delivered_at is not null
             when 'pending'   then delivered_at is null
             when 'rejected'  then delivered_at is null
             else true
           end),

  constraint run_controls_ack_clock
    check ((state = 'acked') = (acked_at is not null)),

  -- An outcome's sentence belongs to an outcome. Anything else carrying one would be a row
  -- that had answered without saying so.
  constraint run_controls_ack_detail_belongs_to_outcome
    check (ack_detail is null
           or (state in ('acked', 'rejected')
               and btrim(ack_detail) <> ''
               and length(ack_detail) <= 1024)),

  -- Time runs forwards. Stated rather than assumed, because these three instants come from
  -- three different machines and a delivery stamped before its own request is a clock-skew
  -- bug that would otherwise be discovered as a negative duration on the card.
  constraint run_controls_clock_order
    check ((delivered_at is null or delivered_at >= requested_at)
           and (acked_at is null or acked_at >= coalesce(delivered_at, requested_at))),

  -- A TTL that has already elapsed is not a TTL.
  constraint run_controls_expires_after_request
    check (expires_at > requested_at),

  constraint run_controls_idempotency_key_shape
    check (btrim(idempotency_key) = idempotency_key
           and idempotency_key <> ''
           and length(idempotency_key) <= 128)
);

comment on table ouroboros.run_controls is
  'The durable, ack-tracked queue behind mockup 10''s Pause loop, Abort run and steering box (#301, AO.4, decision R6). Abort is needed exactly when an executor is wedged, which is when a synchronous RPC fails — so a control is a row that records what was asked, whether it was delivered, whether it was acked and with what effect, and whether it expired unanswered, and the console can say "acknowledged — paused" and "no response" and mean both. The state machine is enforced by run_controls_transition() rather than by the service, terminal states are immutable, a duplicate submission under the same idempotency_key is a no-op, and every write lands in audit_events with the steer text structurally absent from the body.';
comment on column ouroboros.run_controls.run_id is
  'The run being controlled, and the whole of this row''s tenancy. ON DELETE CASCADE — a control for a run that no longer exists is not a control; the audit row outlives both, as V022''s deliberately non-referential subject does.';
comment on column ouroboros.run_controls.kind is
  'pause | resume | abort | steer (#301) — the head''s toggle, its red button, and the box under the transcript. AP.4 gates abort behind a typed confirmation; the row is the record of the decision rather than of the dialog.';
comment on column ouroboros.run_controls.payload is
  'The steering text, and null for every other kind — held to that by run_controls_payload_belongs_to_steer, because a pause carrying a paragraph is a sentence nothing will read and a steer carrying nothing is the button that did nothing. Structurally absent from the audit body: the audit detail records has_payload, a boolean.';
comment on column ouroboros.run_controls.state is
  'pending | delivered | acked | expired | rejected (#301, decision R6). What lets the console distinguish acknowledged from sent from no response instead of drawing all three as success. Transitions are forward-only and terminal states immutable, enforced by run_controls_transition().';
comment on column ouroboros.run_controls.requested_by is
  'Who asked — "user".id, ON DELETE SET NULL. Null for a control nobody asked for, and set-null rather than cascade because removing a person must not remove the record of the run they aborted. Deliberately not re-checked against workspace membership: whether they were allowed at the time is the endpoint''s question, asked when it mattered.';
comment on column ouroboros.run_controls.requested_at is
  'When the control was asked for. The first of three instants, whose gaps are what the console renders.';
comment on column ouroboros.run_controls.delivered_at is
  'When the control reached the executor. Set for delivered and acked, null for pending and rejected, and either for expired — a control can time out before it was fetched or after.';
comment on column ouroboros.run_controls.acked_at is
  'When the executor answered. Set for exactly the acked rows.';
comment on column ouroboros.run_controls.expires_at is
  'The TTL, set at insert (#301). Not null and with no default: how long a control is worth delivering is AP.4''s policy and differs by kind, but a control with no expiry could sit pending for ever and be invisible to the sweep, which is the failure the TTL exists for. Swept through run_controls_expiry_idx.';
comment on column ouroboros.run_controls.ack_detail is
  'What the ack said — "steering applied to attempt 2" — or why the control was refused. The executor''s own sentence, and therefore the one field of this row the audit body deliberately does not carry: it is the one place a well-meaning writer could echo the steering back.';
comment on column ouroboros.run_controls.idempotency_key is
  'The caller''s name for this submission (#301). Two presses of Pause loop, or the retry of a request whose response was lost, are one control: writers use ON CONFLICT (run_id, idempotency_key) DO NOTHING. Defaulted to a fresh uuid rather than nullable, so "I did not say this was a retry" is a key that collides with nothing — a unique index over nulls guarantees nothing at all.';
comment on constraint run_controls_run_idempotency_key on ouroboros.run_controls is
  'One control per submission per run (#301) — the key a duplicate submission conflicts on, and the index the runs cascade deletes through.';
comment on constraint run_controls_delivery_clock on ouroboros.run_controls is
  'The delivery stamp agrees with the state (#301): set for delivered and acked, absent for pending and rejected — a rejection is a refusal to accept the control at all — and either way for expired, which can happen before a fetch or after one.';
comment on constraint run_controls_clock_order on ouroboros.run_controls is
  'Requested, then delivered, then acked (#301). Stated rather than assumed because the three instants come from three machines, and a delivery stamped before its own request would otherwise be discovered as a negative duration on the card.';

-- The sweep's index, and the acceptance criterion it exists for.
--
-- `expires_at` leads, so the sweep walks only the rows that have actually elapsed; `id` rides
-- along so a sweep that selects the ids it is about to update never touches the heap. The
-- predicate is the two states a sweep can find work in, which makes this a small index on a
-- table whose rows are overwhelmingly terminal — and keeps `state` out of the key, because a
-- column every row in the index agrees on carries no information.
create index run_controls_expiry_idx
  on ouroboros.run_controls (expires_at, id)
  where state in ('pending', 'delivered');

comment on index ouroboros.run_controls_expiry_idx is
  'The TTL sweep''s index (#301): the elapsed, undelivered-or-unacked controls, by expiry. Partial over the two non-terminal states, so it stays small on a table whose rows are overwhelmingly terminal, and carrying id so the sweep''s scan is index-only. The sweep itself is a plain statement — a scheduler is a deployment question, and a schema that answered it would have an operational dependency in it.';

-- One run's controls, newest first — the console's list, and what AP.4 reads to decide whether
-- a pause is already outstanding.
create index run_controls_run_requested_at_idx
  on ouroboros.run_controls (run_id, requested_at desc, id desc);

comment on index ouroboros.run_controls_run_requested_at_idx is
  'One run''s controls, newest first (#301) — the console''s list and AP.4''s "is a pause already outstanding?" read. id breaks the tie so two controls submitted in the same millisecond page deterministically.';

-- ---------------------------------------------------------------------------
-- The state machine, enforced.
--
-- A CHECK cannot see the row it is replacing, so this is a trigger. It states three things:
--
--   * **A terminal state is terminal.** `acked`, `expired` and `rejected` accept no update at
--     all — not a state change, not a later ack detail, not a corrected expiry. A control is
--     the record of an exchange that has finished.
--   * **Transitions go forward only**, along the five edges decision R6's diagram draws.
--   * **What was asked cannot be rewritten**, only what happened to it. The run, the kind, the
--     payload, the requester, the request time, the expiry and the idempotency key are fixed
--     at insert: a queue whose entries can be edited in flight is a queue where *"abort"* was
--     once *"pause"* and nobody can tell.
--
-- The one permitted exception is V022's, for V022's reason, and it is not a softening of any
-- of the three: `requested_by` going from a person to null with every other column untouched
-- is the foreign key's own `on delete set null`, which PostgreSQL implements as an UPDATE. A
-- trigger that refused it would not be protecting the queue — it would be making a person who
-- once paused a loop undeletable. So the guarantee is stated exactly: *what was asked, and what
-- happened to it, cannot be rewritten; who asked can be forgotten.*
-- ---------------------------------------------------------------------------
create function ouroboros.run_controls_transition()
returns trigger
language plpgsql
as $$
begin
  -- The erasure, recognised from the row rather than from who is asking — so it holds for the
  -- owner and the superuser as much as for the application role, and holds for terminal rows,
  -- which is the case that matters: most controls are terminal by the time anybody leaves.
  if new.requested_by is null and old.requested_by is not null
     and row(new.id, new.run_id, new.kind, new.payload, new.state, new.requested_at,
             new.delivered_at, new.acked_at, new.expires_at, new.ack_detail,
             new.idempotency_key)
         is not distinct from
         row(old.id, old.run_id, old.kind, old.payload, old.state, old.requested_at,
             old.delivered_at, old.acked_at, old.expires_at, old.ack_detail,
             old.idempotency_key)
  then
    return new;
  end if;

  if old.state in ('acked', 'expired', 'rejected') then
    raise exception
      'run control % is %, which is terminal', old.id, old.state
      using errcode = 'restrict_violation',
            constraint = 'run_controls_transition',
            hint = 'A control records an exchange that has finished (#301, decision R6). Submit another control rather than revising this one.';
  end if;

  if new.state is distinct from old.state
     and not (old.state = 'pending'   and new.state in ('delivered', 'expired', 'rejected')
           or old.state = 'delivered' and new.state in ('acked', 'expired'))
  then
    raise exception
      'run control % cannot move from % to %', old.id, old.state, new.state
      using errcode = 'restrict_violation',
            constraint = 'run_controls_transition',
            hint = 'Decision R6''s machine: pending → delivered | expired | rejected, delivered → acked | expired.';
  end if;

  if row(new.id, new.run_id, new.kind, new.payload, new.requested_by,
         new.requested_at, new.expires_at, new.idempotency_key)
     is distinct from
     row(old.id, old.run_id, old.kind, old.payload, old.requested_by,
         old.requested_at, old.expires_at, old.idempotency_key)
  then
    raise exception
      'run control % is a record of what was asked, and that cannot be revised', old.id
      using errcode = 'restrict_violation',
            constraint = 'run_controls_transition',
            hint = 'Only state, delivered_at, acked_at and ack_detail move after insert (#301). A queue whose entries can be edited in flight is a queue where "abort" was once "pause" and nobody can tell.';
  end if;

  return new;
end;
$$;

comment on function ouroboros.run_controls_transition() is
  'Decision R6''s state machine, enforced in the schema rather than in the service (#301): terminal states accept no update at all, transitions follow the five edges the diagram draws, and everything that describes what was ASKED is fixed at insert. The one exception is requested_by going from a person to null with nothing else moving — the foreign key''s own ON DELETE SET NULL, which a blanket refusal would turn into "a person who once paused a loop cannot be deleted". So the guarantee is: what was asked, and what happened to it, cannot be rewritten; who asked can be forgotten.';

create trigger run_controls_transition
  before update on ouroboros.run_controls
  for each row execute function ouroboros.run_controls_transition();

-- ---------------------------------------------------------------------------
-- The audit linkage.
--
-- AD.4's shape (#225), written by the database. See the header for why this amends V022's
-- *"nothing writes this table from SQL"* and for what the body may and may not contain.
--
-- **`security definer`**, and the second function in this schema that is. The reason is the
-- same one V046's append has: every write it makes is one the caller holds no privilege for.
-- `ouroboros_app` has `select` and `insert` on `audit_events` (V022) but no grant at all on
-- `runs`, which this has to read to learn the workspace the event happened in — and an audit
-- row that was skipped because the writer could not look up an organization id would be the
-- one row somebody needed. `search_path` is pinned with `pg_temp` last, and `execute` is
-- revoked from `public` below: called outside a trigger it can only raise, and a
-- `security definer` function nobody needs to call should not be callable.
-- ---------------------------------------------------------------------------
create function ouroboros.run_controls_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  workspace text;
  event     text;
begin
  -- A transition that moved nothing is not an event. Without this, an update that only
  -- corrected an ack detail would write a second "acked" row into the trail.
  if tg_op = 'UPDATE' and new.state is not distinct from old.state then
    return null;
  end if;

  event := case
             when tg_op = 'INSERT' then 'run_control.requested'
             else 'run_control.' || new.state
           end;

  select run.organization_id into workspace
    from ouroboros.runs run
   where run.id = new.run_id;

  insert into ouroboros.audit_events
      (organization_id, actor_id, action, subject_type, subject_id, detail)
    values (workspace,
            -- The requester on the request, and nobody on the transitions: a delivery, an ack
            -- and an expiry are not things a person did, and naming the requester as the actor
            -- of an event they did not cause would be inventing one. Who asked stays
            -- answerable through subject_id, which is this control's own row.
            case when tg_op = 'INSERT' then new.requested_by end,
            event,
            'run_control',
            new.id::text,
            -- Four fields, three of them closed vocabularies and the fourth a boolean. The
            -- steer text has nowhere to go — not because it is redacted on the way past, but
            -- because there is no string field in this object for it to be put in.
            jsonb_build_object('run_id',      new.run_id::text,
                               'kind',        new.kind,
                               'state',       new.state,
                               'has_payload', new.payload is not null));

  return null;
end;
$$;

comment on function ouroboros.run_controls_audit() is
  'Writes AD.4''s audit event for every control write (#301, decision R6) — requested, delivered, acked, expired, rejected. Kept in the schema rather than in AuditService, which amends V022''s "nothing writes this table from SQL": the acceptance criterion is that an audit row exists for EVERY control, and a rule the schema keeps cannot be forgotten by the next writer — the sweep, a support script, AP.4''s delivery loop. The body is four fields, three closed vocabularies and a boolean, so the steer text has nowhere to go; ack_detail is left out for the same reason, being the one place a writer could echo the steering back. SECURITY DEFINER because the application role holds no grant on runs, which this must read for the workspace, and a skipped audit row would be the one somebody needed.';

create trigger run_controls_audit
  after insert or update on ouroboros.run_controls
  for each row execute function ouroboros.run_controls_audit();

revoke execute on function ouroboros.run_controls_audit() from public;

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason: `ouroboros_app` is the role a deployment that separates
-- *migrating* from *running* connects the API as, and V022 created it.
--
--   * **`guardrail_evaluations` is append-only to the application**, because it is a record of
--     what was decided and when. A re-evaluation is a new row — that is what makes the card's
--     *latest* meaningful and the history recoverable — so `update` would only ever be used to
--     make a verdict say something it did not say.
--   * **`run_controls` needs `update`**, because its whole life after insert is a state
--     transition. What bounds that grant is `run_controls_transition()`, which is a rule about
--     the row rather than about the role and therefore binds the owner too.
--   * **Neither may be deleted.** A control that was aborted and then removed is an abort
--     nobody can find. Rows leave with their run.
--
-- The `revoke`s are no-ops today, because `create table` grants nothing to anybody but the
-- owner, and that is exactly why they are written: a later migration that hands one of these
-- tables `all privileges` should have to delete a line to do it.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert on ouroboros.guardrail_evaluations to ouroboros_app;
grant select on ouroboros.v_run_guardrails_latest to ouroboros_app;
grant select, insert, update on ouroboros.run_controls to ouroboros_app;

revoke update, delete on ouroboros.guardrail_evaluations from ouroboros_app;
revoke update, delete on ouroboros.guardrail_evaluations from public;
revoke delete on ouroboros.run_controls from ouroboros_app;
revoke delete on ouroboros.run_controls from public;
