"""The internal boundary: what gets in, what gets a 401, and what a 401 gives away."""

import asyncio
import hmac
import json
import logging

import pytest
from fastapi.testclient import TestClient

from ouroboros_engine.api.health import HEALTH_PATH
from ouroboros_engine.core.security import (
    INTERNAL_KEY_HEADER,
    UNAUTHORIZED_BODY,
    InternalKeyMiddleware,
)
from ouroboros_engine.main import _PUBLIC_PATHS

#: Paths that must never answer without the key. The two routes that exist plus the
#: documentation FastAPI generates — a map of the internal surface is worth protecting —
#: and a path that does not exist at all.
GUARDED_PATHS = ("/", "/v0/status", "/openapi.json", "/docs", "/no/such/path")


@pytest.mark.parametrize("path", GUARDED_PATHS)
def test_a_request_without_the_key_is_rejected(
    anonymous_client: TestClient, path: str
) -> None:
    response = anonymous_client.get(path)

    assert response.status_code == 401


@pytest.mark.parametrize("path", GUARDED_PATHS)
def test_a_request_with_the_wrong_key_is_rejected(
    anonymous_client: TestClient, path: str
) -> None:
    response = anonymous_client.get(path, headers={INTERNAL_KEY_HEADER: "not-the-key"})

    assert response.status_code == 401


@pytest.mark.parametrize(
    "wrong",
    [
        "",
        " ",
        "test-internal-key-1f3c9",  # one character short — a prefix of the real one
        "test-internal-key-1f3c9a ",  # trailing space
        "TEST-INTERNAL-KEY-1F3C9A",  # case differs
        "test-internal-key-1f3c9a\x00",
    ],
)
def test_a_near_miss_is_still_a_miss(anonymous_client: TestClient, wrong: str) -> None:
    response = anonymous_client.get("/", headers={INTERNAL_KEY_HEADER: wrong})

    assert response.status_code == 401


def test_a_non_ascii_key_is_compared_rather_than_raising() -> None:
    # Header bytes are decoded as latin-1 by the server, so a caller sending UTF-8 can
    # produce a string the secret's own encoding has no answer for. It has to be a
    # rejection, not a 500 — an exception here would be a way to take the engine's
    # error rate up from outside.
    middleware = InternalKeyMiddleware(_unreachable, secret="s3cret", public_paths=())
    scope = _http_scope(headers=[(b"x-ouro-internal-key", "ключ".encode())])

    assert not middleware._is_authorised(scope)


def test_the_right_key_reaches_the_route(client: TestClient) -> None:
    response = client.get("/v0/status")

    assert response.status_code == 200


def test_the_header_name_is_matched_case_insensitively(
    anonymous_client: TestClient, internal_key: str
) -> None:
    # HTTP header names are case-insensitive, and a caller that sends
    # `x-ouro-internal-key` is a correctly behaving caller.
    response = anonymous_client.get("/", headers={"x-ouro-internal-key": internal_key})

    assert response.status_code == 200


def test_liveness_is_the_one_path_that_needs_no_key(
    anonymous_client: TestClient,
) -> None:
    response = anonymous_client.get(HEALTH_PATH)

    assert response.status_code == 200


def test_liveness_is_the_only_public_path() -> None:
    assert _PUBLIC_PATHS == (HEALTH_PATH,), (
        "every path added to the public set is a path a misrouted engine port serves "
        "to anyone who finds it"
    )


@pytest.mark.parametrize("suffix", ["/extra", "z", "?probe=1&x=/v0/status"])
def test_the_public_path_is_matched_exactly_not_by_prefix(
    anonymous_client: TestClient, suffix: str
) -> None:
    # A prefix match would make the guard depend on the part of the URL the caller
    # controls; only `/healthz` itself is liveness. The query-string case is the one
    # worth spelling out: the middleware reads the path, which never includes it.
    response = anonymous_client.get(f"{HEALTH_PATH}{suffix}")

    assert response.status_code == (200 if suffix.startswith("?") else 401)


def test_the_rejection_is_the_same_whether_the_path_exists(
    anonymous_client: TestClient,
) -> None:
    real = anonymous_client.get("/v0/status")
    imaginary = anonymous_client.get("/v0/status-that-was-never-implemented")

    assert real.status_code == imaginary.status_code == 401
    assert real.json() == imaginary.json(), (
        "a difference here is how the internal surface gets mapped from outside"
    )


def test_the_rejection_body_says_nothing_about_the_request(
    anonymous_client: TestClient, internal_key: str
) -> None:
    response = anonymous_client.get(
        "/v0/status", headers={INTERNAL_KEY_HEADER: "wrong"}
    )

    assert response.json() == UNAUTHORIZED_BODY
    body = response.text
    for leak in ("v0", "status", INTERNAL_KEY_HEADER, "wrong", internal_key):
        assert leak not in body, f"the rejection must not echo {leak!r}"


def test_the_rejection_carries_no_hint_in_its_headers(
    anonymous_client: TestClient, internal_key: str
) -> None:
    response = anonymous_client.get("/v0/status")

    assert INTERNAL_KEY_HEADER.lower() not in response.headers
    assert internal_key not in str(response.headers)


def test_the_rejection_is_json(anonymous_client: TestClient) -> None:
    response = anonymous_client.get("/v0/status")

    assert response.headers["content-type"].startswith("application/json")


