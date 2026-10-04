-- V092__org_policy_versions.sql — the versioned org-policy document: `org_policies` becomes the
-- handle, `org_policy_versions` its immutable history (#480, BQ.1).
--
-- Mockup 17's **Autonomy Policies** card is tagged `policy v7`. A version tag is a promise about
-- singularity: one artifact with a history, so "Ken enabled auto-merge (policy v7)" names a
-- published state a reviewer can pull up. Five settings in five places cannot be versioned
-- together, so the five rules become one document:
--
--   1. **`org_policies`** (V075) is the stable handle every enforcement point resolves against —
--      one row per workspace, keyed by it — and gains **`current_version`**: which published
--      version is in force, null until the first publish.
--   2. **`org_policy_versions`** — one row per published version: `(organization_id, version)`
--      is the natural key, `document` the rules, `published_by`/`published_at`/`change_note` the
--      attribution the history popover shows. **Immutable**: a trigger refuses every `UPDATE`
--      and `DELETE`, for every role (V029's pattern, #132).
--   3. **`org_policy_publish(…)`** — the publish: appends version N+1 and advances
--      `current_version` in one statement, under the handle row's lock.
--
-- **The handle is V075's table, extended rather than replaced.** Its `dry_run` boolean survives
-- as the org-wide stricter override (see the mapping below). Publishing has to create the handle
-- row when a workspace has none, and in V075 a row's existence meant "dry-run answered" — so
-- `dry_run` becomes **nullable**: null is "never answered", which is what a row created by a
-- publish holds. `org_policies_effective` reads null as off exactly as it reads an absent row,
-- `is_explicit` becomes `dry_run is not null`, and onboarding completion's default becomes
--
--   insert into ouroboros.org_policies (organization_id, dry_run) values ($1, true)
--   on conflict (organization_id) do update set dry_run = true
--     where ouroboros.org_policies.dry_run is null;
--
-- so publishing a policy never changes anybody's dry-run state as a side effect. A row written
-- without naming the column still defaults to `true` — V075's onboarding answer is unchanged.
--
-- ---------------------------------------------------------------------------
-- The document
-- ---------------------------------------------------------------------------
--
-- A JSON object mapping `rule_id` → `{enabled, conditions}`. The grammar is committed as
-- `schemas/org-policy/v1.json`, which reuses the workflow DSL's vocabulary (#133: `effort`,
-- `label`, `path_glob`); `ci/db` validates its fixtures and every stored version against it, and
-- the writer (BQ.2, #481) validates before it publishes. The database holds the envelope:
--
--   - rule ids are the five below or `custom:<slug>` — the escape hatch, accepted with no schema
--     change (`org_policy_versions_rule_ids`);
--   - the five are always present, so an absent rule is never ambiguous — `enabled: false` is
--     how a rule is switched off (`org_policy_versions_core_rules`);
--   - every rule is exactly `{enabled: boolean, conditions: object}` (`org_policy_versions_rule_shape`);
--   - `spend_guard`'s caps are **positive integer cents** — never dollars, never a float: `$2.50`
--     is `250`, `$600` is `60000` (`org_policy_versions_spend_cents`).
--
-- The mockup's chips, as the document stores them (policy v7):
--
--   {
--     "auto_merge":        {"enabled": true, "conditions": {"all": [{"effort_lte": "m"}, {"not": {"label": "refactor"}}]}},
--     "human_review":      {"enabled": true, "conditions": {"any": [{"label": "refactor"}, {"effort_gte": "l"}]}},
--     "protected_paths":   {"enabled": true, "conditions": {"path_globs": ["boot/**", "keys/**", ".github/**"]}},
--     "spend_guard":       {"enabled": true, "conditions": {"per_run_cap_cents": 250, "monthly_cap_cents": 60000}},
--     "dry_run_new_repos": {"enabled": true, "conditions": {"first_n_loops": 10}}
--   }
--
-- ---------------------------------------------------------------------------
-- The absorption mapping — what BQ.2 (#481) wires, plane by plane
-- ---------------------------------------------------------------------------
--
-- This document absorbs configuration that already exists. Until BQ.2 rewires each reader, the
-- originals stay authoritative and nothing here is read; after it, the document is the one
-- authoring source and each original is either written through or demoted to an override.
--
--   1. **Dry-run (BA.3, #382) → `dry_run_new_repos.conditions.first_n_loops`.** V075's org-wide
--      boolean generalises to a per-repository counter: a repository's first N loops open draft
--      PRs. The boolean survives as the **stricter override** — `org_policies.dry_run = true`
--      forces dry-run on every repository whatever the counter says; false or null defers to the
--      rule. A workspace in dry-run today is therefore never loosened by the migration.
--   2. **The AX gate engine's refactor-label org policy (AX.2, #358) → `human_review.conditions`.**
--      Today that is `ORG_GATE_POLICY`, a port bound to built-in defaults (no table); BQ.2 rebinds
--      it to the resolver, and the rule `{"label": "refactor"}` (or `effort ≥ L`) is what the
--      inbox card's *why* names. `auto_merge.conditions` is its complement for the merge executor.
--   3. **Protected paths (BA.1, #380) → `protected_paths.conditions.path_globs`.** V067's
--      `protected_path_policies` rows are per repository; the document's globs are org-wide.
--      The document becomes the editing path and the onboarding wizard writes through to it;
--      AP.3's `allowed_paths` guardrail (#305) checks the **union** of the org globs and the
--      repository's own rows, so absorbing never un-protects a path.
--   4. **Provider caps (AF.4 #237, Z.1 #194) → `spend_guard.conditions.per_run_cap_cents` /
--      `monthly_cap_cents`.** Two existing columns, both integer cents:
--      `routes.max_cost_cents_per_run` (V016, per task kind) and
--      `provider_connections.monthly_cap_cents` (V017, per provider). **Precedence: the stricter
--      cap wins.** While `spend_guard` is enabled, the effective per-run cap of a route is
--      `least(route cap, per_run_cap_cents)` and the effective monthly cap of a provider is
--      `least(provider cap, monthly_cap_cents)` — `monthly_cap_cents` is a cap applied to each
--      provider separately (*"$600/provider"*), never a sum across them. A null column (no cap)
--      takes the guard's value; a disabled guard leaves the per-route and per-provider caps
--      alone. Neither layer can loosen the other.
--
-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------
--
-- Flyway's community edition has no undo migrations, so this repository reverts forward: a later
-- `V` migration. The complete inverse of this one, kept here so that migration is written from
-- a specification (it discards the policy history, and resolves never-answered handle rows to
-- what they read as — no row):
--
--   drop function ouroboros.org_policy_publish(text, jsonb, text, text);
--   alter table ouroboros.org_policies drop constraint org_policies_current_version_fk;
--   drop trigger org_policies_current_is_latest on ouroboros.org_policies;
--   drop function ouroboros.org_policies_current_is_latest();
--   drop table ouroboros.org_policy_versions;
--   drop function ouroboros.org_policy_versions_refuse_change();
--   drop function ouroboros.org_policy_version_next();
--   drop function ouroboros.org_policy_document_rule_ids_valid(jsonb);
--   drop function ouroboros.org_policy_document_rules_shaped(jsonb);
--   drop function ouroboros.org_policy_document_spend_cents_valid(jsonb);
--   alter table ouroboros.org_policies drop column current_version;
--   drop trigger org_policies_touch_updated_at on ouroboros.org_policies;
--   create trigger org_policies_touch_updated_at before update on ouroboros.org_policies
--     for each row execute function ouroboros.touch_updated_at();
--   delete from ouroboros.org_policies where dry_run is null;
--   alter table ouroboros.org_policies alter column dry_run set not null;
--   create or replace view ouroboros.org_policies_effective … (V075's definition, verbatim)

-- ---------------------------------------------------------------------------
-- 1. org_policies — the handle.
-- ---------------------------------------------------------------------------
alter table ouroboros.org_policies
  alter column dry_run drop not null,

  -- Which published version is in force — the card's `policy v7`. Null until the first publish.
  -- A pointer held to a real version by org_policies_current_version_fk (added below, once the
  -- table it points at exists) and moved only forward by org_policies_current_is_latest.
  add column current_version integer
             constraint org_policies_current_version_positive
               check (current_version is null or current_version >= 1);

comment on column ouroboros.org_policies.dry_run is
  'Dry-run (#382): while true, PRs open as drafts, merges are refused at arm and at execution, and workflow auto-merge terminals are overridden without being mutated. Null is "never answered" — a row created by a policy publish (#480) — and reads as off, exactly like an absent row. Defaults true — the answer onboarding completion writes when unset. Since #480 the org-wide stricter override of the policy document''s dry_run_new_repos rule.';
comment on column ouroboros.org_policies.current_version is
  'Which published org_policy_versions row is in force (#480) — the card''s "policy v7". Null until the first publish. Moved only by org_policy_publish, only forward, and only to the newest version.';

create or replace view ouroboros.org_policies_effective
  with (security_invoker = true) as
select o."id"                     as organization_id,
       -- Never answered (no row, or a row a publish created): dry-run off.
       coalesce(p.dry_run, false) as dry_run,
       -- Whether the workspace has answered, as opposed to what the answer is.
       (p.dry_run is not null)    as is_explicit,
       -- The dry-run answer's stamps: a row only a publish created has answered nothing.
       case when p.dry_run is not null then p.updated_at end as updated_at,
       case when p.dry_run is not null then p.updated_by end as updated_by
  from ouroboros.organization o
  left join ouroboros.org_policies p
    on p.organization_id = o."id";

-- A publish moves only current_version, and that is not a dry-run change: the stamp follows
-- every other column (V066's recipe — updated_at stays inside the comparison).
drop trigger org_policies_touch_updated_at on ouroboros.org_policies;

create trigger org_policies_touch_updated_at
  before update on ouroboros.org_policies
  for each row
  when ((to_jsonb(new) - 'current_version') is distinct from (to_jsonb(old) - 'current_version'))
  execute function ouroboros.touch_updated_at();

comment on column ouroboros.org_policies_effective.is_explicit is
  'Whether the workspace has answered the dry-run question — a choice, or the onboarding default — rather than the view''s default. False for no row and for a row whose dry_run is null (#480).';

-- ---------------------------------------------------------------------------
-- 2. The document's envelope, as functions a CHECK can call.
--
-- Immutable SQL over the value alone, so they are legal in a CHECK and say the same thing on
-- every row forever. Each passes a value of the wrong type through, so the complaint is the
-- check that is about the type (`org_policy_versions_document_object`, `_rule_shape`) rather
-- than a function error. The grammar inside `conditions` is the JSON Schema's, not these.
-- ---------------------------------------------------------------------------
create function ouroboros.org_policy_document_rule_ids_valid(document jsonb) returns boolean
language sql immutable strict parallel safe
as $$
  select jsonb_typeof(document) <> 'object' or not exists (
    select 1
      from jsonb_object_keys(document) as rule(id)
     where rule.id not in ('auto_merge', 'human_review', 'protected_paths',
                           'spend_guard', 'dry_run_new_repos')
       and rule.id !~ '^custom:[a-z0-9][a-z0-9_-]{0,62}$')
$$;

comment on function ouroboros.org_policy_document_rule_ids_valid(jsonb) is
  'Whether every key of a policy document is a known rule id (#480): auto_merge, human_review, protected_paths, spend_guard, dry_run_new_repos, or the custom:<slug> escape hatch — lower-case slug, at most 63 characters. True for a non-object, which org_policy_versions_document_object refuses.';

create function ouroboros.org_policy_document_rules_shaped(document jsonb) returns boolean
language sql immutable strict parallel safe
as $$
  select jsonb_typeof(document) <> 'object' or not exists (
    select 1
      from jsonb_each(document) as rule(id, body)
     where jsonb_typeof(rule.body) is distinct from 'object'
        or jsonb_typeof(rule.body -> 'enabled') is distinct from 'boolean'
        or jsonb_typeof(rule.body -> 'conditions') is distinct from 'object'
        or (rule.body - 'enabled' - 'conditions') <> '{}'::jsonb)
$$;

comment on function ouroboros.org_policy_document_rules_shaped(jsonb) is
  'Whether every rule of a policy document is exactly {enabled: boolean, conditions: object} (#480). True for a non-object, which org_policy_versions_document_object refuses.';

create function ouroboros.org_policy_document_spend_cents_valid(document jsonb) returns boolean
language sql immutable strict parallel safe
as $$
  select jsonb_typeof(document #> '{spend_guard,conditions}') is distinct from 'object' or not exists (
    select 1
      from jsonb_each(document #> '{spend_guard,conditions}') as cap(name, value)
     where cap.name in ('per_run_cap_cents', 'monthly_cap_cents')
       and (jsonb_typeof(cap.value) is distinct from 'number'
            or cap.value::numeric <> trunc(cap.value::numeric)
            or cap.value::numeric < 1
            or cap.value::numeric > 2147483647))
$$;

comment on function ouroboros.org_policy_document_spend_cents_valid(jsonb) is
  'Whether spend_guard''s caps are positive integer cents (#480) — $2.50 is 250, never 2.5 and never a string; bounded to what an integer column holds, so a cap compares against routes.max_cost_cents_per_run and provider_connections.monthly_cap_cents without a cast. True when spend_guard''s conditions are not an object, which org_policy_versions_rule_shape refuses.';

-- ---------------------------------------------------------------------------
-- 3. org_policy_versions — the immutable history.
-- ---------------------------------------------------------------------------
create table ouroboros.org_policy_versions (
  -- The policy: its handle's key, which is the workspace. Cascades, so deleting a workspace (or
  -- purging it, #489) takes the history with it — the one delete the refusal below lets through.
  organization_id text        not null
                              references ouroboros.org_policies (organization_id)
                              on delete cascade,

  -- 1, 2, 3 … dense per policy (org_policy_versions_next_version) — printed as "policy v7".
  version         integer     not null
                              constraint org_policy_versions_version_positive
                                check (version >= 1),

  -- The rules. See the header for the envelope held here and the grammar held by the schema.
  document        jsonb       not null
                              constraint org_policy_versions_document_object
                                check (jsonb_typeof(document) = 'object'),

  -- Who published it — the audited actor. Set null when the person is removed (V029's reason:
  -- the published state must survive its author); the immutability trigger lets that one
  -- update through and nothing else.
  published_by    text        references ouroboros."user" ("id") on delete set null,

  published_at    timestamptz not null default now(),

  -- The history popover's line. Optional, never blank, at most 500 characters (V029's bound).
  change_note     text
                              constraint org_policy_versions_change_note_present
                                check (change_note is null
                                       or (btrim(change_note) <> '' and length(change_note) <= 500)),

  constraint org_policy_versions_pkey primary key (organization_id, version),

  constraint org_policy_versions_rule_ids
    check (ouroboros.org_policy_document_rule_ids_valid(document)),

  constraint org_policy_versions_core_rules
    check (jsonb_typeof(document) <> 'object'
           or document ?& array['auto_merge', 'human_review', 'protected_paths',
                                'spend_guard', 'dry_run_new_repos']),

  constraint org_policy_versions_rule_shape
    check (ouroboros.org_policy_document_rules_shaped(document)),

  constraint org_policy_versions_spend_cents
    check (ouroboros.org_policy_document_spend_cents_valid(document))
);

comment on table ouroboros.org_policy_versions is
  'Every published version of a workspace''s policy document (#480, BQ.1) — append-only and immutable: an UPDATE or DELETE is refused for every role, except the published_by foreign key''s own set-null and the cascade of a deleted workspace. Published through org_policy_publish, which advances org_policies.current_version in the same statement.';
comment on column ouroboros.org_policy_versions.version is
  'The version number — "policy v7". Unique per policy, starting at 1 and dense: exactly one above the highest already published.';
comment on column ouroboros.org_policy_versions.document is
  'The rules: rule_id → {enabled, conditions}, conditions in the WF-P8 predicate grammar (#133). Grammar: schemas/org-policy/v1.json. Money is integer cents.';
comment on column ouroboros.org_policy_versions.published_by is
  'Who published it, or null once that person is deleted. The only column that may ever change, and only to null.';
comment on column ouroboros.org_policy_versions.change_note is
  'Why — the history popover''s line. Optional; never blank; at most 500 characters.';

-- ---------------------------------------------------------------------------
-- Numbering: a published version is exactly one above the highest (V029's rule).
-- ---------------------------------------------------------------------------
create function ouroboros.org_policy_version_next() returns trigger
language plpgsql
as $$
declare
  highest integer;
begin
  -- Below 1 is the column's complaint, not this one's.
  if new.version < 1 then
    return new;
  end if;

  select max(version) into highest
    from ouroboros.org_policy_versions
   where organization_id = new.organization_id;

  if new.version is distinct from coalesce(highest, 0) + 1 then
    raise exception
      'the next version of the policy of % is v%, not v% (highest published: %)',
      new.organization_id, coalesce(highest, 0) + 1, new.version, coalesce(highest::text, 'none')
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.org_policy_version_next() is
  'BEFORE INSERT trigger for org_policy_versions (#480): a version must be exactly one above the highest that policy has, and the first is 1 — dense, because it is printed as "policy v7". Refuses rather than assigns: two racing publishers both compute max + 1 and the primary key lets one commit. Raises class 23 naming the trigger.';

create trigger org_policy_versions_next_version
  before insert on ouroboros.org_policy_versions
  for each row execute function ouroboros.org_policy_version_next();

-- ---------------------------------------------------------------------------
-- Immutable, in the database rather than in the grants (#132's pattern).
-- ---------------------------------------------------------------------------
create function ouroboros.org_policy_versions_refuse_change() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    -- The one update permitted is not a revision: the published_by foreign key's own
    -- ON DELETE SET NULL, which is implemented as an UPDATE of this row. Everything else equal.
    if new.published_by is null and old.published_by is not null
       and row(new.organization_id, new.version, new.document, new.published_at, new.change_note)
           is not distinct from
           row(old.organization_id, old.version, old.document, old.published_at, old.change_note)
    then
      return new;
    end if;

    raise exception
      'ouroboros.org_policy_versions is immutable: v% of the policy of % cannot be revised',
      old.version, old.organization_id
      using errcode = 'restrict_violation', constraint = tg_name,
            hint = 'Publish the next version instead (ouroboros.org_policy_publish). See V092__org_policy_versions.sql (#480).';
  end if;

  -- DELETE. The one delete permitted is the cascade of a deleted workspace: by the time it
  -- reaches this row the organization is no longer visible. Any other delete — of a version,
  -- or of the handle row with its history — is refused.
  if not exists (select 1 from ouroboros.organization where "id" = old.organization_id) then
    return old;
  end if;

  raise exception
    'ouroboros.org_policy_versions is immutable: v% of the policy of % cannot be deleted',
    old.version, old.organization_id
    using errcode = 'restrict_violation', constraint = tg_name,
          hint = 'A version is deleted only with its workspace. See V092__org_policy_versions.sql (#480).';
end;
$$;

comment on function ouroboros.org_policy_versions_refuse_change() is
  'Refuses every UPDATE and DELETE of a published policy version (#480), for any role including the owner (V022/V029''s argument: a superuser bypasses grants). Two exceptions: the published_by foreign key''s set-null — who published may be forgotten, what was published may not change — and the cascade of a deleted workspace, so #489''s purge still removes everything. Raises class 23 naming the trigger.';

create trigger org_policy_versions_immutable
  before update or delete on ouroboros.org_policy_versions
  for each row execute function ouroboros.org_policy_versions_refuse_change();

comment on trigger org_policy_versions_immutable on ouroboros.org_policy_versions is
  'A published policy version cannot be revised or deleted (#480) — an audit line "policy v7" must name what v7 said then, not what it says today.';

-- ---------------------------------------------------------------------------
-- current_version: a real version, only ever the newest.
-- ---------------------------------------------------------------------------
alter table ouroboros.org_policies
  add constraint org_policies_current_version_fk
    foreign key (organization_id, current_version)
    references ouroboros.org_policy_versions (organization_id, version);

comment on constraint org_policies_current_version_fk on ouroboros.org_policies is
  'current_version names a real published version of this workspace''s own policy (#480). No action on delete: the version in force cannot be removed out from under the pointer.';

create function ouroboros.org_policies_current_is_latest() returns trigger
language plpgsql
as $$
declare
  highest integer;
begin
  if tg_op = 'UPDATE' and new.current_version is not distinct from old.current_version then
    return new;
  end if;

  -- A new handle has no history to point at. Passed through on insert because a BEFORE INSERT
  -- trigger fires ahead of `on conflict`: publish's and onboarding's upserts of an existing
  -- handle carry a null pointer that the conflict, not this rule, disposes of.
  if tg_op = 'INSERT' and new.current_version is null then
    return new;
  end if;

  select max(version) into highest
    from ouroboros.org_policy_versions
   where organization_id = new.organization_id;

  -- Null only while nothing has been published; otherwise the newest version and nothing else.
  if new.current_version is not distinct from highest then
    return new;
  end if;

  raise exception
    'the policy of % is in force at its newest version (v%), not v%',
    new.organization_id, coalesce(highest::text, 'none'), coalesce(new.current_version::text, 'null')
    using errcode = 'check_violation', constraint = tg_name,
          hint = 'To return to an earlier policy, publish its document again as the next version.';
end;
$$;

comment on function ouroboros.org_policies_current_is_latest() is
  'BEFORE INSERT OR UPDATE trigger for org_policies (#480): current_version is null while nothing is published and otherwise the newest version — publishing advances it, and nothing moves it back. A rollback is a new version carrying the old document, so the history reads in order. Raises class 23 naming the trigger.';

create trigger org_policies_current_is_latest
  before insert or update of current_version on ouroboros.org_policies
  for each row execute function ouroboros.org_policies_current_is_latest();

-- ---------------------------------------------------------------------------
-- 4. The publish.
-- ---------------------------------------------------------------------------
create function ouroboros.org_policy_publish(
  p_organization_id text,
  p_document        jsonb,
  p_published_by    text,
  p_change_note     text default null
) returns integer
language plpgsql
as $$
declare
  next_version integer;
begin
  -- The handle, created when absent. dry_run null: publishing answers nothing about dry-run.
  insert into ouroboros.org_policies (organization_id, dry_run)
    values (p_organization_id, null)
    on conflict (organization_id) do nothing;

  -- Locked, so concurrent publishes of one workspace queue rather than collide on the number.
  select coalesce(current_version, 0) + 1 into next_version
    from ouroboros.org_policies
   where organization_id = p_organization_id
     for update;

  insert into ouroboros.org_policy_versions
    (organization_id, version, document, published_by, change_note)
    values (p_organization_id, next_version, p_document, p_published_by, p_change_note);

  -- Only the pointer: updated_at/updated_by are the dry-run answer's, and the version row is
  -- this publish's attribution.
  update ouroboros.org_policies
     set current_version = next_version
   where organization_id = p_organization_id;

  return next_version;
end;
$$;

comment on function ouroboros.org_policy_publish(text, jsonb, text, text) is
  'Publish a workspace''s next policy version (#480): creates the org_policies handle when absent (dry_run null — unanswered), appends version current + 1 and advances current_version, atomically, under the handle''s row lock. Returns the new version number. The document is held to the envelope by the table''s checks; the writer validates the grammar against schemas/org-policy/v1.json first. Invoker''s rights.';

-- ---------------------------------------------------------------------------
-- The service role's grants. No update or delete on the history: the trigger refuses them for
-- every role anyway, and a grant nobody may use is a grant somebody will read as permission.
-- ---------------------------------------------------------------------------
grant select, insert on ouroboros.org_policy_versions to ouroboros_app;
grant execute on function ouroboros.org_policy_publish(text, jsonb, text, text) to ouroboros_app;
