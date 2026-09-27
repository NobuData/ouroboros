-- V062__pr_waiver_annotations.sql — the annotation half of *Waive & annotate PR*: where a waiver
-- was posted on the host PR, and whether it was.
--
-- Filed as issue #359 (AX.3, the criteria & evidence service) of the PR Verification roadmap
-- (docs/ROADMAP_MOCKUP_12_PR_VERIFICATION.md, decision V9). V055 (#327) built `pr_waivers` with
-- `annotation_state` held to `pending_pr_plane` — "#359 widens the vocabulary when it can post" —
-- and this is that widening.
--
--
-- Decision V9 — waivers have to leave the building.
-- ---------------------------------------------------------------------------
--
-- Mockup 12's fifth criterion reads *rig runs at 22°C only — thermal chamber not in bench* and
-- its pill says `waived · annotated on PR`. A waiver that lives only in this database lets a
-- reviewer working on GitHub merge believing every criterion was met, so waiving a criterion
-- writes the waiver **and** posts it to the host PR through AX.1's idempotent comment surface
-- (#357). The pill links to that comment, so the row keeps where it is:
--
--   | annotation_state   | meaning                                            | annotation columns          |
--   |--------------------|----------------------------------------------------|-----------------------------|
--   | `pending_pr_plane` | not posted — a test-results waiver of cases, or a  | none                        |
--   |                    | criterion waiver whose post has not yet run        |                             |
--   | `annotated`        | posted: the host holds the comment                 | comment id and instant; the |
--   |                    |                                                    | URL when the host gave one  |
--   | `failed`           | the post was attempted and the host refused it     | none — nothing was posted   |
--
-- **The waiver is written before the post**, so a host that is down never loses the decision;
-- `failed` then says out loud that the annotation is missing, and waiving the criterion again is
-- the retry (a new waiver, the same comment — the marker edits it).
--
-- **`annotated` is final.** The comment it names is the one the pill links to, and moving a row
-- off it would leave a pill pointing at a comment the row no longer admits to. A re-waive is a
-- new waiver row (V055's append-only rule), and the host's comment is *edited* under the same
-- marker, so the new row names the same comment.
--
-- **`annotation_url` may be null on an `annotated` row** — the host said where the comment is,
-- or it did not, and a URL composed from a guess at the host's scheme is not written. When it is
-- set it is an https URL.
--
--
-- Everything else stays append-only.
-- ---------------------------------------------------------------------------
--
-- `ouroboros_app` gains `update` on the four annotation columns only, and
-- `pr_waivers_annotation_only` refuses any other change — author, reason, cases, run and instant
-- are what was decided, and are never rewritten.

alter table ouroboros.pr_waivers
  add column annotation_comment_id text,
  add column annotation_url        text,
  add column annotated_at          timestamptz;

comment on column ouroboros.pr_waivers.annotation_comment_id is
  'The host''s id for the comment that annotates this waiver on the PR (#359, decision V9). Set exactly when annotation_state is annotated.';
comment on column ouroboros.pr_waivers.annotation_url is
  'The comment''s page on the host — what the matrix''s "waived · annotated on PR" pill links to. Only on an annotated row, and null there when the host did not say; an https URL when set.';
comment on column ouroboros.pr_waivers.annotated_at is
  'When the annotation was posted. Set exactly when annotation_state is annotated.';

alter table ouroboros.pr_waivers
  drop constraint pr_waivers_annotation_state;

alter table ouroboros.pr_waivers
  add constraint pr_waivers_annotation_state
    check (annotation_state in ('pending_pr_plane', 'annotated', 'failed'));

alter table ouroboros.pr_waivers
  add constraint pr_waivers_annotation_coherent
    check ((annotation_state = 'annotated')
             = (annotation_comment_id is not null and annotated_at is not null)
           and (annotation_url is null or annotation_state = 'annotated'));

alter table ouroboros.pr_waivers
  add constraint pr_waivers_annotation_comment_id_shape
    check (annotation_comment_id is null
           or (btrim(annotation_comment_id) <> '' and length(annotation_comment_id) <= 128));

alter table ouroboros.pr_waivers
  add constraint pr_waivers_annotation_url_shape
    check (annotation_url is null
           or (annotation_url ~ '^https://[^[:space:]]+$' and length(annotation_url) <= 2048));

alter table ouroboros.pr_waivers
  add constraint pr_waivers_annotated_after_created
    check (annotated_at is null or annotated_at >= created_at);

comment on column ouroboros.pr_waivers.annotation_state is
  'pending_pr_plane (not posted) | annotated (the host holds the comment; final) | failed (the post was refused — waive again to retry). #359 widened V055''s vocabulary of one.';

comment on constraint pr_waivers_annotation_coherent on ouroboros.pr_waivers is
  'An annotated waiver names its comment and when it was posted; no other state names a comment or a URL (#359).';

-- ---------------------------------------------------------------------------
-- Only the annotation moves, and an annotated waiver does not move at all.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_waivers_annotation_only()
returns trigger
language plpgsql
as $$
begin
  if row(new.id, new.organization_id, new.run_id, new.reason, new.case_keys, new.created_at)
     is distinct from
     row(old.id, old.organization_id, old.run_id, old.reason, old.case_keys, old.created_at)
     -- The author may only be forgotten — the foreign key's own set null.
     or (new.author is distinct from old.author and new.author is not null) then
    raise exception 'waiver % is append-only — only its annotation may be recorded', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.annotation_state = 'annotated'
     and row(new.annotation_state, new.annotation_comment_id, new.annotation_url, new.annotated_at)
         is distinct from
         row(old.annotation_state, old.annotation_comment_id, old.annotation_url, old.annotated_at) then
    raise exception 'waiver % is already annotated on the PR — waive again for a new annotation', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_waivers_annotation_only() is
  'Keeps pr_waivers append-only now that the annotation is written after insert (#359): only annotation_state, annotation_comment_id, annotation_url and annotated_at change, author only to null, and an annotated waiver not at all.';

create trigger pr_waivers_annotation_only
  before update on ouroboros.pr_waivers
  for each row execute function ouroboros.pr_waivers_annotation_only();

grant update (annotation_state, annotation_comment_id, annotation_url, annotated_at)
  on ouroboros.pr_waivers to ouroboros_app;
