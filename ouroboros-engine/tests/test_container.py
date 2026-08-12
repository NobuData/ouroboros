"""The production image (#53), asserted from the files that define it.

A ``docker build`` is not something ``ci/engine`` can run — it needs a daemon, a network
and minutes that job does not have — so what is checked here is every property of the
image that is decided *in this repository*: the stages, the base image, the locked
install, the non-root user, the venv the runtime is made of, the healthcheck, the entry
point and the build context. Each is a way the image can be broken by an edit that no
other test in this module would notice.

The properties that genuinely need a daemon — that it builds, that the container reports
healthy, and that it is inside the 250 MB budget — were verified against the built image
and are recorded in ``README.md`` § Container; the compose stack re-verifies the middle
one on every ``up`` once #55 adds this service to it.

Several assertions read their expected value out of the application or the manifest
rather than restating it: the healthcheck's path comes from
:mod:`ouroboros_engine.api.health`, the port from
:class:`ouroboros_engine.settings.Settings`, and the files the build stage has to copy
from ``pyproject.toml``'s own packaging table. A probe that moves, a port that changes or
a newly force-included file then fails *here*, which is the only place those could
otherwise drift apart from the image unnoticed.
"""

import re
import tomllib
from pathlib import Path

from ouroboros_engine.api.health import HEALTH_PATH
from ouroboros_engine.api.v0 import V0_PREFIX
from ouroboros_engine.settings import Settings

#: This module's directory — the build context, and where the two files under test live.
_MODULE_DIR = Path(__file__).resolve().parent.parent

_DOCKERFILE = (_MODULE_DIR / "Dockerfile").read_text(encoding="utf-8")
_DOCKERIGNORE = (_MODULE_DIR / ".dockerignore").read_text(encoding="utf-8")

#: The base image every stage is built on, pinned to the minor Python this module
#: requires. Slim rather than alpine: the wheels this project installs are manylinux
#: builds, and musl would mean compiling uvloop and httptools from source.
BASE_IMAGE = "python:3.12-slim"

#: The ``deps`` → ``build`` → ``runtime`` split docs/CONVENTIONS.md § 5 requires.
STAGE_NAMES = ("deps", "build", "runtime")

#: The one path the venv exists at, in every stage and in the runtime's ``PATH``. uv
#: writes absolute shebangs into it, so this is a value three instructions have to agree
#: on rather than a detail of any one of them.
VENV = "/app/.venv"

#: The account the service runs as.
USER = "engine"

#: The Dockerfile's instructions, with its commentary removed.
#:
#: Everything below is asserted against this rather than against the raw file, and the
#: distinction is not cosmetic: this Dockerfile explains at length *why* it does what it
#: does, so its prose quotes the very instructions under test. Matching the raw text
#: would let a comment satisfy an assertion about an instruction that had been deleted.
_INSTRUCTIONS = "\n".join(
    line for line in _DOCKERFILE.splitlines() if not line.lstrip().startswith("#")
)


def _stages() -> dict[str, str]:
    """Split the instructions at their ``FROM`` lines, one entry per stage.

    Returns:
        Stage name mapped to the instructions that follow it, in file order.
    """
    found: dict[str, str] = {}
    current: str | None = None
    for line in _INSTRUCTIONS.splitlines():
        named = re.match(r"^FROM\s+\S+\s+AS\s+(\S+)\s*$", line)
        if named:
            current = named[1]
            found[current] = ""
            continue
        if current is not None:
            found[current] += f"{line}\n"
    return found


_STAGES = _stages()


def stage(name: str) -> str:
    """The instructions of one stage.

    Args:
        name: Stage to read — one of :data:`STAGE_NAMES`.

    Returns:
        Everything between that stage's ``FROM`` and the next one. Empty when the stage
        is absent, which the first test in this file reports as a missing stage rather
        than as a cascade of unrelated failures.
    """
    return _STAGES.get(name, "")


def manifest() -> dict:
    """Parse ``pyproject.toml``.

    Returns:
        The manifest as nested dictionaries.
    """
    return tomllib.loads((_MODULE_DIR / "pyproject.toml").read_text(encoding="utf-8"))


def admitted() -> set[str]:
    """The paths ``.dockerignore`` lets into the build context.

    Returns:
        Each ``!path`` entry, without the ``!`` and without a trailing slash, so a
        directory written either way compares equal.
    """
    return {
        line[1:].rstrip("/")
        for line in _DOCKERIGNORE.splitlines()
        if line.startswith("!")
    }


