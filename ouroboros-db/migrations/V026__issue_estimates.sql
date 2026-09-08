-- V026__issue_estimates.sql — `issue_estimates`: everything mockup 03 calls **AI Work
-- Breakdown**, as versioned latest-wins rows.
--
-- The second table of the **intake** read-model (docs/ROADMAP_MOCKUP_03_ISSUE_INTAKE.md).
-- `V014` (#99) mirrors the issues; this is what sizing says *about* them, and it is what
-- the mockup renders in four places:
--
--   * the backlog table's **Effort**, **Suggested workflow** and **Routed model** columns,
--   * the detail panel's *AI Work Breakdown* — estimated files touched, token estimate,
--     cycle range, and the single number the queue plans with,
--   * the regression-risk meter and the sentence underneath it,
--   * the collapsible *estimation trace*.
--
-- Nothing writes it yet. L.3 (#107) is the orchestration that persists an estimate and
-- moves `github_issues.sizing_status` with it, and K.5 (#103) is the seed that fills this
-- table for mockup-03 parity. As with every read-model table before it, that is why every
-- rule a reader depends on is a constraint here rather than an application invariant: the
-- writers do not exist to be trusted yet.
--
-- ---------------------------------------------------------------------------
-- Decision K4 — an estimate is a **row**, and re-estimation is the next one.
-- ---------------------------------------------------------------------------
--
-- The mockup offers three separate ways to re-estimate — the panel's button, the head's
-- *Re-estimate all*, and the implicit staleness of an issue GitHub has changed — so
-- re-sizing is not an exceptional path, it is the ordinary one. A single mutable estimate
-- (columns on `github_issues`, or one row per issue updated in place) would answer all
-- three by destroying its predecessor, and two things depend on that predecessor still
-- being there:
--
--   * **the trace means nothing without it.** *"sized by `heuristic-v0`, from these
--     signals"* is only worth reading beside the answer it replaced.
--   * **O.2's estimator swap would be unauditable.** The whole point of #123 is to change
--     what produces these numbers; a schema that keeps only the newest answer cannot show
--     what changed when it did.
--
-- So: append-only versions, and *latest wins*. `version` is monotonic within an issue and
-- unique with it, the newest is the estimate in force, and every earlier one stays exactly
-- as it was written.
--
-- ---------------------------------------------------------------------------
-- Latest-wins is one indexed query, and the index is the unique key.
-- ---------------------------------------------------------------------------
--
-- The acceptance criterion asks for the lookup to be a single indexed query and names two
-- candidate ways to get there — a partial unique index on an `is_latest` flag, or a
-- covering index on `(github_issue_id, version desc)`. Measured on this schema, the answer
-- is **neither, because the unique key already is the second one**:
--
--   explain select * from ouroboros.issue_estimates
--            where github_issue_id = $1 order by version desc limit 1;
--   Limit
--     ->  Index Scan Backward using issue_estimates_issue_version_key on issue_estimates
--           Index Cond: (github_issue_id = $1)
--
-- A b-tree read backwards *is* the descending index. `(github_issue_id, version desc)`
-- would be the same tree with the same entries, maintained twice on every insert, and the
-- planner would pick between two identical paths. `tests/constraints.sql` asserts that
-- plan, and the lateral join the backlog table makes over a page of issues, with
-- `must_not_scan` — so this claim is checked rather than asserted in a comment.
--
-- The `is_latest` flag was not taken for a second reason, which stands even where the plan
-- would have been a wash: a flag is **derived state a writer has to maintain**. Storing
-- version *n+1* would become two statements — clear the old flag, set the new one — and a
-- partial unique index on it enforces *at most one* latest and can say nothing about *at
-- least one*, so the failure mode is an issue whose estimates all read `false` and whose
-- panel renders as never sized. `max(version)` cannot desynchronise from the rows it is
-- computed over.
--
-- No index on `github_issue_id` alone, for `V014`'s reason: the unique key leads with it,
-- so the cascade from `github_issues` enters through that index rather than scanning. And
-- none on `created_at` — there is no read of estimates across issues, and every read this
-- table has starts from one issue.
--
-- ---------------------------------------------------------------------------
-- Append-only, and why that is stronger than a convention here.
-- ---------------------------------------------------------------------------
--
-- `V024`'s posture, for `V024`'s reason and one of this table's own. An estimate row is a
-- record of what something answered at a moment; an answer that can be edited afterwards
-- is not a record, and the versioning above would be decorative if version 1 could be
-- rewritten to say what version 2 says.
--
-- The one of its own is BI.4 (#435, decision **I7**): estimator calibration grades a merged
-- loop against **the estimate that was in force when the work was queued**, not against the
-- latest one. That join is a lookup of a historical row by id, and it is only meaningful
-- while a historical row cannot change under it — otherwise the calibration figure would
-- flatter the estimator for reasons unrelated to prediction.
--
-- So `issue_estimates_no_update` refuses every update from every role, including the owner,
-- and there is no `updated_at` and no touch trigger. No delete counterpart, for `V022`'s
-- reason: the one foreign key cascades, and a delete-refusing trigger would not protect the
-- history — it would make removing an issue or a workspace fail.
--
-- ---------------------------------------------------------------------------
-- The row's tenancy is its issue's.
-- ---------------------------------------------------------------------------
--
-- There is no `organization_id` here, deliberately, and this is the second table to make
-- that choice — `provider_models` (`V017`) is the first. An estimate is a fact *about an
-- issue*: it has no meaning apart from one, every read enters through one, and the single
-- cascading foreign key is therefore the whole of its tenancy. A second parent would buy a
-- shorter join and cost a `repo_in_organization`-style trigger to keep the two agreeing,
-- which is a rule that can be got wrong in exchange for one that cannot.
--
-- `sizing_status` stays where `V014` put it, and the split is worth stating because it is
-- the thing a reader is most likely to want to "fix": **this table stores results, the
-- issue row stores state.** L.3 moves `unsized → estimating → sized | needs_human`; a row
-- here is what the pipeline produced on the way. There is deliberately no constraint tying
-- the two — a CHECK cannot see another row, and the pairing is not even one-directional:
-- an issue that is `needs_human` because its estimate came in under L.2's published
-- confidence floor of 70 has an estimate *and* is waiting for a person, which is exactly
-- the state the mockup's *needs human* pill describes.
--
-- ---------------------------------------------------------------------------
-- The columns are the contract's, and the bounds are no stricter than the contract's.
-- ---------------------------------------------------------------------------
--
-- L.1 (#105) shipped `POST /v0/estimate` before this table existed and wrote its response
-- to be *one version of this row*, field for field — `ouroboros-engine`'s
-- `tests/test_estimation_contract.py` carries every column and jsonb key below as data and
-- compares them to this file from the day it lands. L.3 persists a parsed response without
-- translating it, and that is only true while the names match, so a rename here is a red
-- build there rather than a discovery made later.
--
-- The same reasoning governs every bound in this file: **a value the contract accepts must
-- be storable.** Where the two could differ, this side is the looser one — `routed_model`
-- is bounded at 200 like `runs.model` while the contract stops at 128; `est_minutes` runs
-- to the contract's 100 000 even though `queue_items.est_minutes` (`V009`) refuses zero and
-- anything past a fortnight. A column that refused a legal estimate would leave L.3 holding
-- a valid answer it cannot write, and an issue stuck mid-pipeline for a reason no log would
-- explain. Reconciling `est_minutes` with the queue's narrower window is M.3's (#112), at
-- the statement that copies one into the other, where the clamp can be seen.
--
-- The one thing this side refuses that the contract does not is **blankness**: a
-- whitespace-only file path or signal line satisfies pydantic's `min_length=1` and renders
-- as a bullet with nothing beside it, so it is refused here for the reason `risk_note` is.
-- That is a rule about a value being *present*, not a narrower ceiling, and no estimator
-- that means anything by its answer can hit it.
--
-- Two things the contract does *not* say, and neither is added here. `est_minutes` is **not**
-- confined to the cycle range — the ticket's own example is a 12–18 minute cycle beside 23
-- estimated minutes, because a job's wall clock includes what happens either side of the
-- model's part of it — and `est_tokens` (what the *work* will cost) is not related to
-- `trace.tokens_used` (what *sizing* cost); confusing the two makes an estimate look a
-- thousand times more expensive than it was.
--
-- ---------------------------------------------------------------------------
-- Decision K10 — provenance is mandatory, and it has a constraint of its own.
-- ---------------------------------------------------------------------------
--
-- `trace->>'estimator'` is non-null and non-blank, enforced by `issue_estimates_provenance`
-- rather than folded into the trace's shape rule, because a reader looking for K10 should
-- find a constraint named for it. An estimate that cannot say what produced it does not get
-- to exist: the panel would render *"sized"* with no answer to *"by what"*, and the first
-- time a model estimator and a rule engine disagreed there would be no way to tell which
-- had spoken. It is enforced at the contract too — required and non-empty in the engine's
-- model and in the gateway's parser — so this is the third hop rather than the only one,
-- which is the point: by the time a `not null` catches it, the value has been logged,
-- measured and returned.
--
-- ---------------------------------------------------------------------------
-- Decisions K5 and K6 — the tag and the model are opaque, and shaped anyway.
-- ---------------------------------------------------------------------------
--
-- `suggested_workflow` and `routed_model` get `runs.workflow_tag` and `runs.model`'s
-- treatment, under `V008`'s decision **F8**, which K6 cites by name: non-blank, bounded,
-- and otherwise unconstrained. No CHECK vocabulary for the workflow tag even though K5
-- names four (`standard-fix`, `feature-loop`, `docs-loop`, `deps-refresh`) — mockup 04
-- turns that fixed set into workflow entities a workspace defines, and a vocabulary here
-- would make defining one a database migration. No foreign key for the model either.
--
-- Decision **M1** — that `model_aliases.model_id` is the only column in this schema where a
-- raw provider model string may live — is not breached by that, and the distinction is
-- worth stating rather than leaving to be re-derived. M1 is a rule about **configuration**:
-- the routing tables name aliases so a rebind is one edit in one place. This column is a
-- **record of a resolution that already happened**, like `runs.model` and
-- `token_usage.provider` before it, and a record must survive the rename or the retirement
-- of the thing it names. The estimator does not invent the value either — Z.4's amendment
-- (#197, decision **M6**) has it resolved out of the caller's own `model_defaults` map, and
-- the engine refuses an answer naming anything outside that offer.
--
-- ---------------------------------------------------------------------------
-- What lands here later, so it is not read as a violation.
-- ---------------------------------------------------------------------------
--
-- AK.1 (#272, decision **N3**) adds a nullable `draft_id` to this table so that mockup 09's
-- pre-push ticket drafts are sized by **this** table and **this** pipeline, with `draft_id`
-- and the issue reference mutually exclusive and exactly one set per row. It lands there
-- rather than in a planning-owned table because there must be one sizer in the product: the
-- planning page's *all sized* pill and its effort chips have to mean precisely what the
-- intake page's do. Nothing below anticipates it beyond leaving room for it — the FK is
-- `not null` today because today an estimate is always an issue's, and relaxing it is that
-- ticket's migration.
--
-- Filed as issue #100 (K.2). Written by L.3 (#107) and K.5's seed (#103); read by M.1
-- (#110), M.2 (#111), M.3 (#112) and mockup 03's panel (N.5, #119). Asserted in
-- tests/constraints.sql.

-- ---------------------------------------------------------------------------
-- Two general jsonb shape helpers, and why they are functions rather than inline SQL.
--
-- Both documents below carry a list of non-blank strings and a whole non-negative number —
-- `files`/`signals` and four counts between them — and the checks are identical every time.
-- Written inline they would be six copies of the same three clauses inside two CHECKs that
-- are already the longest things in this file, and the copy that eventually drifts is the
-- one nothing points at.
--
-- Immutable and table-free, which is what lets them sit in a CHECK at all. A CHECK may not
-- contain a subquery, so `jsonb_array_elements` cannot be reached from one directly — the
-- same wall `V014` met and answered with `jsonb_path_exists`; inside a function body the
-- subquery is ordinary SQL, which is why these say what they mean.
--
-- `V014`'s `labels` predates them and is not rewritten to use them: migration rule 1 — a
-- versioned migration that has been applied is never edited.
-- ---------------------------------------------------------------------------

create function ouroboros.jsonb_string_list_valid(value jsonb,
                                                 max_items integer,
                                                 max_length integer)
returns boolean language sql immutable as $$
  select
    jsonb_typeof(value) = 'array'
    and jsonb_array_length(value) <= max_items
    and not exists (
      select 1
        from jsonb_array_elements(value) as element
       where jsonb_typeof(element) <> 'string'
          or btrim(element #>> '{}') = ''
          or length(element #>> '{}') > max_length
    );
$$;

comment on function ouroboros.jsonb_string_list_valid(jsonb, integer, integer) is
  'Is this jsonb value a bounded array of non-blank strings? (#100) — the shape files[] and signals[] both have. Empty is valid and is a real answer: heuristic-v0 cannot know which files a change touches, and the panel renders that absence rather than guessing.';

-- `case` rather than `and`, and that is not style. SQL does not promise the order in which
-- the arms of an `and` are evaluated, so a value of `"abc"` would be free to reach the cast
-- and raise a *data exception* instead of failing the constraint that was meant to catch
-- it — a different error class, three hops from anything that could explain it. `case` is
-- the one construct PostgreSQL documents as evaluating in the order written, and the cast
-- can only be reached once the regex has proved it cannot fail.
create function ouroboros.jsonb_whole_number_valid(value jsonb, max_value numeric)
returns boolean language sql immutable as $$
  select case
    -- The regex is what makes it *whole and non-negative*: jsonb stores every number as
    -- numeric, so `-1`, `1.5` and `1e-3` are all `number` and all wrong for a count of
    -- tokens, minutes or files.
    when jsonb_typeof(value) = 'number' and (value #>> '{}') ~ '^[0-9]+$'
    then (value #>> '{}')::numeric <= max_value
    else false
  end;
$$;

comment on function ouroboros.jsonb_whole_number_valid(jsonb, numeric) is
  'Is this jsonb value a whole, non-negative number no larger than the ceiling? (#100) — the shape every count in a breakdown or a trace has. The ceilings are the estimation contract''s, so a unit slip (seconds where minutes were meant, a token count multiplied twice) fails at the column instead of being persisted.';

-- ---------------------------------------------------------------------------
-- The two jsonb documents, key by key.
--
-- Closed vocabularies, both of them: exactly these keys, no others. The estimation contract
-- is closed on its side (`extra="forbid"` in the engine's models) and every key below is
-- rendered by something, so a key nothing renders is a key that renders nowhere — it would
-- be written by one estimator, silently dropped by every reader, and discovered by whoever
-- eventually wondered why the panel did not show it. Adding a key is an edit here and in
-- the contract, together, which is exactly the review both deserve.
-- ---------------------------------------------------------------------------

create function ouroboros.issue_estimate_breakdown_valid(breakdown jsonb)
returns boolean language sql immutable as $$
  select
    jsonb_typeof(breakdown) = 'object'
    and breakdown ?& array['files', 'est_tokens', 'cycle_min', 'cycle_max', 'est_minutes']
    and (select count(*) = 5 from jsonb_object_keys(breakdown))

    -- The paths the work is believed to touch — the panel's *Estimated files touched*.
    -- Bounded at the contract's 200 paths of 4096 characters: a breakdown carrying a
    -- thousand file paths is a bug in an estimator rather than an estimate a panel can show.
    and ouroboros.jsonb_string_list_valid(breakdown->'files', 200, 4096)

    -- What the *work* is expected to cost in model tokens — not what the estimate cost.
    and ouroboros.jsonb_whole_number_valid(breakdown->'est_tokens', 100000000)

    -- The single number the queue plans with. Deliberately *not* held inside the cycle
    -- range — see the header.
    and ouroboros.jsonb_whole_number_valid(breakdown->'est_minutes', 100000)

    -- The wall-clock range, in minutes, and the rule that it runs forwards. A range read
    -- backwards is one no schedule can be built from, and the panel renders the pair as
    -- `12-18 min` without noticing. The estimator refuses it too; this is the copy that
    -- holds for a writer that is not the estimator — a seed, an import, L.3 under a bug.
    --
    -- `case` for the reason jsonb_whole_number_valid() gives: the comparison may reach the
    -- cast only after both values have been proved to be numbers.
    and case
          when ouroboros.jsonb_whole_number_valid(breakdown->'cycle_min', 100000)
           and ouroboros.jsonb_whole_number_valid(breakdown->'cycle_max', 100000)
          then (breakdown->>'cycle_min')::numeric <= (breakdown->>'cycle_max')::numeric
          else false
        end;
$$;

comment on function ouroboros.issue_estimate_breakdown_valid(jsonb) is
  'The shape of an estimate''s breakdown (#100): exactly files[], est_tokens, cycle_min, cycle_max and est_minutes — the AI Work Breakdown panel''s four numbers plus the one M.3''s queue write reads. Closed, because the estimation contract is closed and a key nothing renders renders nowhere. cycle_max may not fall below cycle_min; est_minutes is deliberately not confined to that range.';

create function ouroboros.issue_estimate_trace_valid(trace jsonb)
returns boolean language sql immutable as $$
  select
    jsonb_typeof(trace) = 'object'
    and trace ?& array['estimator', 'sized_at', 'tokens_used', 'signals']
    and (select count(*) = 4 from jsonb_object_keys(trace))

    -- `estimator` is checked by issue_estimates_provenance, which is decision K10 and has a
    -- constraint of its own. What is asserted here is only that the key is present, so the
    -- two rules do not restate each other and a failure names the one that was broken.

    -- When the estimate was produced, which is not when this row was written: the two are
    -- the same instant for L.3's synchronous call and deliberately different for O.2's
    -- (#123) escalation, where an answer is produced, polled for, and persisted afterwards.
    -- `created_at` is the row's clock; this is the estimator's.
    --
    -- An ISO-8601 instant **with an offset**, by regex rather than by cast: `timestamptz`
    -- input is not immutable — it reads the session's TimeZone — so a CHECK cannot cast,
    -- and a local time with no zone is an instant two readers disagree about anyway.
    and jsonb_typeof(trace->'sized_at') = 'string'
    and (trace->>'sized_at') ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$'

    -- What producing *this estimate* cost. `0` is the honest answer for a rule engine that
    -- called no model, and is why this is a number rather than a nullable one.
    and ouroboros.jsonb_whole_number_valid(trace->'tokens_used', 100000000)

    -- What the answer was reached from, one line each — a rule name for the heuristic, a
    -- retrieved neighbour for O.2. Empty rather than absent when there is nothing to show.
    and ouroboros.jsonb_string_list_valid(trace->'signals', 64, 256);
$$;

comment on function ouroboros.issue_estimate_trace_valid(jsonb) is
  'The shape of an estimate''s trace (#100): exactly estimator, sized_at, tokens_used and signals[] — the collapsible estimation trace under the panel. sized_at is an ISO-8601 instant with an offset, checked by regex because a timestamptz cast reads the session TimeZone and is not immutable. The estimator key''s content is issue_estimates_provenance''s (decision K10), so the two rules name different failures.';

-- ---------------------------------------------------------------------------
-- issue_estimates
-- ---------------------------------------------------------------------------
create table ouroboros.issue_estimates (
  id                 uuid        primary key default gen_random_uuid(),

  -- The issue this sizes. Cascade rather than `set null`: an estimate with no issue cannot
  -- be rendered and cannot be graded — its whole identity is *"what we think about #485"* —
  -- and it is the row's only tenancy, so a `set null` would leave a row reachable from no
  -- workspace at all. See the header.
  github_issue_id    uuid        not null
                                 references ouroboros.github_issues (id) on delete cascade,

  -- Which estimate of this issue this is. 1 for the first, and every re-estimation is the
  -- next one; the highest is in force and the rest are history. Monotonic within the issue
  -- by trigger and unique with it by key — see both at the foot of this file.
  version            integer     not null,

  -- --- what the estimator answered --------------------------------------------

  -- The *Effort* column's chip — `V009`'s five sizes, decision **F9**, the same vocabulary
  -- the queue uses. Text with a named CHECK rather than an enum, the house idiom: the value
  -- is a label the UI maps to a chip class, and widening the scale is an ordinary migration
  -- instead of enum surgery.
  effort             text        not null,

  -- How much the estimator trusts its own answer, as a percentage. L.3 reads it against a
  -- floor and routes a low one to `needs_human`, so a hedge is expressed here rather than
  -- by declining to answer — which is why there is no nullable confidence and no "unknown".
  confidence         integer     not null,

  -- The workflow tag this should run under, and the model it should run on. Opaque, K5 and
  -- K6; shaped and unconstrained otherwise. See the header.
  suggested_workflow text        not null,
  routed_model       text        not null,

  -- The *AI Work Breakdown* panel as one document: `files[]`, `est_tokens`, `cycle_min`,
  -- `cycle_max` and `est_minutes`. One jsonb rather than five columns because it is one
  -- thing an estimator produces and one thing a panel renders, and because O.2 changing
  -- what a breakdown contains should be a change to its grammar rather than five migrations.
  -- The grammar is not free-form for the same reason `V014`'s labels are not: a document
  -- with no shape rule holds four shapes within a year, one per writer.
  breakdown          jsonb       not null,

  -- The regression-risk meter, and the sentence under it. `risk_note` is `not null` and
  -- non-blank on purpose: it is the line a reviewer reads before overriding an estimate,
  -- and a level with no rationale is a colour nobody can argue with.
  risk               text        not null,
  risk_note          text        not null,

  -- Where the estimate came from — `estimator`, `sized_at`, `tokens_used`, `signals[]`.
  -- Decision K10 lives in here and has its own constraint below.
  trace              jsonb       not null,

  -- When this row was written. There is no `updated_at` and no touch trigger: this table is
  -- append-only, and a record that can be edited is not one.
  created_at         timestamptz not null default now(),

  -- --- one version of an issue's estimate, once -------------------------------
  --
  -- Acceptance criterion, twice over: two estimates for one issue coexist, `version` is
  -- unique with the issue, and this index is what makes latest-wins a single indexed query
  -- — read backwards. See the header for why no second index was created.
  --
  -- It is also what makes the monotonicity trigger safe under concurrency: two transactions
  -- that both computed `max(version) + 1` cannot both commit, because neither can see the
  -- other's uncommitted row but this key sees both.
  constraint issue_estimates_issue_version_key unique (github_issue_id, version),

  -- --- the vocabularies are closed --------------------------------------------
  --
  -- Acceptance criterion: both match the mockup exactly, and both are partitions something
  -- renders — the effort chip, the risk meter's three colours. A sixth effort or a fourth
  -- risk is a value with no class, which renders as nothing rather than as wrong.
  constraint issue_estimates_effort
    check (effort in ('xs', 's', 'm', 'l', 'xl')),
  constraint issue_estimates_risk
    check (risk in ('low', 'medium', 'high')),

  -- --- the numbers -------------------------------------------------------------
  --
  -- Acceptance criterion: confidence is a percentage and the bounds are enforced. Both ends
  -- are real answers — 0 is an estimator saying it has nothing, 100 is one that is certain
  -- — and 101 is a fraction that was multiplied twice.
  constraint issue_estimates_confidence_bounds
    check (confidence between 0 and 100),

  -- Versions start at 1. There is no version 0, and a negative one would sort as the latest
  -- of nothing.
  constraint issue_estimates_version_positive check (version >= 1),

  -- --- the opaque strings are still strings ------------------------------------
  --
  -- Decision F8's treatment, and `runs`' bounds deliberately: the same two facts live in
  -- `runs.workflow_tag` and `runs.model`, and a value that fits one table must fit the
  -- other — M.3 copies the tag from here into `queue_items`, which shares them too.
  constraint issue_estimates_suggested_workflow_present
    check (btrim(suggested_workflow) <> '' and length(suggested_workflow) <= 64),
  constraint issue_estimates_routed_model_present
    check (btrim(routed_model) <> '' and length(routed_model) <= 200),

  -- The sentence under the meter, bounded at the contract's own 1024 — long enough for the
  -- mockup's rationale, short enough that the column is not a place to put a report.
  constraint issue_estimates_risk_note_present
    check (btrim(risk_note) <> '' and length(risk_note) <= 1024),

  -- --- the two documents have grammars -----------------------------------------
  constraint issue_estimates_breakdown_shape
    check (ouroboros.issue_estimate_breakdown_valid(breakdown)),
  constraint issue_estimates_trace_shape
    check (ouroboros.issue_estimate_trace_valid(trace)),

  -- --- decision K10: provenance is mandatory ------------------------------------
  --
  -- Acceptance criterion, and a constraint of its own so that a rejected write names the
  -- decision rather than a shape rule. `->>` returns null both for an absent key and for a
  -- JSON null, so the type check is what separates *"no estimator"* from an estimator
  -- called `3`.
  constraint issue_estimates_provenance
    check (jsonb_typeof(trace->'estimator') = 'string'
           and btrim(trace->>'estimator') <> ''
           and length(trace->>'estimator') <= 64)
);

comment on table ouroboros.issue_estimates is
  'Versioned, latest-wins estimates for a mirrored GitHub issue (#100) — everything mockup 03 calls AI Work Breakdown. Decision K4: re-estimation is a new row, never an edit, because the trace is only worth reading beside the answer it replaced and O.2''s estimator swap has to be auditable. Append-only: no updated_at, and issue_estimates_no_update refuses a revision from any role. The issue row holds the pipeline''s state (sizing_status, V014); this holds its results.';
comment on column ouroboros.issue_estimates.github_issue_id is
  'The issue this sizes — the row''s only parent and the whole of its tenancy, as provider_models (V017) is a fact about its connection. Cascades: an estimate of an issue that is gone cannot be rendered or graded.';
comment on column ouroboros.issue_estimates.version is
  'Which estimate of this issue this is — 1 for the first, the next integer for every re-estimation. Monotonic within the issue by trigger, unique with it by key, and the highest is the estimate in force. Gaps are legal; ordering is what is read.';
comment on column ouroboros.issue_estimates.effort is
  'The mockup''s effort chip: xs | s | m | l | xl — V009''s five sizes, decision F9, the same vocabulary queue_items uses.';
comment on column ouroboros.issue_estimates.confidence is
  'How much the estimator trusts its answer, 0-100. L.3 reads it against a floor (heuristic-v0 publishes 70) and routes a low one to needs_human, so a hedge is a number here rather than a refusal to answer.';
comment on column ouroboros.issue_estimates.suggested_workflow is
  'Which workflow should run it — opaque (decision K5), as runs.workflow_tag is under F8. No vocabulary: mockup 04 turns the fixed four into workflow entities a workspace defines, and a CHECK here would make defining one a migration.';
comment on column ouroboros.issue_estimates.routed_model is
  'Which model it should run on — opaque (decision K6), as runs.model is under F8. Not a foreign key and no breach of M1: this records a resolution that happened, and a record must survive the rename or retirement of what it names. The estimator resolves it out of the caller''s own model_defaults map (Z.4, decision M6) — resolved, never invoked.';
comment on column ouroboros.issue_estimates.breakdown is
  'The AI Work Breakdown panel as one document: files[] (empty is a real answer), est_tokens (what the work will cost, not what sizing cost), cycle_min/cycle_max in minutes, and est_minutes — the value M.3''s queue write reads without recomputing it. Grammar held by ouroboros.issue_estimate_breakdown_valid().';
comment on column ouroboros.issue_estimates.risk is
  'The regression-risk meter: low | medium | high.';
comment on column ouroboros.issue_estimates.risk_note is
  'The sentence under the meter, saying why — required and non-blank, because it is what a reviewer reads before overriding an estimate and a level with no rationale is a colour nobody can argue with.';
comment on column ouroboros.issue_estimates.trace is
  'Where the estimate came from: estimator (decision K10, non-null by issue_estimates_provenance), sized_at (the estimator''s clock, not the row''s), tokens_used and signals[]. Grammar held by ouroboros.issue_estimate_trace_valid().';
comment on column ouroboros.issue_estimates.created_at is
  'When the row was written. Distinct from trace.sized_at, which is when the estimate was produced — the same instant for L.3''s synchronous call, and deliberately different for O.2''s escalate-and-poll path. There is no updated_at: this table is append-only.';
comment on constraint issue_estimates_provenance on ouroboros.issue_estimates is
  'Decision K10 (#100): trace.estimator is a non-blank string, always. An estimate that cannot say what produced it does not get to exist — enforced here, in the engine''s contract model and in the gateway''s parser, so this is the last hop rather than the only one.';
comment on constraint issue_estimates_issue_version_key on ouroboros.issue_estimates is
  'One version per issue, once (#100) — and, read backwards, the index that makes latest-wins a single indexed query. It is also what makes the monotonicity trigger safe under concurrency, since two writers computing max(version) + 1 cannot both commit.';

-- ---------------------------------------------------------------------------
-- Monotonic versions.
--
-- Acceptance criterion. Unique alone would let an issue's estimates be written 3 then 2 —
-- distinct rows, both accepted, and *latest wins* would then return the older answer. So
-- the rule is that a new version is above every version the issue already has.
--
-- Enforced rather than assigned: the trigger refuses a wrong number, it does not fill in a
-- right one. A default of `max(version) + 1` would read as a convenience and would hide the
-- one case a writer must handle — two callers re-estimating the same issue at once, which
-- resolves as a unique violation on the key above and is a retry rather than a corruption.
-- L.3 computes the number it wants and finds out here if it was wrong.
--
-- Monotonic, not dense: 1, 2, 5 is accepted. Nothing counts these numbers — unlike
-- `route_hops.position` (`V016`), where `floor_hop_index` refers to a hop *number* and a
-- gap makes it mean nothing — and the only question asked of them is which is largest.
--
-- Insert only: an update is refused outright by the trigger below, so there is no second
-- statement for this rule to watch.
-- ---------------------------------------------------------------------------
create function ouroboros.issue_estimate_version_monotonic() returns trigger
language plpgsql as $$
declare
  highest integer;
begin
  select max(version) into highest
    from ouroboros.issue_estimates
   where github_issue_id = new.github_issue_id;

  if highest is not null and new.version <= highest then
    raise exception
      'issue % is already estimated at version %; a new estimate must be version % or later',
      new.github_issue_id, highest, highest + 1
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.issue_estimate_version_monotonic() is
  'BEFORE INSERT trigger for issue_estimates (#100): refuses a version that is not above every version the issue already has. Unique alone permits 3 then 2 — two accepted rows where latest-wins then returns the older answer. Raises class 23 naming the trigger, so a rejected write reports issue_estimates_version_monotonic. Concurrency is the unique key''s: two writers that both computed max + 1 cannot both commit.';

create trigger issue_estimates_version_monotonic
  before insert on ouroboros.issue_estimates
  for each row execute function ouroboros.issue_estimate_version_monotonic();

comment on trigger issue_estimates_version_monotonic on ouroboros.issue_estimates is
  'Versions ascend within an issue (#100). Insert only: an update is refused outright by issue_estimates_no_update.';

-- ---------------------------------------------------------------------------
-- Append-only, in the database rather than in the grants.
--
-- `V024`'s posture and `V022`'s argument: the development stack connects as the database
-- owner and a superuser bypasses every grant, so a rule that lived only in the catalogue
-- would be true in production and false on the machine the code is written on. No exception
-- clause, as `V024` has none — the single foreign key cascades, so no `on delete set null`
-- ever needs to reach a row here.
-- ---------------------------------------------------------------------------
create function ouroboros.issue_estimates_refuse_update() returns trigger
language plpgsql
as $$
begin
  raise exception
    'ouroboros.issue_estimates is append-only: an estimate cannot be revised'
    using errcode = 'restrict_violation',
          detail  = format('refused update of estimate %s (issue %s, version %s)',
                           old.id, old.github_issue_id, old.version),
          hint    = 'Insert the next version instead. Re-estimation is a new row (decision K4), which is what makes the trace comparable and BI.4''s calibration honest. See V026__issue_estimates.sql (#100).';
end;
$$;

comment on function ouroboros.issue_estimates_refuse_update() is
  'Refuses every UPDATE on issue_estimates (#100), for any role including the owner. Decision K4 made structural: an estimate is a record of what something answered at a moment, versioning would be decorative if version 1 could be rewritten to say what version 2 says, and BI.4''s (#435) calibration grades a merged loop against the estimate that was in force when it was queued — a join that is only meaningful while that row cannot change under it.';

create trigger issue_estimates_no_update
  before update on ouroboros.issue_estimates
  for each row execute function ouroboros.issue_estimates_refuse_update();

comment on trigger issue_estimates_no_update on ouroboros.issue_estimates is
  'An estimate cannot be revised (#100). No delete counterpart, for V022''s reason: github_issue_id cascades, and a delete-refusing trigger would not protect the history — it would make removing an issue or a workspace fail.';
