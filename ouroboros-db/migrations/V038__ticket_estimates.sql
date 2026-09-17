-- V038__ticket_estimates.sql — `issue_estimates.ticket_id`: a canonical ticket becomes the third
-- kind of subject the one sizer can size.
--
-- AL.5 (#281) under epic #269, decision **N9**. Mockup 09's *Backlog Health* card promises
-- *"Estimator re-runs nightly on unsized issues"*, and the issue makes that sentence a real job
-- that runs **through INTAKE-L.3's orchestrator** (#107) over the canonical backlog — the open,
-- unsized rows of `ouroboros.tickets`.
--
-- The orchestrator could not do that before this migration. `V026` gave `issue_estimates` one
-- subject, a mirrored `github_issues` row, and `V034` added `ticket_drafts` as a second (decision
-- N3). A canonical ticket was neither, so an estimate of one had nowhere to be stored, and a
-- pipeline that sized a ticket and threw the answer away is not a pipeline. `ticket.intake.ts`
-- said the same thing from the other side: *"moving it means re-pointing `issue_estimates` at
-- `tickets.id`"*.
--
-- ---------------------------------------------------------------------------
-- A third subject, by V034's pattern and for its reasons.
-- ---------------------------------------------------------------------------
--
-- This is `V034`'s amendment applied once more rather than a re-pointing of the table:
--
--   * **`github_issues` keeps its estimates.** The intake page still reads them, and the cut-over
--     that retires that table is not this ticket's. Adding a column rewrites nothing, so every
--     estimate already written reads exactly as it did.
--   * **Exactly one subject, now of three.** `issue_estimates_one_subject` is replaced rather than
--     joined by a second rule, because two CHECKs over overlapping columns can each be satisfied
--     by a row the pair was meant to refuse.
--   * **Versions are per subject.** `V026`'s key and trigger go quiet against a null issue and
--     `V034`'s against a null draft, so a ticket gets its own unique key — read backwards, the
--     index *latest wins* uses — and its own monotonic trigger. Each subject gets the trigger that
--     watches it; neither earlier function is rewritten.
--   * **Cascade from the ticket**, `github_issue_id`'s posture: an estimate of a ticket that is
--     gone can be neither rendered nor graded, and a source removed from a workspace takes its
--     tickets and their estimates with it. A ticket carries its own `organization_id`, so that
--     column is the whole of a ticket estimate's tenancy and no further guard is needed.
--
-- `tickets.sizing_status` is still the per-ticket *status* — `V030` kept `V014`'s vocabulary
-- verbatim so the pipeline could claim work by it. This column is where the *answer* goes.

alter table ouroboros.issue_estimates
  add column ticket_id uuid references ouroboros.tickets (id) on delete cascade,

  -- One version of a ticket's estimate, once. Also what makes the trigger below safe under
  -- concurrency: two writers that both computed `max(version) + 1` cannot both commit.
  add constraint issue_estimates_ticket_version_key unique (ticket_id, version);

alter table ouroboros.issue_estimates
  drop constraint issue_estimates_one_subject;

alter table ouroboros.issue_estimates
  add constraint issue_estimates_one_subject
    check (num_nonnulls(github_issue_id, draft_id, ticket_id) = 1);

comment on column ouroboros.issue_estimates.ticket_id is
  'The canonical ticket this sizes (#281, AL.5) — the third subject after V026''s mirrored issue and V034''s draft, so the nightly re-estimation job sizes the canonical backlog through the one pipeline (decision N3, N9). Exactly one of github_issue_id, draft_id and ticket_id is set. Cascades from the ticket, whose organization_id is the whole of the estimate''s tenancy.';
comment on constraint issue_estimates_one_subject on ouroboros.issue_estimates is
  'An estimate is about exactly one thing (#272, widened by #281): a mirrored issue, a ticket draft or a canonical ticket — never two and never none. Two would be two answers wearing one version number; none would be a row no cascade can reach.';
comment on constraint issue_estimates_ticket_version_key on ouroboros.issue_estimates is
  'One version of a ticket''s estimate, once (#281) — issue_estimates_issue_version_key for the third kind of subject, and the descending index latest-wins reads. The earlier keys cannot cover a ticket: with its other subjects null, a unique key treats every row as distinct.';

-- ---------------------------------------------------------------------------
-- Monotonic versions, for the third kind of subject — V034's trigger, for a ticket.
-- ---------------------------------------------------------------------------
create function ouroboros.issue_estimate_ticket_version_monotonic() returns trigger
language plpgsql as $$
declare
  highest integer;
begin
  if new.ticket_id is null then
    return new;
  end if;

  select max(version) into highest
    from ouroboros.issue_estimates
   where ticket_id = new.ticket_id;

  if highest is not null and new.version <= highest then
    raise exception
      'ticket % is already sized at version %; a new estimate must be version % or later',
      new.ticket_id, highest, highest + 1
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.issue_estimate_ticket_version_monotonic() is
  'BEFORE INSERT trigger for issue_estimates (#281): refuses a ticket estimate whose version is not above every version that ticket already has. V034''s draft trigger for the third kind of subject, and a sibling rather than a rewrite for that trigger''s reason. Concurrency is issue_estimates_ticket_version_key''s.';

create trigger issue_estimates_ticket_version_monotonic
  before insert on ouroboros.issue_estimates
  for each row execute function ouroboros.issue_estimate_ticket_version_monotonic();

comment on trigger issue_estimates_ticket_version_monotonic on ouroboros.issue_estimates is
  'A ticket''s estimate versions ascend (#281). Insert only: an update is refused outright by issue_estimates_no_update.';