@pytest.mark.parametrize("method", ["get", "post", "put", "patch", "delete", "head"])
def test_every_method_is_guarded_not_just_get(
    anonymous_client: TestClient, method: str
) -> None:
    # A route that only exists for GET today may exist for POST tomorrow; the guard runs
    # before routing, so it covers the methods that do not exist yet either.
    response = getattr(anonymous_client, method)("/v0/status")

    assert response.status_code == 401


def test_the_comparison_is_constant_time(monkeypatch: pytest.MonkeyPatch) -> None:
    # The property that matters is not observable from a test — a timing measurement is
    # noise on a loaded CI runner. What is observable is that the code asks the standard
    # library for it, so this asserts hmac.compare_digest is what decides.
    calls = _record_comparisons(monkeypatch)
    middleware = InternalKeyMiddleware(_unreachable, secret="s3cret", public_paths=())
    scope = _http_scope(headers=[(b"x-ouro-internal-key", b"s3cret")])

    assert middleware._is_authorised(scope)
    assert calls == [(b"s3cret", b"s3cret")]


def test_a_missing_header_is_compared_like_a_wrong_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # If absence short-circuited, "no header" and "wrong header" would take measurably
    # different paths, and the difference is a signal a caller can use.
    calls = _record_comparisons(monkeypatch)
    middleware = InternalKeyMiddleware(_unreachable, secret="s3cret", public_paths=())

    assert not middleware._is_authorised(_http_scope(headers=[]))
    assert calls == [(b"", b"s3cret")]


def test_a_public_path_is_not_compared_at_all(monkeypatch: pytest.MonkeyPatch) -> None:
    def exploding_compare(_left: bytes, _right: bytes) -> bool:
        raise AssertionError("liveness must not depend on the secret")

    monkeypatch.setattr(hmac, "compare_digest", exploding_compare)
    middleware = InternalKeyMiddleware(
        _unreachable, secret="s3cret", public_paths=(HEALTH_PATH,)
    )

    assert middleware._is_authorised(_http_scope(path=HEALTH_PATH))


def _record_comparisons(monkeypatch: pytest.MonkeyPatch) -> list[tuple[bytes, bytes]]:
    """Watch every constant-time comparison the middleware makes.

    Args:
        monkeypatch: The patcher, which restores :func:`hmac.compare_digest` afterwards.

    Returns:
        A list that receives each ``(candidate, secret)`` pair as it is compared. The
        real comparison still runs, so the middleware behaves normally.
    """
    calls: list[tuple[bytes, bytes]] = []
    real = hmac.compare_digest

    def recording_compare(left: bytes, right: bytes) -> bool:
        calls.append((left, right))
        return real(left, right)

    monkeypatch.setattr(hmac, "compare_digest", recording_compare)
    return calls


def test_a_rejection_is_logged_with_the_path_and_never_the_key(
    anonymous_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger="ouroboros_engine.core.security"):
        anonymous_client.get("/v0/status", headers={INTERNAL_KEY_HEADER: "wrong"})

    record = caplog.records[-1]

    assert record.levelno == logging.WARNING
    assert record.path == "/v0/status"
    assert record.method == "GET"
    assert record.key_present is True
    assert "wrong" not in json.dumps(record.__dict__, default=str), (
        "a rejected key is still a credential — it may be another environment's"
    )


def test_an_accepted_request_is_not_logged_as_a_rejection(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger="ouroboros_engine.core.security"):
        client.get("/v0/status")

    assert caplog.records == []


def test_a_missing_key_is_logged_as_missing(
    anonymous_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger="ouroboros_engine.core.security"):
        anonymous_client.get("/v0/status")

    assert caplog.records[-1].key_present is False, (
        "'no key' and 'wrong key' are different operational problems"
    )


def test_a_non_http_connection_is_passed_through() -> None:
    # Lifespan is the server starting, not a caller. Guarding it would mean an
    # application that cannot start.
    seen: list[str] = []

    async def record(scope: dict, _receive: object, _send: object) -> None:
        seen.append(scope["type"])

    middleware = InternalKeyMiddleware(record, secret="s3cret", public_paths=())

    asyncio.run(middleware({"type": "lifespan"}, _nothing, _nothing))

    assert seen == ["lifespan"]


async def _unreachable(_scope: dict, _receive: object, _send: object) -> None:
    """Stand in for the wrapped application in tests that never authorise a request.

    Args:
        _scope: The ASGI scope, unused.
        _receive: The ASGI receive channel, unused.
        _send: The ASGI send channel, unused.

    Raises:
        AssertionError: Always — reaching it means the guard let something through.
    """
    raise AssertionError("the request should not have reached the application")


async def _nothing() -> dict:
    """An ASGI channel that is never used.

    Returns:
        Nothing ever — the tests that pass it never let the wrapped application read.
    """
    raise AssertionError("no message should be read")


def _http_scope(
    path: str = "/v0/status", headers: list[tuple[bytes, bytes]] | None = None
) -> dict:
    """Build the part of an ASGI scope the middleware reads.

    Args:
        path: The request path.
        headers: Raw header pairs, defaulting to none at all.

    Returns:
        An ASGI HTTP scope.
    """
    return {
        "type": "http",
        "method": "GET",
        "path": path,
        "headers": headers or [],
    }
