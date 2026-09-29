-- V070__onboarding_bypass.sql — `onboarding_state.bypassed_at`: the wizard's import-skip, as a
-- fact of its own (#385, BB.2).
--
-- Mockup 13's corner link *"I've done this before — import config ↗"* is a real path: BB.2's
-- skip hook marks the wizard **bypassed** for a repository and routes the person to the settings
-- surface, where BD.3 (#398) will one day import a configuration bundle. Until BD.3 lands the
-- hook imports nothing and says so.
--
-- Why a column rather than `dismissed = true`: the two mean different things to the surfaces
-- that read them. A dismissal is *"stop showing me this"*; a bypass is *"I already know how this
-- product works — take me to the settings"*, and it is what BD.3's import will later satisfy
-- steps behind. Folding one into the other would make the difference unrecoverable on every
-- later read, which is exactly what decision O1 forbids for the wizard's other facts.
--
-- Still wizard-owned, and still not a step status. Every step stays derived on read (O1, see
-- V067's header); `bypassed_at` records a choice the person made, like `dismissed` and
-- `completed_at` before it. `tests/constraints.sql` pins the table's column list, and this
-- migration moves that assertion rather than weakening it.
--
-- ---------------------------------------------------------------------------
-- The derivation contract, as BB.2 implements it
-- ---------------------------------------------------------------------------
--
-- V067's header wrote the contract before V068 gave workflows their template provenance and
-- before BB.2 was specified. #385 refines two rows, and since an applied migration cannot be
-- edited, the contract in force is restated here:
--
--   | step                          | status is derived from                                      |
--   |-------------------------------|-------------------------------------------------------------|
--   | 1 Connect GitHub              | an `active` GitHub `ticket_sources` row whose config names  |
--   |                               | the repository's owner and lists the repository (WF-Q);     |
--   |                               | `paused`/`error` is the regression, with its status_reason  |
--   | 2 Pick a repo                 | the `github_repos` row `repo_ref` names, enabled, under an  |
--   |                               | enabled `github_orgs` row                                   |
--   | 3 Choose a starting workflow  | a workflow of the workspace whose `template_slug` (V068) is |
--   |                               | `onboarding_state.selected_template` — a real instantiation |
--   | 4 Run your first loop         | a `queue_items` or `runs` row for the picked ticket's issue |
--   |                               | in that repository                                          |
--
-- `ouroboros-rest/src/modules/onboarding/onboarding.derivation.ts` is that table as code.

alter table ouroboros.onboarding_state
  add column bypassed_at timestamptz;

alter table ouroboros.onboarding_state
  add constraint onboarding_state_bypassed_after_created
    check (bypassed_at is null or bypassed_at >= created_at);

comment on column ouroboros.onboarding_state.bypassed_at is
  'When the person took the "I''ve done this before — import config" skip for this repository (#385), or null. A choice rather than a step status (O1): it imports nothing — the bundle import is BD.3 (#398) — and is distinct from dismissed, which only stops the wizard being shown.';
comment on constraint onboarding_state_bypassed_after_created on ouroboros.onboarding_state is
  'A bypass cannot predate the wizard state it marks (#385), completed_at''s rule applied to bypassed_at.';