def copied(instructions: str = _INSTRUCTIONS) -> set[str]:
    """The context paths the build reads, taken from the ``COPY`` instructions.

    Args:
        instructions: What to read them from — the whole Dockerfile by default, or one
            stage when the question is which stage reads what.

    Returns:
        Every source path copied from the context — that is, ignoring the ``--from=``
        copies, which take their sources from another stage or image rather than from
        the context this module's ``.dockerignore`` governs. Trailing slashes are
        stripped so ``src/`` and ``src`` compare equal.
    """
    sources: set[str] = set()
    for line in instructions.splitlines():
        copy = re.match(r"^COPY\s+(?!--from=)(.+)$", line)
        if not copy:
            continue
        # The last argument is the destination; everything before it is a source.
        arguments = copy[1].split()
        sources.update(path.rstrip("/") for path in arguments[:-1])
    return sources


# ---------------------------------------------------------------------------
# The Dockerfile
# ---------------------------------------------------------------------------


def test_it_has_the_three_stages_the_conventions_require() -> None:
    assert tuple(_STAGES) == STAGE_NAMES, (
        "deps -> build -> runtime, so the runtime carries no toolchain "
        "(docs/CONVENTIONS.md § 5)"
    )


def test_every_stage_is_built_on_the_same_pinned_base_image() -> None:
    # The same image in all three is a requirement rather than tidiness: the venv the
    # build produces holds absolute shebangs and a symlink to the interpreter that
    # created it, so a runtime on another base is a venv pointing at a Python that is
    # not there.
    bases = re.findall(r"^FROM\s+(\S+)", _INSTRUCTIONS, re.MULTILINE)

    assert len(bases) == len(STAGE_NAMES)
    assert set(bases) == {BASE_IMAGE}


def test_the_base_image_is_the_python_the_manifest_requires() -> None:
    # `requires-python = ">=3.12,<3.13"` and `python:3.12-slim` are two statements of one
    # decision; this is where they are held together.
    pin = re.match(r"^python:(\d+\.\d+)-slim$", BASE_IMAGE)

    assert pin is not None
    assert manifest()["project"]["requires-python"] == f">={pin[1]},<3.13"


def test_uv_is_pinned_to_an_exact_version_wherever_it_is_used() -> None:
    # uv resolves the lockfile, so an unpinned `latest` is two builds a month apart
    # potentially installing different trees out of the same uv.lock.
    versions = re.findall(
        r"^COPY --from=ghcr\.io/astral-sh/uv:(\S+)\s", _INSTRUCTIONS, re.MULTILINE
    )

    assert versions, "the Dockerfile no longer copies uv from its published image"
    assert len(set(versions)) == 1, "one uv version, not one per stage"
    assert re.fullmatch(r"\d+\.\d+\.\d+", versions[0]), (
        "an exact version — a floating tag makes the resolver a moving part"
    )


def test_the_dependencies_are_installed_from_the_committed_lockfile() -> None:
    # --locked is the uv equivalent of `yarn install --immutable`, and the same flag
    # ci/engine installs with: a uv.lock that has drifted from pyproject.toml fails the
    # build rather than being silently refreshed into the image.
    for name in ("deps", "build"):
        assert re.search(r"uv sync --locked\b", stage(name)), (
            f"the {name} stage installs without --locked"
        )


def test_the_deps_stage_installs_the_dependencies_and_not_the_project() -> None:
    # What makes the expensive half cacheable: this layer is keyed on the manifest and
    # the lockfile alone, so editing a route does not re-resolve the dependency tree.
    deps = stage("deps")

    assert "--no-install-project" in deps
    assert "src" not in copied(deps), (
        "the deps stage must not see the sources, or its layer is keyed on them"
    )


def test_the_build_stage_installs_the_project_as_a_copy() -> None:
    # --no-editable is load-bearing. A plain `uv sync` links the project back to src/,
    # which the runtime stage does not copy — and an editable install also leaves
    # settings._ENV_FILES pointing at a checkout, which is how a container acquires
    # configuration from a file instead of from its environment.
    assert "--no-editable" in stage("build")


def test_no_development_dependency_reaches_the_image() -> None:
    # pytest, ruff, PyYAML and the spec validator are what --no-dev leaves behind. The
    # runtime stage copies the venv these two produced, so it carries exactly what they
    # installed.
    for name in ("deps", "build"):
        assert "--no-dev" in stage(name), f"the {name} stage installs its dev group"


