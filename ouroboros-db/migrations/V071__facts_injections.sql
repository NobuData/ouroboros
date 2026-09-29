-- V071__facts_injections.sql — `facts`, `fact_anchors`, `fact_transitions` and
-- `context_injections`: learned facts with a lifecycle, the reason a fact can expire, the audit
-- of every state change, and the record that turns *"used 48×"* into a count (#406, BE.2).
--
-- The knowledge domain's second migration (docs/ROADMAP_MOCKUP_14_KNOWLEDGE.md, epic #401),
-- after `V069`'s skills. Mockup 14's *"Learned by the loop"* card is five rows: *"CI needs
-- `west update` before first build of the day"* (`confirmed by Ken, 6w ago` · `used 48×`), two
-- `awaiting review` proposals such as *"Team prefers `k_msgq` over `k_fifo` in ISR paths"*
-- (`from PR #498 review cycle`), and the struck-through *"Zephyr 4.0 needs
-- `CONFIG_LEGACY_TIMER`"* (`expired on Zephyr 4.1 migration · was used 31×`) — under the foot
-- *"Confirmed facts are injected into every run's context. Facts expire when the code that
-- taught them changes."*
--
-- Nothing writes these yet. BF.2 (#411) is the lifecycle service and the staleness sweep,
-- #412's deterministic proposers and #423's `llm` proposer create proposals, BE.5 (#409) seeds
-- the five mockup rows, and every context-assembly consumer (#414) appends injection records.
-- As in `V069`, that is why each rule a reader depends on is a constraint here.
--
-- ---------------------------------------------------------------------------
-- What each rule is for
-- ---------------------------------------------------------------------------
--
--   * **The lifecycle is a machine, and the database holds it** (decision **K3**). A fact is
--     born `proposed` (`facts_legal_transition` refuses any other insert), and moves only
--     along these edges:
--
--         proposed  → confirmed | rejected       "and you approve"
--         confirmed → stale                      an anchor fired (the sweep)
--         stale     → expired | confirmed        a person agrees, or re-confirms
--
--     `rejected` and `expired` are terminal. *Re-learn* does not revive an expired row: it is
--     a **new** `proposed` fact whose `relearned_from_fact_id` names the expired one
--     (`facts_relearn_from_expired`), so the struck-through row and its `was used 31×` stay
--     exactly as they were. `proposed → expired` would be a fact that expired without ever
--     having been true, and `rejected → confirmed` a rejection quietly undone; both raise.
--
--   * **Every transition is audited, with its actor.** *"confirmed by Ken, 6w ago"* is an
--     audit record being rendered. The writer sets `status_changed_by` (and optionally
--     `status_reason`) in the same statement as the status, and `fact_transitions_record()`
--     appends a `fact_transitions` row for the insert and for every status change. A person
--     must be named for the human gates — `confirmed`, `rejected`, `expired`
--     (`facts_transition_actor`); only `stale`, which the sweep sets, may have nobody behind
--     it. The recorder is `security definer`, so `ouroboros_app` holds `select` and nothing
--     else on the audit table: an audit row cannot be written except by a transition.
--
--   * **Expiry snapshots the count.** An expired fact stops being injected, so a live count
--     from `context_injections` would fall as any window rolled — nonsense for a historical
--     claim. `previous_use_count` is the snapshot BF.2 takes at expiry, and `expired_reason`
--     the *"Zephyr 4.1 migration"* beside it: both are required exactly when `status =
--     'expired'` (`facts_expired_use_count`, `facts_expired_reason`), and an expired row is
--     frozen (`facts_expired_frozen`), so the number it renders never changes afterwards.
--
--   * **Anchors are why a fact can expire** (decision **K4**). A `fact_anchors` row ties a
--     fact to a `path_glob`, a `dependency` or a `platform_version`; the mockup's expired row
--     is a `platform_version` anchor on `zephyr-4.0` firing when the repository moved to 4.1.
--     `(kind, value)` is indexed for the sweep's lookup, and `path_glob_matches(glob, path)`
--     answers *"which path anchors does this changed path set touch"* in SQL. A fact with no
--     anchors is valid and is simply never flagged stale — the honest limitation.
--
--   * **Provenance is typed, not prose.** `provenance` is `{"line": …, "refs": [...]}`:
--     the display line the card renders (*"from PR #498 review cycle"*) and the references
--     it stands for — a `run`, a `pull_request`, a `ticket` (each by id) or an `import`
--     (`file`, `section`). `fact_provenance_typed` holds the shape, and
--     `facts_provenance_resolves` refuses a run, PR or ticket id that is not a row of the
--     fact's own workspace when the provenance is written. The `proposer` vocabulary reserves
--     `llm` now (#423), so that upgrade needs no migration.
--
--   * **`context_injections` is the only usage number in the product.** Every consumer that
--     assembles a manifest appends what it actually injected: the `skill_versions` and
--     `facts` ids as arrays, the manifest's hash, and the consumer's own reference — an
--     `estimator` names an `issue_estimates` row, a `run_stage` names a `run_stages` row and
--     its run, and a `playbook` names the run the playbook launched (BE.3, #407, carries
--     `playbook_id` on what it launches). `used 48×` is a count of rows whose `fact_ids`
--     contains the fact; *61% of runs* is the share of runs whose rows contain a version of
--     the skill. `context_injections_resolves` holds each id to the workspace, each fact to
--     `confirmed` (only confirmed facts inject, K3) and each skill version to a published
--     version of a non-draft skill (`V069`). The table is append-only, by trigger and by
--     grant.
--
-- ---------------------------------------------------------------------------
-- What is deliberately not here
-- ---------------------------------------------------------------------------
--
--   * **A live use count on `facts`.** Usage is counted from `context_injections`; the one
--     number stored is the snapshot an expired fact can no longer recompute.
--   * **Foreign keys for the provenance refs.** They live in jsonb so a fact can cite several
--     things of several kinds; they are resolved when written, and a run deleted later leaves
--     a reference the UI renders as its line alone.
--   * **Foreign keys for the manifest arrays.** PostgreSQL has none for array elements;
--     `context_injections_resolves` checks them on append, which is the only write.
--   * **The staleness sweep itself.** Deciding that `zephyr-4.0` no longer holds is BF.2's
--     (#411); this migration gives it the anchors, the index and the glob matcher.

-- ---------------------------------------------------------------------------
-- Provenance's shape
-- ---------------------------------------------------------------------------
create function ouroboros.fact_provenance_typed(prov jsonb) returns boolean
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

  -- The line the card renders: "from PR #498 review cycle".
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
      -- A run, a PR or a ticket: the kind and the row's id, nothing else.
      when 'run', 'pull_request', 'ticket' then
        if exists (select 1 from jsonb_object_keys(ref) as k where k not in ('kind', 'id'))
           or jsonb_typeof(ref -> 'id') is distinct from 'string'
           or (ref ->> 'id') !~ uuid_shape then
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
  'True when a fact''s provenance is the typed document BE.2 (#406) stores: {"line": <non-blank display line, ≤ 200>, "refs": [<0–16 refs>]} and nothing else, where a ref is {"kind": "run"|"pull_request"|"ticket", "id": <lower-case uuid>} or {"kind": "import", "file": <non-blank, ≤ 512>, "section"?: <non-blank, ≤ 200>}. Whether the ids name rows of the fact''s workspace is facts_provenance_resolves''s question.';

-- ---------------------------------------------------------------------------
-- The path-glob matcher the staleness sweep asks
-- ---------------------------------------------------------------------------
create function ouroboros.path_glob_matches(glob text, path text) returns boolean
language plpgsql immutable strict parallel safe as $$
declare
  pattern text := '';
  i       integer := 1;
  c       text;
begin
  -- Translated to an anchored regular expression one character at a time:
  --   `**/` any number of whole directories (including none), `**` anything at all,
  --   `*` anything within one segment, `?` one character within one segment,
  --   and every other character literally.
  while i <= length(glob) loop
    c := substr(glob, i, 1);
    if c = '*' and substr(glob, i + 1, 1) = '*' then
      if substr(glob, i + 2, 1) = '/' then
        pattern := pattern || '(.*/)?';
        i := i + 3;
      else
        pattern := pattern || '.*';
        i := i + 2;
      end if;
      continue;
    elsif c = '*' then
      pattern := pattern || '[^/]*';
    elsif c = '?' then
      pattern := pattern || '[^/]';
    elsif c ~ '[.^$+(){}\[\]|\\]' then
      pattern := pattern || '\' || c;
    else
      pattern := pattern || c;
    end if;
    i := i + 1;
  end loop;

  return path ~ ('^' || pattern || '$');
end;
$$;

comment on function ouroboros.path_glob_matches(text, text) is
  'True when a repository-relative path matches a path glob (#406): ** spans directories (**/ includes none), * and ? stay within one segment, everything else is literal. What the staleness sweep (#411) asks of fact_anchors'' path_glob rows against a commit''s changed path set: exists (select 1 from unnest(changed) p where path_glob_matches(a.value, p)). Strict — null in, null out.';

-- ---------------------------------------------------------------------------
-- facts
-- ---------------------------------------------------------------------------
create table ouroboros.facts (
  id                     uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade: a fact is that workspace's, with its anchors and its audit.
  organization_id        text        not null
                                     references ouroboros.organization ("id") on delete cascade,

  -- The repository a fact is about, as owner/name (V067's domain); null is workspace-wide.
  repo_ref               ouroboros.repo_ref,

  -- The fact as written, inline-code spans and all: "CI needs `west update` before …".
  text                   text        not null,

  -- proposed | confirmed | rejected | stale | expired — moved only along K3's edges.
  status                 text        not null default 'proposed',

  -- Who proposed it: manual | correction_note | waiver | steer | import | llm (#423).
  proposer               text        not null,

  -- The typed provenance: display line plus run / PR / ticket / import references.
  provenance             jsonb       not null,

  -- Who confirmed it, and when — "confirmed by Ken, 6w ago". Set by the confirming write.
  confirmed_by           text        references ouroboros."user" ("id") on delete set null,
  confirmed_at           timestamptz,

  -- Why it expired — "Zephyr 4.1 migration". Exactly when status = expired.
  expired_reason         text,

  -- The snapshot at expiry — "was used 31×". Exactly when status = expired.
  previous_use_count     integer,

  -- The expired fact this proposal re-learns. Fixed at insert.
  relearned_from_fact_id uuid,

  -- The actor and reason of the latest status change, written with it; the audit copies them.
  status_changed_by      text        references ouroboros."user" ("id") on delete set null,
  status_reason          text,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint facts_id_organization_key unique (id, organization_id),

  constraint facts_text_present
    check (btrim(text) <> '' and length(text) <= 500),

  constraint facts_status_valid
    check (status in ('proposed', 'confirmed', 'rejected', 'stale', 'expired')),

  constraint facts_proposer_valid
    check (proposer in ('manual', 'correction_note', 'waiver', 'steer', 'import', 'llm')),

  constraint facts_provenance_typed
    check (ouroboros.fact_provenance_typed(provenance)),

  -- A fact that is or was confirmed carries the stamp; a proposal or a rejection does not.
  constraint facts_confirmed_stamp
    check ((confirmed_at is not null) = (status in ('confirmed', 'stale', 'expired'))),

  constraint facts_confirmed_by_stamped
    check (confirmed_by is null or confirmed_at is not null),

  constraint facts_expired_reason
    check ((status = 'expired') = (expired_reason is not null)
           and (expired_reason is null
                or (btrim(expired_reason) <> '' and length(expired_reason) <= 200))),

  constraint facts_expired_use_count
    check ((status = 'expired') = (previous_use_count is not null)
           and (previous_use_count is null or previous_use_count >= 0)),

  constraint facts_status_reason_present
    check (status_reason is null
           or (btrim(status_reason) <> '' and length(status_reason) <= 500)),

  constraint facts_relearn_not_self
    check (relearned_from_fact_id is distinct from id),

  -- The expired fact re-learned, of this workspace. Its deletion forgets the lineage only.
  constraint facts_relearned_from_fk
    foreign key (relearned_from_fact_id, organization_id)
    references ouroboros.facts (id, organization_id)
    on delete set null (relearned_from_fact_id)
);

comment on table ouroboros.facts is
  'Learned facts with a lifecycle (#406, BE.2, decisions K3/K4) — mockup 14''s "Learned by the loop" card. Born proposed, moved only along K3''s edges (facts_legal_transition), every change audited in fact_transitions, provenance typed, expiry snapshotting the use count. Usage is counted from context_injections; previous_use_count is the one stored number.';
comment on column ouroboros.facts.organization_id is
  'The workspace. ON DELETE CASCADE — a fact takes its anchors and its audit with it.';
comment on column ouroboros.facts.repo_ref is
  'The repository the fact is about (owner/name, V067''s domain), or null for the whole workspace. A label rather than a foreign key, as skills.repo_ref is.';
comment on column ouroboros.facts.text is
  'The fact as written, inline-code spans preserved: "CI needs `west update` before first build of the day". Non-blank, at most 500 characters.';
comment on column ouroboros.facts.status is
  'proposed | confirmed | rejected | stale | expired. Inserted proposed; moved only along proposed→confirmed|rejected, confirmed→stale, stale→expired|confirmed (facts_legal_transition). Only confirmed facts are injected.';
comment on column ouroboros.facts.proposer is
  'manual | correction_note | waiver | steer | import | llm. llm is reserved for #423''s proposer, so that upgrade needs no migration.';
comment on column ouroboros.facts.provenance is
  'Typed provenance — {"line": "from PR #498 review cycle", "refs": [{"kind": "pull_request", "id": …}, …]}. See fact_provenance_typed; run, PR and ticket ids resolve to this workspace (facts_provenance_resolves).';
comment on column ouroboros.facts.confirmed_by is
  'Who confirmed (or last re-confirmed) the fact — "user".id, ON DELETE SET NULL. The Ken of "confirmed by Ken".';
comment on column ouroboros.facts.confirmed_at is
  'When the fact was confirmed — the 6w of "6w ago". Set exactly while status is confirmed, stale or expired (facts_confirmed_stamp).';
comment on column ouroboros.facts.expired_reason is
  'Why the fact expired — "Zephyr 4.1 migration". Required exactly when status = expired, and frozen with it.';
comment on column ouroboros.facts.previous_use_count is
  'The injection count snapshotted at expiry — "was used 31×". Required exactly when status = expired, and frozen with it: an expired fact is no longer injected, so a live count would drift downward as a window rolled.';
comment on column ouroboros.facts.relearned_from_fact_id is
  'The expired fact this proposal re-learns — the Re-learn button''s lineage. Must name an expired fact of this workspace at insert (facts_relearn_from_expired) and never changes afterwards; set null only when that fact is deleted.';
comment on column ouroboros.facts.status_changed_by is
  'The person behind the latest status change, written in the same statement as it (a writer that leaves it alone attributes the change to the previous actor — the sweep sets it null) and copied into fact_transitions.actor_id. Required for confirmed, rejected and expired (facts_transition_actor); null for the sweep''s stale.';
comment on column ouroboros.facts.status_reason is
  'Why the latest status change was made, copied into fact_transitions.reason. Optional.';
comment on constraint facts_confirmed_stamp on ouroboros.facts is
  'A fact that is or was confirmed — confirmed, stale, expired — carries confirmed_at; a proposal or a rejection does not (#406).';
comment on constraint facts_expired_reason on ouroboros.facts is
  'Moving to expired requires a reason, and only an expired fact has one (#406).';
comment on constraint facts_expired_use_count on ouroboros.facts is
  'Moving to expired requires the previous_use_count snapshot, and only an expired fact has one (#406) — the "was used 31×" the struck-through row renders forever after.';
comment on constraint facts_relearned_from_fk on ouroboros.facts is
  'Re-learn lineage stays inside the workspace (#406). ON DELETE SET NULL of the lineage column alone, so deleting the old fact does not orphan the new one''s tenancy.';

create index facts_organization_status_idx
  on ouroboros.facts (organization_id, status);

comment on index ouroboros.facts_organization_status_idx is
  'The card''s read path: a workspace''s facts by status — confirmed for assembly, proposed for "2 awaiting review" (#406).';

create index facts_relearned_from_idx
  on ouroboros.facts (relearned_from_fact_id)
  where relearned_from_fact_id is not null;

comment on index ouroboros.facts_relearned_from_idx is
  'Re-learn lineage, read from the expired fact forwards, and the index the set-null on delete needs (#406).';

-- ---------------------------------------------------------------------------
-- The legal transitions, and the actor they need
-- ---------------------------------------------------------------------------
create function ouroboros.facts_guard_transition() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- Every fact starts as a proposal: "and you approve" is the only way to confirmed.
    if new.status is distinct from 'proposed' then
      raise exception 'a fact is created proposed, not %', new.status
        using errcode = 'check_violation', constraint = 'facts_legal_transition';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if not ((old.status, new.status) in (('proposed', 'confirmed'), ('proposed', 'rejected'),
                                      ('confirmed', 'stale'),
                                      ('stale', 'expired'), ('stale', 'confirmed'))) then
    raise exception 'a fact cannot move from % to %', old.status, new.status
      using errcode = 'check_violation', constraint = 'facts_legal_transition',
            hint = 'proposed→confirmed|rejected, confirmed→stale, stale→expired|confirmed. Re-learn inserts a new proposal.';
  end if;

  -- The human gates name their human. Only the sweep's stale may be nobody's.
  if new.status in ('confirmed', 'rejected', 'expired') and new.status_changed_by is null then
    raise exception 'moving a fact to % needs the person who did it in status_changed_by',
      new.status
      using errcode = 'check_violation', constraint = 'facts_transition_actor';
  end if;

  return new;
end;
$$;

comment on function ouroboros.facts_guard_transition() is
  'BEFORE INSERT OR UPDATE OF status trigger for facts (#406, K3): a fact is inserted proposed, and moves only proposed→confirmed|rejected, confirmed→stale, stale→expired|confirmed — anything else raises class 23 naming facts_legal_transition. confirmed, rejected and expired need status_changed_by (facts_transition_actor).';

create trigger facts_legal_transition
  before insert or update of status on ouroboros.facts
  for each row execute function ouroboros.facts_guard_transition();

-- ---------------------------------------------------------------------------
-- Re-learn lineage: from an expired fact, fixed at insert
-- ---------------------------------------------------------------------------
create function ouroboros.facts_guard_relearn() returns trigger
language plpgsql as $$
begin
  if new.relearned_from_fact_id is null then
    return new;
  end if;

  -- Lineage is written once, at insert; the foreign key's set-null is the only later change.
  if tg_op = 'UPDATE' then
    if new.relearned_from_fact_id is distinct from old.relearned_from_fact_id then
      raise exception 'a fact''s re-learn lineage is fixed when it is proposed'
        using errcode = 'check_violation', constraint = 'facts_relearn_from_expired';
    end if;
    return new;
  end if;

  if not exists (select 1 from ouroboros.facts
                  where id = new.relearned_from_fact_id and status = 'expired') then
    raise exception 'fact % can only be re-learned once it has expired',
      new.relearned_from_fact_id
      using errcode = 'check_violation', constraint = 'facts_relearn_from_expired';
  end if;

  return new;
end;
$$;

comment on function ouroboros.facts_guard_relearn() is
  'BEFORE INSERT OR UPDATE OF relearned_from_fact_id trigger for facts (#406): a re-learn proposal names an expired fact, and its lineage never changes afterwards (the foreign key''s set-null excepted). Raises class 23 naming facts_relearn_from_expired.';

create trigger facts_relearn_from_expired
  before insert or update of relearned_from_fact_id on ouroboros.facts
  for each row execute function ouroboros.facts_guard_relearn();

-- ---------------------------------------------------------------------------
-- Provenance refs resolve to this workspace's runs, PRs and tickets
-- ---------------------------------------------------------------------------
create function ouroboros.facts_guard_provenance() returns trigger
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
  'BEFORE INSERT OR UPDATE OF provenance, organization_id trigger for facts (#406): every run, pull_request and ticket reference in provenance.refs names a row of the fact''s own workspace when written. Raises 23503 naming facts_provenance_resolves. Leaves a malformed document to the facts_provenance_typed CHECK, which fires after BEFORE triggers.';

create trigger facts_provenance_resolves
  before insert or update of provenance, organization_id on ouroboros.facts
  for each row execute function ouroboros.facts_guard_provenance();

-- ---------------------------------------------------------------------------
-- An expired fact is frozen
-- ---------------------------------------------------------------------------
create function ouroboros.facts_refuse_expired_update() returns trigger
language plpgsql as $$
begin
  if old.status is distinct from 'expired' then
    return new;
  end if;

  -- The foreign keys' own set-nulls (confirmed_by, status_changed_by, the lineage) and the
  -- touch trigger's updated_at may move; what the struck-through row renders may not.
  if row(new.organization_id, new.repo_ref, new.text, new.status, new.proposer,
         new.provenance, new.confirmed_at, new.expired_reason, new.previous_use_count,
         new.status_reason, new.created_at)
     is not distinct from
     row(old.organization_id, old.repo_ref, old.text, old.status, old.proposer,
         old.provenance, old.confirmed_at, old.expired_reason, old.previous_use_count,
         old.status_reason, old.created_at)
     and (new.confirmed_by is not distinct from old.confirmed_by or new.confirmed_by is null)
     and (new.status_changed_by is not distinct from old.status_changed_by
          or new.status_changed_by is null)
  then
    return new;
  end if;

  raise exception 'an expired fact is frozen: fact % cannot be revised', old.id
    using errcode = 'restrict_violation',
          hint    = 'Re-learn it instead — insert a proposal with relearned_from_fact_id. See V071__facts_injections.sql (#406).';
end;
$$;

comment on function ouroboros.facts_refuse_expired_update() is
  'Refuses every revision of an expired fact (#406) — its text, provenance, reason and previous_use_count snapshot above all, so "was used 31×" never changes. The foreign keys'' set-nulls pass. Raises 23001.';

create trigger facts_expired_frozen
  before update on ouroboros.facts
  for each row execute function ouroboros.facts_refuse_expired_update();

create trigger facts_touch_updated_at
  before update on ouroboros.facts
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- fact_transitions — the audit
-- ---------------------------------------------------------------------------
create table ouroboros.fact_transitions (
  id          uuid        primary key default gen_random_uuid(),

  -- The fact, and the whole of this row's tenancy. Cascade: the audit goes with its fact.
  fact_id     uuid        not null references ouroboros.facts (id) on delete cascade,

  -- Null on the row that records the fact's creation.
  from_status text,
  to_status   text        not null,

  -- Who did it; null for the sweep. Set null when the person is removed.
  actor_id    text        references ouroboros."user" ("id") on delete set null,

  reason      text,

  -- The wall clock, not the transaction's: two moves in one transaction still sort in order.
  at          timestamptz not null default clock_timestamp(),

  constraint fact_transitions_from_status_valid
    check (from_status is null
           or from_status in ('proposed', 'confirmed', 'rejected', 'stale', 'expired')),

  constraint fact_transitions_to_status_valid
    check (to_status in ('proposed', 'confirmed', 'rejected', 'stale', 'expired')),

  constraint fact_transitions_moves
    check (from_status is distinct from to_status)
);

comment on table ouroboros.fact_transitions is
  'Every fact status change, with its actor (#406) — the record "confirmed by Ken, 6w ago" renders. Written only by fact_transitions_record() on a facts insert or status change; append-only by trigger and by grant.';
comment on column ouroboros.fact_transitions.from_status is
  'The status before; null on the row recording the fact''s creation as proposed.';
comment on column ouroboros.fact_transitions.actor_id is
  'Who made the change — facts.status_changed_by at the time. Null for the staleness sweep; set null, the one permitted update, when a person is removed.';
comment on column ouroboros.fact_transitions.reason is
  'facts.status_reason at the time.';

create index fact_transitions_fact_at_idx
  on ouroboros.fact_transitions (fact_id, at);

comment on index ouroboros.fact_transitions_fact_at_idx is
  'A fact''s history in order (#406), and the index the cascade from facts needs.';

create function ouroboros.fact_transitions_record() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
begin
  insert into ouroboros.fact_transitions (fact_id, from_status, to_status, actor_id, reason)
  values (new.id,
          case when tg_op = 'UPDATE' then old.status end,
          new.status,
          new.status_changed_by,
          new.status_reason);
  return null;
end;
$$;

comment on function ouroboros.fact_transitions_record() is
  'AFTER INSERT and AFTER UPDATE OF status trigger for facts (facts_record_creation, facts_record_transition — #406): appends the fact_transitions row — from, to, status_changed_by as the actor, status_reason. SECURITY DEFINER with a pinned search_path so ouroboros_app needs no insert grant on the audit, and therefore cannot write one that no transition made. execute is revoked from public.';

-- Two triggers because a WHEN clause may not name OLD on an insert: the creation, and each move.
create trigger facts_record_creation
  after insert on ouroboros.facts
  for each row execute function ouroboros.fact_transitions_record();

create trigger facts_record_transition
  after update of status on ouroboros.facts
  for each row
  when (old.status is distinct from new.status)
  execute function ouroboros.fact_transitions_record();

revoke execute on function ouroboros.fact_transitions_record() from public;

create function ouroboros.fact_transitions_refuse_update() returns trigger
language plpgsql as $$
begin
  -- The actor foreign key's own ON DELETE SET NULL, with nothing else moving.
  if new.actor_id is null and old.actor_id is not null
     and row(new.id, new.fact_id, new.from_status, new.to_status, new.reason, new.at)
         is not distinct from
         row(old.id, old.fact_id, old.from_status, old.to_status, old.reason, old.at)
  then
    return new;
  end if;

  raise exception 'ouroboros.fact_transitions is append-only: row % cannot be revised', old.id
    using errcode = 'restrict_violation';
end;
$$;

comment on function ouroboros.fact_transitions_refuse_update() is
  'Refuses every UPDATE of a fact transition for every role including the owner (#406, V022''s argument) except clearing actor_id — the foreign key''s own set-null. Raises 23001.';

create trigger fact_transitions_no_update
  before update on ouroboros.fact_transitions
  for each row execute function ouroboros.fact_transitions_refuse_update();

-- ---------------------------------------------------------------------------
-- fact_anchors
-- ---------------------------------------------------------------------------
create table ouroboros.fact_anchors (
  id              uuid        primary key default gen_random_uuid(),

  -- The fact this anchor can expire. Cascade.
  fact_id         uuid        not null references ouroboros.facts (id) on delete cascade,

  -- path_glob | dependency | platform_version.
  kind            text        not null,

  -- `boards/**/Kconfig`, `zephyr`, `zephyr-4.0`.
  value           text        not null,

  -- When the sweep last evaluated this anchor. Null until it has.
  last_checked_at timestamptz,

  created_at      timestamptz not null default now(),

  constraint fact_anchors_fact_kind_value_key unique (fact_id, kind, value),

  constraint fact_anchors_kind_valid
    check (kind in ('path_glob', 'dependency', 'platform_version')),

  constraint fact_anchors_value_present
    check (btrim(value) = value and value <> '' and length(value) <= 512
           and value !~ '[[:cntrl:]]'),

  -- A path glob is repository-relative, forward-slashed and stays inside the repository —
  -- V067's protected_path_policies shape.
  constraint fact_anchors_path_glob_shape
    check (kind <> 'path_glob'
           or (left(value, 1) <> '/' and strpos(value, '\') = 0
               and value !~ '(^|/)\.\.(/|$)'))
);

comment on table ouroboros.fact_anchors is
  'Why a fact can expire (#406, decision K4): a path_glob, dependency or platform_version the staleness sweep (#411) watches. The mockup''s expired row is a platform_version anchor on zephyr-4.0. A fact with no anchors is valid and never flagged stale.';
comment on column ouroboros.fact_anchors.kind is
  'path_glob (matched with path_glob_matches against a changed path set) | dependency (a package name, matched by equality) | platform_version (e.g. zephyr-4.0, fired when the repository no longer builds on it).';
comment on column ouroboros.fact_anchors.value is
  'The glob, dependency name or platform version. Trimmed, non-blank, at most 512; a path_glob is relative, forward-slashed and has no .. segment.';
comment on column ouroboros.fact_anchors.last_checked_at is
  'When the sweep last evaluated this anchor; null until it has.';

create index fact_anchors_kind_value_idx
  on ouroboros.fact_anchors (kind, value);

comment on index ouroboros.fact_anchors_kind_value_idx is
  'The staleness sweep''s lookup (#406): every anchor of a kind — every path_glob to test against a changed path set — and dependency / platform_version anchors by value.';

-- ---------------------------------------------------------------------------
-- context_injections
-- ---------------------------------------------------------------------------
create function ouroboros.uuid_array_is_set(ids uuid[]) returns boolean
language sql immutable parallel safe as $$
  select ids is not null
     and array_position(ids, null) is null
     and cardinality(ids) = (select count(distinct x) from unnest(ids) as x)
     and cardinality(ids) <= 512
$$;

comment on function ouroboros.uuid_array_is_set(uuid[]) is
  'True when a uuid array is a set: not null, no null element, no duplicate, at most 512 elements (#406) — the shape of a manifest''s skill-version and fact id lists.';

create table ouroboros.context_injections (
  id                uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade.
  organization_id   text        not null
                                references ouroboros.organization ("id") on delete cascade,

  -- estimator | run_stage | playbook — who assembled this manifest.
  consumer          text        not null,

  -- The consumer's reference (context_injections_consumer_ref says which are set).
  estimate_id       uuid        references ouroboros.issue_estimates (id) on delete cascade,
  run_stage_id      uuid        references ouroboros.run_stages (id) on delete cascade,
  run_id            uuid        references ouroboros.runs (id) on delete cascade,

  -- The manifest as executed.
  skill_version_ids uuid[]      not null default '{}',
  fact_ids          uuid[]      not null default '{}',

  -- sha256 of the assembled manifest, lower-case hex.
  manifest_hash     text        not null,

  injected_at       timestamptz not null default now(),

  constraint context_injections_consumer_valid
    check (consumer in ('estimator', 'run_stage', 'playbook')),

  -- estimator → an estimate; run_stage → a stage and its run; playbook → the launched run.
  constraint context_injections_consumer_ref
    check (case consumer
             when 'estimator' then estimate_id is not null
                                   and run_stage_id is null and run_id is null
             when 'run_stage' then run_stage_id is not null and run_id is not null
                                   and estimate_id is null
             when 'playbook'  then run_id is not null
                                   and estimate_id is null and run_stage_id is null
           end),

  constraint context_injections_skill_versions_set
    check (ouroboros.uuid_array_is_set(skill_version_ids)),

  constraint context_injections_facts_set
    check (ouroboros.uuid_array_is_set(fact_ids)),

  constraint context_injections_manifest_hash_format
    check (manifest_hash ~ '^[0-9a-f]{64}$')
);

comment on table ouroboros.context_injections is
  'What context assembly actually injected, one row per assembled manifest (#406) — the sole source of every usage number in the product: "used 48×" counts rows whose fact_ids contain the fact, "61% of runs" is the share of runs whose rows contain a version of the skill. Append-only by trigger and by grant.';
comment on column ouroboros.context_injections.consumer is
  'estimator (names estimate_id) | run_stage (names run_stage_id and its run_id) | playbook (names run_id, the run the playbook launched — BE.3''s playbook_id rides on it).';
comment on column ouroboros.context_injections.run_id is
  'The run this manifest was injected into — set for run_stage (the stage''s own run, context_injections_resolves) and playbook rows, so "% of runs" is a count of distinct run_id.';
comment on column ouroboros.context_injections.skill_version_ids is
  'The skill_versions injected: published versions of non-draft skills of this workspace, no duplicates (context_injections_resolves, context_injections_skill_versions_set).';
comment on column ouroboros.context_injections.fact_ids is
  'The facts injected: confirmed facts of this workspace, no duplicates. Only confirmed facts inject (K3).';
comment on column ouroboros.context_injections.manifest_hash is
  'sha256 of the manifest as assembled, 64 lower-case hex characters — what makes two injections comparable without comparing their text.';

create index context_injections_fact_ids_idx
  on ouroboros.context_injections using gin (fact_ids);

comment on index ouroboros.context_injections_fact_ids_idx is
  '"used 48×": the rows whose fact_ids contain a fact (#406).';

create index context_injections_skill_version_ids_idx
  on ouroboros.context_injections using gin (skill_version_ids);

comment on index ouroboros.context_injections_skill_version_ids_idx is
  '"61% of runs": the rows whose skill_version_ids contain a version of a skill (#406).';

create index context_injections_organization_injected_idx
  on ouroboros.context_injections (organization_id, injected_at);

comment on index ouroboros.context_injections_organization_injected_idx is
  'A workspace''s injections over a window — the denominator of "% of runs" and #427''s analytics (#406).';

create index context_injections_run_idx
  on ouroboros.context_injections (run_id) where run_id is not null;
create index context_injections_run_stage_idx
  on ouroboros.context_injections (run_stage_id) where run_stage_id is not null;
create index context_injections_estimate_idx
  on ouroboros.context_injections (estimate_id) where estimate_id is not null;

create function ouroboros.context_injections_guard_resolves() returns trigger
language plpgsql as $$
declare
  estimate_org text;
  bad          uuid;
begin
  -- A malformed manifest is the set CHECKs' complaint; BEFORE triggers run before them.
  if not coalesce(ouroboros.uuid_array_is_set(new.fact_ids), false)
     or not coalesce(ouroboros.uuid_array_is_set(new.skill_version_ids), false) then
    return new;
  end if;

  -- The consumer's reference is this workspace's.
  if new.run_id is not null
     and not exists (select 1 from ouroboros.runs
                      where id = new.run_id and organization_id = new.organization_id) then
    raise exception 'run % is not a run of workspace %', new.run_id, new.organization_id
      using errcode = 'foreign_key_violation', constraint = 'context_injections_resolves';
  end if;

  -- A stage without its run is context_injections_consumer_ref's complaint, not this one's.
  if new.run_stage_id is not null and new.run_id is not null
     and not exists (select 1 from ouroboros.run_stages
                      where id = new.run_stage_id and run_id = new.run_id) then
    raise exception 'run stage % is not a stage of run %', new.run_stage_id, new.run_id
      using errcode = 'foreign_key_violation', constraint = 'context_injections_resolves';
  end if;

  if new.estimate_id is not null then
    -- An estimate sizes a GitHub issue, a canonical ticket or a draft (V026, V034, V038).
    select coalesce(gi.organization_id, t.organization_id, db.organization_id)
      into estimate_org
      from ouroboros.issue_estimates e
      left join ouroboros.github_issues gi on gi.id = e.github_issue_id
      left join ouroboros.tickets t on t.id = e.ticket_id
      left join ouroboros.ticket_drafts d on d.id = e.draft_id
      left join ouroboros.draft_batches db on db.id = d.batch_id
     where e.id = new.estimate_id;

    if estimate_org is distinct from new.organization_id then
      raise exception 'estimate % is not an estimate of workspace %',
        new.estimate_id, new.organization_id
        using errcode = 'foreign_key_violation', constraint = 'context_injections_resolves';
    end if;
  end if;

  -- Only confirmed facts of this workspace are injected (K3).
  select x into bad
    from unnest(new.fact_ids) as x
   where not exists (select 1 from ouroboros.facts f
                      where f.id = x and f.organization_id = new.organization_id
                        and f.status = 'confirmed')
   limit 1;
  if found then
    raise exception 'fact % is not a confirmed fact of workspace %', bad, new.organization_id
      using errcode = 'foreign_key_violation', constraint = 'context_injections_resolves';
  end if;

  -- Only published versions of this workspace's non-draft skills are injected (V069).
  select x into bad
    from unnest(new.skill_version_ids) as x
   where not exists (select 1 from ouroboros.skill_versions v
                       join ouroboros.skills s on s.id = v.skill_id
                      where v.id = x and v.version is not null and not s.draft
                        and s.organization_id = new.organization_id)
   limit 1;
  if found then
    raise exception 'skill version % is not a published version of a non-draft skill of workspace %',
      bad, new.organization_id
      using errcode = 'foreign_key_violation', constraint = 'context_injections_resolves';
  end if;

  return new;
end;
$$;

comment on function ouroboros.context_injections_guard_resolves() is
  'BEFORE INSERT trigger for context_injections (#406): the run, run stage (of that run) and estimate are this workspace''s; every fact_ids element is a confirmed fact of the workspace (K3); every skill_version_ids element is a published version of a non-draft skill of the workspace (V069). Raises 23503 naming context_injections_resolves.';

create trigger context_injections_resolves
  before insert on ouroboros.context_injections
  for each row execute function ouroboros.context_injections_guard_resolves();

create function ouroboros.context_injections_refuse_update() returns trigger
language plpgsql as $$
begin
  raise exception 'ouroboros.context_injections is append-only: row % cannot be revised', old.id
    using errcode = 'restrict_violation',
          hint    = 'An injection record is what was injected; record the next one instead. See V071__facts_injections.sql (#406).';
end;
$$;

comment on function ouroboros.context_injections_refuse_update() is
  'Refuses every UPDATE of an injection record for every role including the owner (#406): usage is counted from these rows, so revising one would be rewriting how often something was used. Raises 23001.';

create trigger context_injections_no_update
  before update on ouroboros.context_injections
  for each row execute function ouroboros.context_injections_refuse_update();

-- ---------------------------------------------------------------------------
-- The service role's grants
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update on ouroboros.facts to ouroboros_app;
grant select, insert, update, delete on ouroboros.fact_anchors to ouroboros_app;
grant select on ouroboros.fact_transitions to ouroboros_app;
grant select, insert on ouroboros.context_injections to ouroboros_app;

revoke delete on ouroboros.facts from ouroboros_app;
revoke delete on ouroboros.facts from public;
revoke insert, update, delete on ouroboros.fact_transitions from ouroboros_app;
revoke insert, update, delete on ouroboros.fact_transitions from public;
revoke update, delete on ouroboros.context_injections from ouroboros_app;
revoke update, delete on ouroboros.context_injections from public;

grant execute on function ouroboros.fact_provenance_typed(jsonb) to ouroboros_app;
grant execute on function ouroboros.path_glob_matches(text, text) to ouroboros_app;
grant execute on function ouroboros.uuid_array_is_set(uuid[]) to ouroboros_app;
