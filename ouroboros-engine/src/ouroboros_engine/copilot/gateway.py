"""The socket under the control-plane client — the copilot is the first production sender.

:class:`~ouroboros_engine.control_plane.client.ControlPlaneClient` builds a complete request and
deliberately sends nothing; its docstring says whoever writes the first real caller brings the
transport, and chooses sync or async for it. This is that transport, and it chooses the standard
library: one ``POST``, the answer iterated line by line as it streams, no runtime dependency
added. A turn is served from a worker thread (Starlette iterates a synchronous generator in its
thread pool), so blocking here blocks no other request.

**A refusal is a named error, never a stack.** The gateway answers ``501
invocation_not_implemented`` until AF.2 (#235) lands, and that is the one refusal this module
knows by name: it becomes :data:`~ouroboros_engine.copilot.contract.GATEWAY_UNAVAILABLE`, the
honest state the conversation shows. Anything else the control plane refuses with is
:data:`~ouroboros_engine.copilot.contract.GATEWAY_REFUSED` carrying its code; a connection that
never got an answer is :data:`~ouroboros_engine.copilot.contract.GATEWAY_UNREACHABLE`.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from http import HTTPStatus
from typing import Protocol
from urllib import error, request

from ouroboros_engine.control_plane.client import ControlPlaneRequest
from ouroboros_engine.control_plane.contract import INVOCATION_NOT_IMPLEMENTED

from .contract import GATEWAY_REFUSED, GATEWAY_UNAVAILABLE, GATEWAY_UNREACHABLE

#: Seconds to wait for the gateway to start answering, and between two lines of its answer.
#: A model turn is slow; a gateway that has said nothing for this long is not going to.
DEFAULT_TIMEOUT_SECONDS = 120.0


class GatewayError(RuntimeError):
    """The gateway did not stream an answer.

    Attributes:
        code: One of the three gateway codes in :mod:`.contract`.
        message: A sentence for a person.
    """

    def __init__(self, code: str, message: str) -> None:
        """Name the failure.

        Args:
            code: The code.
            message: The sentence.
        """
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


class Gateway(Protocol):
    """Anything that can stream the answer to an invocation request. Tests substitute a fake."""

    def stream(self, outgoing: ControlPlaneRequest) -> Iterator[str]:
        """Send one request and yield the answer's lines.

        Args:
            outgoing: The request, complete with headers and body.

        Yields:
            Each line of the NDJSON answer.

        Raises:
            GatewayError: If there is no answer to stream.
        """
        ...


class UrllibGateway:
    """Sends an invocation with ``urllib`` and streams the answer back.

    Attributes:
        timeout: Seconds to wait for the answer to begin, and for each further read.
    """

    def __init__(self, *, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        """Make a gateway.

        Args:
            timeout: Seconds to wait for the answer to begin, and for each further read.
        """
        self.timeout = timeout
        # No proxy handler: the control plane is a service on the same network, and an
        # operator's HTTP proxy is not where an internal call should go.
        self._opener = request.build_opener(request.ProxyHandler({}))

    def stream(self, outgoing: ControlPlaneRequest) -> Iterator[str]:
        """Send one request and yield the answer's lines as they arrive.

        Args:
            outgoing: The request.

        Yields:
            Each line, decoded, newline included.

        Raises:
            GatewayError: ``gateway_unavailable`` on ``501 invocation_not_implemented``,
                ``gateway_refused`` on any other refusal, ``gateway_unreachable`` when no
                answer came at all.
        """
        body = json.dumps(outgoing.json).encode("utf-8")
        headers = {**outgoing.headers, "Content-Type": "application/json"}
        prepared = request.Request(  # noqa: S310 - the URL is the configured control plane's
            outgoing.url, data=body, headers=headers, method=outgoing.method
        )
        try:
            answer = self._opener.open(prepared, timeout=self.timeout)
        except error.HTTPError as refused:
            raise _refusal(refused) from refused
        except (error.URLError, TimeoutError, ConnectionError, OSError) as failure:
            raise GatewayError(
                GATEWAY_UNREACHABLE,
                "the invocation gateway could not be reached",
            ) from failure

        with answer:
            try:
                for raw in answer:
                    yield raw.decode("utf-8")
            except (TimeoutError, ConnectionError, OSError) as failure:
                raise GatewayError(
                    GATEWAY_UNREACHABLE,
                    "the invocation gateway stopped answering mid-stream",
                ) from failure


def _refusal(refused: error.HTTPError) -> GatewayError:
    """Name a non-2xx answer.

    Args:
        refused: What ``urllib`` raised.

    Returns:
        The error to raise, with the envelope's code where there was one.
    """
    code = ""
    message = ""
    try:
        envelope = json.loads(refused.read().decode("utf-8"))
        if isinstance(envelope, dict):
            code = str(envelope.get("code", ""))
            message = str(envelope.get("message", ""))
    except (ValueError, OSError):
        pass

    if (
        refused.code == HTTPStatus.NOT_IMPLEMENTED
        and code == INVOCATION_NOT_IMPLEMENTED
    ):
        return GatewayError(
            GATEWAY_UNAVAILABLE,
            "the invocation gateway is not available yet: nothing implements model "
            "invocation in this deployment (AF.2, #235)",
        )
    detail = code or f"HTTP {refused.code}"
    return GatewayError(
        GATEWAY_REFUSED,
        f"the invocation gateway refused the call ({detail})"
        + (f": {message}" if message else ""),
    )
