-- V018__escalation_rules.sql — `escalation_rules`: mockup 06's three sentences stored as
-- structured predicates, and the sentence derived back out of the structure.
--
-- Filed as issue #191 (Y.3). Needs Y.2 (#190). Blocks Y.4 (#192), Z.1 (#194) and Z.2
-- (#195). Reuses the **WF-P8** predicate grammar established by the workflow-builder
-- roadmap (mockup 04) rather than inventing a second condition language.
--
-- Mockup 06's *ESCALATION RULES* card (`3 active`) prints three lines, each with a switch:
--
--   * `effort ≥ L → implement uses coder-max (max thinking)`
--   * `security label → review adds second-opinion vote`
--   * `docs-only diff → everything routes local`
--
-- ---------------------------------------------------------------------------
-- Decision M5 — a rule is structure, and the sentence is derived from it.
-- ---------------------------------------------------------------------------
--
-- Those three lines are the temptation of the whole page. They read like sentences, so the
-- cheap implementation stores them *as* sentences — and then nothing can evaluate them. A
-- rule that cannot be evaluated is decoration: the switch toggles, the text greys out, and
-- routing behaves identically.
--
-- So a rule is two jsonb documents and a switch. `"when"` is a predicate in the WF-P8
-- grammar, `"then"` is one of exactly three route modifications, and `display` — the string
-- the card renders — is **generated from the pair**, server-side, by
-- `ouroboros.escalation_rule_display()`. It is not a column a writer fills in. That is what
-- makes the sentence unable to drift from the rule: there is no second place for the truth
-- to live, so there is nothing for the two copies to disagree about.
--
-- ---------------------------------------------------------------------------
-- `display` is a stored generated column, which is how *"hand-written display text is
-- rejected on write"* stops being a convention.
-- ---------------------------------------------------------------------------
--
-- `generated always as (…) stored`. PostgreSQL refuses any statement that supplies a value
-- for such a column — `cannot insert a non-DEFAULT value into column "display"`, class 42 —
-- so the rejection is the engine's rather than a trigger's, and it applies to a seed, a
-- migration and a service equally. It recomputes on every write that touches `"when"` or
-- `"then"`, so a rule edited in the builder (AA.5) cannot keep the sentence it used to have.
--
-- Deterministic by construction, which is the other acceptance criterion: the derivation is
-- an `immutable` function of the two documents and reads nothing else — no table, no clock,
-- no session setting. The same rule renders the same sentence in every workspace, in every
-- session, forever.
--
-- What that costs, stated plainly: changing the *wording* is a migration that rewrites the
-- column, because a stored generated column is computed when the row is written and not
-- when it is read. PostgreSQL 17 has the one statement that does it —
-- `alter table ouroboros.escalation_rules alter column display set expression as (…)`,
-- which rewrites the table — so the wording and the rows cannot part company as long as
-- that is how the wording is changed. The alternative, a view that renders on read, was
-- rejected because every consumer would then have to remember to read the view: the column
-- is what an `select * from escalation_rules` already returns.
--
-- ---------------------------------------------------------------------------
-- `"when"` and `"then"` are **domains**, not table CHECKs — and the reason is `display`.
-- ---------------------------------------------------------------------------
--
-- A stored generated column is computed **before** any CHECK on the row is evaluated. So a
-- table CHECK would leave the derivation looking at a structure that nothing had validated
-- yet, and `escalation_rule_display()` would have to defend itself against every malformed
-- shape its own table was about to reject — a second, weaker copy of the grammar, in the
-- one function whose output must never be in doubt.
--
-- A domain moves the check to the value's *coercion*, which happens while the statement's
-- expressions are evaluated — before the row exists at all. By the time the generated
-- column runs, `"when"` and `"then"` are inside the grammar by construction, and the
-- derivation can be written as though they are, because they are.
--
-- A domain constraint is a CHECK constraint (the ticket's criterion, met): it raises class
-- 23 `check_violation` naming the constraint that refused it — `escalation_rule_then_shape`
-- for an unknown action key — which is what `tests/constraints.sql` asserts by name. The
-- domains are also the grammar in a form other code can *reach*: Z.2's rules API (#195) can
-- validate a submitted rule with a cast rather than with a re-implementation of these rules
-- in TypeScript, which is the second copy this file exists to prevent.
--
-- The usual caveat applies and is deliberate: a CHECK that calls a function is not
-- re-evaluated against stored rows when the function is replaced. Widening the grammar is
-- therefore an ordinary migration that replaces the predicate *and* re-validates what is
-- already there — which is the same discipline every vocabulary CHECK in this schema
-- already asks for, said out loud because a function makes it easier to forget.
--
-- ---------------------------------------------------------------------------
-- The `"when"` grammar — WF-P8's shape, with routing's three contexts.
-- ---------------------------------------------------------------------------
--
-- WF-P8 (mockup 04) fixed the shape a trigger predicate takes: **a flat object of condition
-- keys, each from a closed vocabulary, combined with AND**. `{effort_lte: "m", …}` is what
-- it looks like on a workflow trigger. This is the same object with the contexts routing
-- actually has:
--
--   * `effort_gte` — `xs | s | m | l | xl`, and *not a second effort scale*. It is
--     literally V009's decision **F9** vocabulary — the five chips the queue renders, the
--     five classes the design system styles — which `tests/constraints.sql` asserts by
--     reading `queue_items_effort` out of the catalogue and feeding every size it names
--     through this predicate. Two tables with five sizes each are one vocabulary only for
--     as long as nobody edits one of them; the assertion is what makes that true.
--     `_gte` rather than WF's `_lte` because the two ask opposite questions of the same
--     scale: a trigger gates work *small enough* to run unattended, an escalation catches
--     work *big enough* to deserve a better model.
--   * `label` — a GitHub label name, as V014 mirrors them: GitHub's vocabulary, not ours,
--     so there is no CHECK on the *set* of names, only that it is a non-blank bounded
--     string. `security` is the mockup's.
--   * `diff_kind` — `docs_only`, and that is the whole vocabulary today. A one-value CHECK
--     looks odd and is honest: a diff classification nothing computes is a rule that can
--     never fire, which reads in the card as a protection the workspace has and does not.
--     Widening it is one line here plus the classifier that produces the new value.
--
-- At least one key, no key outside the three, and every key present is ANDed with the
-- others — so `{effort_gte: "l", label: "security"}` is *both*, and the derived sentence
-- joins the clauses with `and`. The empty object is refused: a rule with no condition is a
-- rule that always fires, which is not an escalation, it is a route.
--
-- ---------------------------------------------------------------------------
-- The `"then"` shapes — exactly three, and the mockup's parenthesis is data.
-- ---------------------------------------------------------------------------
--
--   * `{use_alias: {task_kind, alias, params?}}` — swap the primary model for one task
--     kind. The mockup's *"(max thinking)"* is `params: {thinking: "max"}`, **not prose**:
--     it is the same shape `model_aliases.params` (V015) already holds for an alias, so
--     Z.1 merges the rule's over the alias's and has nothing to parse.
--   * `{add_vote: {task_kind, alias}}` — the second-opinion vote appended to a kind's
--     resolution, which is the matrix's *"always second vote: second-opinion"* on `review`.
--   * `{route_local: {}}` — everything routes to the workspace's local-provider aliases.
--     Deliberately an empty object rather than `null` or a bare string, so that the three
--     actions are one shape — an object under an action key — and a later option (*"except
--     these kinds"*) is a key rather than a fourth encoding.
--
-- Exactly one action key per rule, checked by counting them: a `"then"` carrying two
-- actions is a rule whose effect depends on which one a reader notices first. An action
-- outside the three is refused by name, which is the ticket's second criterion.
--
-- `task_kind` and `alias` are **names**, not ids — `implement`, `coder-max` — and they are
-- shape-checked here against the same lower-case-kebab rule `task_kinds.name` and
-- `model_aliases.alias` carry, so a rule cannot name something those tables could never
-- hold. That is the *shape*; that the workspace actually has one is the trigger below.
--
-- Why names and not ids: the rule is authored, read and reviewed as a sentence about
-- `implement` and `coder-max`, it round-trips through Z.2's API as those names, and the
-- display derivation must produce the sentence from the structure **alone** — which a pair
-- of uuids cannot do without a join, and a join is exactly what an `immutable` function may
-- not have. The referential half is paid for below rather than given up.
--
-- ---------------------------------------------------------------------------
-- The derivation, as rules rather than as three special cases.
-- ---------------------------------------------------------------------------
--
--   when   effort_gte: X   →  `effort ≥ ` + X upper-cased
--          label: S        →  S + ` label`
--          diff_kind: K    →  K with `_` as `-`, + ` diff`
--          …joined with ` and `, in **that** key order — the grammar's, not the order the
--          keys happen to sit in the jsonb, so the sentence is a function of the rule and
--          not of how it was typed.
--   then   use_alias       →  `<task_kind> uses <alias>`, plus ` (…)` when there are params
--          add_vote        →  `<task_kind> adds <alias> vote`
--          route_local     →  `everything routes local`
--   joined with ` → `.
--
-- A param renders **value then key** — `{thinking: "max"}` is `(max thinking)` — which is
-- the mockup's phrasing and the only reading that produces its sentence. Several render in
-- sorted key order joined with `, `. It reads oddly for a param whose value is a number
-- (`(0.2 temperature)`), and that is accepted rather than special-cased: one rule that is
-- occasionally graceless beats a table of exceptions the builder would have to know.
--
-- The three mockup rules are the round-trip fixture, and `tests/constraints.sql` asserts
-- each of them character for character.
--
-- ---------------------------------------------------------------------------
-- A rule cannot name a task kind or an alias the workspace does not have.
-- ---------------------------------------------------------------------------
--
-- The criterion is that this is caught **at write time, not at resolution time** — the
-- difference between an editor that refuses a rule and a run that silently skips one.
--
-- It cannot be a foreign key: the names live inside a jsonb document, and a foreign key
-- needs a column. So it is `escalation_rule_targets_exist()`, a *constraint* trigger, and
-- it is attached to all three tables that can break the rule — the rules themselves, and
-- the two tables whose rows they name:
--
--   * writing a rule that names an unknown kind or alias is refused,
--   * deleting or renaming a task kind or an alias that a rule names is refused, which is
--     `route_hops`' `restrict` (V016) applied to the reference this schema cannot declare.
--
-- Deferred to `commit`, for V016's reason and one more: a seed, a workspace import and the
-- builder's *"rename this alias and update the rules that use it"* are all transactions
-- that are momentarily inconsistent and finally correct, and none of them should have to
-- know the order this schema would otherwise require them to write in.
--
-- It re-validates **every rule of the affected workspace** rather than the row that fired
-- it. That is the same amount of work for a rules table this size — the card says `3
-- active` — and it makes all three attachments one code path instead of three, each of
-- which would have to know which side it was called from.
--
-- Raised as class 23 (`check_violation`) naming the trigger, which is the idiom V008, V010
-- and V016 established for a rule a function enforces: a caller sees an integrity violation
-- with a constraint name in it rather than a bespoke error class it would have to learn.
-- The message names the rule by its *derived display*, because that is the string the
-- person who wrote it is looking at.
--
-- What it deliberately does **not** check: that a `route_local` workspace has any local
-- aliases to route to. That is resolution's question (Z.1, #194), it has an honest answer
-- there, and asking it here would make a rule's validity depend on the provider inventory
-- at the moment it was saved.
--
-- ---------------------------------------------------------------------------
-- Evaluation order, and why it is a column.
-- ---------------------------------------------------------------------------
--
-- `sort_order` is unique per workspace and 1 is first, so *"which rule wins"* has one answer
-- and it is the one the card is showing top to bottom. Two rules can both match a run —
-- `effort ≥ L` and `security label` on the same issue — and without an order, which one
-- swapped the model would depend on the query plan.
--
-- Deferrable, like `task_kinds.sort_order` and `queue_items.position` before it, so a
-- drag-reorder is plain SQL inside a transaction with no `set constraints` ceremony.
-- Deliberately **not** dense: nothing counts these numbers, unlike `route_hops.position`
-- which `floor_hop_index` counts, so a card rendering `order by sort_order` draws 1, 2, 5
-- exactly as it draws 1, 2, 3.
--
-- ---------------------------------------------------------------------------
-- Tenancy, quoting, indexes, seeds.
-- ---------------------------------------------------------------------------
--
-- One table, one workspace column, cascading from `organization` as every table in this
-- schema does. There is no composite foreign key here because there is no second table to
-- point at: the names inside `"then"` are held to the workspace by the trigger above, which
-- looks a kind and an alias up **by `(organization_id, name)`** — so a rule can no more
-- reach another workspace's alias than a hop can.
--
-- **`"when"` and `"then"` are quoted everywhere**, because both are reserved words. That is
-- the same arrangement `"user"` has had since V004 and it is deliberate rather than
-- tolerated: the ticket, decision M5, the API payload and the builder all call these fields
-- `when` and `then`, and a column named `when_clause` would be a fourth name for a thing
-- that already has one. Every reader and writer quotes them; `tests/constraints.sql` does.
--
-- **No index is added.** The only read is *"this workspace's rules, in evaluation order"* —
-- and its enabled-only variant, which filters the same rows — and both enter through
-- `escalation_rules_organization_sort_order_key`, whose leading column is the workspace. An
-- index nothing reads is still an index every write maintains.
--
-- **No seed rows.** Y.4 (#192) fills this table with the mockup's three rules, in a
-- development database and nowhere else. One thing it inherits from this file: its rule 2
-- names the alias `second-opinion`, so Y.4 seeds that alias alongside its six — the
-- registry roadmap's CG.4 (#582) *extends* the shared seed rather than owning that row, as
-- its own note already says of the aliases Y.4 lands.
--
-- House snake_case throughout — decision **A4**. `organization` is referenced by its quoted
-- camelCase `"id"` (V005).

-- ---------------------------------------------------------------------------
-- The `"when"` grammar, as a predicate.
--
-- Written in plpgsql with explicit control flow rather than as one SQL expression, because
-- the rules are ordered: *is it an object* has to be answered before anything asks what its
-- keys are, and SQL's `and` is free to evaluate its operands in any order it likes.
--
--   rule_when — the candidate predicate document
--   returns   — true when it is inside the grammar
-- ---------------------------------------------------------------------------
create function ouroboros.escalation_rule_when_valid(rule_when jsonb)
returns boolean
language plpgsql
immutable
strict
as $$
declare
  condition text;
  label     text;
begin
  if jsonb_typeof(rule_when) <> 'object' then
    return false;
  end if;

  -- A rule with no condition always fires, which is not an escalation — it is a route.
  if rule_when = '{}'::jsonb then
    return false;
  end if;

  -- Closed: an unknown condition key is a rule nothing will ever evaluate, stored as
  -- though it would be.
  for condition in select k from jsonb_object_keys(rule_when) as k loop
    if condition not in ('effort_gte', 'label', 'diff_kind') then
      return false;
    end if;
  end loop;

  -- V009's decision F9 scale, and the same five values — see the header on why this is one
  -- vocabulary rather than two that currently agree.
  if rule_when ? 'effort_gte' then
    if jsonb_typeof(rule_when -> 'effort_gte') <> 'string'
       or (rule_when ->> 'effort_gte') not in ('xs', 's', 'm', 'l', 'xl') then
      return false;
    end if;
  end if;

  -- GitHub's label names, as V014 mirrors them: no vocabulary, because it is not ours to
  -- have one. Non-blank and bounded, which is what a sentence can be rendered from.
  if rule_when ? 'label' then
    if jsonb_typeof(rule_when -> 'label') <> 'string' then
      return false;
    end if;
    label := rule_when ->> 'label';
    if label = '' or btrim(label) <> label or length(label) > 100 then
      return false;
    end if;
  end if;

  -- One value, honestly. See the header.
  if rule_when ? 'diff_kind' then
    if jsonb_typeof(rule_when -> 'diff_kind') <> 'string'
       or (rule_when ->> 'diff_kind') <> 'docs_only' then
      return false;
    end if;
  end if;

  return true;
end;
$$;

comment on function ouroboros.escalation_rule_when_valid(jsonb) is
  'The WF-P8 predicate grammar as routing scopes it (#191, decision M5): an object of at least one condition key drawn from effort_gte, label and diff_kind, ANDed, each from its own closed vocabulary — effort_gte being V009''s five F9 sizes rather than a second scale. Behind the escalation_rule_when domain, and reachable on its own so Z.2''s API validates a submitted rule with this definition instead of a TypeScript copy of it.';

-- ---------------------------------------------------------------------------
-- The `"then"` shapes, as a predicate.
--
-- Exactly one action key from the three, and each action's own body checked: the ticket's
-- *"an unknown action key cannot be stored"*, plus the narrower shapes underneath it that
-- stop a known key carrying an unusable body.
--
--   rule_then — the candidate action document
--   returns   — true when it is one of the three shapes
-- ---------------------------------------------------------------------------
create function ouroboros.escalation_rule_then_valid(rule_then jsonb)
returns boolean
language plpgsql
immutable
strict
as $$
declare
  action      text;
  body        jsonb;
  params      jsonb;
  member      text;
  param_key   text;
  param_value jsonb;
  name_shape  constant text := '^[a-z0-9]+(-[a-z0-9]+)*$';
begin
  if jsonb_typeof(rule_then) <> 'object' then
    return false;
  end if;

  -- Exactly one action. Two is a rule whose effect depends on which one a reader notices.
  if (select count(*) from jsonb_object_keys(rule_then)) <> 1 then
    return false;
  end if;

  select k into action from jsonb_object_keys(rule_then) as k;

  if action not in ('use_alias', 'add_vote', 'route_local') then
    return false;
  end if;

  body := rule_then -> action;
  if jsonb_typeof(body) <> 'object' then
    return false;
  end if;

  -- `{route_local: {}}` — no options today, an object so that the day there is one it is a
  -- key rather than a fourth encoding.
  if action = 'route_local' then
    return body = '{}'::jsonb;
  end if;

  -- `use_alias` and `add_vote` both name a task kind and an alias; only `use_alias` may
  -- carry params.
  for member in select k from jsonb_object_keys(body) as k loop
    if member not in ('task_kind', 'alias')
       and not (action = 'use_alias' and member = 'params') then
      return false;
    end if;
  end loop;

  if not (body ? 'task_kind') or not (body ? 'alias') then
    return false;
  end if;

  -- The same shape task_kinds.name and model_aliases.alias carry, so a rule cannot name
  -- something those tables could never hold. That the workspace *has* one is the trigger's.
  if jsonb_typeof(body -> 'task_kind') <> 'string'
     or (body ->> 'task_kind') !~ name_shape
     or length(body ->> 'task_kind') > 64 then
    return false;
  end if;

  if jsonb_typeof(body -> 'alias') <> 'string'
     or (body ->> 'alias') !~ name_shape
     or length(body ->> 'alias') > 64 then
    return false;
  end if;

  if body ? 'params' then
    params := body -> 'params';

    -- An empty params object would render as `()` — the absence of params is how "no
    -- params" is said here, exactly as null is for every optional column in this schema.
    if jsonb_typeof(params) <> 'object' or params = '{}'::jsonb then
      return false;
    end if;

    -- Bounded, because every one of them is rendered into the card's one-line sentence.
    if (select count(*) from jsonb_object_keys(params)) > 8 then
      return false;
    end if;

    for param_key, param_value in select p.key, p.value from jsonb_each(params) as p loop
      if param_key = '' or btrim(param_key) <> param_key or length(param_key) > 64 then
        return false;
      end if;

      -- Scalars only. A nested object has no reading as `(… …)`, and a params document the
      -- display cannot render is a rule whose sentence would have to be approximate.
      if jsonb_typeof(param_value) not in ('string', 'number', 'boolean') then
        return false;
      end if;

      if jsonb_typeof(param_value) = 'string' and (param_value #>> '{}') = '' then
        return false;
      end if;
    end loop;
  end if;

  return true;
end;
$$;

comment on function ouroboros.escalation_rule_then_valid(jsonb) is
  'The three route modifications a rule may carry (#191, decision M5): {use_alias: {task_kind, alias, params?}}, {add_vote: {task_kind, alias}} and {route_local: {}} — exactly one action key, each body checked, names shaped as task_kinds.name and model_aliases.alias are. Behind the escalation_rule_then domain; an unknown action key is refused there by name.';

-- ---------------------------------------------------------------------------
-- The two domains.
--
-- See the header for why the grammar is a domain rather than a table CHECK: a stored
-- generated column is computed before any CHECK on the row, so the derivation would
-- otherwise have to defend itself against structures its own table was about to reject.
-- ---------------------------------------------------------------------------
create domain ouroboros.escalation_rule_when as jsonb
  constraint escalation_rule_when_grammar
    check (ouroboros.escalation_rule_when_valid(value));

comment on domain ouroboros.escalation_rule_when is
  'A routing escalation predicate in the WF-P8 grammar (#191): effort_gte, label, diff_kind, ANDed. A domain rather than a table CHECK so the value is validated at coercion — before the row exists, and therefore before display is derived from it.';

create domain ouroboros.escalation_rule_then as jsonb
  constraint escalation_rule_then_shape
    check (ouroboros.escalation_rule_then_valid(value));

comment on domain ouroboros.escalation_rule_then is
  'A routing escalation''s route modification (#191): exactly one of use_alias, add_vote or route_local, each with its own checked body. A domain for the same reason as escalation_rule_when — and it is what makes an unknown action key a named CHECK violation rather than a row nobody can evaluate.';

-- ---------------------------------------------------------------------------
-- The derivation — the card's sentence, produced from the structure and from nothing else.
--
-- `immutable` and reading no table, which is what a stored generated column requires and
-- also what the criterion asks for: the same rule renders the same sentence in every
-- workspace and every session. The header spells the rules out; the three mockup sentences
-- are asserted character for character in tests/constraints.sql.
--
--   rule_when — the predicate, already inside the grammar (see the domains above)
--   rule_then — the action, already one of the three shapes
--   returns   — the sentence mockup 06's rules card renders
-- ---------------------------------------------------------------------------
create function ouroboros.escalation_rule_display(rule_when jsonb, rule_then jsonb)
returns text
language plpgsql
immutable
strict
as $$
declare
  clauses    text[] := '{}';
  rendered   text[] := '{}';
  action     text;
  params     jsonb;
  param_key  text;
  param_text text;
begin
  -- The grammar's key order, not the document's. Two rules that differ only in the order
  -- their conditions were typed are the same rule and must read the same.
  if rule_when ? 'effort_gte' then
    clauses := clauses || ('effort ≥ ' || upper(rule_when ->> 'effort_gte'));
  end if;

  if rule_when ? 'label' then
    clauses := clauses || ((rule_when ->> 'label') || ' label');
  end if;

  -- `docs_only` is the stored value and *docs-only* is the English; the underscore is a
  -- vocabulary's punctuation, not a word's.
  if rule_when ? 'diff_kind' then
    clauses := clauses || (replace(rule_when ->> 'diff_kind', '_', '-') || ' diff');
  end if;

  if rule_then ? 'use_alias' then
    action := (rule_then #>> '{use_alias,task_kind}')
              || ' uses ' || (rule_then #>> '{use_alias,alias}');

    -- The mockup's *"(max thinking)"*: value then key, sorted, comma-joined. See the
    -- header for why that reading and not `(thinking: max)`.
    params := rule_then #> '{use_alias,params}';
    if params is not null then
      for param_key, param_text in
        select p.key, p.value from jsonb_each_text(params) as p order by p.key
      loop
        rendered := rendered || (param_text || ' ' || param_key);
      end loop;
      action := action || ' (' || array_to_string(rendered, ', ') || ')';
    end if;

  elsif rule_then ? 'add_vote' then
    action := (rule_then #>> '{add_vote,task_kind}')
              || ' adds ' || (rule_then #>> '{add_vote,alias}') || ' vote';

  else
    -- `route_local`, the only shape left — the domain has already refused every other.
    action := 'everything routes local';
  end if;

  return array_to_string(clauses, ' and ') || ' → ' || action;
end;
$$;

comment on function ouroboros.escalation_rule_display(jsonb, jsonb) is
  'Mockup 06''s rules-card sentence, derived from a rule''s structure (#191, decision M5) — "effort ≥ L → implement uses coder-max (max thinking)". Immutable and table-free, which is what lets escalation_rules.display be a stored generated column: the sentence cannot be hand-written, cannot drift from the rule, and renders identically in every workspace and session.';

-- ---------------------------------------------------------------------------
-- The names a rule may use are the names the workspace has.
--
-- The reference this schema cannot declare — the kind and the alias live inside a jsonb
-- document, and a foreign key needs a column. Attached to all three tables that can break
-- it, deferred to `commit`, and raising class 23 naming the trigger. See the header.
-- ---------------------------------------------------------------------------
create function ouroboros.escalation_rule_targets_exist()
returns trigger language plpgsql as $$
declare
  workspaces text[] := '{}';
  workspace  text;
  rule       record;
begin
  -- Which workspaces this event can have disturbed. Both sides of an update are collected:
  -- the rules a row leaves behind are as much its business as the ones it arrives among.
  if tg_op <> 'INSERT' then workspaces := workspaces || old.organization_id; end if;
  if tg_op <> 'DELETE' then workspaces := workspaces || new.organization_id; end if;

  -- An ordinary update names the same workspace twice.
  workspaces := array(select distinct w from unnest(workspaces) as w);

  foreach workspace in array workspaces loop
    -- Every rule of the workspace, not the row that fired this. The card says `3 active`;
    -- re-reading them all is what makes one code path serve all three attachments — and a
    -- rule that has since been deleted is simply not among them, which is what makes the
    -- workspace cascade below work without a special case.
    for rule in
      select r.display,
             coalesce(r."then" #>> '{use_alias,task_kind}',
                      r."then" #>> '{add_vote,task_kind}') as task_kind,
             coalesce(r."then" #>> '{use_alias,alias}',
                      r."then" #>> '{add_vote,alias}')     as alias
        from ouroboros.escalation_rules r
       where r.organization_id = workspace
    loop
      -- `route_local` names neither, and has nothing to be checked against.
      if rule.task_kind is not null
         and not exists (select 1
                           from ouroboros.task_kinds k
                          where k.organization_id = workspace
                            and k.name = rule.task_kind) then
        raise exception 'escalation rule "%" names task kind %, which this workspace does not have',
                        rule.display, rule.task_kind
          using errcode = 'check_violation', constraint = tg_name;
      end if;

      if rule.alias is not null
         and not exists (select 1
                           from ouroboros.model_aliases a
                          where a.organization_id = workspace
                            and a.alias = rule.alias) then
        raise exception 'escalation rule "%" names alias %, which this workspace does not have',
                        rule.display, rule.alias
          using errcode = 'check_violation', constraint = tg_name;
      end if;
    end loop;
  end loop;

  return null;
end;
$$;

comment on function ouroboros.escalation_rule_targets_exist() is
  'Deferred constraint trigger for escalation_rules, task_kinds and model_aliases (#191): the task kind and alias a rule''s "then" names must exist in the rule''s workspace. Not a foreign key, because both live inside a jsonb document — so writing a rule that names one the workspace does not have is refused, and so is retiring or renaming one a rule already names. Deferred, so a seed or a rename-and-update transaction may be momentarily inconsistent and correct at commit. Raises class 23 naming the trigger, so each table reports its own constraint name.';

-- ---------------------------------------------------------------------------
-- escalation_rules
-- ---------------------------------------------------------------------------
create table ouroboros.escalation_rules (
  -- Surrogate key. The card addresses a row by it and Z.2's rules API (#195) puts it in a
  -- URL, so a uuid rather than a serial for V001's reason: an id that appears in a URL
  -- should not also be a count of how many exist.
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade: a rule is configuration, and it goes with the workspace.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The card's switch. All three of the mockup's are on — `3 active`.
  --
  -- Defaults true, because the only reason to write a rule is to have it apply; the switch
  -- exists so a workspace can suspend one *without deleting it*, which is the whole
  -- difference between a rule turned off and a rule that was never written.
  --
  -- A disabled rule is still a row with a `sort_order` and a `display`, so turning it back
  -- on restores it exactly where it was in the order. Nothing here filters on it: the read
  -- is `where enabled` and the rules stay in one table, because "the rules this workspace
  -- has" and "the rules that currently fire" are different questions the card asks both of.
  enabled         boolean     not null default true,

  -- Evaluation order; 1 is first. Unique per workspace and deferrable, so a drag-reorder is
  -- plain SQL — and deliberately not dense. See the header.
  sort_order      integer     not null,

  -- **The predicate** — WF-P8's grammar with routing's three contexts. Quoted because
  -- `when` is a reserved word; see the header on why the column is nevertheless called
  -- that. The domain is the grammar, and it is checked at coercion rather than at row
  -- level, which is what lets `display` below be derived from a structure already known
  -- good.
  "when"          ouroboros.escalation_rule_when not null,

  -- **The route modification** — one of exactly three shapes. Quoted for the same reason.
  "then"          ouroboros.escalation_rule_then not null,

  -- **The sentence the card renders, generated from the two documents above.**
  --
  -- `generated always … stored`, so a writer that supplies one is refused by PostgreSQL
  -- itself — the ticket's *"hand-written display text is rejected on write"*, as a property
  -- of the column rather than a rule in a service. It recomputes on every write that
  -- touches `"when"` or `"then"`, so an edited rule cannot keep the sentence it used to
  -- have, and it is derived by an immutable function of those two values alone, so it is
  -- the same sentence everywhere. The header has what it costs and how the wording is
  -- changed when it has to be.
  display         text        not null
                              generated always as
                                (ouroboros.escalation_rule_display("when", "then")) stored,

  created_at      timestamptz not null default now(),

  -- Moved by the V001 trigger rather than by the writer, as everywhere else in this schema.
  updated_at      timestamptz not null default now(),

  -- --- the order rules are evaluated in ------------------------------------------
  --
  -- Acceptance criterion: *sort_order gives rules a deterministic evaluation order*. Unique
  -- so two rules cannot claim one place, deferrable so a reorder is one statement inside a
  -- transaction — the arrangement `task_kinds.sort_order` and `queue_items.position` both
  -- have, and for the same reason: PostgreSQL checks a unique index as each row version is
  -- written, so under an immediate constraint every ordinary swap collides with the row
  -- already at the target position.
  constraint escalation_rules_organization_sort_order_key
    unique (organization_id, sort_order) deferrable initially deferred,

  -- The first rule is first, not zeroth.
  constraint escalation_rules_sort_order_positive check (sort_order >= 1)
);

comment on table ouroboros.escalation_rules is
  'Mockup 06''s ESCALATION RULES card, as structured predicates rather than as sentences (#191, decision M5). A rule is a WF-P8 "when" predicate, a "then" route modification from a closed set of three, and a switch; the sentence the card renders is generated from that structure server-side, so it cannot be hand-written and cannot drift from what the rule does. Evaluated in sort_order by resolution (Z.1, #194); written by Z.2 (#195); seeded per workspace by Y.4 (#192).';
comment on column ouroboros.escalation_rules.organization_id is
  'The workspace. ON DELETE CASCADE — a rule is configuration and goes with the workspace. It is also how escalation_rule_targets_exist() looks the rule''s task kind and alias up, which is what holds a rule to its own workspace''s names.';
comment on column ouroboros.escalation_rules.enabled is
  'The card''s switch — all three of the mockup''s are on ("3 active"). Defaults true; the switch is how a rule is suspended without being deleted, which is why a disabled rule keeps its place in the order and its derived sentence.';
comment on column ouroboros.escalation_rules.sort_order is
  'Evaluation order; 1 is first, and it is what gives "which rule wins" one answer when two rules match the same run. Unique per workspace and deferrable, so a drag-reorder is plain SQL — and deliberately NOT dense, unlike route_hops.position, because nothing counts these numbers.';
comment on column ouroboros.escalation_rules."when" is
  'The predicate, in the WF-P8 grammar scoped to routing''s contexts — effort_gte (V009''s five F9 sizes), label (GitHub''s, as V014 mirrors them) and diff_kind (docs_only), at least one, ANDed. Quoted because `when` is reserved; the ticket, the API and the builder all call it that. Its domain checks the grammar at coercion, before display is derived.';
comment on column ouroboros.escalation_rules."then" is
  'The route modification: {use_alias: {task_kind, alias, params?}} — the mockup''s "(max thinking)" is params, not prose — or {add_vote: {task_kind, alias}}, or {route_local: {}}. Exactly one action key; an unknown one is refused by the domain''s CHECK. The names it carries must exist in this workspace, which escalation_rule_targets_exist() holds.';
comment on column ouroboros.escalation_rules.display is
  'The sentence the card renders — "effort ≥ L → implement uses coder-max (max thinking)" — GENERATED ALWAYS from "when" and "then". A writer that supplies one is refused by PostgreSQL, and it recomputes whenever the structure changes, so the sentence can neither be hand-written nor drift from the rule it describes.';

-- ---------------------------------------------------------------------------
-- Indexes.
--
-- None, and that is the arrangement worth having rather than an omission. The only read is
-- the card's — a workspace's rules in evaluation order, and its `where enabled` variant
-- over the same rows — and it enters through the leading column of
-- `escalation_rules_organization_sort_order_key`, which exists because a *rule* needed it.
-- The workspace cascade enters through the same index. An index nothing reads is still an
-- index every write maintains.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Triggers.
-- ---------------------------------------------------------------------------
create trigger escalation_rules_touch_updated_at
  before update on ouroboros.escalation_rules
  for each row execute function ouroboros.touch_updated_at();

-- The names a rule uses, on all three tables that can break the reference. Deferred, so a
-- seed that writes rules before aliases, and a rename that updates both, are each one
-- ordinary transaction — see the header.
create constraint trigger escalation_rules_targets_exist
  after insert or update on ouroboros.escalation_rules
  deferrable initially deferred
  for each row execute function ouroboros.escalation_rule_targets_exist();

-- `update of name` / `update of alias` rather than every update: a rule names a task kind
-- by `(organization_id, name)` and an alias by `(organization_id, alias)`, so those are the
-- columns — and the only columns — whose change can move a row out from under a rule. A
-- matrix reorder, which updates `sort_order` on every kind it passes, is none of this
-- trigger's business.
create constraint trigger task_kinds_escalation_targets_exist
  after delete or update of organization_id, name on ouroboros.task_kinds
  deferrable initially deferred
  for each row execute function ouroboros.escalation_rule_targets_exist();

create constraint trigger model_aliases_escalation_targets_exist
  after delete or update of organization_id, alias on ouroboros.model_aliases
  deferrable initially deferred
  for each row execute function ouroboros.escalation_rule_targets_exist();
