-- V105__onboarding_protected_paths_edited.sql — `onboarding_state.protected_paths_edited_at`: a
-- person has taken over a repository's protected-path list, so scans stop suggesting (#391, BC.2).
--
-- Mockup 13's detection card ends in `boot/, keys/ suggested · edit`: a scan suggests globs
-- (V067's `protected_path_policies`, source `suggested`), and the card's inline editor lets a
-- person change them — the list AP.3's guardrail evaluation (#305) refuses to let a run touch.
--
-- A scan inserts its suggestions and skips any already present. Without a record of the edit, a
-- glob a person **removed** would come back on the next re-scan, and a person who removed every
-- glob would get them all back. So the edit is recorded here, per repository, and BB.1's scan
-- writes no suggestion once it is set. The user chose this on #391 over two lighter options
-- (skip only while an `edited` row exists — which forgets an emptied list — or keep re-suggesting).
--
-- Still wizard-owned and still not a step status (O1, V067's header): like `dismissed`,
-- `completed_at` and `bypassed_at` it records a choice the person made. `tests/constraints.sql`
-- pins the table's column list, and this migration moves that assertion rather than weakening it.
--
-- Revert forward: `alter table ouroboros.onboarding_state drop constraint
-- onboarding_state_protected_paths_edited_after_created, drop column protected_paths_edited_at;`

alter table ouroboros.onboarding_state
  add column protected_paths_edited_at timestamptz;

alter table ouroboros.onboarding_state
  add constraint onboarding_state_protected_paths_edited_after_created
    check (protected_paths_edited_at is null or protected_paths_edited_at >= created_at);

comment on column ouroboros.onboarding_state.protected_paths_edited_at is
  'When a person last saved this repository''s protected-path list from the detection card (#391), or null. Once set, a detection scan suggests no glob for the repository — a glob the person removed stays removed. A choice rather than a step status (O1).';
comment on constraint onboarding_state_protected_paths_edited_after_created on ouroboros.onboarding_state is
  'An edit cannot predate the wizard state it marks (#391), bypassed_at''s rule applied to protected_paths_edited_at.';
