# ouroboros-engine

> **Status:** directory reserved — the service scaffold lands in
> [#50](https://github.com/NobuData/ouroboros/issues/50) (epic
> [#6](https://github.com/NobuData/ouroboros/issues/6)). Until then this README is the
> contract the scaffold must satisfy.

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
| Tests | pytest + httpx test client |
| Container | Multi-stage `python:3.12-slim`, non-root, `HEALTHCHECK` on `/healthz` |

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

## Configuration

Development default port: **8000** (`PORT`).

| Variable | Purpose |
|---|---|
| `PORT` | HTTP listen port (unprefixed by convention — see [conventions](../docs/CONVENTIONS.md)) |
| `OURO_ENGINE_SHARED_SECRET` | Expected value of `X-Ouro-Internal-Key`; compared in constant time |
| `OURO_LOG_LEVEL` | Log verbosity, default `info` |

The shared secret must match the value `ouroboros-rest` is configured with. A mismatch
is logged by the engine and surfaced to clients by REST as a `502`, never a `401` — the
internal boundary is not something the caller can probe.

## Layout (target)

```
ouroboros-engine/
├── src/ouroboros_engine/
│   ├── api/            # versioned routers (/v0), health
│   ├── core/           # internal-key middleware, logging
│   └── settings.py     # pydantic-settings, OURO_*
├── tests/
├── pyproject.toml      # deps, ruff & pytest config
├── uv.lock
└── Dockerfile
```

## Related issues

Scaffold [#50](https://github.com/NobuData/ouroboros/issues/50) ·
internal auth [#51](https://github.com/NobuData/ouroboros/issues/51) ·
API contract [#52](https://github.com/NobuData/ouroboros/issues/52) ·
container [#53](https://github.com/NobuData/ouroboros/issues/53) ·
full epic [#6](https://github.com/NobuData/ouroboros/issues/6).

See [`../docs/CONVENTIONS.md`](../docs/CONVENTIONS.md) for the conventions every module
follows and [`../README.md`](../README.md) for the module map.
