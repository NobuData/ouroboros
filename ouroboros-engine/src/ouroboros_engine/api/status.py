"""``/v0/status`` — which build is answering, and for how long it has been.

The first route under the versioned internal prefix, and the first one behind
:class:`ouroboros_engine.core.security.InternalKeyMiddleware`. It answers the two
questions that come up when the engine is suspected: *which version of it is this*, and
*is this the same process as a minute ago*. The contract the rest of ``/v0`` is built
to — request and error shapes, the compatibility rule for the prefix — is #52; this
module only claims the path.

``ouroboros-rest``'s readiness probe (#29) is the intended caller: it forwards the key,
and a ``200`` here is what lets it report the engine leg of its own readiness. A
``401`` there means the two sides hold different secrets, and REST reports that to a
client as a ``502`` — never a ``401``, because the internal boundary is not something a
browser gets to probe.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from ouroboros_engine import __version__

#: The versioned prefix every internal route lives under. ``/v0`` is unstable by
#: definition — it changes with the two services that share it, which deploy together —
#: and a stable ``/v1`` is a later promise, not this one.
V0_PREFIX = "/v0"

router = APIRouter(prefix=V0_PREFIX, tags=["v0"])


class ServiceStatus(BaseModel):
    """The body of a ``GET /v0/status`` response.

    Attributes:
        service: Distribution name of this service, constant across deployments.
        version: Installed version, read from package metadata — the same string
            ``GET /`` reports, so there is one source for "which build is this".
        uptime_seconds: Seconds since this process built its application. Small and
            shrinking across calls means something is restarting the container.
    """

    service: str = Field(examples=["ouroboros-engine"])
    version: str = Field(examples=["0.2.0"])
    uptime_seconds: float = Field(ge=0, examples=[1234.567])


@router.get(
    "/status", summary="Report version and uptime", response_model=ServiceStatus
)
async def read_status(request: Request) -> ServiceStatus:
    """Report the running build and how long it has been running.

    Args:
        request: The incoming request, used to reach the application's own state —
            configuration and the process stopwatch live there rather than in a module
            global, so a test can build an application with either of its own.

    Returns:
        A :class:`ServiceStatus` naming this service, its installed version, and its
        uptime rounded to milliseconds — a float with sixteen digits of noise on it
        reads as precision this does not have.
    """
    uptime = request.app.state.uptime.seconds()
    return ServiceStatus(
        service="ouroboros-engine",
        version=__version__,
        uptime_seconds=round(uptime, 3),
    )
