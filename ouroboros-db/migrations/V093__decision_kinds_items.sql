-- V093__decision_kinds_items.sql — the decision domain: versioned kind declarations and the typed
-- items filed against them (#457, BM.1).
--
-- Mockup 16's Needs-You inbox is one queue fed by nine subsystems. Every card on it — a severity,
-- a question, an age, a row of ref tags, a `why` paragraph, a row of actions — is *data*, and this
-- migration is what makes that enforceable:
--
--   1. **`decision_kinds`** — one row per published version of a kind's declaration (decision
--      X1). A kind owns its payload schema, its severity default, its question and why templates,
--      its ref shape (with its plain tags), its ordered action list, what "answered" means for it,
--      its escalation window and whether it is merge-class. A subsystem joining the inbox writes a
--      declaration; it does not touch the queue. **Immutable**: a trigger refuses every UPDATE
--      and DELETE, so an item pinned to a version renders as it was filed for as long as it lives.
--      New emissions use the newest version (`decision_kinds_current`).
--   2. **`decision_items`** — one row per question asked of a workspace. It carries **facts only**
--      (`payload`), validated at write time against its pinned version's `payload_schema`; typed
--      canonical refs that must resolve in the item's own workspace; and the emitter's
--      `(plane, source_ref)` pair, unique per workspace, so a stage evaluated on every retry still
--      files one card (`decision_item_emit` is the upsert).
--   3. **Templates** (decision X2) — `{slot}` names a fact. A slot must name a *required scalar*
--      property of the kind's schema, so a template that renders a hole cannot be declared, and a
--      payload that lacks a fact cannot be filed. `decision_template_render` composes the prose;
--      `decision_items_rendered` is every item rendered at its pinned version.
--
-- ---------------------------------------------------------------------------
-- The kind vocabulary
-- ---------------------------------------------------------------------------
--
-- The nine MVP kinds (X1): `merge_approval`, `protected_path_allow_once`, `claim_waiver`,
-- `plan_sign_off`, `fact_review`, `run_needs_human`, `split_approval`, `resize_review`,
-- `spend_approval`. The five the issue's amendments asked for, named now so their tickets add a
-- declaration and no vocabulary change: Research (mockup 22) `regression_drift_detected` (#623),
-- `bisect_complete` (#623), `research_brief_ready` (#625); Marketplace (mockup 23)
-- `snippet_install_approval` (#789) and `snippet_version_yanked` (#787). Plus `custom:<slug>` for
-- registered extensions, the same escape hatch V092's rule ids use.
--
-- **Only three declarations ship here** — the three the mockup fixes word for word
-- (`merge_approval`, `protected_path_allow_once`, `claim_waiver`, v1 each, at the bottom of this
-- file). Every other kind's declaration arrives with its emitter (BN.1, #461, and the amendment
-- tickets), so no prose is invented ahead of the plane that has the facts.
--
-- ---------------------------------------------------------------------------
-- The declaration's documents
-- ---------------------------------------------------------------------------
--
-- **`payload_schema`** is JSON Schema — a *supported subset*, held by a CHECK so a declaration
-- cannot lean on a keyword the write-time validator would silently ignore:
--
--   root      {"type": "object", "properties": {…}, "required": […], "additionalProperties": false}
--             plus the annotations `$schema`, `title`, `description`. Closed: facts only.
--   property  `type` is one of string · integer · number · boolean · array, and only the
--             keywords that mean something for it: string — enum, minLength, maxLength, pattern;
--             integer/number — enum, minimum, maximum; array — items (a scalar property),
--             minItems, maxItems; any — title, description.
--
-- `pattern` is matched with PostgreSQL's regular expressions (POSIX ARE), which agree with
-- ECMA-262 on the anchors, classes and quantifiers a fact pattern needs.
--
-- **`actions`** is the ordered button row: 1–8 entries of exactly
--
--   {id, label, style, required_role, consequence_text, takes_note, handler_binding}
--
--   - `id` a snake_case slug, unique in the row; `label` what the button says;
--   - `style` primary · ghost · danger, at most one primary;
--   - `required_role` viewer · member · approver · admin · owner — `approver` is V091's
--     `can_approve_loops` capability (owner/admin by default), the others are `member.role`;
--   - `consequence_text` the sentence that says what pressing it does;
--   - `takes_note` whether the action carries a note (a waiver must — V055's reason column);
--   - `handler_binding` `<plane>.<operation>` — what BN.2 (#462) executes. `navigate.<target>`
--     is a link (*Open PR verification →*): it decides nothing, never takes a note, and cannot
--     answer the item.
--
-- **`resolution_semantics`** is exactly `{answered_by, closes_source, auto_resolvable}`:
-- `answered_by` the action ids that answer the item (at least one, never a link),
-- `closes_source` the subset of those that settle the source question, `auto_resolvable` whether
-- a policy may answer it (BP.4). **A merge-class kind is never auto-resolvable**, and
-- `merge_approval` is always merge-class — constraints, not convention — and a later version of a
-- kind may not loosen either (`decision_kinds_no_loosening`), so no publish or policy can turn a
-- human merge decision into an automatic one.
--
-- **`ref_shape`** is exactly `{required, optional, tags}`: which typed refs (run · pr · ticket ·
-- path) an item must and may carry, and `tags` — the card's unlinked tags (`refactor`,
-- `verification`), each a template over the payload or a literal, rendered like the question.
--
-- **`escalation_window`** is how long an unanswered item waits before #538's timers escalate it
-- — the mockup-19 countdown (`paused 4m · escalates … in 26m`: thirty minutes) is computed from
-- it, never stored. Per-workspace overrides are #538's. **`merge_class`** marks the kinds whose
-- actions must deep-link to a session confirmation (X5) rather than complete from a channel.
--
-- ---------------------------------------------------------------------------
-- Refs
-- ---------------------------------------------------------------------------
--
-- `refs` is an ordered array of `{type, id, label}` — the tag row, in the emitter's order.
-- Canonical and tracker-agnostic: `run` names `runs.id`, `pr` names `pull_requests.id` (AX.1's
-- provider-neutral PR, GitHub PR or GitLab MR alike), `ticket` names `tickets.id` (Q.1's canonical
-- ticket, wherever it lives). A `path` is repository-relative (V047/V067's grammar) and resolves
-- by shape alone: the protected path an allow-once item asks about is one the run was *refused*
-- permission to edit, so no table holds it yet. `label` is the tag's text (`loop #1843`); no
-- provider URL is stored. Refs resolve **at write time** in the item's own workspace; jsonb holds
-- no foreign key, so a ref outlives a later delete of its target, as an audit line would.
--
-- ---------------------------------------------------------------------------
-- Reverting
-- ---------------------------------------------------------------------------
--
-- Flyway's community edition has no undo migrations, so this repository reverts forward. The
-- complete inverse, kept here so that migration is written from a specification:
--
--   drop view ouroboros.decision_items_rendered;
--   drop view ouroboros.decision_kinds_current;
--   drop function ouroboros.decision_item_emit(text, text, jsonb, jsonb, text, text, text);
--   drop table ouroboros.decision_items;
--   drop function ouroboros.decision_items_default_severity();
--   drop function ouroboros.decision_items_payload_conforms();
--   drop function ouroboros.decision_items_ref_shape();
--   drop function ouroboros.decision_items_refs_resolve();
--   drop function ouroboros.decision_items_refuse_repin();
--   drop function ouroboros.decision_ref_resolves(text, jsonb);
--   drop function ouroboros.decision_refs_well_formed(jsonb);
--   drop function ouroboros.decision_ref_path_valid(text);
--   drop table ouroboros.decision_kinds;
--   drop function ouroboros.decision_kinds_refuse_change();
--   drop function ouroboros.decision_kind_version_next();
--   drop function ouroboros.decision_kinds_no_loosening();
--   drop function ouroboros.decision_ref_shape_valid(jsonb, jsonb);
--   drop function ouroboros.decision_resolution_valid(jsonb, jsonb);
--   drop function ouroboros.decision_actions_valid(jsonb);
--   drop function ouroboros.decision_payload_violation(jsonb, jsonb);
--   drop function ouroboros.decision_payload_schema_supported(jsonb);
--   drop function ouroboros.decision_payload_property_supported(jsonb);
--   drop function ouroboros.decision_value_violation(jsonb, jsonb, text);
--   drop function ouroboros.decision_template_render(text, jsonb);
--   drop function ouroboros.decision_template_slotted(text, jsonb);
--   drop function ouroboros.decision_template_slots(text);
--   drop function ouroboros.decision_template_well_formed(text);

-- ---------------------------------------------------------------------------
-- 1. Templates (X2): `{slot}` names a fact; braces mean nothing else.
-- ---------------------------------------------------------------------------
create function ouroboros.decision_template_well_formed(template text) returns boolean
language sql immutable strict parallel safe
as $$
  select template ~ '^([^{}]|\{[a-z][a-z0-9_]{0,62}\})*$'
$$;

comment on function ouroboros.decision_template_well_formed(text) is
  'Whether a decision template is well formed (#457): literal text with {slot} placeholders, each slot a snake_case fact name. A brace that is not part of a slot is refused, so a template never renders a stray brace.';

create function ouroboros.decision_template_slots(template text) returns text[]
language sql immutable strict parallel safe
as $$
  select coalesce(array_agg(m.slot[1] order by m.ord), '{}')
    from regexp_matches(template, '\{([a-z][a-z0-9_]*)\}', 'g') with ordinality as m(slot, ord)
$$;

comment on function ouroboros.decision_template_slots(text) is
  'The fact names a decision template''s {slot}s ask for (#457), in order of appearance, repeats kept. Empty for a template with no slot.';

create function ouroboros.decision_template_slotted(template text, payload_schema jsonb)
returns boolean
language sql immutable strict parallel safe
as $$
  select ouroboros.decision_template_well_formed(template)
     and jsonb_typeof(payload_schema -> 'required') = 'array'
     and not exists (
       select 1
         from unnest(ouroboros.decision_template_slots(template)) as s(slot)
        where not (payload_schema -> 'required') ? s.slot
           or coalesce(payload_schema #>> array['properties', s.slot, 'type'], '')
                not in ('string', 'integer', 'number', 'boolean'))
$$;

comment on function ouroboros.decision_template_slotted(text, jsonb) is
  'Whether every {slot} of a template names a required scalar fact of the payload schema (#457) — so a declared template can never render a hole, and an item whose payload passed its schema always renders.';

create function ouroboros.decision_template_render(template text, payload jsonb) returns text
language plpgsql immutable strict parallel safe
as $$
declare
  missing  text;
  rendered text;
begin
  if not ouroboros.decision_template_well_formed(template) then
    raise exception 'decision template is malformed: %', template
      using errcode = 'invalid_parameter_value';
  end if;

  select s.slot into missing
    from unnest(ouroboros.decision_template_slots(template)) as s(slot)
   where coalesce(jsonb_typeof(payload -> s.slot), 'missing') not in ('string', 'number', 'boolean')
   limit 1;

  if missing is not null then
    raise exception 'decision template slot {%} has no fact in the payload', missing
      using errcode = 'invalid_parameter_value';
  end if;

  -- One pass over the template's tokens — slots and literal runs — so a fact whose text looks
  -- like a slot ("{files}") is printed, never expanded.
  select coalesce(string_agg(case when t.tok[1] like '{%'
                                  then payload ->> substr(t.tok[1], 2, length(t.tok[1]) - 2)
                                  else t.tok[1]
                             end, '' order by t.ord), '')
    into rendered
    from regexp_matches(template, '\{[a-z][a-z0-9_]*\}|[^{}]+', 'g') with ordinality as t(tok, ord);

  return rendered;
end;
$$;

comment on function ouroboros.decision_template_render(text, jsonb) is
  'Composes a decision''s prose from its facts (#457, X2): each {slot} becomes the payload field of that name as text (214, refactor, true), in a single pass, so a fact is never itself expanded. Raises 22023 for a malformed template or a slot with no scalar fact.';

-- ---------------------------------------------------------------------------
-- 2. The payload schema: a supported subset of JSON Schema, and its validator.
-- ---------------------------------------------------------------------------
create function ouroboros.decision_value_violation(property jsonb, value jsonb, path text)
returns text
language plpgsql immutable parallel safe
as $$
declare
  kind      text := property ->> 'type';
  actual    text := coalesce(jsonb_typeof(value), 'missing');
  element   record;
  violation text;
begin
  -- The type first: every check below may then cast the value to what the type says it is.
  if kind = 'integer' then
    if actual <> 'number' then
      return format('%s must be an integer', path);
    elsif value::numeric <> trunc(value::numeric) then
      return format('%s must be an integer', path);
    end if;
  elsif kind is distinct from actual then
    return format('%s must be %s %s', path,
                  case when kind in ('array', 'integer') then 'an' else 'a' end, kind);
  end if;

  if property ? 'enum' and not (property -> 'enum') @> jsonb_build_array(value) then
    return format('%s must be one of %s', path, property -> 'enum');
  end if;

  if kind in ('integer', 'number') then
    if property ? 'minimum' and value::numeric < (property ->> 'minimum')::numeric then
      return format('%s must be at least %s', path, property ->> 'minimum');
    end if;
    if property ? 'maximum' and value::numeric > (property ->> 'maximum')::numeric then
      return format('%s must be at most %s', path, property ->> 'maximum');
    end if;
  elsif kind = 'string' then
    if property ? 'minLength' and char_length(value #>> '{}') < (property ->> 'minLength')::int then
      return format('%s must be at least %s characters', path, property ->> 'minLength');
    end if;
    if property ? 'maxLength' and char_length(value #>> '{}') > (property ->> 'maxLength')::int then
      return format('%s must be at most %s characters', path, property ->> 'maxLength');
    end if;
    if property ? 'pattern' and (value #>> '{}') !~ (property ->> 'pattern') then
      return format('%s must match %s', path, property ->> 'pattern');
    end if;
  elsif kind = 'array' then
    if property ? 'minItems' and jsonb_array_length(value) < (property ->> 'minItems')::int then
      return format('%s must hold at least %s items', path, property ->> 'minItems');
    end if;
    if property ? 'maxItems' and jsonb_array_length(value) > (property ->> 'maxItems')::int then
      return format('%s must hold at most %s items', path, property ->> 'maxItems');
    end if;
    for element in select e.value, e.ord from jsonb_array_elements(value) with ordinality as e(value, ord) loop
      violation := ouroboros.decision_value_violation(property -> 'items', element.value,
                                                      format('%s[%s]', path, element.ord - 1));
      if violation is not null then
        return violation;
      end if;
    end loop;
  end if;

  return null;
end;
$$;

comment on function ouroboros.decision_value_violation(jsonb, jsonb, text) is
  'Why a value fails one property of a decision payload schema (#457), as a sentence naming its path (payload.files must be an integer), or null when it passes. Assumes a property decision_payload_property_supported accepts.';

create function ouroboros.decision_payload_property_supported(property jsonb) returns boolean
language plpgsql immutable strict parallel safe
as $$
declare
  kind    text;
  allowed text[];
  bound   text;
begin
  if jsonb_typeof(property) <> 'object' then
    return false;
  end if;
  if jsonb_typeof(property -> 'type') is distinct from 'string' then
    return false;
  end if;

  kind := property ->> 'type';
  allowed := case kind
               when 'string'  then array['type', 'title', 'description', 'enum', 'minLength', 'maxLength', 'pattern']
               when 'integer' then array['type', 'title', 'description', 'enum', 'minimum', 'maximum']
               when 'number'  then array['type', 'title', 'description', 'enum', 'minimum', 'maximum']
               when 'boolean' then array['type', 'title', 'description']
               when 'array'   then array['type', 'title', 'description', 'items', 'minItems', 'maxItems']
             end;

  if allowed is null then
    return false;
  end if;
  if (property - allowed) <> '{}'::jsonb then
    return false;
  end if;

  if exists (select 1 from jsonb_each(property) a
              where a.key in ('title', 'description') and jsonb_typeof(a.value) <> 'string') then
    return false;
  end if;

  -- Lengths and item counts are non-negative integers; bounds are numbers; none inverted.
  foreach bound in array array['minLength', 'maxLength', 'minItems', 'maxItems'] loop
    if property ? bound then
      if jsonb_typeof(property -> bound) <> 'number' then
        return false;
      end if;
      if (property -> bound)::numeric <> trunc((property -> bound)::numeric)
         or (property -> bound)::numeric < 0 then
        return false;
      end if;
    end if;
  end loop;

  foreach bound in array array['minimum', 'maximum'] loop
    if property ? bound and jsonb_typeof(property -> bound) <> 'number' then
      return false;
    end if;
  end loop;

  if (property ? 'minimum' and property ? 'maximum'
      and (property -> 'minimum')::numeric > (property -> 'maximum')::numeric)
     or (property ? 'minLength' and property ? 'maxLength'
         and (property -> 'minLength')::numeric > (property -> 'maxLength')::numeric)
     or (property ? 'minItems' and property ? 'maxItems'
         and (property -> 'minItems')::numeric > (property -> 'maxItems')::numeric) then
    return false;
  end if;

  -- An enum is a non-empty list of distinct values of the declared type.
  if property ? 'enum' then
    if jsonb_typeof(property -> 'enum') <> 'array' then
      return false;
    end if;
    if jsonb_array_length(property -> 'enum') = 0
       or exists (select 1 from jsonb_array_elements(property -> 'enum') e
                   where ouroboros.decision_value_violation(jsonb_build_object('type', kind), e, 'enum') is not null)
       or (select count(*) <> count(distinct e) from jsonb_array_elements(property -> 'enum') e) then
      return false;
    end if;
  end if;

  -- A pattern is a string PostgreSQL can compile.
  if property ? 'pattern' then
    if jsonb_typeof(property -> 'pattern') <> 'string' then
      return false;
    end if;
    begin
      perform '' ~ (property ->> 'pattern');
    exception
      when invalid_regular_expression then
        return false;
    end;
  end if;

  -- An array's items are one scalar property.
  if kind = 'array' then
    if not property ? 'items' then
      return false;
    end if;
    if not ouroboros.decision_payload_property_supported(property -> 'items')
       or property #>> '{items,type}' = 'array' then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function ouroboros.decision_payload_property_supported(jsonb) is
  'Whether one property of a decision payload schema uses only the supported JSON Schema subset (#457): a type of string, integer, number, boolean or array, and only the keywords that mean something for it — enum, minLength/maxLength, pattern, minimum/maximum, items (scalar), minItems/maxItems, title, description — each well typed and none inverted.';

create function ouroboros.decision_payload_schema_supported(payload_schema jsonb) returns boolean
language plpgsql immutable strict parallel safe
as $$
begin
  if jsonb_typeof(payload_schema) <> 'object' then
    return false;
  end if;

  if (payload_schema - array['$schema', 'title', 'description', 'type', 'properties',
                             'required', 'additionalProperties']) <> '{}'::jsonb
     or payload_schema -> 'type' is distinct from '"object"'::jsonb
     or payload_schema -> 'additionalProperties' is distinct from 'false'::jsonb
     or jsonb_typeof(payload_schema -> 'properties') is distinct from 'object'
     or jsonb_typeof(payload_schema -> 'required') is distinct from 'array' then
    return false;
  end if;

  if exists (select 1 from jsonb_each(payload_schema) a
              where a.key in ('$schema', 'title', 'description') and jsonb_typeof(a.value) <> 'string') then
    return false;
  end if;

  if exists (select 1 from jsonb_each(payload_schema -> 'properties') p
              where p.key !~ '^[a-z][a-z0-9_]{0,62}$'
                 or not ouroboros.decision_payload_property_supported(p.value)) then
    return false;
  end if;

  if exists (select 1 from jsonb_array_elements(payload_schema -> 'required') r
              where jsonb_typeof(r) <> 'string') then
    return false;
  end if;

  if exists (select 1 from jsonb_array_elements_text(payload_schema -> 'required') r
              where not (payload_schema -> 'properties') ? r)
     or (select count(*) <> count(distinct r) from jsonb_array_elements_text(payload_schema -> 'required') r) then
    return false;
  end if;

  return true;
end;
$$;

comment on function ouroboros.decision_payload_schema_supported(jsonb) is
  'Whether a kind''s payload_schema is a closed JSON Schema object the write-time validator enforces in full (#457): type object, additionalProperties false, snake_case properties each decision_payload_property_supported, required naming declared properties once each. A keyword outside the subset is refused rather than ignored.';

create function ouroboros.decision_payload_violation(payload_schema jsonb, payload jsonb)
returns text
language plpgsql immutable strict parallel safe
as $$
declare
  field     text;
  violation text;
begin
  if jsonb_typeof(payload) <> 'object' then
    return 'the payload must be an object';
  end if;

  select r.name into field
    from jsonb_array_elements_text(payload_schema -> 'required') with ordinality as r(name, ord)
   where not payload ? r.name
   order by r.ord
   limit 1;
  if field is not null then
    return format('payload.%s is required', field);
  end if;

  select k into field
    from jsonb_object_keys(payload) as k
   where not (payload_schema -> 'properties') ? k
   order by k
   limit 1;
  if field is not null then
    return format('payload.%s is not a fact this kind declares', field);
  end if;

  for field in select k from jsonb_object_keys(payload) as k order by k loop
    violation := ouroboros.decision_value_violation(payload_schema -> 'properties' -> field,
                                                    payload -> field, 'payload.' || field);
    if violation is not null then
      return violation;
    end if;
  end loop;

  return null;
end;
$$;

comment on function ouroboros.decision_payload_violation(jsonb, jsonb) is
  'Why a payload fails its kind''s payload_schema (#457), as one sentence naming the first offending fact — a missing required fact, an undeclared one, or a value of the wrong type or out of bounds — or null when it conforms. What decision_items_payload_conforms raises with.';

-- ---------------------------------------------------------------------------
-- 3. Actions, resolution semantics and ref shape — the rest of a declaration.
-- ---------------------------------------------------------------------------
create function ouroboros.decision_actions_valid(actions jsonb) returns boolean
language plpgsql immutable strict parallel safe
as $$
declare
  fields constant text[] := array['id', 'label', 'style', 'required_role', 'consequence_text',
                                  'takes_note', 'handler_binding'];
  action jsonb;
begin
  if jsonb_typeof(actions) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(actions) not between 1 and 8 then
    return false;
  end if;

  for action in select a from jsonb_array_elements(actions) a loop
    if jsonb_typeof(action) <> 'object' then
      return false;
    end if;
    -- Exactly the seven fields, each of its own type.
    if not action ?& fields or (action - fields) <> '{}'::jsonb then
      return false;
    end if;
    if jsonb_typeof(action -> 'id') <> 'string'
       or jsonb_typeof(action -> 'label') <> 'string'
       or jsonb_typeof(action -> 'style') <> 'string'
       or jsonb_typeof(action -> 'required_role') <> 'string'
       or jsonb_typeof(action -> 'consequence_text') <> 'string'
       or jsonb_typeof(action -> 'takes_note') <> 'boolean'
       or jsonb_typeof(action -> 'handler_binding') <> 'string' then
      return false;
    end if;
    if action ->> 'id' !~ '^[a-z][a-z0-9_]{0,62}$'
       or btrim(action ->> 'label') = '' or length(action ->> 'label') > 80
       or action ->> 'style' not in ('primary', 'ghost', 'danger')
       or action ->> 'required_role' not in ('viewer', 'member', 'approver', 'admin', 'owner')
       or btrim(action ->> 'consequence_text') = '' or length(action ->> 'consequence_text') > 300
       or action ->> 'handler_binding' !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
       or length(action ->> 'handler_binding') > 128 then
      return false;
    end if;
    -- A link decides nothing, so it carries no note.
    if action ->> 'handler_binding' like 'navigate.%' and (action ->> 'takes_note')::boolean then
      return false;
    end if;
  end loop;

  -- Ids are unique, and at most one button is the primary.
  return (select count(*) = count(distinct a ->> 'id') from jsonb_array_elements(actions) a)
     and (select count(*) <= 1 from jsonb_array_elements(actions) a where a ->> 'style' = 'primary');
end;
$$;

comment on function ouroboros.decision_actions_valid(jsonb) is
  'Whether a kind''s action row is well formed (#457): 1–8 objects of exactly {id, label, style, required_role, consequence_text, takes_note, handler_binding}; ids unique slugs; style primary|ghost|danger with at most one primary; required_role viewer|member|approver|admin|owner; handler_binding <plane>.<operation>, where navigate.* is a link that takes no note.';

create function ouroboros.decision_resolution_valid(semantics jsonb, actions jsonb) returns boolean
language plpgsql immutable strict parallel safe
as $$
declare
  fields constant text[] := array['answered_by', 'closes_source', 'auto_resolvable'];
begin
  if jsonb_typeof(semantics) <> 'object' or jsonb_typeof(actions) <> 'array' then
    return false;
  end if;
  if not semantics ?& fields or (semantics - fields) <> '{}'::jsonb then
    return false;
  end if;
  if jsonb_typeof(semantics -> 'auto_resolvable') <> 'boolean'
     or jsonb_typeof(semantics -> 'answered_by') <> 'array'
     or jsonb_typeof(semantics -> 'closes_source') <> 'array' then
    return false;
  end if;
  if jsonb_array_length(semantics -> 'answered_by') = 0 then
    return false;
  end if;

  -- Every answer is one of this declaration's actions, named once, and not a link.
  if exists (select 1 from jsonb_array_elements(semantics -> 'answered_by') x
              where jsonb_typeof(x) <> 'string'
                 or not exists (select 1 from jsonb_array_elements(actions) a
                                 where jsonb_typeof(a) = 'object' and a -> 'id' = x
                                   and coalesce(a ->> 'handler_binding', '') not like 'navigate.%'))
     or (select count(*) <> count(distinct x) from jsonb_array_elements(semantics -> 'answered_by') x) then
    return false;
  end if;

  -- What closes the source is one of the answers, named once.
  if exists (select 1 from jsonb_array_elements(semantics -> 'closes_source') x
              where not (semantics -> 'answered_by') @> jsonb_build_array(x))
     or (select count(*) <> count(distinct x) from jsonb_array_elements(semantics -> 'closes_source') x) then
    return false;
  end if;

  return true;
end;
$$;

comment on function ouroboros.decision_resolution_valid(jsonb, jsonb) is
  'Whether a kind''s resolution_semantics is exactly {answered_by, closes_source, auto_resolvable} (#457): answered_by names at least one of the declaration''s own actions and never a navigate.* link, closes_source is a subset of answered_by, auto_resolvable is a boolean.';

create function ouroboros.decision_ref_shape_valid(shape jsonb, payload_schema jsonb) returns boolean
language plpgsql immutable strict parallel safe
as $$
declare
  fields constant text[] := array['required', 'optional', 'tags'];
  types  jsonb;
begin
  if jsonb_typeof(shape) <> 'object' then
    return false;
  end if;
  if not shape ?& fields or (shape - fields) <> '{}'::jsonb then
    return false;
  end if;
  if jsonb_typeof(shape -> 'required') <> 'array'
     or jsonb_typeof(shape -> 'optional') <> 'array'
     or jsonb_typeof(shape -> 'tags') <> 'array' then
    return false;
  end if;

  -- The four typed refs, each listed once across required and optional.
  types := (shape -> 'required') || (shape -> 'optional');
  if exists (select 1 from jsonb_array_elements(types) t
              where t not in ('"run"'::jsonb, '"pr"'::jsonb, '"ticket"'::jsonb, '"path"'::jsonb))
     or (select count(*) <> count(distinct t) from jsonb_array_elements(types) t) then
    return false;
  end if;

  -- At most four plain tags, each a short template over required scalar facts, or a literal.
  if jsonb_array_length(shape -> 'tags') > 4 then
    return false;
  end if;
  if exists (select 1 from jsonb_array_elements(shape -> 'tags') g where jsonb_typeof(g) <> 'string') then
    return false;
  end if;
  if exists (select 1 from jsonb_array_elements_text(shape -> 'tags') g
              where btrim(g) = '' or length(g) > 60
                 or not ouroboros.decision_template_slotted(g, payload_schema)) then
    return false;
  end if;

  return true;
end;
$$;

comment on function ouroboros.decision_ref_shape_valid(jsonb, jsonb) is
  'Whether a kind''s ref_shape is exactly {required, optional, tags} (#457): required and optional list run|pr|ticket|path, each type at most once across both; tags are at most four short templates over the payload''s required scalar facts, or literals — the card''s unlinked tags (refactor, verification).';

-- ---------------------------------------------------------------------------
-- 4. decision_kinds — the versioned declarations.
-- ---------------------------------------------------------------------------
create table ouroboros.decision_kinds (
  -- The kind. The nine MVP kinds, the five the amendments named, or custom:<slug>.
  kind_id              text        not null
                                   constraint decision_kinds_kind_id_known
                                     check (kind_id in ('merge_approval', 'protected_path_allow_once',
                                                        'claim_waiver', 'plan_sign_off', 'fact_review',
                                                        'run_needs_human', 'split_approval',
                                                        'resize_review', 'spend_approval',
                                                        'regression_drift_detected', 'bisect_complete',
                                                        'research_brief_ready',
                                                        'snippet_install_approval',
                                                        'snippet_version_yanked')
                                            or kind_id ~ '^custom:[a-z0-9][a-z0-9_-]{0,62}$'),

  -- 1, 2, 3 … dense per kind (decision_kinds_next_version). Items pin it.
  version              integer     not null
                                   constraint decision_kinds_version_positive check (version >= 1),

  severity_default     text        not null
                                   constraint decision_kinds_severity_default
                                     check (severity_default in ('err', 'warn', 'info')),

  -- "Approve merge for a {pr_kind} PR?" — see the header for the slot rule.
  question_template    text        not null
                                   constraint decision_kinds_question_present
                                     check (btrim(question_template) <> '' and length(question_template) <= 200),

  why_template         text        not null
                                   constraint decision_kinds_why_present
                                     check (btrim(why_template) <> '' and length(why_template) <= 1000),

  payload_schema       jsonb       not null
                                   constraint decision_kinds_payload_schema_supported
                                     check (ouroboros.decision_payload_schema_supported(payload_schema)),

  actions              jsonb       not null
                                   constraint decision_kinds_actions_valid
                                     check (ouroboros.decision_actions_valid(actions)),

  resolution_semantics jsonb       not null,

  ref_shape            jsonb       not null,

  -- How long an unanswered item waits before it escalates (#538). Thirty minutes is mockup 19's.
  escalation_window    interval    not null default interval '30 minutes'
                                   constraint decision_kinds_escalation_window_positive
                                     check (escalation_window > interval '0'
                                            and escalation_window <= interval '7 days'),

  -- Actions must deep-link to a session confirmation rather than complete from a channel (X5).
  merge_class          boolean     not null default false,

  created_at           timestamptz not null default now(),

  constraint decision_kinds_pkey primary key (kind_id, version),

  constraint decision_kinds_question_slotted
    check (ouroboros.decision_template_slotted(question_template, payload_schema)),

  constraint decision_kinds_why_slotted
    check (ouroboros.decision_template_slotted(why_template, payload_schema)),

  constraint decision_kinds_resolution_valid
    check (ouroboros.decision_resolution_valid(resolution_semantics, actions)),

  constraint decision_kinds_ref_shape_valid
    check (ouroboros.decision_ref_shape_valid(ref_shape, payload_schema)),

  -- A human merge decision is a human merge decision, whatever a later policy says (BP.4).
  constraint decision_kinds_merge_approval_is_merge_class
    check (kind_id <> 'merge_approval' or merge_class),

  constraint decision_kinds_merge_class_not_auto_resolvable
    check (not merge_class or resolution_semantics -> 'auto_resolvable' = 'false'::jsonb)
);

comment on table ouroboros.decision_kinds is
  'Versioned decision-kind declarations (#457, BM.1, decision X1): a kind owns its payload schema, severity default, question/why templates, ref shape and tags, actions, resolution semantics, escalation window and merge-class marker. Immutable — an UPDATE or DELETE is refused for every role — so an item pinned to a version renders and resolves as it was filed. New emissions use decision_kinds_current.';
comment on column ouroboros.decision_kinds.kind_id is
  'merge_approval, protected_path_allow_once, claim_waiver, plan_sign_off, fact_review, run_needs_human, split_approval, resize_review, spend_approval (X1); regression_drift_detected, bisect_complete, research_brief_ready (mockup 22); snippet_install_approval, snippet_version_yanked (mockup 23); or custom:<slug> for a registered extension.';
comment on column ouroboros.decision_kinds.version is
  'The declaration''s version — 1, 2, 3 … dense per kind. decision_items.kind_version pins it.';
comment on column ouroboros.decision_kinds.question_template is
  'The card''s question, composed from facts (X2): literal text and {slot}s, each a required scalar property of payload_schema.';
comment on column ouroboros.decision_kinds.why_template is
  'The card''s why paragraph, composed from facts (X2) under the same slot rule as the question.';
comment on column ouroboros.decision_kinds.payload_schema is
  'JSON Schema for the item''s facts — the supported subset in V093''s header, closed (additionalProperties false). Validated at write time by decision_items_payload_conforms.';
comment on column ouroboros.decision_kinds.actions is
  'The ordered action row: [{id, label, style, required_role, consequence_text, takes_note, handler_binding}]. handler_binding navigate.* is a link that decides nothing.';
comment on column ouroboros.decision_kinds.resolution_semantics is
  '{answered_by, closes_source, auto_resolvable}: which actions answer the item, which of those settle its source, and whether a policy may answer it. Never auto-resolvable for a merge-class kind.';
comment on column ouroboros.decision_kinds.ref_shape is
  '{required, optional, tags}: which typed refs (run|pr|ticket|path) an item must and may carry, and the card''s unlinked tags as templates over the payload.';
comment on column ouroboros.decision_kinds.escalation_window is
  'How long an unanswered item waits before it escalates — #538''s timers use it and #536 renders the countdown from it; nothing stores the countdown. Per-workspace overrides are #538''s.';
comment on column ouroboros.decision_kinds.merge_class is
  'Merge-class: actions deep-link to a session confirmation instead of completing from a channel (X5). Always true for merge_approval; a merge-class kind is never auto-resolvable; a later version may not drop it.';

-- ---------------------------------------------------------------------------
-- Numbering: a declaration is exactly one version above the highest (V029/V092's rule).
-- ---------------------------------------------------------------------------
create function ouroboros.decision_kind_version_next() returns trigger
language plpgsql
as $$
declare
  highest integer;
begin
  -- Below 1 is the column's complaint, not this one's.
  if new.version < 1 then
    return new;
  end if;

  select max(version) into highest from ouroboros.decision_kinds where kind_id = new.kind_id;

  if new.version is distinct from coalesce(highest, 0) + 1 then
    raise exception
      'the next version of decision kind % is v%, not v% (highest declared: %)',
      new.kind_id, coalesce(highest, 0) + 1, new.version, coalesce(highest::text, 'none')
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.decision_kind_version_next() is
  'BEFORE INSERT trigger for decision_kinds (#457): a declaration is exactly one version above the highest its kind has, and the first is 1. Refuses rather than assigns; two racing registrations both compute max + 1 and the primary key lets one commit. Raises class 23 naming the trigger.';

create trigger decision_kinds_next_version
  before insert on ouroboros.decision_kinds
  for each row execute function ouroboros.decision_kind_version_next();

-- ---------------------------------------------------------------------------
-- No loosening: once merge-class or not auto-resolvable, every later version stays so.
-- ---------------------------------------------------------------------------
create function ouroboros.decision_kinds_no_loosening() returns trigger
language plpgsql
as $$
begin
  if not new.merge_class
     and exists (select 1 from ouroboros.decision_kinds
                  where kind_id = new.kind_id and version < new.version and merge_class) then
    raise exception 'decision kind % is merge-class, and v% cannot drop it', new.kind_id, new.version
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.resolution_semantics -> 'auto_resolvable' = 'true'::jsonb
     and exists (select 1 from ouroboros.decision_kinds
                  where kind_id = new.kind_id and version < new.version
                    and resolution_semantics -> 'auto_resolvable' = 'false'::jsonb) then
    raise exception 'decision kind % is not auto-resolvable, and v% cannot make it so',
      new.kind_id, new.version
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.decision_kinds_no_loosening() is
  'BEFORE INSERT trigger for decision_kinds (#457): a kind marked merge-class or non-auto-resolvable in any version stays so in every later one, so no new declaration — and no policy reading it (BP.4) — can turn a human decision into an automatic one. Raises class 23 naming the trigger.';

create trigger decision_kinds_no_loosening
  before insert on ouroboros.decision_kinds
  for each row execute function ouroboros.decision_kinds_no_loosening();

-- ---------------------------------------------------------------------------
-- Immutable, in the database rather than in the grants (#132's pattern).
-- ---------------------------------------------------------------------------
create function ouroboros.decision_kinds_refuse_change() returns trigger
language plpgsql
as $$
begin
  raise exception
    'ouroboros.decision_kinds is immutable: v% of decision kind % cannot be %',
    old.version, old.kind_id, case tg_op when 'UPDATE' then 'revised' else 'deleted' end
    using errcode = 'restrict_violation', constraint = tg_name,
          hint = 'Declare the next version instead. See V093__decision_kinds_items.sql (#457).';
end;
$$;

comment on function ouroboros.decision_kinds_refuse_change() is
  'Refuses every UPDATE and DELETE of a decision-kind declaration (#457), for any role including the owner: open items pin a version, and that version must render and resolve as it was filed. Raises class 23 naming the trigger.';

create trigger decision_kinds_immutable
  before update or delete on ouroboros.decision_kinds
  for each row execute function ouroboros.decision_kinds_refuse_change();

-- The declaration new emissions use: each kind's newest version.
create view ouroboros.decision_kinds_current
  with (security_invoker = true) as
select distinct on (kind_id) *
  from ouroboros.decision_kinds
 order by kind_id, version desc;

comment on view ouroboros.decision_kinds_current is
  'Each decision kind''s newest version — the declaration a new emission pins (#457). Items already filed keep the version they pinned.';

-- ---------------------------------------------------------------------------
-- 5. Refs: shape, and resolution in the item's own workspace.
-- ---------------------------------------------------------------------------
create function ouroboros.decision_ref_path_valid(path text) returns boolean
language sql immutable strict parallel safe
as $$
  -- V067's protected-path grammar: non-blank, relative, forward slashes, no `..` segment.
  select btrim(path) = path
     and path <> ''
     and length(path) <= 1024
     and left(path, 1) <> '/'
     and strpos(path, '\') = 0
     and path !~ '(^|/)\.\.(/|$)'
     and path !~ '[[:cntrl:]]'
$$;

comment on function ouroboros.decision_ref_path_valid(text) is
  'Whether a path ref is repository-relative in V067''s grammar (#457): non-blank and trimmed, no leading slash or backslash, no .. segment, no control character, at most 1024 characters.';

create function ouroboros.decision_refs_well_formed(refs jsonb) returns boolean
language plpgsql immutable strict parallel safe
as $$
declare
  fields constant text[] := array['type', 'id', 'label'];
  ref    jsonb;
begin
  if jsonb_typeof(refs) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(refs) > 16 then
    return false;
  end if;

  for ref in select r from jsonb_array_elements(refs) r loop
    if jsonb_typeof(ref) <> 'object' then
      return false;
    end if;
    if not ref ?& fields or (ref - fields) <> '{}'::jsonb then
      return false;
    end if;
    if jsonb_typeof(ref -> 'type') <> 'string'
       or jsonb_typeof(ref -> 'id') <> 'string'
       or jsonb_typeof(ref -> 'label') <> 'string' then
      return false;
    end if;
    if ref ->> 'type' not in ('run', 'pr', 'ticket', 'path')
       or btrim(ref ->> 'label') = '' or length(ref ->> 'label') > 120 then
      return false;
    end if;
    if ref ->> 'type' = 'path' then
      if not ouroboros.decision_ref_path_valid(ref ->> 'id') then
        return false;
      end if;
    elsif ref ->> 'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return false;
    end if;
  end loop;

  -- No ref listed twice.
  return (select count(*) = count(distinct (r ->> 'type') || ':' || (r ->> 'id'))
            from jsonb_array_elements(refs) r);
end;
$$;

comment on function ouroboros.decision_refs_well_formed(jsonb) is
  'Whether an item''s refs are typed canonical references (#457): an array of at most 16 {type, id, label}, type run|pr|ticket|path, id a lower-case uuid (a repository-relative path for path), label the tag''s non-blank text, no ref listed twice. No provider URL has anywhere to go.';

create function ouroboros.decision_ref_resolves(p_organization_id text, p_ref jsonb)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
  -- A case, not an or: only a shaped ref may reach the uuid casts.
  select case
           when not ouroboros.decision_refs_well_formed(jsonb_build_array(p_ref)) then false
           when p_ref ->> 'type' = 'run' then exists (
             select 1 from ouroboros.runs r
              where r.id = (p_ref ->> 'id')::uuid and r.organization_id = p_organization_id)
           when p_ref ->> 'type' = 'pr' then exists (
             select 1 from ouroboros.pull_requests p
              where p.id = (p_ref ->> 'id')::uuid and p.organization_id = p_organization_id)
           when p_ref ->> 'type' = 'ticket' then exists (
             select 1 from ouroboros.tickets t
              where t.id = (p_ref ->> 'id')::uuid and t.organization_id = p_organization_id)
           -- A path is the file a run asked to touch, possibly one it was refused: shape alone.
           when p_ref ->> 'type' = 'path' then true
           else false
         end
$$;

comment on function ouroboros.decision_ref_resolves(text, jsonb) is
  'True when a decision ref names a real row of the given workspace (#457): run → runs, pr → pull_requests (AX.1, provider-neutral), ticket → tickets (Q.1, canonical); a path resolves by shape alone. Runs as its owner because the service role cannot read runs or tickets (#353''s precedent), search_path pinned, executable by the service only.';

revoke execute on function ouroboros.decision_ref_resolves(text, jsonb) from public;

-- ---------------------------------------------------------------------------
-- 6. decision_items — the questions asked of a workspace.
-- ---------------------------------------------------------------------------
create table ouroboros.decision_items (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace asked. Cascades: a deleted (or purged, #489) workspace takes its inbox with it.
  organization_id  text        not null
                               references ouroboros.organization ("id") on delete cascade,

  -- The declaration this item was filed against, pinned (decision_items_pinned).
  kind_id          text        not null,
  kind_version     integer     not null,

  -- Facts only, validated against the pinned payload_schema (decision_items_payload_conforms).
  payload          jsonb       not null
                               constraint decision_items_payload_object
                                 check (jsonb_typeof(payload) = 'object'),

  -- Defaults to the kind's severity_default (decision_items_default_severity); overridable.
  severity         text        not null
                               constraint decision_items_severity
                                 check (severity in ('err', 'warn', 'info')),

  status           text        not null default 'open'
                               constraint decision_items_status
                                 check (status in ('open', 'snoozed', 'resolved', 'expired')),

  -- Typed canonical refs, in tag order. Resolved at write time (decision_items_refs_resolve).
  refs             jsonb       not null default '[]'::jsonb
                               constraint decision_items_refs_well_formed
                                 check (ouroboros.decision_refs_well_formed(refs)),

  -- The plane that filed it (`guardrails`, `pr.gates`) and the plane's own reference for the
  -- thing being asked about (`run:<id>:path:boot/rollback_flag.c`). No colon in a plane, so the
  -- pair joins into an unambiguous key.
  emitted_by       text        not null
                               constraint decision_items_emitted_by_plane
                                 check (emitted_by ~ '^[a-z][a-z0-9_.-]{0,62}$'),

  source_ref       text        not null
                               constraint decision_items_source_ref_present
                                 check (btrim(source_ref) = source_ref and source_ref <> ''
                                        and length(source_ref) <= 500),

  -- (plane, source_ref) as one value: unique per workspace, so an emitter cannot double-file.
  idempotency_key  text        generated always as (emitted_by || ':' || source_ref) stored,

  -- The card's age.
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint decision_items_kind_fk
    foreign key (kind_id, kind_version) references ouroboros.decision_kinds (kind_id, version),

  constraint decision_items_idempotency_key unique (organization_id, idempotency_key)
);

comment on table ouroboros.decision_items is
  'Typed decision items (#457, BM.1): one question asked of a workspace, filed against a pinned decision_kinds version. Carries facts (payload, schema-validated at write time), severity, status, typed canonical refs that resolve in its own workspace, and the emitter''s (plane, source_ref) idempotency key. Filed through decision_item_emit; rendered by decision_items_rendered.';
comment on column ouroboros.decision_items.kind_version is
  'The declaration version this item was filed against. Never changes: the item renders and resolves at it after the kind is bumped.';
comment on column ouroboros.decision_items.payload is
  'The facts the kind''s templates compose the question and why from (X2) — {checks_passed: 14, checks_total: 14, …}. Never prose written by the emitter.';
comment on column ouroboros.decision_items.severity is
  'err|warn|info — the card''s left border. Defaults to the kind''s severity_default when not given.';
comment on column ouroboros.decision_items.status is
  'open|snoozed|resolved|expired. The pill counts open; resolutions and snooze mechanics are BM.2''s (#458).';
comment on column ouroboros.decision_items.refs is
  'Ordered typed refs [{type: run|pr|ticket|path, id, label}] — canonical rows (runs, pull_requests, tickets) of this workspace, or a repository-relative path. Never a provider URL.';
comment on column ouroboros.decision_items.emitted_by is
  'The plane that filed the item — guardrails, pr.gates, planning — a slug with no colon.';
comment on column ouroboros.decision_items.source_ref is
  'The plane''s own reference for what is being asked about, e.g. run:<id>:path:boot/rollback_flag.c. With emitted_by, the idempotency key.';
comment on column ouroboros.decision_items.idempotency_key is
  'emitted_by:source_ref, generated. Unique per workspace (decision_items_idempotency_key): emitting twice yields one row.';

create trigger decision_items_touch_updated_at
  before update on ouroboros.decision_items
  for each row execute function ouroboros.touch_updated_at();

-- The queue: a workspace's items by status, newest first.
create index decision_items_queue_idx
  on ouroboros.decision_items (organization_id, status, created_at desc);

-- The pill: open items only, so the count is an index-only walk of what it counts.
create index decision_items_open_idx
  on ouroboros.decision_items (organization_id)
  where status in ('open');

-- Reverse lookup from a run, PR, ticket or path: refs @> '[{"type": "pr", "id": "…"}]'.
create index decision_items_refs_idx
  on ouroboros.decision_items using gin (refs jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- The write-time rules, one trigger each so each can be named and probed.
--
-- BEFORE triggers run ahead of the table's CHECKs, so each passes a row whose own shape is wrong
-- through to the CHECK that is about it, and a row naming no declaration through to the key.
-- ---------------------------------------------------------------------------
create function ouroboros.decision_items_default_severity() returns trigger
language plpgsql
as $$
begin
  if new.severity is null then
    select k.severity_default into new.severity
      from ouroboros.decision_kinds k
     where k.kind_id = new.kind_id and k.version = new.kind_version;
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_items_default_severity() is
  'BEFORE INSERT trigger for decision_items (#457): an item filed without a severity takes its pinned kind''s severity_default.';

create trigger decision_items_default_severity
  before insert on ouroboros.decision_items
  for each row execute function ouroboros.decision_items_default_severity();

create function ouroboros.decision_items_payload_conforms() returns trigger
language plpgsql
as $$
declare
  schema_doc jsonb;
  violation  text;
begin
  if jsonb_typeof(new.payload) is distinct from 'object' then
    return new;
  end if;

  select k.payload_schema into schema_doc
    from ouroboros.decision_kinds k
   where k.kind_id = new.kind_id and k.version = new.kind_version;

  if schema_doc is null then
    return new;
  end if;

  violation := ouroboros.decision_payload_violation(schema_doc, new.payload);

  if violation is not null then
    raise exception 'a % v% payload is refused: %', new.kind_id, new.kind_version, violation
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.decision_items_payload_conforms() is
  'BEFORE INSERT OR UPDATE trigger for decision_items (#457, X2): the payload must conform to the pinned kind''s payload_schema — a rejected emission, never a malformed card. Raises class 23 naming the trigger, with the first offending fact in the message.';

create trigger decision_items_payload_conforms
  before insert or update of payload, kind_id, kind_version on ouroboros.decision_items
  for each row execute function ouroboros.decision_items_payload_conforms();

create function ouroboros.decision_items_ref_shape() returns trigger
language plpgsql
as $$
declare
  shape   jsonb;
  missing text;
  extra   text;
begin
  if not coalesce(ouroboros.decision_refs_well_formed(new.refs), false) then
    return new;
  end if;

  select k.ref_shape into shape
    from ouroboros.decision_kinds k
   where k.kind_id = new.kind_id and k.version = new.kind_version;

  if shape is null then
    return new;
  end if;

  select t into missing
    from jsonb_array_elements_text(shape -> 'required') t
   where not new.refs @> jsonb_build_array(jsonb_build_object('type', t))
   limit 1;

  if missing is not null then
    raise exception 'a % item must carry a % ref', new.kind_id, missing
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  select r ->> 'type' into extra
    from jsonb_array_elements(new.refs) r
   where not ((shape -> 'required') || (shape -> 'optional')) ? (r ->> 'type')
   limit 1;

  if extra is not null then
    raise exception 'a % item carries no % ref', new.kind_id, extra
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.decision_items_ref_shape() is
  'BEFORE INSERT OR UPDATE trigger for decision_items (#457): the refs carry every type the pinned kind''s ref_shape requires and no type it neither requires nor allows. Raises class 23 naming the trigger.';

create trigger decision_items_ref_shape
  before insert or update of refs, kind_id, kind_version on ouroboros.decision_items
  for each row execute function ouroboros.decision_items_ref_shape();

create function ouroboros.decision_items_refs_resolve() returns trigger
language plpgsql
as $$
declare
  dangling jsonb;
begin
  if not coalesce(ouroboros.decision_refs_well_formed(new.refs), false) then
    return new;
  end if;

  select r into dangling
    from jsonb_array_elements(new.refs) r
   where not ouroboros.decision_ref_resolves(new.organization_id, r)
   limit 1;

  if dangling is not null then
    raise exception 'the % ref % (%) names nothing in workspace %',
      dangling ->> 'type', dangling ->> 'id', dangling ->> 'label', new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.decision_items_refs_resolve() is
  'BEFORE INSERT OR UPDATE trigger for decision_items (#457): every run, pr and ticket ref names a row of the item''s own workspace (decision_ref_resolves) — a card never links to another workspace''s loop or to nothing. Raises class 23 naming the trigger.';

create trigger decision_items_refs_resolve
  before insert or update of refs, organization_id on ouroboros.decision_items
  for each row execute function ouroboros.decision_items_refs_resolve();

create function ouroboros.decision_items_refuse_repin() returns trigger
language plpgsql
as $$
begin
  if row(new.organization_id, new.kind_id, new.kind_version, new.emitted_by, new.source_ref, new.created_at)
     is distinct from
     row(old.organization_id, old.kind_id, old.kind_version, old.emitted_by, old.source_ref, old.created_at)
  then
    raise exception
      'decision item % is pinned: its workspace, kind, kind version, emitter, source and age never change',
      old.id
      using errcode = 'check_violation', constraint = tg_name,
            hint = 'A different question is a different item. See V093__decision_kinds_items.sql (#457).';
  end if;
  return new;
end;
$$;

comment on function ouroboros.decision_items_refuse_repin() is
  'BEFORE UPDATE trigger for decision_items (#457): an item''s workspace, kind and pinned version, emitter, source_ref and created_at are fixed at filing — a kind bump never re-pins an open item, and its age is never reset. Raises class 23 naming the trigger.';

create trigger decision_items_pinned
  before update on ouroboros.decision_items
  for each row execute function ouroboros.decision_items_refuse_repin();

-- ---------------------------------------------------------------------------
-- 7. The emission: an upsert on (workspace, plane, source_ref).
-- ---------------------------------------------------------------------------
create function ouroboros.decision_item_emit(
  p_organization_id text,
  p_kind_id         text,
  p_payload         jsonb,
  p_refs            jsonb,
  p_emitted_by      text,
  p_source_ref      text,
  p_severity        text default null
) returns uuid
language plpgsql
as $$
declare
  pinned  integer;
  item_id uuid;
begin
  select version into pinned from ouroboros.decision_kinds_current where kind_id = p_kind_id;

  if pinned is null then
    raise exception 'no decision kind % is declared', p_kind_id
      using errcode = 'foreign_key_violation', constraint = 'decision_items_kind_fk';
  end if;

  -- A repeat while the item is still asking refreshes its facts and refs — never its pinned
  -- version, its age or its key. A repeat after it was answered changes nothing.
  insert into ouroboros.decision_items
    (organization_id, kind_id, kind_version, payload, severity, refs, emitted_by, source_ref)
  values
    (p_organization_id, p_kind_id, pinned, p_payload, p_severity, p_refs, p_emitted_by, p_source_ref)
  on conflict (organization_id, idempotency_key) do update
     set payload  = excluded.payload,
         refs     = excluded.refs,
         severity = coalesce(p_severity, ouroboros.decision_items.severity)
   where ouroboros.decision_items.status in ('open', 'snoozed')
  returning id into item_id;

  if item_id is null then
    select id into item_id
      from ouroboros.decision_items
     where organization_id = p_organization_id
       and idempotency_key = p_emitted_by || ':' || p_source_ref;
  end if;

  return item_id;
end;
$$;

comment on function ouroboros.decision_item_emit(text, text, jsonb, jsonb, text, text, text) is
  'File a decision (#457): pins the kind''s newest version and inserts, or — when the workspace already has an item with this (plane, source_ref) — refreshes that item''s payload and refs while it is open or snoozed and leaves a resolved or expired one alone. Returns the item id either way: one row per key, however often a plane emits. Payload, refs and severity are held by the table''s rules. Invoker''s rights.';

-- ---------------------------------------------------------------------------
-- 8. Every item, rendered at the version it pinned.
-- ---------------------------------------------------------------------------
create view ouroboros.decision_items_rendered
  with (security_invoker = true) as
select i.id,
       i.organization_id,
       i.kind_id,
       i.kind_version,
       i.severity,
       i.status,
       ouroboros.decision_template_render(k.question_template, i.payload) as question,
       ouroboros.decision_template_render(k.why_template, i.payload)      as why,
       i.refs,
       array(select ouroboros.decision_template_render(g.tag, i.payload)
               from jsonb_array_elements_text(k.ref_shape -> 'tags') with ordinality as g(tag, ord)
              order by g.ord)                                             as tags,
       k.actions,
       k.merge_class,
       i.created_at,
       i.updated_at
  from ouroboros.decision_items i
  join ouroboros.decision_kinds k
    on k.kind_id = i.kind_id and k.version = i.kind_version;

comment on view ouroboros.decision_items_rendered is
  'Every decision item as its card reads (#457): question, why and tags composed from its facts by the templates of the version it pinned — so a kind bump never rewrites an open card — with its refs, that version''s actions and the merge-class marker.';

-- ---------------------------------------------------------------------------
-- 9. The three declarations mockup 16 fixes word for word.
--
-- Each renders the mockup's exact question and why from the payloads in constraints.sql's V093
-- section:
--
--   merge_approval            {pr_kind: refactor, policy_label: refactor, checks_passed: 14,
--                              checks_total: 14, matrix_state: all ✓, added: 214, removed: 180,
--                              files: 6}
--   protected_path_allow_once {subject: The OTA rollback fix, edit_summary: add one line,
--                              path: boot/rollback_flag.c, diff_lines: 3}
--   claim_waiver              {claim: Flake must not reappear across temperature range,
--                              missing_capability: thermal chamber}
-- ---------------------------------------------------------------------------
insert into ouroboros.decision_kinds
  (kind_id, version, severity_default, question_template, why_template, payload_schema, actions,
   resolution_semantics, ref_shape, escalation_window, merge_class)
values
  ('merge_approval', 1, 'err',
   'Approve merge for a {pr_kind} PR?',
   'Policy: anything labeled {policy_label} needs a human. {checks_passed}/{checks_total} checks green, verification matrix {matrix_state}, +{added} −{removed} across {files} files.',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "merge_approval v1",
      "type": "object",
      "properties": {
        "pr_kind":       {"type": "string", "pattern": "^[a-z][a-z0-9-]*$", "maxLength": 40,
                          "description": "The PR''s kind label, as the question names it."},
        "policy_label":  {"type": "string", "minLength": 1, "maxLength": 64,
                          "description": "The label the human-review policy matched (#480 human_review)."},
        "checks_passed": {"type": "integer", "minimum": 0},
        "checks_total":  {"type": "integer", "minimum": 0},
        "matrix_state":  {"type": "string", "enum": ["all ✓", "incomplete", "failing"],
                          "description": "The verification matrix''s state."},
        "added":         {"type": "integer", "minimum": 0},
        "removed":       {"type": "integer", "minimum": 0},
        "files":         {"type": "integer", "minimum": 0}
      },
      "required": ["pr_kind", "policy_label", "checks_passed", "checks_total", "matrix_state",
                   "added", "removed", "files"],
      "additionalProperties": false
    }',
   '[
      {"id": "approve_merge", "label": "Approve & merge", "style": "primary",
       "required_role": "approver",
       "consequence_text": "Records your approval and merges the PR by its merge plan; the loop resumes.",
       "takes_note": false, "handler_binding": "pr.approve_and_merge"},
      {"id": "open_verification", "label": "Open PR verification →", "style": "ghost",
       "required_role": "viewer",
       "consequence_text": "Opens the PR''s verification page; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.pr_verification"},
      {"id": "return_to_loop", "label": "Return to loop with note", "style": "ghost",
       "required_role": "member",
       "consequence_text": "Sends the loop back with your note as steering; the PR stays unmerged.",
       "takes_note": true, "handler_binding": "run.return_with_note"}
    ]',
   '{"answered_by": ["approve_merge", "return_to_loop"], "closes_source": ["approve_merge"],
     "auto_resolvable": false}',
   '{"required": ["run", "pr"], "optional": ["ticket"], "tags": ["{pr_kind}"]}',
   interval '30 minutes', true),

  ('protected_path_allow_once', 1, 'warn',
   'Allow a one-time edit to a protected path?',
   '{subject} wants to {edit_summary} to {path} — a protected path. Diff is {diff_lines} lines, shown in the run console.',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "protected_path_allow_once v1",
      "type": "object",
      "properties": {
        "subject":      {"type": "string", "minLength": 1, "maxLength": 120,
                         "description": "The work asking, as its ticket names it."},
        "edit_summary": {"type": "string", "minLength": 1, "maxLength": 80,
                         "description": "What the edit does to the file, from the guardrail''s diff."},
        "path":         {"type": "string", "minLength": 1, "maxLength": 1024,
                         "description": "The protected path, repository-relative — the path ref''s id."},
        "diff_lines":   {"type": "integer", "minimum": 1}
      },
      "required": ["subject", "edit_summary", "path", "diff_lines"],
      "additionalProperties": false
    }',
   '[
      {"id": "allow_once", "label": "Allow once", "style": "primary",
       "required_role": "approver",
       "consequence_text": "Grants a single-use exception for this path on this run; the run resumes.",
       "takes_note": false, "handler_binding": "guardrail.allow_once"},
      {"id": "view_diff", "label": "View diff →", "style": "ghost",
       "required_role": "viewer",
       "consequence_text": "Opens the diff in the run console; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.run_diff"},
      {"id": "deny", "label": "Deny", "style": "ghost",
       "required_role": "approver",
       "consequence_text": "Returns the loop with the path still protected.",
       "takes_note": false, "handler_binding": "run.deny_protected_path"},
      {"id": "edit_protected_paths", "label": "Edit protected paths →", "style": "ghost",
       "required_role": "admin",
       "consequence_text": "Opens the protected-path settings; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.protected_paths_settings"}
    ]',
   '{"answered_by": ["allow_once", "deny"], "closes_source": ["allow_once", "deny"],
     "auto_resolvable": false}',
   '{"required": ["run", "path"], "optional": ["ticket"], "tags": []}',
   interval '30 minutes', false),

  ('claim_waiver', 1, 'warn',
   'Waive a claim the bench can''t verify?',
   '“{claim}” — the rig has no {missing_capability}. Waiving annotates the PR publicly.',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "claim_waiver v1",
      "type": "object",
      "properties": {
        "claim":              {"type": "string", "minLength": 1, "maxLength": 300,
                               "description": "The acceptance criterion''s text, as the PR states it."},
        "missing_capability": {"type": "string", "minLength": 1, "maxLength": 80,
                               "description": "The bench capability the claim needs and the rig lacks."}
      },
      "required": ["claim", "missing_capability"],
      "additionalProperties": false
    }',
   '[
      {"id": "waive_annotate", "label": "Waive & annotate", "style": "primary",
       "required_role": "approver",
       "consequence_text": "Waives the claim with your reason and annotates the PR publicly.",
       "takes_note": true, "handler_binding": "pr.waive_criterion"},
      {"id": "require_bench_upgrade", "label": "Require bench upgrade", "style": "ghost",
       "required_role": "approver",
       "consequence_text": "Drafts a bench-gap ticket and leaves the claim unverified.",
       "takes_note": false, "handler_binding": "planning.require_bench_upgrade"},
      {"id": "see_evidence", "label": "See evidence →", "style": "ghost",
       "required_role": "viewer",
       "consequence_text": "Opens the claim''s evidence on the PR; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.pr_evidence"}
    ]',
   '{"answered_by": ["waive_annotate", "require_bench_upgrade"], "closes_source": ["waive_annotate"],
     "auto_resolvable": false}',
   '{"required": ["pr"], "optional": ["run", "ticket"], "tags": ["verification"]}',
   interval '30 minutes', false);

-- ---------------------------------------------------------------------------
-- The service role's grants. Declarations are appended (BN.1 registers versions), never revised;
-- items are filed and moved through their statuses, never deleted (the workspace's cascade is).
-- ---------------------------------------------------------------------------
grant select, insert on ouroboros.decision_kinds to ouroboros_app;
grant select on ouroboros.decision_kinds_current to ouroboros_app;
grant select, insert, update on ouroboros.decision_items to ouroboros_app;
grant select on ouroboros.decision_items_rendered to ouroboros_app;
grant execute on function ouroboros.decision_ref_resolves(text, jsonb) to ouroboros_app;
grant execute on function ouroboros.decision_item_emit(text, text, jsonb, jsonb, text, text, text)
  to ouroboros_app;
