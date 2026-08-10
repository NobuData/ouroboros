"""Liveness — the one route that answers without the internal key.

``/healthz`` exists for whatever is deciding whether to keep this container: the
``HEALTHCHECK`` in the engine's image (#53), the compose stack (#55), and a scheduler
after that. None of those carry the shared secret, which is why this path — and only
this path — is in the middleware's public set.

It is deliberately shallow. It reports that the process is up and answering HTTP, and
nothing else: it opens no connection, reads no configuration and calls nothing
downstream, so it cannot fail for a reason that has nothing to do with whether this
process should be restarted. *Readiness* — whether the dependencies a request needs are
reachable — is the REST layer's probe (#29), which asks the engine through
``/v0/status`` with the key.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

#: The liveness path, written once. :func:`ouroboros_engine.main.create_app` hands this
#: to :class:`ouroboros_engine.core.security.InternalKeyMiddleware` as its public set,
#: so the route and the exemption cannot drift apart into a probe that 401s.
HEALTH_PATH = "/healthz"

router = APIRouter()


class Liveness(BaseModel):
    """The body of a ``GET /healthz`` response.

    Attributes:
        status: Always ``"ok"``. A probe reads the status code; this is for the human
            who runs the same request by hand.
    """

    status: str = Field(examples=["ok"])


@router.get(
    HEALTH_PATH,
    summary="Liveness probe",
    response_model=Liveness,
    tags=["service"],
)
async def read_health() -> Liveness:
    """Report that the process is up and serving.

    Returns:
        A :class:`Liveness` carrying ``ok``. Reaching this function at all is the
        answer; the body is a courtesy.
    """
    return Liveness(status="ok")
