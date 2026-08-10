"""The service identity route — what answers at ``/``.

It exists so the scaffold is verifiable: ``uv run dev`` followed by ``curl
localhost:8000`` says which service is listening and which version of it. It carries no
state, reads no configuration, and deliberately says nothing about health — liveness is
``/healthz`` in #51, which is what a container platform will probe.
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ouroboros_engine import __version__

router = APIRouter()


class ServiceIdentity(BaseModel):
    """The body of a ``GET /`` response.

    Attributes:
        service: Distribution name of this service, constant across deployments.
        version: Installed version, from package metadata.
    """

    service: str = Field(examples=["ouroboros-engine"])
    version: str = Field(examples=["0.1.0"])


@router.get(
    "/",
    summary="Identify the service",
    response_model=ServiceIdentity,
    tags=["service"],
)
async def read_root() -> ServiceIdentity:
    """Report which service and version is answering.

    Returns:
        A :class:`ServiceIdentity` naming this distribution and its installed version.
    """
    return ServiceIdentity(service="ouroboros-engine", version=__version__)
