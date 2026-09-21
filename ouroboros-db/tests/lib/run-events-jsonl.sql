-- run-events-jsonl.sql — the JSONL export's bytes, for exactly the transcript
-- tests/constraints.sql builds in its V046 section (#299, AO.2).
--
-- `V046__run_event_store.sql`'s header specifies the shape mockup 10's **Raw JSONL ↗** streams
-- — the field order, that a null field is absent, the UTC ISO 8601 timestamps, and `payload`
-- passed through in `jsonb`'s canonical rendering. A specification nothing is compared against
-- is a paragraph, so this is the comparison: the eleven lines that specification produces for
-- the eleven entries of the `#482` transcript, byte for byte.
--
-- Included from `tests/constraints.sql` with `\ir`, which resolves relative to the including
-- file, so it works whatever directory psql was started in. It creates one temporary table and
-- writes nothing to the schema.
--
-- **How to change it.** These bytes are not written by hand and must not be edited to make a
-- run go green — a fixture edited to match the code it is checking is a fixture that checks
-- nothing. A deliberate change to the projection is: change `run_event_jsonl()`, re-derive
-- these lines from the same fixture rows, and read the diff. A change nobody intended shows up
-- here as a failed assertion, which is the whole point.
--
-- AP.2 (#304) streams the export from `ouroboros.run_events_jsonl`, and AO.5 (#302) compares an
-- export against these same lines — which is what makes *"the export matches the store"* a
-- thing CI can fail on rather than a claim in a pull request.
--
-- In pg_temp, so it disappears with the session and cannot be mistaken for schema.
-- ---------------------------------------------------------------------------
create table pg_temp.run_events_jsonl_golden (seq integer primary key, line text not null);

insert into pg_temp.run_events_jsonl_golden (seq, line) values
  ( 1, $line${"seq": 1, "ts": "2026-08-08T14:02:11.000Z", "actor": "plan", "stage_key": "plan", "attempt": 1, "simulated": true, "body": "Root cause: test asserts on frame order; CAN driver ISR can reorder under load."}$line$),
  ( 2, $line${"seq": 2, "ts": "2026-08-08T14:03:26.000Z", "actor": "tool", "stage_key": "implement", "attempt": 1, "tool_tag": "read_file", "simulated": true, "body": "drivers/can/telemetry_buf.c", "payload": {"file": "drivers/can/telemetry_buf.c"}}$line$),
  ( 3, $line${"seq": 3, "ts": "2026-08-08T14:04:02.000Z", "actor": "model", "stage_key": "implement", "attempt": 1, "model_id": "claude-fable-5", "simulated": true, "body": "The buffer uses a bare k_fifo shared between the RX ISR and the telemetry thread. k_fifo gives no ordering guarantee once the ISR preempts a partially completed put — that matches the flake signature."}$line$),
  ( 4, $line${"seq": 4, "ts": "2026-08-08T14:04:40.000Z", "actor": "tool", "stage_key": "implement", "attempt": 1, "tool_tag": "edit_file", "simulated": true, "body": "drivers/can/telemetry_buf.c", "payload": {"file": "drivers/can/telemetry_buf.c", "hunks": [{"kind": "ctx", "text": "  /* telemetry frame path */"}, {"kind": "del", "text": "− static struct k_fifo tel_fifo;"}, {"kind": "add", "text": "+ K_MSGQ_DEFINE(tel_msgq, sizeof(struct tel_frame), CONFIG_TEL_QUEUE_DEPTH, 4);"}]}}$line$),
  ( 5, $line${"seq": 5, "ts": "2026-08-08T14:05:12.000Z", "actor": "tool", "stage_key": "implement", "attempt": 1, "tool_tag": "run_tests", "simulated": true, "body": "twister -T tests/telemetry", "payload": {"detail": "2 passed, 1 flaked → retrying under load profile", "result": {"failed": 0, "flaked": 1, "passed": 2}, "command": "twister -T tests/telemetry", "outcome": "warn"}}$line$),
  ( 6, $line${"seq": 6, "ts": "2026-08-08T14:07:48.000Z", "actor": "gate", "stage_key": "checks-green", "attempt": 1, "simulated": true, "body": "test flake reproduced — returning to implement (attempt 2) ↺", "payload": {"attempt": 2, "outcome": "warn", "returned_to": "implement"}}$line$),
  ( 7, $line${"seq": 7, "ts": "2026-08-08T14:08:15.000Z", "actor": "model", "stage_key": "implement", "attempt": 2, "model_id": "claude-fable-5", "simulated": true, "body": "The reorder window is in the ISR fast path; sequence numbers must be assigned before the enqueue, not after."}$line$),
  ( 8, $line${"seq": 8, "ts": "2026-08-08T14:09:30.000Z", "actor": "tool", "stage_key": "implement", "attempt": 2, "tool_tag": "edit_file", "simulated": true, "body": "drivers/can/isr_fastpath.c", "payload": {"file": "drivers/can/isr_fastpath.c", "hunks": [{"kind": "del", "text": "− k_msgq_put(&tel_msgq, &frame, K_NO_WAIT);"}, {"kind": "add", "text": "+ frame.seq = atomic_inc(&tel_seq);"}]}}$line$),
  ( 9, $line${"seq": 9, "ts": "2026-08-08T14:12:19.000Z", "actor": "tool", "stage_key": "implement", "attempt": 2, "tool_tag": "run_tests", "simulated": true, "body": "running… 47/63 cases", "payload": {"live": true, "progress": {"done": 47, "total": 63}}}$line$),
  (10, $line${"seq": 10, "ts": "2026-08-08T14:13:00.000Z", "actor": "user", "simulated": true, "body": "prefer a fix inside the ISR"}$line$),
  (11, $line${"seq": 11, "ts": "2026-08-08T14:14:00.000Z", "actor": "system", "simulated": true, "body": "an entry that claims to be real"}$line$);
