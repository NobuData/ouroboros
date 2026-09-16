-- V035__ticket_dependencies.sql — `ticket_dependencies`: one dependency model, spanning drafts
-- and live tickets, so `blocks OTA-3` survives the push intact.
--
-- The second migration of the **planning** domain (docs/ROADMAP_MOCKUP_09_PLANNING.md), filed as
-- AK.2 (#273) under epic #268. Mockup 09 draws this relation twice without saying so: the draft
-- rows in the *Generate Tickets* card carry a dependency note — `blocks OTA-3` — and the
-- **Backlog Health** card carries a `Blocked 4` warn meter over the live backlog. Those are not
-- two features. They are the same relation seen at two moments in its life.
--
-- Before a push, `OTA-1 blocks OTA-3` connects two drafts that no tracker has heard of. After it,
-- the same relation connects issue `#612` to issue `#614` and becomes one of the four entries in
-- that meter.
--
-- ---------------------------------------------------------------------------
-- Decision N4 — one table with polymorphic endpoints, rather than two tables and a translation.
-- ---------------------------------------------------------------------------
--
-- The alternative is the obvious one: a draft-local dependency list beside a ticket dependency
-- table. It is rejected here for the reason every two-tables-one-relation split is eventually
-- rejected — it needs a translation step at the push, and the two records then disagree. Not
-- immediately: the first divergence arrives with the first partial push, where four drafts became
-- issues and two did not, and the graph has to describe *both halves at once*.
--
-- So each end of a dependency is **either a draft or a ticket**, as a pair of nullable references
-- with a CHECK admitting exactly one. Three shapes are therefore representable, which is the
-- issue's first acceptance criterion and the whole of N4:
--
--   * **draft → draft** — the batch under review, before anything is pushed.
--   * **ticket → ticket** — the live backlog, after the push, and what the Blocked meter counts.
--   * **draft → ticket** (and its mirror) — the half-pushed batch, and the ordinary case of a new
--     draft that blocks, or is blocked by, an issue that already existed.
--
-- The third shape is the one that makes the design worth its CHECKs. A batch caught mid-push has
-- a **coherent** graph rather than an inconsistent one: some edges draft-to-draft, some
-- ticket-to-ticket, some spanning, every one of them readable. Under the two-table split that
-- state is unrepresentable, and a resumed push would have to reconstruct it from the drafts'
-- push states — which is exactly the reconstruction that gets it wrong.
--
-- **What the push does to these rows is an `update`, not a delete and re-insert.** AL.3 (#279)
-- rewrites draft references to ticket references **in the same transaction** that creates the
-- tickets, which is the third acceptance criterion. Nothing here has to enforce that — a
-- transaction is what makes it atomic — but two things here are what make it *expressible*: the
-- endpoint columns are nullable in both directions, so `blocker_draft_id → null,
-- blocker_ticket_id → #612` is one statement, and the drafts themselves survive the push
-- (`V034`'s `push_state`), so nothing cascades out from under the edge while it is being
-- rewritten.
--
-- ---------------------------------------------------------------------------
-- `origin` — a block is a block, whoever authored it.
-- ---------------------------------------------------------------------------
--
-- `planned` is a dependency **authored here**: somebody described the work and the planner, or a
-- reviewer, said that one ticket blocks another. `synced` is one **mirrored back from a tracker's
-- native relations** (WF-Q sync) — somebody linked two issues in GitHub directly, and Ouroboros
-- read it.
--
-- The column exists because the two have different provenance and the same consequence. A
-- blocked ticket is blocked either way, so AL.5's (#281) Blocked metric counts **both** — the
-- sixth acceptance criterion — and a metric that counted only what this product authored would
-- under-report the backlog it is supposed to be describing. What `origin` is for is everything
-- else: which edges a push may create in a tracker (its own, not the tracker's), which it may
-- retract, and which are somebody else's to change.
--
-- It is a closed CHECK rather than `V034`'s open grammar, and the difference is real rather than
-- inconsistent: `planner` names a *family* nobody can enumerate (`analyzer-vN`), while this names
-- the two directions a relation can have arrived from. There is no third, because a dependency is
-- either read out of a tracker or it is not.
--
-- ---------------------------------------------------------------------------
-- The unique key, and why `nulls not distinct` is what makes it a key at all.
-- ---------------------------------------------------------------------------
--
-- *"Duplicate pairs are rejected regardless of which endpoint kinds are used"* is an acceptance
-- criterion, and the default behaviour of a unique index defeats it completely. Three of the four
-- endpoint columns are null in any given row, and PostgreSQL's default is that nulls are
-- **distinct** — so `(OTA-1, null, OTA-3, null)` would be unique against an identical row, every
-- time, and the table would accept the same edge without limit.
--
-- `unique nulls not distinct` is `V012`'s argument (`model_prices_match_key`) reaching a second
-- table for the same reason: the nulls here are not unknowns, they are *"this end is not that
-- kind"*, and two rows that agree on all four columns are the same edge.
--
-- `V029` declined the same construct, and the distinction is worth stating because the two reads
-- like a contradiction. There, `unique nulls not distinct (workflow_id, version)` would have
-- folded **two rules into one name** — *at most one draft* and *version numbers do not collide* —
-- and a writer told the wrong one has been told the wrong thing. Here there is exactly one rule,
-- `ticket_dependencies_pair_key`, and the name says it: this pair already exists.
--
-- **`origin` is deliberately not in the key.** A planned edge the tracker then reports back is
-- *the same edge*, so the sync upserts onto this key rather than inserting a second row beside
-- it. Two rows for one relation would double it in the Blocked meter, which is the one number
-- this table exists to make true.
--
-- ---------------------------------------------------------------------------
-- Acyclicity is enforced service-side; this migration's job is to make a stored cycle findable.
-- ---------------------------------------------------------------------------
--
-- There is no acyclicity constraint here, and that is a decision rather than an omission.
-- Detecting a cycle means *walking the graph*, which a CHECK cannot do and a constraint trigger
-- could only do by re-walking it on every write. AL.4 (#280) validates it on every write instead.
--
-- What the database owes that arrangement is **detectability**: if a service bug ever lets a
-- cycle through, the damage is silent. It is not an error — it is a batch that can never be
-- pushed, because AL.3 pushes in dependency order and a cycle has no order. So the stored graph
-- has to be walkable by a probe, and AK.5's (#276) recursive CTE is what walks it, in ci/db,
-- where a planted cycle fails the build rather than a user's push.
--
-- One property of the columns below is what makes that probe a single CTE rather than a
-- four-branch join: an endpoint's node identity is `coalesce(draft_id, ticket_id)`. Both are
-- `uuid` primary keys, generated by `gen_random_uuid()` in two different tables, so one
-- expression names a node whichever kind it is and no draft can ever collide with a ticket.
-- tests/constraints.sql walks it exactly that way, on a planted cycle and on an acyclic graph, so
-- the technique AK.5 wires into CI is proven against this schema in the migration that ships it.
--
-- ---------------------------------------------------------------------------
-- Tenancy, and the four references that have to agree with it.
-- ---------------------------------------------------------------------------
--
-- `organization_id` is carried here rather than inferred, unlike `ticket_drafts`' — which
-- deliberately has none, because its batch is the whole of its tenancy. An edge has **two**
-- parents of two possible kinds, so there is no single parent to inherit from, and every read
-- this table has is scoped by workspace first.
--
-- Carrying it means it can disagree with the endpoints, and nothing about a foreign key makes two
-- of them agree with each other or with the row that names them. A ticket endpoint reaches a
-- workspace directly (`tickets.organization_id`); a draft endpoint reaches one through its batch,
-- one table further, as `V034`'s own guard does. `ticket_dependencies_endpoints_in_organization`
-- holds all four against the row's own workspace, which is the eighth acceptance criterion.
--
-- It leaks the way the others would: one workspace's ticket titles rendering as another's
-- blockers, which is a tenancy breach rather than a broken join.
--
-- Filed as issue #273 (AK.2). Needs #272 (`V034`) and #138 (`V030`). Blocks #275, #279, #280,
-- #281 and #284; probed by #276. Asserted in tests/constraints.sql.

-- ---------------------------------------------------------------------------
-- ticket_dependencies
--
-- One `blocks` relation, at any moment in its life: between two drafts, between two tickets, or
-- across the seam a push is in the middle of closing.
-- ---------------------------------------------------------------------------
create table ouroboros.ticket_dependencies (
  id                uuid        primary key default gen_random_uuid(),

  -- The workspace this dependency belongs to, and the leading column of the metric read below.
  -- Carried rather than inherited: an edge has two parents of two possible kinds, so there is no
  -- one parent to take it from. Cascade, as every planning table above — a deleted workspace must
  -- not leave a graph behind describing tickets nobody can reach.
  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,

  -- --- the blocker endpoint: the thing that must be done first --------------------
  --
  -- Exactly one of the two is set, by `ticket_dependencies_blocker_one_kind`. Both cascade, and
  -- for the same reason the other end's do: an edge is a *relation*, and half an edge is not a
  -- degraded relation but nothing at all — there is no row left to render, count or push. That is
  -- a different answer from `ticket_drafts.pushed_ticket_id`'s `on delete set null` (`V034`) and
  -- the difference is not an inconsistency: a draft whose ticket is deleted is still truthfully a
  -- draft that was pushed, so it survives with a cleared reference. An edge whose blocker is
  -- deleted is not a dependency on anything.
  --
  -- The draft cascade is also what makes regeneration safe, inheriting `V034`'s placement rather
  -- than restating it: replacing the unselected drafts takes their edges with them, and the
  -- drafts that survive keep theirs.
  blocker_draft_id  uuid        references ouroboros.ticket_drafts (id) on delete cascade,
  blocker_ticket_id uuid        references ouroboros.tickets (id) on delete cascade,

  -- --- the blocked endpoint: the thing that waits ---------------------------------
  --
  -- Same discipline, same cascades, by `ticket_dependencies_blocked_one_kind`. This is the end
  -- AL.5's (#281) Blocked metric counts and the end AL.3 (#279) orders a push by.
  blocked_draft_id  uuid        references ouroboros.ticket_drafts (id) on delete cascade,
  blocked_ticket_id uuid        references ouroboros.tickets (id) on delete cascade,

  -- Where this relation came from: `planned` authored in Ouroboros, `synced` mirrored back from a
  -- tracker's native relations. Defaulted to `planned`, because that is what a writer with an
  -- opinion about a dependency is doing; a sync says so explicitly.
  origin            text        not null default 'planned',

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- --- the rules -------------------------------------------------------------------

  -- Two directions a relation can have arrived from, closed because there is no third: a
  -- dependency is either read out of a tracker or it is not. See the header for why this is a
  -- CHECK where `draft_batches.planner` is a grammar.
  constraint ticket_dependencies_origin
    check (origin in ('planned', 'synced')),

  -- Exactly one kind per endpoint — the second acceptance criterion, once per end. Both set is
  -- an edge claiming its blocker is simultaneously a draft and a live ticket; neither is an edge
  -- with one end attached to nothing, which no cascade can ever reach and no reader can render.
  --
  -- `num_nonnulls` rather than a hand-written pair of `is null`s, which is `V034`'s
  -- `issue_estimates_one_subject` — the same rule about the same kind of polymorphic reference,
  -- and the one already in this schema's vocabulary.
  constraint ticket_dependencies_blocker_one_kind
    check (num_nonnulls(blocker_draft_id, blocker_ticket_id) = 1),
  constraint ticket_dependencies_blocked_one_kind
    check (num_nonnulls(blocked_draft_id, blocked_ticket_id) = 1),

  -- Nothing blocks itself — the fourth acceptance criterion. A self-edge is a one-node cycle, so
  -- it is the one shape of unpushable batch a CHECK *can* catch, and catching it here keeps it
  -- out of the graph AL.4 (#280) walks.
  --
  -- Written as a null-guarded inequality per kind rather than `is distinct from`, which reads
  -- better and would be wrong: `null is distinct from null` is false, so the tidy spelling would
  -- reject every ticket→ticket edge (both draft columns null) and every draft→draft one. The
  -- comparison only has meaning when both ends are the same kind, and that is what these say.
  constraint ticket_dependencies_no_self_reference
    check (
      (blocker_draft_id is null or blocked_draft_id is null
       or blocker_draft_id <> blocked_draft_id)
      and
      (blocker_ticket_id is null or blocked_ticket_id is null
       or blocker_ticket_id <> blocked_ticket_id)
    ),

  -- One edge, once, whichever kinds its ends are — the fifth acceptance criterion.
  --
  -- `nulls not distinct` is load-bearing and not decoration: three of these four columns are null
  -- in any row, and under the default nulls-are-distinct rule this key would accept the same edge
  -- without limit. See the header for `V012`'s precedent and why `V029` declining the same
  -- construct is not a contradiction. `origin` is deliberately absent from the key: a planned
  -- edge a tracker reports back is the same edge, and the sync upserts onto this.
  constraint ticket_dependencies_pair_key
    unique nulls not distinct (blocker_draft_id, blocker_ticket_id,
                               blocked_draft_id, blocked_ticket_id)
);

comment on table ouroboros.ticket_dependencies is
  'The blocks relation over drafts and canonical tickets alike (#273, decision N4) — mockup 09''s "blocks OTA-3" draft note and the Backlog Health card''s Blocked meter, which are the same relation at two moments in its life. Each endpoint is exactly one of a ticket_drafts row or a tickets row, so draft-to-draft, ticket-to-ticket and spanning edges are all representable and a half-pushed batch has a coherent graph rather than an inconsistent one. AL.3 (#279) rewrites draft references to ticket references in the same transaction that creates the tickets. Acyclicity is enforced service-side by AL.4 (#280) and probed over stored rows by AK.5 (#276): a cycle is not an error but a batch that can never be pushed.';

comment on column ouroboros.ticket_dependencies.organization_id is
  'The workspace this dependency belongs to (#273). Carried rather than inherited from a parent, unlike ticket_drafts'' absent column: an edge has two parents of two possible kinds, so there is no single one to take tenancy from. Held in agreement with all four endpoint references by ticket_dependencies_endpoints_in_organization.';
comment on column ouroboros.ticket_dependencies.blocker_draft_id is
  'The blocker, when it is still a draft (#273) — the end mockup 09''s "blocks OTA-3" note is rendered from. Exactly one of this and blocker_ticket_id is set. Cascades: an edge whose blocker is gone is not a degraded dependency but none at all, which is also what lets regeneration replace the unselected drafts and take their edges with them.';
comment on column ouroboros.ticket_dependencies.blocker_ticket_id is
  'The blocker, once it is a live ticket (#273) — what this column becomes at the push, rewritten from blocker_draft_id in the same transaction that creates the ticket (AL.3, #279). Exactly one of this and blocker_draft_id is set; cascades, for that column''s reason.';
comment on column ouroboros.ticket_dependencies.blocked_draft_id is
  'The blocked end, while it is still a draft (#273). Exactly one of this and blocked_ticket_id is set; cascades, as the blocker end does. This is the end AL.3 (#279) orders a dependency-ordered push by.';
comment on column ouroboros.ticket_dependencies.blocked_ticket_id is
  'The blocked end, once it is a live ticket (#273) — what AL.5''s (#281) Blocked backlog-health metric counts, over both origins. Exactly one of this and blocked_draft_id is set; cascades, as the blocker end does.';
comment on column ouroboros.ticket_dependencies.origin is
  'Whether this dependency was authored here (planned) or mirrored back from a tracker''s native relations (synced, via WF-Q sync) — #273. The Blocked metric counts both, because a blocked ticket is blocked whoever authored the link; what origin decides is which edges a push may create or retract in a tracker and which are somebody else''s to change. Deliberately not part of ticket_dependencies_pair_key: a planned edge a tracker reports back is the same edge.';

comment on constraint ticket_dependencies_origin on ouroboros.ticket_dependencies is
  'Two directions a relation can have arrived from (#273): authored here, or read out of a tracker. A closed CHECK rather than draft_batches.planner''s open grammar, because there is no third — that column names a family nobody can enumerate, this one names the only two provenances a dependency has.';
comment on constraint ticket_dependencies_blocker_one_kind on ouroboros.ticket_dependencies is
  'The blocker is exactly one thing (#273, decision N4): a ticket draft or a canonical ticket, never both and never neither. Both would claim one end is simultaneously a draft and a live ticket; neither would leave an end attached to nothing that no cascade can reach. V034''s issue_estimates_one_subject, for the same kind of polymorphic reference.';
comment on constraint ticket_dependencies_blocked_one_kind on ouroboros.ticket_dependencies is
  'The blocked end is exactly one thing (#273, decision N4) — ticket_dependencies_blocker_one_kind''s rule for the other endpoint, stated separately so a rejected write names the end that was wrong.';
comment on constraint ticket_dependencies_no_self_reference on ouroboros.ticket_dependencies is
  'Nothing blocks itself (#273). A self-edge is a one-node cycle, and so the one unpushable shape a CHECK can catch without walking the graph — the rest is AL.4''s (#280). Spelled as a null-guarded inequality per kind rather than with is distinct from, which would reject every same-kind edge: null is distinct from null is false.';
comment on constraint ticket_dependencies_pair_key on ouroboros.ticket_dependencies is
  'One edge, once, whichever kinds its ends are (#273). nulls not distinct is what makes this a key at all — three of the four columns are null in any row, and under the default rule an identical edge would be unique against its twin every time (V012''s model_prices_match_key argument, a second table on). origin is out of the key on purpose, so a sync upserts a planned edge the tracker reports back rather than doubling it in the Blocked meter.';

-- ---------------------------------------------------------------------------
-- The reads, and the one cascade deliberately left a scan.
--
-- `ticket_dependencies_pair_key` is already an index on `(blocker_draft_id, …)`, so *what does
-- this draft block* and `ticket_drafts`' cascade on that column both enter through it. The three
-- below are the other three entrances.
-- ---------------------------------------------------------------------------

-- AL.5's (#281) Blocked metric — *"how many tickets in this workspace are blocked"* — and the
-- workspace cascade above it. Not partial, deliberately: a `where blocked_ticket_id is not null`
-- index would be smaller and would stop serving the `organization_id` cascade for every
-- draft-blocked edge, which is the one read here that touches every row of a workspace at once.
create index ticket_dependencies_organization_blocked_ticket_idx
  on ouroboros.ticket_dependencies (organization_id, blocked_ticket_id);

comment on index ouroboros.ticket_dependencies_organization_blocked_ticket_idx is
  'AL.5''s (#281) Blocked backlog-health metric, and the organization cascade (#273). Left non-partial so the workspace delete enters through it whatever kind each edge''s blocked end is.';

-- *What blocks this draft* — AL.3's (#279) dependency-ordered push, which reads the in-edges of
-- every draft in a batch — and `ticket_drafts`' cascade on this column. Partial because the
-- question is only ever asked of a draft: a null here means the blocked end is a ticket, and
-- there is no read that wants those rows grouped under one null key.
create index ticket_dependencies_blocked_draft_idx
  on ouroboros.ticket_dependencies (blocked_draft_id)
  where blocked_draft_id is not null;

comment on index ouroboros.ticket_dependencies_blocked_draft_idx is
  'What blocks this draft (#273) — AL.3''s (#279) dependency-ordered push reads the in-edges of every draft in a batch — and ticket_drafts'' cascade on this column. Partial: a null means the blocked end is a live ticket, and no read wants those under one key.';

-- *What does this ticket block* — the live backlog's side of the same question — and `tickets`'
-- cascade on this column. Partial, for the reason above.
create index ticket_dependencies_blocker_ticket_idx
  on ouroboros.ticket_dependencies (blocker_ticket_id)
  where blocker_ticket_id is not null;

comment on index ouroboros.ticket_dependencies_blocker_ticket_idx is
  'What does this ticket block (#273), and tickets'' cascade on this column. Partial, as ticket_dependencies_blocked_draft_idx is: a null here means the blocker is still a draft.';

-- `blocked_ticket_id`'s cascade from `tickets` enters through the composite index above, whose
-- leading column a delete of a single ticket does not know — so that one delete is a scan, on
-- purpose. Adding a fourth index to serve it would be paid for on every write of every edge, and
-- deleting a canonical ticket is a workspace-shaped event rather than a per-row one.

create trigger ticket_dependencies_touch_updated_at
  before update on ouroboros.ticket_dependencies
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Both endpoints belong to the row's own workspace.
--
-- The eighth acceptance criterion, and four references rather than `V034`'s one. A ticket reaches
-- a workspace directly; a draft reaches one through its batch, which is the table further this
-- has to look — `ticket_drafts` carries no `organization_id` because its batch is the whole of
-- its tenancy.
--
-- Two foreign keys do not make each other agree, and neither makes either agree with
-- `organization_id`. Without this, an edge could name one workspace's draft as the blocker of
-- another's ticket, and the Blocked meter would count it: one workspace's tickets rendering as
-- another's blockers, which is a tenancy breach rather than a broken join.
-- ---------------------------------------------------------------------------
create function ouroboros.ticket_dependency_endpoints_in_organization()
returns trigger language plpgsql as $$
declare
  endpoint record;
  owner    text;
begin
  -- The four references walked as a list rather than as four copies of the same eight lines.
  -- Each carries the column it came from, because *which end was wrong* is the useful half of
  -- the message, and the kind, because that decides how far the row is from a workspace.
  for endpoint in
    select *
      from (values
              ('blocker_draft_id',  'draft',  new.blocker_draft_id),
              ('blocker_ticket_id', 'ticket', new.blocker_ticket_id),
              ('blocked_draft_id',  'draft',  new.blocked_draft_id),
              ('blocked_ticket_id', 'ticket', new.blocked_ticket_id)
           ) as e (endpoint_column, kind, endpoint_id)
     where e.endpoint_id is not null
  loop
    if endpoint.kind = 'draft' then
      -- One table further than a ticket: `ticket_drafts` carries no `organization_id`, so a
      -- draft's workspace is its batch's — `V034`'s own guard, reaching the same way.
      select b.organization_id into owner
        from ouroboros.ticket_drafts d
        join ouroboros.draft_batches b on b.id = d.batch_id
       where d.id = endpoint.endpoint_id;
    else
      select t.organization_id into owner
        from ouroboros.tickets t
       where t.id = endpoint.endpoint_id;
    end if;

    -- Null means the endpoint went between this statement and its own foreign key, which the key
    -- refuses a moment later and describes better than this could — `V030`'s reasoning, and
    -- `V034`'s.
    if owner is not null and owner is distinct from new.organization_id then
      raise exception
        'dependency names % % in organization % rather than %',
        endpoint.kind, endpoint.endpoint_id, owner, new.organization_id
        using errcode = 'check_violation',
              constraint = tg_name,
              detail = format('the offending endpoint is %s', endpoint.endpoint_column);
    end if;
  end loop;

  return new;
end;
$$;

comment on function ouroboros.ticket_dependency_endpoints_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for ticket_dependencies (#273): refuses an edge either of whose endpoints belongs to a different workspace than the edge does. Four references rather than V034''s one, and two distances — a ticket reaches a workspace directly, a draft through its batch, because ticket_drafts carries no organization_id. Without it one workspace''s draft could be recorded as the blocker of another''s ticket and counted in its Blocked meter, which is a tenancy breach rather than a broken join. Raises class 23 naming the trigger, with the offending column in the detail.';

create trigger ticket_dependencies_endpoints_in_organization
  before insert or update of organization_id, blocker_draft_id, blocker_ticket_id,
                             blocked_draft_id, blocked_ticket_id
                             on ouroboros.ticket_dependencies
  for each row execute function ouroboros.ticket_dependency_endpoints_in_organization();

comment on trigger ticket_dependencies_endpoints_in_organization on ouroboros.ticket_dependencies is
  'An edge and both of its endpoints belong to the same workspace (#273) — the isolation rule four separate foreign keys cannot state, since none of them makes the others, or organization_id, agree. Covers the push rewrite too: AL.3 (#279) repoints an endpoint from a draft to a ticket, and the new reference is checked as the original was.';
