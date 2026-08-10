"""The manifest and the installed package agree, and the documented verbs resolve."""

import importlib
import tomllib
from pathlib import Path

import ouroboros_engine

#: The manifest, read from the module root rather than the working directory so the
#: suite passes wherever pytest is started from.
_PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


def _manifest() -> dict:
    """Parse ``pyproject.toml``.

    Returns:
        The manifest as nested dictionaries.
    """
    return tomllib.loads(_PYPROJECT.read_text(encoding="utf-8"))


def test_the_installed_version_is_the_one_the_manifest_declares() -> None:
    assert ouroboros_engine.__version__ == _manifest()["project"]["version"], (
        "the version is written once, in pyproject.toml, and read from metadata"
    )


def test_the_python_pin_matches_the_toolchain_the_repo_documents() -> None:
    # docs/CONVENTIONS.md § 3 and the PYTHON_VERSION in .github/workflows/engine.yml.
    assert _manifest()["project"]["requires-python"] == ">=3.12,<3.13"


def test_the_dev_verb_resolves_to_something_callable() -> None:
    # `uv run dev` is the dev task name every module exposes (docs/CONVENTIONS.md § 3);
    # this asserts the console script in pyproject.toml still points at code.
    target = _manifest()["project"]["scripts"]["dev"]
    module_name, _, attribute = target.partition(":")

    entry_point = getattr(importlib.import_module(module_name), attribute)

    assert callable(entry_point)


def test_ruff_agrees_with_the_editorconfig_line_length() -> None:
    # .editorconfig is authoritative for width (docs/CONVENTIONS.md § 6); the formatter
    # has to agree with it rather than override it.
    assert _manifest()["tool"]["ruff"]["line-length"] == 88


def test_warnings_are_failures() -> None:
    assert _manifest()["tool"]["pytest"]["ini_options"]["filterwarnings"] == [
        "error"
    ], "a deprecation is the earliest warning that an upgrade will break this module"
