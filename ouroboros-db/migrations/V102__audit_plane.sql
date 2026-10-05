-- V102__audit_plane.sql — the audit log becomes readable: a stored actor kind, a plane column,
-- the indexes the query API filters on, and the purge the `audit` retention tier governs
-- (BR.2, #486; delivers the surface #26 deferred).
--
-- `audit_events` (V022, #225) has had many writers and one narrow reader, the credential trail.
-- BR.2 opens it to the Settings page's Audit Log card: filterable keyset-paged queries, a streamed
-- CSV export, and the 400-day retention tier. Four things the table did not have yet:
--
--   1. **`actor_kind`** — `human | bot | service | system`, stored rather than derived. Derived
--      from `actor_id`/`actor_service` at read time it would be wrong in exactly one case and that
--      case matters: `actor_id` is `on delete set null`, so a person who leaves would turn every
--      event they performed into a *system* event. Stored, the row keeps saying a human did it
--      after the attribution is erased. `bot` is the GitHub App the loop pushes through
--      (`actor_service = 'ouroboros-app'`, which has no service-account row — V091 made the column
--      a name for that reason); `service` is a service account (#485). REST writes the kind
--      explicitly; `audit_events_derive_actor_kind` fills it for the SQL writers (V048, V058,
--      V064 triggers) that predate it, by the same rule. Existing rows are backfilled by that rule.
--
--   2. **`plane`** — the action's family (`policy` for `policy.published`), a stored generated
--      column, so *everything on the policy plane* is an index lookup rather than a prefix match
--      against text whose ordering depends on the database's collation.
--
--   3. **Indexes for the query API's exact access patterns**, each leading with the workspace and
--      ending in V022's `(occurred_at desc, id desc)` page order, so every filter is a range scan
--      that is already in keyset order: actor kind, a person, a service or bot, a plane, a subject.
--      References inside `detail` (`pr_number`, `run_id`, `repo`) are a GIN containment index.
--      V022 declined to create an index nothing read; these have a reader.
--
--   4. **`audit_events_purge()`** — the audit retention sweep's one write. The application role
--      holds no `delete` on this table (V022), and must not gain one: a definer function deletes
--      only rows older than a cutoff, refuses a cutoff inside the tier's 90-day floor, and holds
--      back any event another table still references (`analysis_suggestions.applied_event_id` has
--      no cascade, and `analysis_suggestion_applications` would cascade away an applied record).
--      Held rows are reported, never silently kept or silently removed.
--
-- Reconciles #26: `audit_events` is #26's shape (V022's header) plus `ip` (V022), `actor_service`
-- (V091), and now `actor_kind` and `plane`. #26's BRIN on `occurred_at` is superseded — the purge
-- runs per workspace through `audit_events_organization_occurred_at_idx`.

-- ---------------------------------------------------------------------------
-- 1. actor_kind — what kind of actor did it, kept after the person is erased.
-- ---------------------------------------------------------------------------
alter table ouroboros.audit_events
  add column actor_kind text;

-- The backfill is an UPDATE, which `audit_events_no_update` refuses from every role. It is the
-- migration's own statement, run once as the owner, and it only fills a column that did not exist.
alter table ouroboros.audit_events disable trigger audit_events_no_update;

update ouroboros.audit_events
   set actor_kind = case
                      when actor_id is not null then 'human'
                      when actor_service = 'ouroboros-app' then 'bot'
                      when actor_service is not null then 'service'
                      else 'system'
                    end;

alter table ouroboros.audit_events enable trigger audit_events_no_update;

alter table ouroboros.audit_events
  alter column actor_kind set not null,
  add constraint audit_events_actor_kind_known
    check (actor_kind in ('human', 'bot', 'service', 'system')),
  -- The kind agrees with the attribution. A human event may lose its actor_id (the set-null) and
  -- stays human; a bot or service event names its account; a system event names nobody.
  add constraint audit_events_actor_kind_consistent
    check (case actor_kind
             when 'human'  then actor_service is null
             when 'system' then actor_id is null and actor_service is null
             else actor_id is null and actor_service is not null
           end);

comment on column ouroboros.audit_events.actor_kind is
  'What kind of actor did it (#486): human (a person — kept after actor_id is erased), bot (the ouroboros-app GitHub App), service (a service account, #485) or system (nobody). Stored so erasing a person does not turn their events into system events; filled by audit_events_derive_actor_kind() when a writer omits it.';

create function ouroboros.audit_events_derive_actor_kind() returns trigger
language plpgsql
as $$
begin
  if new.actor_kind is null then
    new.actor_kind := case
                        when new.actor_id is not null then 'human'
                        when new.actor_service = 'ouroboros-app' then 'bot'
                        when new.actor_service is not null then 'service'
                        else 'system'
                      end;
  end if;

  return new;
end;
$$;

comment on function ouroboros.audit_events_derive_actor_kind() is
  'Fills audit_events.actor_kind on insert when the writer omitted it (#486) — the SQL writers that predate the column — by the rule REST applies: a person is human, ouroboros-app is the bot, another service name is a service account, nobody is system.';

create trigger audit_events_actor_kind
  before insert on ouroboros.audit_events
  for each row execute function ouroboros.audit_events_derive_actor_kind();

-- The append-only trigger compares an explicit column list (V022, V091), so the new column joins
-- it — otherwise an UPDATE could re-label what kind of actor did something. `plane` is generated
-- from `action`, which is already compared.
create or replace function ouroboros.audit_events_refuse_update() returns trigger
language plpgsql
as $$
begin
  -- The one update this table permits, and it is not a revision: `actor_id` going from a
  -- person to null, with every other column untouched (V022 explains why).
  if new.actor_id is null and old.actor_id is not null
     and row(new.id, new.organization_id, new.action, new.subject_type,
             new.subject_id, new.ip, new.detail, new.occurred_at, new.actor_service,
             new.actor_kind)
         is not distinct from
         row(old.id, old.organization_id, old.action, old.subject_type,
             old.subject_id, old.ip, old.detail, old.occurred_at, old.actor_service,
             old.actor_kind)
  then
    return new;
  end if;

  raise exception
    'ouroboros.audit_events is append-only: an audit event cannot be revised'
    using errcode = 'restrict_violation',
          detail  = format('refused update of event %s (%s) in organization %s',
                           old.id, old.action, old.organization_id),
          hint    = 'Record a correcting event instead; only actor_id may be cleared, and only by the foreign key''s own set-null. See V022__audit_events.sql (#225).';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. plane — the action's family, for the plane filter.
-- ---------------------------------------------------------------------------
alter table ouroboros.audit_events
  add column plane text generated always as (split_part(action, '.', 1)) stored;

comment on column ouroboros.audit_events.plane is
  'The action''s family — policy for policy.published (#486). Generated, so the plane filter (policy.*) is an index lookup rather than a collation-dependent prefix match.';

-- ---------------------------------------------------------------------------
-- 3. The query API's indexes. Every one leads with the workspace and ends in the page order.
-- ---------------------------------------------------------------------------
create index audit_events_org_actor_kind_idx
  on ouroboros.audit_events (organization_id, actor_kind, occurred_at desc, id desc);

create index audit_events_org_actor_idx
  on ouroboros.audit_events (organization_id, actor_id, occurred_at desc, id desc)
  where actor_id is not null;

create index audit_events_org_actor_service_idx
  on ouroboros.audit_events (organization_id, actor_service, occurred_at desc, id desc)
  where actor_service is not null;

create index audit_events_org_plane_idx
  on ouroboros.audit_events (organization_id, plane, occurred_at desc, id desc);

create index audit_events_org_subject_idx
  on ouroboros.audit_events (organization_id, subject_id, occurred_at desc, id desc)
  where subject_id is not null;

create index audit_events_detail_refs_idx
  on ouroboros.audit_events using gin (detail jsonb_path_ops);

comment on index ouroboros.audit_events_org_actor_kind_idx is
  'The audit plane''s actor-kind filter (#486) — a workspace''s human, bot, service or system events, newest first.';
comment on index ouroboros.audit_events_org_actor_idx is
  'The audit plane''s person filter (#486) — one actor_id''s events in a workspace, newest first.';
comment on index ouroboros.audit_events_org_actor_service_idx is
  'The audit plane''s bot/service filter (#486) — one service account''s or the bot''s events, newest first.';
comment on index ouroboros.audit_events_org_plane_idx is
  'The audit plane''s plane filter (#486) — policy.*, credential.* — newest first; also narrows an exact action filter.';
comment on index ouroboros.audit_events_org_subject_idx is
  'The audit plane''s reference search on the subject (#486) — a run, a repository, a provider key — newest first.';
comment on index ouroboros.audit_events_detail_refs_idx is
  'The audit plane''s reference search inside detail (#486) — {"pr_number": 509}, {"run_id": …}, {"repo": …} by containment.';

-- The purge deletes events by id; a foreign key pointing at them is checked on every delete, so the
-- referencing columns are indexed — and the purge reads them to hold referenced events back.
create index analysis_suggestions_applied_event_idx
  on ouroboros.analysis_suggestions (applied_event_id)
  where applied_event_id is not null;

create index analysis_suggestion_applications_event_idx
  on ouroboros.analysis_suggestion_applications (applied_event_id);

comment on index ouroboros.analysis_suggestions_applied_event_idx is
  'The applied suggestion''s audit event (#486) — the FK check when the audit purge deletes, and the purge''s hold-back test.';
comment on index ouroboros.analysis_suggestion_applications_event_idx is
  'The application''s audit event (#486) — the FK check when the audit purge deletes, and the purge''s hold-back test.';

-- ---------------------------------------------------------------------------
-- 4. audit_events_purge() — the audit retention sweep's one write.
-- ---------------------------------------------------------------------------
create function ouroboros.audit_events_purge(p_organization_id text, p_cutoff timestamptz,
                                             p_limit integer)
returns table (removed integer, held integer)
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
begin
  -- The floor, again, beneath the service: no cutoff may reach inside the last ninety days.
  if p_cutoff > now() - interval '90 days' then
    raise exception 'an audit cutoff of % is inside the 90-day retention floor', p_cutoff
      using errcode = 'check_violation',
            constraint = 'audit_events_purge_cutoff_floor',
            hint = 'The cutoff is RetentionPolicyService''s now() - days for the audit tier, and that tier is at least 90 days (#482, #486).';
  end if;

  if p_limit is null or p_limit < 1 then
    raise exception 'an audit purge batch must remove at least one row, not %', p_limit
      using errcode = 'check_violation',
            constraint = 'audit_events_purge_limit_positive';
  end if;

  return query
    with referenced as (
      select s.applied_event_id as id
        from ouroboros.analysis_suggestions s
       where s.organization_id = p_organization_id
         and s.applied_event_id is not null
      union
      select a.applied_event_id
        from ouroboros.analysis_suggestion_applications a
       where a.organization_id = p_organization_id
    ),
    expired as (
      select e.id
        from ouroboros.audit_events e
       where e.organization_id = p_organization_id
         and e.occurred_at < p_cutoff
         and e.id not in (select r.id from referenced r)
       order by e.occurred_at, e.id
       limit p_limit
         for update skip locked
    ),
    gone as (
      delete from ouroboros.audit_events e
       using expired x
       where e.id = x.id
      returning 1
    )
    select (select count(*) from gone)::integer,
           (select count(*)
              from ouroboros.audit_events e
             where e.organization_id = p_organization_id
               and e.occurred_at < p_cutoff
               and e.id in (select r.id from referenced r))::integer;
end;
$$;

comment on function ouroboros.audit_events_purge(text, timestamptz, integer) is
  'The audit retention sweep''s one write (#486): removes at most p_limit of the workspace''s events that occurred before p_cutoff, oldest first, and returns (removed, held) — held being the events past the cutoff kept because another table still references them. Refuses a cutoff inside the 90-day floor. Runs as the owner because the application role cannot delete from audit_events (V022).';

revoke execute on function ouroboros.audit_events_purge(text, timestamptz, integer) from public;
grant execute on function ouroboros.audit_events_purge(text, timestamptz, integer) to ouroboros_app;
