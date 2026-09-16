-- V034__draft_batches_ticket_drafts.sql — `draft_batches` and `ticket_drafts`: tickets that
-- exist, sized and reviewable, before any tracker knows about them.
--
-- The first migration of the **planning** domain (docs/ROADMAP_MOCKUP_09_PLANNING.md), filed as
-- AK.1 (#272) under epic #268. Mockup 09's *Generate Tickets* card ends in a list of six draft
-- rows — `OTA-1`…`OTA-6`, each with a checkbox, a title, a dependency note, an effort chip and a
-- workflow tag, under a `✓ all sized` pill — and the safety promise of that page is the step
-- between the list and the tracker: read the six, uncheck the one that is wrong, regenerate,
-- *then* push.
--
-- Decision **N1** is what makes the promise keepable: a draft is a **row with a lifecycle**
-- rather than a response held open in a browser tab. A tab cannot be re-opened tomorrow, cannot
-- be reviewed by somebody else, and cannot record what happened to each draft when a push half
-- succeeded — and a batch where four issues were created and two failed is the case that decides
-- whether this feature is trustworthy.
--
-- Nothing writes these tables yet. AL.4 (#280) is the planning API that turns AL.1's (#277)
-- `POST /v0/plan` into a batch, AL.3 (#279) the push service, AM.2 (#284) the card itself. As
-- with every read-model table before it — `V030` said this four migrations ago — that is exactly
-- why every rule a reader depends on is a constraint here rather than an application invariant:
-- the writers do not exist to be trusted yet.
--
-- ---------------------------------------------------------------------------
-- Decision N2 — a batch says what produced it, and `planner` is a grammar rather than a list.
-- ---------------------------------------------------------------------------
--
-- Provenance is mandatory: `outline-v0` today, `llm-v1` when AN.1 (#289) lands, and `analyzer-vN`
-- for the Build Analyzer's batches (BV.5, #514 — the amendment this issue carries). A user
-- reading a draft always knows what generated it, which is the whole of N2.
--
-- That third value is why the column is **not** a closed CHECK, against the house idiom every
-- vocabulary above follows. `analyzer-vN` is a *family* parameterised by a number nobody here can
-- enumerate, so a closed set would make each new analyzer generation a migration — and the set
-- would be widened by whoever noticed the insert failing rather than by whoever chose the name.
-- What is enforced instead is the shape all three share, a name and a version: a rejected write
-- still names a rule, and `Outline`, `outline`, `''` and `llm-v` are all still refused.
--
-- It is `issue_estimates_provenance`'s rule (decision **K10**) one step stricter. An estimate
-- must say which estimator produced it; a batch must say which *version* of which planner
-- produced it, because N2's point is that two planners answer one contract and a reader has to be
-- able to tell them apart.
--
-- ---------------------------------------------------------------------------
-- Decision N3 — there is one sizer in the product, so drafts are sized by `V026`'s table.
-- ---------------------------------------------------------------------------
--
-- `issue_estimates` gains a nullable `draft_id` — the amendment to INTAKE-K.2 (#100) this issue
-- carries — rather than planning getting an estimation path of its own. A second sizer would
-- eventually disagree with the first, and `✓ all sized` would then mean something different on
-- this page than on the intake page.
--
-- Three consequences, each a rule at the foot of this file:
--
--   * **`github_issue_id` stops being mandatory.** `V026` made it the row's only parent and the
--     whole of its tenancy. Now a row has exactly one subject — an issue or a draft, never both
--     and never neither (`issue_estimates_one_subject`) — and a draft estimate's tenancy runs
--     through its draft to that draft's batch.
--   * **Versions are per subject.** `V026` keys `(github_issue_id, version)` and holds the number
--     ascending by trigger. With a null issue both go quiet — `null = null` is unknown, and a
--     unique key treats nulls as distinct — so a draft would have no versioning at all. The draft
--     side therefore gets a key and a monotonicity trigger of its own, and *latest wins* reads
--     the same way on both.
--   * **Regeneration must not orphan what survives.** Replacing the unselected drafts deletes
--     rows, and the estimates of the drafts that remain have to still be there afterwards. That
--     is a property of *where the estimate hangs*: `draft_id` cascades from the **draft**, so
--     deleting one draft takes its own estimates and nobody else's. Hung off the batch instead,
--     regeneration would have taken all of them — which is the mistake this column's placement
--     exists to make unrepresentable.
--
-- ---------------------------------------------------------------------------
-- What a push leaves behind, and why `pushed` is terminal.
-- ---------------------------------------------------------------------------
--
-- Each draft records what happened to **it**, not what happened to the batch: `push_state` with
-- `pushed_ticket_id` beside it, or `push_error` saying why not. A partial push is the ordinary
-- outcome rather than an exceptional one — six drafts, four issues created, two refused by a
-- tracker — and a batch-level *"failed"* would lose which four exist, which is the fact somebody
-- retrying needs.
--
-- Two rules follow, and they are the ones the retry path stands on:
--
--   * **The three states carry different evidence.** `pending` has neither a ticket nor an error,
--     `pushed` has a ticket and no error, `failed` has an error and no ticket. A `pushed` draft
--     with no ticket renders an issue link to nowhere, and a `failed` one with no reason is a red
--     row nobody can act on.
--
--     The rule is split between a CHECK and a trigger, and the seam is a real exception rather
--     than tidiness. `pushed_ticket_id` is `on delete set null`, so deleting a ticket — or the
--     workspace above it — must **clear** the reference on a draft that really was pushed. Stated
--     as a CHECK, that delete would be *refused* instead, and a planning draft would be able to
--     veto the removal of a workspace. So `ticket_drafts_push_state_coherent` holds what is
--     always true, and `ticket_draft_push_state_transition()` requires the ticket of every write
--     that *makes* a draft pushed — `V029`'s treatment of `published_by`, which is the same
--     shape and was written for the same reason.
--   * **`pushed` is terminal.** Every other move is legitimate — `pending → pushed`, `pending →
--     failed`, and `failed →` either, which is what a retry is — but a draft that became an issue
--     cannot stop having become one. The tracker will not un-create it, so a row saying otherwise
--     would be the schema disagreeing with GitHub. `ticket_draft_push_state_transition()` refuses
--     the move *and* a re-point of `pushed_ticket_id`, because pushing twice is the same mistake
--     spelled without changing the state.
--
-- `push_error` is a **structured reason, not a stringified exception** — an acceptance criterion,
-- and a grammar rather than a hope. A `text` column, or an unshaped `jsonb`, is where
-- `error.toString()` ends up, and what the card can then do with it is print it.
--
-- ---------------------------------------------------------------------------
-- Tenancy, and the two joins that have to agree with it.
-- ---------------------------------------------------------------------------
--
-- `draft_batches` carries `organization_id`. `ticket_drafts` deliberately does not: the batch is
-- the whole of a draft's tenancy, as the issue is an estimate's under `V026` and the connection a
-- provider model's under `V017`. One owner, one cascade, and no second copy of the workspace to
-- disagree with the first.
--
-- Two references still cross into workspace-owned tables, and nothing about a foreign key makes
-- it agree with the row's owner:
--
--   * a batch's `target_source_id`, held to the batch's own workspace — `V030`'s
--     `ticket_source_in_organization()` argument, reaching its parent through a differently named
--     column and so, by that function's own reasoning, a function of its own;
--   * a draft's `pushed_ticket_id`, held to the workspace of the draft's *batch*, which is the
--     guard the absent `organization_id` would otherwise have provided.
--
-- Both leak the same way when missing: one workspace's ticket titles rendering on another's
-- planning page, which is a tenancy breach rather than a broken join.
--
-- ---------------------------------------------------------------------------
-- What this migration deliberately does not add: `epic_id`.
-- ---------------------------------------------------------------------------
--
-- #272 lists `epic_id` among `draft_batches`' columns and annotates it with AK.3 (#274) — the
-- migration that creates the planning epics it would reference. That table does not exist yet, so
-- the foreign key cannot, and the column without it would be a bare uuid pointing at nothing:
-- every other parent in this schema is a real key, and a nullable uuid that *looks* like one is
-- how a dangling reference becomes normal. AK.3 adds the column and its reference together, in
-- the migration that has something to reference, and the roadmap's own ordering (AK.1 → AK.3) is
-- written for exactly that.
--
-- Filed as issue #272 (AK.1). Needs #138 (`V030`) and #19; amends #100 (`V026`). Blocks #273,
-- #274, #275, #277 and #280. Asserted in tests/constraints.sql.

-- ---------------------------------------------------------------------------
-- draft_batches
--
-- One press of *Generate Tickets*: what was asked for, what answered, where it is going, and how
-- far through its life it has got.
-- ---------------------------------------------------------------------------
create table ouroboros.draft_batches (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace this batch belongs to, and the scope of every read of this table. Cascade, the
  -- posture of every extension table since `V006`: a deleted workspace must not leave behind
  -- drafts of work for a tracker nobody can reach any more.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The narrative from the prompt box — what somebody actually typed. Kept rather than consumed,
  -- because regeneration re-asks the same question of a planner and *"generate six tickets from
  -- this"* is not reconstructable from the six tickets.
  source_prompt    text        not null,

  -- The optional structured outline AL.1 (#277) parses — the bullet list whose markers become
  -- dependencies and workflow tags. Null is the ordinary case and a real answer: narrative-only
  -- input is what `outline-v0` degrades honestly on, yielding one draft and a note rather than an
  -- invented decomposition.
  outline          text,

  -- Which planner produced this batch (decision **N2**). See the header for why this is a shape
  -- rather than a closed set.
  planner          text        not null,

  -- The WF-Q source this batch is pushed to — the card's target-tracker segment. Cascade rather
  -- than `set null`, `V030`'s argument for `tickets.source_id`: a batch aimed at nothing cannot
  -- be pushed and cannot say where it was going. Held to `organization_id` by the trigger at the
  -- foot of this file.
  target_source_id uuid        not null
                               references ouroboros.ticket_sources (id) on delete cascade,

  -- The milestone selector's value — `Helios 2.1`. Text rather than a reference: the milestone
  -- belongs to the tracker, is named by the push (AL.3, #279), and this schema does not mirror
  -- one. Null is *no milestone*, which the selector offers.
  target_milestone text,

  -- The card's two toggles. `auto_size` dispatches each draft through the one estimation
  -- orchestrator (#107, decision **N3**); `queue_small` hands the XS and S tickets straight to
  -- INTAKE-M.3's queue after the push (decision **N7**).
  --
  -- Defaulted the way the mockup draws them, and both written explicitly by AL.4 (#280) — a
  -- default here is what a row inserted by a seed or a fixture means, not a policy the API reads.
  auto_size        boolean     not null default true,
  queue_small      boolean     not null default false,

  -- How far through its life this batch is: `drafting` while the planner's answer is being
  -- reviewed, `sized` once every selected draft has an estimate, `pushing` for the window AL.3
  -- holds it in, then `pushed` — or `abandoned`, which is a batch somebody read and threw away
  -- rather than one that failed.
  --
  -- Text with a named CHECK rather than an enum, the house idiom (`V003`, `V008`, `V030`): the
  -- value is a label the card maps to a pill, and widening the lifecycle is an ordinary migration
  -- instead of enum surgery.
  status           text        not null default 'drafting',

  -- Who pressed the button. `set null` rather than cascade, `V029`'s posture for
  -- `workflow_versions.published_by`: removing a person must not delete the work they planned.
  -- Nullable for the same reason and for a seeded batch, which nobody pressed.
  created_by       text        references ouroboros."user" ("id") on delete set null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- --- the lifecycle is a closed vocabulary -----------------------------------
  --
  -- A partition the card renders as a pill, so a sixth value is a batch that appears under no
  -- state at all — invisible rather than wrong.
  constraint draft_batches_status
    check (status in ('drafting', 'sized', 'pushing', 'pushed', 'abandoned')),

  -- --- decision N2: provenance is mandatory, and versioned --------------------
  --
  -- Acceptance criterion — *"`planner` provenance is recorded on every batch and is never null"*
  -- — and a constraint of its own so a rejected write names the decision rather than a length
  -- rule. See the header for why the set is open and the shape is not.
  constraint draft_batches_planner_versioned
    check (planner ~ '^[a-z0-9][a-z0-9-]*-v[0-9]+$' and length(planner) <= 64),

  -- --- the text the batch was made from ---------------------------------------
  --
  -- A prompt says something. Both bounds are storage sanity rather than anybody's limit — `V030`'s
  -- argument for `tickets.body` — set well above what a person types into a card, because the one
  -- thing they must never be is the reason a batch somebody legitimately described cannot be
  -- stored.
  constraint draft_batches_source_prompt_present
    check (btrim(source_prompt) <> '' and length(source_prompt) <= 65536),
  constraint draft_batches_outline_present
    check (outline is null or (btrim(outline) <> '' and length(outline) <= 65536)),

  -- `''` and `'   '` are not *no milestone*: null is. A blank one renders as an empty chip and
  -- would be pushed to a tracker as a milestone with no name.
  constraint draft_batches_target_milestone_present
    check (target_milestone is null
           or (btrim(target_milestone) <> '' and length(target_milestone) <= 255))
);

comment on table ouroboros.draft_batches is
  'One press of mockup 09''s Generate Tickets (#272, AK.1) — the prompt, the optional outline, which planner answered, where the batch is going and how far through its life it is. Decision N1: drafts are rows with a lifecycle rather than a response held in a browser tab, because the page''s safety promise is a review step and a tab cannot be re-opened, reviewed by somebody else, or asked what happened to each draft when a push half succeeded. Written by AL.4 (#280); pushed by AL.3 (#279).';
comment on column ouroboros.draft_batches.organization_id is
  'Owning workspace, and the scope of every read. Cascades: a deleted workspace does not leave drafts of work behind.';
comment on column ouroboros.draft_batches.source_prompt is
  'The narrative somebody typed into the prompt box. Kept rather than consumed, because regeneration re-asks the same question and the request is not reconstructable from the answer.';
comment on column ouroboros.draft_batches.outline is
  'The optional structured outline AL.1 (#277) parses into dependencies and workflow tags. Null is the ordinary case: narrative-only input yields one draft and a guidance note rather than an invented decomposition.';
comment on column ouroboros.draft_batches.planner is
  'Which planner produced this batch (decision N2) — outline-v0 today, llm-v1 with AN.1 (#289), analyzer-vN for the Build Analyzer''s batches (#514). Never null, and shaped rather than enumerated: analyzer-vN is a family parameterised by a number this schema cannot enumerate, so a closed CHECK would make every analyzer generation a migration.';
comment on column ouroboros.draft_batches.target_source_id is
  'The WF-Q source (V030) this batch will be pushed to — the card''s target-tracker segment. Held to the same workspace as organization_id by the draft_batches_target_source_in_organization trigger, which is the composite foreign key ticket_sources cannot offer.';
comment on column ouroboros.draft_batches.target_milestone is
  'The milestone selector''s value — "Helios 2.1". Text rather than a reference: the milestone belongs to the tracker and is named by the push (AL.3, #279). Null is no milestone, which the selector offers.';
comment on column ouroboros.draft_batches.auto_size is
  'The Auto-size with estimator toggle: whether each draft is dispatched through the one estimation orchestrator (#107, decision N3) as the batch is generated.';
comment on column ouroboros.draft_batches.queue_small is
  'The Queue XS/S tickets immediately toggle: whether the small pushed tickets go straight into INTAKE-M.3''s queue (decision N7).';
comment on column ouroboros.draft_batches.status is
  'Where the batch is: drafting | sized | pushing | pushed | abandoned. abandoned is a batch somebody read and threw away, which is deliberately not the same as one that failed — the per-draft push_error is where a failure is recorded.';
comment on column ouroboros.draft_batches.created_by is
  'Who pressed Generate Tickets. Set-null rather than cascade: removing a person must not delete the work they planned. Null for a seeded batch and for one whose author has gone.';
comment on constraint draft_batches_planner_versioned on ouroboros.draft_batches is
  'Decision N2 (#272): a batch always says which version of which planner produced it. A name and a version — outline-v0, llm-v1, analyzer-v2 — so the set stays open while the blank, the capitalised and the unversioned are refused. issue_estimates_provenance (K10) one step stricter, because N2''s point is that two planners answer one contract and a reader must be able to tell them apart.';
comment on constraint draft_batches_status on ouroboros.draft_batches is
  'The batch lifecycle (#272), closed because the card renders this word as a pill: a sixth value is a batch that appears under no state at all.';

-- The planning page's own list — a workspace's batches, newest first:
--
--   select … from ouroboros.draft_batches
--    where organization_id = $1 order by created_at desc
--
-- Leading `organization_id` because no read here is global, and the timestamp descending because
-- that is the order the page shows them in. No index on `status`: it has five values, every read
-- that filters by it enters through this one first, and the page sizes involved are a handful of
-- batches per workspace.
--
-- `target_source_id` is deliberately unindexed too, which leaves `ticket_sources`' cascade a scan
-- of this table. That is the honest trade at this size — `V030` avoided the same index only
-- because a unique key already led with the column — and the ticket that measures a slow source
-- deletion is the ticket that adds one.
create index draft_batches_organization_created_idx
  on ouroboros.draft_batches (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The target-source-belongs-to-the-organization rule.
--
-- `V030`'s `ticket_source_in_organization()`, reaching its parent through `target_source_id`
-- instead of `source_id` — and so a function of its own, for the reason that function gave when
-- it declined to reuse `V010`'s: what is shared between these guards is the argument, not the
-- code. The error is raised the same way, class 23 naming the trigger, so this table reports its
-- own constraint name.
-- ---------------------------------------------------------------------------
create function ouroboros.draft_batch_target_source_in_organization()
returns trigger language plpgsql as $$
declare
  owner text;
begin
  select s.organization_id into owner
    from ouroboros.ticket_sources s
   where s.id = new.target_source_id;

  -- Null means the source went between this statement and its own foreign key, which the key
  -- itself refuses a moment later. Saying nothing here leaves that error to the constraint that
  -- describes it properly.
  if owner is not null and owner is distinct from new.organization_id then
    raise exception
      'draft batch names target source %, which belongs to organization % rather than %',
      new.target_source_id, owner, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.draft_batch_target_source_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for draft_batches (#272): refuses a batch whose target source belongs to a different organization than the batch does. V030''s ticket_source_in_organization() reaching its parent through target_source_id — a sibling rather than a reuse, because what these guards share is the argument and not the code. Raises class 23 naming the trigger.';

create trigger draft_batches_touch_updated_at
  before update on ouroboros.draft_batches
  for each row execute function ouroboros.touch_updated_at();

create trigger draft_batches_target_source_in_organization
  before insert or update of organization_id, target_source_id on ouroboros.draft_batches
  for each row execute function ouroboros.draft_batch_target_source_in_organization();

comment on trigger draft_batches_target_source_in_organization on ouroboros.draft_batches is
  'A batch and the source it will be pushed to belong to the same workspace (#272). Two separate foreign keys do not make each other agree, and a batch naming one workspace and another''s tracker is a tenancy leak rather than a broken join.';

-- ---------------------------------------------------------------------------
-- What a failed push is allowed to say.
--
-- Acceptance criterion: `push_error` captures a **structured reason, not a stringified
-- exception**. `jsonb` alone accepts `"Error: connect ETIMEDOUT"` and so does every unshaped
-- object, and what the card can do with either is print it.
--
-- So: a `code` the UI can branch on — a slug, lower case, which is what makes it a code rather
-- than a sentence — a human `message` it can show, and an optional `detail` object for whatever
-- the tracker said. Exactly those three names and no others, `V026`'s closed-grammar posture: a
-- key nothing renders would be written by one push service and silently dropped by every reader.
--
-- Immutable and table-free, which is what lets it sit in a CHECK at all — `V026`'s note on why
-- `jsonb_array_elements` cannot be reached from a CHECK directly.
-- ---------------------------------------------------------------------------
create function ouroboros.ticket_draft_push_error_valid(push_error jsonb)
returns boolean language sql immutable as $$
  select
    jsonb_typeof(push_error) = 'object'
    and push_error ?& array['code', 'message']

    -- No key outside the three. `?&` says the two required ones are there; this says nothing
    -- else is.
    and not exists (
      select 1
        from jsonb_object_keys(push_error) as key
       where key not in ('code', 'message', 'detail')
    )

    -- The branchable half. A slug rather than prose, which is the whole difference between a
    -- reason and an exception somebody caught: `rate_limited`, `permission_denied`,
    -- `milestone_missing`.
    and jsonb_typeof(push_error->'code') = 'string'
    and (push_error->>'code') ~ '^[a-z][a-z0-9_]*$'
    and length(push_error->>'code') <= 64

    -- The readable half. Non-blank, because a failed row with no sentence is a red chip nobody
    -- can act on, and bounded at the 1024 `issue_estimates.risk_note` is bounded at.
    and jsonb_typeof(push_error->'message') = 'string'
    and btrim(push_error->>'message') <> ''
    and length(push_error->>'message') <= 1024

    -- Whatever the tracker said, kept whole. An object and no further — `V030`'s treatment of
    -- `meta`: the per-tracker shape belongs to the provider that produced it, and a grammar
    -- written here would be GitHub's under a neutral name.
    and (not push_error ? 'detail' or jsonb_typeof(push_error->'detail') = 'object');
$$;

comment on function ouroboros.ticket_draft_push_error_valid(jsonb) is
  'The shape of a failed push''s reason (#272): exactly code, message and an optional detail object. The acceptance criterion that a push_error is a structured reason rather than a stringified exception, made a rule — code is a lower-case slug the card can branch on, message the sentence it shows, detail whatever the tracker said. Closed, V026''s posture: a key nothing renders would be written by one push service and dropped by every reader.';

-- ---------------------------------------------------------------------------
-- ticket_drafts
--
-- The six rows. Every field on one corresponds to something the card renders and something the
-- push has to know — and, afterwards, to what happened to that draft individually.
-- ---------------------------------------------------------------------------
create table ouroboros.ticket_drafts (
  id                 uuid        primary key default gen_random_uuid(),

  -- The batch this was drafted in — the row's only parent and the whole of its tenancy, as the
  -- issue is an estimate's under `V026`. Cascade: a draft outside a batch has no prompt behind
  -- it, no target to be pushed to and no workspace to be read from.
  batch_id           uuid        not null
                                 references ouroboros.draft_batches (id) on delete cascade,

  -- The mono id the card shows and the outline's dependency notes point at: `OTA-1`. Unique
  -- within its batch and meaningless outside it — every batch has a first draft.
  --
  -- No grammar beyond non-blank and bounded, deliberately. `OTA-` is `outline-v0`'s prefix rather
  -- than this schema's, and AN.1 (#289) is free to key its batches differently; a pattern here
  -- would make the next planner's naming a migration.
  local_key          text        not null,

  -- The draft ticket itself, editable in the card before a push. `body` is nullable because a
  -- one-line draft has none — `V030`'s reasoning for `tickets.body`, and `''` would be this
  -- schema inventing a distinction the card does not make.
  title              text        not null,
  body               text,

  -- The checkbox — **the review step**. Decision N1 is what this column is for: unchecking a
  -- draft is how somebody rejects it, and regeneration replaces exactly the unselected rows.
  --
  -- Defaulted true, which is how the card draws a freshly generated batch: every row checked,
  -- and the reviewer's work is to *remove*.
  selected           boolean     not null default true,

  -- The row's workflow tag. Opaque and unconstrained beyond shape — decision **K5**, as
  -- `issue_estimates.suggested_workflow` is: mockup 04 turns the fixed four tags into workflow
  -- entities a workspace defines, and a CHECK here would make defining one a migration.
  --
  -- Nullable, which `V033`'s `edited_in` argues for: null is the honest state for a draft
  -- somebody added by hand before choosing a tag, and it renders as no chip rather than as a
  -- wrong one. `outline-v0` supplies one for every draft it produces.
  suggested_workflow text,

  -- What happened to **this** draft, not to its batch. See the header.
  push_state         text        not null default 'pending',

  -- The canonical ticket (`V030`) this became. Set-null rather than cascade: a ticket deleted in
  -- its tracker must not delete the record that this draft was pushed — the draft is what
  -- happened here, and the ticket is what happened there.
  --
  -- Which is why a `pushed` draft whose ticket has since gone still reads as pushed, and why the
  -- rule that a push names its ticket lives in the transition trigger rather than in the
  -- coherence CHECK — the CHECK would turn that set-null into a refused delete.
  pushed_ticket_id   uuid        references ouroboros.tickets (id) on delete set null,

  -- Why a failed draft failed. Grammar held by ouroboros.ticket_draft_push_error_valid().
  push_error         jsonb,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- --- one local key per batch -------------------------------------------------
  --
  -- Acceptance criterion. `blocks OTA-3` resolves within its batch and nowhere else, so two
  -- drafts sharing a key make that note ambiguous — and two batches may each hold an `OTA-1`,
  -- because the key is the planner's numbering rather than an identity. Its leading column also
  -- serves the batch cascade and every read of a batch's drafts, which is why `batch_id` has no
  -- index of its own.
  constraint ticket_drafts_batch_local_key_key unique (batch_id, local_key),

  -- --- the strings say something ------------------------------------------------
  --
  -- The title's bound is `tickets`' and `runs`' 512, so a draft that fits here fits the ticket it
  -- becomes; the body's is `tickets_body_bounded`'s 256 KiB for the same reason. A draft this
  -- schema accepted and the push then could not store would be the worst of the two.
  constraint ticket_drafts_local_key_present
    check (btrim(local_key) <> '' and length(local_key) <= 64),
  constraint ticket_drafts_title_present
    check (btrim(title) <> '' and length(title) <= 512),
  constraint ticket_drafts_body_bounded
    check (body is null or length(body) <= 262144),
  constraint ticket_drafts_suggested_workflow_present
    check (suggested_workflow is null
           or (btrim(suggested_workflow) <> '' and length(suggested_workflow) <= 64)),

  -- --- the push vocabulary is closed --------------------------------------------
  constraint ticket_drafts_push_state
    check (push_state in ('pending', 'pushed', 'failed')),

  -- --- and each of its three states carries different evidence --------------------
  --
  -- Acceptance criterion, and the rule that makes a half-succeeded batch readable: a `pushed`
  -- draft carries no error, a `failed` one carries an error and no ticket, and a `pending` one
  -- carries neither. Without it a row can fail with no reason — a red row nobody can act on — or
  -- claim both outcomes at once.
  --
  -- **That a pushed draft names its ticket is a rule of the same family, and it is deliberately
  -- not here.** See the header: `pushed_ticket_id` is `on delete set null`, so it has one
  -- legitimate exception a CHECK cannot express, and `ticket_draft_push_state_transition()` is
  -- where it is stated instead.
  --
  -- `else false` rather than a fall-through: a CHECK that evaluates to null **passes**, so a
  -- fourth state slipping past the vocabulary above would otherwise be unconstrained here too.
  constraint ticket_drafts_push_state_coherent
    check (case push_state
             when 'pending' then pushed_ticket_id is null and push_error is null
             when 'pushed'  then push_error is null
             when 'failed'  then push_error is not null and pushed_ticket_id is null
             else false
           end),

  -- --- a reason has a grammar -----------------------------------------------------
  constraint ticket_drafts_push_error_shape
    check (push_error is null or ouroboros.ticket_draft_push_error_valid(push_error))
);

comment on table ouroboros.ticket_drafts is
  'The draft tickets of one batch (#272, AK.1) — mockup 09''s OTA-1…OTA-6 rows. Every column is something the card renders and the push needs: selected is the checkbox that makes the review step real (decision N1), and push_state with pushed_ticket_id or push_error is what happened to this draft individually, because a batch where four issues were created and two failed is the case that decides whether the feature is trustworthy. Sized through issue_estimates.draft_id (decision N3), never through a sizer of its own. Written by AL.4 (#280), pushed by AL.3 (#279).';
comment on column ouroboros.ticket_drafts.batch_id is
  'The batch this was drafted in — the row''s only parent and the whole of its tenancy, as the issue is an estimate''s under V026. Cascades, and its leading place in ticket_drafts_batch_local_key_key is why it has no index of its own.';
comment on column ouroboros.ticket_drafts.local_key is
  'The mono id the card shows and the outline''s dependency notes resolve against — OTA-1. Unique within its batch and meaningless outside it; two batches may each hold an OTA-1. Deliberately carries no pattern: OTA- is outline-v0''s prefix, not this schema''s, and AN.1 (#289) may number its batches differently.';
comment on column ouroboros.ticket_drafts.selected is
  'The checkbox — the review step (decision N1). Unchecking is how a draft is rejected, and regeneration replaces exactly the unselected rows while the estimates of the drafts that remain stay attached. True by default, which is how a freshly generated batch is drawn: the reviewer''s work is to remove.';
comment on column ouroboros.ticket_drafts.suggested_workflow is
  'The row''s workflow tag — opaque (decision K5), as issue_estimates.suggested_workflow is. No vocabulary, because mockup 04 turns the fixed tags into workspace-defined entities. Null is a draft nobody has tagged yet and renders as no chip; outline-v0 supplies one for every draft it produces.';
comment on column ouroboros.ticket_drafts.push_state is
  'What happened to this draft: pending | pushed | failed. Per draft rather than per batch, because a partial push is the ordinary outcome and a batch-level failure would lose which issues exist. pushed is terminal — see ticket_draft_push_state_transition().';
comment on column ouroboros.ticket_drafts.pushed_ticket_id is
  'The canonical ticket (V030) this draft became. Set-null rather than cascade: a ticket deleted in its tracker must not delete the record that this draft was pushed. Held to the workspace of the draft''s batch by ticket_drafts_ticket_in_organization.';
comment on column ouroboros.ticket_drafts.push_error is
  'Why a failed push failed — code, message and an optional detail object, by ticket_draft_push_error_valid(). A structured reason rather than a stringified exception, which is an acceptance criterion and the difference between a card that can branch on a failure and one that can only print it.';
comment on constraint ticket_drafts_batch_local_key_key on ouroboros.ticket_drafts is
  'One local key per batch (#272) — an acceptance criterion, and what makes "blocks OTA-3" resolve to exactly one draft. Two batches may each hold an OTA-1: the key is the planner''s numbering, not an identity.';
comment on constraint ticket_drafts_push_state_coherent on ouroboros.ticket_drafts is
  'Each push state carries its own evidence (#272): pushed carries no error, failed an error and no ticket, pending neither. That a pushed draft names its ticket is held by ticket_draft_push_state_transition() rather than here, because it has one legitimate exception a CHECK cannot express — pushed_ticket_id is on delete set null, and as a CHECK a deleted ticket would refuse the delete instead of clearing the reference, letting a draft veto the removal of a workspace. else false because a CHECK evaluating to null passes.';

create trigger ticket_drafts_touch_updated_at
  before update on ouroboros.ticket_drafts
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A push names its ticket, and `pushed` is terminal.
--
-- Acceptance criterion: push-state transitions are constrained and an invalid one is rejected.
-- Every move except leaving `pushed` is legitimate — `pending → pushed`, `pending → failed`, and
-- `failed →` either, which is what a retry is — so the rule is not a table of pairs but one
-- sentence: a draft that became an issue cannot stop having become one. The tracker will not
-- un-create it, and a row saying otherwise is the schema disagreeing with GitHub.
--
-- Re-pointing `pushed_ticket_id` at a *different* ticket is refused by the same trigger, because
-- pushing a draft twice is that mistake spelled without changing the state — and AL.3's (#279)
-- idempotency is built on this row being the record of the push that already happened.
--
-- The trigger also carries the half of the coherence rule its CHECK cannot: **a draft becomes
-- pushed only with the ticket it became**. Both halves are here for the same reason — each
-- compares the row against something a CHECK cannot see. The terminal rule compares it against
-- its own previous value; the ticket rule has to tell a *write* that claims a push apart from the
-- foreign key's own `on delete set null`, which clears the reference when the ticket or its
-- workspace is deleted and must go through. Refusing that would let a draft veto the removal of
-- a workspace, which is `V029`'s `published_by` exception exactly.
-- ---------------------------------------------------------------------------
create function ouroboros.ticket_draft_push_state_transition()
returns trigger language plpgsql as $$
declare
  -- Whether this row was *already* a push with its ticket, which is the only state from which a
  -- null `pushed_ticket_id` is the foreign key's set-null rather than a claim with no evidence.
  -- Computed under `tg_op` rather than read inline, because `old` is unassigned on an insert and
  -- SQL promises no evaluation order within an `and`.
  was_pushed_with_ticket boolean := false;
begin
  if tg_op = 'UPDATE' then
    was_pushed_with_ticket := old.push_state = 'pushed' and old.pushed_ticket_id is not null;
  end if;

  if new.push_state = 'pushed' and new.pushed_ticket_id is null
     and not was_pushed_with_ticket then
    raise exception
      'draft % cannot be pushed without naming the ticket it became',
      new.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if tg_op = 'INSERT' or old.push_state <> 'pushed' then
    return new;
  end if;

  if new.push_state <> old.push_state then
    raise exception
      'draft % was pushed as ticket %; push_state cannot move from pushed to %',
      old.id, old.pushed_ticket_id, new.push_state
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- A re-point is refused; a *clearing* is not. The second is the foreign key running its own
  -- `on delete set null` — see the header — and the draft stays pushed with the reference gone.
  if new.pushed_ticket_id is not null
     and new.pushed_ticket_id is distinct from old.pushed_ticket_id then
    raise exception
      'draft % was pushed as ticket % and cannot be re-pointed at %',
      old.id, old.pushed_ticket_id, new.pushed_ticket_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.ticket_draft_push_state_transition() is
  'BEFORE INSERT OR UPDATE trigger for ticket_drafts (#272). Two rules a CHECK cannot state: a draft becomes pushed only with the ticket it became, and a draft that has been pushed stays pushed with that ticket. Every other transition is legitimate — pending to either, failed back to either, which is a retry — so the constrained one is what the tracker cannot honour: GitHub will not un-create an issue. The one write it lets through on a pushed draft is the foreign key''s own on delete set null, which clears the reference when the ticket or its workspace goes; refusing that would let a planning draft veto the removal of a workspace. Raises class 23 naming the trigger.';

create trigger ticket_drafts_push_state_transition
  before insert or update of push_state, pushed_ticket_id on ouroboros.ticket_drafts
  for each row execute function ouroboros.ticket_draft_push_state_transition();

comment on trigger ticket_drafts_push_state_transition on ouroboros.ticket_drafts is
  'A draft is pushed only with its ticket, and a pushed draft stays pushed as that ticket (#272). Both rules compare the row against something a CHECK cannot see — its previous value, and the difference between a claimed push and the foreign key''s own set-null.';

-- ---------------------------------------------------------------------------
-- A draft's ticket belongs to the batch's workspace.
--
-- The guard the absent `organization_id` would otherwise have provided. `ticket_drafts` takes its
-- tenancy from its batch (see the header), so this reaches one table further than `V030`'s
-- sibling does — batch to workspace, ticket to workspace, compared.
--
-- It leaks exactly as the others would: one workspace's ticket rendering behind another's draft
-- row, which is a tenancy breach rather than a broken join.
-- ---------------------------------------------------------------------------
create function ouroboros.ticket_draft_ticket_in_organization()
returns trigger language plpgsql as $$
declare
  batch_owner  text;
  ticket_owner text;
begin
  -- A draft with no pushed ticket has nothing to disagree with, which is every draft before its
  -- push and every failed one after it.
  if new.pushed_ticket_id is null then
    return new;
  end if;

  select b.organization_id into batch_owner
    from ouroboros.draft_batches b
   where b.id = new.batch_id;

  select t.organization_id into ticket_owner
    from ouroboros.tickets t
   where t.id = new.pushed_ticket_id;

  -- Either null means the parent went between this statement and its own foreign key, which the
  -- key refuses a moment later and describes better than this could.
  if batch_owner is not null and ticket_owner is not null
     and ticket_owner is distinct from batch_owner then
    raise exception
      'draft % names ticket %, which belongs to organization % rather than its batch''s %',
      new.id, new.pushed_ticket_id, ticket_owner, batch_owner
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.ticket_draft_ticket_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for ticket_drafts (#272): refuses a draft whose pushed ticket belongs to a different workspace than the draft''s batch does. The guard the deliberately absent organization_id would otherwise have provided, reaching one table further than V030''s sibling because a draft takes its tenancy from its batch. Raises class 23 naming the trigger.';

create trigger ticket_drafts_ticket_in_organization
  before insert or update of batch_id, pushed_ticket_id on ouroboros.ticket_drafts
  for each row execute function ouroboros.ticket_draft_ticket_in_organization();

comment on trigger ticket_drafts_ticket_in_organization on ouroboros.ticket_drafts is
  'A draft and the ticket it was pushed as belong to the same workspace (#272) — the isolation rule ticket_drafts'' absent organization_id hands to its batch.';

-- ---------------------------------------------------------------------------
-- The amendment to `V026` (#100): one sizer, two kinds of subject.
--
-- Decision **N3**. See the header for the three consequences; they are the four rules below.
--
-- `add column` and `drop not null` rewrite nothing and default nothing, so every estimate already
-- written reads exactly as it did: an issue estimate with no draft.
-- ---------------------------------------------------------------------------
alter table ouroboros.issue_estimates
  -- The draft this sizes. Cascade, `github_issue_id`'s own posture and for its reason — an
  -- estimate of a draft that is gone cannot be rendered and cannot be graded — and it is *also*
  -- what makes regeneration safe: deleting one unselected draft takes that draft's estimates and
  -- nobody else's, so the drafts that survive keep theirs.
  add column draft_id uuid references ouroboros.ticket_drafts (id) on delete cascade,

  -- Exactly one subject. An estimate is about an issue or about a draft; a row with both would be
  -- two answers wearing one version number, and a row with neither is an estimate of nothing that
  -- no cascade can ever reach.
  add constraint issue_estimates_one_subject
    check (num_nonnulls(github_issue_id, draft_id) = 1),

  -- One version of a draft's estimate, once — `issue_estimates_issue_version_key` for the other
  -- kind of subject, and, read backwards, the index that makes *latest wins* a single indexed
  -- query for a draft too. It is also what makes the monotonicity trigger below safe under
  -- concurrency: two writers that both computed `max(version) + 1` cannot both commit.
  add constraint issue_estimates_draft_version_key unique (draft_id, version);

-- `V026` made this the row's only parent and the whole of its tenancy. It is now one of two, and
-- a draft estimate's tenancy runs through its draft to that draft's batch.
alter table ouroboros.issue_estimates
  alter column github_issue_id drop not null;

comment on column ouroboros.issue_estimates.draft_id is
  'The ticket draft this sizes (#272, decision N3) — the amendment that makes drafts and tickets share one estimation table and one pipeline, because a second sizer would eventually disagree with the first and "all sized" would mean different things on two pages. Exactly one of draft_id and github_issue_id is set. Cascades from the draft, which is what lets regeneration replace the unselected drafts without orphaning the estimates of the ones that remain.';
comment on column ouroboros.issue_estimates.github_issue_id is
  'The issue this sizes, when the subject is an issue. Nullable since V034 (#272): an estimate now has exactly one subject, an issue or a draft, by issue_estimates_one_subject. Cascades, and it remains the whole of an issue estimate''s tenancy.';
comment on constraint issue_estimates_one_subject on ouroboros.issue_estimates is
  'An estimate is about exactly one thing (#272, decision N3): a mirrored issue or a ticket draft, never both and never neither. Both would be two answers wearing one version number; neither would be a row no cascade can reach.';
comment on constraint issue_estimates_draft_version_key on ouroboros.issue_estimates is
  'One version of a draft''s estimate, once (#272) — issue_estimates_issue_version_key for the other kind of subject, and the descending index latest-wins reads. V026''s key cannot cover a draft: with a null github_issue_id a unique key treats every row as distinct.';

-- ---------------------------------------------------------------------------
-- Monotonic versions, for the other kind of subject.
--
-- `V026`'s rule, and its argument unchanged: unique alone would let a draft's estimates be
-- written 3 then 2 — distinct rows, both accepted, and *latest wins* would return the older
-- answer.
--
-- A second trigger rather than a rewrite of `issue_estimate_version_monotonic()`. `V026`'s
-- function is not wrong, it is simply silent here — `where github_issue_id = null` matches
-- nothing, so it finds no highest version and accepts whatever it is given — and replacing it
-- would put the rule for issues in a migration that is not the one that made it. Each subject
-- gets the trigger that watches it.
-- ---------------------------------------------------------------------------
create function ouroboros.issue_estimate_draft_version_monotonic() returns trigger
language plpgsql as $$
declare
  highest integer;
begin
  if new.draft_id is null then
    return new;
  end if;

  select max(version) into highest
    from ouroboros.issue_estimates
   where draft_id = new.draft_id;

  if highest is not null and new.version <= highest then
    raise exception
      'draft % is already sized at version %; a new estimate must be version % or later',
      new.draft_id, highest, highest + 1
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.issue_estimate_draft_version_monotonic() is
  'BEFORE INSERT trigger for issue_estimates (#272): refuses a draft estimate whose version is not above every version that draft already has. V026''s issue_estimate_version_monotonic() for the other kind of subject — a second trigger rather than a rewrite, because V026''s function is not wrong here, only silent: where github_issue_id = null matches nothing. Concurrency is issue_estimates_draft_version_key''s.';

create trigger issue_estimates_draft_version_monotonic
  before insert on ouroboros.issue_estimates
  for each row execute function ouroboros.issue_estimate_draft_version_monotonic();

comment on trigger issue_estimates_draft_version_monotonic on ouroboros.issue_estimates is
  'A draft''s estimate versions ascend (#272). Insert only: an update is refused outright by issue_estimates_no_update, which V026 left in place and this migration does not touch.';
