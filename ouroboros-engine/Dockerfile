# ouroboros-engine — production image (issue #53)
#
# Multi-stage per ../docs/CONVENTIONS.md § 5, following the shape ouroboros-ui and
# ouroboros-rest proved: deps -> build -> a runtime that carries no toolchain, runs as a
# non-root user, and answers a HEALTHCHECK on this service's own liveness probe.
#
# **The build context is this directory, not the repository root** — the same as
# ouroboros-db and unlike the two Yarn workspaces. Nothing here installs through the root
# lockfile: package.json beside pyproject.toml is a workspace adapter over a uv project,
# and every file this image reads is committed in this module. § 5 says so of this module
# by name, which is also why the ignore file beside this one is a plain `.dockerignore`
# rather than a `Dockerfile.dockerignore` — with the context set here, that is the file
# BuildKit reads.
#
#   docker build -t ouroboros-engine ouroboros-engine        # from the repo root
#
#   docker run --rm -p 8000:8000 \
#     -e OURO_ENGINE_SHARED_SECRET=dev-engine-shared-secret-change-me \
#     ouroboros-engine
#
# python:3.12-slim is the base for every stage, matching the `requires-python =
# ">=3.12,<3.13"` in pyproject.toml and the PYTHON_VERSION in ../.github/workflows/
# engine.yml. It has to be the *same* image in all three: the virtual environment the
# build produces holds absolute shebangs and a symlink to the interpreter that created
# it, so a runtime on a different base is a venv pointing at a Python that is not there.
#
# The artefact those stages hand along is one directory — /app/.venv, holding the locked
# dependencies and this project installed into it as a **copy**. Installing rather than
# copying src/ is what makes the image behave the way the code documents:
#
# * `ouroboros_engine.__version__` reads installed distribution metadata, and says so by
#   refusing to import at all when there is none (src/ouroboros_engine/__init__.py).
# * `openapi.json` is force-included beside the package by the wheel build, which is the
#   first path `ouroboros_engine.openapi.locate` tries — so the container serves the
#   committed document rather than looking for a checkout that is not in the image.
# * `settings._ENV_FILES` is empty for a non-editable install, by construction: there is
#   no `src` directory above the package to find a `.env` beside. A container is
#   configured by the environment it was started with and by nothing else, and that is
#   true here because of what was installed rather than because the ignore file kept an
#   `.env` out — though it does that too.

# ---------- deps ----------
# The third-party dependencies, and nothing of this project. Splitting the install in two
# is what makes the expensive half cacheable: this layer is keyed on pyproject.toml and
# uv.lock alone, so editing a route re-runs the build stage below and not this one.
#
# uv is copied from its own published image at a pinned version rather than installed
# with pip: it is a static binary, it lands in one layer, and pinning it here is what
# keeps two builds a month apart resolving the lockfile with the same resolver. It stays
# in this stage and the next; the runtime has no package manager at all.
FROM python:3.12-slim AS deps

COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv

# UV_COMPILE_BYTECODE writes the .pyc files at build time, which is what lets the runtime
# stage own its site-packages as root and still start quickly — nothing has to compile on
# first import into a directory the service cannot write to.
#
# UV_LINK_MODE=copy because the cache and the target are different layers, where uv's
# default hardlink is not available and would otherwise warn on every install.
#
# UV_PYTHON_DOWNLOADS=never keeps the interpreter the base image pins as the only one in
# play: without it, a lockfile asking for a Python this image does not have is answered by
# silently fetching another one, and the image ships two.
#
# UV_PROJECT_ENVIRONMENT names the venv both stages build into. It is an absolute path
# outside the working directory on purpose, so the source tree the build stage copies in
# cannot land on top of it.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /src
COPY pyproject.toml uv.lock ./

# --locked is the uv equivalent of `yarn install --immutable`, and it is the same guard
# ci/engine runs with: a uv.lock that has drifted from pyproject.toml fails the build
# rather than being silently refreshed into an image whose dependencies are not the ones
# the repository committed.
#
# --no-dev leaves pytest, ruff, PyYAML and the OpenAPI validator out of the tree that is
# carried forward. --no-install-project is what confines this layer to dependencies; the
# project itself is installed one stage down, where its sources are.
RUN uv sync --locked --no-dev --no-install-project

# ---------- build ----------
# The same sync, with the sources present and --no-install-project dropped: uv finds the
# dependency half already satisfied in the venv copied from `deps` and adds just this
# project to it.
#
# --no-editable is the load-bearing flag. A plain `uv sync` installs the project as a link
# back to src/, which in an image would be a runtime whose package resolves through a
# directory the runtime stage does not copy; with it, hatchling builds the wheel this
# module's packaging is already tested against (tests/test_packaging.py) and the venv gets
# a real copy, with the metadata and the force-included specification beside it.
FROM python:3.12-slim AS build