def test_the_build_reads_every_file_the_wheel_is_built_from() -> None:
    # Read out of the manifest rather than restated: hatchling fails without the declared
    # readme, and the service cannot answer /openapi.json without the force-included
    # specification. A file added to either table but not to the build stage is a wheel
    # that builds on a laptop and not in the image.
    project = manifest()
    required = {
        project["project"]["readme"],
        "pyproject.toml",
        "uv.lock",
        "src",
        *project["tool"]["hatch"]["build"]["targets"]["wheel"]["force-include"],
    }

    assert required <= copied()


def test_the_runtime_stage_carries_no_package_manager() -> None:
    # The runtime is the venv and the interpreter under it. An install here would put uv,
    # a compiler toolchain or a dev group back into the image.
    runtime = stage("runtime")

    assert "astral-sh/uv" not in runtime
    assert not re.search(r"\b(uv|pip|apt-get)\s+(sync|install|add)\b", runtime)


def test_the_runtime_takes_the_environment_from_the_build_stage() -> None:
    # The deps stage's venv is the dependencies without this project in it — an image
    # built from that one starts, fails to import ouroboros_engine, and says so only when
    # it is run.
    runtime = stage("runtime")

    assert re.search(
        rf"^COPY --from=build {re.escape(VENV)} {re.escape(VENV)}$",
        runtime,
        re.MULTILINE,
    )
    assert "--from=deps" not in runtime


def test_one_path_for_the_environment_everywhere_it_is_named() -> None:
    # uv writes absolute shebangs into the venv's scripts, so a venv copied to a
    # different path in the runtime is a set of entry points pointing at nothing.
    for name in ("deps", "build"):
        assert f"UV_PROJECT_ENVIRONMENT={VENV}" in stage(name)
    assert re.search(
        rf'^ENV PATH="{re.escape(VENV)}/bin:\$PATH"', stage("runtime"), re.MULTILINE
    )


def test_the_interpreter_is_the_one_the_base_image_pins() -> None:
    # Without this, a lockfile asking for a Python the image does not have is answered by
    # silently downloading another one, and the image ships two interpreters.
    for name in ("deps", "build"):
        assert "UV_PYTHON_DOWNLOADS=never" in stage(name)


def test_the_dependencies_are_compiled_at_build_time() -> None:
    # The runtime's site-packages is root-owned and the process is not root, so nothing
    # can be compiled on first import. Precompiling is what makes that ownership free.
    for name in ("deps", "build"):
        assert "UV_COMPILE_BYTECODE=1" in stage(name)


def test_it_runs_as_a_created_non_root_user() -> None:
    runtime = stage("runtime")

    assert re.search(rf"^RUN groupadd --system {USER}", runtime, re.MULTILINE)
    assert re.search(rf"--gid {USER} --no-create-home {USER}$", runtime, re.MULTILINE)
    assert re.search(rf"^USER {USER}$", runtime, re.MULTILINE)


def test_it_drops_root_before_the_entry_point_rather_than_after_it() -> None:
    # A USER below CMD is a USER that never takes effect for the process.
    runtime = stage("runtime")

    assert runtime.index(f"\nUSER {USER}") < runtime.index("\nCMD ")


def test_the_service_cannot_rewrite_its_own_dependencies() -> None:
    # Deliberately *not* chowned to the user that runs it. The engine writes nothing —
    # no cache, no bytecode, no uploads — so root-owned code costs the service nothing
    # and removes the most useful thing an attacker who reached this process could do.
    copies = re.findall(r"^COPY .*$", stage("runtime"), re.MULTILINE)

    assert copies
    for copy in copies:
        assert "--chown" not in copy


def test_the_logs_are_not_buffered_away() -> None:
    # One JSON record per line to stdout is this service's log (core/logging.py). Block
    # buffering turns that into a log that arrives late, or not at all if the container
    # is killed.
    assert "PYTHONUNBUFFERED=1" in stage("runtime")


def test_it_names_the_port_the_settings_default_to_and_exposes_it() -> None:
    port = Settings.model_fields["port"].default
    runtime = stage("runtime")

    assert re.search(rf"^\s+PORT={port}$", runtime, re.MULTILINE)
    assert re.search(rf"^EXPOSE {port}$", runtime, re.MULTILINE)


def test_the_healthcheck_probes_liveness_on_the_port_it_was_given() -> None:
    check = re.search(
        r"^HEALTHCHECK([\s\S]*?)^\s*CMD (.+)$", _INSTRUCTIONS, re.MULTILINE
    )

    assert check is not None
    # Flags, so a container that is slow to boot is not killed and a wedged one is.
    for flag in ("interval", "timeout", "start-period", "retries"):
        assert re.search(rf"--{flag}=\S+", check[1]), (
            f"the healthcheck sets no --{flag}"
        )
    # The path is read from the route module, so a probe that moves fails here rather
    # than as a container that reports unhealthy while the service is fine.
    assert f"'http://127.0.0.1:'+os.environ['PORT']+'{HEALTH_PATH}'" in check[2]


