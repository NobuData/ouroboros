"""The committed specification, and the code's agreement with it.

``openapi.yaml`` is authoritative and the application serves it verbatim, which buys a
contract nobody's docstring can edit — and costs the one thing a generated document gave
away for free: the guarantee that it describes the routes that actually exist. These
tests are that guarantee. They fail when a path, a method, a response field or the
version drifts from what the document claims, so the disagreement is a red pipeline
rather than a caller reading a specification the service does not honour.
"""

import json
from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.testclient import TestClient
from openapi_spec_validator import validate
from pydantic import BaseModel

from ouroboros_engine import __version__, openapi
from ouroboros_engine.api.health import HEALTH_PATH, Liveness
from ouroboros_engine.api.root import ServiceIdentity
from ouroboros_engine.api.status import ServiceStatus
from ouroboros_engine.core.security import INTERNAL_KEY_HEADER, UNAUTHORIZED_BODY
from ouroboros_engine.main import _PUBLIC_PATHS, create_app
from ouroboros_engine.settings import Settings

#: The module root, where both specification files are committed — resolved from this
#: file rather than the working directory, like every other path in the suite.
_MODULE_ROOT = Path(__file__).resolve().parent.parent

#: Every response model the service returns, under the name the document gives it. A
#: model added without a schema beside it fails the exhaustiveness check below rather
#: than being described by nothing.
_DOCUMENTED_MODELS: dict[str, type[BaseModel]] = {
    "Liveness": Liveness,
    "ServiceIdentity": ServiceIdentity,
    "ServiceStatus": ServiceStatus,
}


def _yaml_document() -> dict:
    """Parse the authoritative file.

    Returns:
        ``openapi.yaml`` as nested dictionaries.
    """
    return yaml.safe_load((_MODULE_ROOT / "openapi.yaml").read_text(encoding="utf-8"))


def _json_text() -> str:
    """Read the rendered file.

    Returns:
        The exact contents of ``openapi.json``, unparsed.
    """
    return (_MODULE_ROOT / "openapi.json").read_text(encoding="utf-8")


def _operations(document: dict) -> dict[tuple[str, str], dict]:
    """Flatten a document's paths into one mapping.

    Args:
        document: A parsed OpenAPI document.

    Returns:
        Every operation, keyed by ``(path, upper-case method)``.
    """
    return {
        (path, method.upper()): operation
        for path, item in document["paths"].items()
        for method, operation in item.items()
    }


def _served(app: FastAPI) -> dict[tuple[str, str], dict]:
    """Ask FastAPI what the application's routes actually are.

    The application no longer generates its document, so this generates one purely to
    read the route set out of it — FastAPI's own answer to "what does this serve",
    derived from the code rather than from the committed file, which is exactly the
    other side of every comparison below. Reading ``app.routes`` directly would not do:
    an included router is wrapped in an object with no path of its own.

    Args:
        app: The application under test.

    Returns:
        Every operation the code serves, keyed like :func:`_operations`. FastAPI's own
        ``/docs`` and ``/openapi.json`` routes are excluded — they are not in its schema
        — and so is ``HEAD``, which it never documents.
    """
    generated = get_openapi(title=app.title, version=app.version, routes=app.routes)
    return _operations(generated)


@pytest.fixture
def document() -> dict:
    """The specification as committed.

    Returns:
        The authoritative YAML document, parsed.
    """
    return _yaml_document()


# ---------------------------------------------------------------------------
# It is a specification, and the two files are one document
# ---------------------------------------------------------------------------


def test_the_document_is_a_valid_openapi_specification(document: dict) -> None:
    # Written by hand and published to a catalogue, so without this the thing that
    # catches a malformed document is the upload — or, worse, a client reading it.
    validate(document)


def test_the_yaml_and_the_json_are_the_same_document() -> None:
    assert json.loads(_json_text()) == _yaml_document(), (
        "openapi.json is rendered from openapi.yaml — run `uv run openapi`"
    )


def test_the_json_is_exactly_what_the_renderer_writes() -> None:
    # Not just equal as data: the file is committed and diffed, so its formatting is
    # part of what has to be reproducible. A hand-edited openapi.json fails here.
    rendered = openapi.render(
        (_MODULE_ROOT / "openapi.yaml").read_text(encoding="utf-8")
    )

    assert _json_text() == rendered, "run `uv run openapi` and commit the result"


def test_the_check_verb_agrees_that_the_pair_is_current() -> None:
    # The same assertion the developer's `uv run openapi --check` makes, so the verb
    # documented in the README is exercised rather than trusted.
    assert openapi.main(["--check"]) == 0


def test_the_loader_hands_out_a_copy_it_does_not_share() -> None:
    first = openapi.document()
    first["info"]["title"] = "mutated"

    assert openapi.document()["info"]["title"] == "ouroboros-engine", (
        "one application editing the document must not change what the next one serves"
    )


def test_a_missing_specification_is_named_rather_than_guessed_at() -> None:
    with pytest.raises(openapi.SpecificationError) as failure:
        openapi.locate("openapi.does-not-exist.yaml")

    assert "openapi.does-not-exist.yaml" in str(failure.value)
    assert "Looked in" in str(failure.value), (
        "the answer differs for a checkout and for an image built without the file"
    )


