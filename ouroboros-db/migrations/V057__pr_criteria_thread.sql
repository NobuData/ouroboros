-- V057__pr_criteria_thread.sql — `pr_criteria`, `pr_criteria_evidence` and `pr_thread_entries`:
-- the acceptance-criteria matrix and the review thread of the PR Verification page.
--
-- Mockup 12 (docs/mockups/12-pr-verification.html):
--
--     DOES THE PR DO WHAT THE TICKET SAYS?                                 Issue #482 →
--     Telemetry frames must arrive in ISR order under load
--         test_frame_order_under_load (10⁶ frames, 0 reordered) · hunk telemetry_buf.c:41–66
--                                                                          ✓ verified
--     No regression in e-stop response envelope
--         HIL overshoot 1.7% vs 2.0% limit (was 2.4% in rev 1)            ✓ verified
--     Fix must not mask real ordering bugs in tests
--         test asserts on seq gaps, not sleep-based                       ✓ verified
--     Zero heap allocation in ISR fast path
--         static K_MSGQ_DEFINE · stack analysis clean                     ✓ verified
--     Flake must not reappear across temperature range
--         rig runs at 22°C only — thermal chamber not in bench            waived · annotated on PR
--
--     REVIEW THREAD                                                  3 entries · 0 open
--     claude-fable-5            self-review                            ✓ resolved
--     cursor/composer-2         second opinion · rev 1   was blocking  ✓ resolved
--         ↳ Addressed in attempt 4 — sampling decoupled from telemetry drain.
--     ouroboros policy bot      policy
--
-- Filed as issue #354 (AW.3). Needs V052 (#352); waivers are V055's (#327); evidence resolves
-- against V051 (#324), V053 (#325) and V055. Feeds the criteria service (#359), the matrix
-- (#366) and the thread card (#368).
--
--
-- Decision V6 — evidence is a typed reference, validated at write.
-- ---------------------------------------------------------------------------
--
-- "Does this PR do what the ticket said?" is only answerable if each claim points at something
-- real. A matrix of hand-written evidence strings would look identical to the mockup's and mean
-- nothing, and would go stale silently the first time a test was renamed. So each evidence row
-- has a `kind` and the typed reference columns of that kind — and only those
-- (`pr_criteria_evidence_kind_shape`):
--
--   | kind              | reference columns                                   | resolves to                          |
--   |-------------------|-----------------------------------------------------|--------------------------------------|
--   | `test_case`       | `test_case_id`                                      | `test_cases` (V051) of the workspace |
--   | `hil_measurement` | `hil_measurement_id`                                | `hil_measurements` (V053) of the workspace |
--   | `build_artifact`  | `test_artifact_id`                                  | `test_artifacts` (V055) of the workspace |
--   | `hunk`            | `revision_id`, `hunk_path`, `hunk_line_start/end`   | a path in that revision's `files` snapshot (V052) |
--   | `analysis_note`   | `revision_id`                                       | a revision of the criterion's PR     |
--
-- **Dangling references are rejected, never stored.** The id columns are foreign keys, so a
-- reference to a row that does not exist fails at write; `pr_criteria_evidence_resolves` then
-- holds each one to the PR's own workspace, a revision to the PR's own revisions, and a hunk's
-- path to that revision's files snapshot. `display_text` is the composed mono line the matrix
-- renders — `test_frame_order_under_load (10⁶ frames, 0 reordered)` — and it is a rendering of
-- the reference, not a substitute for one.
--
-- **Hunks.** V052's snapshot is `{path, additions, deletions}` per file and carries no line
-- counts, so the schema can hold a hunk to *a file this revision changed* and to a well-formed
-- range (`1 ≤ hunk_line_start ≤ hunk_line_end`), but not to the file's length. What it refuses
-- is the free-text failure: `telemetry_buf.c:41–66` on a revision that never touched
-- `drivers/can/telemetry_buf.c`.
--
-- **An analysis note** — `static K_MSGQ_DEFINE · stack analysis clean` — is a person's or a
-- tool's reading of the code, so its text *is* the evidence; what it must resolve to is the
-- revision it read.
--
-- **When the target goes.** A re-parse replaces test cases (V051), so evidence cannot pin its
-- target in place: every reference cascades, and the evidence row leaves with what it cited.
-- If that leaves a `verified` criterion with no evidence, `pr_criteria_evidence_demote` moves it
-- back to `unverified` — a claim whose proof is gone is no longer verified, and saying so is the
-- honest reading. Evidence is never rewritten (`pr_criteria_evidence_frozen`): a different
-- citation is a different row.
--
--
-- The criterion lifecycle.
-- ---------------------------------------------------------------------------
--
--   * `unverified` — the claim is stated; nothing yet shows it holds.
--   * `verified`   — requires **at least one evidence row** (`pr_criteria_verified_has_evidence`).
--                    So a criterion is inserted `unverified`, its evidence added, then marked
--                    `verified` — and it drops back if its last evidence row goes (above).
--   * `waived`     — exactly when `waiver_ref` names an AS.4 waiver (`pr_criteria_waiver_iff_waived`)
--                    of the PR's own loop (`pr_criteria_waiver_of_pr_run`). The waiver's `reason`
--                    is the row's text: *rig runs at 22°C only — thermal chamber not in bench*.
--                    Decision V9 publishes it to the host PR (#359); a waiver that lives only in
--                    this database is a waiver that hides.
--
-- `source` is V6's provenance: `plan` (from the ticket's plan), `manual` (authored here) or
-- `extracted` — **reserved** for AZ.2 (#372), in the vocabulary so the shape is stable and
-- refused by `pr_criteria_source_extracted_reserved` until that migration drops it. Option 4-A:
-- a model may suggest a claim, a human confirms it, and no code path auto-verifies one.
--
-- A criterion's `pr_id` is frozen once written: its evidence was resolved against that PR.
--
--
-- The review thread — provenance, and the blocking lifecycle.
-- ---------------------------------------------------------------------------
--
-- `author_kind` is explicit — `model`, `policy_bot` or `human` — because a fabricated second
-- opinion attached to real code would be the worst thing this page could render. **Real model
-- entries are reserved for AZ.1 (#371) / AZ.5 (#375)**, when they are genuinely produced; until
-- then a model-authored row must carry R4's `simulated` watermark (V046's transcript rule), and
-- `pr_thread_entries_model_simulated` refuses one that does not. AZ.1 relaxes that constraint in
-- the same change that makes a real model entry possible.
--
-- `author_name` is the mono label (`claude-fable-5`, `ouroboros policy bot`); `author_id` is an
-- Ouroboros user and so only ever on a `human` row. `tag` is `self-review`, `second opinion` or
-- `policy`.
--
-- The lifecycle is one-way (`pr_thread_entries_lifecycle`): `blocking` and `resolved` may be
-- raised but never lowered, `resolution_body` — the resolving reply — is written with or before
-- the resolution and is fixed after it, and everything else about an entry is what was said.
-- That is what keeps *was blocking → resolved* an arc rather than an edit: the pill is
-- `blocking and resolved`, and the reply beneath it is `resolution_body`.
--
--
-- The open count — `3 entries · 0 open` (`ouroboros.pr_thread_summary(pr_id)`).
-- ---------------------------------------------------------------------------
--
--   * `entry_count` — every thread entry of the PR.
--   * `open_count`  — entries with **`blocking and not resolved`**. A non-blocking entry is never
--                     open, resolved or not; a resolved blocking entry is *was blocking*.
--
--
-- Tenancy.
-- ---------------------------------------------------------------------------
--
-- No table carries `organization_id`, for V052's reason: every read enters through the PR, and
-- `pr_id` / `criterion_id` cascade. The cross-table checks that need the workspace take it from
-- the PR. Every table they read is already readable by `ouroboros_app`, so none of them needs to
-- run as its owner.

-- ---------------------------------------------------------------------------
-- pr_criteria — one quoted claim of the ticket, and whether this PR meets it.
-- ---------------------------------------------------------------------------
create table ouroboros.pr_criteria (
  id          uuid        primary key default gen_random_uuid(),

  pr_id       uuid        not null
                          references ouroboros.pull_requests (id) on delete cascade,

  -- The quoted claim — "Telemetry frames must arrive in ISR order under load".
  claim       text        not null,
  -- V6 provenance: plan | manual | extracted (reserved for AZ.2).
  source      text        not null,
  status      text        not null default 'unverified',
  -- The AS.4 waiver, exactly when waived. Not cascaded: a waived criterion pins its waiver.
  waiver_ref  uuid        references ouroboros.pr_waivers (id),
  sort_order  integer     not null default 0,

  -- Who authored or confirmed it; set null if the person is removed.
  created_by  text        references ouroboros."user" ("id") on delete set null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint pr_criteria_claim_present
    check (length(btrim(claim)) > 0 and length(claim) <= 1024),

  constraint pr_criteria_source
    check (source in ('plan', 'manual', 'extracted')),

  constraint pr_criteria_source_extracted_reserved
    check (source <> 'extracted'),

  constraint pr_criteria_status
    check (status in ('unverified', 'verified', 'waived')),

  constraint pr_criteria_waiver_iff_waived
    check ((status = 'waived') = (waiver_ref is not null)),

  constraint pr_criteria_sort_order_non_negative
    check (sort_order >= 0)
);

comment on table ouroboros.pr_criteria is
  'One claim of the ticket and whether this PR meets it (#354, AW.3, decision V6) — a row of mockup 12''s "Does the PR do what the ticket says?" matrix. verified requires typed evidence in pr_criteria_evidence; waived requires an AS.4 waiver of the PR''s loop. See V057''s header.';
comment on column ouroboros.pr_criteria.claim is
  'The quoted claim, at most 1024 characters — "Telemetry frames must arrive in ISR order under load".';
comment on column ouroboros.pr_criteria.source is
  'V6 provenance: plan (from the ticket''s plan) | manual (authored here) | extracted (reserved for AZ.2, #372 — refused by pr_criteria_source_extracted_reserved until then).';
comment on column ouroboros.pr_criteria.status is
  'unverified | verified (only with at least one evidence row; demoted back when the last one goes) | waived (exactly when waiver_ref is set).';
comment on column ouroboros.pr_criteria.waiver_ref is
  'The AS.4 waiver (#327) whose reason the waived row renders and which V9 annotates on the host PR (#359). Set exactly when status is waived; the waiver must be of the PR''s own run.';
comment on column ouroboros.pr_criteria.sort_order is
  'The matrix''s row order, ascending; ties break by created_at.';
comment on column ouroboros.pr_criteria.created_by is
  'Who authored or confirmed the claim; set null if the person is removed.';

create index pr_criteria_pr_idx
  on ouroboros.pr_criteria (pr_id, sort_order);

create index pr_criteria_waiver_idx
  on ouroboros.pr_criteria (waiver_ref) where waiver_ref is not null;

create trigger pr_criteria_touch_updated_at
  before update on ouroboros.pr_criteria
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A criterion stays on its PR.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_criteria_pr_frozen()
returns trigger
language plpgsql
as $$
begin
  if new.pr_id is distinct from old.pr_id then
    raise exception 'a criterion''s pr is fixed once written — its evidence was resolved against it'
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.pr_criteria_pr_frozen() is
  'Refuses moving a criterion to another PR (#354): its evidence was resolved against the PR''s workspace and revisions.';

create trigger pr_criteria_pr_frozen
  before update of pr_id on ouroboros.pr_criteria
  for each row execute function ouroboros.pr_criteria_pr_frozen();

-- ---------------------------------------------------------------------------
-- A waiver is one of the PR's own loop.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_criteria_waiver_of_pr_run()
returns trigger
language plpgsql
as $$
declare
  pr_run      uuid;
  pr_org      text;
  waiver_run  uuid;
  waiver_org  text;
begin
  if new.waiver_ref is null then
    return new;
  end if;

  select w.run_id, w.organization_id into waiver_run, waiver_org
    from ouroboros.pr_waivers w where w.id = new.waiver_ref;

  -- A missing waiver is its foreign key's to report.
  if waiver_run is null then
    return new;
  end if;

  select p.run_id, p.organization_id into pr_run, pr_org
    from ouroboros.pull_requests p where p.id = new.pr_id;

  if pr_run is distinct from waiver_run or pr_org is distinct from waiver_org then
    raise exception
      'criterion names waiver %, of run % — the waiver must be of the PR''s own run (%)',
      new.waiver_ref, waiver_run, coalesce(pr_run::text, 'none')
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_criteria_waiver_of_pr_run() is
  'Refuses a criterion whose waiver_ref is an AS.4 waiver of a run other than the PR''s own (#354). A PR no loop opened has no run, and so cannot carry a waiver.';

create trigger pr_criteria_waiver_of_pr_run
  before insert or update of pr_id, waiver_ref on ouroboros.pr_criteria
  for each row execute function ouroboros.pr_criteria_waiver_of_pr_run();

-- ---------------------------------------------------------------------------
-- pr_criteria_evidence — one typed reference to what shows a criterion holds.
-- ---------------------------------------------------------------------------
create table ouroboros.pr_criteria_evidence (
  id                  uuid        primary key default gen_random_uuid(),

  criterion_id        uuid        not null
                                  references ouroboros.pr_criteria (id) on delete cascade,

  kind                text        not null,

  -- --- typed references: exactly the columns of `kind` are set ------------------------
  -- Every reference cascades: evidence leaves with what it cited, and never dangles.
  test_case_id        uuid        references ouroboros.test_cases (id) on delete cascade,
  hil_measurement_id  uuid        references ouroboros.hil_measurements (id) on delete cascade,
  test_artifact_id    uuid        references ouroboros.test_artifacts (id) on delete cascade,
  -- hunk and analysis_note: the revision the evidence is about.
  revision_id         uuid        references ouroboros.pr_revisions (id) on delete cascade,
  hunk_path           text,
  hunk_line_start     integer,
  hunk_line_end       integer,

  -- The composed mono line — "test_frame_order_under_load (10⁶ frames, 0 reordered)".
  display_text        text        not null,

  created_at          timestamptz not null default now(),

  constraint pr_criteria_evidence_kind
    check (kind in ('test_case', 'hil_measurement', 'hunk', 'analysis_note', 'build_artifact')),

  -- Coalesced: an unknown kind makes the case null, and a null CHECK passes.
  constraint pr_criteria_evidence_kind_shape
    check (coalesce(case kind
      when 'test_case' then
        test_case_id is not null and hil_measurement_id is null and test_artifact_id is null
        and revision_id is null and hunk_path is null and hunk_line_start is null and hunk_line_end is null
      when 'hil_measurement' then
        test_case_id is null and hil_measurement_id is not null and test_artifact_id is null
        and revision_id is null and hunk_path is null and hunk_line_start is null and hunk_line_end is null
      when 'build_artifact' then
        test_case_id is null and hil_measurement_id is null and test_artifact_id is not null
        and revision_id is null and hunk_path is null and hunk_line_start is null and hunk_line_end is null
      when 'hunk' then
        test_case_id is null and hil_measurement_id is null and test_artifact_id is null
        and revision_id is not null and hunk_path is not null
        and hunk_line_start is not null and hunk_line_end is not null
      when 'analysis_note' then
        test_case_id is null and hil_measurement_id is null and test_artifact_id is null
        and revision_id is not null and hunk_path is null and hunk_line_start is null and hunk_line_end is null
    end, true)),

  constraint pr_criteria_evidence_hunk_range
    check (hunk_line_start is null or hunk_line_end is null
           or (hunk_line_start >= 1 and hunk_line_end >= hunk_line_start)),

  constraint pr_criteria_evidence_hunk_path_present
    check (hunk_path is null or length(btrim(hunk_path)) > 0),

  constraint pr_criteria_evidence_display_text_bounded
    check (length(btrim(display_text)) > 0 and length(display_text) <= 512)
);

comment on table ouroboros.pr_criteria_evidence is
  'One typed reference showing a criterion holds (#354, AW.3, decision V6): a test case, a HIL measurement, an uploaded artifact, a hunk of a revision''s diff, or an analysis note on a revision. Resolved at write — a dangling reference is refused, never stored — and never rewritten. See V057''s header.';
comment on column ouroboros.pr_criteria_evidence.kind is
  'test_case | hil_measurement | hunk | analysis_note | build_artifact. Decides which reference columns are set (pr_criteria_evidence_kind_shape).';
comment on column ouroboros.pr_criteria_evidence.test_case_id is
  'kind test_case: a test_cases row (V051, #324) of the PR''s workspace.';
comment on column ouroboros.pr_criteria_evidence.hil_measurement_id is
  'kind hil_measurement: a hil_measurements row (V053, #325) of the PR''s workspace.';
comment on column ouroboros.pr_criteria_evidence.test_artifact_id is
  'kind build_artifact: a test_artifacts row (V055, #327) of the PR''s workspace.';
comment on column ouroboros.pr_criteria_evidence.revision_id is
  'kind hunk and analysis_note: a revision of the criterion''s own PR.';
comment on column ouroboros.pr_criteria_evidence.hunk_path is
  'kind hunk: a path in the revision''s files snapshot — drivers/can/telemetry_buf.c.';
comment on column ouroboros.pr_criteria_evidence.hunk_line_start is
  'kind hunk: the first line of the range, at least 1. The snapshot has no line counts, so the range is held to its shape, not to the file''s length.';
comment on column ouroboros.pr_criteria_evidence.hunk_line_end is
  'kind hunk: the last line of the range, at least hunk_line_start.';
comment on column ouroboros.pr_criteria_evidence.display_text is
  'The composed mono line the matrix renders, at most 512 characters — a rendering of the reference, never a substitute for it.';

create index pr_criteria_evidence_criterion_idx
  on ouroboros.pr_criteria_evidence (criterion_id);

-- The cascades' lookups.
create index pr_criteria_evidence_test_case_idx
  on ouroboros.pr_criteria_evidence (test_case_id) where test_case_id is not null;
create index pr_criteria_evidence_hil_measurement_idx
  on ouroboros.pr_criteria_evidence (hil_measurement_id) where hil_measurement_id is not null;
create index pr_criteria_evidence_test_artifact_idx
  on ouroboros.pr_criteria_evidence (test_artifact_id) where test_artifact_id is not null;
create index pr_criteria_evidence_revision_idx
  on ouroboros.pr_criteria_evidence (revision_id) where revision_id is not null;

-- ---------------------------------------------------------------------------
-- Evidence resolves in the criterion's PR.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_criteria_evidence_resolves()
returns trigger
language plpgsql
as $$
declare
  owner     text;
  owner_pr  uuid;
  target    text;
  files     jsonb;
  rev_pr    uuid;
begin
  select p.organization_id, p.id into owner, owner_pr
    from ouroboros.pr_criteria c
    join ouroboros.pull_requests p on p.id = c.pr_id
   where c.id = new.criterion_id;

  -- A missing criterion is its foreign key's to report.
  if owner is null then
    return new;
  end if;

  -- A missing target is its foreign key's to report; a present one must be the workspace's.
  if new.test_case_id is not null then
    select t.organization_id into target from ouroboros.test_cases t where t.id = new.test_case_id;
  elsif new.hil_measurement_id is not null then
    select m.organization_id into target from ouroboros.hil_measurements m where m.id = new.hil_measurement_id;
  elsif new.test_artifact_id is not null then
    select a.organization_id into target from ouroboros.test_artifacts a where a.id = new.test_artifact_id;
  end if;

  if target is not null and target <> owner then
    raise exception
      'evidence % names a row of organization %, not of the PR''s (%)', new.kind, target, owner
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.revision_id is not null then
    select v.pr_id, v.files into rev_pr, files from ouroboros.pr_revisions v where v.id = new.revision_id;

    if rev_pr is not null and rev_pr <> owner_pr then
      raise exception
        'evidence % names revision %, which is not a revision of the criterion''s PR', new.kind, new.revision_id
        using errcode = 'check_violation', constraint = tg_name;
    end if;

    if rev_pr is not null and new.hunk_path is not null
       and not exists (select 1 from jsonb_array_elements(files) f where f ->> 'path' = new.hunk_path) then
      raise exception
        'hunk %:%–% is not in revision %''s files snapshot', new.hunk_path, new.hunk_line_start,
        new.hunk_line_end, new.revision_id
        using errcode = 'check_violation', constraint = tg_name;
    end if;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_criteria_evidence_resolves() is
  'Refuses evidence whose test case, HIL measurement or artifact belongs to another workspace than the criterion''s PR, whose revision is not one of that PR''s, or whose hunk_path is not in the revision''s files snapshot (#354, decision V6). A reference to a row that does not exist is its foreign key''s to refuse.';

create trigger pr_criteria_evidence_resolves
  before insert on ouroboros.pr_criteria_evidence
  for each row execute function ouroboros.pr_criteria_evidence_resolves();

-- ---------------------------------------------------------------------------
-- Evidence is never rewritten.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_criteria_evidence_frozen()
returns trigger
language plpgsql
as $$
begin
  raise exception 'evidence % is a citation and cannot be rewritten — delete it and cite again', old.id
    using errcode = 'check_violation', constraint = tg_name;
end;
$$;

comment on function ouroboros.pr_criteria_evidence_frozen() is
  'Refuses every update of an evidence row (#354): a different citation is a different row, and an update would skip the resolution checked at insert.';

create trigger pr_criteria_evidence_frozen
  before update on ouroboros.pr_criteria_evidence
  for each row execute function ouroboros.pr_criteria_evidence_frozen();

-- ---------------------------------------------------------------------------
-- verified needs evidence.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_criteria_verified_has_evidence()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'verified'
     and not exists (select 1 from ouroboros.pr_criteria_evidence e where e.criterion_id = new.id) then
    raise exception 'criterion % cannot be verified with no evidence', new.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.pr_criteria_verified_has_evidence() is
  'Refuses a criterion reaching verified with no pr_criteria_evidence row (#354). A criterion is therefore inserted unverified or waived, its evidence added, then marked verified.';

create trigger pr_criteria_verified_has_evidence
  before insert or update of status on ouroboros.pr_criteria
  for each row execute function ouroboros.pr_criteria_verified_has_evidence();

-- ---------------------------------------------------------------------------
-- A verified criterion whose last evidence goes is no longer verified.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_criteria_evidence_demote()
returns trigger
language plpgsql
as $$
begin
  update ouroboros.pr_criteria c
     set status = 'unverified'
   where c.id = old.criterion_id
     and c.status = 'verified'
     and not exists (select 1 from ouroboros.pr_criteria_evidence e where e.criterion_id = c.id);
  return null;
end;
$$;

comment on function ouroboros.pr_criteria_evidence_demote() is
  'Moves a verified criterion back to unverified when its last evidence row is deleted — directly, or by the cascade from a re-parsed test case, a removed measurement or artifact (#354). A claim whose proof is gone is no longer verified.';

create trigger pr_criteria_evidence_demote
  after delete on ouroboros.pr_criteria_evidence
  for each row execute function ouroboros.pr_criteria_evidence_demote();

-- ---------------------------------------------------------------------------
-- pr_thread_entries — one entry of the PR's review thread.
-- ---------------------------------------------------------------------------
create table ouroboros.pr_thread_entries (
  id               uuid        primary key default gen_random_uuid(),

  pr_id            uuid        not null
                               references ouroboros.pull_requests (id) on delete cascade,
  -- The revision the entry was about — "second opinion · rev 1". Null for a PR-wide entry.
  revision_id      uuid        references ouroboros.pr_revisions (id) on delete set null,

  -- --- provenance --------------------------------------------------------------------
  author_kind      text        not null,
  -- An Ouroboros user — human entries only. Set null if the person is removed.
  author_id        text        references ouroboros."user" ("id") on delete set null,
  -- The mono label — claude-fable-5, cursor/composer-2, ouroboros policy bot.
  author_name      text        not null,
  tag              text        not null,

  body             text        not null,

  -- --- the lifecycle: one-way ---------------------------------------------------------
  blocking         boolean     not null default false,
  resolved         boolean     not null default false,
  -- The resolving reply — "Addressed in attempt 4 — …".
  resolution_body  text,

  -- R4's watermark (V046): required on a model entry until AZ.1 (#371).
  simulated        boolean     not null default false,

  created_at       timestamptz not null default now(),

  constraint pr_thread_entries_author_kind
    check (author_kind in ('model', 'policy_bot', 'human')),

  constraint pr_thread_entries_tag
    check (tag in ('self-review', 'second opinion', 'policy')),

  constraint pr_thread_entries_author_id_human
    check (author_id is null or author_kind = 'human'),

  constraint pr_thread_entries_author_name_present
    check (length(btrim(author_name)) > 0 and length(author_name) <= 255),

  constraint pr_thread_entries_body_present
    check (length(btrim(body)) > 0 and length(body) <= 8192),

  constraint pr_thread_entries_resolution_when_resolved
    check (resolution_body is null
           or (resolved and length(btrim(resolution_body)) > 0 and length(resolution_body) <= 8192)),

  constraint pr_thread_entries_model_simulated
    check (author_kind <> 'model' or simulated)
);

comment on table ouroboros.pr_thread_entries is
  'One entry of mockup 12''s review thread (#354, AW.3): explicit author provenance, a tag, the body, and the one-way blocking → resolved lifecycle with the resolving reply. Model entries are reserved for AZ.1 (#371) / AZ.5 (#375) and until then must carry the simulated watermark. The open count is pr_thread_summary. See V057''s header.';
comment on column ouroboros.pr_thread_entries.revision_id is
  'The revision the entry was about — "second opinion · rev 1"; a revision of the entry''s own PR. Null for a PR-wide entry, or once the revision is gone.';
comment on column ouroboros.pr_thread_entries.author_kind is
  'model | policy_bot | human — who really wrote it. A model entry must be simulated until AZ.1 (#371) produces real ones.';
comment on column ouroboros.pr_thread_entries.author_id is
  'The Ouroboros user who wrote a human entry; null on model and policy_bot entries, and set null if the person is removed.';
comment on column ouroboros.pr_thread_entries.author_name is
  'The mono label the card renders — claude-fable-5, cursor/composer-2, ouroboros policy bot, a person''s name.';
comment on column ouroboros.pr_thread_entries.tag is
  'self-review | second opinion | policy.';
comment on column ouroboros.pr_thread_entries.blocking is
  'The entry objects to merging — the card''s left-border treatment. Raised, never lowered: a resolved blocking entry is "was blocking".';
comment on column ouroboros.pr_thread_entries.resolved is
  'The entry is dealt with. Raised, never lowered. An entry is open exactly when blocking and not resolved.';
comment on column ouroboros.pr_thread_entries.resolution_body is
  'The resolving reply — "Addressed in attempt 4 — sampling decoupled from telemetry drain." Only on a resolved entry, written with the resolution and fixed after it.';
comment on column ouroboros.pr_thread_entries.simulated is
  'R4''s watermark (V046): the entry was seeded or simulated, not produced. Required on every model entry until AZ.1 (#371); fixed once written.';

create index pr_thread_entries_pr_idx
  on ouroboros.pr_thread_entries (pr_id, created_at);

create index pr_thread_entries_revision_idx
  on ouroboros.pr_thread_entries (revision_id) where revision_id is not null;

-- ---------------------------------------------------------------------------
-- An entry's revision is one of its own PR.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_thread_entries_revision_of_pr()
returns trigger
language plpgsql
as $$
declare
  revision_pr uuid;
begin
  if new.revision_id is null then
    return new;
  end if;

  select v.pr_id into revision_pr from ouroboros.pr_revisions v where v.id = new.revision_id;

  -- A missing revision is its foreign key's to report.
  if revision_pr is not null and revision_pr <> new.pr_id then
    raise exception 'thread entry names revision %, which is not a revision of pr %',
      new.revision_id, new.pr_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_thread_entries_revision_of_pr() is
  'Refuses a thread entry whose revision belongs to another PR (#354).';

create trigger pr_thread_entries_revision_of_pr
  before insert or update of pr_id, revision_id on ouroboros.pr_thread_entries
  for each row execute function ouroboros.pr_thread_entries_revision_of_pr();

-- ---------------------------------------------------------------------------
-- The lifecycle is one-way, and what was said stays said.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_thread_entries_lifecycle()
returns trigger
language plpgsql
as $$
begin
  -- Only the lifecycle columns move — and the two foreign keys, to null, by their own set null.
  if (to_jsonb(new) - array['blocking', 'resolved', 'resolution_body', 'author_id', 'revision_id'])
     is distinct from (to_jsonb(old) - array['blocking', 'resolved', 'resolution_body', 'author_id', 'revision_id'])
     or (new.author_id is distinct from old.author_id and new.author_id is not null)
     or (new.revision_id is distinct from old.revision_id and new.revision_id is not null) then
    raise exception 'thread entry % records what was said and cannot be rewritten', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.blocking and not new.blocking then
    raise exception 'thread entry % was blocking — resolve it rather than clearing the flag', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.resolved and not new.resolved then
    raise exception 'thread entry % is resolved, and a resolution is not taken back', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if old.resolved and new.resolution_body is distinct from old.resolution_body then
    raise exception 'thread entry % is resolved, and its resolving reply is fixed', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_thread_entries_lifecycle() is
  'Holds a thread entry to what was said (#354): only blocking (false → true), resolved (false → true) and resolution_body (until resolved) change, and author_id and revision_id only to null by their foreign keys. This is what keeps "was blocking → resolved" an arc rather than an edit.';

create trigger pr_thread_entries_lifecycle
  before update on ouroboros.pr_thread_entries
  for each row execute function ouroboros.pr_thread_entries_lifecycle();

-- ---------------------------------------------------------------------------
-- The open count — `3 entries · 0 open`. See the header.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_thread_summary(p_pr_id uuid)
returns table (
  entry_count integer,
  open_count  integer
)
language sql
stable
as $$
  select count(*)::integer,
         count(*) filter (where blocking and not resolved)::integer
    from ouroboros.pr_thread_entries
   where pr_id = p_pr_id
$$;

comment on function ouroboros.pr_thread_summary(uuid) is
  'The review thread card''s "N entries · M open" for one PR (#354): entry_count is every entry; open_count is entries with blocking and not resolved. One row, always — zeros for an unknown PR.';

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason: `ouroboros_app` is the role a deployment that separates
-- *migrating* from *running* connects the API as.
--
--   * **Criteria are authored, edited and removed** — the criteria service's CRUD (#359). What
--     bounds `update` is the triggers above, which bind every role.
--   * **Evidence is cited and uncited** — inserted and deleted, never updated.
--   * **Thread entries are appended and resolved** — never deleted: an entry that vanished would
--     take with it the reason a blocked PR became mergeable.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update, delete on ouroboros.pr_criteria to ouroboros_app;
grant select, insert, delete on ouroboros.pr_criteria_evidence to ouroboros_app;
grant select, insert, update on ouroboros.pr_thread_entries to ouroboros_app;

revoke update on ouroboros.pr_criteria_evidence from ouroboros_app;
revoke update on ouroboros.pr_criteria_evidence from public;
revoke delete on ouroboros.pr_thread_entries from ouroboros_app;
revoke delete on ouroboros.pr_thread_entries from public;

grant execute on function ouroboros.pr_thread_summary(uuid) to ouroboros_app;
