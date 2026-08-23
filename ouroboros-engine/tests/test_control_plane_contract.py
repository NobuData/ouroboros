"""The mirror, held to the document it mirrors.

``ouroboros_engine.control_plane.contract`` is ``ouroboros-rest``'s internal OpenAPI
document written as Python, and a mirror is only worth having if something notices when the
two stop agreeing. So this file reads the committed
``ouroboros-rest/openapi.internal.json`` and compares the parts that matter: the paths, the
header, the names on the wire, and the two closed vocabularies — the provider kinds a lease
may name, and AB.1's per-hop error codes.

**What this cannot catch, stated rather than glossed.** The engine's CI is path-filtered to
``ouroboros-engine/**``, so a change to the control plane's document alone does not run this
suite; the drift is caught on the next change to this module rather than on the change that
caused it. That is a real gap and the alternative — no cross-module assertion at all — is a
mirror nobody ever compares.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from ouroboros_engine.control_plane.contract import (
    EVENT_MODELS,
    INTERNAL_KEY_HEADER,
    INVOKE_ERROR_CODES,
    INVOKE_MEDIA_TYPE,
    INVOKE_PATH,
    LEASABLE_PROVIDERS,
    LEASE_ERRORS,
    LEASE_PATH,
    PROVIDERS,
    PROXIED_PROVIDERS,
    DeltaEvent,
    ErrorEnvelope,
    InvokeRequest,
    Lease,
    LeaseRequest,
    RunContext,
    UsageEvent,
)

#: The control plane's committed internal document, from the sibling module.
_DOCUMENT_PATH = (
    Path(__file__).resolve().parents[2] / "ouroboros-rest" / "openapi.internal.json"
)


def _document() -> dict[str, Any]:
    """The control plane's internal contract, as data.

    Returns:
        The parsed document.
    """
    assert _DOCUMENT_PATH.is_file(), (
        f"{_DOCUMENT_PATH} is missing. This suite asserts that this module's contract "
        "still mirrors ouroboros-rest's internal document, so it needs the sibling module "
        "in the checkout."
    )
    return json.loads(_DOCUMENT_PATH.read_text(encoding="utf-8"))


def test_the_two_paths_are_the_ones_the_control_plane_serves() -> None:
    assert sorted(_document()["paths"]) == sorted([LEASE_PATH, INVOKE_PATH])


def test_the_key_travels_on_the_header_the_control_plane_reads() -> None:
    scheme = _document()["components"]["securitySchemes"]["ouroInternalKey"]

    assert scheme["name"] == INTERNAL_KEY_HEADER
    assert scheme["in"] == "header"


def test_the_key_is_the_same_header_this_service_requires_inbound() -> None:
    # One boundary, one credential, two directions: ouroboros-rest sends this header when
    # it calls the engine, and requires it when the engine calls back.
    from ouroboros_engine.core import security

    assert INTERNAL_KEY_HEADER == security.INTERNAL_KEY_HEADER


def test_every_provider_kind_is_one_the_control_plane_accepts() -> None:
    published = _document()["components"]["schemas"]["ProviderKind"]["enum"]

    assert sorted(PROVIDERS) == sorted(published)


def test_the_leasable_and_proxied_kinds_partition_the_vocabulary() -> None:
    # A kind in neither list would be one this client could ask for without knowing what
    # the answer would be; a kind in both would be one nobody had classified.
    assert set(LEASABLE_PROVIDERS) | set(PROXIED_PROVIDERS) == set(PROVIDERS)
    assert not set(LEASABLE_PROVIDERS) & set(PROXIED_PROVIDERS)


def test_the_error_taxonomy_is_the_published_one() -> None:
    published = _document()["components"]["schemas"]["InvokeErrorCode"]["enum"]

    assert sorted(INVOKE_ERROR_CODES) == sorted(published)


def test_the_stream_is_framed_the_way_the_document_says() -> None:
    content = _document()["paths"][INVOKE_PATH]["post"]["responses"]["200"]["content"]

    assert INVOKE_MEDIA_TYPE in content


def test_there_is_a_model_for_every_event_the_document_publishes() -> None:
    members = _document()["components"]["schemas"]["InvokeEvent"]["oneOf"]
    names = {member["$ref"].rsplit("/", 1)[-1] for member in members}

    assert len(names) == len(EVENT_MODELS)
    for kind in EVENT_MODELS:
        assert f"Invoke{kind.capitalize()}Event" in names


@pytest.mark.parametrize("code", LEASE_ERRORS)
def test_every_lease_refusal_this_client_knows_is_documented(code: str) -> None:
    # A code this client branches on that the control plane cannot answer with would be a
    # branch nothing ever takes.
    assert code in json.dumps(_document()["paths"][LEASE_PATH])


def test_a_lease_carries_the_fields_the_document_requires() -> None:
    required = _document()["components"]["schemas"]["Lease"]["required"]
    aliases = {field.alias or name for name, field in Lease.model_fields.items()}

    assert set(required) <= aliases


def test_a_lease_has_nowhere_for_a_credential() -> None:
    # Decision P3, as a property of this model: a "short-lived token" cannot be read out of
    # a lease, because there is no field to read it from.
    for name in Lease.model_fields:
        assert not any(
            word in name
            for word in ("key", "token", "secret", "credential", "password")
        )


def test_a_lease_ignores_a_field_a_later_control_plane_adds() -> None:
    # The internal contract is allowed to add a response field, and a client that refused
    # one would turn a forward-compatible release into an outage here.
    lease = Lease.model_validate(
        {
            "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
            "provider": "ollama",
            "run": "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94",
            "organizationId": "aBcD1234eFgH5678iJkL9012mNoP3456",
            "baseUrl": "http://localhost:11434",
            "grantedAt": "2026-08-22T18:04:11.000Z",
            "expiresAt": "2026-08-22T18:19:11.000Z",
            "ttlSeconds": 900,
            "somethingAddedLater": True,
        }
    )

    assert lease.base_url == "http://localhost:11434"
    assert lease.ttl_seconds == 900


def test_a_request_refuses_a_field_this_service_does_not_declare() -> None:
    # The other direction, and the opposite rule: a request this service *sends* is closed,
    # so a typo is caught here rather than by a 422 at the end of a round trip.
    with pytest.raises(ValidationError):
        LeaseRequest.model_validate(
            {"provider": "ollama", "run": "r", "apiKey": "sk-live-nope"}
        )


def test_the_wire_names_are_the_control_plane_s_camel_case() -> None:
    # The naming convention changes at this boundary and in this module only: nothing
    # beneath it carries `runCtx` or `ttlSeconds`.
    body = InvokeRequest(
        alias="reasoning-primary",
        payload={},
        run_ctx=RunContext(run="r1", floor_hop_index=2, cost_cap_cents=500),
    ).model_dump(by_alias=True, exclude_none=True)

    assert body["runCtx"]["floorHopIndex"] == 2
    assert body["runCtx"]["costCapCents"] == 500
    assert "run_ctx" not in body


def test_an_absent_option_is_left_out_rather_than_sent_as_null() -> None:
    # `exclude_none` is what keeps an unset floor from arriving as an explicit `null`,
    # which a strict reader would have to decide the meaning of.
    body = InvokeRequest(
        connection="9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
        payload={"messages": []},
        run_ctx=RunContext(run="r1"),
    ).model_dump(by_alias=True, exclude_none=True)

    assert body == {
        "connection": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
        "payload": {"messages": []},
        "runCtx": {"run": "r1"},
    }


def test_usage_prices_an_unpriced_hop_as_none_rather_than_zero() -> None:
    # The honesty rule CH.3 (#586) already enforces: a local model's tokens are *unpriced*,
    # which is a different statement from *free*.
    usage = UsageEvent.model_validate(
        {
            "kind": "usage",
            "hop": 0,
            "connection": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10",
            "model": "qwen3-coder:32b",
            "inputTokens": 1200,
            "outputTokens": 340,
            "costCents": None,
        }
    )

    assert usage.cost_cents is None
    assert usage.input_tokens == 1200


def test_a_delta_names_the_hop_that_produced_it() -> None:
    delta = DeltaEvent.model_validate({"kind": "delta", "hop": 1, "text": "hello"})

    assert (delta.hop, delta.text) == (1, "hello")


def test_an_error_envelope_always_has_details() -> None:
    # Empty rather than absent, so a reader of `details["provider"]` never has to check
    # `details` first — the same promise ouroboros_engine.core.errors makes.
    envelope = ErrorEnvelope.model_validate(
        {"code": "unauthenticated", "message": "Unauthorized."}
    )

    assert envelope.details == {}
