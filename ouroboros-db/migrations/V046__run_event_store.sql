-- V046__run_event_store.sql — `run_events`, the flight recorder behind mockup 10's agent
-- transcript: append-only, typed, capped, and exportable one row to one JSONL line.
--
-- Mockup 10 (docs/mockups/10-run-detail.html) draws the transcript as a list of *shapes*,
-- not as text:
--
--     14:02:11  PLAN            Root cause: test asserts on frame order; CAN driver ISR…
--     14:03:26  TOOL read_file  drivers/can/telemetry_buf.c
--     14:04:02  CLAUDE-FABLE-5  The buffer uses a bare k_fifo shared between the RX ISR…
--     14:04:40  TOOL edit_file  drivers/can/telemetry_buf.c
--                               ␣ /* telemetry frame path */
--                               − static struct k_fifo tel_fifo;
--                               + K_MSGQ_DEFINE(tel_msgq, …);
--     14:05:12  TOOL run_tests  twister -T tests/telemetry
--                               2 passed, 1 flaked → retrying under load profile
--     14:07:48  GATE            test flake reproduced — returning to implement (attempt 2) ↺
--     14:12:19  TOOL run_tests  running… 47/63 cases            ▓▓▓▓▓▓▓▓░░
--
-- When a run goes wrong at 3 a.m. this is the artifact somebody reads, and every other card
-- on the page is a summary of it. Filed as issue #299 (AO.2) under epic #294, the second
-- issue of the Run Console roadmap (docs/ROADMAP_MOCKUP_10_RUN_CONSOLE.md), and it stands on
-- V045's `run_stages` (#298).
--
-- Three roadmap decisions shape the table, and each of them is a column or a trigger here
-- rather than a rule a service is asked to keep.
--
--
-- R3 — typed, not a log.
-- ---------------------------------------------------------------------------
--
-- A wall of text renders as a wall of text. The actor chip, the tool tag, the diff block and
-- the progress meter exist because the reader is skimming for the moment things turned, so
-- the *store* carries the structure and the console queries it instead of parsing it:
-- `actor` is the chip, `tool_tag` is the tag beside it, `stage_key`/`attempt` are what the
-- stepper filters the transcript by, and `payload` holds the shapes that are not a sentence —
-- the diff's `{kind, text}` hunks, a test result, a progress fraction.
--
-- `payload` is the one open field, and it is not unexamined: a `hunks` key is held to the
-- three kinds the UI has treatments for (`ctx`, `del`, `add`, each with its `text`), because a
-- fourth kind is a diff line that renders as nothing at all.
--
--
-- R4 — it must never fabricate model reasoning.
-- ---------------------------------------------------------------------------
--
-- The violet `CLAUDE-FABLE-5` paragraphs are the most sensitive surface in the product: they
-- claim to be what a model thought. Two columns make that claim checkable.
--
--   * **`model_id`, and a `model` entry cannot exist without one** — with the stage and
--     attempt beside it (`run_events_model_provenance`). The chip the console prints *is* the
--     model id, so an entry that could not name a model is an entry the console could not
--     have drawn honestly.
--   * **`simulated`, and the client does not get the last word.** The watermark is raised to
--     the run's own — `runs.simulated`, which the ingestion contract (AP.1, #303) sets from
--     the principal that opened the run, not from the body of a report — so an entry written
--     into a simulated run is flagged whatever it asked for. A client may still raise the
--     flag on an otherwise real run, because that direction is a confession rather than a
--     claim. And a run's own flag is **fixed once it has said anything**, so no run can
--     relabel a transcript it has already written.
--
-- One field, so the UI watermark and the JSONL export inherit the truth from the same place
-- rather than deriving it twice.
--
--
-- The cap, and why the hole is a row.
-- ---------------------------------------------------------------------------
--
-- A run that emits a hundred thousand events cannot be stored unbounded, and it also cannot
-- be silently truncated: a transcript with a hole that looks seamless is worse than one that
-- says where the hole is. This is AG.5's rule (#247) and V040's shape (`build_log_chunk_cap`)
-- carried onto rows instead of bytes — with one difference that the medium forces.
--
-- A log is a byte stream, so V040 could clamp the chunk that crossed the cap and keep the
-- tail's figures on the job. A transcript is a list of entries, and half an entry is not an
-- entry — so the cap here refuses whole events and records what it refused **in a row of the
-- transcript itself**: a `system` event carrying `elided_events`, `elided_bytes`,
-- `elided_from` and `elided_to`. It takes the next sequence number, so the hole has a
-- position; it is the last row of the run, because a cap that has been reached is never
-- un-reached; and it accumulates, because the drops keep arriving after it is written.
--
-- Which is why this table has exactly one permitted update, and it is the database's own —
-- see `run_events_refuse_update()` and the grant section at the foot of the file.
--
--
-- The JSONL projection — one row, one line.
-- ---------------------------------------------------------------------------
--
-- `Raw JSONL ↗` on the transcript card is a streamed projection of these rows (AP.2, #304),
-- and AO.5 (#302) compares an export against a fixture byte for byte. That only means
-- anything if the bytes are specified here, so they are: `run_event_jsonl()` renders one row,
-- `run_events_jsonl` is the view over it, and the shape is
--
--     {"seq": 4, "ts": "2026-08-08T14:04:40.000Z", "actor": "tool",
--      "stage_key": "implement", "attempt": 1, "tool_tag": "edit_file",
--      "simulated": true, "body": "drivers/can/telemetry_buf.c",
--      "payload": {"file": "drivers/can/telemetry_buf.c", "hunks": [{"kind": "ctx", …}]}}
--
-- stated exactly:
--
--   1. **Field order is fixed** and is the order listed in `run_event_jsonl()`:
--      `seq`, `ts`, `actor`, `stage_key`, `attempt`, `tool_tag`, `model_id`, `simulated`,
--      `body`, `payload`, `elided_events`, `elided_bytes`, `elided_from`, `elided_to`.
--      It is not `jsonb`'s order — `jsonb` sorts keys, which would put `actor` before `seq`
--      and scatter an entry's provenance through the line — so the object is composed as
--      `json` text, where the order given is the order kept.
--   2. **A null field is absent.** A line carries the fields the entry reported and no
--      others, so a reader that finds `tool_tag` knows a tool was named rather than having to
--      tell `null` from *absent*. `seq`, `ts`, `actor` and `simulated` are on every line,
--      because none of them can be null.
--   3. **`ts`, `elided_from` and `elided_to` are UTC ISO 8601 with milliseconds** —
--      `2026-08-08T14:04:40.000Z` — rendered from the pattern rather than from the session,
--      so the same row exports the same bytes whatever `TimeZone` the connection is set to.
--   4. **`payload` is emitted as PostgreSQL renders `jsonb`**: keys sorted, one space after
--      each colon and comma, no other whitespace. That rendering is canonical — the same
--      value produces the same bytes on any server — which is the property a byte-for-byte
--      fixture needs, and the rest of the line is spaced to match so a line reads as one
--      document rather than two.
--   5. **There is no `run_id` on the line.** The export is one run's transcript, so the run
--      is the file's identity and a run id repeated on every line is a second copy of the
--      file name. `run_events_jsonl` carries `run_id` and `seq` as *columns* beside `line`,
--      which is what AP.2 filters and resumes on.
--
-- The fixture that holds this to its word is `tests/lib/run-events-jsonl.sql`, asserted from
-- `tests/constraints.sql` against the whole of mockup 10's transcript.
--
--
-- What this migration deliberately does not do.
-- ---------------------------------------------------------------------------
--
-- It seeds nothing. The `#482` transcript mockup 10 draws belongs to AO.5 (#302) along with
-- the rest of the console's development rows, and a seed here would be the same rows in two
-- migrations. The fixture above is a test fixture: it is created inside a transaction that
-- rolls back, and no database keeps it.
--
-- It writes no ingestion path. Which events a run emits, when, and how a redelivered batch is
-- recognised are AP.1's (#303); what this file owns is what the store will accept.

-- ---------------------------------------------------------------------------
-- `runs` gains the transcript's accounting, and R4's source of truth.
--
-- Six columns, and the reason they are on `runs` rather than in a table of their own is
-- V040's: the cap trigger has to read the running totals and the allowance under one lock on
-- every append, and the parent row is the row it already has to reach for.
--
--   * `simulated`        — R4's watermark, per run, which every event inherits.
--   * `event_seq`        — the highest sequence number handed out. The allocator's `+ 1`.
--   * `event_bytes`      — how much of the byte cap the stored transcript has used.
--   * `event_cap`        — how many events this run may store.
--   * `event_byte_cap`   — how many bytes of `body` and `payload` it may store.
--   * `events_elided_at` — when the cap first refused one. V040's `log_truncated_at`, and the
--     same two uses: *"was this transcript cut short?"* answered without reaching for the
--     marker row, and — see the trigger — the fact that makes a cap, once reached, stay
--     reached.
--
-- Both caps are per run and both are *columns*, for V040's two reasons. A long-running loop
-- legitimately says more than a one-stage fix, so the allowance is a property of the run; and
-- a cap nothing ever exceeds is indistinguishable from a cap that does not exist, so a test
-- has to be able to set one low enough to be observed reaching it. The floors below are small
-- for exactly that second reason, and the defaults are what an unconfigured run gets.
-- ---------------------------------------------------------------------------
alter table ouroboros.runs
  add column simulated      boolean not null default false,
  add column event_seq      integer not null default 0,
  add column event_bytes    bigint  not null default 0,
  add column event_cap      integer not null default 20000,
  add column event_byte_cap bigint  not null default 33554432,
  add column events_elided_at timestamptz;

alter table ouroboros.runs
  -- A cap of zero is not a cap, it is a switch that turns the transcript off; a run whose
  -- every event is elided has a flight recorder that recorded nothing and said so, which is
  -- not a state this product should be able to be configured into by arithmetic.
  add constraint runs_event_cap_range
    check (event_cap between 1 and 1000000),

  -- 256 bytes is under one line of a diff, which is the point: the floor exists so that a
  -- test can breach the cap with a handful of rows. The ceiling is a gibibyte — past it the
  -- answer is retention, not a bigger number.
  add constraint runs_event_byte_cap_range
    check (event_byte_cap between 256 and 1073741824),

  -- Both totals are the trigger's, and both only ever grow.
  add constraint runs_event_seq_non_negative   check (event_seq >= 0),
  add constraint runs_event_bytes_non_negative check (event_bytes >= 0);

comment on column ouroboros.runs.simulated is
  'Whether this run is being driven by a simulator rather than by an executor (#299, decision R4). The source of truth every run_events row inherits its own simulated flag from, set by the ingestion contract (AP.1) from the principal that opened the run — which is what makes the transcript''s watermark a fact about the writer rather than a field in the report. Fixed once the run has written anything: see runs_simulated_is_fixed().';
comment on column ouroboros.runs.event_seq is
  'The highest transcript sequence number handed out for this run (#299) — what run_events_append() allocates the next one from, and, because the sequence is dense, also the number of rows the transcript holds.';
comment on column ouroboros.runs.event_bytes is
  'How many bytes of body and payload this run''s stored transcript holds, measured by run_event_bytes() (#299). Read against event_byte_cap on every append, and clamped to the cap when one is refused so that the cap, once reached, stays reached.';
comment on column ouroboros.runs.event_cap is
  'How many transcript events this run may store (#299). Per run because a long loop legitimately says more than a one-stage fix, and a column because a cap nothing exceeds and a cap that does not exist look identical from the outside — a test has to be able to set one low enough to watch it work. The elision marker is not counted against it: it is the database''s row, not an event.';
comment on column ouroboros.runs.event_byte_cap is
  'How many bytes of body and payload this run''s transcript may store (#299), bounded by runs_event_byte_cap_range. The other half of the cap, because ten thousand diff hunks and ten thousand one-line notes are the same number of events and very different amounts of disk.';
comment on column ouroboros.runs.events_elided_at is
  'When either cap first refused an entry of this run''s transcript (#299) — V040''s log_truncated_at, and the same two uses: "was this cut short?" answered without reaching for the elision marker, and the fact that makes the cap terminal, so a run stopped by the byte half cannot admit a later smaller entry and leave the marker describing a hole with entries inside it. Null on a run that said everything it said. Distinct from the marker''s elided_from, which is the refused entry''s own clock rather than the refusal''s.';

-- ---------------------------------------------------------------------------
-- A run's watermark is decided before it says anything, and then it is fixed.
--
-- R4's flag is inherited **at write time**, so an entry keeps whatever the run's flag was when
-- it landed. That is what makes moving the run's flag afterwards a problem in *both*
-- directions rather than only one: lowered, the page stops drawing a watermark over rows that
-- still carry it; raised, the page draws one over rows that do not. Either way the header and
-- the lines of the same export disagree.
--
-- So the rule is the simplest one that cannot produce either: the flag may be set, and
-- changed, for as long as the run has written nothing — which is where the ingestion contract
-- sets it, from the principal that opened the run — and from the first entry onwards it is
-- what it is. A mislabelled run is corrected by opening another one, which is the honest
-- correction anyway: the transcript is a record of what a particular driver did.
--
-- It reads another table, so it is a trigger rather than a CHECK.
-- ---------------------------------------------------------------------------
create function ouroboros.runs_simulated_is_fixed()
returns trigger language plpgsql as $$
begin
  if new.simulated is distinct from old.simulated
     and exists (select 1 from ouroboros.run_events where run_id = old.id) then
    raise exception
      'run % has already written its transcript, so its simulated watermark is fixed', old.id
      using errcode = 'check_violation',
            constraint = 'runs_simulated_is_fixed',
            hint = 'Every entry already written carries the flag the run had when it landed (#299, decision R4), and moving the run''s flag now would make the export''s header disagree with its lines. Open a new run instead.';
  end if;

  return new;
end;
$$;

comment on function ouroboros.runs_simulated_is_fixed() is
  'Refuses a change to runs.simulated once the run has written a transcript (#299, decision R4). R4''s flag is inherited at write time, so moving the run''s afterwards makes the export''s header disagree with its lines — lowered it stops watermarking rows that carry the flag, raised it watermarks rows that do not. Before the first entry either direction is fine, which is where the ingestion contract sets it from the principal that opened the run.';

create trigger runs_simulated_is_fixed
  before update of simulated on ouroboros.runs
  for each row execute function ouroboros.runs_simulated_is_fixed();

-- ---------------------------------------------------------------------------
-- `runs_with_stage` carries them too.
--
-- V045's amendment on #64 is *"a read moves from `runs` to this view by changing one word"*,
-- and that is only true while the two have the same columns. Six were just added, so six are
-- added here — at the end, which is what `create or replace view` allows and what keeps every
-- existing read of the view working through the replacement.
-- ---------------------------------------------------------------------------
create or replace view ouroboros.runs_with_stage as
select run.id,
       run.organization_id,
       run.github_repo_id,
       run.issue_number,
       run.issue_title,
       run.workflow_tag,
       run.model,
       run.status,
       coalesce(current_stage.stage_label, run.stage_label) as stage_label,
       coalesce(current_stage.stage_index, run.stage_index) as stage_index,
       coalesce(current_stage.stage_total, run.stage_total) as stage_total,
       run.started_at,
       run.finished_at,
       run.pr_number,
       run.checks_passed,
       run.checks_total,
       run.created_at,
       run.updated_at,
       run.loop_seq,
       run.branch_name,
       run.workflow_version_pin,
       run.simulated,
       run.event_seq,
       run.event_bytes,
       run.event_cap,
       run.event_byte_cap,
       run.events_elided_at
  from ouroboros.runs run
  left join ouroboros.run_stage_current current_stage
    on current_stage.run_id = run.id;

comment on view ouroboros.runs_with_stage is
  'runs, with the stage meter resolved from stage history (#298, the amendment on #64, extended by #299). Identical to runs for a run with no run_stages rows, which is what lets a read move over one at a time and what keeps mockup 02 rendering while the legacy columns are still on the table. Their removal is a later migration.';

-- ---------------------------------------------------------------------------
-- What an event weighs.
--
-- The byte cap is a promise about the *transcript* — what the console renders and what the
-- export emits — and not about the disk, so this measures the two fields that carry an
-- entry's content in the form the projection writes them: `body` as it is stored, `payload`
-- in `jsonb`'s canonical rendering. It deliberately does not measure the row: `id`, the
-- timestamps and the typed columns are the same handful of bytes on every event, so counting
-- them would make the cap a number about row overhead rather than about how much a run said.
--
-- One function so the trigger, the tests and anything that later reports *"this run has used
-- 3.1 MB of its 32 MB"* all measure the same thing. Nulls weigh nothing, which is why an
-- entry that is only a `body` and an entry that is only a `payload` are both measured
-- without a branch.
-- ---------------------------------------------------------------------------
create function ouroboros.run_event_bytes(body text, payload jsonb)
returns bigint language sql immutable as $$
  select coalesce(octet_length(body), 0)::bigint
       + coalesce(octet_length(payload::text), 0)::bigint;
$$;

comment on function ouroboros.run_event_bytes(text, jsonb) is
  'What one transcript entry weighs against runs.event_byte_cap (#299): its body plus its payload in jsonb''s canonical rendering, and nothing else. A promise about how much a run said, not about row overhead — and one function, so the cap trigger and anything that reports the meter measure the same bytes.';

-- ---------------------------------------------------------------------------
-- run_events — the transcript.
-- ---------------------------------------------------------------------------
create table ouroboros.run_events (
  id        uuid        primary key default gen_random_uuid(),

  -- The run whose transcript this is, and — V029's and V045's choice — the whole of this
  -- row's tenancy: an event has no meaning apart from its run, and every read enters through
  -- one. Cascade, because a transcript nobody can reach is not a record of anything.
  run_id    uuid        not null
                        references ouroboros.runs (id) on delete cascade,

  -- **The transcript's own order, dense from 1**, and the cursor AP.2's `?after=<seq>` reads.
  -- Assigned by `run_events_append()` from `runs.event_seq`, never by the caller — see the
  -- trigger for why an offset the database does not own is a reader that silently skips
  -- entries.
  seq       integer     not null,

  -- When the entry happened, which is the `14:04:40` the transcript prints. The event's own
  -- clock rather than the store's: `received_at` below is when it landed, and the two differ
  -- by however long the report took to arrive. The transcript is ordered by `seq` and not by
  -- this, because a clock that steps backwards must not reorder a diff after the edit that
  -- produced it.
  ts        timestamptz not null default now(),

  -- **The chip.** Six words, and the console's six treatments: `plan` is the PLAN note,
  -- `tool` is a TOOL row with its tag, `model` is the violet reasoning paragraph, `gate` is
  -- the warn line a loop edge writes, `user` is a person steering, and `system` is the store
  -- speaking for itself — which today is the elision marker and nothing else.
  actor     text        not null,

  -- --- where in the run this happened -----------------------------------------
  --
  -- The pair the stepper filters the transcript by: *"show me what Implement said on its
  -- second attempt"*. Both set or both absent (`run_events_stage_ref_complete`), because an
  -- event that names a stage without an attempt cannot be found by that filter and is a
  -- reference to a row that may not be the one meant.
  --
  -- Held to the DSL node-id shape V045 holds `run_stages.stage_key` to, and **not a foreign
  -- key**, for two reasons rather than one. V045's (decision F8): a closed run must still
  -- render under a workflow that has since been renamed or deleted. And ingestion's: a
  -- report can reach this table before the stage transition that created the row it names,
  -- and a transcript that refused an entry because its stage had not been written yet would
  -- lose the entry to fix an ordering problem it did not have.
  stage_key text,
  attempt   integer,

  -- The tag beside the TOOL chip — `read_file`, `edit_file`, `run_tests`. An open vocabulary
  -- held to a shape rather than a list, because the tools a workflow can call are not this
  -- migration's to enumerate; closed to `actor = 'tool'`, because the mockup draws the tag
  -- only there and a tag on a model's paragraph is a chip with nothing to render it.
  tool_tag  text,

  -- **The provenance R4 is about.** The model the entry came from — `claude-fable-5`, which
  -- is the word the violet chip prints. Required on a `model` entry
  -- (`run_events_model_provenance`) and permitted elsewhere, because a tool call made on a
  -- model's behalf is a thing worth attributing and a plan note is not a claim about a model
  -- at all.
  model_id  text,

  -- What the entry says: the PLAN note, the file path under a `read_file`, the command under
  -- a `run_tests`, the model's paragraph, the gate's warn line. No length limit here on
  -- purpose — a reasoning paragraph is as long as it is, and what bounds it is
  -- `runs.event_byte_cap`, which bounds the transcript rather than the sentence.
  body      text,

  -- Everything about the entry that is not a sentence: `{file, hunks: [{kind, text}]}` for a
  -- diff, a test result, a progress fraction. The one open field, and not an unexamined one —
  -- `run_events_payload_hunks_typed` holds a diff's hunks to the three kinds the console has
  -- treatments for.
  payload   jsonb,

  -- **R4's watermark, per entry.** Raised to the run's by `run_events_append()`, so a client
  -- cannot report an unwatermarked entry into a simulated run. The UI's overlay and the
  -- JSONL's field are the same column, which is what keeps the page and the export from
  -- disagreeing about what was real.
  simulated boolean     not null default false,

  -- --- the elision marker -------------------------------------------------------
  --
  -- All four null on every entry a run reported; all four set on the one row the cap writes
  -- about itself. The figures a console renders as `[… 1 284 events (3.1 MB) elided between
  -- 14:22:07 and 14:31:40]` in the place the entries would have been, which is the whole
  -- difference between a bounded transcript and a truncated one.
  --
  -- Written by `run_events_append()` and refused from any caller: a marker somebody else can
  -- write is the product describing a hole that was never there.
  elided_events integer,
  elided_bytes  bigint,
  elided_from   timestamptz,
  elided_to     timestamptz,

  -- When the entry landed here, as against when it happened (`ts`). V040's `received_at` on
  -- `build_log_chunks`, and the same use: the gap between the two is what an ingestion lag
  -- looks like. There is no `updated_at`, because there is nothing to touch — see
  -- `run_events_refuse_update()`.
  received_at timestamptz not null default now(),

  -- --- the cursor's key -----------------------------------------------------------
  --
  -- One entry per sequence number per run. The key `?after=<seq>` pages by, the key a
  -- redelivered batch collides on rather than duplicating the transcript, and the index the
  -- `runs` cascade deletes through — which is why no second index on `run_id` is created.
  constraint run_events_run_seq_key unique (run_id, seq),

  constraint run_events_seq_positive check (seq >= 1),

  -- --- the vocabularies and the shapes ---------------------------------------------
  constraint run_events_actor
    check (actor in ('plan', 'tool', 'model', 'gate', 'user', 'system')),

  constraint run_events_stage_key_slug
    check (stage_key is null
           or (stage_key ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$' and length(stage_key) <= 64)),

  constraint run_events_attempt_positive
    check (attempt is null or attempt >= 1),

  -- A stage reference is the pair or it is nothing. See the columns above.
  constraint run_events_stage_ref_complete
    check ((stage_key is null) = (attempt is null)),

  -- `read_file`, `edit_file`, `run_tests`, and whatever a workflow calls next. Underscores
  -- rather than hyphens because that is the form the mockup's tags take and the form a tool
  -- name has everywhere else in this product.
  constraint run_events_tool_tag_shape
    check (tool_tag is null
           or (tool_tag ~ '^[a-z0-9]([a-z0-9_]*[a-z0-9])?$' and length(tool_tag) <= 64)),

  -- The tag belongs to the TOOL chip and to nothing else.
  constraint run_events_tool_tag_is_a_tool
    check (tool_tag is null or actor = 'tool'),

  constraint run_events_model_id_present
    check (model_id is null
           or (btrim(model_id) = model_id and model_id <> '' and length(model_id) <= 200)),

  -- **Decision R4, as a constraint.** A model entry names the model, the stage and the
  -- attempt, or it is refused. The console draws that chip as *this model said this* — an
  -- entry that could not say which model, on which attempt, is the fabrication the decision
  -- exists to make impossible.
  constraint run_events_model_provenance
    check (actor <> 'model'
           or (model_id is not null and stage_key is not null and attempt is not null)),

  -- --- an entry says something ------------------------------------------------------
  constraint run_events_says_something
    check (body is not null or payload is not null),
  constraint run_events_body_present
    check (body is null or btrim(body) <> ''),
  constraint run_events_payload_is_an_object
    check (payload is null or jsonb_typeof(payload) = 'object'),

  -- **The diff's hunks are typed.** Decision R3: the console has exactly three line
  -- treatments — context, deleted, added — so a fourth kind is a line that renders as
  -- nothing, and a hunk without text is a line with nothing in it. Written as a jsonpath
  -- because a CHECK cannot hold a subquery: the expression asks whether any hunk is *not*
  -- one of the three with a string `text`, and refuses the row if one is. The
  -- `jsonb_typeof` beside it is what stops a single hunk object standing in for the array —
  -- jsonpath is lax by default and would unwrap it.
  constraint run_events_payload_hunks_typed
    check (payload is null
           or not jsonb_exists(payload, 'hunks')
           or (jsonb_typeof(payload -> 'hunks') = 'array'
               and not jsonb_path_exists(
                     payload,
                     '$.hunks[*] ? (!(@.kind == "ctx" || @.kind == "del" || @.kind == "add")
                                    || !(@.text.type() == "string"))'))),

  -- --- the marker is whole, or absent -------------------------------------------------
  constraint run_events_elision_complete
    check (num_nonnulls(elided_events, elided_bytes, elided_from, elided_to) in (0, 4)),

  -- The store speaking for itself, so it speaks as `system` and carries none of the fields an
  -- entry a run reported would have. Its `payload` holds the cap it hit, which is what turns
  -- *"entries are missing"* into *"this run reached its 20 000-event cap"*.
  constraint run_events_elision_is_a_system_row
    check (elided_events is null
           or (actor = 'system'
               and body is null
               and tool_tag is null
               and model_id is null
               and stage_key is null)),

  -- A marker that elided nothing is a hole with no hole in it. The span is a span.
  constraint run_events_elision_counts
    check (elided_events is null
           or (elided_events >= 1 and elided_bytes >= 0 and elided_to >= elided_from))
);

comment on table ouroboros.run_events is
  'The agent transcript mockup 10 draws, as typed append-only rows (#299, AO.2, decisions R3 and R4) — the product''s flight recorder, and the artifact every other card on the run page summarises. Ordered by a dense per-run seq that AP.2 pages by; typed by actor, tool_tag, stage_key/attempt and a payload whose diff hunks are held to the three kinds the console renders; watermarked per entry by simulated, which the run''s own flag raises. Bounded by runs.event_cap and runs.event_byte_cap, and bounded visibly: the cap writes an elision marker into the transcript rather than letting it stop mid-run. Append-only by trigger and by grant — the marker''s own accounting is the single exception.';
comment on column ouroboros.run_events.run_id is
  'The run this is the transcript of, and the whole of this row''s tenancy — V029''s and V045''s choice, since an event has no meaning apart from its run and every read enters through one. ON DELETE CASCADE.';
comment on column ouroboros.run_events.seq is
  'The transcript''s order, dense from 1 (#299) — the offset cursor AP.2''s ?after= reads, and the key a redelivered batch collides on. Assigned by run_events_append() from runs.event_seq; a caller may supply it only if it continues the stream, because an offset the database does not own is a reader that silently skips entries.';
comment on column ouroboros.run_events.ts is
  'When the entry happened — the 14:04:40 the transcript prints — as against received_at, which is when it landed. The transcript is ordered by seq rather than by this, so a clock that steps backwards cannot reorder a diff after the edit that produced it.';
comment on column ouroboros.run_events.actor is
  'plan | tool | model | gate | user | system — the chip the transcript draws (#299, decision R3). system is the store speaking for itself, which today is the elision marker and nothing else.';
comment on column ouroboros.run_events.stage_key is
  'The DSL node id this entry happened under — implement, checks-green — held to V045''s node-id shape and paired with attempt. Deliberately not a foreign key: a closed run must still render under a workflow that has been renamed or deleted (decision F8), and a report can arrive before the stage transition that created the row it names.';
comment on column ouroboros.run_events.attempt is
  'Which attempt of that stage — the 2 of attempt 2/3 — and the other half of the stepper''s transcript filter. Set with stage_key or not at all.';
comment on column ouroboros.run_events.tool_tag is
  'The tag beside the TOOL chip — read_file, edit_file, run_tests. An open vocabulary held to a shape, because the tools a workflow may call are not this migration''s to enumerate, and closed to actor = tool, because a tag anywhere else is a chip with nothing to draw it.';
comment on column ouroboros.run_events.model_id is
  'The model this entry came from — claude-fable-5, the word the violet chip prints (#299, decision R4). Required on a model entry and permitted elsewhere: a tool call made on a model''s behalf is worth attributing, and a plan note is not a claim about a model at all.';
comment on column ouroboros.run_events.body is
  'What the entry says — the plan note, the path under a read_file, the command under a run_tests, the model''s paragraph, the gate''s warn line. Deliberately unbounded in length: a reasoning paragraph is as long as it is, and runs.event_byte_cap bounds the transcript rather than the sentence.';
comment on column ouroboros.run_events.payload is
  'Everything about the entry that is not a sentence (#299, decision R3): a diff''s {file, hunks: [{kind, text}]}, a test result, a progress fraction. The one open field, and not unexamined — run_events_payload_hunks_typed holds a diff''s hunks to the three kinds the console has line treatments for.';
comment on column ouroboros.run_events.simulated is
  'Whether this entry was produced by a simulated driver (#299, decision R4) — the UI''s watermark and the JSONL''s field, read from one column so the page and the export cannot disagree. Raised to runs.simulated by run_events_append(), so it is set from the principal that opened the run rather than from the body of a report; a client may raise it on a real run, because that direction is a confession rather than a claim.';
comment on column ouroboros.run_events.elided_events is
  'On the cap''s elision marker, how many entries this run''s transcript refused (#299, the AG.5 pattern of #247). Null on every entry a run reported. Written by run_events_append() and refused from any caller: a marker somebody else can write is the product describing a hole that was never there.';
comment on column ouroboros.run_events.elided_bytes is
  'On the elision marker, how many bytes of body and payload were refused with those entries, measured by run_event_bytes().';
comment on column ouroboros.run_events.elided_from is
  'On the elision marker, the ts of the first entry the cap refused — the start of the hole the console draws.';
comment on column ouroboros.run_events.elided_to is
  'On the elision marker, the ts of the most recent entry the cap refused. The one figure on this table that moves, and the reason run_events has exactly one permitted update.';
comment on column ouroboros.run_events.received_at is
  'When the entry landed here, as against ts, which is when it happened — V040''s received_at and the same use: the gap between the two is what ingestion lag looks like. There is no updated_at, because nothing revises an event.';
comment on constraint run_events_run_seq_key on ouroboros.run_events is
  'One entry per sequence number per run (#299) — the key AP.2''s ?after= pages by, the key a redelivered batch collides on rather than duplicating the transcript, and the index the runs cascade deletes through.';
comment on constraint run_events_model_provenance on ouroboros.run_events is
  'Decision R4 as a constraint (#299): a model entry names the model, the stage and the attempt, or it is refused. The console draws that chip as *this model said this*, and an entry that could not say which model on which attempt is the fabrication the decision exists to make impossible.';
comment on constraint run_events_payload_hunks_typed on ouroboros.run_events is
  'A diff''s hunks are {kind: ctx|del|add, text: string} (#299, decision R3). The console has exactly three line treatments, so a fourth kind is a line that renders as nothing. A jsonpath rather than an EXISTS, because a CHECK cannot hold a subquery.';

-- ---------------------------------------------------------------------------
-- Indexes.
-- ---------------------------------------------------------------------------

-- **One marker per run**, and the index the cap trigger folds a drop into.
--
-- Partial, so it costs one entry per *capped* run rather than one per event — which on an
-- ordinary run is nothing at all. Unique, because two markers would be two accounts of the
-- same hole, and the console would draw the transcript as though it had been interrupted
-- twice.
create unique index run_events_one_elision_idx
  on ouroboros.run_events (run_id)
  where elided_events is not null;

comment on index ouroboros.run_events_one_elision_idx is
  'At most one elision marker per run (#299), and the index run_events_append() folds each further drop into. A cap that has been reached is never un-reached, so the hole is always the tail and two markers would be two accounts of one hole.';

-- The stepper's transcript filter: *"what did Implement say on its second attempt?"* — the
-- read behind clicking a node of mockup 10's stage timeline.
create index run_events_run_stage_attempt_idx
  on ouroboros.run_events (run_id, stage_key, attempt);

comment on index ouroboros.run_events_run_stage_attempt_idx is
  'The stepper''s transcript filter (#299) — one run''s entries under one stage and attempt, which is what clicking a node of mockup 10''s timeline asks for.';

-- **BRIN on `ts`.**
--
-- Not the transcript's own read — that enters through `run_id` and is served by
-- `run_events_run_seq_key`. This is for the questions asked *across* runs and over a time
-- range: retention, and *"what was the fleet doing at 14:00?"*. Events arrive in time order
-- and are never updated, so the physical order of this table tracks `ts` closely, which is
-- the one condition under which BRIN is the right structure — a few pages of summary against
-- a btree that would be a large fraction of the table itself.
create index run_events_ts_brin_idx
  on ouroboros.run_events using brin (ts);

comment on index ouroboros.run_events_ts_brin_idx is
  'Time-ranged reads across runs — retention, and what the fleet was doing at 14:00 (#299). BRIN rather than btree because an append-only table that is never updated is stored in very nearly ts order, which is the condition BRIN is for: a few pages of summary instead of an index the size of a fraction of the table.';

-- ---------------------------------------------------------------------------
-- run_events_append() — the sequence, the caps, and R4's watermark.
--
-- Everything an append has to decide, in one BEFORE INSERT trigger, because all of it reads
-- the same locked `runs` row:
--
--   1. **The marker is refused from callers.** The four elision columns are the database's
--      account of what it dropped. A row that arrived carrying them is somebody writing the
--      product's own apology, so it is rejected before anything else happens.
--   2. **The run row is locked.** `event_seq` and `event_bytes` are running totals read and
--      written by every append; without the lock two concurrent writers read the same totals
--      and both allocate the same `seq`, which the unique key then turns into a failed
--      insert. One driver owns a run, so the lock is almost never contended — it is there for
--      the almost, and for the batch insert the acceptance criteria name, where a single
--      statement inserting fifty events takes it once and numbers them 1…50 in order.
--   3. **R4's watermark is raised.** `new.simulated or the run's` — never lowered.
--   4. **The caps are applied**, and this is where a transcript differs from a log. V040 can
--      clamp the chunk that crosses the byte cap, because half a log line is still log. Half
--      an event is not an event, so an entry is stored whole or refused whole, and what is
--      refused is recorded in the marker.
--   5. **`seq` is assigned** from the run's own total, or checked against it.
--
-- **The first refusal becomes the marker.** Rather than dropping the breaching row and then
-- inserting a second one — which would fire this trigger again and need a recursion guard to
-- survive it — the row on the table becomes the marker itself: it takes the next sequence
-- number, so the hole sits exactly where the entry would have been, and its own content is
-- replaced by the account of what was refused. Every later refusal is folded into that row
-- and writes nothing new.
--
-- Returning `null` from a BEFORE INSERT trigger is how those later refusals skip the row
-- without raising. An ingest path that had to handle an exception per event after the cap
-- would spend its time on the one run that has already been told it is at its limit.
--
-- **Why `security definer`, which nothing else in this schema is.** Every write in this
-- function is a write the *caller* must not be able to make. Steps 2 and 5 read and move
-- `runs`' own counters, which nothing above the schema may set — a statement that could would
-- be telling the store how much of itself it had used. And the fold in step 4 is an `update`
-- of a table whose whole point is that its writers cannot update it: the grant section below
-- revokes `update` from the application role, and the acceptance criterion says it must.
--
-- Neither of those is the caller's business, and both have to happen on the caller's insert.
-- Running as the function's owner is what makes that possible without handing the application
-- role a single privilege it should not have — with `ouroboros_app` holding `select` and
-- `insert` on this table and nothing anywhere else, an append works and an edit does not.
-- `tests/constraints.sql` asserts exactly that, from inside `set role ouroboros_app`.
-- It is narrow enough to be safe on inspection — no dynamic SQL, no caller-supplied
-- identifier, two statements against two tables named in full, and a `search_path` pinned to
-- the schemas they live in with `pg_temp` **last**, which is PostgreSQL's own hardening for a
-- definer function: unqualified relation lookups would otherwise reach the caller's temporary
-- schema first. There are none to reach, because every name here is qualified, and the pin is
-- what keeps that true of the next edit as well. `execute` is revoked from `public` below for
-- the same belt-and-braces reason: called outside a trigger it can only raise, and a
-- `security definer` function nobody needs to call should not be callable.
-- ---------------------------------------------------------------------------
create function ouroboros.run_events_append()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, ouroboros, pg_temp
as $$
declare
  cap_events       integer;
  cap_bytes        bigint;
  stored_seq       integer;
  stored_bytes     bigint;
  already_elided   timestamptz;
  run_is_simulated boolean;
  incoming         bigint;
begin
  if num_nonnulls(new.elided_events, new.elided_bytes,
                  new.elided_from, new.elided_to) > 0 then
    raise exception
      'ouroboros.run_events elision markers are written by the cap, not by the caller'
      using errcode = 'check_violation',
            constraint = 'run_events_elision_is_the_database_s',
            hint = 'The four elided_* columns are the database''s account of what it refused (#299). Insert the event; if it is past the cap the marker records it.';
  end if;

  select run.event_cap, run.event_byte_cap, run.event_seq, run.event_bytes,
         run.events_elided_at, run.simulated
    into cap_events, cap_bytes, stored_seq, stored_bytes,
         already_elided, run_is_simulated
    from ouroboros.runs run
   where run.id = new.run_id
     for update;

  -- No such run. The foreign key is the right thing to report that, and it is about to.
  if cap_events is null then
    return new;
  end if;

  -- Decision R4. The run's flag raises the entry's and never lowers it.
  new.simulated := new.simulated or run_is_simulated;

  incoming := ouroboros.run_event_bytes(new.body, new.payload);

  -- Past a cap, or past one already. `events_elided_at` is what makes the second clause of
  -- that sentence cheap and the cap terminal: without it a run stopped by the *byte* half
  -- would admit the next entry small enough to fit, and the marker would be describing a
  -- span of time with entries still inside it.
  --
  -- It is also why **raising a cap afterwards does not reopen a transcript**. That may read as
  -- unhelpful and it is the honest answer: the marker claims one contiguous hole running to the
  -- end, and entries landing after it would make that claim false. A run that needed a larger
  -- allowance needed it before it started talking.
  if already_elided is not null
     or stored_seq >= cap_events
     or stored_bytes + incoming > cap_bytes then
    -- If this run already has a marker, fold the refusal into it and write no row. One
    -- statement rather than a lookup and an update, because the partial unique index makes
    -- `found` the answer to *"was there a marker?"*.
    update ouroboros.run_events marker
       set elided_events = marker.elided_events + 1,
           elided_bytes  = marker.elided_bytes + incoming,
           elided_to     = greatest(marker.elided_to, new.ts)
     where marker.run_id = new.run_id
       and marker.elided_events is not null;

    if found then
      return null;
    end if;

    -- The first refusal. This row becomes the marker: it takes the position the entry would
    -- have had, and says what was refused there instead of saying what the entry said.
    new.seq           := stored_seq + 1;
    new.actor         := 'system';
    new.stage_key     := null;
    new.attempt       := null;
    new.tool_tag      := null;
    new.model_id      := null;
    new.body          := null;
    new.payload       := jsonb_build_object(
                           'kind',      'elision',
                           'reason',    case
                                          when stored_seq >= cap_events then 'per_run_event_cap'
                                          else                               'per_run_byte_cap'
                                        end,
                           'cap_events', cap_events,
                           'cap_bytes',  cap_bytes);
    new.elided_events := 1;
    new.elided_bytes  := incoming;
    new.elided_from   := new.ts;
    new.elided_to     := new.ts;

    -- The marker takes a sequence number and no allowance: it is the database's row, not one
    -- of the events the cap counts, so `event_bytes` does not move and keeps meaning *what
    -- this run's stored transcript weighs*. `events_elided_at` is the refusal's own clock,
    -- which is what the next append reads to know the transcript is closed.
    update ouroboros.runs
       set event_seq        = new.seq,
           events_elided_at = now()
     where id = new.run_id;

    return new;
  end if;

  -- Under both caps: the ordinary append. `seq` is the database's to assign, for V040's
  -- reason at `build_log_chunks.byte_start` — a cursor addressed by an offset the store does
  -- not own is a reader that silently returns the wrong entries.
  if new.seq is null then
    new.seq := stored_seq + 1;
  elsif new.seq <> stored_seq + 1 then
    raise exception
      'run_events.seq % does not continue run %''s transcript, which stands at %',
      new.seq, new.run_id, stored_seq
      using errcode = 'check_violation',
            constraint = 'run_events_seq_dense';
  end if;

  update ouroboros.runs
     set event_seq   = new.seq,
         event_bytes = stored_bytes + incoming
   where id = new.run_id;

  return new;
end;
$$;

comment on function ouroboros.run_events_append() is
  'The transcript''s append (#299): refuses a caller-written elision marker, locks the run, raises decision R4''s watermark to the run''s own, applies the event and byte caps, and assigns the dense seq AP.2''s ?after= pages by. Past the cap an entry is refused whole — half an event is not an event, which is the one way this differs from V040''s log cap — and the first refusal becomes the marker that records every later one. SECURITY DEFINER, and the only function in this schema that is: every write it makes is one the caller must not be able to make — the run''s own counters, and an update of a table whose writers may not update it — and all of them have to happen on the caller''s insert. search_path is pinned with pg_temp last, and execute is revoked from public.';

create trigger run_events_append
  before insert on ouroboros.run_events
  for each row execute function ouroboros.run_events_append();

-- PostgreSQL grants `execute` on a new function to `public`, and the one function in this
-- schema that runs as its owner should not be an exception nobody noticed. A trigger fires
-- regardless of this — the privilege is not consulted for a trigger's own function — and a
-- direct call can only raise, so nothing needs it.
revoke execute on function ouroboros.run_events_append() from public;

-- ---------------------------------------------------------------------------
-- Append-only, part one: the trigger.
--
-- V022's argument at `audit_events`, and it holds here for the same reason: the development
-- stack connects as the database owner and a superuser bypasses every grant, so a rule that
-- only lived in the catalogue would be true in production and false on the machine the code
-- is written on. A transcript that can be edited is not a flight recorder.
--
-- **The one exception**, and it is recognisable from the row rather than from who is asking:
-- the elision marker's own figures, growing. The columns that may move are `elided_events`,
-- `elided_bytes` and `elided_to`; they may only increase; every other column of the row,
-- `elided_from` included, must come back unchanged. So the guarantee this table makes is
-- exactly: *what a run said cannot be revised, and the account of what it was not allowed to
-- say can only grow*.
--
-- There is deliberately **no delete counterpart**, for V022's reason: `run_id` cascades, and
-- a before-delete trigger would not make this table append-only — it would make deleting a
-- run, and therefore a workspace, fail. Deletion is refused by grant, below.
-- ---------------------------------------------------------------------------
create function ouroboros.run_events_refuse_update()
returns trigger language plpgsql as $$
begin
  if old.elided_events is not null
     and new.elided_events >= old.elided_events
     and new.elided_bytes  >= old.elided_bytes
     and new.elided_to     >= old.elided_to
     and row(new.id, new.run_id, new.seq, new.ts, new.actor, new.stage_key, new.attempt,
             new.tool_tag, new.model_id, new.body, new.payload, new.simulated,
             new.elided_from, new.received_at)
         is not distinct from
         row(old.id, old.run_id, old.seq, old.ts, old.actor, old.stage_key, old.attempt,
             old.tool_tag, old.model_id, old.body, old.payload, old.simulated,
             old.elided_from, old.received_at)
  then
    return new;
  end if;

  raise exception
    'ouroboros.run_events is append-only: a transcript entry cannot be revised'
    using errcode = 'restrict_violation',
          detail  = format('refused update of entry %s (seq %s, %s) of run %s',
                           old.id, old.seq, old.actor, old.run_id),
          hint    = 'Append a correcting entry instead. The only update this table permits is the cap''s own elision marker growing (#299).';
end;
$$;

comment on function ouroboros.run_events_refuse_update() is
  'Refuses every UPDATE on run_events except the elision marker''s figures growing (#299) — for any role including the owner, which is the half of append-only that grants cannot enforce: the development stack connects as the database owner and a superuser bypasses every grant. The exception is recognised from the row rather than from who is asking, so the guarantee is exactly: what a run said cannot be revised, and the account of what it was not allowed to say can only grow.';

create trigger run_events_no_update
  before update on ouroboros.run_events
  for each row execute function ouroboros.run_events_refuse_update();

comment on trigger run_events_no_update on ouroboros.run_events is
  'A transcript entry cannot be revised (#299), for any role including the owner, with one exception — the cap''s own elision marker growing. There is deliberately no delete counterpart: run_id cascades, and a before-delete trigger would not enforce append-only, it would make deleting a run fail.';

-- ---------------------------------------------------------------------------
-- The JSONL projection — one row, one line.
--
-- `Raw JSONL ↗` (AP.2, #304) streams these lines; AO.5 (#302) compares an export against a
-- fixture byte for byte. The shape is specified in this file's header and composed here, and
-- the two functions are separate because the timestamp rendering is the part a reader most
-- wants to be able to check on its own.
-- ---------------------------------------------------------------------------

-- UTC ISO 8601 with milliseconds — `2026-08-08T14:04:40.000Z`. From the pattern rather than
-- from the session, so the same row exports the same bytes whatever `TimeZone` and
-- `DateStyle` the connection carries; the pattern names no month or day, so nothing in it is
-- locale-dependent either. `stable` rather than `immutable` because that is how PostgreSQL
-- marks `to_char` over a timestamp, and declaring more than a function's parts promise is how
-- an index built on one ends up wrong.
create function ouroboros.run_event_timestamp(at timestamptz)
returns text language sql stable as $$
  select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

comment on function ouroboros.run_event_timestamp(timestamptz) is
  'A transcript timestamp as the JSONL export writes it (#299): UTC ISO 8601 with milliseconds, rendered from the pattern rather than from the session, so a row exports the same bytes whatever TimeZone the connection is set to.';

-- One row as one JSONL line.
--
-- Composed as `json` text and not as `jsonb`, because `jsonb` sorts keys — it would put
-- `actor` before `seq` and scatter an entry's provenance through the line — and the field
-- order is part of the contract. The `values` list below *is* that order; a field whose
-- value is null contributes nothing, which is how *"a null field is absent"* is implemented:
-- `to_json` is strict, so a null column renders as a SQL null and the `where` drops it.
--
-- `payload` is the one value passed through rather than re-rendered, in `jsonb`'s canonical
-- form — keys sorted, one space after each colon and comma. The rest of the line is spaced to
-- match, so a line reads as one document rather than as two conventions meeting in the middle.
create function ouroboros.run_event_jsonl(event ouroboros.run_events)
returns text language sql stable as $$
  select '{' || string_agg(to_json(field.name)::text || ': ' || field.value,
                           ', ' order by field.ord) || '}'
    from (values
            ( 1, 'seq',           to_json(event.seq)::text),
            ( 2, 'ts',            to_json(ouroboros.run_event_timestamp(event.ts))::text),
            ( 3, 'actor',         to_json(event.actor)::text),
            ( 4, 'stage_key',     to_json(event.stage_key)::text),
            ( 5, 'attempt',       to_json(event.attempt)::text),
            ( 6, 'tool_tag',      to_json(event.tool_tag)::text),
            ( 7, 'model_id',      to_json(event.model_id)::text),
            ( 8, 'simulated',     to_json(event.simulated)::text),
            ( 9, 'body',          to_json(event.body)::text),
            (10, 'payload',       event.payload::text),
            (11, 'elided_events', to_json(event.elided_events)::text),
            (12, 'elided_bytes',  to_json(event.elided_bytes)::text),
            (13, 'elided_from',   to_json(ouroboros.run_event_timestamp(event.elided_from))::text),
            (14, 'elided_to',     to_json(ouroboros.run_event_timestamp(event.elided_to))::text)
         ) as field(ord, name, value)
   where field.value is not null;
$$;

comment on function ouroboros.run_event_jsonl(ouroboros.run_events) is
  'One transcript row as one JSONL line (#299) — the shape AP.2''s Raw JSONL export streams and AO.5 compares byte for byte, specified in V046''s header. Composed as json text rather than jsonb because jsonb sorts keys and the field order is part of the contract; a null field is absent; timestamps are UTC ISO 8601 with milliseconds; payload passes through in jsonb''s canonical rendering.';

-- The view the export reads. `run_id` and `seq` are columns rather than fields of the line:
-- the export is one run's transcript, so the run is the file's identity, and these two are
-- what AP.2 filters and resumes on.
--
-- No `order by` here — a view that carried one would promise an ordering PostgreSQL is free
-- to discard through any join, so the caller orders by `seq`, which is what the cursor pages
-- by anyway.
create view ouroboros.run_events_jsonl as
select event.run_id,
       event.seq,
       ouroboros.run_event_jsonl(event) as line
  from ouroboros.run_events event;

comment on view ouroboros.run_events_jsonl is
  'One run''s transcript as JSONL lines (#299) — what AP.2''s Raw JSONL export streams, one row to one line, in the shape V046''s header specifies. run_id and seq are columns rather than fields of the line, because the export is one run''s transcript: the run is the file''s identity, and these two are what the export filters and resumes on. Deliberately unordered — the caller orders by seq, which is what the cursor pages by.';

-- ---------------------------------------------------------------------------
-- Append-only, part two: the grants.
--
-- V022's block, for V022's reason. `ouroboros_app` is the role a deployment that separates
-- *migrating* from *running* connects the API as — Flyway owns the schema, the application
-- reads and writes rows — and V022 created it, so this is a grant against a role that exists
-- in every environment.
--
-- `select` and `insert` on the transcript, `select` on its projection, and nothing else. The
-- acceptance criterion is that the application role cannot update or delete an event, and
-- these four lines are that criterion: the two `revoke`s are no-ops today, because
-- `create table` grants nothing to anybody but the owner, and that is exactly why they are
-- written — a later migration that hands this table an `all privileges` should have to delete
-- them to do it rather than silently widening what the flight recorder allows.
--
-- What the append itself does on the way past — moving the run's counters, and keeping the
-- elision marker current — needs no grant here and must not have one: `run_events_append()`
-- runs as its own owner, which is what lets the store's accounting of itself stay true while
-- every caller stays unable to touch a byte of it. Two lines and one `security definer`, and
-- `tests/constraints.sql` asserts the whole posture from inside `set role ouroboros_app`.
-- ---------------------------------------------------------------------------
grant usage on schema ouroboros to ouroboros_app;
grant select, insert on ouroboros.run_events to ouroboros_app;
grant select on ouroboros.run_events_jsonl to ouroboros_app;

revoke update, delete on ouroboros.run_events from ouroboros_app;
revoke update, delete on ouroboros.run_events from public;
