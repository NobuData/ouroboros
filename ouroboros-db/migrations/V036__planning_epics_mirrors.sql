-- V036__planning_epics_mirrors.sql — `planning_epics`, `epic_tickets` and `epic_mirrors`: the
-- gantt's lanes as planning entities, with the progress chip computed rather than kept.
--
-- The third migration of the **planning** domain (docs/ROADMAP_MOCKUP_09_PLANNING.md), filed as
-- AK.3 (#274) under epic #268. Mockup 09's `c-12` **Roadmap** card — `ROADMAP — HELIOS 2.1`,
-- tagged `Q3–Q4 2026` — draws five lanes, and every one of them is a row here:
--
--   OTA hardening              Jul→Sep  accent   `12 issues · 8 done`
--   BLE provisioning v2        Aug→Oct  model    `9 issues · 2 done`
--   Motor control refactor     Sep→Nov  warn     `14 issues · 0 done`
--   Fleet telemetry dashboard  Oct→Dec  ok       `7 issues · 0 done`
--   Zephyr 4.2 migration       —        neutral  `unscoped`, drawn dashed
--
-- ---------------------------------------------------------------------------
-- Decision N5 (option 4-A) — the ownership split, and why it is what makes sync tractable.
-- ---------------------------------------------------------------------------
--
-- A lane carries two kinds of information, and confusing them is how planning tools become
-- untrustworthy.
--
-- **Dates, tints, status and lane order are planning intent.** No tracker stores them; they exist
-- because somebody decided this work belongs in Q3. Ouroboros owns them, and they are the columns
-- below.
--
-- **`12 issues · 8 done` is tracker truth.** It describes what has actually happened, and storing
-- it would guarantee it goes stale — the chip would say `8 done` while GitHub said nine, and
-- nobody could tell which to believe. So there is **no counter column anywhere in this
-- migration**. The chip is computed from joined ticket states on every read, by
-- `planning_epic_progress` below.
--
-- That split is the whole of why two-way sync is tractable here: there is no field both sides can
-- edit, so there is nothing to merge. It is the same *cache, not fork* rule `V030` applied to
-- ticket bodies, stated one level up — and the reason this migration adds a view rather than two
-- integers.
--
-- ---------------------------------------------------------------------------
-- Months are a pair, and `unscoped` is a first-class state rather than a placeholder.
-- ---------------------------------------------------------------------------
--
-- `Zephyr 4.2 migration` is the lane worth designing for deliberately. It has no dates and no
-- linked tickets: it is a bar on the roadmap saying *we know this is coming*. The alternative —
-- a row carrying invented dates and a flag saying to ignore them — is how a schema starts lying,
-- because every reader then has to remember the flag and one of them will not.
--
-- So the date columns are **nullable as a pair** (`planning_epics_months_paired`), which is
-- `num_nonnulls` again — `V035`'s endpoint rule and `V034`'s `issue_estimates_one_subject`, a
-- third time, for the third kind of *these columns travel together* rule this domain has. Half a
-- range is not a degraded range: it is a bar with one end, which nothing can draw.
--
-- They are **month-granular** because the gantt's axis is months — `Jul 2026`, `Aug`, `Sep` — and
-- a `date` that is not the first of its month is a day-precision answer to a question nobody
-- asked, which two renderers would then round differently. `planning_epics_months_are_months`
-- makes that unrepresentable instead of conventional. The cast to `timestamp` is explicit and
-- load-bearing: `date_trunc` over `timestamptz` reads the session's `TimeZone` and is not
-- immutable, which is `V026`'s reason for checking an ISO-8601 instant by regex rather than by a
-- cast.
--
-- **Deliberately not constrained: that `status = 'unscoped'` implies null dates.** The two are set
-- by different gestures — somebody tints and orders a lane before anybody schedules it — and the
-- acceptance criterion is that the unscoped lane is *representable*, which the nullable pair
-- already makes true. A CHECK tying them would refuse the ordinary intermediate state of an epic
-- being scheduled, and AL.4 (#280) would have to write both columns in an order this file had
-- decided for it.
--
-- ---------------------------------------------------------------------------
-- `epic_tickets` — the join the chip is computed over, and nothing else.
-- ---------------------------------------------------------------------------
--
-- Epic on one side, canonical ticket on the other, unique as a pair. There is no `state` here, no
-- `done` flag and no ordinal: every one of those would be a second copy of something the ticket
-- already knows, and the point of N5 is that this table holds no tracker truth at all.
--
-- **A ticket may belong to more than one epic**, deliberately. The mockup's five lanes happen to
-- partition its backlog — 12 + 9 + 14 + 7 is the 42 the Backlog Health card counts — but that is
-- what that workspace's planning looks like, not a rule of the schema. A `unique (ticket_id)`
-- would make *this ticket also serves the telemetry epic* unrepresentable, and the issue asks for
-- the pair to be unique rather than the ticket.
--
-- ---------------------------------------------------------------------------
-- `epic_mirrors` — the bookkeeping that keeps a second push from creating a second epic.
-- ---------------------------------------------------------------------------
--
-- When AL.3 (#279) creates a GitHub parent issue for an epic and assigns it a milestone, those
-- references have to persist. Otherwise the next push creates a *second* parent issue and the
-- epic is split across two trackers' worth of container — which is N6's idempotency failure, one
-- level above the drafts `V034` gave their own `push_state`.
--
-- `epic_mirrors_epic_source_kind_key` is therefore the idempotency key rather than decoration:
-- *this epic's parent issue in this source* has one row, so the second push reads it and adopts
-- what it finds. One epic may hold several rows — a `parent_issue` and a `milestone` in the same
-- GitHub source are two different containers — and one per source per kind is exactly that.
--
-- `kind` is a closed CHECK carrying `jira_epic` from the start, which is `V030`'s `custom`
-- argument: AN.2 (#290) adds Jira, Linear and GitLab writers, and a vocabulary that had to be
-- widened by migration before the first of them could store a row would be widened by whoever
-- noticed the insert failing rather than by whoever chose the name.
--
-- ---------------------------------------------------------------------------
-- `draft_batches.epic_id` — the column `V034` deferred to this migration.
-- ---------------------------------------------------------------------------
--
-- #272 listed it and did not add it, because the table it references did not exist and a nullable
-- uuid pointing at nothing is how a dangling reference becomes normal. This is the migration that
-- has something to reference, and the roadmap's AK.1 → AK.3 ordering was written for it.
--
-- It **sets null** rather than cascading, which is `ticket_drafts.pushed_ticket_id`'s posture and
-- its reason: a batch whose epic is deleted is still a batch somebody generated, reviewed and
-- possibly pushed, and deleting the record of that work to tidy up a lane would lose which issues
-- exist. The batch survives with a cleared reference.
--
-- ---------------------------------------------------------------------------
-- Tenancy: one column, three tables, and two distances.
-- ---------------------------------------------------------------------------
--
-- `planning_epics` carries `organization_id`; `epic_tickets` and `epic_mirrors` deliberately do
-- **not**. The epic is the whole of their tenancy, exactly as the batch is a draft's (`V034`) and
-- the issue is an estimate's (`V026`) — this is the opposite answer from `ticket_dependencies`
-- (`V035`), and the difference is the reason rather than an inconsistency: an edge there has two
-- parents of two possible *kinds* and no single one to inherit from, while a row here has one
-- epic and one other reference hanging off it.
--
-- What a foreign key still cannot say is that the *other* reference agrees. So each join table
-- carries a trigger holding its second parent to the epic's workspace, and `draft_batches` gains a
-- third beside the two `V034` gave it. All three leak the same way when missing: one workspace's
-- ticket titles counted into another's progress chip, or its milestone named by another's push —
-- a tenancy breach rather than a broken join.
--
-- Filed as issue #274 (AK.3). Needs #272 (`V034`) and #138 (`V030`). Blocks #275, #279, #280 and
-- #286; its mirror vocabulary is exercised by #290. Asserted in tests/constraints.sql.

-- ---------------------------------------------------------------------------
-- planning_epics
--
-- One lane of the roadmap card: what it is called, how it is drawn, when it runs, where it sits,
-- and which roadmap it belongs to. Every column is planning intent — see the header for why none
-- of them is a count.
-- ---------------------------------------------------------------------------
create table ouroboros.planning_epics (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace this lane belongs to, and the leading column of every read of this table.
  -- Cascade, the posture of every planning table since `V034`: a deleted workspace must not leave
  -- a roadmap behind describing work nobody can reach.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The lane label — `OTA hardening`. The workspace's own words: no tracker issues this, which is
  -- what puts it on Ouroboros' side of the N5 split.
  name             text        not null,

  -- How the bar is drawn. The mockup's five classes exactly — `t-accent`, `t-model`, `t-warn`,
  -- `t-ok`, `t-neutral` — and closed for the reason every rendered vocabulary in this schema is
  -- closed (`V008`, `V030`, `V034`): a sixth value is a bar with no colour rule, which renders as
  -- nothing rather than as something wrong.
  --
  -- Defaulted to `neutral`, which is the honest state of a lane nobody has tinted yet: it is the
  -- tint the mockup gives the lane it has made no commitment about.
  tint             text        not null default 'neutral',

  -- When the lane runs, to the month — `2026-07-01` is the `Jul 2026` column. **Nullable as a
  -- pair**: both set is a scheduled lane, both null is the unscoped one, and one of each is
  -- refused. See the header.
  start_month      date,
  end_month        date,

  -- Where the lane is in its life. `active` is work under way, `proposed` is the affix the mockup
  -- prints beside `Zephyr 4.2 migration`, `done` is a lane that has finished, and `unscoped` is
  -- the one that has never been scheduled.
  --
  -- Deliberately **not** tied to the date columns — see the header. Defaulted to `active`, which
  -- is what an epic somebody created to hold work is.
  status           text        not null default 'active',

  -- Lane order, top first. Unique per workspace and **deferrable**, so a reorder is plain SQL
  -- inside one transaction rather than a shuffle through temporary values — `task_kinds
  -- .sort_order` (`V016`) and `queue_items.position` (`V009`), the same arrangement for the same
  -- reason.
  --
  -- Uniqueness is the acceptance criterion rather than tidiness: *deterministic order* is exactly
  -- what two lanes sharing a number do not have, and the tie would be broken by whichever plan
  -- the server happened to pick — so the roadmap would reorder itself between two reads.
  -- Deliberately **not dense**, as `task_kinds` is not: nothing reads these numbers, and
  -- `order by sort_order` renders 1, 2, 5 exactly as it renders 1, 2, 3.
  sort_order       integer     not null,

  -- The card's head — `HELIOS 2.1` and `Q3–Q4 2026`. Carried on the lane rather than in a
  -- `roadmaps` table of its own, which is a deliberate decision and not an oversight: the two are
  -- a *name* and a *phrase a human wrote*, nothing joins to either, and the one read that exists
  -- is the head of a card already selecting these rows. A second entity would buy a foreign key
  -- and cost every reader a join.
  --
  -- `roadmap_window` is text rather than a second date range because it is a label — `Q3–Q4 2026`
  -- is what somebody wants printed, and deriving it from the lanes' own months would make the
  -- head change when one lane moved.
  --
  -- Both nullable: an epic that belongs to no named roadmap yet is the ordinary state on the way
  -- through AL.4's (#280) form, and `''` is not *no roadmap* — null is.
  roadmap_name     text,
  roadmap_window   text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- --- the two vocabularies are closed -----------------------------------------
  --
  -- Both are partitions something renders — a tint class over one, a pill and a dash pattern over
  -- the other — so a value outside either set is a lane that appears under no rule at all.
  constraint planning_epics_tint
    check (tint in ('accent', 'model', 'warn', 'ok', 'neutral')),
  constraint planning_epics_status
    check (status in ('active', 'proposed', 'done', 'unscoped')),

  -- --- the strings say something ------------------------------------------------
  --
  -- A lane with a blank label is a bar with no name, which is the one thing a lane cannot be. The
  -- bounds are storage sanity at the scale of a label, `V030`'s argument for `tickets.title`.
  constraint planning_epics_name_present
    check (btrim(name) <> '' and length(name) <= 200),
  constraint planning_epics_roadmap_name_present
    check (roadmap_name is null
           or (btrim(roadmap_name) <> '' and length(roadmap_name) <= 200)),
  constraint planning_epics_roadmap_window_present
    check (roadmap_window is null
           or (btrim(roadmap_window) <> '' and length(roadmap_window) <= 64)),

  -- --- the months are a pair, are months, and run forwards -----------------------
  --
  -- Acceptance criteria, one constraint each so a rejected write names the rule it broke rather
  -- than a compound one that states three.
  --
  -- Paired: both or neither. `num_nonnulls(…) <> 1` is `V035`'s endpoint idiom inverted — there
  -- exactly one was required, here exactly one is the thing refused.
  constraint planning_epics_months_paired
    check (num_nonnulls(start_month, end_month) <> 1),

  -- Month-granular: the first of the month, because the axis is months. The `::timestamp` cast is
  -- deliberate — `date_trunc` over `timestamptz` reads the session's `TimeZone` and is not
  -- immutable, which is not a property a CHECK may depend on.
  constraint planning_epics_months_are_months
    check ((start_month is null
            or start_month = date_trunc('month', start_month::timestamp)::date)
       and (end_month is null
            or end_month = date_trunc('month', end_month::timestamp)::date)),

  -- Forwards. A lane that ends before it starts is a bar with negative width, which no renderer
  -- can draw and no drift suggestion (#293) should ever produce.
  constraint planning_epics_months_ordered
    check (start_month is null or end_month is null or start_month <= end_month),

  -- --- the lane order ------------------------------------------------------------
  --
  -- The top lane is first, not zeroth, and there is no lane before it — `task_kinds`' rule.
  constraint planning_epics_sort_order_positive
    check (sort_order >= 1),

  -- Deterministic order, and reorderable inside a transaction. See the column.
  constraint planning_epics_organization_sort_order_key
    unique (organization_id, sort_order) deferrable initially deferred
);

comment on table ouroboros.planning_epics is
  'The gantt lanes of mockup 09''s Roadmap card as planning entities (#274, decision N5 / option 4-A) — name, tint, month range, status, lane order and the roadmap head they belong to. Every column is planning INTENT: no tracker stores any of them, which is what makes Ouroboros their unambiguous owner. There is deliberately no progress counter anywhere on this table — "12 issues · 8 done" is computed from joined ticket states by planning_epic_progress, because a stored count would say 8 while the tracker said 9 and nobody could tell which to believe. That split is what makes two-way sync tractable: no field is editable on both sides, so there is nothing to merge. Written by AL.4 (#280), pushed by AL.3 (#279), rendered by AM.4 (#286).';

comment on column ouroboros.planning_epics.organization_id is
  'The workspace this lane belongs to (#274), and the leading column of every read. Cascades: a deleted workspace must not leave a roadmap behind describing work nobody can reach. It is also the tenancy epic_tickets and epic_mirrors inherit, since neither carries one of its own.';
comment on column ouroboros.planning_epics.name is
  'The lane label — "OTA hardening" (#274). The workspace''s own words: no tracker issues this, which is what puts it on Ouroboros'' side of the N5 ownership split.';
comment on column ouroboros.planning_epics.tint is
  'How the bar is drawn: accent | model | warn | ok | neutral — mockup 09''s five tint classes exactly (#274). Closed, because the value is a rendering rule rather than data: a sixth would be a bar with no colour. Defaults to neutral, the honest tint of a lane nobody has coloured yet.';
comment on column ouroboros.planning_epics.start_month is
  'When the lane starts, to the month — 2026-07-01 is the gantt''s "Jul 2026" column (#274). Nullable AS A PAIR with end_month: both null is the unscoped lane, one of each is refused. Held to the first of its month, because the axis is months and a day-precision date is an answer to a question nobody asked that two renderers would round differently.';
comment on column ouroboros.planning_epics.end_month is
  'When the lane ends, to the month (#274) — start_month''s pair, under the same three rules: paired, month-granular, and not before it.';
comment on column ouroboros.planning_epics.status is
  'Where the lane is in its life: active | proposed | done | unscoped (#274). proposed is the affix mockup 09 prints beside "Zephyr 4.2 migration"; unscoped is the lane that has never been scheduled. Deliberately NOT tied to the date columns — the two are set by different gestures, and a CHECK binding them would refuse the ordinary intermediate state of an epic being scheduled.';
comment on column ouroboros.planning_epics.sort_order is
  'Lane order, 1 at the top (#274). Unique per workspace and deferrable, so a reorder is plain SQL inside one transaction — task_kinds.sort_order''s arrangement (V016). Uniqueness is the acceptance criterion rather than tidiness: two lanes sharing a number have no deterministic order, and the tie would be broken by whichever plan the server picked, so the roadmap would reorder itself between two reads. Not dense, as task_kinds is not: nothing reads these numbers.';
comment on column ouroboros.planning_epics.roadmap_name is
  'The roadmap this lane belongs to — "Helios 2.1", the card''s head (#274). Carried on the lane rather than in a roadmaps table of its own: it is a name nothing joins to, and the only read is the head of a card already selecting these rows. Null when no roadmap has been named; never blank, because "" is not "no roadmap".';
comment on column ouroboros.planning_epics.roadmap_window is
  'The phrase under the roadmap name — "Q3–Q4 2026" (#274). Text rather than a second date range because it is a LABEL somebody wrote: deriving it from the lanes'' own months would make the card''s head change whenever one lane moved.';

comment on constraint planning_epics_tint on ouroboros.planning_epics is
  'The five tints mockup 09 draws (#274). Closed because the value selects a rendering rule, so a sixth is a bar the card cannot colour.';
comment on constraint planning_epics_status on ouroboros.planning_epics is
  'The four states a lane can be in (#274). unscoped is a first-class state rather than a row with placeholder dates, which is the whole reason the date columns are nullable.';
comment on constraint planning_epics_months_paired on ouroboros.planning_epics is
  'A month range is both ends or neither (#274) — the acceptance criterion that one set and one null is rejected. num_nonnulls, V035''s endpoint idiom inverted: there exactly one was required, here exactly one is what is refused. Half a range is not a degraded range, it is a bar with one end.';
comment on constraint planning_epics_months_are_months on ouroboros.planning_epics is
  'The dates are months (#274): the first of the month, because the gantt''s axis is months. The ::timestamp cast is load-bearing — date_trunc over timestamptz reads the session TimeZone and is not immutable, which V026 met in the same way for a different column.';
comment on constraint planning_epics_months_ordered on ouroboros.planning_epics is
  'A lane does not end before it starts (#274) — a bar with negative width, which no renderer can draw. Null-guarded, so the unscoped lane passes it.';
comment on constraint planning_epics_sort_order_positive on ouroboros.planning_epics is
  'The top lane is first, not zeroth (#274) — task_kinds_sort_order_positive''s rule (V016).';
comment on constraint planning_epics_organization_sort_order_key on ouroboros.planning_epics is
  'Lanes have a deterministic order (#274), which two lanes sharing a number do not. Deferrable initially deferred, so AL.4 (#280) reorders a roadmap with plain SQL inside one transaction rather than shuffling through temporary values — task_kinds_organization_sort_order_key''s arrangement.';

-- The page's own list: a workspace's lanes, in lane order. Also the workspace cascade's entrance.
--
-- `planning_epics_organization_sort_order_key` is already an index on exactly these two columns,
-- so no second one is created — `V030`'s argument for leaving `source_id` unindexed beside its
-- unique key, and the reason a deferrable key is still a usable index.

create trigger planning_epics_touch_updated_at
  before update on ouroboros.planning_epics
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- epic_tickets
--
-- Which tickets are in a lane. The join the chip above is computed over, and nothing else: no
-- state, no done flag, no ordinal — every one of those would be a second copy of something the
-- ticket already knows.
-- ---------------------------------------------------------------------------
create table ouroboros.epic_tickets (
  id         uuid        primary key default gen_random_uuid(),

  -- The lane. Cascade, and it is also the whole of this row's tenancy — there is deliberately no
  -- `organization_id` here, as `ticket_drafts` has none: the epic is the one parent, and a link
  -- whose epic is gone is a membership in nothing.
  epic_id    uuid        not null
                         references ouroboros.planning_epics (id) on delete cascade,

  -- The ticket. Cascade, `V035`'s posture for the same kind of reference and for its reason: a
  -- link to a deleted ticket is not a degraded membership but none at all, and it would otherwise
  -- be counted into the chip as a ticket that no longer exists. Held to the epic's workspace by
  -- the trigger below.
  ticket_id  uuid        not null
                         references ouroboros.tickets (id) on delete cascade,

  created_at timestamptz not null default now(),

  -- No `updated_at`, and no touch trigger. Nothing on this row is mutable: both columns are the
  -- key, so moving a ticket between lanes is a delete and an insert rather than an update, and a
  -- timestamp that could never move would be a column inviting a writer to move it.

  -- One membership, once — the issue's `unique` on the pair. Its leading column also serves the
  -- epic cascade and the *this lane's tickets* read the chip is computed from, which is why
  -- `epic_id` has no index of its own.
  --
  -- Deliberately unique on the **pair** rather than on `ticket_id`: a ticket may serve two epics.
  -- The mockup's five lanes happen to partition its backlog — 12 + 9 + 14 + 7 is the 42 the
  -- Backlog Health card counts — but that is what that workspace's planning looks like, not a
  -- rule of the schema.
  constraint epic_tickets_epic_ticket_key unique (epic_id, ticket_id)
);

comment on table ouroboros.epic_tickets is
  'Which canonical tickets are in a planning lane (#274) — the join planning_epic_progress computes "12 issues · 8 done" over. It holds no tracker truth at all: no state, no done flag, no ordinal, because every one of those is a second copy of something the ticket already knows and the point of decision N5 is that nothing here can go stale. A ticket may belong to more than one epic; the unique key is the pair, not the ticket. There is deliberately no organization_id — the epic is the whole of a link''s tenancy, as the batch is a draft''s (V034).';

comment on column ouroboros.epic_tickets.epic_id is
  'The lane (#274). Cascades, and is the whole of this row''s tenancy. Its position as the unique key''s leading column is why it carries no index of its own: the cascade and the chip''s own read both enter through the key.';
comment on column ouroboros.epic_tickets.ticket_id is
  'The ticket in the lane (#274). Cascades, V035''s posture for the same kind of reference: a link to a deleted ticket would otherwise be counted into the progress chip as a ticket that no longer exists. Held to the epic''s workspace by epic_tickets_ticket_in_organization.';
comment on constraint epic_tickets_epic_ticket_key on ouroboros.epic_tickets is
  'One membership, once (#274). On the pair rather than on ticket_id, deliberately: a ticket may serve two epics, and the mockup''s lanes partitioning its backlog is that workspace''s planning rather than a rule. Read backwards it is also the index the chip is computed through.';

-- *Which lanes is this ticket in* — the panel's side of the membership question — and `tickets`'
-- cascade on this column. Indexed where `epic_mirrors.source_id` is not, and the difference is
-- the delete that really happens: a sync removes tickets one at a time, so an unindexed
-- referencing column would make every one of those deletions a scan of this table.
create index epic_tickets_ticket_idx
  on ouroboros.epic_tickets (ticket_id);

comment on index ouroboros.epic_tickets_ticket_idx is
  'Which lanes a ticket is in (#274), and tickets'' cascade on this column. Indexed because a sync deletes tickets one at a time, where a workspace or a source leaves in one event.';

-- ---------------------------------------------------------------------------
-- A link's ticket belongs to the epic's workspace.
--
-- `ticket_drafts_ticket_in_organization` (`V034`) one table over: the epic carries the workspace,
-- the ticket carries its own, and no foreign key makes the two agree. Without it one workspace's
-- closed tickets could be counted into another's progress chip — the chip would read `8 done` off
-- rows the reader cannot see, which is a tenancy breach wearing the shape of a number.
-- ---------------------------------------------------------------------------
create function ouroboros.epic_ticket_in_organization()
returns trigger language plpgsql as $$
declare
  epic_owner   text;
  ticket_owner text;
begin
  select e.organization_id into epic_owner
    from ouroboros.planning_epics e
   where e.id = new.epic_id;

  select t.organization_id into ticket_owner
    from ouroboros.tickets t
   where t.id = new.ticket_id;

  -- Either null means the row went between this statement and its own foreign key, which the key
  -- refuses a moment later and describes better than this could — `V034`'s reasoning, and
  -- `V035`'s.
  if epic_owner is not null and ticket_owner is not null
     and epic_owner is distinct from ticket_owner then
    raise exception
      'epic link names ticket % in organization % rather than the epic''s %',
      new.ticket_id, ticket_owner, epic_owner
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.epic_ticket_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for epic_tickets (#274): refuses a link whose ticket belongs to a different workspace than its epic. V034''s ticket_drafts_ticket_in_organization one table over — the isolation rule the absent organization_id hands to the epic, and one no foreign key can state, since neither key makes the other agree. Without it one workspace''s closed tickets would be counted into another''s progress chip: 8 done, read off rows the reader cannot see.';

create trigger epic_tickets_ticket_in_organization
  before insert or update of epic_id, ticket_id on ouroboros.epic_tickets
  for each row execute function ouroboros.epic_ticket_in_organization();

comment on trigger epic_tickets_ticket_in_organization on ouroboros.epic_tickets is
  'A link''s ticket and its epic belong to the same workspace (#274) — the organization-isolation criterion for this table, which epic_tickets'' absent organization_id hands to the epic.';

-- ---------------------------------------------------------------------------
-- planning_epic_progress
--
-- `12 issues · 8 done`, computed — the mechanism behind the acceptance criterion that no stored
-- counter exists to go stale.
--
-- It is a view for the reason `ticket_sources_public` (`V030`) is one: a rule that lives in a
-- comment is a rule each reader re-implements, and AL.4 (#280) and AM.4 (#286) both need this
-- number. Two hand-written `count(*) filter (…)` expressions would eventually disagree about
-- which ticket states count as done, and the card and the API would then print different chips
-- for the same epic.
--
-- It is defined **after** `epic_tickets` rather than beside `planning_epics`, because a view is
-- resolved when it is created: the join below has to name a table that already exists.
--
-- `left join` twice, so an epic with no linked tickets yields `0 · 0` rather than no row at all —
-- which is exactly the `Zephyr 4.2 migration` lane, and a lane missing from the roadmap because
-- nobody had linked a ticket to it yet would be the worst possible reading of *unscoped*.
--
-- `done` is `state = 'closed'`, `V030`'s two-word vocabulary and the only one every tracker in
-- the set maps onto. Collapsing Jira's or Linear's richer workflow onto it is the provider's job,
-- which is what keeps this definition from having a per-tracker branch in it.
--
-- The epic's own columns come along because this is the roadmap payload AL.4 returns: grouping by
-- the primary key is what lets them be selected without being repeated in `group by`.
-- ---------------------------------------------------------------------------
create view ouroboros.planning_epic_progress as
  select e.id                                          as epic_id,
         e.organization_id,
         e.name,
         e.tint,
         e.start_month,
         e.end_month,
         e.status,
         e.sort_order,
         e.roadmap_name,
         e.roadmap_window,
         count(t.id)                                   as ticket_count,
         count(t.id) filter (where t.state = 'closed') as done_count
    from ouroboros.planning_epics e
    left join ouroboros.epic_tickets et on et.epic_id = e.id
    left join ouroboros.tickets      t  on t.id = et.ticket_id
   group by e.id;

comment on view ouroboros.planning_epic_progress is
  'The roadmap payload with its progress chip computed (#274, decision N5) — mockup 09''s "12 issues · 8 done", derived from joined ticket states on every read and stored nowhere. A view rather than a documented expression for ticket_sources_public''s reason (V030): AL.4 (#280) and AM.4 (#286) both need this number, and two hand-written counts would eventually disagree about which states are done, so the card and the API would print different chips for the same epic. LEFT JOINed twice, so an epic with no linked tickets is 0 · 0 rather than absent — which is the unscoped lane, and a lane missing from the roadmap is the worst possible reading of "unscoped". done is state = closed, V030''s vocabulary, because collapsing a tracker''s richer workflow onto those two words is the provider''s job.';

-- ---------------------------------------------------------------------------
-- epic_mirrors
--
-- Where an epic lives in a tracker. The bookkeeping that makes a second push find the parent
-- issue it already created rather than create another one.
-- ---------------------------------------------------------------------------
create table ouroboros.epic_mirrors (
  id           uuid        primary key default gen_random_uuid(),

  -- The epic this mirrors. Cascade, and the whole of this row's tenancy, as `epic_tickets`' is.
  epic_id      uuid        not null
                           references ouroboros.planning_epics (id) on delete cascade,

  -- The WF-Q source the mirror lives in. Cascade rather than `set null`, `V034`'s argument for
  -- `draft_batches.target_source_id`: a mirror that names no tracker cannot be looked up and
  -- cannot say where it pointed. Held to the epic's workspace by the trigger below.
  source_id    uuid        not null
                           references ouroboros.ticket_sources (id) on delete cascade,

  -- What kind of container this is. `milestone` and `parent_issue` are GitHub's two, and the
  -- MVP's case is the second — AL.3 (#279) creates a parent issue and assigns a milestone, which
  -- is why one epic may hold both in one source.
  --
  -- `jira_epic` is in the set from the start rather than added when somebody needs it, which is
  -- `V030`'s `custom` argument: AN.2 (#290) adds the Jira, Linear and GitLab writers, and a
  -- vocabulary that needed a migration before the first of them could store a row would be
  -- widened by whoever noticed the insert failing rather than by whoever chose the name.
  kind         text        not null,

  -- The tracker's own handle for the container — `600` for a GitHub parent issue, `Helios 2.1`
  -- for a milestone, `PROJ-12` for a Jira epic. Text for `tickets.external_id`'s reason: three
  -- shapes, one column, and the value is meaningless outside the source that issued it.
  external_ref text        not null,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- --- the vocabulary is closed --------------------------------------------------
  constraint epic_mirrors_kind
    check (kind in ('milestone', 'parent_issue', 'jira_epic')),

  -- A reference says something. `''` is a mapping bug — a handle composed from an empty branch —
  -- and it would send the next push looking for a container with no name. 255 is
  -- `tickets_external_id_present`'s bound, and for its reason.
  constraint epic_mirrors_external_ref_present
    check (btrim(external_ref) <> '' and length(external_ref) <= 255),

  -- **The idempotency key**, and the acceptance criterion that a second push finds the existing
  -- parent issue rather than creating another: *this epic's container of this kind in this
  -- source* has exactly one row, so AL.3 (#279) reads it and adopts what it finds.
  --
  -- `kind` is in the key rather than beside it because a `parent_issue` and a `milestone` in one
  -- GitHub source are two different containers for the same epic — a key of `(epic_id,
  -- source_id)` alone would make the push's second write overwrite its first.
  constraint epic_mirrors_epic_source_kind_key unique (epic_id, source_id, kind)
);

comment on table ouroboros.epic_mirrors is
  'Where a planning epic lives in a tracker (#274) — the bookkeeping decision N5 needs on the push side. When AL.3 (#279) creates a GitHub parent issue for an epic and assigns it a milestone, those references have to persist: otherwise the next push creates a SECOND parent issue and the epic is split across two trackers'' worth of container, which is N6''s idempotency failure one level above the drafts V034 gave their own push_state. epic_mirrors_epic_source_kind_key is what makes the second push adopt rather than create. The kind vocabulary carries jira_epic from the start so AN.2 (#290) needs no migration before its first row. No organization_id — the epic is the whole of a mirror''s tenancy.';

comment on column ouroboros.epic_mirrors.epic_id is
  'The epic being mirrored (#274). Cascades, and is the whole of this row''s tenancy. Leading column of the idempotency key, which is why it carries no index of its own.';
comment on column ouroboros.epic_mirrors.source_id is
  'The WF-Q source the container lives in (#274). Cascades rather than set-nulling, V034''s argument for draft_batches.target_source_id: a mirror naming no tracker cannot be looked up and cannot say where it pointed. Held to the epic''s workspace by epic_mirrors_source_in_organization.';
comment on column ouroboros.epic_mirrors.kind is
  'What kind of container this is: milestone | parent_issue | jira_epic (#274). GitHub''s two are the MVP case, and one epic may hold both in one source — AL.3 (#279) creates a parent issue and assigns a milestone. jira_epic is in the set from the start for V030''s custom reason: AN.2 (#290) should not need a migration before it can store its first row.';
comment on column ouroboros.epic_mirrors.external_ref is
  'The tracker''s own handle for the container — "600" for a GitHub parent issue, "Helios 2.1" for a milestone, "PROJ-12" for a Jira epic (#274). Text for tickets.external_id''s reason: three shapes, one column, and meaningless outside the source that issued it.';

comment on constraint epic_mirrors_kind on ouroboros.epic_mirrors is
  'The three kinds of container an epic can be mirrored into (#274). Closed, and carrying jira_epic ahead of its writer so AN.2 (#290) extends the vocabulary in practice rather than by migration.';
comment on constraint epic_mirrors_external_ref_present on ouroboros.epic_mirrors is
  'A mirror reference says something (#274). "" is a mapping bug composed from an empty branch, and it would send the next push looking for a container with no name.';
comment on constraint epic_mirrors_epic_source_kind_key on ouroboros.epic_mirrors is
  'One container per kind per source per epic (#274) — the idempotency key behind the acceptance criterion that a second push finds the existing parent issue rather than creating another. kind is IN the key rather than beside it: a parent_issue and a milestone in one GitHub source are two different containers for one epic, and a key without it would make the push''s second write overwrite its first.';

-- `source_id` is deliberately unindexed, which is `V034`'s decision for `draft_batches
-- .target_source_id` verbatim: it leaves `ticket_sources`' cascade a scan of a table holding a
-- handful of rows per workspace, rather than paying for a second index on every write of every
-- mirror. The epic cascade and the push's own lookup both enter through the key above.
--
-- A `(source_id, kind, external_ref)` index — *which epic is this milestone* — is deliberately
-- not created either. Nothing reads that yet: AL.3 pushes from the epic outwards, and the
-- tracker-to-epic direction arrives with AN.2 (#290), which can add it beside the reader that
-- needs it rather than have it sit here unused.

create trigger epic_mirrors_touch_updated_at
  before update on ouroboros.epic_mirrors
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A mirror's source belongs to the epic's workspace.
--
-- `epic_ticket_in_organization`'s rule for the other join table, and a sibling rather than a reuse
-- for `V034`'s reason: the two read different parents through different columns, and one function
-- branching on which would be harder to read than two that each state one rule.
--
-- Without it an epic could be pushed into another workspace's tracker — which is worse than a
-- broken join, because the failure is a real issue created in somebody else's repository.
-- ---------------------------------------------------------------------------
create function ouroboros.epic_mirror_source_in_organization()
returns trigger language plpgsql as $$
declare
  epic_owner   text;
  source_owner text;
begin
  select e.organization_id into epic_owner
    from ouroboros.planning_epics e
   where e.id = new.epic_id;

  select s.organization_id into source_owner
    from ouroboros.ticket_sources s
   where s.id = new.source_id;

  if epic_owner is not null and source_owner is not null
     and epic_owner is distinct from source_owner then
    raise exception
      'epic mirror names source % in organization % rather than the epic''s %',
      new.source_id, source_owner, epic_owner
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.epic_mirror_source_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for epic_mirrors (#274): refuses a mirror whose source belongs to a different workspace than its epic. A sibling of epic_ticket_in_organization rather than a reuse, for V034''s reason — the two read different parents through different columns. Without it an epic could be pushed into another workspace''s tracker, which is worse than a broken join: the failure is a real issue created in somebody else''s repository.';

create trigger epic_mirrors_source_in_organization
  before insert or update of epic_id, source_id on ouroboros.epic_mirrors
  for each row execute function ouroboros.epic_mirror_source_in_organization();

comment on trigger epic_mirrors_source_in_organization on ouroboros.epic_mirrors is
  'A mirror''s source and its epic belong to the same workspace (#274) — the organization-isolation criterion for this table, which epic_mirrors'' absent organization_id hands to the epic.';

-- ---------------------------------------------------------------------------
-- The column `V034` deferred: draft_batches.epic_id.
--
-- #272 listed it, annotated it with this issue and declined to add it, because the table it
-- references did not exist and a nullable uuid pointing at nothing is how a dangling reference
-- becomes normal. This is the migration that has something to reference.
--
-- `add column` with no default rewrites nothing, so every batch already written reads exactly as
-- it did: a batch belonging to no epic.
-- ---------------------------------------------------------------------------
alter table ouroboros.draft_batches
  -- The epic this batch's drafts belong to — the ER diagram's *batch epic — drafts inherit it*.
  --
  -- `set null` rather than cascade, `ticket_drafts.pushed_ticket_id`'s posture and its reason: a
  -- batch whose epic is deleted is still a batch somebody generated, reviewed and possibly
  -- pushed, and deleting that record to tidy up a lane would lose which issues exist. The batch
  -- survives with a cleared reference.
  --
  -- Nullable in its own right as well as by that rule: a batch generated before anybody drew a
  -- roadmap belongs to no lane, which is the ordinary case and not a missing value.
  add column epic_id uuid references ouroboros.planning_epics (id) on delete set null;

comment on column ouroboros.draft_batches.epic_id is
  'The planning epic this batch''s drafts belong to (#274, the column V034 deferred to AK.3) — mockup 09''s "batch epic", which the drafts inherit and AL.3 (#279) pushes them into. Sets null rather than cascading, ticket_drafts.pushed_ticket_id''s posture: a batch whose epic is deleted is still a batch somebody generated and possibly pushed, and deleting that record to tidy up a lane would lose which issues exist. Null is a batch belonging to no lane, which is the ordinary case rather than a missing value. Held to the batch''s workspace by draft_batches_epic_in_organization.';

-- Deliberately unindexed, which is `target_source_id`'s decision in `V034` and for its reason: the
-- epic's `on delete set null` is a workspace-shaped event over a table holding a handful of
-- batches, and the page's own list already enters through
-- `draft_batches_organization_created_idx`.

-- ---------------------------------------------------------------------------
-- A batch's epic belongs to the batch's workspace.
--
-- The third guard on this table, beside `V034`'s two, and a sibling of them for the same reason
-- those two are siblings of each other. `draft_batches` carries `organization_id` itself, so this
-- one compares against the row rather than against a parent — which is `draft_batch_target_source
-- _in_organization`'s shape exactly, with a different parent table.
-- ---------------------------------------------------------------------------
create function ouroboros.draft_batch_epic_in_organization()
returns trigger language plpgsql as $$
declare
  owner text;
begin
  -- Null `epic_id` is a batch belonging to no lane, which is the ordinary case: nothing to check.
  if new.epic_id is null then
    return new;
  end if;

  select e.organization_id into owner
    from ouroboros.planning_epics e
   where e.id = new.epic_id;

  if owner is not null and owner is distinct from new.organization_id then
    raise exception
      'draft batch names epic %, which belongs to organization % rather than %',
      new.epic_id, owner, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.draft_batch_epic_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for draft_batches (#274): refuses a batch whose epic belongs to another workspace. The third guard on this table beside V034''s two, and a sibling of them rather than a reuse, for that migration''s reason. Returns early on a null epic_id, which is a batch belonging to no lane — the ordinary case rather than a missing value.';

create trigger draft_batches_epic_in_organization
  before insert or update of organization_id, epic_id on ouroboros.draft_batches
  for each row execute function ouroboros.draft_batch_epic_in_organization();

comment on trigger draft_batches_epic_in_organization on ouroboros.draft_batches is
  'A batch and its planning epic belong to the same workspace (#274) — the isolation rule the new epic_id reference needs, which no foreign key can state.';
