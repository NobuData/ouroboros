# Decision — the engine's task queue

**Status:** accepted · **Issue:** [#54](https://github.com/NobuData/ouroboros/issues/54) ·
**Module:** `ouroboros-engine` (`src/ouroboros_engine/tasks/`)

This records what #54 built, how it behaves across a restart, and the counts that would make
an external queue worth its cost. The orchestration decision it sits under is
[DECISION_EXECUTION_ENGINE.md](DECISION_EXECUTION_ENGINE.md) (axis 1, option A): durable
state lives in `ouroboros-rest`, and the engine keeps nothing it cannot lose.

## What was built

| Piece | Where | What it does |
|---|---|---|
| Registry | `tasks/registry.py` | Maps a `task_kind` to a closed payload model and an async handler. Ships `sleep` (`{"seconds": 0…300}`) and `echo`. |
| Queue | `tasks/queue.py` | An `asyncio.Queue` (bound 1000 waiting) and a fixed pool of 4 worker coroutines on the application's event loop. Each handler runs as a child task, so cancelling a task never stops its worker. |
| Routes | `api/tasks.py` | `POST /v0/tasks` (`202`, record `queued`), `GET /v0/tasks/{task_id}`, `POST /v0/tasks/{task_id}/cancel`. |
| Lifespan | `main.py` | Starts the pool when the application starts; stops it on shutdown. |

A record moves `queued → running → done | failed | cancelled`; the last three are final.
A payload the kind cannot run is refused `422` at submission rather than failing later.
The 1000 most recent finished records stay readable; older ones answer `404`.

The pool size, the queue bound and the retention bound are constructor arguments with
in-code defaults, not `OURO_*` settings: no consumer needs to tune them yet, and a
setting is easy to add when one does.

## Restart behaviour

Nothing the queue holds is durable.

- **Graceful shutdown** (SIGTERM, a deploy): every running handler is cancelled and its
  record marked `cancelled` with error `engine_shutdown`. Queued tasks never start.
- **Any restart** (graceful or a crash): the new process holds no records. Every id the
  old one issued answers `404 task_not_found`.
- **Who recovers:** the caller. `ouroboros-rest` owns the durable row for whatever the task
  was doing, treats `404` (or a heartbeat that stops, per the execution-engine decision) as
  lost, and submits again. A handler must therefore be safe to run again from the start,
  or resume from a checkpoint the control plane holds.
- **No duplicate work across replicas** is promised by the queue itself; the claim-with-epoch
  fencing in the execution-engine decision is what stops two engines acting on one run.

## When to graduate to an external queue

An external broker (Redis/RQ, a Postgres `SKIP LOCKED` table, NATS, or a durable-execution
platform) adds a service to deploy, back up and secure. It is worth that cost when one of
these counts is met. Each is something an operator can measure:

1. **Lost work hurts.** Over a calendar month, more than **1 %** of submitted tasks end as
   `404`/`engine_shutdown` and are resubmitted, *or* any single resubmission repeats more
   than **10 minutes** of work. Restarts are then costing more than a broker would.
2. **Volume.** The queue's waiting count exceeds **500** (half its bound) at p95 over a day,
   or a task waits more than **30 s** for a worker at p95. One process is the bottleneck
   and work has to be spread across replicas, which an in-process queue cannot do.
3. **More than one engine replica serves `/v0/tasks`.** Polling then lands on the wrong
   replica's memory. Before that happens, either route by task id or move the records out
   of the process.
4. **Tasks that outlive a deploy.** A kind whose normal run is longer than the deploy
   interval, or that must wait on time (a schedule, a retry across hours), needs durable
   timers rather than an `asyncio.sleep`.

**What to reach for first:** a Postgres table in `ouroboros-rest`'s database, claimed with
`SELECT … FOR UPDATE SKIP LOCKED`. It adds no new service, matches where durable state
already lives, and covers triggers 1–3. Trigger 4 reopens axis 1 of the execution-engine
decision instead, whose own graduation triggers already compare Hatchet first.

## What does not change on graduation

The `/v0/tasks` contract (`tasks/contract.py`): the request, the record and its statuses.
A broker replaces `tasks/queue.py`, not the routes or their callers.
