-- V037__ticket_draft_provenance.sql — `ticket_drafts.provenance`: whether a draft is still what
-- its planner wrote, or somebody has edited it.
--
-- AL.4 (#280) under epic #269. The planning API's `PATCH /api/v1/planning/batches/:batch/drafts/:key`
-- lets a reviewer rewrite a draft's title or body before it is pushed, and the issue requires that
-- *"edits mark provenance `edited`"*. `V034` recorded which planner produced a batch
-- (`draft_batches.planner`, decision N2) but nothing per draft, so once a person had edited a row
-- there was no way to tell their words from the planner's — and that is the difference decision
-- K10's honesty rule cares about: a tracker issue saying *filed by Ouroboros* over text a person
-- wrote, or a planner credited with text it never produced, are both provenance lies.
--
-- ---------------------------------------------------------------------------
-- Closed, two values, and one-directional in practice.
-- ---------------------------------------------------------------------------
--
-- `planned` is what the planner answered; `edited` is anything a person has changed since. A
-- closed CHECK rather than a grammar (contrast `draft_batches.planner`): the question is binary —
-- did a human touch this text — and the card renders the word as a chip, so a third value would be
-- a draft drawn under no state at all.
--
-- There is deliberately **no trigger holding `edited` terminal**. The only writer that sets
-- `planned` is regeneration, which *replaces* the unpushed drafts with new rows rather than
-- updating them, so a row never moves back in practice; a trigger would guard a transition no code
-- path makes, and would refuse the one legitimate repair (a seed or a support fix) for nothing.
--
-- Default `planned`, which is what every existing row is: nothing before AL.4 could edit a draft.
--
-- ---------------------------------------------------------------------------
-- Not in this migration: research provenance.
-- ---------------------------------------------------------------------------
--
-- #280's amendment (from #624, CM.5) asks for draft provenance pointing at an investigation, a gap
-- row and citations. Those tables do not exist yet, and a bare text column pointing at nothing is
-- the shape `V034` refused for `epic_id`. They arrive with #624, the migration that can reference
-- them.

alter table ouroboros.ticket_drafts
  add column provenance text not null default 'planned',
  add constraint ticket_drafts_provenance
    check (provenance in ('planned', 'edited'));

comment on column ouroboros.ticket_drafts.provenance is
  'Whose words the draft holds (#280, AL.4): planned — exactly what the batch''s planner answered — or edited — a person has since changed its title or body through the planning API. Set by the PATCH route, never back to planned; regeneration replaces unpushed drafts with new planned rows rather than resetting this one.';

comment on constraint ticket_drafts_provenance on ouroboros.ticket_drafts is
  'The draft provenance vocabulary (#280), closed because the card renders the word as a chip and the question it answers — did a person touch this text — has two answers.';
