-- V073__env_recipes.sql — `env_recipes`: the ordered setup commands that bring a repository's
-- environment up, versioned per repository (#408, BE.4, decision K7).
--
-- Mockup 14's Repo Profile card mostly composes truth other tables own — BB.1's detection rows
-- (`V067`'s `repo_detections_latest`) and BA.1's protected paths (`V067`'s
-- `protected_path_policies`). Its **Environment** block is the new thing:
--
--   west init -m https://github.com/acme-robotics/helios-manifest   # manifest repo
--   west update --narrow -o=--depth=1                                # shallow module fetch
--   zephyr-sdk-install 0.17.2 --toolchains arm-zephyr-eabi           # SDK + ARM toolchain
--   ccache --set-config=max_size=8G                                  # shared build cache
--
-- Written down once, in order, versioned — the difference between an environment that is
-- described in a README and one that is reproducible.
--
-- Nothing writes it yet. BB.1's detection service (#384) seeds a first draft, BE.5 (#409) seeds
-- the mockup's recipe and BG.4 (#420) renders the card. As with `V069`, that is why each rule a
-- reader depends on is a constraint here rather than an application invariant.
--
-- ---------------------------------------------------------------------------
-- The consumer contract
-- ---------------------------------------------------------------------------
--
-- Three consumers read the **current** version (`env_recipes_current`) of a repository's recipe
-- and run its `commands` in array order, each in a shell at the repository root, stopping at the
-- first non-zero exit. The `comment` of an entry is for people and is never executed.
--
--   | Consumer                            | Use                                                  |
--   |-------------------------------------|------------------------------------------------------|
--   | Farm container-pool setup           | run the recipe when preparing a pooled container     |
--   | Prebuild tier (BD.4, #399)          | the recipe is the build input for the devcontainer   |
--   |                                     | snapshot                                             |
--   | Execution workspace prep (AR.1,     | run before the first stage that needs a built tree   |
--   | #315)                               |                                                      |
--
-- A repository with no row is a valid state: no recipe has been detected or written, the
-- consumers run nothing, and the card says so rather than rendering an empty block.
--
-- ---------------------------------------------------------------------------
-- What each rule is for
-- ---------------------------------------------------------------------------
--
--   * **Order is the whole content.** `west init` before `west update` before the SDK install.
--     `commands` is a jsonb **array**, which preserves order, of `{command, comment?}` objects
--     (`env_recipe_commands_typed`): 1–64 entries, each command a non-blank single line of at
--     most 2000 characters, each comment optional, non-blank and at most 300 characters. A
--     malformed recipe is refused at write, so no consumer has to guess.
--
--   * **An edit is a new version.** When somebody moves the SDK to 0.17.3 and builds start
--     failing, the previous recipe must still be readable, and the change must carry a time and
--     a person. So a row is one version of one repository's recipe, `version` is dense from 1
--     per `(organization_id, repo_ref)` (`env_recipes_next_version`), and a written version is
--     immutable (`env_recipes_no_update`) — the one exception is `updated_by`'s own
--     `on delete set null`. Skill versions' argument (`V069`), at a smaller scale: there is no
--     draft row, because the card edits the whole block and saves it as the next version.
--
--   * **`source` says who wrote it.** `detected` is a draft seeded by BB.1's ecosystem packs (a
--     `west.yml` repository is a west workspace), and carries no `updated_by`
--     (`env_recipes_detected_unattributed`); `edited` is a person's. Once a repository has an
--     edited version, a detected one cannot follow it (`env_recipes_provenance`) — `V067`'s
--     rule for protected paths: a re-scan cannot supersede what a person chose.
--
-- ---------------------------------------------------------------------------
-- What is deliberately not here
-- ---------------------------------------------------------------------------
--
--   * **Snapshot state, boot times and prebuild schedules.** The card's
--     `boots in 38s (vs 6m cold)`, `Re-snapshot nightly` and **Rebuild snapshot now** belong to
--     the prebuild tier (BD.4, #399), which measures them. A copy here would be a second place
--     for the same truth, guaranteed to disagree with the first. The card reads BD.4's
--     measurement when it exists and says `prebuilds arrive with the build farm tier` until then.
--     constraints.sql asserts no such column appears.
--   * **A foreign key for `repo_ref`.** `V067`'s choice, as `V069` made it: a repository is named
--     source-agnostically, and removing a GitHub mirror row must not delete a team's recipe.

-- ---------------------------------------------------------------------------
-- The commands' shape
-- ---------------------------------------------------------------------------
create function ouroboros.env_recipe_commands_typed(cmds jsonb) returns boolean
language plpgsql immutable parallel safe as $$
declare
  entry jsonb;
begin
  -- Early returns rather than one boolean expression, for V069's reason: SQL does not promise
  -- to evaluate `and` left to right, and the jsonb set functions raise on the wrong type.
  if cmds is null or jsonb_typeof(cmds) <> 'array'
     or jsonb_array_length(cmds) not between 1 and 64 then
    return false;
  end if;

  for entry in select e from jsonb_array_elements(cmds) as e loop
    if jsonb_typeof(entry) <> 'object' then
      return false;
    end if;

    -- A closed set of keys. An unknown key is a typo or a field no consumer reads.
    if exists (select 1 from jsonb_object_keys(entry) as k where k not in ('command', 'comment'))
    then
      return false;
    end if;

    -- The command: one non-blank line.
    if jsonb_typeof(entry -> 'command') is distinct from 'string'
       or btrim(entry ->> 'command') = ''
       or length(entry ->> 'command') > 2000
       or entry ->> 'command' ~ '[[:cntrl:]]' then
      return false;
    end if;

    -- The comment, when present: one non-blank line, for people only.
    if entry ? 'comment'
       and (jsonb_typeof(entry -> 'comment') <> 'string'
            or btrim(entry ->> 'comment') = ''
            or length(entry ->> 'comment') > 300
            or entry ->> 'comment' ~ '[[:cntrl:]]') then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

comment on function ouroboros.env_recipe_commands_typed(jsonb) is
  'True when an environment recipe''s commands are the typed array BE.4 (#408) stores: 1–64 objects in run order, each {"command": text, "comment"?: text} — command a non-blank single line of at most 2000 characters, comment a non-blank single line of at most 300. No other keys.';

-- ---------------------------------------------------------------------------
-- env_recipes
-- ---------------------------------------------------------------------------
create table ouroboros.env_recipes (
  id              uuid               primary key default gen_random_uuid(),

  -- The workspace. Cascade: a recipe is that workspace's, as every extension table since V006.
  organization_id text               not null
                                     references ouroboros.organization ("id") on delete cascade,

  -- `acme-robotics/helios-firmware` — V067's domain, a label rather than a foreign key.
  repo_ref        ouroboros.repo_ref not null,

  -- The version within the repository — the v3 of `v3 · edited`. Dense from 1.
  version         integer            not null,

  -- The ordered setup commands (env_recipe_commands_typed).
  commands        jsonb              not null,

  -- detected (BB.1 seeded it) | edited (a person wrote it).
  source          text               not null,

  -- Who saved this version. Null for a detected draft, or once the person is removed.
  updated_by      text               references ouroboros."user" ("id") on delete set null,

  -- When this version was saved. Frozen with the rest of the row.
  updated_at      timestamptz        not null default now(),

  constraint env_recipes_repo_version_key
    unique (organization_id, repo_ref, version),

  constraint env_recipes_version_positive
    check (version >= 1),

  constraint env_recipes_commands_typed
    check (ouroboros.env_recipe_commands_typed(commands)),

  constraint env_recipes_source_valid
    check (source in ('detected', 'edited')),

  -- A detected draft was written by a rule pack, not a person.
  constraint env_recipes_detected_unattributed
    check (source = 'edited' or updated_by is null)
);

comment on table ouroboros.env_recipes is
  'A repository''s environment recipe (#408, BE.4, decision K7) — the ordered setup commands on mockup 14''s Repo Profile card, one immutable row per version. Consumed from env_recipes_current by farm container-pool setup, the prebuild tier (BD.4, #399) and execution workspace prep (AR.1, #315); V073''s header is the contract. Holds no snapshot, boot-time or prebuild-schedule data — that is BD.4''s.';
comment on column ouroboros.env_recipes.organization_id is
  'The workspace. ON DELETE CASCADE.';
comment on column ouroboros.env_recipes.repo_ref is
  'The repository, as owner/name (V067''s domain). A label rather than a foreign key, so removing a mirror row does not delete a team''s recipe.';
comment on column ouroboros.env_recipes.version is
  'The version within (organization_id, repo_ref) — dense from 1 (env_recipes_next_version), never reused. An edit is the next version; earlier ones stay readable.';
comment on column ouroboros.env_recipes.commands is
  'The setup commands in run order: [{"command": "west init -m …", "comment": "manifest repo"}, …]. See env_recipe_commands_typed. Consumers run command in array order; comment is never executed.';
comment on column ouroboros.env_recipes.source is
  'detected (a draft seeded by BB.1''s ecosystem packs, #384) | edited (a person saved it). A detected version cannot follow an edited one (env_recipes_provenance).';
comment on column ouroboros.env_recipes.updated_by is
  'Who saved this version — "user".id, ON DELETE SET NULL, the one update a version permits. Always null for a detected version.';
comment on column ouroboros.env_recipes.updated_at is
  'When this version was saved.';
comment on constraint env_recipes_commands_typed on ouroboros.env_recipes is
  'The commands are the typed ordered array env_recipe_commands_typed describes (#408), so a malformed recipe never reaches a consumer.';
comment on constraint env_recipes_detected_unattributed on ouroboros.env_recipes is
  'A detected version was written by a rule pack, so it names no person (#408).';

-- ---------------------------------------------------------------------------
-- Versions are dense from 1 — V069's skill_version_next, per repository.
-- ---------------------------------------------------------------------------
create function ouroboros.env_recipe_next_version() returns trigger
language plpgsql as $$
declare
  highest integer;
begin
  -- Below 1 is env_recipes_version_positive's complaint, not this one's.
  if new.version < 1 then
    return new;
  end if;

  select max(version) into highest
    from ouroboros.env_recipes
   where organization_id = new.organization_id
     and repo_ref = new.repo_ref;

  if new.version is distinct from coalesce(highest, 0) + 1 then
    raise exception
      'the next environment recipe version of % is v%, not v% (highest: %)',
      new.repo_ref, coalesce(highest, 0) + 1, new.version, coalesce(highest::text, 'none')
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.env_recipe_next_version() is
  'BEFORE INSERT trigger for env_recipes (#408): a version must be exactly one above the highest that repository has, and the first is 1. Refuses rather than assigns, as V069 does — two editors racing both compute max + 1 and the unique key lets one commit. Raises class 23 naming the trigger (env_recipes_next_version).';

create trigger env_recipes_next_version
  before insert on ouroboros.env_recipes
  for each row execute function ouroboros.env_recipe_next_version();

-- ---------------------------------------------------------------------------
-- A person's recipe is not superseded by a re-scan — V067's protected-path rule.
-- ---------------------------------------------------------------------------
create function ouroboros.env_recipe_provenance() returns trigger
language plpgsql as $$
begin
  if new.source = 'detected'
     and exists (select 1 from ouroboros.env_recipes r
                  where r.organization_id = new.organization_id
                    and r.repo_ref = new.repo_ref
                    and r.source = 'edited') then
    raise exception
      'the environment recipe of % has been edited by a person; a detected draft cannot supersede it',
      new.repo_ref
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.env_recipe_provenance() is
  'BEFORE INSERT trigger for env_recipes (#408): once a repository has an edited version, a detected version cannot be added after it, so a re-scan never replaces what a person wrote. Raises class 23 naming the trigger (env_recipes_provenance).';

create trigger env_recipes_provenance
  before insert on ouroboros.env_recipes
  for each row execute function ouroboros.env_recipe_provenance();

-- ---------------------------------------------------------------------------
-- Immutable once written — V069's skill_versions_refuse_update, for recipes.
-- ---------------------------------------------------------------------------
create function ouroboros.env_recipes_refuse_update() returns trigger
language plpgsql as $$
begin
  -- The updated_by foreign key's own ON DELETE SET NULL, with nothing else moving.
  if new.updated_by is null and old.updated_by is not null
     and row(new.id, new.organization_id, new.repo_ref, new.version, new.commands, new.source,
             new.updated_at)
         is not distinct from
         row(old.id, old.organization_id, old.repo_ref, old.version, old.commands, old.source,
             old.updated_at)
  then
    return new;
  end if;

  raise exception
    'ouroboros.env_recipes is immutable: v% of % cannot be revised', old.version, old.repo_ref
    using errcode = 'restrict_violation', constraint = tg_name,
          detail  = format('refused update of environment recipe %s', old.id),
          hint    = 'Save the edit as the next version instead. See V073__env_recipes.sql (#408).';
end;
$$;

comment on function ouroboros.env_recipes_refuse_update() is
  'Refuses every UPDATE of an environment recipe version (#408), for every role including the owner. One update passes: the updated_by foreign key''s own ON DELETE SET NULL.';

create trigger env_recipes_no_update
  before update on ouroboros.env_recipes
  for each row execute function ouroboros.env_recipes_refuse_update();

-- ---------------------------------------------------------------------------
-- env_recipes_current — the card's and the consumers' read path.
-- ---------------------------------------------------------------------------
create view ouroboros.env_recipes_current as
  select distinct on (r.organization_id, r.repo_ref)
         r.id,
         r.organization_id,
         r.repo_ref,
         r.version,
         r.commands,
         r.source,
         r.updated_by,
         r.updated_at
    from ouroboros.env_recipes r
   order by r.organization_id, r.repo_ref, r.version desc;

comment on view ouroboros.env_recipes_current is
  'Each repository''s newest environment recipe version (#408) — the Repo Profile card''s Environment block and the recipe farm setup, BD.4 prebuilds and AR.1 workspace prep run. A repository with no row here has no recipe, a valid state. Earlier versions stay in env_recipes.';

-- ---------------------------------------------------------------------------
-- The service role's grants: versions are appended, never edited or deleted — a deleted
-- workspace takes them with it.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert on ouroboros.env_recipes to ouroboros_app;
grant select on ouroboros.env_recipes_current to ouroboros_app;
revoke update, delete on ouroboros.env_recipes from public;
