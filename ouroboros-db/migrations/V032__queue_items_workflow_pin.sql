-- V032__queue_items_workflow_pin.sql — `queue_items.workflow_version` and
-- `queue_items.workflow_pin_reason`: which version of which workflow a queued issue is waiting
-- for, and why that workflow claimed it.
--
-- Filed as R.1 (#143), the trigger evaluation service. Until now a queue row named a workflow by
-- `workflow_tag` and nothing else — the request's explicit choice, or the estimate's suggestion —
-- so a run started tomorrow against a workflow edited today would have no record of what it was
-- meant to execute. Decision P1 makes published versions immutable precisely so that a version
-- number is enough to say that; this migration is where the queue starts recording one.
--
-- ---------------------------------------------------------------------------
-- The pin is `(workflow_tag, workflow_version)`. There is no `workflow_slug` column.
-- ---------------------------------------------------------------------------
--
-- The issue names the pin "`workflow_slug` + `workflow_version`". `workflow_tag` already *is* the
-- slug: V029 bounded `workflows.slug` to exactly what a tag can hold, and P.4's registry (#135)
-- made every tag a new write may name a slug of the workspace writing it. A second column that a
-- CHECK held equal to the first would store nothing new, and would give every writer — the seeds,
-- the reorder, T.6 — one more place to disagree. So R.1 writes the chosen slug into the tag, as
-- the queue always has, and adds only what was missing: the version, and the reason.
--
-- ---------------------------------------------------------------------------
-- Three properties, each of them a constraint below.
-- ---------------------------------------------------------------------------
--
--   * **The version is nullable, and null is two honest states.** A workflow with nothing
--     published — a workspace still on the bootstrap vocabulary, which has no workflow rows at
--     all, or an active workflow that has only ever had a draft — has no version to pin, and
--     inventing one would be a pin T.6 could not run. A row queued before this migration has none
--     either. `queue_items_workflow_version_positive` holds a present one to what V029 numbers
--     from.
--   * **The reason is a closed vocabulary.** Five words, one per rung of R.1's documented
--     resolution order: `explicit` (the request named it), `predicate` (exactly one trigger
--     matched), `most_specific` (several matched and one carried the most conditions),
--     `alphabetical` (the most specific tied, and the lowest slug won) and `suggested` (nothing
--     matched, so the estimate's own suggestion stood). A code rather than V031's sentence,
--     because the set is closed by the resolution order rather than open by a provider list, and
--     a dry-run explanation composes its words from the code.
--   * **A version is never unexplained.** `queue_items_workflow_version_reasoned`: a row may carry
--     a reason and no version — a pin with nothing in force — but not a version and no reason,
--     because a version with no account of how it was chosen is exactly the audit gap this
--     ticket closes. A null reason is the mark of a row queued before R.1.
--
-- **Deliberately not a foreign key**, for decision F8's reason and V029's: the tag is opaque, a
-- workflow may be renamed or archived after its issues were queued, and a pin that no longer
-- resolves is a fact about the past rather than a broken row. Nor is the pin tied to
-- `workflows.current_version`: a publish after queueing moves that pointer and must not move the
-- pin. T.6 is what re-checks status and version when it claims an item.
--
-- Both columns are nullable with no default, so the `alter table` rewrites nothing and every
-- existing row reads as queued before R.1.
--
-- Filed as issue #143 (R.1). Needs #65 (V009) and #132 (V029). Written by
-- `ouroboros-rest/src/modules/backlog/queue.service.ts` through
-- `ouroboros-rest/src/modules/workflows/trigger.service.ts`. Asserted in tests/constraints.sql.

alter table ouroboros.queue_items
  add column workflow_version integer,
  add column workflow_pin_reason text,

  -- V029 numbers published versions from 1. A zero or a negative is a writer that confused the
  -- pin with something else, and it would name a version no workflow can have.
  add constraint queue_items_workflow_version_positive
    check (workflow_version is null or workflow_version >= 1),

  -- R.1's resolution order, one word per rung. Null only on a row queued before R.1.
  add constraint queue_items_workflow_pin_reason_valid
    check (workflow_pin_reason is null
           or workflow_pin_reason in ('explicit', 'predicate', 'most_specific',
                                      'alphabetical', 'suggested')),

  -- A pinned version always says how it was chosen. The converse is deliberately allowed: a
  -- reason with no version is a workflow that had nothing published to pin.
  add constraint queue_items_workflow_version_reasoned
    check (workflow_version is null or workflow_pin_reason is not null);

comment on column ouroboros.queue_items.workflow_version is
  'The version of workflow_tag that was in force when the issue was queued — the pin T.6 executes (#143). Null when that workflow had nothing published to pin (a bootstrap workspace, or a draft-only workflow), and on every row queued before R.1. Not a foreign key and not tied to workflows.current_version: a later publish moves the pointer and must not move the pin.';

comment on column ouroboros.queue_items.workflow_pin_reason is
  'Why workflow_tag claimed the issue (#143): explicit (the request named it), predicate (exactly one trigger matched), most_specific (several matched, one had the most conditions), alphabetical (the most specific tied, the lowest slug won) or suggested (nothing matched, the estimate''s suggestion stood). Null marks a row queued before R.1.';

comment on constraint queue_items_workflow_version_positive on ouroboros.queue_items is
  'A pinned version is one V029 could have numbered (#143): published versions start at 1.';

comment on constraint queue_items_workflow_pin_reason_valid on ouroboros.queue_items is
  'The five rungs of R.1''s resolution order (#143) — explicit > most-specific predicate > alphabetical, with a lone match and the estimate''s suggestion either side. Closed, because a dry-run explanation composes its words from this code.';

comment on constraint queue_items_workflow_version_reasoned on ouroboros.queue_items is
  'A pinned version always carries the reason it was chosen (#143). A reason without a version is allowed on purpose: that is a workflow with nothing published to pin.';
