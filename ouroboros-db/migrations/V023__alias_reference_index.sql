-- V023__alias_reference_index.sql — one answer to *"what references this alias?"*, for the
-- four surfaces that ask it and for the two guards that must not be wrong about it.
--
-- Filed as issue #581 (CG.3). Reads Y.2 (#190) route hops and Y.3 (#191) escalation rules,
-- over CG.1's (#579) `model_aliases`. Blocks CG.4 (#582), CH.1 (#584) and CH.5 (#588).
--
-- Mockup 21 (docs/mockups/21-model-registry.html) asks the question four times on one
-- screen — the table's `USED BY` column, the inspector's chip list, the blocked *Remove*
-- button, and the rename the inspector also offers:
--
--   USED BY  (implement-primary)(plan-primary)(review-primary)(escalation:effort≥L)
--   [Remove — blocked]   blocked — 4 routes reference this alias
--
--   "Aliases are unique per workspace. Deleting one is blocked while any route or
--    workflow references it."
--
-- Four questions, one answer, and this file is the only place that answer is computed.
--
-- ---------------------------------------------------------------------------
-- Why a view and not a counter column.
-- ---------------------------------------------------------------------------
--
-- The reference lives in four incompatible shapes. A route hop is a **foreign key**
-- (`route_hops.model_alias_id`, V016). An escalation rule's target is a **name inside a
-- jsonb document** (`escalation_rules."then"`, V018). A workflow `llm` node names an alias
-- **by name inside a versioned jsonb document** (WF-P.1/P.2, not yet in this schema). A chat
-- route pin does not exist yet at all (BZ.3, #537). Four writers, two of them writing jsonb,
-- is exactly the arrangement where a trigger-maintained counter goes quietly wrong — and a
-- wrong count here is not a wrong number on a screen, it is a delete guard that lets a
-- referenced alias vanish. Decision **R5**, option 4-A over 4-B: **no stored counts
-- anywhere.** The column, the chips and both guards read this one definition, so they cannot
-- disagree with each other, and a leg that is added later is added once.
--
-- The `Used by` **count** is therefore a query rather than a column, and the zero state is a
-- left join rather than a row:
--
--   select a.id, count(r.ref_id) as used_by
--     from ouroboros.model_aliases a
--     left join ouroboros.alias_references r on r.alias_id = a.id
--    where a.organization_id = $1
--    group by a.id;
--
-- That is what makes `gpt5-experiments` read `0 routes` without anything storing a zero.
--
-- ---------------------------------------------------------------------------
-- The two legs that exist, and the two that do not.
-- ---------------------------------------------------------------------------
--
-- `route` and `escalation` are built below. `workflow` and `chat_pin` are **declared and
-- unbuilt**, which is a deliberate degradation rather than an omission:
--
--   * **`workflow`** needs `workflow_versions` (WF-P.1, #132) and the WF-P.2 (#133)
--     amendment CH.6 (#589) carries — `llm` nodes referencing a registry alias structurally
--     rather than by raw model string. Neither has landed, so there is no table to union and
--     no document shape to read. A leg written against a table that does not exist is not a
--     graceful degradation; it is a migration that will not apply.
--   * **`chat_pin`** needs BZ.3's (#537) route-pin storage, which does not exist either.
--
-- **While absent, each contributes zero rows and never errors** — which is what a leg that is
-- not in the union does. What is *not* left to a future reader to work out is where it goes:
-- `ouroboros.alias_reference_kind` already carries all four names, so the output shape is
-- stable from today, and the wiring point is one `create or replace view` naming the leg —
--
--   -- once workflow_versions exists (#132) and its llm nodes are structural (#133/#589):
--   create index workflow_versions_alias_refs_idx
--     on ouroboros.workflow_versions using gin (ouroboros.workflow_alias_refs(definition));
--   create or replace view ouroboros.alias_references as
--     <the route leg below>
--     union all <the escalation leg below>
--     union all
--     select v.organization_id, a.id, a.alias, 'workflow'::ouroboros.alias_reference_kind,
--            v.id, 'workflow:' || w.slug || '@v' || coalesce(v.version::text, 'draft'),
--            v.version is not null                                       -- see `blocking`
--       from ouroboros.workflow_versions v
--       join ouroboros.workflows w on w.id = v.workflow_id
--       join ouroboros.model_aliases a
--         on a.organization_id = v.organization_id
--        and a.alias = any (ouroboros.workflow_alias_refs(v.definition));
--
-- — where `workflow_alias_refs(definition)` is the `immutable` extractor that expression
-- index is built on, and is deliberately **not** written here: it has to read the DSL's node
-- shape, and #133 has not decided that shape yet. Writing it now would be this schema
-- inventing a document format three tickets ahead of the ticket that owns it.
--
-- Two acceptance criteria of #581 therefore cannot be met by this migration and are named
-- rather than quietly dropped: *a workflow-version fixture is found via the expression
-- index*, and *draft-only references are distinguishable from published*. Both are the
-- workflow leg's, both arrive with it, and `blocking` exists below so that the second one is
-- a value rather than a schema change.
--
-- ---------------------------------------------------------------------------
-- The labels are the mockup's chips, verbatim.
-- ---------------------------------------------------------------------------
--
-- `ref_label` is the chip text and nothing else has to be assembled to render it. A route
-- reference is labelled with the route's tag — `implement-primary` — because that is the
-- word the operator gave that route and the word the matrix draws. An escalation reference is
-- labelled `escalation:effort≥L`, prefix included, because that is the chip beside the other
-- three and the prefix is what tells a reader it is not a fourth route.
--
-- **The escalation chip is derived from the rule's structure, not from its sentence.** V018's
-- `display` is *"effort ≥ L → implement uses coder-max (max thinking)"* — the whole rule, and
-- a chip is the predicate half of it with the comparison closed up. Cutting that half out of
-- the sentence with string surgery is tempting and is wrong: a rule's `label` condition
-- carries a **GitHub label name**, which V018 bounds and does not otherwise constrain, so a
-- repository with a label containing the separator would make the surgery cut in the wrong
-- place. `ouroboros.escalation_reference_label()` reads `"when"` instead, exactly as
-- `escalation_rule_display()` does, in the same clause order and with the same wording.
--
-- That leaves two renderings of one grammar, which is a real cost and is paid deliberately:
-- V018's `display` backs a **stored generated column**, so it cannot be refactored into a
-- shared clause renderer without rewriting a column that is already on disk. The coupling is
-- made testable instead — tests/constraints.sql asserts, over a fixture of every condition
-- key, that the chip is the sentence's predicate half with the operator closed up. A wording
-- change in either function that is not made in both goes red there.
--
-- ---------------------------------------------------------------------------
-- `blocking`, and why every row is true today.
-- ---------------------------------------------------------------------------
--
-- A route hop and an escalation rule both *break* if the alias goes away — the hop by foreign
-- key, the rule by V018's deferred constraint trigger — so both are `true`, and every row this
-- view can currently produce is a hard reference. The column is here for the workflow leg,
-- where a **published** version is a promise the workspace has made and a **draft** is
-- somebody's unfinished edit: a draft reference is reported, so the inspector can warn, and
-- does not block a delete. CH.1 (#584) renders `blocking` rows into a **409** and the rest
-- into a **422** with a warning, which is why the distinction is a column here rather than a
-- rule there.
--
-- ---------------------------------------------------------------------------
-- The guard is a lock, not a count.
-- ---------------------------------------------------------------------------
--
-- `select count(*) …` then `delete …` is two statements, and between them a concurrent route
-- save can add the hop the count did not see. The foreign key catches that particular case —
-- `route_hops_alias_fk` restricts, so the delete fails — but it fails with a raw referential
-- error naming a constraint, *after* the service has already decided the delete was allowed.
-- The designed refusal CH.1 owes the user names the routes; a 500 does not.
--
-- So `ouroboros.alias_reference_guard()` takes the lock **before** it counts, and the caller
-- runs both inside its own transaction:
--
--   begin;
--     select * from ouroboros.alias_reference_guard($org, $alias);  -- 0 rows ⇒ safe
--     delete from ouroboros.model_aliases where organization_id = $org and id = $alias;
--   commit;
--
-- **`for update` on the alias row, and `for share` would not do.** PostgreSQL takes a
-- `for key share` lock on the *referenced* row when a referencing row is inserted, and
-- `for key share` does not conflict with `for share` — a concurrent route save would sail
-- past a share lock and make the guard's answer stale the moment it was given. `for update`
-- is the weakest mode that conflicts with it, so a route save aimed at this alias waits until
-- the guarding transaction ends and then meets the foreign key against a committed state.
-- Either order is now safe *and* honest: the guard's list is still true when the delete runs.
--
-- The referencing rows themselves are deliberately **not** locked. Locking them would only
-- prevent a referrer from being *removed* while the guard's caller decides — which can turn a
-- delete that was about to become legal into one that is refused, and never the other way
-- round. Refusing a delete a moment too long is the safe direction and needs no lock to
-- achieve; the caller retries.
--
-- **What this does not close, stated rather than implied.** A rule naming this alias is
-- written by name into `escalation_rules` and touches no row of `model_aliases`, so the lock
-- above does not serialise against it. V018's deferred constraint trigger is what does:
-- it fires on `after delete on model_aliases`, re-reads the workspace's rules at commit time
-- under a fresh snapshot, and refuses the delete if a rule has appeared. The window it leaves
-- is the one every deferred check leaves — two transactions whose commit-time checks
-- interleave — and it is V018's to close with `serializable` if it is ever worth closing.
-- This migration does not widen it and does not pretend to have closed it.
--
-- ---------------------------------------------------------------------------
-- Indexing.
-- ---------------------------------------------------------------------------
--
-- `Used by` for eight rows must be one indexed pass rather than eight document scans. The
-- route leg already has its index — V016's `route_hops_alias_idx` on
-- `(organization_id, model_alias_id)`, created for the delete restrict and earning its place
-- a third time here. The escalation leg gets one below, on the expression the join is over,
-- because a jsonb target inside a document has no column to index.
--
-- Both entries into `model_aliases` are covered already: by `id`, the primary key; by
-- `(organization_id, alias)`, V015's uniqueness constraint, which is how the criterion's
-- `alias_references('coder-max')` reads.
--
-- House snake_case throughout — decision **A4**.

-- ---------------------------------------------------------------------------
-- The four reference kinds, as a domain.
--
-- A domain rather than a CHECK for the reason V018 gives its two: a view cannot carry a
-- constraint, so this is the only place the vocabulary can be a schema object at all — and
-- being one is what lets tests/constraints.sql assert that the shape is stable while two of
-- the four legs are still unbuilt, and what makes adding a fifth kind a migration rather
-- than a string somebody typed into a union.
-- ---------------------------------------------------------------------------
create domain ouroboros.alias_reference_kind as text
  constraint alias_reference_kind_known
    check (value in ('route', 'escalation', 'workflow', 'chat_pin'));

comment on domain ouroboros.alias_reference_kind is
  'Which storage shape a reference to a model alias lives in (#581, decision R5): route (route_hops, a foreign key — V016), escalation (escalation_rules."then", a name inside jsonb — V018), workflow (an llm node inside workflow_versions.definition — WF-P.1 #132 with the WF-P.2 #133 amendment) and chat_pin (BZ.3 #537 route pins). All four are declared from the start so alias_references has a stable output shape; the last two contribute no rows until their storage exists.';

-- ---------------------------------------------------------------------------
-- The alias an escalation rule names, as an indexable expression.
--
--   rule_then — an escalation_rules."then" document, already inside V018's grammar
--   returns   — the alias it targets, or null for {route_local: {}}, which targets none
--
-- `immutable` and `strict`, which is what an expression index requires; `sql` rather than
-- `plpgsql` because it is one expression and has no control flow to hide.
-- ---------------------------------------------------------------------------
create function ouroboros.escalation_rule_alias(rule_then jsonb)
returns text
language sql
immutable
strict
as $$
  select coalesce(rule_then #>> '{use_alias,alias}', rule_then #>> '{add_vote,alias}')
$$;

comment on function ouroboros.escalation_rule_alias(jsonb) is
  'The model alias an escalation rule targets (#581), read out of V018''s "then" document: use_alias and add_vote both name one, route_local names none and answers null. The expression escalation_rules_alias_idx is built on, and the join the alias_references escalation leg is — a rule''s target is a name inside jsonb, so there is no column to index and no foreign key to follow.';

-- ---------------------------------------------------------------------------
-- The chip mockup 21 draws for an escalation reference.
--
--   rule_when — an escalation_rules."when" predicate, already inside V018's grammar
--   returns   — the chip, prefix included: `escalation:effort≥L`
--
-- The predicate half of V018's sentence, rendered from the structure rather than cut out of
-- the sentence — see the header for the GitHub label that makes the surgery unsafe. Same
-- clause order, same wording and the same ` and ` join as escalation_rule_display(), with the
-- one difference a chip needs: `effort≥L` rather than `effort ≥ L`, because the space around
-- a comparison is typography a chip does not have room for.
-- ---------------------------------------------------------------------------
create function ouroboros.escalation_reference_label(rule_when jsonb)
returns text
language sql
immutable
strict
as $$
  select 'escalation:' || array_to_string(
    array_remove(array[
      case when rule_when ? 'effort_gte'
           then 'effort≥' || upper(rule_when ->> 'effort_gte') end,
      case when rule_when ? 'label'
           then (rule_when ->> 'label') || ' label' end,
      case when rule_when ? 'diff_kind'
           then replace(rule_when ->> 'diff_kind', '_', '-') || ' diff' end
    ], null),
    ' and ')
$$;

comment on function ouroboros.escalation_reference_label(jsonb) is
  'Mockup 21''s escalation chip — "escalation:effort≥L" (#581). The predicate half of V018''s generated display sentence, derived from "when" rather than cut out of the sentence: a rule''s label condition carries a GitHub label name, so the sentence has no separator a substring is safe to cut at. The prefix is part of the label because it is part of the chip; a route reference carries its route tag and nothing else. tests/constraints.sql holds the two renderings to each other.';

-- ---------------------------------------------------------------------------
-- The escalation leg's index.
--
-- The join is `model_aliases.alias = escalation_rule_alias("then")` within a workspace, so
-- the index is that expression under `organization_id` — the leading column every read in
-- this schema enters through, and the one that keeps a workspace's lookup off every other
-- workspace's rules.
--
-- Partial, because `{route_local: {}}` names no alias and an index entry for a row that can
-- never match is a row every write maintains for nothing. The planner may use a partial index
-- here without help: `=` is strict, so a qual of `escalation_rule_alias("then") = <alias>`
-- proves the predicate on its own.
-- ---------------------------------------------------------------------------
create index escalation_rules_alias_idx
  on ouroboros.escalation_rules (organization_id, ouroboros.escalation_rule_alias("then"))
  where ouroboros.escalation_rule_alias("then") is not null;

comment on index ouroboros.escalation_rules_alias_idx is
  'The escalation leg of alias_references (#581): which rules target this alias, without reading every rule''s document. V018 deliberately created no index at all — its only read enters through the sort-order key — and this is the read that changes that. Partial on the expression being non-null, so the route_local rules that target nothing are not indexed.';

-- ---------------------------------------------------------------------------
-- alias_references — the one definition.
--
-- One row per *reference*, not per referrer: an alias named twice in one chain is two rows,
-- because two hops break if it is deleted and the refusal has to name both. `Used by` counts
-- rows for the same reason.
--
-- `security_invoker = true` on V010's and V011's precedent: reading through the view requires
-- the rights to read the four tables under it, so publishing a definition grants nobody a
-- read they did not already have. It matters more here than on either of those, because this
-- view's whole purpose is to be read by a role that is deciding whether to delete something.
-- ---------------------------------------------------------------------------
create view ouroboros.alias_references
  with (security_invoker = true) as

-- `route` — Y.2's foreign key (#190). The hop is the reference and the route's tag is the
-- chip; the join to `routes` is what turns an id into `implement-primary`.
select h.organization_id                        as organization_id,
       h.model_alias_id                         as alias_id,
       a.alias                                  as alias,
       'route'::ouroboros.alias_reference_kind  as kind,
       h.id                                     as ref_id,
       r.tag                                    as ref_label,
       true                                     as blocking
  from ouroboros.route_hops h
  join ouroboros.model_aliases a
    on a.id = h.model_alias_id
  join ouroboros.routes r
    on r.id = h.route_id

union all

-- `escalation` — Y.3's jsonb target (#191). Joined by **name** within the workspace, which
-- is what the rule stores and what V018's deferred trigger checks; the index above is what
-- keeps it off every rule's document.
--
-- A disabled rule is still a reference. `enabled` is how a workspace suspends a rule without
-- deleting it (V018), so deleting the alias out from under a suspended rule would break it on
-- the day somebody switched it back on — and V018's trigger refuses that delete whether the
-- rule is enabled or not. A view that filtered on `enabled` would report a delete as safe
-- that the database is about to refuse.
select e.organization_id                             as organization_id,
       a.id                                          as alias_id,
       a.alias                                       as alias,
       'escalation'::ouroboros.alias_reference_kind  as kind,
       e.id                                          as ref_id,
       ouroboros.escalation_reference_label(e."when") as ref_label,
       true                                          as blocking
  from ouroboros.escalation_rules e
  join ouroboros.model_aliases a
    on a.organization_id = e.organization_id
   and a.alias = ouroboros.escalation_rule_alias(e."then");

comment on view ouroboros.alias_references is
  'What references a model alias, across every storage shape it can be referenced from (#581, decision R5) — mockup 21''s USED BY column, the inspector''s chip list, the blocked Remove state and the rename guard, all reading one definition so they cannot disagree. One row per reference. No count is stored anywhere: the column is count(*) over this view and the zero state is a left join from model_aliases, which is what makes "0 routes" true rather than maintained. Two of the four kinds are live — route (V016 foreign key) and escalation (V018 jsonb target); workflow and chat_pin contribute zero rows until #132/#133 and #537 exist, and the migration header carries the create-or-replace that adds them. Read it through alias_reference_guard() from inside a delete or rename transaction — selecting from it directly takes no lock and its answer can go stale.';
comment on column ouroboros.alias_references.organization_id is
  'The workspace, carried from the referring row rather than from the alias — so a reference is scoped by the same column every other read in this schema is, and a workspace''s guard cannot see another''s rows.';
comment on column ouroboros.alias_references.alias_id is 'model_aliases.id — what a delete or rename is about.';
comment on column ouroboros.alias_references.alias is 'model_aliases.alias — the name, so the view can be entered by it: alias_references where alias = ''coder-max''.';
comment on column ouroboros.alias_references.kind is 'Which storage shape the reference lives in — see the alias_reference_kind domain.';
comment on column ouroboros.alias_references.ref_id is 'The referring row: route_hops.id for a route, escalation_rules.id for an escalation. Stable enough to link to, which is what turns a chip into a destination.';
comment on column ouroboros.alias_references.ref_label is 'Mockup 21''s chip, verbatim: a route''s tag ("implement-primary"), or an escalation''s prefixed predicate ("escalation:effort≥L"). Nothing else has to be assembled to render it.';
comment on column ouroboros.alias_references.blocking is 'Whether this reference must refuse a delete (409) rather than warn about one (422). True for every row today — a hop and a rule both break if the alias goes away — and the column exists for the workflow leg, where a published version blocks and a draft is reported softly.';

-- ---------------------------------------------------------------------------
-- alias_reference_guard — the same answer, taken under a lock.
--
--   guarded_organization_id — the workspace, so a guard cannot reach across one
--   guarded_alias_id        — model_aliases.id, the alias about to be deleted or renamed
--   returns                 — its references, exactly as alias_references reports them
--
-- Call it **inside** the transaction that does the delete or the rename; see the header for
-- why the lock is `for update` and what it does and does not serialise against. An alias id
-- that is not this workspace's, or does not exist, locks nothing and returns nothing — and
-- the caller's own scoped delete then affects no row, which is the 404 rather than a
-- pretence that the delete succeeded.
--
-- `volatile` by omission, and that is required rather than incidental: a function that takes
-- a row lock cannot be `stable`, because the planner is free to not call one.
-- ---------------------------------------------------------------------------
create function ouroboros.alias_reference_guard(guarded_organization_id text,
                                                guarded_alias_id uuid)
returns setof ouroboros.alias_references
language plpgsql
as $$
begin
  -- The lock, before the count. A concurrent route save takes `for key share` on this row to
  -- satisfy route_hops_alias_fk, which conflicts with `for update` and waits.
  perform 1
     from ouroboros.model_aliases
    where organization_id = guarded_organization_id
      and id = guarded_alias_id
      for update;

  return query
    select *
      from ouroboros.alias_references
     where organization_id = guarded_organization_id
       and alias_id = guarded_alias_id;
end;
$$;

comment on function ouroboros.alias_reference_guard(text, uuid) is
  'The referrer list for a delete or a rename, taken under a row lock so it is still true when the statement after it runs (#581). Locks the alias FOR UPDATE, then returns its alias_references rows; call it inside the transaction that deletes or renames, and treat a non-empty result as the refusal CH.1 (#584) renders — 409 for the blocking rows, 422 for the rest. FOR UPDATE rather than FOR SHARE because a route save takes FOR KEY SHARE on the alias to satisfy its foreign key, and FOR KEY SHARE does not conflict with FOR SHARE. The migration header states what the lock does not close.';
