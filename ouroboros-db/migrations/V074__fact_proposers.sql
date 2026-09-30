-- V074__fact_proposers.sql — the typed provenance and the suppression record BF.3's deterministic
-- fact proposers need (#412, decision K5).
--
-- "Learned by the loop" without a model: the correction notes (#332), waiver reasons (#327) and
-- *remember this* steers (#306) the loop already writes become `proposed` facts, each carrying
-- the source that taught it. Two things V071 did not have room for:
--
--   * **Provenance names the source itself, not only the run.** V071's refs are `run`,
--     `pull_request`, `ticket` and `import`. The proposers' provenance shapes are
--
--         correction_note   {run, pull_request?, classification}
--         waiver            {pull_request?, gate*, waiver}
--         steer             {run, run_stage?, person, steer}
--
--     so this migration widens `fact_provenance_typed` with five kinds — `classification`
--     (`failure_classifications`), `waiver` (`pr_waivers`), `steer` (a `run_controls` row of kind
--     `steer`), `run_stage` (`run_stages`) and `gate` (`pr_gate_definitions`), each `{kind, id}`
--     with a lower-case uuid — and `person` (`{kind, id}` naming a `"user"` who is a member of the
--     workspace; BetterAuth ids are text, so the id is a non-blank string of at most 255).
--     `facts_guard_provenance()` resolves every one of them to the fact's own workspace when
--     written, as it already does for runs, PRs and tickets.
--
--   * **A suppressed candidate is recorded, not dropped.** A proposer's candidate whose
--     normalized text matches an existing fact of the repository or the workspace — in **any**
--     status, rejected and expired included, so a fact somebody turned down does not come back
--     next week — is not proposed. `fact_suppressions` records it: the proposer and its registry
--     version, the candidate text and its normalized key, the fact it matched, the candidate's
--     typed provenance and a `source_key` naming the source row (`classification:<uuid>`). One
--     row per (source, matched fact), so re-running a proposer over the same source records
--     nothing new. Append-only, by trigger and by grant.
--
-- ---------------------------------------------------------------------------
-- What is deliberately not here
-- ---------------------------------------------------------------------------
--
--   * **A status on a suppression, or a way to promote one.** A suppression is an observation
--     ("this would have been proposed, and was not, because of that fact"); a person who wants
--     the text anyway writes it by hand.
--   * **A proposer version on `facts`.** The proposer kind is already on the fact, which is what
--     the UI phrases provenance from; the registry version is recorded where it changes an
--     outcome — on the suppression.
--   * **Any change to the lifecycle.** Every proposer writes through V071's insert, which is born
--     `proposed` (`facts_legal_transition`): no proposer can confirm.

-- ---------------------------------------------------------------------------
-- Provenance's shape, widened
-- ---------------------------------------------------------------------------
create or replace function ouroboros.fact_provenance_typed(prov jsonb) returns boolean
language plpgsql immutable parallel safe as $$
declare
  ref jsonb;
  uuid_shape constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  -- Early returns, for V069's reason: `and` is not evaluated in order, and jsonb_object_keys
  -- raises on a non-object rather than answering false.
  if prov is null or jsonb_typeof(prov) <> 'object' then
    return false;
  end if;

  -- Exactly two keys: the display line, and the references it stands for.
  if exists (select 1 from jsonb_object_keys(prov) as k where k not in ('line', 'refs')) then
    return false;
  end if;

  -- The line the card renders: "from correction note (run #1847)".
  if jsonb_typeof(prov -> 'line') is distinct from 'string'
     or btrim(prov ->> 'line') = '' or length(prov ->> 'line') > 200 then
    return false;
  end if;

  -- Zero to sixteen typed references. A manual fact may cite nothing.
  if jsonb_typeof(prov -> 'refs') is distinct from 'array'
     or jsonb_array_length(prov -> 'refs') > 16 then
    return false;
  end if;

  for ref in select r from jsonb_array_elements(prov -> 'refs') as r loop
    if jsonb_typeof(ref) <> 'object' or jsonb_typeof(ref -> 'kind') is distinct from 'string' then
      return false;
    end if;

    case ref ->> 'kind'
      -- A row named by its uuid: the kind and the id, nothing else.
      when 'run', 'pull_request', 'ticket',
           'classification', 'waiver', 'steer', 'run_stage', 'gate' then
        if exists (select 1 from jsonb_object_keys(ref) as k where k not in ('kind', 'id'))
           or jsonb_typeof(ref -> 'id') is distinct from 'string'
           or (ref ->> 'id') !~ uuid_shape then
          return false;
        end if;

      -- A person: BetterAuth's text id.
      when 'person' then
        if exists (select 1 from jsonb_object_keys(ref) as k where k not in ('kind', 'id'))
           or jsonb_typeof(ref -> 'id') is distinct from 'string'
           or btrim(ref ->> 'id') = '' or length(ref ->> 'id') > 255 then
          return false;
        end if;

      -- An imported rules file, and optionally the heading the fact came from.
      when 'import' then
        if exists (select 1 from jsonb_object_keys(ref) as k
                    where k not in ('kind', 'file', 'section'))
           or jsonb_typeof(ref -> 'file') is distinct from 'string'
           or btrim(ref ->> 'file') = '' or length(ref ->> 'file') > 512 then
          return false;
        end if;
        if ref ? 'section'
           and (jsonb_typeof(ref -> 'section') <> 'string' or btrim(ref ->> 'section') = ''
                or length(ref ->> 'section') > 200) then
          return false;
        end if;

      else
        return false;
    end case;
  end loop;

  return true;
end;
$$;

comment on function ouroboros.fact_provenance_typed(jsonb) is
  'True when a fact''s provenance is the typed document BE.2 (#406) stores and BF.3 (#412) widened: {"line": <non-blank display line, ≤ 200>, "refs": [<0–16 refs>]} and nothing else, where a ref is {"kind": "run"|"pull_request"|"ticket"|"classification"|"waiver"|"steer"|"run_stage"|"gate", "id": <lower-case uuid>}, {"kind": "person", "id": <non-blank user id, ≤ 255>} or {"kind": "import", "file": <non-blank, ≤ 512>, "section"?: <non-blank, ≤ 200>}. Whether the ids name rows of the fact''s workspace is facts_provenance_resolves''s question.';

-- ---------------------------------------------------------------------------
-- Provenance refs resolve to this workspace — the new kinds too
-- ---------------------------------------------------------------------------
create or replace function ouroboros.facts_guard_provenance() returns trigger
language plpgsql as $$
declare
  ref   jsonb;
  found boolean;
begin
  -- A malformed document is facts_provenance_typed's complaint; BEFORE triggers run first.
  if not coalesce(ouroboros.fact_provenance_typed(new.provenance), false) then
    return new;
  end if;

  for ref in select r from jsonb_array_elements(new.provenance -> 'refs') as r loop
    case ref ->> 'kind'
      when 'run' then
        select exists (select 1 from ouroboros.runs
                        where id = (ref ->> 'id')::uuid
                          and organization_id = new.organization_id) into found;
      when 'pull_request' then
        select exists (select 1 from ouroboros.pull_requests
                        where id = (ref ->> 'id')::uuid
                          and organization_id = new.organization_id) into found;
      when 'ticket' then
        select exists (select 1 from ouroboros.tickets
                        where id = (ref ->> 'id')::uuid
                          and organization_id = new.organization_id) into found;
      when 'classification' then
        select exists (select 1 from ouroboros.failure_classifications
                        where id = (ref ->> 'id')::uuid
                          and organization_id = new.organization_id) into found;
      when 'waiver' then
        select exists (select 1 from ouroboros.pr_waivers
                        where id = (ref ->> 'id')::uuid
                          and organization_id = new.organization_id) into found;
      when 'steer' then
        select exists (select 1 from ouroboros.run_controls control
                         join ouroboros.runs run on run.id = control.run_id
                        where control.id = (ref ->> 'id')::uuid
                          and control.kind = 'steer'
                          and run.organization_id = new.organization_id) into found;
      when 'run_stage' then
        select exists (select 1 from ouroboros.run_stages stage
                         join ouroboros.runs run on run.id = stage.run_id
                        where stage.id = (ref ->> 'id')::uuid
                          and run.organization_id = new.organization_id) into found;
      when 'gate' then
        select exists (select 1 from ouroboros.pr_gate_definitions gate
                         join ouroboros.pull_requests pr on pr.id = gate.pr_id
                        where gate.id = (ref ->> 'id')::uuid
                          and pr.organization_id = new.organization_id) into found;
      when 'person' then
        select exists (select 1 from ouroboros.member
                        where "userId" = ref ->> 'id'
                          and "organizationId" = new.organization_id) into found;
      else
        -- An import names a file, which is not a row.
        found := true;
    end case;

    if not found then
      raise exception 'provenance names % %, which is not a row of workspace %',
        ref ->> 'kind', ref ->> 'id', new.organization_id
        using errcode = 'foreign_key_violation', constraint = 'facts_provenance_resolves';
    end if;
  end loop;

  return new;
end;
$$;

comment on function ouroboros.facts_guard_provenance() is
  'BEFORE INSERT OR UPDATE OF provenance, organization_id trigger for facts and fact_suppressions (#406, widened by #412): every run, pull_request, ticket, classification, waiver, steer, run_stage and gate reference in provenance.refs names a row of the row''s own workspace, and every person reference a member of it, when written. Raises 23503 naming facts_provenance_resolves. Leaves a malformed document to the typed-provenance CHECK, which fires after BEFORE triggers.';

-- ---------------------------------------------------------------------------
-- fact_suppressions — a candidate a proposer did not propose, and why
-- ---------------------------------------------------------------------------
create table ouroboros.fact_suppressions (
  id               uuid        primary key default gen_random_uuid(),

  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The repository the candidate was for, or null for the whole workspace.
  repo_ref         ouroboros.repo_ref,

  -- Which proposer, and which version of its rule, produced the candidate.
  proposer         text        not null,
  proposer_version integer     not null,

  -- The candidate as extracted, and the key it was matched on.
  text             text        not null,
  normalized_text  text        not null,

  -- The existing fact it matched — in any status. Cascade: a deleted workspace takes both.
  matched_fact_id  uuid        not null,

  -- The candidate's own typed provenance, as it would have been written on the fact.
  provenance       jsonb       not null,

  -- The source row, as `<kind>:<id>` — one suppression per source and matched fact.
  source_key       text        not null,

  created_at       timestamptz not null default now(),

  constraint fact_suppressions_matched_fact_fk
    foreign key (matched_fact_id, organization_id)
    references ouroboros.facts (id, organization_id) on delete cascade,

  constraint fact_suppressions_source_fact_key
    unique (organization_id, source_key, matched_fact_id),

  constraint fact_suppressions_proposer_valid
    check (proposer in ('correction_note', 'waiver', 'steer', 'import', 'llm')),

  constraint fact_suppressions_proposer_version_positive
    check (proposer_version >= 1),

  constraint fact_suppressions_text_present
    check (btrim(text) <> '' and length(text) <= 500),

  constraint fact_suppressions_normalized_text_present
    check (btrim(normalized_text) <> '' and length(normalized_text) <= 500),

  constraint fact_suppressions_provenance_typed
    check (ouroboros.fact_provenance_typed(provenance)),

  constraint fact_suppressions_source_key_shape
    check (source_key ~ '^[a-z_]+:.+$' and length(source_key) <= 600)
);

comment on table ouroboros.fact_suppressions is
  'A fact candidate a proposer did not propose because its normalized text matched an existing fact of the repository or workspace in any status (#412, BF.3, decision K5) — so dedupe is observable rather than silent. One row per (source, matched fact); append-only by trigger and by grant.';
comment on column ouroboros.fact_suppressions.proposer is
  'correction_note | waiver | steer | import | llm — the proposer kind; manual facts are never suppressed.';
comment on column ouroboros.fact_suppressions.proposer_version is
  'The version of the proposer''s rule in the REST registry that produced the candidate.';
comment on column ouroboros.fact_suppressions.normalized_text is
  'The comparison key: the candidate''s text with case, width, inline markup and whitespace folded.';
comment on column ouroboros.fact_suppressions.matched_fact_id is
  'The existing fact whose normalized text is the candidate''s — rejected and expired facts included.';
comment on column ouroboros.fact_suppressions.provenance is
  'The candidate''s typed provenance (fact_provenance_typed), resolved to the workspace like a fact''s.';
comment on column ouroboros.fact_suppressions.source_key is
  'The source row as <kind>:<id> — classification:<uuid>, waiver:<uuid>, steer:<uuid>, import:<file>#<section>.';

create index fact_suppressions_organization_created_idx
  on ouroboros.fact_suppressions (organization_id, created_at desc);

comment on index ouroboros.fact_suppressions_organization_created_idx is
  'The read path: a workspace''s suppressions, newest first (#412).';

create trigger fact_suppressions_provenance_resolves
  before insert or update of provenance, organization_id on ouroboros.fact_suppressions
  for each row execute function ouroboros.facts_guard_provenance();

create function ouroboros.fact_suppressions_refuse_update() returns trigger
language plpgsql as $$
begin
  raise exception 'ouroboros.fact_suppressions is append-only: row % cannot be revised', old.id
    using errcode = 'restrict_violation';
end;
$$;

comment on function ouroboros.fact_suppressions_refuse_update() is
  'Refuses every UPDATE of a fact suppression for every role including the owner (#412). Raises 23001.';

create trigger fact_suppressions_no_update
  before update on ouroboros.fact_suppressions
  for each row execute function ouroboros.fact_suppressions_refuse_update();

grant select, insert on ouroboros.fact_suppressions to ouroboros_app;
revoke update, delete on ouroboros.fact_suppressions from ouroboros_app;
revoke update, delete on ouroboros.fact_suppressions from public;
