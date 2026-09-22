"""The socket the production client leaves out: one JSON request, one answer.

:class:`~ouroboros_engine.control_plane.client.ControlPlaneRequest` is a complete description
of a request, and the client deliberately does not send one (its docstring says why). The
driver sends them with the standard library, so no HTTP dependency is added to anything.

**Retrying is safe because every write is idempotency-keyed.** A connection that drops, or a
``502``/``503``/``504`` from something in front of the control plane, is retried with the
*same* request, key included. If the first delivery landed, the control plane replays its
first answer. This is the redelivery AP.1's receipts exist for, exercised on every flaky
network rather than only in a test.
"""

import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any, Protocol
from urllib import error, request

from ouroboros_engine.control_plane.client import ControlPlaneRequest

_LOG = logging.getLogger("ouroboros_simulator.transport")

#: Statuses that mean *something between here and the control plane failed*, and that a
#: retry of the same keyed request may get past.
RETRYABLE_STATUSES = frozenset(
    {HTTPStatus.BAD_GATEWAY, HTTPStatus.SERVICE_UNAVAILABLE, HTTPStatus.GATEWAY_TIMEOUT}
)


@dataclass(frozen=True)
class Response:
    """One answer.

    Attributes:
        status: The HTTP status.
        body: The parsed JSON body, or ``{}`` when there was none or it was not JSON. The
            client turns an unreadable refusal into ``unreadable_answer`` itself.
    """

    status: int
    body: dict[str, Any]


class Transport(Protocol):
    """Anything that can send a :class:`ControlPlaneRequest`. Tests substitute a fake."""

    def send(self, outgoing: ControlPlaneRequest) -> Response:
        """Send one request.

        Args:
            outgoing: The request, complete with headers and body.

        Returns:
            The answer.
        """
        ...


class TransportError(RuntimeError):
    """The control plane could not be reached, even after retrying."""


class HttpTransport:
    """Sends requests over HTTP with ``urllib``, retrying what is safe to retry.

    Attributes:
        timeout: Seconds to wait for one answer.
        attempts: How many times to try one request before giving up.
    """

    def __init__(
        self,
        *,
        timeout: float = 10.0,
        attempts: int = 3,
        backoff: float = 0.25,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        """Make a transport.

        Args:
            timeout: Seconds to wait for one answer.
            attempts: Tries per request, at least one.
            backoff: Seconds before the second try. It doubles for each try after that.
            sleep: What waits between tries. Tests pass a recorder so nothing sleeps.

        Raises:
            ValueError: If ``attempts`` is below one.
        """
        if attempts < 1:
            raise ValueError("attempts must be at least 1")
        self.timeout = timeout
        self.attempts = attempts
        self._backoff = backoff
        self._sleep = sleep if sleep is not None else time.sleep
        # An empty ProxyHandler, as the image's healthcheck uses: a proxy variable in a
        # developer's shell must not send a request for localhost out to a proxy.
        self._opener = request.build_opener(request.ProxyHandler({}))

    def send(self, outgoing: ControlPlaneRequest) -> Response:
        """Send one request, retrying transport failures with the same idempotency key.

        Args:
            outgoing: The request.

        Returns:
            The answer, whatever its status. Only a ``502``/``503``/``504`` is retried: any
            other status is the control plane's answer and the client reads it.

        Raises:
            TransportError: If every try failed to get an answer, or got a retryable one.
        """
        delay = self._backoff
        last: str = "no attempt was made"

        for attempt in range(1, self.attempts + 1):
            try:
                answer = self._once(outgoing)
            except (error.URLError, TimeoutError, ConnectionError) as failure:
                last = f"{type(failure).__name__}: {failure}"
            else:
                if answer.status not in RETRYABLE_STATUSES:
                    return answer
                last = f"HTTP {answer.status}"

            _LOG.warning(
                "control plane unreachable (%s) on %s %s, attempt %d of %d",
                last,
                outgoing.method,
                outgoing.url,
                attempt,
                self.attempts,
            )
            if attempt < self.attempts:
                self._sleep(delay)
                delay *= 2

        raise TransportError(
            f"{outgoing.method} {outgoing.url} failed after {self.attempts} attempts: "
            f"{last}"
        )

    def _once(self, outgoing: ControlPlaneRequest) -> Response:
        """Send one request once.

        Args:
            outgoing: The request.

        Returns:
            The answer. An HTTP error status is an answer, not an exception.

        Raises:
            ValueError: If the URL is not http or https. ``urllib`` would otherwise open a
                ``file:`` URL from a misconfigured ``OURO_REST_URL``.
        """
        if not outgoing.url.startswith(("http://", "https://")):
            raise ValueError(
                f"the control plane is reached over http or https, not {outgoing.url!r}"
            )
        data = json.dumps(outgoing.json).encode("utf-8")
        prepared = request.Request(  # noqa: S310 - the URL is the configured control plane's
            outgoing.url,
            data=data,
            headers=outgoing.headers,
            method=outgoing.method,
        )

        try:
            with self._opener.open(prepared, timeout=self.timeout) as answer:
                return Response(answer.status, _parse(answer.read()))
        except error.HTTPError as refused:
            with refused:
                return Response(refused.code, _parse(refused.read()))


def _parse(raw: bytes) -> dict[str, Any]:
    """Parse a body as a JSON object.

    Args:
        raw: The bytes that arrived.

    Returns:
        The object, or ``{}`` for an empty body, a body that is not JSON, or JSON that is
        not an object.
    """
    try:
        parsed = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}
