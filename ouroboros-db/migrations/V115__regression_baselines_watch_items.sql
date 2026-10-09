-- V115__regression_baselines_watch_items.sql — the Research domain's regression watch: per-release
-- metric baselines, the drift a nightly comparison finds against them, and the lifecycle from
-- *detected* to *fixed & merged* (#611, CK.4; decision V6).
--
-- Mockup 22's regression watch card, `nightly vs. v2.0.4 baseline`:
--
--   ● err   Hover drift +14% in gusts          bisected → a41f2c9 · fix loop running · #512  (fixing)
--   ⚠ warn  Boot time +230 ms since v2.1.0-rc1  bisected → 7c03d1e · fix ticket drafted · #517 (queued)
--   ● ok    Battery est. error regression       root-caused, fixed & merged · PR #641          (✓ merged)
--
-- Three rows, and each is data:
--
--   1. **`regression_baselines`** — one per repository, release and metric: the window of samples
--      the release was measured over, as statistics (`n`, `median`, `spread` and what kind of
--      spread, `unit`, the window's bounds). A baseline is a measurement, not a number: comparing a
--      nightly value with one stored figure alarms on noise and misses drift inside variance.
--      Captured once, never edited.
--   2. **`regression_watch_items`** — a baseline's drift: the latest comparison window
--      (`current`), the **signed drift with its unit** (`drift_value` + `drift_unit`, rendered by
--      `drift_display` as `+14%` or `+230 ms` from the same two columns), a `severity`
--      (`err | warn | ok`) and a `status` that walks the lifecycle below, with the references each
--      step points at in another plane.
--   3. **`regression_watch_settings`** — a workspace's per-metric thresholds as jsonb over
--      documented defaults per metric class (`regression_threshold_defaults()`), so a noisy metric
--      is tuned without code. `regression_threshold()` answers the effective rule.
--
-- ---------------------------------------------------------------------------
-- What a metric is
-- ---------------------------------------------------------------------------
--
-- `metric_key` is the identity #619's telemetry adapter shares (`metric_window(metric_key, …)`):
--
--   * `metric_source = 'bi_metric'` — a BI metric id (V076's `metric_definitions.metric_id`,
--     `merge_rate`), held to the catalogue by a foreign key on the generated `bi_metric_id`;
--   * `metric_source = 'case_metric'` — an AS/AT case metric, `<case_key>:<metric>`: the durable
--     64-hex `case_key` of V051 and a V053 measurement name (`hover_drift_gusts`). No foreign key —
--     a case key is an identity across runs, not a row.
--
-- `metric_class` (`timing | accuracy | resource | rate`) picks the threshold defaults.
--
-- ---------------------------------------------------------------------------
-- The lifecycle (V6) — and the honest stop
-- ---------------------------------------------------------------------------
--
--   detected ─▶ bisecting ─▶ bisected ─▶ investigation_open ─▶ fix_drafted ─▶ fix_running ─▶ fixed_merged
--      │  ▲          │            └──────────────────────────────▲   ▲             │
--      │  └──────────┘ (no repro)                                 │   └─────────────┘ (loop failed)
--      └─▶ investigation_open                                     │
--   any non-terminal ─▶ dismissed
--
-- `regression_watch_items_transition` holds every edge, and what each state needs:
--
--   * `bisected` carries a `bisect_result` — `{culprit_sha, farm_job_ids, steps,
--     confidence_basis}`, the culprit a full 40-hex sha (the card shortens it), the farm jobs AH.4
--     dispatched, the steps taken, and how sure it is (`{method, inputs}`). Set once, never
--     rewritten (CHECK + trigger).
--   * `investigation_open` names the auto-opened forensics — an investigation of the workspace
--     whose `origin` is `regression_watch` (#608).
--   * `fix_drafted` and `fix_running` name the fix ticket — `fix_ticket_ref`
--     `{kind: ticket | draft, id, key}`, a canonical ticket (V030) or a Planning draft (AK.1) of
--     the workspace, its `key` the one it is shown by (`#512`).
--   * `fixed_merged` names the PR — `pr_ref` `{pull_request_id, key}` (`PR #641`).
--   * `dismissed` records who, when and why; it and `fixed_merged` are terminal.
--
-- **A metric with no replayable test stops at `detected` with a `note`** (`needs repro`) — or
-- comes back to it from `bisecting` when the bisect finds nothing to replay. That is a resting
-- state, not an error and not a bisect that never ends.
--
-- At most one open (non-terminal) item per baseline: the nightly comparison updates it rather
-- than opening a second.
--
-- Revert forward:
--   drop table ouroboros.regression_watch_items, ouroboros.regression_baselines,
--              ouroboros.regression_watch_settings;
--   drop function ouroboros.regression_threshold(text, text, text),
--                 ouroboros.regression_threshold_defaults(), …;  (every function below)
--   alter table ouroboros.investigations drop constraint investigations_id_organization_key;

-- ===========================================================================
-- Shapes
-- ===========================================================================

-- regression_iso_timestamp(value) — whether a jsonb value is an ISO-8601 timestamp with an offset.
--   value — the jsonb value
--   returns true for '2026-10-01T02:00:00Z' and the like; the offset makes the cast below
--   independent of the session's TimeZone, which is what lets the callers be immutable.
create function ouroboros.regression_iso_timestamp(value jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_typeof(value) = 'string'
                  and (value #>> '{}')
                        ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$',
                  false);
$$;

comment on function ouroboros.regression_iso_timestamp(jsonb) is
  'True when a jsonb value is an ISO-8601 timestamp string carrying Z or an offset (#611).';

-- regression_unit_valid(unit) — whether a text is a measurement unit as V053 spells one.
--   unit — the unit (`ms`, `%`, `cm`)
--   returns true for 1–16 non-space characters
create function ouroboros.regression_unit_valid(unit text)
returns boolean language sql immutable as $$
  select coalesce(unit ~ '^[^[:space:]]{1,16}$', false);
$$;

comment on function ouroboros.regression_unit_valid(text) is
  'True when a unit is 1–16 non-space characters — V053''s hil_measurements.unit rule (#611).';

-- regression_window_valid(w) — whether a jsonb value is a measurement window's statistics.
--   w — {n, median, spread, spread_kind, unit, from, to}
--   returns true for: n an integer ≥ 1; median a number; spread a number ≥ 0; spread_kind
--   iqr | stddev | mad; unit a V053 unit; from and to ISO timestamps with from ≤ to
create function ouroboros.regression_window_valid(w jsonb)
returns boolean language plpgsql immutable as $$
begin
  if not ouroboros.jsonb_keys_are(w, array['n', 'median', 'spread', 'spread_kind', 'unit', 'from', 'to']) then
    return false;
  end if;
  if not (ouroboros.jsonb_nonneg_int(w -> 'n') and (w ->> 'n')::bigint >= 1
          and jsonb_typeof(w -> 'median') = 'number'
          and jsonb_typeof(w -> 'spread') = 'number' and (w ->> 'spread')::numeric >= 0
          and jsonb_typeof(w -> 'spread_kind') = 'string'
          and w ->> 'spread_kind' in ('iqr', 'stddev', 'mad')
          and jsonb_typeof(w -> 'unit') = 'string'
          and ouroboros.regression_unit_valid(w ->> 'unit')
          and ouroboros.regression_iso_timestamp(w -> 'from')
          and ouroboros.regression_iso_timestamp(w -> 'to')) then
    return false;
  end if;
  return (w ->> 'from')::timestamptz <= (w ->> 'to')::timestamptz;
end;
$$;

comment on function ouroboros.regression_window_valid(jsonb) is
  'True when a value is exactly {n ≥ 1, median, spread ≥ 0, spread_kind iqr|stddev|mad, unit, from, to} with from ≤ to (ISO-8601 with offset) — a measurement window''s statistics (#611).';

-- regression_bisect_result_valid(r) — whether a jsonb value is a bisect's outcome.
--   r — {culprit_sha, farm_job_ids, steps, confidence_basis}
--   returns true for: a 40-hex culprit sha; 1–64 distinct farm job uuids; steps an integer ≥ 1;
--   confidence_basis exactly {method: non-blank string, inputs: object}
create function ouroboros.regression_bisect_result_valid(r jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    ouroboros.jsonb_keys_are(r, array['culprit_sha', 'farm_job_ids', 'steps', 'confidence_basis'])
    and jsonb_typeof(r -> 'culprit_sha') = 'string'
    and (r ->> 'culprit_sha') ~ '^[0-9a-f]{40}$'
    and ouroboros.jsonb_uuid_set(r -> 'farm_job_ids', 64)
    and ouroboros.jsonb_nonneg_int(r -> 'steps') and (r ->> 'steps')::bigint >= 1
    and ouroboros.jsonb_keys_are(r -> 'confidence_basis', array['method', 'inputs'])
    and ouroboros.jsonb_nonblank_string(r #> '{confidence_basis,method}')
    and jsonb_typeof(r #> '{confidence_basis,inputs}') = 'object',
    false);
$$;

comment on function ouroboros.regression_bisect_result_valid(jsonb) is
  'True when a value is exactly {culprit_sha: 40-hex, farm_job_ids: 1–64 distinct uuids, steps ≥ 1, confidence_basis: {method, inputs}} — a bisect''s outcome (#611).';

-- regression_fix_ticket_ref_valid(r) — whether a jsonb value names a fix ticket.
--   r — {kind: ticket | draft, id: uuid, key: non-blank}
create function ouroboros.regression_fix_ticket_ref_valid(r jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    ouroboros.jsonb_keys_are(r, array['kind', 'id', 'key'])
    and jsonb_typeof(r -> 'kind') = 'string' and r ->> 'kind' in ('ticket', 'draft')
    and ouroboros.jsonb_uuid_set(jsonb_build_array(r -> 'id'), 1)
    and ouroboros.jsonb_nonblank_string(r -> 'key')
    and length(r ->> 'key') <= 255,
    false);
$$;

comment on function ouroboros.regression_fix_ticket_ref_valid(jsonb) is
  'True when a value is exactly {kind: ticket|draft, id: uuid, key: non-blank ≤ 255} — a canonical ticket (V030) or a Planning draft (AK.1) (#611).';

-- regression_pr_ref_valid(r) — whether a jsonb value names a pull request.
--   r — {pull_request_id: uuid, key: non-blank}
create function ouroboros.regression_pr_ref_valid(r jsonb)
returns boolean language sql immutable as $$
  select coalesce(
    ouroboros.jsonb_keys_are(r, array['pull_request_id', 'key'])
    and ouroboros.jsonb_uuid_set(jsonb_build_array(r -> 'pull_request_id'), 1)
    and ouroboros.jsonb_nonblank_string(r -> 'key')
    and length(r ->> 'key') <= 255,
    false);
$$;

comment on function ouroboros.regression_pr_ref_valid(jsonb) is
  'True when a value is exactly {pull_request_id: uuid, key: non-blank ≤ 255} — a V052 pull request (#611).';

-- regression_drift_display(value, unit) — the card's rendering of a signed drift.
--   value — the signed magnitude (14, 230, -3.5)
--   unit  — its unit (`%`, `ms`)
--   returns `+14%`, `+230 ms`, `-3.5 cm`: the sign always written, `%` attached, any other unit
--   after a space, trailing zeros trimmed
create function ouroboros.regression_drift_display(value numeric, unit text)
returns text language sql immutable as $$
  select case when value >= 0 then '+' else '-' end
         || trim_scale(abs(value))::text
         || case when unit = '%' then '%' else ' ' || unit end;
$$;

comment on function ouroboros.regression_drift_display(numeric, text) is
  'The card''s rendering of a signed drift: +14%, +230 ms — sign always written, % attached, other units after a space (#611).';

-- ===========================================================================
-- Thresholds
-- ===========================================================================

-- regression_threshold_defaults() — the documented defaults per metric class.
--   returns {timing: rule, accuracy: rule, resource: rule, rate: rule}, each rule
--   {direction, warn_pct, err_pct, min_spread_multiple, min_samples}:
--
--     class      direction         warn   err   × spread   samples   e.g.
--     timing     higher_is_worse    5 %   15 %     2         5       boot time, latency
--     accuracy   higher_is_worse    5 %   10 %     2        10       hover drift, estimate error
--     resource   higher_is_worse   10 %   25 %     2         5       flash size, peak RAM
--     rate       lower_is_worse     2 %    5 %     2        10       pass rate, merge rate
--
--   A drift is a regression when it moves in the worse `direction` (`either` for a metric whose
--   both directions matter), by at least `warn_pct` / `err_pct` of the baseline median, by more
--   than `min_spread_multiple` × the baseline's spread (so noise inside variance never alarms),
--   over a window of at least `min_samples`. CM.4 (#623) applies the rule; this records it.
create function ouroboros.regression_threshold_defaults()
returns jsonb language sql immutable as $$
  select '{
    "timing":   {"direction": "higher_is_worse", "warn_pct": 5,  "err_pct": 15, "min_spread_multiple": 2, "min_samples": 5},
    "accuracy": {"direction": "higher_is_worse", "warn_pct": 5,  "err_pct": 10, "min_spread_multiple": 2, "min_samples": 10},
    "resource": {"direction": "higher_is_worse", "warn_pct": 10, "err_pct": 25, "min_spread_multiple": 2, "min_samples": 5},
    "rate":     {"direction": "lower_is_worse",  "warn_pct": 2,  "err_pct": 5,  "min_spread_multiple": 2, "min_samples": 10}
  }'::jsonb;
$$;

comment on function ouroboros.regression_threshold_defaults() is
  'The documented threshold defaults per metric class (#611): timing 5/15 %, accuracy 5/10 %, resource 10/25 %, rate 2/5 % (lower is worse); each × 2 spreads, over 5 or 10 samples. A workspace overrides them in regression_watch_settings.thresholds.';

-- regression_metric_key_valid(source, key) — whether a metric key is the shape its source names.
--   source — bi_metric | case_metric; null accepts either shape (a threshold override's key)
--   key    — the metric key
create function ouroboros.regression_metric_key_valid(source text, key text)
returns boolean language sql immutable as $$
  select coalesce(
    case source
      when 'bi_metric'   then key ~ '^[a-z][a-z0-9_]{0,62}$'
      when 'case_metric' then key ~ '^[0-9a-f]{64}:[a-z][a-z0-9_]{0,62}$'
      else key ~ '^[a-z][a-z0-9_]{0,62}$' or key ~ '^[0-9a-f]{64}:[a-z][a-z0-9_]{0,62}$'
    end,
    false);
$$;

comment on function ouroboros.regression_metric_key_valid(text, text) is
  'True when a metric key has its source''s shape (#611): a BI metric id (merge_rate) or a case metric <64-hex case_key>:<measurement> (…:hover_drift_gusts). A null source accepts either.';

-- regression_threshold_rule_valid(rule) — whether a jsonb value is a (partial) threshold rule.
--   rule — an object of some of {direction, warn_pct, err_pct, min_spread_multiple, min_samples}
--   returns true for a non-empty object of only those keys: direction higher_is_worse |
--   lower_is_worse | either; warn_pct and err_pct positive numbers given together with
--   warn_pct ≤ err_pct (so an override can never leave a merged rule inverted);
--   min_spread_multiple a number ≥ 0; min_samples an integer ≥ 1
create function ouroboros.regression_threshold_rule_valid(rule jsonb)
returns boolean language plpgsql immutable as $$
begin
  if jsonb_typeof(rule) is distinct from 'object' or rule = '{}'::jsonb
     or exists (select 1 from jsonb_object_keys(rule) k
                 where k not in ('direction', 'warn_pct', 'err_pct', 'min_spread_multiple', 'min_samples')) then
    return false;
  end if;
  if rule ? 'direction' and not (jsonb_typeof(rule -> 'direction') = 'string'
                                 and rule ->> 'direction' in ('higher_is_worse', 'lower_is_worse', 'either')) then
    return false;
  end if;
  if (rule ? 'warn_pct') <> (rule ? 'err_pct') then
    return false;
  end if;
  if rule ? 'warn_pct' and not (jsonb_typeof(rule -> 'warn_pct') = 'number'
                                and jsonb_typeof(rule -> 'err_pct') = 'number'
                                and (rule ->> 'warn_pct')::numeric > 0
                                and (rule ->> 'warn_pct')::numeric <= (rule ->> 'err_pct')::numeric) then
    return false;
  end if;
  if rule ? 'min_spread_multiple' and not (jsonb_typeof(rule -> 'min_spread_multiple') = 'number'
                                           and (rule ->> 'min_spread_multiple')::numeric >= 0) then
    return false;
  end if;
  if rule ? 'min_samples' and not (ouroboros.jsonb_nonneg_int(rule -> 'min_samples')
                                   and (rule ->> 'min_samples')::bigint >= 1) then
    return false;
  end if;
  return true;
end;
$$;

comment on function ouroboros.regression_threshold_rule_valid(jsonb) is
  'True when a value is a non-empty object of only {direction higher_is_worse|lower_is_worse|either, warn_pct + err_pct (together, 0 < warn ≤ err), min_spread_multiple ≥ 0, min_samples ≥ 1} (#611).';

-- regression_thresholds_valid(t) — whether a jsonb value is a workspace's threshold overrides.
--   t — {classes: {<class>: rule}, metrics: {<metric_key>: rule}}
create function ouroboros.regression_thresholds_valid(t jsonb)
returns boolean language plpgsql immutable as $$
begin
  if not ouroboros.jsonb_keys_are(t, array['classes', 'metrics'])
     or jsonb_typeof(t -> 'classes') <> 'object' or jsonb_typeof(t -> 'metrics') <> 'object' then
    return false;
  end if;
  if exists (select 1 from jsonb_each(t -> 'classes') c
              where c.key not in ('timing', 'accuracy', 'resource', 'rate')
                 or not ouroboros.regression_threshold_rule_valid(c.value)) then
    return false;
  end if;
  return not exists (select 1 from jsonb_each(t -> 'metrics') m
                      where not ouroboros.regression_metric_key_valid(null, m.key)
                         or not ouroboros.regression_threshold_rule_valid(m.value));
end;
$$;

comment on function ouroboros.regression_thresholds_valid(jsonb) is
  'True when a value is exactly {classes: {timing|accuracy|resource|rate: rule}, metrics: {<metric_key>: rule}} with every rule valid (#611).';

create table ouroboros.regression_watch_settings (
  -- One row per workspace. Cascade, as everything a workspace owns.
  organization_id text        primary key
                              references ouroboros.organization ("id") on delete cascade,

  -- The overrides, over regression_threshold_defaults(): per class, then per metric.
  thresholds      jsonb       not null default '{"classes": {}, "metrics": {}}'
                              constraint regression_watch_settings_thresholds_shape
                                check (ouroboros.regression_thresholds_valid(thresholds)),

  -- Who last tuned them. Set null when the person is removed.
  updated_by      text        references ouroboros."user" ("id") on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table ouroboros.regression_watch_settings is
  'A workspace''s regression-watch threshold overrides (#611, CK.4): {classes: {class: rule}, metrics: {metric_key: rule}} over regression_threshold_defaults(). Absent row = the defaults. Read through regression_threshold().';
comment on column ouroboros.regression_watch_settings.thresholds is
  '{classes: {timing|accuracy|resource|rate: rule}, metrics: {<metric_key>: rule}} — partial rules of {direction, warn_pct + err_pct, min_spread_multiple, min_samples}, merged over the class default.';

create trigger regression_watch_settings_touch_updated_at
  before update on ouroboros.regression_watch_settings
  for each row execute function ouroboros.touch_updated_at();

-- regression_threshold(org, metric_key, metric_class) — the rule that applies to one metric.
--   org          — the workspace
--   metric_key   — the metric
--   metric_class — timing | accuracy | resource | rate
--   returns the class default, overlaid by the workspace's class override, overlaid by its
--   metric override — always the full {direction, warn_pct, err_pct, min_spread_multiple,
--   min_samples}; null for an unknown class
create function ouroboros.regression_threshold(p_organization_id text, p_metric_key text,
                                               p_metric_class text)
returns jsonb language sql stable as $$
  select ouroboros.regression_threshold_defaults() -> p_metric_class
         || coalesce(s.thresholds #> array['classes', p_metric_class], '{}')
         || coalesce(s.thresholds #> array['metrics', p_metric_key], '{}')
    from (select 1) one
    left join ouroboros.regression_watch_settings s on s.organization_id = p_organization_id;
$$;

comment on function ouroboros.regression_threshold(text, text, text) is
  'The effective threshold rule for one metric (#611): the class default (regression_threshold_defaults()) overlaid by the workspace''s class override, then its metric override. Null for an unknown class.';

-- ===========================================================================
-- Baselines
-- ===========================================================================

create table ouroboros.regression_baselines (
  id              uuid        primary key default gen_random_uuid(),

  -- The workspace. Cascade, as everything a workspace owns.
  organization_id text        not null
                              references ouroboros.organization ("id") on delete cascade,

  -- The repository measured — acme-robotics/helios-firmware.
  repo_ref        ouroboros.repo_ref not null,

  -- The release the baseline belongs to — v2.0.4, v2.1.0-rc1.
  release_tag     text        not null
                              constraint regression_baselines_release_tag_format
                                check (release_tag ~ '^[^[:space:]]{1,128}$'),

  -- What kind of metric, and which: see the header.
  metric_source   text        not null
                              constraint regression_baselines_metric_source
                                check (metric_source in ('bi_metric', 'case_metric')),
  metric_key      text        not null,

  -- The BI metric, as a key the catalogue can hold it to. Null for a case metric.
  bi_metric_id    text        generated always as
                                (case when metric_source = 'bi_metric' then metric_key end) stored
                              constraint regression_baselines_bi_metric_fk
                                references ouroboros.metric_definitions (metric_id),

  -- Which threshold defaults apply.
  metric_class    text        not null
                              constraint regression_baselines_metric_class
                                check (metric_class in ('timing', 'accuracy', 'resource', 'rate')),

  -- The release's window, as statistics. See regression_window_valid().
  "window"        jsonb       not null
                              constraint regression_baselines_window_shape
                                check (ouroboros.regression_window_valid("window")),

  captured_at     timestamptz not null default now(),

  -- How it was captured: by the release trigger, or by a person.
  captured_via    text        not null
                              constraint regression_baselines_captured_via
                                check (captured_via in ('release', 'manual')),

  -- The person, for a manual capture. Set null when they are removed; the baseline stays.
  captured_by     text        references ouroboros."user" ("id") on delete set null,

  constraint regression_baselines_metric_key_shape
    check (ouroboros.regression_metric_key_valid(metric_source, metric_key)),
  -- A release capture has no person behind it.
  constraint regression_baselines_release_unattended
    check (captured_via = 'manual' or captured_by is null),
  -- One baseline per repository, release and metric.
  constraint regression_baselines_release_metric_key
    unique (organization_id, repo_ref, release_tag, metric_key),
  -- The target of regression_watch_items' composite key.
  constraint regression_baselines_id_organization_key unique (id, organization_id)
);

comment on table ouroboros.regression_baselines is
  'Per-release metric baselines (#611, CK.4): one per workspace, repository, release and metric — the window of samples as statistics, never a single figure. Captured once and never edited.';
comment on column ouroboros.regression_baselines.metric_key is
  'The metric identity #619 shares: a BI metric id (bi_metric) or <case_key>:<measurement> (case_metric).';
comment on column ouroboros.regression_baselines."window" is
  '{n, median, spread, spread_kind iqr|stddev|mad, unit, from, to} — the release''s window of samples.';
comment on column ouroboros.regression_baselines.metric_class is
  'timing | accuracy | resource | rate — which regression_threshold_defaults() entry applies.';
comment on column ouroboros.regression_baselines.captured_via is
  'release (the release trigger; no person) | manual (captured_by names who).';

-- The latest baseline of a metric in a repository.
create index regression_baselines_metric_captured_idx
  on ouroboros.regression_baselines (organization_id, repo_ref, metric_key, captured_at desc);

-- regression_baselines_immutable() — a baseline is a measurement: refuse every update but the
-- user foreign key's set-null of captured_by.
create function ouroboros.regression_baselines_immutable()
returns trigger language plpgsql as $$
begin
  if (new.captured_by is null or new.captured_by is not distinct from old.captured_by)
     and row(new.id, new.organization_id, new.repo_ref, new.release_tag, new.metric_source,
             new.metric_key, new.metric_class, new."window", new.captured_at, new.captured_via)
         is not distinct from
         row(old.id, old.organization_id, old.repo_ref, old.release_tag, old.metric_source,
             old.metric_key, old.metric_class, old."window", old.captured_at, old.captured_via) then
    return new;
  end if;
  raise exception 'regression baseline % (% %) is a measurement and is never edited',
    old.id, old.release_tag, old.metric_key
    using errcode = 'restrict_violation', constraint = tg_name,
          hint = 'Capture a new baseline for the next release instead (#611).';
end;
$$;

comment on function ouroboros.regression_baselines_immutable() is
  'Refuses every update of regression_baselines but a foreign key''s set-null of captured_by (#611): a baseline is a measurement.';

create trigger regression_baselines_immutable
  before update on ouroboros.regression_baselines
  for each row execute function ouroboros.regression_baselines_immutable();

-- ===========================================================================
-- Watch items
-- ===========================================================================

-- The forensics an item names must be of its workspace: the composite key needs a target.
alter table ouroboros.investigations
  add constraint investigations_id_organization_key unique (id, organization_id);

create table ouroboros.regression_watch_items (
  id               uuid        primary key default gen_random_uuid(),

  -- The workspace, held to the baseline's own by the composite key below.
  organization_id  text        not null,

  -- The baseline the drift is measured against. Cascade: an item is about its baseline.
  baseline_id      uuid        not null,

  -- The latest comparison window. Same shape as the baseline's, same unit (checked at write).
  current          jsonb       not null
                               constraint regression_watch_items_current_shape
                                 check (ouroboros.regression_window_valid(current)),

  -- The signed drift and its unit: 14 %, 230 ms. The unit is `%` or the baseline's own.
  drift_value      numeric     not null,
  drift_unit       text        not null
                               constraint regression_watch_items_drift_unit_format
                                 check (ouroboros.regression_unit_valid(drift_unit)),
  -- `+14%`, `+230 ms` — the card's rendering, from the two columns above.
  drift_display    text        generated always as
                                 (ouroboros.regression_drift_display(drift_value, drift_unit)) stored,

  -- The card's dot.
  severity         text        not null
                               constraint regression_watch_items_severity
                                 check (severity in ('err', 'warn', 'ok')),

  status           text        not null default 'detected'
                               constraint regression_watch_items_status
                                 check (status in ('detected', 'bisecting', 'bisected',
                                                   'investigation_open', 'fix_drafted',
                                                   'fix_running', 'fixed_merged', 'dismissed')),

  -- The bisect's outcome. See regression_bisect_result_valid(). Set once.
  bisect_result    jsonb
                   constraint regression_watch_items_bisect_result_shape
                     check (bisect_result is null
                            or ouroboros.regression_bisect_result_valid(bisect_result)),

  -- The auto-opened forensics (origin regression_watch), of this workspace. Set null when the
  -- investigation is deleted; the item keeps its place in the lifecycle.
  investigation_id uuid,

  -- The fix: {kind: ticket|draft, id, key}. Resolved in the workspace at write.
  fix_ticket_ref   jsonb
                   constraint regression_watch_items_fix_ticket_ref_shape
                     check (fix_ticket_ref is null
                            or ouroboros.regression_fix_ticket_ref_valid(fix_ticket_ref)),

  -- The merged fix: {pull_request_id, key}. Resolved in the workspace at write.
  pr_ref           jsonb
                   constraint regression_watch_items_pr_ref_shape
                     check (pr_ref is null or ouroboros.regression_pr_ref_valid(pr_ref)),

  -- A note on the item — `needs repro` when no replayable test exists.
  note             text
                   constraint regression_watch_items_note_present
                     check (note is null or (btrim(note) <> '' and length(note) <= 2000)),

  -- Dismissal: who, when, why. Who is required when dismissing; set null if they are removed.
  dismissed_by     text        references ouroboros."user" ("id") on delete set null,
  dismissed_at     timestamptz,
  dismiss_reason   text,

  detected_at       timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint regression_watch_items_baseline_fk
    foreign key (baseline_id, organization_id)
    references ouroboros.regression_baselines (id, organization_id) on delete cascade,
  constraint regression_watch_items_investigation_fk
    foreign key (investigation_id, organization_id)
    references ouroboros.investigations (id, organization_id) on delete set null (investigation_id),

  -- What each state needs that a row can say for itself.
  constraint regression_watch_items_bisected_has_result
    check (status <> 'bisected' or bisect_result is not null),
  constraint regression_watch_items_fix_has_ticket
    check (status not in ('fix_drafted', 'fix_running') or fix_ticket_ref is not null),
  constraint regression_watch_items_merged_has_pr
    check (status <> 'fixed_merged' or pr_ref is not null),
  -- Dismissed exactly when it has a time and a reason.
  constraint regression_watch_items_dismissal
    check ((status = 'dismissed') = (dismissed_at is not null)
           and (status = 'dismissed') = (dismiss_reason is not null)),
  constraint regression_watch_items_dismiss_reason_present
    check (dismiss_reason is null or btrim(dismiss_reason) <> '')
);

comment on table ouroboros.regression_watch_items is
  'A baseline''s drift and its lifecycle (#611, CK.4; decision V6): the latest comparison window, the signed drift with its unit, severity err|warn|ok, and status detected → bisecting → bisected → investigation_open → fix_drafted → fix_running → fixed_merged, or dismissed — with the bisect result, the forensics investigation, the fix ticket and the PR each step points at. At most one open item per baseline.';
comment on column ouroboros.regression_watch_items.drift_value is
  'The signed drift, current minus baseline, in drift_unit — 14, 230. Its sign is as measured; which direction is worse is the threshold rule''s.';
comment on column ouroboros.regression_watch_items.drift_unit is
  '% (relative to the baseline median) or the baseline window''s own unit (ms).';
comment on column ouroboros.regression_watch_items.drift_display is
  'The card''s rendering — +14%, +230 ms. Generated by regression_drift_display().';
comment on column ouroboros.regression_watch_items.status is
  'detected | bisecting | bisected | investigation_open | fix_drafted | fix_running | fixed_merged | dismissed. Transitions held by regression_watch_items_transition; fixed_merged and dismissed are terminal. detected with a note is the honest resting state of a metric with no replayable test.';
comment on column ouroboros.regression_watch_items.bisect_result is
  '{culprit_sha (40-hex), farm_job_ids (AH.4 build jobs of the workspace), steps, confidence_basis {method, inputs}}. Set once, never rewritten.';
comment on column ouroboros.regression_watch_items.investigation_id is
  'The auto-opened forensics — an investigation of the workspace with origin regression_watch (#608). Required to enter investigation_open.';
comment on column ouroboros.regression_watch_items.fix_ticket_ref is
  '{kind: ticket|draft, id, key} — a canonical ticket (key = its external_key) or a Planning draft (key = its local_key) of the workspace. Not a foreign key: the record of what the fix was keeps its key if the ticket goes.';
comment on column ouroboros.regression_watch_items.pr_ref is
  '{pull_request_id, key} — a pull request of the workspace, key #<external_number>.';
comment on column ouroboros.regression_watch_items.note is
  'Free text on the item — needs repro when no replayable test exists.';

-- The card: a workspace's items by severity and status.
create index regression_watch_items_organization_severity_status_idx
  on ouroboros.regression_watch_items (organization_id, severity, status);

-- A baseline's items, newest first.
create index regression_watch_items_baseline_detected_idx
  on ouroboros.regression_watch_items (baseline_id, detected_at desc);

create index regression_watch_items_investigation_idx
  on ouroboros.regression_watch_items (investigation_id) where investigation_id is not null;

-- One open item per baseline: the nightly comparison updates it rather than opening a second.
create unique index regression_watch_items_one_open
  on ouroboros.regression_watch_items (baseline_id)
  where status not in ('fixed_merged', 'dismissed');

comment on index ouroboros.regression_watch_items_one_open is
  'At most one open (not fixed_merged, not dismissed) regression watch item per baseline (#611).';

-- regression_watch_items_refs() — what a row cannot say for itself: its window and drift are in
-- the baseline's unit, and every reference it carries resolves in its own workspace.
create function ouroboros.regression_watch_items_refs()
returns trigger language plpgsql as $$
declare
  baseline_unit text;
  key_found     text;
  origin_found  text;
begin
  select b."window" ->> 'unit' into baseline_unit
    from ouroboros.regression_baselines b
   where b.id = new.baseline_id and b.organization_id = new.organization_id;
  -- An unknown baseline is the composite foreign key's to refuse, by name.
  if found and ouroboros.regression_window_valid(new.current)
     and ouroboros.regression_unit_valid(new.drift_unit) then
    if new.current ->> 'unit' is distinct from baseline_unit then
      raise exception 'watch item window is in %, its baseline in %', new.current ->> 'unit', baseline_unit
        using errcode = 'check_violation', constraint = 'regression_watch_items_current_unit';
    end if;
    if new.drift_unit <> '%' and new.drift_unit <> baseline_unit then
      raise exception 'drift is in %; it is %% or the baseline''s %', new.drift_unit, baseline_unit
        using errcode = 'check_violation', constraint = 'regression_watch_items_drift_unit';
    end if;
  end if;

  -- A malformed value is its shape CHECK's to refuse, by name: only well-formed refs are resolved.
  if ouroboros.regression_bisect_result_valid(new.bisect_result)
     and (tg_op = 'INSERT' or new.bisect_result is distinct from old.bisect_result)
     and exists (select 1 from jsonb_array_elements_text(new.bisect_result -> 'farm_job_ids') j
                  where not exists (select 1 from ouroboros.build_jobs bj
                                     where bj.id = j::uuid and bj.organization_id = new.organization_id)) then
    raise exception 'a bisect''s farm jobs are build jobs of the workspace'
      using errcode = 'foreign_key_violation', constraint = 'regression_watch_items_bisect_jobs';
  end if;

  if new.investigation_id is not null
     and (tg_op = 'INSERT' or new.investigation_id is distinct from old.investigation_id) then
    select i.origin into origin_found
      from ouroboros.investigations i
     where i.id = new.investigation_id and i.organization_id = new.organization_id;
    -- Another workspace's investigation is the composite foreign key's to refuse, by name.
    if found and origin_found <> 'regression_watch' then
      raise exception 'investigation % was opened by %, not by the regression watch', new.investigation_id, origin_found
        using errcode = 'check_violation', constraint = 'regression_watch_items_investigation_origin';
    end if;
  end if;

  if ouroboros.regression_fix_ticket_ref_valid(new.fix_ticket_ref)
     and (tg_op = 'INSERT' or new.fix_ticket_ref is distinct from old.fix_ticket_ref) then
    if new.fix_ticket_ref ->> 'kind' = 'ticket' then
      select t.external_key into key_found
        from ouroboros.tickets t
       where t.id = (new.fix_ticket_ref ->> 'id')::uuid and t.organization_id = new.organization_id;
    else
      select d.local_key into key_found
        from ouroboros.ticket_drafts d
        join ouroboros.draft_batches b on b.id = d.batch_id
       where d.id = (new.fix_ticket_ref ->> 'id')::uuid and b.organization_id = new.organization_id;
    end if;
    if not found then
      raise exception 'fix % % is not one of the workspace''s', new.fix_ticket_ref ->> 'kind', new.fix_ticket_ref ->> 'id'
        using errcode = 'foreign_key_violation', constraint = 'regression_watch_items_fix_ticket_ref';
    end if;
    if key_found <> new.fix_ticket_ref ->> 'key' then
      raise exception 'fix % is shown as %, not %', new.fix_ticket_ref ->> 'id', key_found, new.fix_ticket_ref ->> 'key'
        using errcode = 'check_violation', constraint = 'regression_watch_items_fix_ticket_key';
    end if;
  end if;

  if ouroboros.regression_pr_ref_valid(new.pr_ref)
     and (tg_op = 'INSERT' or new.pr_ref is distinct from old.pr_ref) then
    select '#' || p.external_number into key_found
      from ouroboros.pull_requests p
     where p.id = (new.pr_ref ->> 'pull_request_id')::uuid and p.organization_id = new.organization_id;
    if not found then
      raise exception 'pull request % is not one of the workspace''s', new.pr_ref ->> 'pull_request_id'
        using errcode = 'foreign_key_violation', constraint = 'regression_watch_items_pr_ref';
    end if;
    if key_found <> new.pr_ref ->> 'key' then
      raise exception 'pull request % is %, not %', new.pr_ref ->> 'pull_request_id', key_found, new.pr_ref ->> 'key'
        using errcode = 'check_violation', constraint = 'regression_watch_items_pr_key';
    end if;
  end if;

  return new;
end;
$$;

comment on function ouroboros.regression_watch_items_refs() is
  'Refuses a watch item whose window is not in its baseline''s unit, whose drift is in neither % nor that unit, or whose bisect farm jobs, investigation (origin regression_watch), fix ticket or draft (key = its external_key / local_key) or pull request (key = #number) is not its workspace''s (#611).';

create trigger regression_watch_items_refs
  before insert or update on ouroboros.regression_watch_items
  for each row execute function ouroboros.regression_watch_items_refs();

-- regression_watch_item_next(from_status, to_status) — whether the lifecycle has that edge.
--   returns true for an edge of the header's diagram
create function ouroboros.regression_watch_item_next(from_status text, to_status text)
returns boolean language sql immutable as $$
  select (from_status, to_status) in (
    ('detected', 'bisecting'), ('detected', 'investigation_open'),
    ('bisecting', 'bisected'), ('bisecting', 'detected'),
    ('bisected', 'investigation_open'), ('bisected', 'fix_drafted'),
    ('investigation_open', 'fix_drafted'),
    ('fix_drafted', 'fix_running'),
    ('fix_running', 'fixed_merged'), ('fix_running', 'fix_drafted'))
    or (to_status = 'dismissed' and from_status not in ('fixed_merged', 'dismissed'));
$$;

comment on function ouroboros.regression_watch_item_next(text, text) is
  'The regression watch lifecycle''s edges (#611): detected → bisecting | investigation_open; bisecting → bisected | detected (no repro); bisected → investigation_open | fix_drafted; investigation_open → fix_drafted; fix_drafted → fix_running; fix_running → fixed_merged | fix_drafted (loop failed); any non-terminal → dismissed.';

-- regression_watch_items_transition() — the lifecycle, and what a row keeps.
create function ouroboros.regression_watch_items_transition()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'detected' then
      raise exception 'a regression watch item is opened detected, not %', new.status
        using errcode = 'check_violation', constraint = 'regression_watch_items_opened_detected';
    end if;
    new.status_changed_at := new.detected_at;
    return new;
  end if;

  if new.id <> old.id or new.organization_id <> old.organization_id
     or new.baseline_id <> old.baseline_id or new.detected_at <> old.detected_at then
    raise exception 'regression watch item % keeps its workspace, baseline and detection time', old.id
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  -- A terminal item is the record: only a foreign key's set-null may still touch it.
  if old.status in ('fixed_merged', 'dismissed')
     and (row(new.current, new.drift_value, new.drift_unit, new.severity, new.status, new.bisect_result,
              new.fix_ticket_ref, new.pr_ref, new.note, new.dismissed_at, new.dismiss_reason)
          is distinct from
          row(old.current, old.drift_value, old.drift_unit, old.severity, old.status, old.bisect_result,
              old.fix_ticket_ref, old.pr_ref, old.note, old.dismissed_at, old.dismiss_reason)
          or (new.investigation_id is not null and new.investigation_id is distinct from old.investigation_id)
          or (new.dismissed_by is not null and new.dismissed_by is distinct from old.dismissed_by)) then
    raise exception 'regression watch item % is %, and is final', old.id, old.status
      using errcode = 'check_violation', constraint = tg_name;
  end if;

  if new.status <> old.status then
    if not ouroboros.regression_watch_item_next(old.status, new.status) then
      raise exception 'regression watch item % cannot go from % to %', old.id, old.status, new.status
        using errcode = 'check_violation', constraint = tg_name;
    end if;
    if new.status = 'investigation_open' and new.investigation_id is null then
      raise exception 'regression watch item % opens an investigation by naming it', old.id
        using errcode = 'check_violation', constraint = 'regression_watch_items_investigation_named';
    end if;
    if new.status = 'dismissed' and new.dismissed_by is null then
      raise exception 'regression watch item % is dismissed by somebody', old.id
        using errcode = 'check_violation', constraint = 'regression_watch_items_dismissed_by';
    end if;
    new.status_changed_at := now();
  end if;

  -- What a step established stays established.
  if old.bisect_result is not null and new.bisect_result is distinct from old.bisect_result then
    raise exception 'regression watch item % keeps the bisect result it recorded', old.id
      using errcode = 'check_violation', constraint = 'regression_watch_items_bisect_result_kept';
  end if;
  if old.investigation_id is not null and new.investigation_id is not null
     and new.investigation_id <> old.investigation_id then
    raise exception 'regression watch item % keeps the investigation it opened', old.id
      using errcode = 'check_violation', constraint = 'regression_watch_items_investigation_kept';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

comment on function ouroboros.regression_watch_items_transition() is
  'Opens an item detected; then refuses a status change off the lifecycle (regression_watch_item_next), entering investigation_open without an investigation or dismissed without a person, rewriting a recorded bisect result or investigation, moving the workspace, baseline or detection time, and any change to a fixed_merged or dismissed item but a foreign key''s set-null (#611).';

create trigger regression_watch_items_transition
  before insert or update on ouroboros.regression_watch_items
  for each row execute function ouroboros.regression_watch_items_transition();

-- ===========================================================================
-- Grants
-- ===========================================================================

-- Baselines are captured and read, never edited or removed by the application.
grant select, insert on ouroboros.regression_baselines to ouroboros_app;
grant select, insert, update on ouroboros.regression_watch_items to ouroboros_app;
grant select, insert, update on ouroboros.regression_watch_settings to ouroboros_app;
