# ouroboros-engine

> **Status:** scaffolded by [#50](https://github.com/NobuData/ouroboros/issues/50) — the
> service builds, serves and is tested. Liveness and the internal-key middleware are
> [#51](https://github.com/NobuData/ouroboros/issues/51); the `/v0` contract is
> [#52](https://github.com/NobuData/ouroboros/issues/52).

## Purpose

The **Python backend** — the service that executes the work `ouroboros-rest` brokers
(and, in time, the autonomous loops the product is named for).

It is **internal only**. Nothing outside the cluster reaches it: every request arrives
through `ouroboros-rest`, authenticated with a shared secret on the
`X-Ouro-Internal-Key` header. The browser never calls it directly.

## Stack

| Concern | Choice |
|---|---|
| Language | Python 3.12 |
| Framework | FastAPI + uvicorn |
| Package manager | [uv](https://docs.astral.sh/uv/) (locked via `uv.lock`) |
| Config | pydantic-settings, `OURO_*` validated at import |
| Lint & format | ruff |
| Tests | pytest + the FastAPI test client (httpx2) |
| Container | Multi-stage `python:3.12-slim`, non-root, `HEALTHCHECK` on `/healthz` — [#53](https://github.com/NobuData/ouroboros/issues/53) |

## Run

```bash
uv sync                 # create .venv and install from uv.lock
uv run dev              # http://localhost:8000
uv run ruff check .
uv run ruff format --check .
uv run pytest
```

Those three, after `uv sync --locked`, are what `ci/engine` runs on every pull request
touching this directory — see [conventions](../docs/CONVENTIONS.md#9-ci).

`uv run dev` reloads on a change under `src/` and binds **127.0.0.1 only**, because a
development server on every interface is reachable from whatever network the machine is
on and this service is internal by design. Production runs uvicorn against the
application directly, without the reloader, and chooses its own host:

```bash
uv run uvicorn ouroboros_engine.main:app --host 0.0.0.0 --port "${PORT:-8000}"
```

What answers today is `GET /`, which names the service and its version — enough to
confirm the process is up and which build it is:

```bash
curl -s localhost:8000 && echo
# {"service":"ouroboros-engine","version":"0.1.0"}
```

The generated OpenAPI document is at `/openapi.json`, with the interactive form at
`/docs`. Neither is the contract `ouroboros-rest` codes against — that is the versioned
one under `/v0` ([#52](https://github.com/NobuData/ouroboros/issues/52)).

## Configuration

Development default port: **8000** (`PORT`).

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP listen port (unprefixed by convention — see [conventions](../docs/CONVENTIONS.md)) | `8000` |
| `OURO_ENGINE_SHARED_SECRET` | Expected value of `X-Ouro-Internal-Key`; compared in constant time | unset |
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

`OURO_ENGINE_SHARED_SECRET` is read but not yet enforced: no route requires the key
until [#51](https://github.com/NobuData/ouroboros/issues/51) adds the middleware. It must
match the value `ouroboros-rest` is configured with. A mismatch is logged by the engine
and surfaced to clients by REST as a `502`, never a `401` — the internal boundary is not
something the caller can probe.

## Layout

```
ouroboros-engine/
├── src/ouroboros_engine/
│   ├── api/            # one module per router — root.py; health #51, /v0 #52
│   ├── core/           # process-wide concerns — logging.py; internal-key middleware #51
│   ├── dev.py          # `uv run dev` entry point; not imported by the application
│   ├── main.py         # create_app() and the `app` uvicorn serves
│   └── settings.py     # pydantic-settings, OURO_*
├── tests/              # pytest; conftest.py isolates the environment
├── pyproject.toml      # deps, task names, ruff & pytest config
└── uv.lock             # committed; CI installs with --locked
```

`create_app()` builds an application from settings handed to it, or from the environment
when they are omitted, and puts them on `app.state.settings` — so a router or a
middleware reads configuration from the application rather than re-reading the
environment. `app` at module scope is what `ouroboros_engine.main:app` resolves to for
uvicorn, in development and in the container.

Adding a router is a module under `api/` and one `include_router` line in `create_app`.
There is no `Dockerfile` or `.dockerignore` yet; both land with
[#53](https://github.com/NobuData/ouroboros/issues/53).

## Related issues

Scaffold [#50](https://github.com/NobuData/ouroboros/issues/50) ·
internal auth [#51](https://github.com/NobuData/ouroboros/issues/51) ·
API contract [#52](https://github.com/NobuData/ouroboros/issues/52) ·
container [#53](https://github.com/NobuData/ouroboros/issues/53) ·
full epic [#6](https://github.com/NobuData/ouroboros/issues/6).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
