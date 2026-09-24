-- V056__pr_gates.sql — `pr_gate_definitions` and `pr_gate_results`: the declarative gate set a
-- PR is held to, and a verdict snapshot per gate per revision.
--
-- Mockup 12 (docs/mockups/12-pr-verification.html), the Verification gates card:
--
--     Verification gates                                             5 / 7 green
--     ✓ Build                      forge-01 · zephyr.elf · FLASH 43.5%
--     ✓ Test suite                 63/63 after attempt 4
--     ✓ Physical HIL               overshoot 1.7% ≤ 2.0% · rig helios-rig-02
--     ✓ Diff-vs-plan conformance   all hunks map to planned files · 0 out-of-scope edits
--     ✓ Secrets & license scan     clean
--     ◌ Second-model review        cursor/composer-2 voting…
--     ○ Human approval             not required by policy       [auto-merge eligible]
--
-- and, on the revision strip, Revision 1's `2 gates red`.
--
-- Filed as issue #353 (AW.2). Needs V052 (#352); feeds the gate engine (#358) and the gates
-- card (#365).
--
--
-- Decision V2 — gates are declarative (option 2-A).
-- ---------------------------------------------------------------------------
--
-- The workflow DSL already lets a tenant say which gates a workflow requires, so the seven rows
-- above are **data**, not a hardcoded list. Each gate is a `pr_gate_definitions` row —
-- `{gate_key, source, required}` — materialized from the pinned policy and org config when the
-- PR is created or synced (#358). Adding a gate kind later is a definition plus a provider, not
-- a schema change: `gate_key` is the seven built-in keys **or** any `custom:<name>`.
--
-- `source` is the definition's provenance — `standard-fix@v14 pin`, `org config` — so "why does
-- this PR have this gate?" is answered by the row itself. A definition's `pr_id` and `gate_key`
-- are frozen once written (`pr_gate_definitions_identity_frozen`): its results mean "this gate
-- on this PR", and re-pointing it would silently re-label its history. `required`, `source`,
-- `label` and `sort_order` may still move — V5's *Request human review* flips a gate to required.
--
--
-- Snapshots per revision.
-- ---------------------------------------------------------------------------
--
-- Revision 1 was blocked with two red gates, and that has to survive Revision 2 turning them
-- green. So a verdict is never a column on the definition: it is a `pr_gate_results` row
-- scoped to `(definition_id, revision_id)`, and the revision must be one of the definition's
-- own PR (`pr_gate_results_revision_of_pr`). Re-evaluation **appends** — results are unique by
-- `(definition_id, revision_id, evaluated_at)` and the application may insert but not update or
-- delete them — and `pr_gate_results_latest` is the card's read: exactly one row per gate per
-- revision, the newest.
--
--
-- The verdict vocabulary — six values, not three.
-- ---------------------------------------------------------------------------
--
--   | verdict        | means                                                | merge precondition |
--   |----------------|------------------------------------------------------|--------------------|
--   | `green`        | the provider evaluated it and it passed              | satisfied          |
--   | `red`          | the provider evaluated it and it failed              | not satisfied      |
--   | `pending`      | the provider exists and is evaluating                | not satisfied      |
--   | `waived`       | policy: a person waived it                           | satisfied          |
--   | `not_required` | policy: it does not apply to this revision           | satisfied          |
--   | `unavailable`  | no provider exists yet (model_review before AZ.1)    | not satisfied      |
--
-- `waived` and `not_required` are policy, not outcome: neither is `green`, though both let a
-- merge through. **`unavailable` is not `pending`.** A gate whose provider does not exist yet
-- would otherwise spin forever while implying a review is running; the distinction lives in the
-- CHECK so no reader can lose it.
--
--
-- The aggregate — `x of y green` (`ouroboros.pr_gate_aggregate(revision_id)`).
-- ---------------------------------------------------------------------------
--
-- Computed from `pr_gate_results_latest` for one revision, over the PR's **required**
-- definitions only:
--
--   * `required_count` — **y**: the PR's definitions with `required = true`.
--   * `green_count`    — **x**: of those, the ones whose latest verdict is `green`.
--   * `red_count`      — of those, the ones whose latest verdict is `red` (the strip's `2 gates red`).
--   * `satisfied_count` — of those, the ones whose latest verdict is `green`, `waived` or
--                         `not_required`. A required gate with no result yet is not satisfied.
--   * `merge_ready`    — `required_count > 0 and satisfied_count = required_count`. **This is the
--                         merge button's precondition.** A PR with no definitions is never ready:
--                         an unmaterialized gate set is not a passed one.
--
-- So Revision 2 of the mockup is five `green`, `model_review` `unavailable` (or `pending` once
-- AZ.1 is live) and `human_approval` `not_required`, all seven required: **5 of 7 green**,
-- 6 satisfied, not merge-ready. The human-approval gate is *required* and its verdict is
-- `not_required`: the definition says the policy owns the question, and the verdict is the
-- policy's answer for this revision. `required = false` is for an advisory gate the card shows
-- but the merge does not wait on.
--
--
-- Evidence.
-- ---------------------------------------------------------------------------
--
-- `evidence` is the row's mono line, composed by the provider — `forge-01 · zephyr.elf · FLASH
-- 43.5%` — at most 512 characters. `evidence_ref` is a typed link to the row that line was
-- composed from: exactly `{"kind": …, "id": "<uuid>"}` (`pr_gate_evidence_ref_shaped`), where
-- kind is one of
--
--   | kind                   | resolves to                                         |
--   |------------------------|-----------------------------------------------------|
--   | `build_job`            | `build_jobs` (V040) of the PR's workspace           |
--   | `test_run`             | `test_runs` (V051) of the PR's workspace            |
--   | `hil_measurement`      | `hil_measurements` (V053) of the PR's workspace     |
--   | `guardrail_evaluation` | `guardrail_evaluations` (V048) of a workspace run   |
--   | `vote`                 | **reserved** — model-review votes land with AZ.1 (#371) |
--   | `approval`             | **reserved** — approval records land with AX.5      |
--
-- The link is resolved at write (`pr_gate_results_evidence_ref_resolves`), so it names a real
-- row of the PR's own workspace when it is stored. The two reserved kinds are in the vocabulary
-- so the shape is stable, but they are **refused** until their tables exist — a reference that
-- cannot be resolved would be a link that lies. The migration that adds each table extends
-- `pr_gate_evidence_ref_resolves` with its kind.
--
--
-- Tenancy.
-- ---------------------------------------------------------------------------
--
-- Neither table carries `organization_id`, for V052's reason: every read enters through the PR,
-- and `pr_id` / `definition_id` / `revision_id` cascade. The one cross-table check that needs the
-- workspace — the evidence link — takes it from the PR.

-- ---------------------------------------------------------------------------
-- pr_gate_definitions — the gate set a PR is held to.
-- ---------------------------------------------------------------------------
create table ouroboros.pr_gate_definitions (
  id          uuid        primary key default gen_random_uuid(),

  pr_id       uuid        not null
                          references ouroboros.pull_requests (id) on delete cascade,

  -- One of the seven built-in keys, or custom:<name>. Frozen once written.
  gate_key    text        not null,
  -- Provenance: which pinned policy or org config produced this gate.
  source      text        not null,
  -- True: counts toward the aggregate's denominator and the merge precondition.
  required    boolean     not null default true,
  sort_order  integer     not null default 0,
  -- The card's row title — Build, Test suite, Physical HIL.
  label       text        not null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint pr_gate_definitions_pr_gate_key unique (pr_id, gate_key),

  constraint pr_gate_definitions_gate_key
    check (gate_key in ('build', 'test_suite', 'physical_hil', 'diff_vs_plan',
                        'secrets_license', 'model_review', 'human_approval')
           or gate_key ~ '^custom:[a-z0-9][a-z0-9_.-]{0,62}$'),

  constraint pr_gate_definitions_source_present
    check (length(btrim(source)) > 0),

  constraint pr_gate_definitions_label_present
    check (length(btrim(label)) > 0),

  constraint pr_gate_definitions_sort_order_non_negative
    check (sort_order >= 0)
);

comment on table ouroboros.pr_gate_definitions is
  'One gate a PR is held to (#353, AW.2, decision V2) — a row of mockup 12''s Verification gates card, materialized from the pinned workflow policy and org config (#358). Declarative: a new gate kind is a custom:* definition plus a provider, not a migration. Verdicts live in pr_gate_results, per revision.';
comment on column ouroboros.pr_gate_definitions.gate_key is
  'build | test_suite | physical_hil | diff_vs_plan | secrets_license | model_review | human_approval, or custom:<name> (lowercase, digits, _ . -; at most 63 characters after the prefix). Unique per PR; frozen once written.';
comment on column ouroboros.pr_gate_definitions.source is
  'Provenance — the pinned policy or org config that produced this gate, e.g. "standard-fix@v14 pin" or "org config". Answers "why does this PR have this gate?".';
comment on column ouroboros.pr_gate_definitions.required is
  'True when the gate counts toward pr_gate_aggregate''s denominator and the merge precondition. False is an advisory gate the card shows but the merge does not wait on.';
comment on column ouroboros.pr_gate_definitions.sort_order is
  'The card''s row order, ascending; ties break by gate_key.';
comment on column ouroboros.pr_gate_definitions.label is
  'The card''s row title — Build, Test suite, Physical HIL.';

create trigger pr_gate_definitions_touch_updated_at
  before update on ouroboros.pr_gate_definitions
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- A definition's identity does not change.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_gate_definitions_identity_frozen()
returns trigger
language plpgsql
as $$
begin
  if (new.pr_id, new.gate_key) is distinct from (old.pr_id, old.gate_key) then
    raise exception 'a gate definition''s pr and gate_key are fixed once written'
      using errcode = 'check_violation', constraint = tg_name;
  end if;
  return new;
end;
$$;

comment on function ouroboros.pr_gate_definitions_identity_frozen() is
  'Refuses changing a gate definition''s pr_id or gate_key (#353): its results mean "this gate on this PR", and re-pointing the definition would re-label that history. required, source, label and sort_order may still change.';

create trigger pr_gate_definitions_identity_frozen
  before update of pr_id, gate_key on ouroboros.pr_gate_definitions
  for each row execute function ouroboros.pr_gate_definitions_identity_frozen();

-- ---------------------------------------------------------------------------
-- The evidence link's shape, as a function a CHECK can call.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_gate_evidence_ref_shaped(p_ref jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  -- A case, not an or: SQL does not promise to evaluate an and left to right, and
  -- jsonb_object_keys raises on anything but an object.
  select case
    when p_ref is null then true
    when jsonb_typeof(p_ref) <> 'object' then false
    else (select array_agg(k order by k) from jsonb_object_keys(p_ref) k)
              = array['id', 'kind']
          and jsonb_typeof(p_ref -> 'kind') = 'string'
          and p_ref ->> 'kind' in ('build_job', 'test_run', 'hil_measurement',
                                   'guardrail_evaluation', 'vote', 'approval')
          and jsonb_typeof(p_ref -> 'id') = 'string'
          and p_ref ->> 'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  end
$$;

comment on function ouroboros.pr_gate_evidence_ref_shaped(jsonb) is
  'True when an evidence_ref is null or exactly {"kind", "id"} — kind one of build_job, test_run, hil_measurement, guardrail_evaluation, vote, approval, and id a lowercase uuid string (#353). Shape only; pr_gate_evidence_ref_resolves says whether it names a row.';

-- ---------------------------------------------------------------------------
-- The evidence link names a real row of the PR's workspace.
--
-- **`security definer`**, on V055's argument: the trigger calls it as the writer, and
-- `ouroboros_app` holds no grant on `build_jobs` — the farm's table — yet a Build gate's
-- evidence has to be checked against it. `search_path` is pinned with `pg_temp` last, it answers
-- only yes or no, and `execute` is revoked from `public` and granted to the one role whose writes
-- fire it.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_gate_evidence_ref_resolves(p_organization_id text, p_ref jsonb)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
  -- A case, not an or: only a shaped link may reach the uuid casts.
  select case
           when p_ref is null then true
           when not ouroboros.pr_gate_evidence_ref_shaped(p_ref) then false
           when p_ref ->> 'kind' = 'build_job' then exists (
             select 1 from ouroboros.build_jobs j
              where j.id = (p_ref ->> 'id')::uuid and j.organization_id = p_organization_id)
           when p_ref ->> 'kind' = 'test_run' then exists (
             select 1 from ouroboros.test_runs t
              where t.id = (p_ref ->> 'id')::uuid and t.organization_id = p_organization_id)
           when p_ref ->> 'kind' = 'hil_measurement' then exists (
             select 1 from ouroboros.hil_measurements m
              where m.id = (p_ref ->> 'id')::uuid and m.organization_id = p_organization_id)
           when p_ref ->> 'kind' = 'guardrail_evaluation' then exists (
             select 1 from ouroboros.guardrail_evaluations g
               join ouroboros.runs r on r.id = g.run_id
              where g.id = (p_ref ->> 'id')::uuid and r.organization_id = p_organization_id)
           -- vote and approval are reserved: no table to resolve against yet.
           else false
         end
$$;

comment on function ouroboros.pr_gate_evidence_ref_resolves(text, jsonb) is
  'True when an evidence_ref is null or names a real row of the given workspace (#353): build_job → build_jobs, test_run → test_runs, hil_measurement → hil_measurements, guardrail_evaluation → guardrail_evaluations of a workspace run. False for vote and approval, which are reserved until AZ.1 (#371) and AX.5 add their tables — each of those migrations extends this function.';

-- ---------------------------------------------------------------------------
-- pr_gate_results — one verdict for one gate on one revision, appended per evaluation.
-- ---------------------------------------------------------------------------
create table ouroboros.pr_gate_results (
  id                uuid        primary key default gen_random_uuid(),

  definition_id     uuid        not null
                                references ouroboros.pr_gate_definitions (id) on delete cascade,
  revision_id       uuid        not null
                                references ouroboros.pr_revisions (id) on delete cascade,

  verdict           text        not null,
  -- The row's mono line, composed by the provider.
  evidence          text,
  -- {kind, id} — the row the evidence line was composed from.
  evidence_ref      jsonb,
  evaluated_at      timestamptz not null default now(),
  -- Which provider build produced the verdict — the audit's "who said so".
  provider_version  text        not null,

  created_at        timestamptz not null default now(),

  constraint pr_gate_results_evaluation_key unique (definition_id, revision_id, evaluated_at),

  constraint pr_gate_results_verdict
    check (verdict in ('green', 'red', 'pending', 'waived', 'not_required', 'unavailable')),

  constraint pr_gate_results_evidence_bounded
    check (evidence is null or (length(btrim(evidence)) > 0 and length(evidence) <= 512)),

  constraint pr_gate_results_evidence_ref_shape
    check (ouroboros.pr_gate_evidence_ref_shaped(evidence_ref)),

  constraint pr_gate_results_provider_version_present
    check (length(btrim(provider_version)) > 0)
);

comment on table ouroboros.pr_gate_results is
  'One evaluation of one gate on one revision (#353, AW.2) — append-only, so Revision 1''s red gates stay inspectable after Revision 2 turns them green. The card reads pr_gate_results_latest; pr_gate_aggregate computes "x of y green" and the merge precondition from it.';
comment on column ouroboros.pr_gate_results.verdict is
  'green | red | pending | waived | not_required | unavailable. waived and not_required are policy (they satisfy the merge precondition but are not green); unavailable means no provider exists yet and is never the same as pending (a provider evaluating).';
comment on column ouroboros.pr_gate_results.evidence is
  'The row''s mono line, composed by the provider — "forge-01 · zephyr.elf · FLASH 43.5%". At most 512 characters.';
comment on column ouroboros.pr_gate_results.evidence_ref is
  'A typed link {"kind", "id"} to the row the evidence was composed from: build_job, test_run, hil_measurement or guardrail_evaluation, resolved in the PR''s workspace at write. vote and approval are reserved and refused until their tables exist.';
comment on column ouroboros.pr_gate_results.evaluated_at is
  'When the provider evaluated. Unique per (definition, revision), so a re-evaluation appends rather than overwrites.';
comment on column ouroboros.pr_gate_results.provider_version is
  'The provider build that produced the verdict, e.g. "gate-build@1.0.0".';

-- The latest-per-(definition, revision) read, and the revision's card.
create index pr_gate_results_revision_idx
  on ouroboros.pr_gate_results (revision_id, definition_id, evaluated_at desc);

-- ---------------------------------------------------------------------------
-- A result's revision is one of its definition's own PR.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_gate_results_revision_of_pr()
returns trigger
language plpgsql
as $$
declare
  definition_pr uuid;
  revision_pr   uuid;
begin
  select d.pr_id into definition_pr from ouroboros.pr_gate_definitions d where d.id = new.definition_id;
  select v.pr_id into revision_pr from ouroboros.pr_revisions v where v.id = new.revision_id;

  -- Either missing is its foreign key's to report.
  if definition_pr is not null and revision_pr is not null and definition_pr <> revision_pr then
    raise exception
      'gate result pairs definition % (pr %) with revision % (pr %) — both must be the same PR''s',
      new.definition_id, definition_pr, new.revision_id, revision_pr
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_gate_results_revision_of_pr() is
  'Refuses a gate result whose revision belongs to a different PR than its definition (#353).';

create trigger pr_gate_results_revision_of_pr
  before insert or update of definition_id, revision_id on ouroboros.pr_gate_results
  for each row execute function ouroboros.pr_gate_results_revision_of_pr();

-- ---------------------------------------------------------------------------
-- The evidence link resolves in the PR's workspace.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_gate_results_evidence_ref_resolves()
returns trigger
language plpgsql
as $$
declare
  owner text;
begin
  -- Null, and a malformed link, are not this trigger's: the latter is
  -- pr_gate_results_evidence_ref_shape's to refuse by its own name.
  if new.evidence_ref is null or not ouroboros.pr_gate_evidence_ref_shaped(new.evidence_ref) then
    return new;
  end if;

  select p.organization_id into owner
    from ouroboros.pr_gate_definitions d
    join ouroboros.pull_requests p on p.id = d.pr_id
   where d.id = new.definition_id;

  -- A missing definition is its foreign key's to report.
  if owner is null then
    return new;
  end if;

  if new.evidence_ref ->> 'kind' in ('vote', 'approval') then
    raise exception
      'evidence kind % is reserved — its table has not landed yet, so the link cannot be resolved',
      new.evidence_ref ->> 'kind'
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if not ouroboros.pr_gate_evidence_ref_resolves(owner, new.evidence_ref) then
    raise exception
      'evidence % % is not a row of organization %',
      new.evidence_ref ->> 'kind', new.evidence_ref ->> 'id', owner
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.pr_gate_results_evidence_ref_resolves() is
  'Refuses a gate result whose evidence_ref does not name a real row of the PR''s workspace, and refuses the reserved kinds vote and approval until their tables exist (#353).';

create trigger pr_gate_results_evidence_ref_resolves
  before insert or update of definition_id, evidence_ref on ouroboros.pr_gate_results
  for each row execute function ouroboros.pr_gate_results_evidence_ref_resolves();

-- ---------------------------------------------------------------------------
-- The card's read: the newest result per gate per revision.
-- ---------------------------------------------------------------------------
create view ouroboros.pr_gate_results_latest as
select distinct on (r.definition_id, r.revision_id)
       r.id                as result_id,
       d.pr_id,
       r.revision_id,
       r.definition_id,
       d.gate_key,
       d.label,
       d.required,
       d.sort_order,
       d.source,
       r.verdict,
       r.evidence,
       r.evidence_ref,
       r.evaluated_at,
       r.provider_version
  from ouroboros.pr_gate_results r
  join ouroboros.pr_gate_definitions d on d.id = r.definition_id
 order by r.definition_id, r.revision_id, r.evaluated_at desc;

comment on view ouroboros.pr_gate_results_latest is
  'Exactly one row per (gate definition, revision) — the newest evaluation (#353). The Verification gates card for a revision is this view filtered by revision_id, ordered by sort_order then gate_key. A gate with no result yet has no row here.';

-- ---------------------------------------------------------------------------
-- The aggregate — `x of y green` and the merge precondition. See the header.
-- ---------------------------------------------------------------------------
create function ouroboros.pr_gate_aggregate(p_revision_id uuid)
returns table (
  required_count  integer,
  green_count     integer,
  red_count       integer,
  satisfied_count integer,
  merge_ready     boolean
)
language sql
stable
as $$
  with gates as (
    select l.verdict
      from ouroboros.pr_revisions v
      join ouroboros.pr_gate_definitions d on d.pr_id = v.pr_id and d.required
      left join ouroboros.pr_gate_results_latest l
        on l.definition_id = d.id and l.revision_id = v.id
     where v.id = p_revision_id
  ),
  counts as (
    select count(*)::integer                                              as required_count,
           count(*) filter (where verdict = 'green')::integer             as green_count,
           count(*) filter (where verdict = 'red')::integer               as red_count,
           count(*) filter (where verdict in ('green', 'waived', 'not_required'))::integer
                                                                          as satisfied_count
      from gates
  )
  select required_count, green_count, red_count, satisfied_count,
         required_count > 0 and satisfied_count = required_count
    from counts
$$;

comment on function ouroboros.pr_gate_aggregate(uuid) is
  'The Verification gates card''s "x of y green" for one revision, and the merge precondition (#353). Over the PR''s required definitions only: required_count is y; green_count is x (latest verdict green); red_count is the revision strip''s "N gates red"; satisfied_count counts green, waived and not_required (pending, unavailable, red and no result yet do not satisfy); merge_ready is required_count > 0 and satisfied_count = required_count. One row, always — zeros for an unknown revision.';

-- ---------------------------------------------------------------------------
-- Grants.
--
-- V022's block, for V022's reason: `ouroboros_app` is the role a deployment that separates
-- *migrating* from *running* connects the API as.
--
--   * **Definitions are materialized and re-synced** — inserted, and updated when the policy or
--     V5's *Request human review* changes `required`. Never deleted: a definition takes its
--     results with it, and those are the record of what was wrong before the fix.
--   * **Results are append-only.** A re-evaluation is a new row; nothing rewrites a verdict.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update on ouroboros.pr_gate_definitions to ouroboros_app;
grant select, insert on ouroboros.pr_gate_results to ouroboros_app;
grant select on ouroboros.pr_gate_results_latest to ouroboros_app;

revoke delete on ouroboros.pr_gate_definitions from ouroboros_app;
revoke delete on ouroboros.pr_gate_definitions from public;
revoke update, delete on ouroboros.pr_gate_results from ouroboros_app;
revoke update, delete on ouroboros.pr_gate_results from public;

revoke execute on function ouroboros.pr_gate_evidence_ref_resolves(text, jsonb) from public;
grant execute on function ouroboros.pr_gate_evidence_ref_shaped(jsonb),
                          ouroboros.pr_gate_evidence_ref_resolves(text, jsonb),
                          ouroboros.pr_gate_aggregate(uuid)
  to ouroboros_app;