COPY --from=ghcr.io/astral-sh/uv:0.11.8 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /src
COPY --from=deps /app/.venv /app/.venv

# Every file the wheel build reads, and no more. README.md is here because pyproject.toml
# declares it as the project's readme and hatchling fails without it; the two openapi
# files because they are force-included into the package and the service cannot answer
# /openapi.json without them. tests/ is deliberately absent — it is excluded from the
# build context, and a test suite is not something a production image should carry.
COPY pyproject.toml uv.lock README.md openapi.yaml openapi.json ./
COPY src ./src

RUN uv sync --locked --no-dev --no-editable

# ---------- runtime ----------
FROM python:3.12-slim AS runtime

# PATH puts the venv first, which is the whole of "activating" it for a non-interactive
# process: `uvicorn` and `python` below are the venv's own.
#
# PYTHONUNBUFFERED because the logs are the product here — src/ouroboros_engine/core/
# logging.py writes one JSON record per line to stdout, and a block-buffered stdout turns
# that into a log that arrives minutes late, or not at all if the container is killed.
#
# PYTHONDONTWRITEBYTECODE because everything importable was compiled at build time and
# site-packages is root-owned: there is nothing left to write, and this makes an attempt
# to a no-op rather than a permission error inside a stack trace.
#
# PORT is the documented unprefixed exception (../docs/CONVENTIONS.md § 4) and 8000 is
# this module's port in the map there. It is restated rather than introduced — it is
# already the default in settings.py — because both the command and the healthcheck below
# expand it, and an unset variable expands to nothing at all.
#
# No OURO_* variable is set anywhere in this image, and one in particular must never be:
# OURO_ENGINE_SHARED_SECRET is the key every route but liveness is checked against. A
# default in a layer is a published image carrying the credential that unlocks it. The
# service names the missing variable at boot and exits instead (settings.py), which is the
# behaviour a baked default would replace.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Debian's tools rather than Alpine's, this not being an Alpine base. --system keeps the
# account out of the login range, and --no-create-home is honest: this process writes
# nothing, so a home directory would only be somewhere for it to try.
RUN groupadd --system engine \
    && useradd --system --gid engine --no-create-home engine

WORKDIR /app

# Copied as root and *not* chowned to the user that runs it. The engine writes nothing —
# no cache, no bytecode, no upload directory — so the service having no permission to
# rewrite its own dependencies costs nothing and removes the most useful thing an attacker
# who reaches this process could do with the filesystem.
COPY --from=build /app/.venv /app/.venv

USER engine
EXPOSE 8000

# Liveness, and only liveness. /healthz is the one path the internal-key guard lets
# through (src/ouroboros_engine/api/health.py), which is what makes it answerable by a
# probe that holds no secret — and it is shallow on purpose: it opens no connection and
# calls nothing downstream, so it cannot report a dependency's problem as a reason to
# restart this process. Readiness is asked elsewhere, over /v0/status, with the key.
#
# The check is the interpreter that is already in the image rather than curl or wget,
# neither of which python:3.12-slim carries. Installing one would mean an apt layer, a
# package list to keep current and a second network client in an image whose only job is
# to speak HTTP through the one it already has. The empty ProxyHandler is what keeps a
# proxy variable in the environment from sending a loopback request out to a proxy.
#
# Shell form, which is what expands $PORT — so the check follows the port the container
# was actually given rather than the one baked above.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import os,urllib.request as u;u.build_opener(u.ProxyHandler({})).open('http://127.0.0.1:'+os.environ['PORT']+'/healthz',timeout=3)" || exit 1

# uvicorn directly, not `uv run dev`: no reloader, no file watching, and the host is
# 0.0.0.0 rather than the loopback the development entry point binds — a process bound to
# loopback inside a container is a process nothing outside it can reach. src/ouroboros_
# engine/dev.py documents the same split from the other side.
#
# A shell is named explicitly, and `exec` put in front of the server, because $PORT has
# to be expanded by something and uvicorn's own argument list will not do it. The exec is
# what makes uvicorn PID 1 rather than a child of /bin/sh: the SIGTERM a `docker stop` or
# a scheduler sends reaches the server, which shuts down in a fraction of a second instead
# of being killed ten seconds later by a shell that does not forward signals.
#
# Written as JSON rather than as the bare shell form that would produce exactly this —
# BuildKit warns on the latter, on the grounds that it is usually how signal handling is
# lost, and a build that warns every time teaches its reader to ignore warnings.
CMD ["/bin/sh", "-c", "exec uvicorn ouroboros_engine.main:app --host 0.0.0.0 --port \"${PORT}\""]
