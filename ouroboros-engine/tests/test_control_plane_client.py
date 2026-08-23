"""The client stub: what it builds, what it reads, and what it refuses to do.

`#224 <https://github.com/NobuData/ouroboros/issues/224>`_ asks for *engine client stubs
for both surfaces, so the FastAPI side compiles against the contract before the executor
exists*. Nothing here opens a socket — see the client's own docstring for why the transport
arrives with AF.2 — so what is asserted is everything a request-builder and a
response-reader can be wrong about, which turns out to be most of what matters:

* the key is on **every** request, and there is no way to build one without it;
* the URL survives a control plane deployed under a path;
* an invocation names exactly one target, and is refused here rather than after a round
  trip;
* a refusal arrives as the control plane's own ``code``, so an executor can tell a
  **decision** from an **absence**;
* the stream is read one event at a time rather than buffered.
"""

import json

import pytest

from ouroboros_engine.control_plane.client import (
    ControlPlaneClient,
    ControlPlaneError,
)
from ouroboros_engine.control_plane.contract import (
    INTERNAL_KEY_HEADER,
    INVOKE_MEDIA_TYPE,
    INVOKE_PATH,
    LEASE_PATH,
    RunContext,
)

#: The suite's control plane and its secret. Neither is deployed anywhere.
BASE_URL = "http://rest:4000"
SECRET = "test-internal-key-1f3c9a"
RUN = "4d2a8b31-7c65-4e0a-9f38-1b6c2d5e7a94"

#: A lease as the control plane answers one — an address, a scope and two times.
GRANTED = {
    "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "provider": "ollama",
    "run": RUN,
    "organizationId": "aBcD1234eFgH5678iJkL9012mNoP3456",
    "baseUrl": "http://localhost:11434",
    "grantedAt": "2026-08-22T18:04:11.000Z",
    "expiresAt": "2026-08-22T18:19:11.000Z",
    "ttlSeconds": 900,
}


@pytest.fixture(name="client")
def _client() -> ControlPlaneClient:
    return ControlPlaneClient(BASE_URL, SECRET)


def test_a_lease_request_goes_to_the_path_the_contract_names(
    client: ControlPlaneClient,
) -> None:
    request = client.lease_request("ollama", RUN)

    assert request.method == "POST"
    assert request.url == f"{BASE_URL}{LEASE_PATH}"
    assert request.json == {"provider": "ollama", "run": RUN}


def test_every_request_carries_the_shared_secret(client: ControlPlaneClient) -> None:
    # There is no way to build a request without it, which is why a misconfigured stack
    # fails at the boundary rather than halfway through a run.
    for request in (
        client.lease_request("ollama", RUN),
        client.invoke_request(RunContext(run=RUN), {}, alias="a"),
    ):
        assert request.headers[INTERNAL_KEY_HEADER] == SECRET


def test_a_control_plane_under_a_path_keeps_it() -> None:
    # A deployment behind a reverse proxy on /api is a decision this service does not get
    # to make; resolving against a base without a trailing slash would drop it silently.
    client = ControlPlaneClient("http://gateway.internal/api", SECRET)

    assert (
        client.lease_request("ollama", RUN).url
        == f"http://gateway.internal/api{LEASE_PATH}"
    )


def test_a_cloud_provider_is_not_refused_by_this_client(
    client: ControlPlaneClient,
) -> None:
    # The policy is the control plane's, and it answers 403. A client that pre-empted it
    # would be a second implementation of the same rule — one a stale copy of this file
    # could disagree with, in the direction that matters.
    assert client.lease_request("anthropic", RUN).json["provider"] == "anthropic"


def test_a_granted_lease_is_read_into_the_contract_s_names(
    client: ControlPlaneClient,
) -> None:
    lease = client.read_lease(200, GRANTED)

    assert lease.base_url == "http://localhost:11434"
    assert lease.organization_id == "aBcD1234eFgH5678iJkL9012mNoP3456"
    assert lease.ttl_seconds == 900


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "unauthenticated"),
        (403, "provider_not_leasable"),
        (404, "local_provider_not_configured"),
        (404, "run_not_found"),
        (422, "validation_failed"),
    ],
)
def test_a_refusal_arrives_as_the_control_plane_s_own_code(
    client: ControlPlaneClient, status: int, code: str
) -> None:
    # A decision (`provider_not_leasable`) and an absence (`local_provider_not_configured`)
    # share a family of status codes and want opposite handling: one will never succeed,
    # and the other is fixed by an operator setting a variable.
    with pytest.raises(ControlPlaneError) as refused:
        client.read_lease(
            status, {"code": code, "message": "refused", "details": {"provider": "x"}}
        )

    assert refused.value.code == code
    assert refused.value.status == status
    assert refused.value.details == {"provider": "x"}


