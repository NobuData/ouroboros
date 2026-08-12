# ouroboros-engine

> **Status:** scaffolded by [#50](https://github.com/NobuData/ouroboros/issues/50);
> liveness, `/v0/status` and the internal-key guard landed with
> [#51](https://github.com/NobuData/ouroboros/issues/51); the versioned contract — the
> echo round trip and the error envelope — with
> [#52](https://github.com/NobuData/ouroboros/issues/52). It ships as a container since
> [#53](https://github.com/NobuData/ouroboros/issues/53). The work it will eventually
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
[`.env.example`](../.env.example) documents the placeholder used above. Putting it in an
`.env` once — `cp .env.example .env`, then edit — is what makes a bare `uv run dev` and
`yarn dev` from the repo root work, with nothing exported.

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

That is the command the image runs, minus the `uv` — see [Container](#container).

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
{"service":"ouroboros-engine","version":"0.4.0","uptime_seconds":42.5}

$ curl -s -H "X-Ouro-Internal-Key: $OURO_ENGINE_SHARED_SECRET" \
    -H 'content-type: application/json' \
    -d '{"task_kind":"echo","payload":{"note":"hello"}}' \
    localhost:8000/v0/tasks/echo && echo
{"accepted":true,"echo":{"task_kind":"echo","payload":{"note":"hello"}},"engine_version":"0.4.0"}

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

Values come from the **process environment layered over `.env` files** — the repo-root
one, then this module's, then the real environment, later winning
([conventions § 4](../docs/CONVENTIONS.md#4-configuration--environment-variables)). Every
variable is documented with its development default in the repo-root
[`.env.example`](../.env.example), and those three — and only those three — again in
[`.env.example`](.env.example) here, for copying:

```bash
cp .env.example .env
uv run dev                   # the copy is read directly; nothing to export
```

The repo-root template stays the complete list and this one is a subset of it; the values
in the two are identical. `yarn dev` from the repo root reads the same files, so a
checkout with either `.env` in place needs nothing exported.

The process environment winning last is what keeps this honest in a container: what it is
started with is exactly what it runs with, regardless of any file in its image. It is
also how one run is overridden without editing anything:

```bash
OURO_LOG_LEVEL=debug uv run dev
```

The files are read by [`settings.py`](src/ouroboros_engine/settings.py), not by turbo —
`turbo.json`'s `globalDependencies` only puts `.env` in the task hash, and `globalEnv`
only decides which variables survive its strict environment filter. Neither loads a file.

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

## Container

[`Dockerfile`](Dockerfile) is the production image
([#53](https://github.com/NobuData/ouroboros/issues/53)) — `deps` → `build` → a runtime
that carries no toolchain, per [conventions § 5](../docs/CONVENTIONS.md#5-containers).
**Build it from this directory**, unlike the two Yarn workspaces:

```bash
docker build -t ouroboros-engine ouroboros-engine          # from the repo root

docker run --rm -p 8000:8000 \
  -e OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me \
  ouroboros-engine
```

The context is this directory because nothing here installs through the root lockfile:
`package.json` beside `pyproject.toml` is a workspace adapter over a `uv` project, and
every file the build reads is committed in this module. So the ignore file is a plain
[`.dockerignore`](.dockerignore) — with the context set here, that is the one BuildKit
reads — and it is an **allow-list**: `*`, then the manifest, the lockfile, `src/`, the
declared readme and the two specification files. Nothing else enters the context, `.env`
and `tests/` included.

| Property | Value |
|---|---|
| Base image | `python:3.12-slim`, every stage |
| User | `engine`, created in the runtime stage; nothing runs as root |
| Port | 8000 (`PORT`), bound on `0.0.0.0` — a container bound to loopback is unreachable |
| Healthcheck | the venv's own `python` against `/healthz` every 30 s, after a 10 s grace |
| Size | 55 MB to pull, 233 MB of layers unpacked — against a 250 MB budget |
| Runtime config | every `OURO_*` variable, supplied per environment — never baked into a layer |

**What moves between stages is one directory:** `/app/.venv`, holding the locked
dependencies and this project installed into it. `deps` runs `uv sync --locked --no-dev
--no-install-project`, so the expensive half is keyed on `pyproject.toml` and `uv.lock`
alone and editing a route does not re-resolve the tree; `build` re-runs the same sync
with the sources present and `--no-editable`, which adds just this project. `--locked` is
the `yarn install --immutable` of this toolchain and the same flag `ci/engine` installs
with: a lockfile that has drifted from the manifest fails the build rather than being
refreshed into an image whose dependencies the repository never committed.

**The project is installed, not copied**, and three documented behaviours depend on it.
`__version__` reads installed distribution metadata and refuses to import without it;
`openapi.json` is force-included beside the package by the wheel build, which is the
first path [`openapi.py`](src/ouroboros_engine/openapi.py) looks in, so the container
serves the committed document rather than hunting for a checkout; and `_ENV_FILES` in
[`settings.py`](src/ouroboros_engine/settings.py) is empty for a non-editable install,
because there is no `src` directory above the package to find an `.env` beside. **A
container is configured by the environment it was started with and by nothing else** —
by construction, not only because the ignore file keeps `.env` out.

The venv is copied in as root and the process runs as `engine`, so the service cannot
rewrite its own dependencies. It never needs to: `UV_COMPILE_BYTECODE` compiles
everything at build time, and the engine writes no cache, no bytecode and no uploads.

The healthcheck is the interpreter that is already in the image — `python:3.12-slim`
carries neither `curl` nor `wget`, and installing one would mean an apt layer and a
second HTTP client in an image whose only job is to answer through the first. It probes
**liveness only**: `/healthz` is the one path the internal-key guard lets through, so the
check holds no secret, and a Docker healthcheck is read by restart policies and by
compose's `condition: service_healthy` — pointing it at anything under `/v0` would
restart a healthy container over a dependency's problem. It expands `$PORT` at run time,
so it follows the port the container was actually given.

`OURO_ENGINE_SHARED_SECRET` is set **nowhere** in the image. It is the key every route
but liveness is checked against; a default in a layer would be a published image carrying
the credential that unlocks it. Started without it, the process names the variable and
exits before binding a port, which is the behaviour a baked default would replace.

[`tests/test_container.py`](tests/test_container.py) asserts every one of these
properties that is decided in the repository, because `ci/engine` cannot run a
`docker build`. It reads the probe path from `api/health.py`, the port from
`settings.py`, and the files the build has to copy from `pyproject.toml`'s own packaging
table — so a probe that moves, a port that changes or a newly force-included file fails
*here* rather than in a container that is already running.

The compose service that runs this image is
[#55](https://github.com/NobuData/ouroboros/issues/55); until then the repo-root
[`docker-compose.yml`](../docker-compose.yml) is the data tier only.

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
├── Dockerfile          # the production image; the context is this directory
├── .dockerignore       # allow-list — only what the build reads
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
`Dockerfile` and `.dockerignore` are the production image — see [Container](#container)
above. They are read by `docker build` and by
[`tests/test_container.py`](tests/test_container.py), and by nothing else in this module.

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
