-- V067__onboarding_wizard_detections.sql — `onboarding_state`, `repo_detection_scans`,
-- `repo_detections` and `protected_path_policies`: the wizard's memory, the detection card's
-- evidence, and the protected paths a scan suggests.
--
-- Filed as issue #380 (BA.1) under epic #376 of the Onboarding roadmap
-- (docs/ROADMAP_MOCKUP_13_ONBOARDING.md), drawn from docs/mockups/13-onboarding.html: the step
-- rail and the *"We already figured this out"* card. Needs Q.1 (#138, canonical tickets). Read
-- and written by BB.1's detection service (#384) and BB.2's wizard API (#385); seeded by BA.4
-- (#383); `protected_path_policies` is read by AP.3's guardrail evaluation (#305, amended here).
--
--
-- Decision O1 — the wizard stores what only the wizard owns. **There are no step columns.**
-- ---------------------------------------------------------------------------
--
-- The obvious schema has `step_1_done boolean`, and it is wrong: a user finishes onboarding,
-- later removes the GitHub connection, comes back, and the rail still says
-- `✓ Connect GitHub · acme-robotics` — on the one screen whose job is showing that this product
-- tells the truth about a repository. So `onboarding_state` holds only the four things nothing
-- else owns (the template picked, the issue picked, dismissed, completed), and **every step
-- status is computed on read** from the subsystem that owns it. The derivation contract BB.2
-- (#385) implements:
--
--   | step                          | status is derived from                                      |
--   |-------------------------------|-------------------------------------------------------------|
--   | 1 Connect GitHub              | `github_orgs` (enabled, `installed_at`) and                 |
--   |                               | `github_credentials` for the workspace — never this table   |
--   | 2 Pick a repo                 | the `github_repos` row `repo_ref` names, and its `enabled`  |
--   | 3 Choose a starting workflow  | `onboarding_state.selected_template` — the one wizard-owned |
--   |                               | step, because a template choice has no other home           |
--   | 4 Run your first loop         | `runs` for that repository (and `picked_ticket_id`'s run)   |
--
-- **Do not cache the step states here.** *"It is one query"* is a genuinely tempting
-- optimisation, and it silently turns a truthful surface into one that lies the first time the
-- subsystem underneath changes without the wizard being told. A step column added to this table
-- is a regression of decision O1, and `tests/constraints.sql` asserts that none exists.
--
--
-- Per repository, not per workspace.
-- ---------------------------------------------------------------------------
--
-- The wizard is re-enterable: a team onboards `helios-firmware`, then a second repository three
-- weeks later, and wants the same guided path with its own detection and its own first issue.
-- Every table here is keyed by `(organization_id, repo_ref)`.
--
-- **`repo_ref` is `<owner>/<name>`** — `acme-robotics/helios-firmware` — text rather than a
-- foreign key to `github_repos`, for decision P6's reason (V030): the canonical intake model is
-- source-agnostic, and a GitLab project path (`group/sub/project`) is a repository too. The
-- `ouroboros.repo_ref` domain below holds its grammar once for all four tables. For a GitHub
-- repository it is `github_orgs.login || '/' || github_repos.name`, which is the join AP.3's
-- guardrail read uses.
--
--
-- Decision O2 — detection rows carry their proof, and their honesty label is a column.
-- ---------------------------------------------------------------------------
--
-- `west + twister (found west.yml)` is a conclusion with its evidence attached, and when
-- detection is wrong on somebody's unusual repository the difference between a support
-- conversation and a mystery is whether the row can say *which probe hit*. So `evidence` is
-- jsonb — probe paths, hit/miss, API payload references — checked to be an object and no
-- further: the rule packs (BB.1) own its shape, and a grammar spelled here would need a
-- migration for every new probe.
--
-- `label` is `detected | measured`. The mockup's `env ready in 38s (snapshotted)` is not
-- something the MVP measures — detection only sees that a `.devcontainer.json` exists and parses
-- (O2, option 2-A) — so the distinction is structural: BD.4 flips an individual row to
-- `measured` when the farm really prebuilds and times it, with an `update`, and no UI has to
-- guess which rows earned the word.
--
-- **Re-scans version, they do not overwrite.** A scan is a `repo_detection_scans` row numbered
-- by `scan_seq`, and its detections hang off it, so the previous scan stays inspectable. The
-- scan row carries the scan-level metadata — `duration_ms` (the card's `scanned in 38s` is data),
-- the rule-pack versions and the probe budget consumed — once, rather than repeated on each of
-- its six rows. `repo_detections_latest` is the card's read path.
--
-- `row_key` is the six mockup rows plus a `custom:<name>` escape, so a future rule pack stores
-- its own rows without a migration.
--
--
-- Protected paths are policy, not a detection artefact.
-- ---------------------------------------------------------------------------
--
-- `boot/, keys/ suggested · edit` means the suggestion becomes something the user owns and the
-- rest of the system enforces. So the globs live in their own table with `suggested | edited`
-- provenance, and **AP.3's `allowed_paths` check reads them** (the #305 amendment): a change that
-- touches a protected path fails, whatever the plan declares. An `edited` row never goes back to
-- `suggested`, so a re-scan cannot overwrite what a person chose.
--
-- The glob grammar is AP.3's (`ouroboros-rest/src/modules/guardrails/guardrails.glob.ts`):
-- `**`, `*`, `?`, everything else literal, relative to the repository root.
--
-- **Absorbed later by the org policy document.** BQ.1 (#480) makes `protected_paths` a rule in
-- the versioned org policy document, and the wizard then writes through to it rather than owning
-- a separate store (#380's amendment comment). BQ.1's migration documents that absorption; until
-- it lands, this table is the store.

-- ---------------------------------------------------------------------------
-- repo_ref — a repository, named source-agnostically.
--
-- `owner/name`, or deeper for a nested namespace. Each segment is what git hosts accept in a
-- name; `.` and `..` segments are refused because they are paths, not names.
-- ---------------------------------------------------------------------------
create domain ouroboros.repo_ref as text
  constraint repo_ref_format
    check (value ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)+$'
           and value !~ '(^|/)\.\.?(/|$)'
           and length(value) <= 255);

comment on domain ouroboros.repo_ref is
  'A repository, named source-agnostically as owner/name (#380): acme-robotics/helios-firmware, or group/sub/project for a nested namespace. For GitHub it is github_orgs.login || ''/'' || github_repos.name.';

-- ---------------------------------------------------------------------------
-- onboarding_state — the wizard's memory, one row per repository.
-- ---------------------------------------------------------------------------
create table ouroboros.onboarding_state (
  id                uuid              primary key default gen_random_uuid(),

  -- Cascade, the posture of every extension table since V006: a deleted workspace takes its
  -- wizard progress with it.
  organization_id   text              not null
                                      references ouroboros.organization ("id") on delete cascade,

  repo_ref          ouroboros.repo_ref not null,

  -- The starting workflow the user picked in step 3 — `quick-fixes`. A template slug, and
  -- wizard-local: nothing else records the choice. Null until picked.
  selected_template text,

  -- The first issue to run — `#488`. The canonical ticket (V030), so a Jira- or Linear-sourced
  -- issue is picked exactly as a GitHub one is. Set null rather than cascade: a ticket that
  -- disappears un-picks itself and leaves the rest of the wizard's memory alone.
  picked_ticket_id  uuid              references ouroboros.tickets (id) on delete set null,

  -- The wizard's lifecycle. Dismissed is a person's choice to stop being shown the wizard;
  -- completed is when they finished it. Independent: a completed wizard can also be dismissed.
  dismissed         boolean           not null default false,
  completed_at      timestamptz,

  created_at        timestamptz       not null default now(),
  updated_at        timestamptz       not null default now(),

  constraint onboarding_state_organization_repo_key
    unique (organization_id, repo_ref),

  constraint onboarding_state_template_slug
    check (selected_template is null or selected_template ~ '^[a-z0-9][a-z0-9-]{0,63}$'),

  constraint onboarding_state_completed_after_created
    check (completed_at is null or completed_at >= created_at)
);

comment on table ouroboros.onboarding_state is
  'The onboarding wizard''s memory, per repository (#380). Holds only what nothing else owns — the template picked, the ticket picked, dismissed, completed. Deliberately has NO step-status columns (decision O1): every step status is derived on read from the subsystem that owns it, as the header of V067 documents. Do not add one.';
comment on column ouroboros.onboarding_state.repo_ref is
  'The repository this wizard run onboards, as owner/name. The wizard is re-enterable per repository, so a second repository gets its own row.';
comment on column ouroboros.onboarding_state.selected_template is
  'The starting workflow template picked in step 3 (quick-fixes), as its slug. Null until picked.';
comment on column ouroboros.onboarding_state.picked_ticket_id is
  'The first issue to run, as a canonical ticket — any tracker. Null until picked, and set null if the ticket is deleted.';
comment on column ouroboros.onboarding_state.dismissed is
  'Whether the person dismissed the wizard. Independent of completed_at.';
comment on column ouroboros.onboarding_state.completed_at is
  'When the wizard was completed, or null while it is not.';

create trigger onboarding_state_touch_updated_at
  before update on ouroboros.onboarding_state
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The picked ticket belongs to the wizard's workspace.
--
-- V034's `ticket_draft_ticket_in_organization()`, one more shape of the same guard: two foreign
-- keys do not make their workspaces agree, and a wizard naming another workspace's ticket is a
-- tenancy leak — that ticket's title rendering in this workspace's step 4.
-- ---------------------------------------------------------------------------
create function ouroboros.onboarding_state_ticket_in_organization()
returns trigger language plpgsql as $$
declare
  ticket_owner text;
begin
  if new.picked_ticket_id is null then
    return new;
  end if;

  select t.organization_id into ticket_owner
    from ouroboros.tickets t
   where t.id = new.picked_ticket_id;

  -- Null means the ticket is gone, which the foreign key refuses a moment later and describes
  -- better than this could.
  if ticket_owner is not null and ticket_owner is distinct from new.organization_id then
    raise exception
      'onboarding state % picks ticket %, which belongs to organization % rather than %',
      new.id, new.picked_ticket_id, ticket_owner, new.organization_id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.onboarding_state_ticket_in_organization() is
  'BEFORE INSERT OR UPDATE trigger for onboarding_state (#380): refuses a picked ticket that belongs to another workspace. Raises class 23 naming the trigger.';

create trigger onboarding_state_ticket_in_organization
  before insert or update of organization_id, picked_ticket_id on ouroboros.onboarding_state
  for each row execute function ouroboros.onboarding_state_ticket_in_organization();

-- ---------------------------------------------------------------------------
-- repo_detection_scans — one row per scan of a repository.
-- ---------------------------------------------------------------------------
create table ouroboros.repo_detection_scans (
  id                uuid               primary key default gen_random_uuid(),
  organization_id   text               not null
                                       references ouroboros.organization ("id") on delete cascade,
  repo_ref          ouroboros.repo_ref not null,

  -- The scan's number within its repository. A re-scan takes the next one rather than
  -- overwriting, so every earlier scan stays queryable.
  scan_seq          integer            not null,

  scanned_at        timestamptz        not null default now(),

  -- How long the scan took — the card's `scanned in 38s`, rendered from data.
  duration_ms       integer            not null,

  -- The rule-pack versions the scan ran, `{"core": "1.0.0"}`. An object; BB.1 owns its keys.
  pack_versions     jsonb              not null default '{}'::jsonb,

  -- How many provider probes the scan spent, when the detector counts them.
  probe_budget_used integer,

  constraint repo_detection_scans_seq_key
    unique (organization_id, repo_ref, scan_seq),

  constraint repo_detection_scans_seq_positive
    check (scan_seq >= 1),
  constraint repo_detection_scans_duration_nonnegative
    check (duration_ms >= 0),
  constraint repo_detection_scans_pack_versions_shape
    check (jsonb_typeof(pack_versions) = 'object'),
  constraint repo_detection_scans_probe_budget_nonnegative
    check (probe_budget_used is null or probe_budget_used >= 0)
);

comment on table ouroboros.repo_detection_scans is
  'One scan of a repository by the detection service (#380, decision O2): its number, when, how long, which rule packs, how many probes. Re-scans are new rows with the next scan_seq, never an overwrite, so earlier scans stay inspectable.';
comment on column ouroboros.repo_detection_scans.scan_seq is
  'The scan''s number within (organization_id, repo_ref), from 1. The detections of a scan reference it.';
comment on column ouroboros.repo_detection_scans.duration_ms is
  'How long the scan took, in milliseconds — the source of the card''s "scanned in 38s" tag.';
comment on column ouroboros.repo_detection_scans.pack_versions is
  'The rule-pack versions the scan ran, as an object. The detection service owns its keys.';
comment on column ouroboros.repo_detection_scans.probe_budget_used is
  'Provider probes the scan consumed, or null when not counted.';

-- ---------------------------------------------------------------------------
-- repo_detections — one card row of one scan, with its evidence.
-- ---------------------------------------------------------------------------
create table ouroboros.repo_detections (
  id              uuid               primary key default gen_random_uuid(),
  organization_id text               not null,
  repo_ref        ouroboros.repo_ref not null,
  scan_seq        integer            not null,

  -- Which card row: the six the mockup draws, or `custom:<name>` for a future rule pack.
  row_key         text               not null,

  -- ok (✓), warn (the conventions row), missing (nothing found).
  verdict         text               not null,

  -- The line the card prints — `west + twister (found west.yml)`.
  value           text               not null,

  -- Which probes hit and missed, and the payload references behind them. An object.
  evidence        jsonb              not null default '{}'::jsonb,

  -- detected (a probe saw it) or measured (the farm timed it). See O2 in the header.
  label           text               not null default 'detected',

  created_at      timestamptz        not null default now(),
  updated_at      timestamptz        not null default now(),

  -- The scan this row belongs to, and — because the key includes the workspace — a row can
  -- never belong to another workspace's scan. Cascade: a scan that is deleted takes its rows.
  constraint repo_detections_scan_fkey
    foreign key (organization_id, repo_ref, scan_seq)
    references ouroboros.repo_detection_scans (organization_id, repo_ref, scan_seq)
    on delete cascade,

  constraint repo_detections_scan_row_key
    unique (organization_id, repo_ref, scan_seq, row_key),

  constraint repo_detections_row_key
    check (row_key in ('language', 'build', 'devcontainer', 'tests', 'protected_paths',
                       'conventions')
           or row_key ~ '^custom:[a-z0-9][a-z0-9_.-]{0,62}$'),
  constraint repo_detections_verdict
    check (verdict in ('ok', 'warn', 'missing')),
  constraint repo_detections_label
    check (label in ('detected', 'measured')),
  constraint repo_detections_value_present
    check (btrim(value) <> '' and length(value) <= 512),
  constraint repo_detections_evidence_shape
    check (jsonb_typeof(evidence) = 'object')
);

comment on table ouroboros.repo_detections is
  'One row of the "We already figured this out" card, for one scan (#380, decision O2): the verdict, the line printed, the evidence that produced it, and whether it was detected or measured.';
comment on column ouroboros.repo_detections.row_key is
  'language | build | devcontainer | tests | protected_paths | conventions, or custom:<name> so a new rule pack needs no migration.';
comment on column ouroboros.repo_detections.verdict is
  'ok | warn | missing.';
comment on column ouroboros.repo_detections.value is
  'The line the card prints for this row, e.g. "west + twister (found west.yml)".';
comment on column ouroboros.repo_detections.evidence is
  'Probe paths, hit/miss and API payload references — which probe produced this row. An object; the rule packs own its shape.';
comment on column ouroboros.repo_detections.label is
  'detected (a probe saw it) | measured (the farm measured it, BD.4). Flipped with an update; no schema change needed.';

create trigger repo_detections_touch_updated_at
  before update on ouroboros.repo_detections
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- repo_detections_latest — the card's read path: every row of each repository's newest scan,
-- with that scan's metadata.
-- ---------------------------------------------------------------------------
create view ouroboros.repo_detections_latest as
  select d.id,
         d.organization_id,
         d.repo_ref,
         d.scan_seq,
         d.row_key,
         d.verdict,
         d.value,
         d.evidence,
         d.label,
         s.scanned_at,
         s.duration_ms,
         s.pack_versions
    from ouroboros.repo_detections d
    join ouroboros.repo_detection_scans s
      on s.organization_id = d.organization_id
     and s.repo_ref = d.repo_ref
     and s.scan_seq = d.scan_seq
   where s.scan_seq = (select max(m.scan_seq)
                         from ouroboros.repo_detection_scans m
                        where m.organization_id = s.organization_id
                          and m.repo_ref = s.repo_ref);

comment on view ouroboros.repo_detections_latest is
  'The detection card''s read path (#380): the rows of each repository''s newest scan, with scanned_at and duration_ms from the scan row. Earlier scans stay in repo_detections.';

-- ---------------------------------------------------------------------------
-- protected_path_policies — the globs a change may not touch, per repository.
-- ---------------------------------------------------------------------------
create table ouroboros.protected_path_policies (
  id              uuid               primary key default gen_random_uuid(),
  organization_id text               not null
                                     references ouroboros.organization ("id") on delete cascade,
  repo_ref        ouroboros.repo_ref not null,

  -- `boot/**`, `keys/**` — AP.3's glob grammar, relative to the repository root.
  path_glob       text               not null,

  -- suggested (detection proposed it) or edited (a person wrote or changed it).
  source          text               not null default 'suggested',

  created_at      timestamptz        not null default now(),
  updated_at      timestamptz        not null default now(),

  constraint protected_path_policies_repo_glob_key
    unique (organization_id, repo_ref, path_glob),

  constraint protected_path_policies_source
    check (source in ('suggested', 'edited')),

  -- Non-blank, relative, forward slashes, and no `..` segment — the same path grammar the
  -- ingestion contract holds a change-set's paths to (V047), so a glob can match one.
  constraint protected_path_policies_glob_format
    check (btrim(path_glob) = path_glob
           and path_glob <> ''
           and length(path_glob) <= 512
           and left(path_glob, 1) <> '/'
           and strpos(path_glob, '\') = 0
           and path_glob !~ '(^|/)\.\.(/|$)'
           and path_glob !~ '[[:cntrl:]]')
);

comment on table ouroboros.protected_path_policies is
  'Protected paths per repository (#380): globs a change may not touch. Read by AP.3''s allowed_paths guardrail (#305 amendment) — a touched protected path fails the check. Suggested by detection, owned once edited. BQ.1 (#480) later absorbs this into the org policy document.';
comment on column ouroboros.protected_path_policies.path_glob is
  'The glob, in AP.3''s grammar (** · * · ? · literal), relative to the repository root.';
comment on column ouroboros.protected_path_policies.source is
  'suggested (detection proposed it) | edited (a person wrote or changed it). An edited row never returns to suggested.';

create trigger protected_path_policies_touch_updated_at
  before update on ouroboros.protected_path_policies
  for each row execute function ouroboros.touch_updated_at();

-- ---------------------------------------------------------------------------
-- An edited protected path stays edited.
--
-- A CHECK cannot see the previous row. Without this, a re-scan upserting its suggestions could
-- flip a person's glob back to `suggested` and make it look like something they never chose.
-- ---------------------------------------------------------------------------
create function ouroboros.protected_path_policy_provenance()
returns trigger language plpgsql as $$
begin
  if old.source = 'edited' and new.source = 'suggested' then
    raise exception
      'protected path % was edited by a person and cannot return to suggested', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  return new;
end;
$$;

comment on function ouroboros.protected_path_policy_provenance() is
  'BEFORE UPDATE trigger for protected_path_policies (#380): an edited row never returns to suggested. Raises class 23 naming the trigger.';

create trigger protected_path_policies_provenance
  before update of source on ouroboros.protected_path_policies
  for each row execute function ouroboros.protected_path_policy_provenance();

-- ---------------------------------------------------------------------------
-- The service role's grants.
--
--   * **Wizard state** is created and updated, and deleted with its workspace only.
--   * **Scans** are appended — a re-scan is a new row — and never edited.
--   * **Detections** are appended, and the only update is the one decision O2 plans for:
--     re-labelling a row `measured`, with the value and evidence that measurement produced.
--   * **Protected paths** are the person's to add, change and remove.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert, update on ouroboros.onboarding_state to ouroboros_app;
grant select, insert on ouroboros.repo_detection_scans to ouroboros_app;
grant select, insert on ouroboros.repo_detections to ouroboros_app;
grant update (verdict, value, evidence, label) on ouroboros.repo_detections to ouroboros_app;
grant select on ouroboros.repo_detections_latest to ouroboros_app;
grant select, insert, update, delete on ouroboros.protected_path_policies to ouroboros_app;

revoke delete on ouroboros.onboarding_state from public;
revoke update, delete on ouroboros.repo_detection_scans from public;
revoke delete on ouroboros.repo_detections from public;
