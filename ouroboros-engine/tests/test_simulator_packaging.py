"""The production build does not contain the simulated-run driver.

AP.5's criterion is that this is *verified by an artifact test*, not stated in a comment, so
this file builds the wheel, which is exactly what the image installs (the Dockerfile's
``uv sync --no-dev --no-editable`` builds it with the same backend from the same
``pyproject.toml``), and reads what is inside it.

It also checks the two ways the driver could leak back in without anybody editing the wheel
configuration: a production module importing it, and a console script naming it.
"""

import ast
import os
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from hatchling.build import build_wheel

from ouroboros_engine import main

#: The module root: pyproject.toml, src/, the Dockerfile.
_ROOT = Path(__file__).resolve().parent.parent

#: The driver's package, as ``main`` names it.
_SIMULATOR = main.SIMULATOR_PACKAGE


@pytest.fixture(scope="module")
def wheel(tmp_path_factory: pytest.TempPathFactory) -> Iterator[zipfile.ZipFile]:
    """Build the production wheel once for this module.

    Yields:
        The wheel, open for reading.
    """
    out = tmp_path_factory.mktemp("wheel")
    previous = Path.cwd()
    os.chdir(_ROOT)  # hatchling builds the project in the working directory
    try:
        name = build_wheel(str(out))
    finally:
        os.chdir(previous)

    with zipfile.ZipFile(out / name) as archive:
        yield archive


def test_the_wheel_carries_the_engine(wheel: zipfile.ZipFile) -> None:
    names = wheel.namelist()

    assert "ouroboros_engine/main.py" in names
    assert "ouroboros_engine/control_plane/ingest.py" in names


def test_the_wheel_does_not_carry_the_driver(wheel: zipfile.ZipFile) -> None:
    leaked = [
        name
        for name in wheel.namelist()
        if name.startswith(f"{_SIMULATOR}/") or "/scenarios/" in name
    ]

    assert leaked == []
    assert (_ROOT / "src" / _SIMULATOR / "__init__.py").is_file(), (
        "the check above is only meaningful while the driver exists beside the engine"
    )


def test_no_file_in_the_wheel_names_the_driver_but_the_guarded_mount(
    wheel: zipfile.ZipFile,
) -> None:
    mentions = [
        name
        for name in wheel.namelist()
        if name.endswith(".py") and _SIMULATOR.encode() in wheel.read(name)
    ]

    assert mentions == ["ouroboros_engine/main.py"]


def test_the_wheel_installs_no_command_for_the_driver(wheel: zipfile.ZipFile) -> None:
    entry_points = next(
        name for name in wheel.namelist() if name.endswith("entry_points.txt")
    )

    assert _SIMULATOR not in wheel.read(entry_points).decode()


def test_no_production_module_imports_the_driver() -> None:
    # A static import would make the engine depend on a package the image does not have.
    # The one reference, in main, is a string handed to importlib inside a guard.
    for path in (_ROOT / "src" / "ouroboros_engine").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            else:
                continue
            assert not any(name.startswith(_SIMULATOR) for name in names), path


def test_the_image_runs_only_what_the_wheel_installed() -> None:
    # The runtime stage copies the virtual environment the build stage installed the wheel
    # into, and nothing from the source tree, so the wheel's contents are the image's.
    dockerfile = (_ROOT / "Dockerfile").read_text(encoding="utf-8")
    runtime = dockerfile.split("AS runtime", 1)[1]

    assert "RUN uv sync --locked --no-dev --no-editable" in dockerfile
    assert "COPY --from=build /app/.venv /app/.venv" in runtime
    assert "COPY src" not in runtime
