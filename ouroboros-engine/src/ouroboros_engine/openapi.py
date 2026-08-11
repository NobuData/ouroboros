"""The API specification: a file the service reads, not a document it generates.

``openapi.yaml`` at the module root is authoritative. FastAPI can derive a document from
the routes it happens to have, but that document is a description of the code rather
than a contract anyone agreed to — it changes when a docstring does, it carries the
titles pydantic invents, and it cannot say anything the framework has no field for. The
engine's specification is written by hand instead, and the application serves it verbatim
(:func:`ouroboros_engine.main.create_app`), so the document a catalogue holds and the
document the process answers ``/openapi.json`` with are the same bytes.

Two files, one document:

* ``openapi.yaml`` is what a human edits — comments, block text, no escaping.
* ``openapi.json`` is rendered from it by ``uv run openapi`` (:func:`main`). It is what
  this module loads at runtime and what a JSON-only tool wants, and it is committed
  rather than built on demand so a container ships the document it serves.

Reading JSON rather than YAML at runtime is the reason nothing here imports a YAML
parser at module scope: the served application needs the standard library and no more,
and PyYAML stays a development dependency used only by the renderer below.

Nothing keeps the two files in step by itself — ``uv run pytest`` does. It fails on a
pair that has drifted apart, on a version that disagrees with ``pyproject.toml``, and on
a path or a response field the code serves that the document does not describe
(``tests/test_openapi.py``).
"""

import argparse
import json
import sys
from copy import deepcopy
from functools import cache
from pathlib import Path

#: The authoritative document, and the rendering of it that is read at runtime.
YAML_FILENAME = "openapi.yaml"
JSON_FILENAME = "openapi.json"

#: Where either file may be found, in the order they are tried. The first is a wheel, in
#: which ``pyproject.toml`` force-includes both files beside this module so an installed
#: engine — the container — carries its own specification. The second is a source
#: checkout, where ``src/ouroboros_engine/openapi.py`` sits two directories below the
#: module root the files are committed at, and which is what an editable install (``uv
#: sync``) resolves to. Resolved from this file's own path rather than the working
#: directory, so the document is found wherever the process was started from.
_HERE = Path(__file__).resolve()
_SEARCH_PATH = (_HERE.parent, _HERE.parents[2])

#: Two-space indent and a trailing newline: the file is committed and diffed, so how it
#: is rendered is part of what has to be reproducible. ``ensure_ascii`` off keeps the em
#: dashes in the descriptions readable rather than turning them into escapes.
_JSON_INDENT = 2


class SpecificationError(RuntimeError):
    """The specification could not be found, read, or parsed.

    Raised at application build time, which happens at import of
    :mod:`ouroboros_engine.main` — so a missing or malformed document stops the process
    while it is starting rather than on the first request for it.
    """


def locate(filename: str) -> Path:
    """Find one of the specification files.

    Args:
        filename: :data:`YAML_FILENAME` or :data:`JSON_FILENAME`.

    Returns:
        The path it was found at.

    Raises:
        SpecificationError: If it is at none of the searched locations. The message
            names every path that was tried, because the answer is different for a
            checkout and for an image whose build skipped the file.
    """
    for root in _SEARCH_PATH:
        candidate = root / filename
        if candidate.is_file():
            return candidate

    tried = ", ".join(str(root / filename) for root in _SEARCH_PATH)
    message = (
        f"ouroboros-engine: {filename} is missing — the API specification is a "
        f"committed file, not something the service generates. Looked in: {tried}"
    )
    raise SpecificationError(message)


@cache
def _parsed() -> dict:
    """Read and parse ``openapi.json`` once per process.

    Returns:
        The document. Callers get :func:`document`'s copy of it rather than this one.

    Raises:
        SpecificationError: If the file is missing or is not valid JSON.
    """
    path = locate(JSON_FILENAME)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        message = f"ouroboros-engine: {path} could not be read as JSON: {error}"
        raise SpecificationError(message) from error


def document() -> dict:
    """Return the specification the service serves.

    Returns:
        A fresh deep copy of the parsed document, so an application that is handed one —
        or a test that reaches into one — cannot modify what the next caller gets.

    Raises:
        SpecificationError: If the document is missing or malformed.
    """
    return deepcopy(_parsed())


def render(yaml_text: str) -> str:
    """Render the authoritative YAML document as the JSON file committed beside it.

    Args:
        yaml_text: The contents of ``openapi.yaml``.

    Returns:
        The JSON text, ending in a newline. Key order is the YAML's own — nothing is
        sorted — so the two files read the same way top to bottom and a diff of the
        rendered one shows only what was actually edited.
    """
    # Imported here rather than at module scope: this function is the development verb,
    # and the served application must not need a YAML parser to answer a request. See
    # the module docstring.
    import yaml

    parsed = yaml.safe_load(yaml_text)
    return json.dumps(parsed, indent=_JSON_INDENT, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    """The ``uv run openapi`` entry point — re-render ``openapi.json`` from the YAML.

    Args:
        argv: Command-line arguments, or ``None`` to read ``sys.argv``.

    Returns:
        The process exit code: ``0`` when the JSON file was written or already current,
        ``1`` under ``--check`` when it had drifted from the YAML, ``2`` when the
        specification could not be found or read.
    """
    parser = argparse.ArgumentParser(
        prog="openapi",
        description=(
            "Render ouroboros-engine's authoritative openapi.yaml into the "
            "openapi.json committed beside it, which is the copy the service loads."
        ),
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="write nothing; exit non-zero if openapi.json is not what the YAML renders to",
    )
    arguments = parser.parse_args(argv)

    try:
        source = locate(YAML_FILENAME)
        rendered = render(source.read_text(encoding="utf-8"))
    except (SpecificationError, OSError) as error:
        print(error, file=sys.stderr)
        return 2

    # Not `locate(JSON_FILENAME)`: the JSON is an output, and it has to be writable
    # before it exists. It belongs beside the YAML that produced it, wherever that was
    # found.
    target = source.with_name(JSON_FILENAME)
    current = target.read_text(encoding="utf-8") if target.is_file() else None

    if arguments.check:
        if current == rendered:
            print(f"{target} is current")
            return 0
        print(
            f"{target} has drifted from {source.name} — run `uv run openapi`",
            file=sys.stderr,
        )
        return 1

    if current == rendered:
        print(f"{target} is already current")
        return 0

    target.write_text(rendered, encoding="utf-8")
    print(f"wrote {target}")
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised as `python -m`, not by tests
    raise SystemExit(main())
