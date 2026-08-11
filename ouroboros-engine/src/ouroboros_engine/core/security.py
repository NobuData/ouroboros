"""The internal boundary: every route but liveness requires the shared secret.

``ouroboros-engine`` is reachable from ``ouroboros-rest`` and from nothing else
(``docs/ARCHITECTURE.md`` § 2.3). That is a deployment claim, and a deployment claim is
only as good as what happens when it turns out to be false — a misrouted port, a
service mesh rule that never applied, a developer's tunnel. So the service enforces it
itself: :class:`InternalKeyMiddleware` sits in front of the router and answers ``401``
to anything that does not carry the right value on ``X-Ouro-Internal-Key``.

Three properties are deliberate:

* **It runs before routing.** An unauthenticated request gets the same ``401`` whether
  the path exists or not, so the surface cannot be mapped by reading status codes.
* **The comparison is constant time** (:func:`hmac.compare_digest`), and a missing
  header takes the same path as a wrong one, so neither the presence of the header nor
  the length of the prefix that matched is readable from how long the answer took.
* **The rejection says nothing.** One constant body, no header echo, no path, no hint
  about what the key should look like. What an operator needs is in the log line
  instead, which stays inside the cluster.

Liveness is the single exception, because a container platform probes it before it has
any credentials to probe with — see :data:`ouroboros_engine.api.health.HEALTH_PATH`.
"""

import hmac
import logging
from collections.abc import Iterable

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from ouroboros_engine.core.errors import code_for_status, envelope

#: The header ``ouroboros-rest`` sends the shared secret on. Named in ``.env.example``
#: beside ``OURO_ENGINE_SHARED_SECRET`` and in ``docs/ARCHITECTURE.md`` § 2.3; both
#: sides of the call have to agree on it, so it is written down once, here.
INTERNAL_KEY_HEADER = "X-Ouro-Internal-Key"

#: What a rejection is called and what it says. Terse on purpose: the code is the part a
#: caller acts on, and the message is written for the person reading a gateway's log
#: rather than for whoever sent the request.
UNAUTHORIZED_CODE = code_for_status(401)
UNAUTHORIZED_MESSAGE = "Unauthorized."

#: The body of every rejection. Constant, so it cannot vary with the request that earned
#: it: no path, no header name, no "did you mean". Its shape is the error envelope every
#: other failure in this service carries (:mod:`ouroboros_engine.core.errors`), so the
#: gateway parses one shape whether a request was refused at the boundary or inside a
#: route — ``docs/ARCHITECTURE.md`` § 5.3.
UNAUTHORIZED_BODY = envelope(UNAUTHORIZED_CODE, UNAUTHORIZED_MESSAGE)

_logger = logging.getLogger(__name__)


class InternalKeyMiddleware:
    """ASGI middleware requiring the internal shared secret on every non-public path.

    Written against the ASGI interface rather than Starlette's ``BaseHTTPMiddleware``
    because this runs on every request and needs none of what that class buys: there is
    no request body to read, no response to rewrite, and no reason to spend a task group
    per call.

    Attributes:
        app: The application this wraps — the next thing in the ASGI chain.
    """

    def __init__(
        self, app: ASGIApp, *, secret: str, public_paths: Iterable[str]
    ) -> None:
        """Wrap an application.

        Args:
            app: The ASGI application to guard.
            secret: The value ``X-Ouro-Internal-Key`` must carry, from
                :attr:`ouroboros_engine.settings.Settings.shared_secret`. Encoded once
                here so no work happens per request that could vary with the input.
            public_paths: Exact paths served without the key. Matched exactly rather
                than by prefix, so a public ``/healthz`` cannot be widened into a public
                ``/healthz/../v0/status`` by a client that controls the rest of the URL.
        """
        self.app = app
        self._secret = secret.encode("utf-8")
        self._public_paths = frozenset(public_paths)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """Answer the request, or reject it before the router ever sees it.

        Args:
            scope: The ASGI connection scope.
            receive: The ASGI receive channel.
            send: The ASGI send channel.
        """
        # Lifespan is the server starting and stopping, not a caller; websockets are a
        # protocol this service does not speak, and a router with no websocket route
        # closes them itself. Only HTTP is a surface worth guarding.
        if scope["type"] != "http" or self._is_authorised(scope):
            await self.app(scope, receive, send)
            return

        response = JSONResponse(UNAUTHORIZED_BODY, status_code=401)
        await response(scope, receive, send)

    def _is_authorised(self, scope: Scope) -> bool:
        """Decide whether a request may reach the router.

        Args:
            scope: The ASGI connection scope of an HTTP request.

        Returns:
            ``True`` if the path is public or the request carried the right key.
        """
        path = scope["path"]
        if path in self._public_paths:
            return True

        # `.get` rather than a membership test: a missing header becomes an empty
        # candidate and is compared like any wrong one, so absence and mismatch cost the
        # same. The value is never logged — it is a credential, right or wrong.
        provided = Headers(scope=scope).get(INTERNAL_KEY_HEADER, "")
        if hmac.compare_digest(provided.encode("utf-8"), self._secret):
            return True

        # The path is safe to log: this record stays inside the cluster, and an operator
        # chasing a misconfigured caller needs to know what it was reaching for.
        _logger.warning(
            "rejected an internal request without a valid key",
            extra={
                "path": path,
                "method": scope.get("method", ""),
                "key_present": bool(provided),
            },
        )
        return False