def test_the_healthcheck_holds_no_secret_and_needs_none() -> None:
    # Liveness is the one path the internal-key guard lets through. Pointing the check at
    # anything under /v0 would need the shared secret in the image — the credential that
    # unlocks every other route — and would restart the container on a downstream
    # dependency's problem rather than on this process's.
    check = re.search(r"^HEALTHCHECK[\s\S]*?^\s*CMD (.+)$", _INSTRUCTIONS, re.MULTILINE)

    assert check is not None
    assert V0_PREFIX not in check[1]
    assert "OURO_" not in check[1]


def test_the_healthcheck_installs_nothing_to_make_its_request() -> None:
    # python:3.12-slim carries neither curl nor wget, and the interpreter that is already
    # here speaks HTTP. Reaching for a package would mean an apt layer and a second
    # network client in an image whose only job is to answer one.
    check = re.search(r"^HEALTHCHECK[\s\S]*?^\s*CMD (.+)$", _INSTRUCTIONS, re.MULTILINE)

    assert check is not None
    assert check[1].lstrip().startswith("python -c")
    # An empty ProxyHandler, so a proxy variable in the environment cannot send a
    # loopback request out to a proxy and fail a healthy container.
    assert "ProxyHandler({})" in check[1]


def test_it_serves_with_uvicorn_on_every_interface_and_no_reloader() -> None:
    # A process bound to loopback inside a container is a process nothing outside it can
    # reach — the opposite of dev.py, which binds loopback on purpose. `exec` is what
    # makes uvicorn PID 1, so a `docker stop` is a shutdown rather than a ten-second wait
    # followed by a kill.
    command = re.search(r"^CMD (.+)$", _INSTRUCTIONS, re.MULTILINE)

    assert command is not None
    assert "exec uvicorn ouroboros_engine.main:app" in command[1]
    assert "--host 0.0.0.0" in command[1]
    assert r"--port \"${PORT}\"" in command[1]
    assert "--reload" not in command[1]
    assert "uv run" not in command[1], (
        "the dev entry point is not what a container runs"
    )


def test_it_bakes_in_no_value_of_any_variable_this_service_reads() -> None:
    # OURO_ENGINE_SHARED_SECRET is the key every route but liveness is checked against; a
    # default in a layer is a published image carrying the credential that unlocks it.
    # OURO_LOG_LEVEL differs per environment. settings.py names either one when it is
    # missing and the process exits, which is the behaviour a baked default replaces.
    assigned = re.findall(
        r"^(?:ENV\s+|\s+)([A-Z][A-Z0-9_]*)=", _INSTRUCTIONS, re.MULTILINE
    )

    assert assigned
    for name in assigned:
        assert not name.startswith("OURO_")


# ---------------------------------------------------------------------------
# The build context
# ---------------------------------------------------------------------------


def test_the_context_is_governed_by_a_file_named_for_the_directory() -> None:
    # This image builds from this directory, not from the repository root, so BuildKit
    # reads <context>/.dockerignore. A Dockerfile.dockerignore — which is what the two
    # Yarn workspaces need — would be read by nothing here while looking exactly like the
    # file that governs the build.
    assert not (_MODULE_DIR / "Dockerfile.dockerignore").exists()
    assert _DOCKERIGNORE.strip()


def test_the_context_starts_from_an_allow_list() -> None:
    # A deny-list has to be extended every time something is added to this directory, and
    # the first thing it would let through is .env — a real shared secret, in a layer.
    first = next(
        line
        for line in _DOCKERIGNORE.splitlines()
        if line.strip() and not line.startswith("#")
    )

    assert first == "*"


def test_the_context_admits_every_path_the_build_copies() -> None:
    # The drift guard that matters most: a COPY of a path the ignore file does not admit
    # is a build that fails, and the Dockerfile cannot give itself that reminder.
    assert copied() <= admitted()


def test_the_context_admits_nothing_the_build_does_not_read() -> None:
    # The other direction. An admitted path that is never copied is a file in the context
    # for no reason — and the reasons it usually gets there are `.env` and `tests/`.
    assert admitted() <= copied()


def test_the_context_excludes_what_must_never_reach_a_layer() -> None:
    # Named rather than left to the `*`, because these are the ones it would cost
    # something to admit: two hold a real generated secret, .venv is resolved for the
    # host, and tests/ belongs to CI.
    for path in (".env", ".env.example", ".venv", "tests"):
        assert path not in admitted()
