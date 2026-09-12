-- V031__ticket_source_status_reason.sql — `ticket_sources.status_reason`: the sentence
-- behind the status dot.
--
-- Filed as part of Q.2 (#139), the `TicketSourceProvider` SPI and the sync loop that iterates
-- it. `V030` left this column out **on purpose** and said which ticket would add it:
--
--   > **No `status_reason`.** Q.2's criterion is that provider errors map to source status
--   > *"with honest UI-facing reasons"*, and a reason has to be stored somewhere. It is not
--   > in this issue's column list, so it is not invented here — the ticket that writes that
--   > read is the ticket that adds the column.
--
-- This is that ticket. Q.2's sync loop is the first thing that has ever had an opinion about
-- why a source is not working, and its second acceptance criterion is that the opinion is
-- *"rate limited until 14:20"* rather than *"error"*.
--
-- ---------------------------------------------------------------------------
-- Why the status column alone cannot carry it.
-- ---------------------------------------------------------------------------
--
-- `V030`'s `status` is three words — `active`, `paused`, `error` — and that is the right
-- width for what reads it: the sync loop's filter, and the colour of a dot. It is the wrong
-- width for what a person needs when the dot is red, because all four of the provider-neutral
-- failure classes Q.2 defines coarsen into the same word:
--
--   | provider error class | `status` | `status_reason`                          |
--   |----------------------|----------|------------------------------------------|
--   | `auth`               | `error`  | `credentials rejected`                   |
--   | `rate_limit`         | `error`  | `rate limited until 14:20 UTC`           |
--   | `not_found`          | `error`  | `project or repository not found`        |
--   | `upstream`           | `error`  | `tracker unavailable (503)`              |
--
-- Widening `status` instead was the alternative, and it was not taken for the reason `V030`
-- gives for keeping it at three: the column is a *routing* signal — may the loop poll this —
-- and a fourth and fifth value would make every reader of it re-derive that question from a
-- longer list. The reason is the *finer* instrument, and the pair is exactly the shape
-- `ouroboros-rest/src/modules/providers/provider.errors.ts` already settled on for model
-- providers, where a pill says why and `provider_connections.status` says whether.
--
-- ---------------------------------------------------------------------------
-- Three properties this column has, each of them a constraint below.
-- ---------------------------------------------------------------------------
--
--   * **It is a sentence, not a code.** The provider-neutral *class* is Q.2's taxonomy and
--     lives in code, where a `switch` can be exhaustive over it. What is stored is the
--     phrase already fit to render, because the alternative is a `status_reason_code` column
--     whose vocabulary has to be widened by migration every time a provider can fail in a new
--     way — and `custom` providers are in `ticket_sources_kind` from the start, so that set
--     is open by construction.
--   * **It is null exactly when there is nothing to say.** Not `''`, and not a cheerful
--     sentence on a healthy source: a reason that is always populated is a reason a surface
--     cannot use to decide whether to draw anything. `ticket_sources_status_reason_present`
--     refuses the blank string, which is the value a mapping bug produces.
--   * **It is bounded at 200 characters.** A rendered line in a settings list, not a log.
--     What does not fit is a stack trace or a provider's error body, and neither belongs in
--     front of a person — Q.2's `ticket-source.errors.ts` composes every value this column
--     can hold from a closed set of phrases, and none of them echoes an upstream body.
--
-- **Deliberately not constrained: that a reason accompanies `status = 'error'`.** The
-- biconditional is tempting and wrong in one direction. Q.4's settings surface (#141) can
-- pause a source, and a paused source may keep the reason that explains why the last poll
-- failed; and a source somebody set to `error` by hand has no reason to offer. What the
-- *loop* writes is always the pair, because it writes them in one statement — and that is a
-- property of one writer, which is not what a CHECK is for.
--
-- ---------------------------------------------------------------------------
-- The view.
-- ---------------------------------------------------------------------------
--
-- `ticket_sources_public` gains the column, because it is the opposite of a secret: it exists
-- to be rendered. `create or replace view` with the new column **last** is what makes that an
-- additive change PostgreSQL accepts — a replacement may append columns and may not reorder,
-- retype or drop them — so the ten columns `V030` published keep their positions and nothing
-- selecting them by name or by ordinal moves.
--
-- Filed as issue #139 (Q.2). Needs #138 (V030). Written by
-- `ouroboros-rest/src/modules/ticket-sources/`; read by Q.4's source management (#141).
-- Asserted in tests/constraints.sql.

alter table ouroboros.ticket_sources
  add column status_reason text,

  -- Null is the state of a source with nothing to explain. `''` is a mapping bug — a phrase
  -- composed from an empty branch — and it renders as a status line that is present and
  -- says nothing, which is worse than an absent one because a surface will draw it.
  add constraint ticket_sources_status_reason_present
    check (status_reason is null
           or (btrim(status_reason) <> '' and length(status_reason) <= 200));

comment on column ouroboros.ticket_sources.status_reason is
  'Why the source is in the state it is, in words fit to render — "rate limited until 14:20 UTC", "credentials rejected" (#139). Null when there is nothing to say. A sentence rather than a code, because the provider set is open and a coded vocabulary would need a migration per new failure; the provider-neutral class it was composed from is Q.2''s taxonomy and lives in ouroboros-rest.';

comment on constraint ticket_sources_status_reason_present on ouroboros.ticket_sources is
  'A reason says something or is absent (#139). Deliberately not tied to status = ''error'': a paused source may keep the reason its last poll produced, and a status set by hand has none — that pairing is a property of the sync loop, which writes both in one statement, rather than of every writer.';

-- The reason is published: it is the line under the status dot in Q.4's settings list, and
-- the one thing a person can act on when the dot is red. Appended rather than inserted in
-- place — see this file's header on what `create or replace view` permits.
create or replace view ouroboros.ticket_sources_public as
  select id,
         organization_id,
         kind,
         display_name,
         config,
         status,
         sync_cursor,
         synced_at,
         created_at,
         updated_at,
         status_reason
    from ouroboros.ticket_sources;

comment on view ouroboros.ticket_sources_public is
  'ticket_sources without credentials_encrypted (#138, widened by #139) — what every read path selects, so the sealed credential is absent rather than merely unselected. status_reason is here because it is the opposite of a secret: it is the sentence a settings list renders under the status dot. tests/constraints.sql asserts the column list, so a later migration that admitted the credential fails the build.';
