# ouroboros-engine

> **Status:** scaffolded by [#50](https://github.com/NobuData/ouroboros/issues/50);
> liveness, `/v0/status` and the internal-key guard landed with
> [#51](https://github.com/NobuData/ouroboros/issues/51); the versioned contract — the
> echo round trip and the error envelope — with
> [#52](https://github.com/NobuData/ouroboros/issues/52). The work it will eventually
> broker is [#54](https://github.com/NobuData/ouroboros/issues/54).

## Purpose

The **Python backend** — the service that executes the work `ouroboros-rest` brokers
(and, in time, the autonomous loops the product is named for).

It is **internal only**. Nothing outside the cluster reaches it: every request arrives
through `ouroboros-rest`, authenticated with a shared secret on the
`X-Ouro-Internal-Key` header. The browser never calls it directly.

That is a deployment claim, so the service enforces it itself rather than trusting it:
**every path but `/healthz` requires the key**, the comparison is constant time, and a
request without it is refused before routing — so a misrouted engine port answers a
probe and nothing else.

## Stack

| Concern | Choice |
|---|---|
| Language | Python 3.12 |
| Framework | FastAPI + uvicorn |
| Package manager | [uv](https://docs.astral.sh/uv/) (locked via `uv.lock`) |
| Config | pydantic-settings, `OURO_*` validated at import |
| API spec | **Spec-first**: [`openapi.yaml`](openapi.yaml) is authoritative and is served verbatim; [`openapi.json`](openapi.json) is rendered from it |
| Lint & format | ruff |
| Tests | pytest + the FastAPI test client (httpx2) |
| Container | Multi-stage `python:3.12-slim`, non-root, `HEALTHCHECK` on `/healthz` — [#53](https://github.com/NobuData/ouroboros/issues/53) |

## Run

```bash
uv sync                                                # create .venv, install from uv.lock
OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me uv run dev   # :8000
uv run openapi                                         # re-render openapi.json from openapi.yaml
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

The shared secret is **mandatory** — without it the service would answer nothing but
liveness, so it refuses to start rather than serve a wall of 401s. Any value works in
development as long as `ouroboros-rest` is configured with the same one;
[`.env.example`](../.env.example) documents the placeholder used above. Exporting it
once (`export OURO_ENGINE_SHARED_SECRET=…`, or `set -a; . ../.env; set +a`) is what
makes a bare `uv run dev` — and `yarn dev` from the repo root — work.

Those three, after `uv sync --locked`, are what `ci/engine` runs on every pull request
touching this directory — see [conventions](../docs/CONVENTIONS.md#9-ci).

`yarn dev` from the repo root starts this service alongside the rest of the stack,
against a database that is already up and migrated
([conventions § 1](../docs/CONVENTIONS.md#1-repository-shape)). The
[`package.json`](package.json) beside `pyproject.toml` is what makes that possible and
is nothing more: three scripts, each one line, each delegating to the `uv run` command
above. **`pyproject.toml` is this module's manifest** — the dependencies, the version and
the tool configuration are there, and the adapter deliberately carries no version of its
own so there is one place to change it.

`uv run dev` reloads on a change under `src/` and binds **127.0.0.1 only**, because a
development server on every interface is reachable from whatever network the machine is
on and this service is internal by design. Production runs uvicorn against the
application directly, without the reloader, and chooses its own host:

```bash
uv run uvicorn ouroboros_engine.main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

## The HTTP surface

| Path | Key required | Answers |
|---|:---:|---|
| `GET /healthz` | no | `{"status":"ok"}` — liveness, for a container platform's probe |
| `GET /` | yes | The service name and its installed version |
| `GET /v0/status` | yes | Version and uptime — what `ouroboros-rest`'s readiness probe reads |
| `POST /v0/tasks/echo` | yes | The contract exemplar: `{task_kind, payload}` back as `{accepted, echo, engine_version}` |
| `/openapi.json`, `/docs` | yes | The committed specification, served verbatim. A map of the internal surface is not something a misrouted port should hand out |

```console
$ curl -s localhost:8000/healthz && echo
{"status":"ok"}

$ curl -s localhost:8000/v0/status && echo
{"code":"unauthenticated","message":"Unauthorized.","details":{}}

$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" localhost:8000/v0/status && echo
{"service":"ouroboros-engine","version":"0.3.0","uptime_seconds":42.5}

$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'content-type: application/json' \
    -d '{"task_kind":"echo","payload":{"note":"hello"}}' \
    localhost:8000/v0/tasks/echo && echo
{"accepted":true,"echo":{"task_kind":"echo","payload":{"note":"hello"}},"engine_version":"0.3.0"}

$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'content-type: application/json' \
    -d '{"task_kind":"Echo","payload":{}}' \
    localhost:8000/v0/tasks/echo && echo
{"code":"validation_failed","message":"The request is not valid. See `details` for each field.","details":{"task_kind":["String should match pattern '^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$'"]}}
```

`/healthz` is deliberately shallow: it opens no connection and reads no configuration,
so it cannot fail for a reason restarting the container will not fix. *Readiness* — are
the dependencies reachable — is REST's probe
([#29](https://github.com/NobuData/ouroboros/issues/29)), which asks `/v0/status` with
the key.

Everything else is behind the guard, and a rejection is one constant body whether the
path exists or not — status codes are how a surface gets mapped from outside, so an
unauthenticated caller cannot tell `/v0/status` from `/v0/anything-else`. The rejection
is logged with the path and the method; the key that was offered never is, right or
wrong. `ouroboros-rest` never forwards that `401` to a browser: a key its own deployment
holds wrongly is its problem, so it logs the mismatch and answers `502`.

`/v0` is the versioned internal prefix, and it is unstable by definition — it changes
with the two services that share it, which deploy together. A field may be added to a
response and a route may be added to the prefix; a field that disappears, changes type or
changes meaning is a `/v1` served alongside this one, not an edit to it. The rule is
written down in [`api/v0.py`](src/ouroboros_engine/api/v0.py), which is where a router
under the prefix reads it from rather than restating it.

### Every error has one shape

`{code, message, details}` — the same envelope `ouroboros-rest` answers a browser with
([`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) § 5.3), so a failure crossing the
gateway does not change form on the way out. `code` is stable and machine-readable and is
what a caller branches on; `message` is written for a person; `details` carries what is
specific to the failure, which for a `422` is one entry per field that was refused, keyed
the way the caller wrote it.

It covers the answers no route produced, too — a path nothing claims, a method a path does
not allow, a body that could not be parsed, an exception nobody expected — so the gateway
parses one shape rather than one per layer. Two rules hold for what it may say:
**anything `5xx` carries one constant sentence**, because the real diagnosis names the
inside of this process and belongs in a log; and **a refusal never echoes what was
refused**, which is why FastAPI's own `422` (it returns the rejected input under
`detail[].input`) is replaced rather than reshaped.

## The API specification

**[`openapi.yaml`](openapi.yaml) is the specification, and the service serves it.** This
module is spec-first: FastAPI does not derive a document from whatever routes it happens
to have — the application loads the committed file and hands it back at `/openapi.json`
unchanged. What a catalogue holds, what `/docs` renders and what the process answers with
are the same bytes, so the document can carry things no framework has a field for (the
`X-Ouro-Internal-Key` scheme, the `401` every guarded operation shares, prose written for
a reader) and cannot be rewritten by a docstring nobody meant as a contract.

Two files, one document, both committed at this directory's root — the paths to hand a
catalogue, a linter or a diff tool:

| File | What it is |
|---|---|
| [`openapi.yaml`](openapi.yaml) | **Authoritative.** The one to edit — comments, block text, no escaping |
| [`openapi.json`](openapi.json) | Rendered from it by `uv run openapi`. What the process loads, and what a JSON-only tool wants |

```bash
uv run openapi           # re-render openapi.json from the YAML
uv run openapi --check   # report drift without writing; exits non-zero
```

The JSON is committed rather than built on demand because the container serves it: both
files are packaged beside the module, so an image carries the document it answers with.
Reading the JSON at runtime is also why the served process needs no YAML parser — PyYAML
is a development dependency, used by the renderer and the tests and by nothing that
handles a request.

Being spec-first costs the one thing a generated document gave away free: the guarantee
that it describes the routes that actually exist. `uv run pytest` is that guarantee, and
`ci/engine` runs it on every pull request. It fails when

- the two files have drifted apart, or `openapi.json` was hand-edited;
- `info.version` is not the version `pyproject.toml` declares;
- the application serves a path or method the document does not describe — **or the
  document promises one the application does not serve**;
- a response model gained or lost a field the schema does not have;
- `/healthz` is not exactly the set of operations exempt from the key, which is the same
  claim `_PUBLIC_PATHS` in `main.py` makes;
- a documented example is not a body the service could actually send;
- the document is not valid OpenAPI 3.1.

So adding a route is now two edits — the router module and `openapi.yaml` — and forgetting
the second one is a red pipeline rather than a specification that quietly lies.

## Configuration

Development default port: **8000** (`PORT`).

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP listen port (unprefixed by convention — see [conventions](../docs/CONVENTIONS.md)) | `8000` |
| `OURO_ENGINE_SHARED_SECRET` | Expected value of `X-Ouro-Internal-Key`; compared in constant time | **required** |
| `OURO_LOG_LEVEL` | Log verbosity — `debug`, `info`, `warning` or `error` | `info` |

Values are read from the **process environment only**; there is no dotenv loading, so
what a container is started with is exactly what the service runs with. Every variable
is documented with its development default in the repo-root
[`.env.example`](../.env.example).

Configuration is validated while the application is being built, which happens at import
of `ouroboros_engine.main` — so a bad value stops the process before it binds a port,
and names the variable rather than raising on the first request:

```console
$ OURO_LOG_LEVEL=chatty uv run dev
ouroboros-engine: invalid configuration (1 problem)
  OURO_LOG_LEVEL: Input should be 'debug', 'info', 'warning' or 'error'
$ echo $?
2
```

Values are never echoed back in that report — one of these variables is a secret.

`OURO_ENGINE_SHARED_SECRET` has no default and no fallback:

```console
$ uv run dev
ouroboros-engine: invalid configuration (1 problem)
  OURO_ENGINE_SHARED_SECRET: Field required
$ echo $?
2
```

It must match the value `ouroboros-rest` is configured with. A mismatch is logged by the
engine and surfaced to clients by REST as a `502`, never a `401` — the internal boundary
is not something the caller can probe.

## Logging

One JSON object per line, at `OURO_LOG_LEVEL`, on stderr. uvicorn's own records go
through the same formatter, so a served process emits one format rather than two:

```json
{"timestamp": "2026-08-10T23:54:26.158925+00:00", "level": "WARNING", "logger": "ouroboros_engine.core.security", "message": "rejected an internal request without a valid key", "path": "/v0/status", "method": "GET", "key_present": false}
```

Whatever a call site passes as `extra` becomes a top-level key, so an event is
filterable by `path` rather than by substring. Nothing is logged that was not passed
explicitly — no environment, no headers, no bodies — because this process holds a
credential and a logger that helpfully dumps context is how one reaches a log index.

## Layout

```
ouroboros-engine/
├── src/ouroboros_engine/
│   ├── api/            # one module per router
│   │   ├── health.py   #   GET /healthz — the one public path
│   │   ├── root.py     #   GET /
│   │   ├── status.py   #   GET /v0/status
│   │   ├── tasks.py    #   POST /v0/tasks/echo — the contract exemplar
│   │   └── v0.py       #   the versioned prefix and the rule that governs it
│   ├── core/           # process-wide concerns, not routes
│   │   ├── errors.py   #   the {code, message, details} envelope, for every failure
│   │   ├── logging.py  #   JSON records at OURO_LOG_LEVEL
│   │   ├── security.py #   the internal-key guard
│   │   └── uptime.py   #   the stopwatch /v0/status reports from
│   ├── dev.py          # `uv run dev` entry point; not imported by the application
│   ├── main.py         # create_app() and the `app` uvicorn serves
│   ├── openapi.py      # loads the committed spec; `uv run openapi` renders the JSON
│   └── settings.py     # pydantic-settings, OURO_*
├── tests/              # pytest; conftest.py isolates the environment
├── openapi.yaml        # the API specification — authoritative, hand-written
├── openapi.json        # rendered from it; the copy the service loads
├── pyproject.toml      # deps, task names, ruff & pytest config
└── uv.lock             # committed; CI installs with --locked
```

`create_app()` builds an application from settings handed to it, or from the environment
when they are omitted, and puts them on `app.state.settings` — so a router or a
middleware reads configuration from the application rather than re-reading the
environment. `app` at module scope is what `ouroboros_engine.main:app` resolves to for
uvicorn, in development and in the container.

Adding a router is a module under `api/`, one `include_router` line in `create_app`, and
the operation written into `openapi.yaml` — the suite fails on a route that is served but
not described, so the third step is not one anyone has to remember.
**A route added that way is guarded by default**: the key check is middleware, installed
before any router, so a new path requires the key without anything being remembered.
Exempting one is an edit to `_PUBLIC_PATHS` in `main.py`, which is deliberately the only
place a public path can be declared — and a test asserts liveness is still the only
entry in it.
There is no `Dockerfile` or `.dockerignore` yet; both land with
[#53](https://github.com/NobuData/ouroboros/issues/53).

## Related issues

Scaffold [#50](https://github.com/NobuData/ouroboros/issues/50) ·
internal auth [#51](https://github.com/NobuData/ouroboros/issues/51) ·
API contract [#52](https://github.com/NobuData/ouroboros/issues/52) ·
container [#53](https://github.com/NobuData/ouroboros/issues/53) ·
task execution [#54](https://github.com/NobuData/ouroboros/issues/54) ·
the gateway that calls it [#35](https://github.com/NobuData/ouroboros/issues/35) ·
full epic [#6](https://github.com/NobuData/ouroboros/issues/6).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
