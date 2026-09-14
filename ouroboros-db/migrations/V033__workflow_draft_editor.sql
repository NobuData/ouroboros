-- V033__workflow_draft_editor.sql — `workflow_versions.edited_in`: which editor last wrote a
-- workflow's draft.
--
-- Filed as U.3 (#167), the code view's save endpoint. Decision C3 gives a workflow one draft and
-- two editors: the visual canvas writes it through `PUT /api/v1/workflows/{id}/draft`, and the
-- code editor writes the same row through `PUT /api/v1/workflows/{slug}/code`. Both carry the
-- draft's etag in `If-Match`, and a stale one is a `409`.
--
-- The ticket asks that `409` to **name the other editor's change**, so the conflict dialog can say
-- *"changed in the visual editor"* rather than *"changed by someone"*. The etag cannot say it: it
-- is a digest of the row, and a digest records that the row moved, not what moved it. So the row
-- records it, beside the stamp `workflow_versions_touch_updated_at` already keeps.
--
-- ---------------------------------------------------------------------------
-- Two properties, each of them a constraint below.
-- ---------------------------------------------------------------------------
--
--   * **The editor is a closed vocabulary.** `visual` or `code`, one word per endpoint that writes
--     a draft. Null is the honest third state: a draft `POST /api/v1/workflows` created and nobody
--     has edited yet, a seeded draft, and every draft written before this migration.
--     `workflow_versions_edited_in_known`.
--   * **Only a draft records its editor.** A published version was frozen by publishing, and
--     publishing inserts a new row rather than promoting the draft (V029), so no version has an
--     editor to record. `workflow_versions_edited_in_draft_only`.
--
--     This one also keeps V029's immutability exact. `workflow_versions_refuse_update` lets one
--     update of a published row through — the `published_by` foreign key's own set-null — and it
--     recognises that update by comparing the row's columns *as V029 declared them*. A column added
--     later is not in that comparison, so without this constraint a statement that cleared
--     `published_by` could also rewrite a published row's `edited_in`. With it, a published row's
--     `edited_in` is null and can only stay null.
--
-- Nullable with no default, so the `alter table` rewrites nothing and every existing row reads as
-- a draft nobody has edited in either editor since this migration.
--
-- Filed as issue #167 (U.3). Needs #132 (V029). Written by
-- `ouroboros-rest/src/modules/workflows/workflows.service.ts`, for both editors. Asserted in
-- tests/constraints.sql.

alter table ouroboros.workflow_versions
  add column edited_in text,

  -- The two editors that write a draft (decision C3). Null is a draft neither has edited yet.
  add constraint workflow_versions_edited_in_known
    check (edited_in is null or edited_in in ('visual', 'code')),

  -- A published version has no editor: publishing froze it, in a row of its own.
  add constraint workflow_versions_edited_in_draft_only
    check (version is null or edited_in is null);

comment on column ouroboros.workflow_versions.edited_in is
  'Which editor last wrote this draft (#167): visual (PUT /api/v1/workflows/{id}/draft) or code (PUT /api/v1/workflows/{slug}/code). What a stale-etag 409 names, so the conflict dialog can say which editor changed the draft. Null on a draft neither editor has written since it was created or seeded, and on every published version.';

comment on constraint workflow_versions_edited_in_known on ouroboros.workflow_versions is
  'The two editors that write a workflow draft (#167, decision C3): visual and code. Closed, because the conflict message is composed from this word.';

comment on constraint workflow_versions_edited_in_draft_only on ouroboros.workflow_versions is
  'Only a draft records its editor (#167). A published version was frozen by publishing, in a row of its own. Also keeps workflow_versions_no_update exact: its published_by set-null exception compares V029''s columns, and this constraint is what stops that one permitted update from rewriting edited_in.';