# ---------------------------------------------------------------------------
# The document and the running application
# ---------------------------------------------------------------------------


def test_the_service_serves_the_committed_document(
    client: TestClient, document: dict
) -> None:
    assert client.get("/openapi.json").json() == document, (
        "the document a catalogue holds is the document the process answers with"
    )


def test_the_version_is_the_one_the_manifest_declares(document: dict) -> None:
    # pyproject.toml is the one place a version is written (docs/CONVENTIONS.md § 8),
    # and the specification is a second thing that states it. This is what makes a
    # release bump both.
    assert document["info"]["version"] == __version__


def test_every_route_the_application_serves_is_described(document: dict) -> None:
    served = set(_served(create_app(Settings())))
    described = set(_operations(document))

    assert served, "the comparison below would pass vacuously with no routes"
    assert served <= described, (
        f"undocumented: {sorted(served - described)} — describe it in openapi.yaml"
    )


def test_the_document_describes_nothing_the_application_does_not_serve(
    document: dict,
) -> None:
    served = set(_served(create_app(Settings())))
    described = set(_operations(document))

    assert described <= served, (
        f"documented but not served: {sorted(described - served)} — a specification "
        "that promises a route the service does not have is worse than one that omits it"
    )


def test_each_documented_operation_is_reachable(
    client: TestClient, document: dict
) -> None:
    for path, method in _operations(document):
        response = client.request(method, path)

        assert response.status_code == 200, f"{method} {path} answered {response}"


# ---------------------------------------------------------------------------
# The document and the boundary
# ---------------------------------------------------------------------------


def test_the_security_scheme_is_the_header_the_guard_reads(document: dict) -> None:
    scheme = document["components"]["securitySchemes"]["InternalKey"]

    assert scheme["type"] == "apiKey"
    assert scheme["in"] == "header"
    assert scheme["name"] == INTERNAL_KEY_HEADER


def test_the_key_is_required_by_default(document: dict) -> None:
    assert document["security"] == [{"InternalKey": []}], (
        "the guard runs before routing, so the requirement is the document's default "
        "and an operation opts out rather than opting in"
    )


def test_liveness_is_the_only_operation_that_opts_out_of_the_key(
    document: dict,
) -> None:
    public = {
        path
        for (path, _), operation in _operations(document).items()
        if operation.get("security") == []
    }

    assert public == set(_PUBLIC_PATHS) == {HEALTH_PATH}, (
        "main._PUBLIC_PATHS and the document have to name the same one path"
    )


def test_every_guarded_operation_documents_the_rejection(document: dict) -> None:
    guarded = {
        key: operation
        for key, operation in _operations(document).items()
        if operation.get("security") != []
    }

    assert guarded, "the suite would pass vacuously if nothing were guarded"
    for (path, method), operation in guarded.items():
        assert "401" in operation["responses"], f"{method} {path} documents no 401"


def test_the_documented_rejection_is_the_body_the_guard_sends(document: dict) -> None:
    example = document["components"]["responses"]["Unauthorized"]["content"][
        "application/json"
    ]["example"]

    assert example == UNAUTHORIZED_BODY


def test_an_unauthenticated_request_gets_the_documented_body(
    anonymous_client: TestClient, document: dict
) -> None:
    response = anonymous_client.get("/v0/status")

    assert response.status_code == 401
    assert (
        response.json()
        == (
            document["components"]["responses"]["Unauthorized"]["content"][
                "application/json"
            ]["example"]
        )
    )


# ---------------------------------------------------------------------------
# The document and the response models
# ---------------------------------------------------------------------------


def test_every_response_model_is_described_by_a_schema(document: dict) -> None:
    # Error has no model of its own — it is the shape FastAPI's own HTTPException and
    # the guard both send — so it is expected in the document and not in the mapping.
    described = set(document["components"]["schemas"]) - {"Error"}

    assert described == set(_DOCUMENTED_MODELS), (
        "a response model without a schema is an undocumented body; a schema without a "
        "model is one the service cannot produce"
    )


@pytest.mark.parametrize("name", sorted(_DOCUMENTED_MODELS))
def test_a_documented_schema_carries_the_fields_the_model_returns(
    name: str, document: dict
) -> None:
    # Field names and requiredness, not the whole JSON Schema: matching pydantic's
    # generated document byte for byte would drag the titles and docstring dumps this
    # specification exists to be rid of back into it. This is the part that can silently
    # rot — a field added to a model, or removed from one.
    schema = document["components"]["schemas"][name]
    model = _DOCUMENTED_MODELS[name]

    assert set(schema["properties"]) == set(model.model_fields)
    assert set(schema["required"]) == {
        field for field, spec in model.model_fields.items() if spec.is_required()
    }


def test_every_documented_example_is_a_body_the_service_could_send(
    document: dict,
) -> None:
    # An example that no longer validates is a lie a reader copies into their client.
    schemas = {
        f"#/components/schemas/{name}": model
        for name, model in _DOCUMENTED_MODELS.items()
    }

    checked = 0
    for (path, method), operation in _operations(document).items():
        body = operation["responses"]["200"]["content"]["application/json"]
        model = schemas.get(body["schema"]["$ref"])
        assert model is not None, f"{method} {path} refers to an unknown schema"

        model.model_validate(body["example"])
        checked += 1

    assert checked == len(_operations(document))
