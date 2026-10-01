-- V081__analysis_findings_suggestions.sql — `analysis_findings`, `analysis_suggestions` and
-- `analysis_suggestion_findings`: what the Build Analyzer found, the evidence behind it, and what
-- it suggests doing about it (#507, BU.2, decisions A1/A4).
--
-- Mockup 18 draws three things from these rows:
--
--   * the chart's change-point chips   `Jun 22 · ccache enabled −2m 10s`           — a finding
--   * the two suggestion cards         title · Evidence · `−3m 40s per loop` · `conf 91%`
--                                      · Apply / Details / Dismiss · `needs a spike` — a suggestion
--   * the drafted tickets BA-1…BA-4    title · evidence line                       — a suggestion
--
-- Three properties decide whether that page is an instrument, and all three are schema rules.
--
-- ===========================================================================
-- FINDINGS ARE TYPED — finding_type and data
-- ===========================================================================
--
-- Each finding is one analyzer's output for one subject, and its `data` has the shape of that
-- analyzer's family. `ouroboros.analysis_finding_data_valid()` is the per-type schema, applied by
-- `analysis_findings_data_shape`, so a malformed analyzer output fails at write time instead of
-- rendering as a broken chip. `custom:<name>` is reserved for BX.5's registered analyzers; until
-- that registry exists its data need only be an object.
--
--   change_point       { date: "2026-06-22", metric: "build.duration_median", delta_seconds: -130,
--                        candidates: [ { label: "ccache enabled", score: 0.94, ref: {…} }, … ] }
--                      candidates are ranked, best first; the chip renders date, the first
--                      candidate's label and the delta.
--   log_signature      { template: "…fixture timeout…", signature_hash: "<hex>", count: 31,
--                        share: 0.072, sample_refs: [ {…}, … ] }
--   config_usage       { option: "CONFIG_FOO", occurrences: 0, builds_considered: 1284,
--                        drift_warnings?: 1 }
--   cache_window       { trigger: "deps-refresh merge", hit_rate_before: 0.78,
--                        hit_rate_after: 0.31, window_hours: 6, occurrences: 14 }
--   queue_correlation  { window: { from: "14:00", to: "16:00" }, metric: "queue_wait",
--                        threshold_seconds: 300, days_exceeded: 11, days_observed: 14,
--                        idle_share?: 0.82 }                                    (times are UTC)
--   waiver_cite        { topic: "missing thermal coverage", window_days: 60, waiver_count: 3 }
--                      waiver_count is the number of waiver refs in evidence_refs — no more.
--   workflow_outcome   { workflow: "standard-fix", scope: "stage qemu_cortex_m3",
--                        metric: "unique_failures", value: 0, unit: "count", sample: 214 }
--                      unit is count | share | ratio | seconds; a share is 0–1.
--
-- ===========================================================================
-- EVIDENCE RESOLVES — evidence_refs
-- ===========================================================================
--
-- *"31 builds"* is a claim; 31 stored build ids are evidence. `evidence_refs` is a non-empty
-- array of distinct `{kind, id}` references, each kind routing to one table so the Details
-- sheet can click through:
--
--   kind              id                     resolves to (within the finding's workspace)
--   ---------------   --------------------   ---------------------------------------------------
--   build             uuid                   build_jobs.id
--   test_run          uuid                   test_runs.id
--   test_case         uuid                   test_cases.id
--   waiver            uuid                   pr_waivers.id
--   merge             7–40 hex sha           a commit a build, a test run or a merge plan recorded
--   workflow_version  uuid                   workflow_versions.id (of the workspace's workflow)
--   runner_pool       uuid                   runner_pools.id
--   runner            uuid                   runners.id
--
-- `analysis_findings_write_guard` refuses a finding whose ref does not resolve **when it is
-- written**. References are not foreign keys on purpose: a finding is a record of what was true
-- of the corpus, and retention removing a build later must not rewrite or delete it. Any ref
-- `data` cites — a change-point candidate, a signature sample — must also be in
-- `evidence_refs`, so resolving the one list resolves them all (`analysis_findings_data_refs_cited`).
--
-- Confidence is 0–100 with its basis stored beside it — `confidence_basis` `{method,
-- sample_size, effect_size, stability}`, where `method` names the analyzer's documented scoring
-- rule — so the scoring popover has real content.
--
-- Findings are written while their run is `running`, by an analyzer the run's `analyzer_set`
-- names at that version, and are never revised afterwards.
--
-- ===========================================================================
-- SUGGESTIONS HAVE IDENTITY — identity_key, and the A4 lifecycle
-- ===========================================================================
--
-- The analyzer runs weekly. If each run minted new suggestions every dismissal would evaporate
-- and the page would re-propose rejected ideas forever. So:
--
--   * a **finding's identity** is `analyzer@v<version>/<subject_key>` (the generated
--     `identity_key`) — the option name, the signature hash, the pool id — the same across runs
--     over the same corpus;
--   * a **suggestion's identity** is `<kind>:<sha256 of its findings' distinct identities,
--     sorted>` (`analysis_suggestion_identity()`), unique per (workspace, repo). It is checked
--     against the findings it cites at commit (`analysis_suggestions_identity_holds`), so it
--     cannot be minted by hand;
--   * `record_analysis_suggestion()` is the composer's write: it upserts on that identity, so a
--     re-run **updates** the existing row — its `last_run_id`, and its composed content while it
--     is still `open` — and links the new run's findings. A dismissed suggestion stays dismissed.
--
-- A suggestion cites one or more findings through `analysis_suggestion_findings`: the test-gate
-- split draws on unique-failure attribution *and* stage timings, and a one-finding foreign key
-- would force a duplicate or a lie.
--
-- `title`, `evidence_line` and `confidence` are stored as composed, not recomputed at read, so a
-- historical suggestion reads as it did. `impact` is `{estimate, unit, applies_to, share?,
-- basis: {method, description, sample_size?}}` and its **basis is mandatory**: `method` is
-- `measured` (with the sample it was measured over), `extrapolated`, or `unquantified`. An
-- unquantified basis carries no estimate and **must** set `needs_spike` — the honest output is a
-- spike, not a smaller number. Ticket drafts may carry no impact at all.
--
-- `action_binding` is `{plane, change}` — which plane Apply composes (`farm_config | job_hook |
-- workflow | test_gate | planning`) and the change payload BV.5 hands it. A ticket draft or a
-- spike binds to `planning`, and nothing else does; a workflow suggestion binds to `workflow`.
--
--   open ──apply──▶ applied     needs applied_event_id: the audit event recording the apply
--    │                          (action analysis_suggestion.applied, this suggestion its subject);
--    │                          never a ticket draft or a spike
--    ├──dismiss──▶ dismissed    needs an actor at the transition and a reason
--    └──draft────▶ drafted      needs draft_batch_id (#272): a ticket draft or a spike only
--
-- A suggestion is born `open`; the three others are terminal (`analysis_suggestions_lifecycle_guard`),
-- and once resolved its composed content and resolution are frozen — what was dismissed or
-- applied is what the person saw. A re-run still moves `last_run_id` and links new findings.
--
-- **Retention.** Findings hang off their run and go with it (#482's analysis class, by the run's
-- `finished_at`); their links go with them. Suggestions outlive their findings — the stored
-- identity is what keeps a dismissal sticking after the evidence ages out.

-- ---------------------------------------------------------------------------
-- The analysis_runs key findings and suggestions are scoped by.
-- ---------------------------------------------------------------------------
alter table ouroboros.analysis_runs
  add constraint analysis_runs_scope_key unique (id, organization_id, repo_ref);

-- ---------------------------------------------------------------------------
-- JSON helpers. plpgsql for the reason analysis_json_count (V080) gives: a guarded cast must
-- not be folded ahead of its guard.
-- ---------------------------------------------------------------------------

-- A JSON value as a number, or null when it is not a JSON number.
--   v — any jsonb value, or null
-- Returns the number, or null.
create function ouroboros.analysis_json_number(v jsonb)
returns numeric language plpgsql immutable as $$
begin
  if v is null or jsonb_typeof(v) <> 'number' then
    return null;
  end if;
  return v::text::numeric;
end;
$$;

comment on function ouroboros.analysis_json_number(jsonb) is
  'A jsonb value as a number, or null when it is not a JSON number (#507).';

-- A JSON value as a fraction in [0, 1], or null when it is anything else.
--   v — any jsonb value, or null
-- Returns the fraction, or null.
create function ouroboros.analysis_json_fraction(v jsonb)
returns numeric language plpgsql immutable as $$
declare
  n numeric := ouroboros.analysis_json_number(v);
begin
  if n is null or n < 0 or n > 1 then
    return null;
  end if;
  return n;
end;
$$;

comment on function ouroboros.analysis_json_fraction(jsonb) is
  'A jsonb value as a number in [0, 1], or null when it is not one (#507).';

-- A JSON value as non-blank text, or null when it is not a non-blank JSON string.
--   v — any jsonb value, or null
-- Returns the string, or null.
create function ouroboros.analysis_json_text(v jsonb)
returns text language sql immutable as $$
  select case when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') <> '' then v #>> '{}' end
$$;

comment on function ouroboros.analysis_json_text(jsonb) is
  'A jsonb value as non-blank text, or null when it is not a non-blank string (#507).';

-- ---------------------------------------------------------------------------
-- Evidence references.
-- ---------------------------------------------------------------------------

-- Whether one evidence reference has the shape the Details sheet routes on.
--   ref — the reference
-- Returns true for exactly {kind, id} with a known kind and an id in that kind's format.
create function ouroboros.analysis_evidence_ref_valid(ref jsonb)
returns boolean language sql immutable as $$
  select case when jsonb_typeof(ref) is distinct from 'object' then false else coalesce(
    (select array_agg(k order by k) from jsonb_object_keys(ref) k) = array['id', 'kind']
    and jsonb_typeof(ref -> 'id') = 'string'
    and case ref ->> 'kind'
          when 'merge' then ref ->> 'id' ~ '^[0-9a-f]{7,40}$'
          when 'build' then true when 'test_run' then true when 'test_case' then true
          when 'waiver' then true when 'workflow_version' then true
          when 'runner_pool' then true when 'runner' then true
          else false
        end
    and (ref ->> 'kind' = 'merge'
         or ref ->> 'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    false) end
$$;

comment on function ouroboros.analysis_evidence_ref_valid(jsonb) is
  'Whether a value is one evidence reference (#507): exactly {kind, id}, kind build|test_run|test_case|waiver|workflow_version|runner_pool|runner with a lowercase uuid id, or merge with a 7–40 hex sha.';

-- Whether a finding's evidence list is well-formed.
--   refs — the evidence_refs value
-- Returns true for a non-empty array of distinct valid references.
create function ouroboros.analysis_evidence_refs_valid(refs jsonb)
returns boolean language sql immutable as $$
  select case when jsonb_typeof(refs) is distinct from 'array' then false else coalesce(
    jsonb_array_length(refs) > 0
    and not exists (select 1 from jsonb_array_elements(refs) r
                     where not ouroboros.analysis_evidence_ref_valid(r))
    and (select count(distinct r) from jsonb_array_elements(refs) r) = jsonb_array_length(refs),
    false) end
$$;

comment on function ouroboros.analysis_evidence_refs_valid(jsonb) is
  'Whether evidence_refs is a non-empty array of distinct valid {kind, id} references (#507).';

-- Whether an evidence reference names a real row of its kind in a workspace.
--   p_org — the workspace the finding belongs to
--   p_ref — a reference analysis_evidence_ref_valid() accepts
-- Returns true when the row exists; a merge resolves when a build, a test run or a merge plan
-- of the workspace recorded that commit (either sha may be the abbreviated one).
create function ouroboros.analysis_evidence_ref_resolves(p_org text, p_ref jsonb)
returns boolean language plpgsql stable as $$
declare
  ref_id text := p_ref ->> 'id';
begin
  case p_ref ->> 'kind'
    when 'build' then
      return exists (select 1 from ouroboros.build_jobs
                      where id = ref_id::uuid and organization_id = p_org);
    when 'test_run' then
      return exists (select 1 from ouroboros.test_runs
                      where id = ref_id::uuid and organization_id = p_org);
    when 'test_case' then
      return exists (select 1 from ouroboros.test_cases
                      where id = ref_id::uuid and organization_id = p_org);
    when 'waiver' then
      return exists (select 1 from ouroboros.pr_waivers
                      where id = ref_id::uuid and organization_id = p_org);
    when 'workflow_version' then
      return exists (select 1 from ouroboros.workflow_versions v
                       join ouroboros.workflows w on w.id = v.workflow_id
                      where v.id = ref_id::uuid and w.organization_id = p_org);
    when 'runner_pool' then
      return exists (select 1 from ouroboros.runner_pools
                      where id = ref_id::uuid and organization_id = p_org);
    when 'runner' then
      return exists (select 1 from ouroboros.runners
                      where id = ref_id::uuid and organization_id = p_org);
    when 'merge' then
      return exists (select 1 from ouroboros.build_jobs
                      where organization_id = p_org and commit_sha is not null
                        and (starts_with(commit_sha, ref_id) or starts_with(ref_id, commit_sha)))
          or exists (select 1 from ouroboros.test_runs
                      where organization_id = p_org and commit_sha is not null
                        and (starts_with(commit_sha, ref_id) or starts_with(ref_id, commit_sha)))
          or exists (select 1 from ouroboros.pr_merge_plans m
                       join ouroboros.pull_requests p on p.id = m.pr_id
                      where p.organization_id = p_org
                        and m.merged_result ->> 'sha' is not null
                        and (starts_with(m.merged_result ->> 'sha', ref_id)
                             or starts_with(ref_id, m.merged_result ->> 'sha')));
    else
      return false;
  end case;
end;
$$;

comment on function ouroboros.analysis_evidence_ref_resolves(text, jsonb) is
  'Whether a valid evidence reference names a real row of its kind in the workspace (#507) — build_jobs, test_runs, test_cases, pr_waivers, workflow_versions, runner_pools, runners; a merge sha resolves through a build, a test run or a merge plan that recorded the commit.';

-- ---------------------------------------------------------------------------
-- The per-type data contract.
-- ---------------------------------------------------------------------------

-- Whether every reference in a JSON array is a valid reference that evidence_refs also lists.
--   arr  — the array of references data cites
--   refs — the finding's evidence_refs
-- Returns true for a non-empty array whose every element is valid and cited; false otherwise.
create function ouroboros.analysis_refs_cited(arr jsonb, refs jsonb)
returns boolean language sql immutable as $$
  select case when jsonb_typeof(arr) is distinct from 'array'
                 or jsonb_typeof(refs) is distinct from 'array' then false else coalesce(
    jsonb_array_length(arr) > 0
    and not exists (select 1 from jsonb_array_elements(arr) r
                     where not ouroboros.analysis_evidence_ref_valid(r)
                        or not (refs @> jsonb_build_array(r))),
    false) end
$$;

comment on function ouroboros.analysis_refs_cited(jsonb, jsonb) is
  'Whether a non-empty array of references is entirely valid and listed in evidence_refs (#507).';

-- Whether a finding's data has its type's shape (see FINDINGS ARE TYPED above).
--   p_type — the finding_type
--   p_data — the data
--   p_refs — the finding's evidence_refs, which every reference data cites must be in
-- Returns true when the data matches its type's contract, false when it does not, and null for
-- an unknown type — which has no contract, and is the finding_type check's to refuse.
create function ouroboros.analysis_finding_data_valid(p_type text, p_data jsonb, p_refs jsonb)
returns boolean language sql immutable as $$
  select case
    -- An unknown type has no contract to judge; analysis_findings_type_known refuses it.
    when p_type is null
      or not (p_type in ('change_point', 'log_signature', 'config_usage', 'cache_window',
                         'queue_correlation', 'waiver_cite', 'workflow_outcome')
              or p_type ~ '^custom:[a-z][a-z0-9_]{0,62}$') then null
    when jsonb_typeof(p_data) is distinct from 'object' then false else coalesce(case
    when p_type = 'change_point' then
      coalesce(p_data ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$', false)
      and coalesce(ouroboros.analysis_json_text(p_data -> 'metric') ~ '^[a-z][a-z0-9_.]{0,127}$', false)
      and ouroboros.analysis_json_number(p_data -> 'delta_seconds') <> 0
      -- The array is tested before it is walked: a CASE orders evaluation, an AND does not.
      and case when jsonb_typeof(p_data -> 'candidates') is distinct from 'array' then false
               else jsonb_array_length(p_data -> 'candidates') > 0
      and not exists (
        select 1 from jsonb_array_elements(p_data -> 'candidates') c
         where jsonb_typeof(c) <> 'object'
            or ouroboros.analysis_json_text(c -> 'label') is null
            or ouroboros.analysis_json_fraction(c -> 'score') is null
            or not ouroboros.analysis_refs_cited(jsonb_build_array(c -> 'ref'), p_refs))
      -- Ranked: no candidate scores above the one before it.
      and not exists (
        select 1
          from (select ouroboros.analysis_json_fraction(c -> 'score') as score,
                       lag(ouroboros.analysis_json_fraction(c -> 'score')) over (order by i) as prev
                  from jsonb_array_elements(p_data -> 'candidates') with ordinality as t (c, i)) s
         where s.score > s.prev) end
    when p_type = 'log_signature' then
      ouroboros.analysis_json_text(p_data -> 'template') is not null
      and coalesce(p_data ->> 'signature_hash' ~ '^[0-9a-f]{16,64}$', false)
      and ouroboros.analysis_json_count(p_data -> 'count') >= 1
      and ouroboros.analysis_json_fraction(p_data -> 'share') is not null
      and ouroboros.analysis_refs_cited(p_data -> 'sample_refs', p_refs)
    when p_type = 'config_usage' then
      ouroboros.analysis_json_text(p_data -> 'option') is not null
      and ouroboros.analysis_json_count(p_data -> 'builds_considered') >= 1
      and ouroboros.analysis_json_count(p_data -> 'occurrences')
          <= ouroboros.analysis_json_count(p_data -> 'builds_considered')
      and (not (p_data ? 'drift_warnings')
           or ouroboros.analysis_json_count(p_data -> 'drift_warnings') is not null)
    when p_type = 'cache_window' then
      ouroboros.analysis_json_text(p_data -> 'trigger') is not null
      and ouroboros.analysis_json_fraction(p_data -> 'hit_rate_before') is not null
      and ouroboros.analysis_json_fraction(p_data -> 'hit_rate_after') is not null
      and ouroboros.analysis_json_number(p_data -> 'window_hours') > 0
      and ouroboros.analysis_json_count(p_data -> 'occurrences') >= 1
    when p_type = 'queue_correlation' then
      jsonb_typeof(p_data -> 'window') = 'object'
      and coalesce(p_data #>> '{window,from}' ~ '^([01]\d|2[0-3]):[0-5]\d$', false)
      and coalesce(p_data #>> '{window,to}'   ~ '^([01]\d|2[0-3]):[0-5]\d$', false)
      and ouroboros.analysis_json_text(p_data -> 'metric') is not null
      and ouroboros.analysis_json_number(p_data -> 'threshold_seconds') >= 0
      and ouroboros.analysis_json_count(p_data -> 'days_observed') >= 1
      and ouroboros.analysis_json_count(p_data -> 'days_exceeded')
          <= ouroboros.analysis_json_count(p_data -> 'days_observed')
      and (not (p_data ? 'idle_share')
           or ouroboros.analysis_json_fraction(p_data -> 'idle_share') is not null)
    when p_type = 'waiver_cite' then
      ouroboros.analysis_json_text(p_data -> 'topic') is not null
      and ouroboros.analysis_json_count(p_data -> 'window_days') >= 1
      and ouroboros.analysis_json_count(p_data -> 'waiver_count') >= 1
      and ouroboros.analysis_json_count(p_data -> 'waiver_count')
          = case when jsonb_typeof(p_refs) = 'array'
                 then (select count(*) from jsonb_array_elements(p_refs) r
                        where r ->> 'kind' = 'waiver') end
    when p_type = 'workflow_outcome' then
      ouroboros.analysis_json_text(p_data -> 'workflow') is not null
      and ouroboros.analysis_json_text(p_data -> 'scope') is not null
      and ouroboros.analysis_json_text(p_data -> 'metric') is not null
      and ouroboros.analysis_json_number(p_data -> 'value') is not null
      and coalesce(p_data ->> 'unit' in ('count', 'share', 'ratio', 'seconds'), false)
      and (p_data ->> 'unit' <> 'share'
           or ouroboros.analysis_json_fraction(p_data -> 'value') is not null)
      and ouroboros.analysis_json_count(p_data -> 'sample') >= 1
    when p_type ~ '^custom:[a-z][a-z0-9_]{0,62}$' then
      true
  end, false) end
$$;

comment on function ouroboros.analysis_finding_data_valid(text, jsonb, jsonb) is
  'The per-finding-type data contract (#507) — change_point, log_signature, config_usage, cache_window, queue_correlation, waiver_cite, workflow_outcome, and custom:* (any object until BX.5 registers schemas). References data cites must be in evidence_refs. Null for an unknown type, which analysis_findings_type_known refuses.';

-- Whether a confidence basis has the shape the scoring popover renders.
--   b — the confidence_basis
-- Returns true for {method, sample_size ≥ 1, effect_size, stability 0–1}.
create function ouroboros.analysis_confidence_basis_valid(b jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    jsonb_typeof(b) = 'object'
    and ouroboros.analysis_json_text(b -> 'method') is not null
    and ouroboros.analysis_json_count(b -> 'sample_size') >= 1
    and ouroboros.analysis_json_number(b -> 'effect_size') is not null
    and ouroboros.analysis_json_fraction(b -> 'stability') is not null,
    false)
$$;

comment on function ouroboros.analysis_confidence_basis_valid(jsonb) is
  'The confidence-basis contract (#507) — {method (the analyzer''s documented scoring rule), sample_size ≥ 1, effect_size, stability in [0, 1]}.';

-- ---------------------------------------------------------------------------
-- analysis_findings — one analyzer's output for one subject in one run.
-- ---------------------------------------------------------------------------
create table ouroboros.analysis_findings (
  id               uuid        primary key default gen_random_uuid(),

  -- The run that produced it, and the run's workspace and repo, held to the run by the composite
  -- key so a link can never cross repositories. Cascade: the run's retention is the finding's.
  run_id           uuid        not null,
  organization_id  text        not null,
  repo_ref         ouroboros.repo_ref not null,

  -- The analyzer and version — one of the run's analyzer_set (analysis_findings_write_guard).
  analyzer         text        not null
                               constraint analysis_findings_analyzer_shape
                                 check (analyzer ~ '^[a-z][a-z0-9_]{0,62}$'),
  analyzer_version integer     not null
                               constraint analysis_findings_analyzer_version_positive
                                 check (analyzer_version >= 1),

  finding_type     text        not null
                               constraint analysis_findings_type_known
                                 check (finding_type in ('change_point', 'log_signature',
                                                         'config_usage', 'cache_window',
                                                         'queue_correlation', 'waiver_cite',
                                                         'workflow_outcome')
                                        or finding_type ~ '^custom:[a-z][a-z0-9_]{0,62}$'),

  -- The stable identity component: the option name, the signature hash, the pool id. One line,
  -- because suggestion identities join these with newlines.
  subject_key      text        not null
                               constraint analysis_findings_subject_key_shape
                                 check (btrim(subject_key) <> '' and subject_key !~ '[\r\n]'
                                        and length(subject_key) <= 512),

  -- The finding's identity across runs — see SUGGESTIONS HAVE IDENTITY.
  identity_key     text        not null
                               generated always as
                                 (analyzer || '@v' || analyzer_version::text || '/' || subject_key)
                               stored,

  data             jsonb       not null,

  evidence_refs    jsonb       not null
                               constraint analysis_findings_evidence_refs_shape
                                 check (ouroboros.analysis_evidence_refs_valid(evidence_refs)),

  confidence       smallint    not null
                               constraint analysis_findings_confidence_range
                                 check (confidence between 0 and 100),
  confidence_basis jsonb       not null
                               constraint analysis_findings_confidence_basis_shape
                                 check (ouroboros.analysis_confidence_basis_valid(confidence_basis)),

  created_at       timestamptz not null default now(),

  constraint analysis_findings_run_fkey
    foreign key (run_id, organization_id, repo_ref)
    references ouroboros.analysis_runs (id, organization_id, repo_ref) on delete cascade,

  constraint analysis_findings_data_shape
    check (ouroboros.analysis_finding_data_valid(finding_type, data, evidence_refs)),

  -- One finding per identity per run.
  constraint analysis_findings_run_identity_key unique (run_id, identity_key),

  -- The composite key analysis_suggestion_findings names.
  constraint analysis_findings_scope_key unique (id, organization_id, repo_ref)
);

comment on table ouroboros.analysis_findings is
  'Typed Build Analyzer findings (#507, decision A1) — one analyzer''s output for one subject in one run, with schema-validated data, evidence references that resolved when written, and a bounded confidence with its basis. Immutable once written.';
comment on column ouroboros.analysis_findings.analyzer is
  'The analyzer id; with analyzer_version, one entry of the run''s analyzer_set.';
comment on column ouroboros.analysis_findings.finding_type is
  'change_point | log_signature | config_usage | cache_window | queue_correlation | waiver_cite | workflow_outcome | custom:<name> (BX.5).';
comment on column ouroboros.analysis_findings.subject_key is
  'The stable identity component — option name, signature hash, pool id. Single line.';
comment on column ouroboros.analysis_findings.identity_key is
  'Generated: analyzer@v<version>/<subject_key>. The same across runs over the same corpus; suggestions derive their identity from it.';
comment on column ouroboros.analysis_findings.data is
  'The finding, shaped per finding_type — see ouroboros.analysis_finding_data_valid().';
comment on column ouroboros.analysis_findings.evidence_refs is
  'Resolvable evidence: a non-empty array of distinct {kind, id}, each naming a real row of its kind in the workspace when written. Every reference data cites is listed here.';
comment on column ouroboros.analysis_findings.confidence is
  '0–100, scored by the analyzer''s documented rule (confidence_basis.method).';
comment on column ouroboros.analysis_findings.confidence_basis is
  '{method, sample_size, effect_size, stability} — the content of the scoring popover.';

-- The run's findings, and every run's findings of one identity (re-analysis lookups).
create index analysis_findings_run_idx on ouroboros.analysis_findings (run_id);
create index analysis_findings_identity_idx
  on ouroboros.analysis_findings (organization_id, repo_ref, identity_key);

-- Admits a finding only into a running run, from an analyzer that run names at that version,
-- with every evidence reference resolving in its workspace; refuses any later revision.
create function ouroboros.analysis_findings_write_guard()
returns trigger language plpgsql as $$
declare
  run_status text;
  run_set    jsonb;
  ref        jsonb;
begin
  if tg_op = 'UPDATE' then
    raise exception 'analysis finding % is a record and cannot be revised', old.id
      using errcode = 'check_violation', constraint = 'analysis_findings_immutable';
  end if;

  select status, analyzer_set into run_status, run_set
    from ouroboros.analysis_runs where id = new.run_id;

  -- A missing run is the foreign key's to report.
  if not found then
    return new;
  end if;

  if run_status <> 'running' then
    raise exception 'analysis run % is %; findings are written while it runs',
      new.run_id, run_status
      using errcode = 'check_violation', constraint = 'analysis_findings_run_running';
  end if;

  if not jsonb_path_exists(run_set, '$.analyzers[*] ? (@.id == $id && @.version == $v)',
                           jsonb_build_object('id', new.analyzer, 'v', new.analyzer_version)) then
    raise exception 'analyzer % v% is not in run %''s analyzer set',
      new.analyzer, new.analyzer_version, new.run_id
      using errcode = 'check_violation', constraint = 'analysis_findings_analyzer_in_set';
  end if;

  -- The shape is the check constraint's to report; resolution only means anything for valid refs.
  if ouroboros.analysis_evidence_refs_valid(new.evidence_refs) then
    for ref in select r from jsonb_array_elements(new.evidence_refs) r loop
      if not ouroboros.analysis_evidence_ref_resolves(new.organization_id, ref) then
        raise exception 'evidence % does not resolve in workspace %', ref, new.organization_id
          using errcode = 'check_violation', constraint = 'analysis_findings_evidence_resolves';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

comment on function ouroboros.analysis_findings_write_guard() is
  'Admits a finding only into a running run, from an analyzer in that run''s analyzer_set at that version, with every evidence reference resolving in its workspace (#507); refuses any update.';

create trigger analysis_findings_write_guard
  before insert or update on ouroboros.analysis_findings
  for each row execute function ouroboros.analysis_findings_write_guard();

-- ---------------------------------------------------------------------------
-- The suggestion contracts.
-- ---------------------------------------------------------------------------

-- Whether an impact has the shape the impact pill renders, with its basis.
--   i — the impact; null is answered null so a nullable column's check passes
-- Returns true for {estimate, unit, applies_to, share?, basis: {method, description,
-- sample_size?}} where estimate is null exactly when the basis is unquantified, and a measured
-- basis names the sample it was measured over.
create function ouroboros.analysis_impact_valid(i jsonb)
returns boolean language sql immutable as $$
  select case when i is null then null else coalesce(
    jsonb_typeof(i) = 'object'
    and coalesce(i ->> 'unit' in ('seconds', 'interventions', 'count'), false)
    and ouroboros.analysis_json_text(i -> 'applies_to') is not null
    and (coalesce(jsonb_typeof(i -> 'share'), 'null') = 'null'
         or ouroboros.analysis_json_fraction(i -> 'share') > 0)
    and jsonb_typeof(i -> 'basis') = 'object'
    and coalesce(i #>> '{basis,method}' in ('measured', 'extrapolated', 'unquantified'), false)
    and ouroboros.analysis_json_text(i #> '{basis,description}') is not null
    and (i #>> '{basis,method}' <> 'measured'
         or ouroboros.analysis_json_count(i #> '{basis,sample_size}') >= 1)
    and (i #>> '{basis,method}' = 'unquantified')
        = (coalesce(jsonb_typeof(i -> 'estimate'), 'null') = 'null')
    and (coalesce(jsonb_typeof(i -> 'estimate'), 'null') = 'null'
         or ouroboros.analysis_json_number(i -> 'estimate') is not null),
    false)
  end
$$;

comment on function ouroboros.analysis_impact_valid(jsonb) is
  'The impact contract (#507) — {estimate, unit: seconds|interventions|count, applies_to, share?, basis: {method: measured|extrapolated|unquantified, description, sample_size (measured)}}; estimate is null exactly when the basis is unquantified. Null in, null out.';

-- Whether an action binding names a plane and a change payload.
--   b — the action_binding
-- Returns true for {plane: farm_config|job_hook|workflow|test_gate|planning, change: {…}}.
create function ouroboros.analysis_action_binding_valid(b jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    jsonb_typeof(b) = 'object'
    and b ->> 'plane' in ('farm_config', 'job_hook', 'workflow', 'test_gate', 'planning')
    and jsonb_typeof(b -> 'change') = 'object',
    false)
$$;

comment on function ouroboros.analysis_action_binding_valid(jsonb) is
  'The action-binding contract (#507, decision A4) — {plane: farm_config|job_hook|workflow|test_gate|planning, change: object}.';

-- A suggestion's stable identity from its kind and the identities of the findings it cites.
--   p_kind          — the suggestion kind
--   p_finding_keys  — the cited findings' identity_key values; duplicates and order are ignored
-- Returns '<kind>:<sha256 hex of the distinct keys, sorted, newline-joined>'.
create function ouroboros.analysis_suggestion_identity(p_kind text, p_finding_keys text[])
returns text language sql stable as $$
  select p_kind || ':' || encode(sha256(convert_to(
           array_to_string(array(select distinct k from unnest(p_finding_keys) k
                                  where k is not null order by k), E'\n'),
           'UTF8')), 'hex')
$$;

comment on function ouroboros.analysis_suggestion_identity(text, text[]) is
  'A suggestion''s stable identity (#507): kind || '':'' || sha256 of its findings'' distinct identity keys, sorted and newline-joined. Re-analysis over the same corpus derives the same value.';

-- ---------------------------------------------------------------------------
-- analysis_suggestions — the cards and the ticket drafts.
-- ---------------------------------------------------------------------------
create table ouroboros.analysis_suggestions (
  id                uuid        primary key default gen_random_uuid(),

  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,
  repo_ref          ouroboros.repo_ref not null,

  kind              text        not null
                                constraint analysis_suggestions_kind_known
                                  check (kind in ('build_process', 'workflow', 'ticket_draft')),

  -- The stable identity — derived from the cited findings, checked at commit.
  identity_key      text        not null,

  -- The run that last composed or confirmed it. Set null when retention removes that run.
  last_run_id       uuid,

  -- Composer-stored, so a historical suggestion reads as it did.
  title             text        not null
                                constraint analysis_suggestions_title_present
                                  check (btrim(title) <> '' and length(title) <= 512),
  evidence_line     text        not null
                                constraint analysis_suggestions_evidence_line_present
                                  check (btrim(evidence_line) <> '' and length(evidence_line) <= 2048),
  confidence        smallint    not null
                                constraint analysis_suggestions_confidence_range
                                  check (confidence between 0 and 100),

  impact            jsonb
                    constraint analysis_suggestions_impact_shape
                      check (ouroboros.analysis_impact_valid(impact)),
  needs_spike       boolean     not null default false,

  action_binding    jsonb       not null
                                constraint analysis_suggestions_action_binding_shape
                                  check (ouroboros.analysis_action_binding_valid(action_binding)),

  status            text        not null default 'open'
                                constraint analysis_suggestions_status_known
                                  check (status in ('open', 'applied', 'dismissed', 'drafted')),

  -- The resolution. resolved_by is required at a dismissal and set null if the person is removed.
  resolved_by       text        references ouroboros."user" ("id") on delete set null,
  resolved_at       timestamptz,
  resolution_reason text
                    constraint analysis_suggestions_resolution_reason_present
                      check (btrim(resolution_reason) <> '' and length(resolution_reason) <= 4096),

  -- applied's action record: the audit event BV.5 writes for the apply.
  applied_event_id  uuid        references ouroboros.audit_events (id),

  -- drafted's linkage: the planning batch (#272) the ticket or spike was drafted into.
  draft_batch_id    uuid        references ouroboros.draft_batches (id),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint analysis_suggestions_last_run_fkey
    foreign key (last_run_id, organization_id, repo_ref)
    references ouroboros.analysis_runs (id, organization_id, repo_ref)
    on delete set null (last_run_id),

  -- Re-analysis upserts on this.
  constraint analysis_suggestions_identity_key
    unique (organization_id, repo_ref, identity_key),
  constraint analysis_suggestions_identity_shape
    check (identity_key ~ '^[a-z_]+:[0-9a-f]{64}$' and split_part(identity_key, ':', 1) = kind),

  -- The composite key analysis_suggestion_findings names.
  constraint analysis_suggestions_scope_key unique (id, organization_id, repo_ref),

  -- Impact: required except on ticket drafts; an unquantified basis is a spike.
  constraint analysis_suggestions_impact_required
    check (kind = 'ticket_draft' or impact is not null),
  constraint analysis_suggestions_unquantified_needs_spike
    check (impact is null or impact #>> '{basis,method}' <> 'unquantified' or needs_spike),

  -- Plane coherence: planning is the ticket drafts' and the spikes' plane, and only theirs.
  constraint analysis_suggestions_binding_plane
    check ((action_binding ->> 'plane' = 'planning') = (kind = 'ticket_draft' or needs_spike)
           and (kind <> 'workflow' or needs_spike or action_binding ->> 'plane' = 'workflow')),

  -- The lifecycle's linkage.
  constraint analysis_suggestions_resolved_when_closed
    check ((status = 'open') = (resolved_at is null)),
  constraint analysis_suggestions_open_unresolved
    check (status <> 'open' or (resolved_by is null and resolution_reason is null)),
  constraint analysis_suggestions_applied_has_event
    check ((status = 'applied') = (applied_event_id is not null)),
  constraint analysis_suggestions_drafted_has_batch
    check ((status = 'drafted') = (draft_batch_id is not null)),
  constraint analysis_suggestions_dismissed_has_reason
    check (status <> 'dismissed' or resolution_reason is not null),
  constraint analysis_suggestions_apply_is_a_change
    check (status <> 'applied' or (kind <> 'ticket_draft' and not needs_spike)),
  constraint analysis_suggestions_draft_is_a_ticket
    check (status <> 'drafted' or kind = 'ticket_draft' or needs_spike)
);

comment on table ouroboros.analysis_suggestions is
  'Build Analyzer suggestions (#507, decision A4) — build-process and workflow cards and ticket drafts, keyed by a stable identity derived from the findings they cite so re-analysis updates rather than duplicates. open → applied (audit event) | dismissed (actor + reason) | drafted (planning batch); the three resolutions are terminal.';
comment on column ouroboros.analysis_suggestions.identity_key is
  '<kind>:<sha256 of the cited findings'' distinct identity keys> — see ouroboros.analysis_suggestion_identity(). Unique per (workspace, repo); checked against the cited findings at commit.';
comment on column ouroboros.analysis_suggestions.last_run_id is
  'The run that last composed or confirmed this suggestion. Set null when retention removes the run.';
comment on column ouroboros.analysis_suggestions.title is
  'Composer-stored title, as the card renders it.';
comment on column ouroboros.analysis_suggestions.evidence_line is
  'Composer-stored mono Evidence line.';
comment on column ouroboros.analysis_suggestions.confidence is
  'Composer-stored confidence, 0–100 — the card''s conf N%.';
comment on column ouroboros.analysis_suggestions.impact is
  '{estimate, unit, applies_to, share?, basis} — see ouroboros.analysis_impact_valid(). Basis mandatory; required except on ticket drafts.';
comment on column ouroboros.analysis_suggestions.needs_spike is
  'The basis is too uncertain to apply: the suggestion drafts a spike ticket instead. Required when impact.basis.method is unquantified.';
comment on column ouroboros.analysis_suggestions.action_binding is
  '{plane, change} — which plane Apply composes and the change payload (decision A4).';
comment on column ouroboros.analysis_suggestions.status is
  'open | applied | dismissed | drafted. Born open; the others are terminal.';
comment on column ouroboros.analysis_suggestions.resolved_by is
  'Who resolved it. Required at a dismissal; set null if the person is removed.';
comment on column ouroboros.analysis_suggestions.resolution_reason is
  'Why — required for a dismissal, which persists across re-runs.';
comment on column ouroboros.analysis_suggestions.applied_event_id is
  'The audit event recording the apply (action analysis_suggestion.applied, subject this suggestion). Exactly on applied.';
comment on column ouroboros.analysis_suggestions.draft_batch_id is
  'The planning batch (#272) a ticket draft or spike was drafted into. Exactly on drafted.';

create index analysis_suggestions_repo_status_idx
  on ouroboros.analysis_suggestions (organization_id, repo_ref, status);

create trigger analysis_suggestions_touch_updated_at
  before update on ouroboros.analysis_suggestions
  for each row execute function ouroboros.touch_updated_at();

-- Enforces the A4 lifecycle: born open; resolutions terminal and frozen with what was resolved;
-- a dismissal names its actor; an apply's audit event and a draft's batch are this suggestion's
-- and this workspace's. Identity, kind and scope never change.
create function ouroboros.analysis_suggestions_lifecycle_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'a suggestion is born open, not %', new.status
        using errcode = 'check_violation', constraint = 'analysis_suggestions_born_open';
    end if;
    return new;
  end if;

  if (new.organization_id, new.repo_ref, new.identity_key, new.kind)
     is distinct from (old.organization_id, old.repo_ref, old.identity_key, old.kind) then
    raise exception 'suggestion % keeps its workspace, repo, kind and identity', old.id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_identity_frozen';
  end if;

  if old.status <> 'open' then
    if new.status <> old.status then
      raise exception 'suggestion % is already %; it cannot become %', old.id, old.status, new.status
        using errcode = 'check_violation', constraint = 'analysis_suggestions_terminal';
    end if;
    -- resolved_by may only go to null: the user foreign key's own set-null.
    if (new.title, new.evidence_line, new.confidence, new.impact, new.needs_spike,
        new.action_binding, new.resolved_at, new.resolution_reason, new.applied_event_id,
        new.draft_batch_id)
       is distinct from
       (old.title, old.evidence_line, old.confidence, old.impact, old.needs_spike,
        old.action_binding, old.resolved_at, old.resolution_reason, old.applied_event_id,
        old.draft_batch_id)
       or (new.resolved_by is not null and new.resolved_by is distinct from old.resolved_by) then
      raise exception 'suggestion % was % as composed; it is not revised', old.id, old.status
        using errcode = 'check_violation', constraint = 'analysis_suggestions_resolved_frozen';
    end if;
    return new;
  end if;

  if new.status = 'dismissed' and new.resolved_by is null then
    raise exception 'dismissing suggestion % needs the person dismissing it', old.id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_dismiss_actor';
  end if;

  -- A missing event or batch is the check constraints' to report; a present one must be right.
  if new.applied_event_id is not null and not exists (
       select 1 from ouroboros.audit_events e
        where e.id = new.applied_event_id
          and e.organization_id = new.organization_id
          and e.action = 'analysis_suggestion.applied'
          and e.subject_type = 'analysis_suggestion'
          and e.subject_id = new.id::text) then
    raise exception 'applying suggestion % needs its analysis_suggestion.applied audit event', old.id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_applied_event';
  end if;

  if new.draft_batch_id is not null and not exists (
       select 1 from ouroboros.draft_batches b
        where b.id = new.draft_batch_id and b.organization_id = new.organization_id) then
    raise exception 'suggestion % can only be drafted into a batch of its own workspace', old.id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_draft_batch_scope';
  end if;

  return new;
end;
$$;

comment on function ouroboros.analysis_suggestions_lifecycle_guard() is
  'The A4 lifecycle (#507): born open; applied/dismissed/drafted are terminal and freeze the composed content and resolution (resolved_by may still be set null by its foreign key); a dismissal needs an actor; an apply needs this suggestion''s analysis_suggestion.applied audit event; a draft needs a batch of the same workspace; workspace, repo, kind and identity never change.';

create trigger analysis_suggestions_lifecycle_guard
  before insert or update on ouroboros.analysis_suggestions
  for each row execute function ouroboros.analysis_suggestions_lifecycle_guard();

-- ---------------------------------------------------------------------------
-- analysis_suggestion_findings — the many-to-many citation.
-- ---------------------------------------------------------------------------
create table ouroboros.analysis_suggestion_findings (
  suggestion_id   uuid        not null,
  finding_id      uuid        not null,

  -- Shared by both sides, so a suggestion cites only its own repository's findings.
  organization_id text        not null,
  repo_ref        ouroboros.repo_ref not null,

  created_at      timestamptz not null default now(),

  primary key (suggestion_id, finding_id),

  constraint analysis_suggestion_findings_suggestion_fkey
    foreign key (suggestion_id, organization_id, repo_ref)
    references ouroboros.analysis_suggestions (id, organization_id, repo_ref) on delete cascade,
  constraint analysis_suggestion_findings_finding_fkey
    foreign key (finding_id, organization_id, repo_ref)
    references ouroboros.analysis_findings (id, organization_id, repo_ref) on delete cascade
);

comment on table ouroboros.analysis_suggestion_findings is
  'Which findings a suggestion cites (#507) — several for a composite suggestion, and the new run''s findings appended on every re-analysis. Both sides share one (workspace, repo). Links go with their finding when retention removes its run.';

create index analysis_suggestion_findings_finding_idx
  on ouroboros.analysis_suggestion_findings (finding_id);

-- Checks, at commit, that a suggestion cites at least one finding and that its identity_key is
-- the one its cited findings derive. Fires on the suggestion's insert and identity change and on
-- each new citation; a citation removed by retention is not re-checked, because the stored
-- identity is exactly what must survive its evidence ageing out.
create function ouroboros.analysis_suggestions_identity_holds()
returns trigger language plpgsql as $$
declare
  sid  uuid;
  s    record;
  keys text[];
begin
  if tg_table_name = 'analysis_suggestions' then
    sid := new.id;
  else
    sid := new.suggestion_id;
  end if;

  select kind, identity_key into s from ouroboros.analysis_suggestions where id = sid;
  if not found then
    return null;
  end if;

  select array_agg(f.identity_key) into keys
    from ouroboros.analysis_suggestion_findings l
    join ouroboros.analysis_findings f on f.id = l.finding_id
   where l.suggestion_id = sid;

  if keys is null then
    raise exception 'suggestion % cites no findings', sid
      using errcode = 'check_violation', constraint = 'analysis_suggestions_cite_findings';
  end if;

  if s.identity_key <> ouroboros.analysis_suggestion_identity(s.kind, keys) then
    raise exception 'suggestion %''s identity is not the one its findings derive', sid
      using errcode = 'check_violation', constraint = 'analysis_suggestions_identity_derived';
  end if;

  return null;
end;
$$;

comment on function ouroboros.analysis_suggestions_identity_holds() is
  'Deferred check (#507): a suggestion cites at least one finding and its identity_key equals analysis_suggestion_identity(kind, cited findings'' identity keys).';

create constraint trigger analysis_suggestions_identity_holds
  after insert or update of identity_key on ouroboros.analysis_suggestions
  deferrable initially deferred
  for each row execute function ouroboros.analysis_suggestions_identity_holds();

create constraint trigger analysis_suggestion_findings_identity_holds
  after insert on ouroboros.analysis_suggestion_findings
  deferrable initially deferred
  for each row execute function ouroboros.analysis_suggestions_identity_holds();

-- ---------------------------------------------------------------------------
-- The composer's write.
-- ---------------------------------------------------------------------------

-- Records one composed suggestion from a run's findings: inserts it, or — when a suggestion
-- with the same identity already exists in the repo — updates that one, so re-analysis never
-- duplicates. An open suggestion takes the new composition; a resolved one keeps what was
-- resolved and only moves last_run_id. Either way the run's findings are linked.
--   p_run_id         — the run that composed it
--   p_kind           — build_process | workflow | ticket_draft
--   p_finding_ids    — the run's findings it cites; at least one, all of p_run_id
--   p_title          — the composed title
--   p_evidence_line  — the composed Evidence line
--   p_confidence     — 0–100
--   p_impact         — the impact (null only for a ticket draft)
--   p_action_binding — {plane, change}
--   p_needs_spike    — whether it drafts a spike instead of applying
-- Returns the suggestion's id.
create function ouroboros.record_analysis_suggestion(
  p_run_id uuid, p_kind text, p_finding_ids uuid[], p_title text, p_evidence_line text,
  p_confidence integer, p_impact jsonb, p_action_binding jsonb, p_needs_spike boolean default false)
returns uuid language plpgsql as $$
declare
  run_org  text;
  run_repo ouroboros.repo_ref;
  keys     text[];
  found_n  integer;
  sid      uuid;
begin
  select organization_id, repo_ref into run_org, run_repo
    from ouroboros.analysis_runs where id = p_run_id;
  if not found then
    raise exception 'analysis run % does not exist', p_run_id
      using errcode = 'foreign_key_violation';
  end if;

  select array_agg(identity_key), count(*) into keys, found_n
    from ouroboros.analysis_findings
   where run_id = p_run_id and id = any (p_finding_ids);

  if found_n = 0
     or found_n <> (select count(distinct f) from unnest(p_finding_ids) f) then
    raise exception 'a suggestion cites at least one finding, all of run %', p_run_id
      using errcode = 'check_violation', constraint = 'analysis_suggestions_cite_findings';
  end if;

  insert into ouroboros.analysis_suggestions as s
      (organization_id, repo_ref, kind, identity_key, last_run_id, title, evidence_line,
       confidence, impact, needs_spike, action_binding)
  values (run_org, run_repo, p_kind, ouroboros.analysis_suggestion_identity(p_kind, keys),
          p_run_id, p_title, p_evidence_line, p_confidence, p_impact,
          coalesce(p_needs_spike, false), p_action_binding)
  on conflict (organization_id, repo_ref, identity_key) do update
     set last_run_id    = excluded.last_run_id,
         title          = case when s.status = 'open' then excluded.title          else s.title end,
         evidence_line  = case when s.status = 'open' then excluded.evidence_line  else s.evidence_line end,
         confidence     = case when s.status = 'open' then excluded.confidence     else s.confidence end,
         impact         = case when s.status = 'open' then excluded.impact         else s.impact end,
         needs_spike    = case when s.status = 'open' then excluded.needs_spike    else s.needs_spike end,
         action_binding = case when s.status = 'open' then excluded.action_binding else s.action_binding end
  returning id into sid;

  insert into ouroboros.analysis_suggestion_findings (suggestion_id, finding_id, organization_id, repo_ref)
  select sid, f, run_org, run_repo from unnest(p_finding_ids) f
  on conflict do nothing;

  return sid;
end;
$$;

comment on function ouroboros.record_analysis_suggestion(uuid, text, uuid[], text, text, integer, jsonb, jsonb, boolean) is
  'The composer''s write (#507): upserts a suggestion on its derived identity and links the run''s findings, so re-analysis updates rather than duplicates. An open suggestion takes the new composition; a resolved one keeps its status and content and only moves last_run_id. Returns the suggestion id.';

-- ---------------------------------------------------------------------------
-- The service role's grants. Findings are append-only; their deletion is their run's.
-- ---------------------------------------------------------------------------
grant select, insert on ouroboros.analysis_findings to ouroboros_app;
grant select, insert, update on ouroboros.analysis_suggestions to ouroboros_app;
grant select, insert on ouroboros.analysis_suggestion_findings to ouroboros_app;