def test_an_answer_outside_the_envelope_is_still_an_exception(
    client: ControlPlaneClient,
) -> None:
    # A proxy's error page, a gateway's own JSON. A worker that got one needs an exception
    # rather than a parse failure three frames from the request that caused it.
    with pytest.raises(ControlPlaneError) as refused:
        client.read_lease(502, {"nginx": "bad gateway"})

    assert refused.value.code == "unreadable_answer"
    assert refused.value.status == 502


def test_an_invocation_asks_for_the_stream(client: ControlPlaneClient) -> None:
    request = client.invoke_request(
        RunContext(run=RUN, floor_hop_index=2, cost_cap_cents=500),
        {"messages": []},
        alias="reasoning-primary",
    )

    assert request.url == f"{BASE_URL}{INVOKE_PATH}"
    assert request.accept == INVOKE_MEDIA_TYPE
    assert request.headers["Accept"] == INVOKE_MEDIA_TYPE
    assert request.json["runCtx"] == {
        "run": RUN,
        "floorHopIndex": 2,
        "costCapCents": 500,
    }


@pytest.mark.parametrize(
    "target",
    [
        {},
        {"connection": "9f1c0a5e-0f6d-4a1b-9d5e-2b8f3c7a4e10", "alias": "primary"},
    ],
)
def test_an_invocation_names_exactly_one_target(
    client: ControlPlaneClient, target: dict[str, str]
) -> None:
    # Refused here rather than sent: the control plane's answer to *which did you mean*
    # would be a 422 at the end of a round trip, and a request naming both is a caller with
    # two ideas about which provider to use.
    with pytest.raises(ValueError, match="exactly one"):
        client.invoke_request(RunContext(run=RUN), {}, **target)


def test_the_payload_passes_through_untouched(client: ControlPlaneClient) -> None:
    # Opaque on both sides of this boundary: the control plane brokers the call and does
    # not read the prompt, which is also why it cannot log it.
    payload = {"messages": [{"role": "user", "content": "why is the build red?"}]}

    request = client.invoke_request(RunContext(run=RUN), payload, connection="c1")

    assert request.json["payload"] == payload


def test_a_stream_is_read_one_event_at_a_time(client: ControlPlaneClient) -> None:
    lines = [
        json.dumps({"kind": "delta", "hop": 0, "text": "the "}),
        json.dumps({"kind": "delta", "hop": 0, "text": "build"}),
        json.dumps(
            {
                "kind": "usage",
                "hop": 0,
                "connection": "c1",
                "model": "qwen3-coder:32b",
                "inputTokens": 12,
                "outputTokens": 3,
                "costCents": None,
            }
        ),
        json.dumps({"kind": "done", "hop": 0, "finishReason": "stop"}),
    ]

    events = list(client.read_events(lines))

    assert [event.kind for event in events] == ["delta", "delta", "usage", "done"]
    assert events[-1].finish_reason == "stop"


def test_a_stream_is_a_generator_rather_than_a_buffer(
    client: ControlPlaneClient,
) -> None:
    # The shape the surface exists for: an executor renders deltas as they arrive, and
    # buffering to parse would give away the streaming this contract is written around.
    def forever() -> object:
        yield json.dumps({"kind": "delta", "hop": 0, "text": "first"})
        raise AssertionError("the reader consumed more than it was asked for")

    first = next(client.read_events(forever()))

    assert first.text == "first"


def test_a_blank_line_is_not_an_event(client: ControlPlaneClient) -> None:
    lines = ["", json.dumps({"kind": "done", "hop": 1, "finishReason": "length"}), "\n"]

    assert [event.kind for event in client.read_events(lines)] == ["done"]


def test_a_failure_arrives_as_a_terminal_event_rather_than_an_exception(
    client: ControlPlaneClient,
) -> None:
    # A chain that ran out of hops is a *result*, not a transport failure: the run has
    # partial output, usage rows and a reason, and an exception would throw all three away.
    lines = [
        json.dumps(
            {
                "kind": "hop",
                "hop": 0,
                "connection": "c1",
                "outcome": "failed_over",
                "code": "provider_unavailable",
                "latencyMs": 1203,
            }
        ),
        json.dumps(
            {
                "kind": "error",
                "hop": 1,
                "code": "floor_exhausted",
                "message": "The chain reached its floor.",
            }
        ),
    ]

    events = list(client.read_events(lines))

    assert events[0].outcome == "failed_over"
    assert events[1].code == "floor_exhausted"


def test_an_event_kind_this_build_does_not_know_is_named(
    client: ControlPlaneClient,
) -> None:
    # A control plane emitting a sixth kind is a version mismatch, and saying so by name is
    # more use to whoever reads the log than a validation trace about a union.
    with pytest.raises(ControlPlaneError) as refused:
        list(client.read_events([json.dumps({"kind": "telemetry", "hop": 0})]))

    assert refused.value.code == "unknown_event_kind"
    assert "telemetry" in str(refused.value)
