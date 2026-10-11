-- V128__suggestion_rules.sql — what the suggestion rule pack needs of the dry-run records
-- (#563, CD.5).
--
-- CD.5 turns a finished dry run into `dry_run_suggestions` (V114) with a versioned rule pack,
-- lets the copilot add its own, and builds Apply / Explain / Ignore. Three things V111 and V114
-- could not yet say:
--
--   1. **Why a stage skipped, as a value.** `dry_run_stages.skip_reason` is a sentence for the
--      card. The flagship rule (`skipped-nothing-to-do`) must tell *"this stage ran into nothing
--      to do"* from *"a branch routed around it"* and from *"its route does not resolve"* (W7)
--      without reading prose, and must know **which input was missing** to propose the predicate
--      that routes around it. So a skipped row gains `skip_kind` —
--      `branch_not_taken | unreached | unresolved_reference | nothing_to_do` — and, on a
--      `nothing_to_do` skip, `skip_input`: the ticket label that would have carried the input
--      (`cve`). Both are null on a row recorded before this migration, which is why the kind is
--      *allowed* on a skipped row and not *required* of one.
--   2. **A suggestion with nothing to apply.** `budget-proximity` proposes raising a cap, and a
--      cap is not a draft operation; `unresolved-reference-persists` has an operation only when
--      the catalogue holds a near name. Such a suggestion is **advisory**: `proposed_ops` is the
--      empty array, and Apply refuses it. `dry_run_suggestion_ops_valid()` now admits 0–50.
--   3. **A suggestion without a score.** The copilot's own suggestions (`source = 'llm'`) are
--      validated as operations but **never scored** — a model's self-reported confidence has no
--      relation to anything. `confidence` is null exactly on an `llm` suggestion; its
--      `confidence_basis` still says how it came to be (method `llm_unscored`, with the alias
--      and the number of validated operations), so the popover can say why there is no figure.
--
-- Revert forward:
--   alter table ouroboros.dry_run_suggestions drop constraint dry_run_suggestions_confidence_scored;
--   (restore `confidence` not null and V114's dry_run_suggestion_ops_valid once no llm or
--    advisory suggestion remains)
--   alter table ouroboros.dry_run_stages drop column skip_input, drop column skip_kind;

-- ---------------------------------------------------------------------------
-- dry_run_stages — why a stage skipped, as a value.
-- ---------------------------------------------------------------------------
alter table ouroboros.dry_run_stages
  add column skip_kind  text,
  add column skip_input text;

alter table ouroboros.dry_run_stages
  add constraint dry_run_stages_skip_kind
    check (skip_kind is null
           or (verdict = 'skipped'
               and skip_kind in ('branch_not_taken', 'unreached', 'unresolved_reference',
                                 'nothing_to_do'))),
  -- The missing input is a label: a slug, and only where the stage had nothing to do.
  add constraint dry_run_stages_skip_input
    check (skip_input is null
           or (skip_kind = 'nothing_to_do'
               and skip_input ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
               and length(skip_input) <= 64));

comment on column ouroboros.dry_run_stages.skip_kind is
  'branch_not_taken | unreached | unresolved_reference | nothing_to_do — why a skipped stage skipped, as a value the suggestion rules read (#563). Null on a stage that did not skip, and on a row recorded before V128.';
comment on column ouroboros.dry_run_stages.skip_input is
  'On a nothing_to_do skip, the ticket label that would have carried the input the stage needed (`cve`) — what the conditional suggestion''s predicate tests (#563). Null when the stage did not name one.';

-- ---------------------------------------------------------------------------
-- dry_run_suggestions — advisory suggestions, and unscored ones.
-- ---------------------------------------------------------------------------

-- dry_run_suggestion_ops_valid(ops) — whether proposed operations are an array of at most 50
-- V110 draft operations. Empty is an **advisory** suggestion: it has nothing to apply.
--   ops — the jsonb value to inspect
--   returns true when it is an array of 0–50 elements, each passing draft_op_shape_valid()
create or replace function ouroboros.dry_run_suggestion_ops_valid(ops jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(ops) = 'array'
                  and jsonb_array_length(ops) <= 50
                  and not exists (select 1 from jsonb_array_elements(ops) op
                                   where not ouroboros.draft_op_shape_valid(op)),
                  false);
$$;

comment on function ouroboros.dry_run_suggestion_ops_valid(jsonb) is
  'True when proposed operations are an array of at most 50 V110 draft operations (#558; empty admitted by #563 — an advisory suggestion, which Apply refuses). Their DSL validity is ci/db''s parity step.';

alter table ouroboros.dry_run_suggestions
  alter column confidence drop not null;

-- A rule scores; the copilot does not.
alter table ouroboros.dry_run_suggestions
  add constraint dry_run_suggestions_confidence_scored
    check ((source = 'llm') = (confidence is null));

comment on column ouroboros.dry_run_suggestions.proposed_ops is
  'The draft operations Apply executes — computed when the suggestion is made, never re-derived from the body. Empty on an advisory suggestion (#563), which has nothing to apply.';
comment on column ouroboros.dry_run_suggestions.confidence is
  '0–100 on a rule''s suggestion, always with the confidence_basis that produced it; null exactly on an llm suggestion, which is validated but never scored (#563).';
