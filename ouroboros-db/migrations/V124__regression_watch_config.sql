-- V124__regression_watch_config.sql — what the regression watch service needs to run: which
-- metrics a workspace watches and how each is replayed, the two policy switches, the bisect an
-- item is waiting on, and the two inbox kinds the watch files (#623, CM.4; decision V6).
--
-- V115 gave the watch its records: baselines, watch items and per-metric thresholds. The service
-- that fills them (#623) needs four more things, none of which had a home:
--
--   1. **`regression_watch_settings.metrics`** — the metrics a workspace watches, as a list:
--
--        [{"repo": "acme-robotics/helios-firmware",
--          "source": "case_metric", "key": "<case key>:hover_drift_cm", "class": "accuracy",
--          "window_days": 7,
--          "replay": {"pool": "pool-a", "command": ["west", "twister", "-T", "tests/hil/hover"]},
--          "nightly_ref": "main"}]
--
--      A release captures a baseline for each (`window_days` of history, 1–90, default 7); the
--      nightly comparison reads the same span. `replay` is the metric's **replayable test** — the
--      farm pool and the command a bisect step runs, success meaning *this commit is good* — or
--      null: a metric with none is never bisected and its item rests at `detected` with a
--      `needs repro` note. `nightly_ref` is the ref a bisect treats as bad (default `HEAD`, the
--      repository's default branch).
--   2. **`auto_bisect`** (default true) and **`auto_file`** (default false) — decision V6's
--      policy. A detected drift is bisected without asking; its fix is **drafted** without
--      asking; the draft is **filed and queued** only when a workspace has opted in.
--   3. **`fix_source_id`** — the ticket source fix drafts are composed for, or null to use the
--      workspace's only source. And **`last_compared_at`** — when the nightly comparison last
--      ran, so it runs once a day whatever the scheduler's tick is.
--   4. **`regression_watch_items.bisect_id`** — the bisect (V118) an item in `bisecting` is
--      waiting on. V115 recorded a bisect's *result*; nothing named the one still running.
--
-- And the two inbox kinds V093's vocabulary reserved for this ticket — `regression_drift_detected`
-- and `bisect_complete` — get their version-1 declarations, the way V097 declared the MVP kinds.
--
-- To undo (forward only — for a rehearsal against a copy):
--   delete from ouroboros.decision_kinds where kind_id in ('regression_drift_detected', 'bisect_complete');
--   alter table ouroboros.regression_watch_items drop column bisect_id;
--   alter table ouroboros.regression_watch_settings
--     drop column metrics, drop column auto_bisect, drop column auto_file,
--     drop column fix_source_id, drop column last_compared_at;
--   drop function ouroboros.regression_watch_metrics_valid(jsonb);

-- regression_watch_metrics_valid(metrics) — whether a jsonb value is a list of watched metrics.
--   metrics — the jsonb value
--   returns true for an array of at most 64 objects, each exactly
--     {repo, source, key, class, window_days, replay, nightly_ref}: repo an `owner/name`; source
--     bi_metric | case_metric with a key of that source's shape (V115); class timing | accuracy |
--     resource | rate; window_days an integer 1–90; replay null or exactly {pool, command} with
--     pool a non-blank string and command null or 1–64 non-blank strings; nightly_ref a non-blank
--     string of at most 255 characters with no white space — and no two entries sharing a repo
--     and key.
create function ouroboros.regression_watch_metrics_valid(metrics jsonb)
returns boolean language plpgsql immutable as $$
declare
  entry jsonb;
begin
  if jsonb_typeof(metrics) is distinct from 'array' or jsonb_array_length(metrics) > 64 then
    return false;
  end if;
  for entry in select e from jsonb_array_elements(metrics) e loop
    if not ouroboros.jsonb_keys_are(entry, array['repo', 'source', 'key', 'class', 'window_days',
                                                 'replay', 'nightly_ref']) then
      return false;
    end if;
    if not (jsonb_typeof(entry -> 'repo') = 'string'
            and (entry ->> 'repo') ~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'
            and length(entry ->> 'repo') <= 255
            and jsonb_typeof(entry -> 'source') = 'string'
            and entry ->> 'source' in ('bi_metric', 'case_metric')
            and jsonb_typeof(entry -> 'key') = 'string'
            and ouroboros.regression_metric_key_valid(entry ->> 'source', entry ->> 'key')
            and jsonb_typeof(entry -> 'class') = 'string'
            and entry ->> 'class' in ('timing', 'accuracy', 'resource', 'rate')
            and ouroboros.jsonb_nonneg_int(entry -> 'window_days')
            and (entry ->> 'window_days')::bigint between 1 and 90
            and jsonb_typeof(entry -> 'nightly_ref') = 'string'
            and (entry ->> 'nightly_ref') ~ '^[^[:space:]]{1,255}$') then
      return false;
    end if;
    if jsonb_typeof(entry -> 'replay') <> 'null' then
      if not (ouroboros.jsonb_keys_are(entry -> 'replay', array['pool', 'command'])
              and ouroboros.jsonb_nonblank_string(entry #> '{replay,pool}')
              and length(entry #>> '{replay,pool}') <= 100) then
        return false;
      end if;
      if jsonb_typeof(entry #> '{replay,command}') <> 'null'
         and not (jsonb_typeof(entry #> '{replay,command}') = 'array'
                  and jsonb_array_length(entry #> '{replay,command}') between 1 and 64
                  and not exists (select 1 from jsonb_array_elements(entry #> '{replay,command}') c
                                   where not ouroboros.jsonb_nonblank_string(c)
                                      or length(c #>> '{}') > 2000)) then
        return false;
      end if;
    end if;
  end loop;
  return (select count(*) = count(distinct (e ->> 'repo', e ->> 'key'))
            from jsonb_array_elements(metrics) e);
end;
$$;

comment on function ouroboros.regression_watch_metrics_valid(jsonb) is
  'True when a value is a list (≤ 64) of watched metrics {repo, source, key, class, window_days 1–90, replay null | {pool, command null | [strings]}, nightly_ref}, no two sharing a repo and key (#623).';

alter table ouroboros.regression_watch_settings
  add column metrics jsonb not null default '[]'
    constraint regression_watch_settings_metrics_shape
      check (ouroboros.regression_watch_metrics_valid(metrics)),
  add column auto_bisect boolean not null default true,
  add column auto_file boolean not null default false,
  add column fix_source_id uuid
    constraint regression_watch_settings_fix_source_fk
      references ouroboros.ticket_sources (id) on delete set null,
  add column last_compared_at timestamptz;

comment on column ouroboros.regression_watch_settings.metrics is
  'The metrics the workspace watches (#623): [{repo, source, key, class, window_days, replay, nightly_ref}]. A release captures a baseline for each; replay null means the metric has no replayable test and is never bisected.';
comment on column ouroboros.regression_watch_settings.auto_bisect is
  'Whether a detected drift is bisected without asking (#623, V6). Default true.';
comment on column ouroboros.regression_watch_settings.auto_file is
  'Whether a drafted fix is filed to the tracker and queued without asking (#623, V6) — an explicit opt-in. Default false: the draft waits for a person.';
comment on column ouroboros.regression_watch_settings.fix_source_id is
  'The ticket source fix drafts are composed for, or null to use the workspace''s only ticket source (#623).';
comment on column ouroboros.regression_watch_settings.last_compared_at is
  'When the nightly comparison last ran for the workspace (#623); null before the first.';

alter table ouroboros.regression_watch_items
  add column bisect_id uuid
    constraint regression_watch_items_bisect_fk
      references ouroboros.code_bisects (id) on delete set null;

comment on column ouroboros.regression_watch_items.bisect_id is
  'The bisect (V118) started for this drift (#623): the one a bisecting item waits on, and the one its bisect_result was read from.';

create index regression_watch_items_bisect_idx
  on ouroboros.regression_watch_items (bisect_id) where bisect_id is not null;

-- ---------------------------------------------------------------------------
-- The two inbox kinds (V093 reserved the ids for this ticket).
--
-- Neither asks for a judgement the watch is waiting on — the chain goes on by itself — so each
-- card is *news with a way to stop it*: a link to the watch, and **Dismiss drift**. A card also
-- closes by itself (`source_resolved`) once the item it is about has moved on.
-- ---------------------------------------------------------------------------
insert into ouroboros.decision_kinds
  (kind_id, version, severity_default, question_template, why_template, payload_schema, actions,
   resolution_semantics, ref_shape, escalation_window, merge_class)
values
  ('regression_drift_detected', 1, 'warn',
   '{metric} drifted {drift} since {release} — look into it?',
   'The nightly comparison of {repository} read {current} against the {release} baseline of {baseline}. {next_step}',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "regression_drift_detected v1",
      "type": "object",
      "properties": {
        "metric":     {"type": "string", "minLength": 1, "maxLength": 120,
                       "description": "The metric, as the watch names it."},
        "drift":      {"type": "string", "minLength": 1, "maxLength": 40,
                       "description": "The signed drift as the card prints it — +14% or +230 ms."},
        "release":    {"type": "string", "minLength": 1, "maxLength": 128,
                       "description": "The release whose baseline it was compared with."},
        "repository": {"type": "string", "minLength": 1, "maxLength": 255,
                       "description": "owner/name."},
        "baseline":   {"type": "string", "minLength": 1, "maxLength": 80,
                       "description": "The baseline window in words — median 4.1 cm (n = 30)."},
        "current":    {"type": "string", "minLength": 1, "maxLength": 80,
                       "description": "The nightly window in words — median 4.7 cm (n = 7)."},
        "next_step":  {"type": "string", "minLength": 1, "maxLength": 200,
                       "description": "What the watch does next: bisects it, or why it cannot."}
      },
      "required": ["metric", "drift", "release", "repository", "baseline", "current", "next_step"],
      "additionalProperties": false
    }',
   '[
      {"id": "open_watch", "label": "Open regression watch →", "style": "primary",
       "required_role": "viewer",
       "consequence_text": "Opens the regression watch on the Research page; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.research_watch"},
      {"id": "dismiss_drift", "label": "Dismiss drift", "style": "ghost",
       "required_role": "admin",
       "consequence_text": "Dismisses the watch item with your reason; a bisect still running is canceled.",
       "takes_note": true, "handler_binding": "research.dismiss_watch_item"}
    ]',
   '{"answered_by": ["dismiss_drift"], "closes_source": ["dismiss_drift"], "auto_resolvable": false}',
   '{"required": [], "optional": ["ticket"], "tags": []}',
   interval '1 day', false),

  ('bisect_complete', 1, 'info',
   '{metric} drift was bisected to {culprit} — review the fix?',
   'A bisect over {repository} built {steps} commits between {release} and the nightly and isolated {culprit}. {next_step}',
   '{
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "title": "bisect_complete v1",
      "type": "object",
      "properties": {
        "metric":     {"type": "string", "minLength": 1, "maxLength": 120,
                       "description": "The metric, as the watch names it."},
        "culprit":    {"type": "string", "pattern": "^[0-9a-f]{7}$",
                       "description": "The culprit commit, shortened as the card prints it."},
        "repository": {"type": "string", "minLength": 1, "maxLength": 255,
                       "description": "owner/name."},
        "release":    {"type": "string", "minLength": 1, "maxLength": 128,
                       "description": "The release the bisect started from — its good ref."},
        "steps":      {"type": "integer", "minimum": 1,
                       "description": "How many farm jobs decided it."},
        "next_step":  {"type": "string", "minLength": 1, "maxLength": 200,
                       "description": "What the watch does next: opens forensics and drafts a fix."}
      },
      "required": ["metric", "culprit", "repository", "release", "steps", "next_step"],
      "additionalProperties": false
    }',
   '[
      {"id": "open_watch", "label": "Open regression watch →", "style": "primary",
       "required_role": "viewer",
       "consequence_text": "Opens the regression watch on the Research page; nothing is decided.",
       "takes_note": false, "handler_binding": "navigate.research_watch"},
      {"id": "dismiss_drift", "label": "Dismiss drift", "style": "ghost",
       "required_role": "admin",
       "consequence_text": "Dismisses the watch item with your reason; its investigation and draft are kept.",
       "takes_note": true, "handler_binding": "research.dismiss_watch_item"}
    ]',
   '{"answered_by": ["dismiss_drift"], "closes_source": ["dismiss_drift"], "auto_resolvable": false}',
   '{"required": [], "optional": ["ticket"], "tags": []}',
   interval '1 day', false);
