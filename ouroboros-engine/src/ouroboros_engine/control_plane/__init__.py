"""What this service may ask ``ouroboros-rest`` for — and what it is never given.

The engine-facing half of AD.3 (`#224 <https://github.com/NobuData/ouroboros/issues/224>`_),
decision **P3**: *a worker never holds a provider credential*. Two surfaces, and the
asymmetry between them is the whole of it — the control plane makes every cloud provider
call itself and streams the answer back, and a **local** provider is reached directly with
an address this package can ask for.

:mod:`~ouroboros_engine.control_plane.contract` mirrors the control plane's internal
OpenAPI document; :mod:`~ouroboros_engine.control_plane.client` builds the requests and
reads the answers. Neither opens a socket: the transport arrives with the executor that
needs one — AF.2 (`#235 <https://github.com/NobuData/ouroboros/issues/235>`_) — and the
client's own docstring says why that is a decision rather than an omission.
"""

from ouroboros_engine.control_plane.client import (
    ControlPlaneClient,
    ControlPlaneError,
    ControlPlaneRequest,
)
from ouroboros_engine.control_plane.contract import (
    INTERNAL_KEY_HEADER,
    INVOKE_MEDIA_TYPE,
    INVOKE_PATH,
    LEASE_PATH,
    InvokeRequest,
    Lease,
    LeaseRequest,
    RunContext,
)

__all__ = [
    "INTERNAL_KEY_HEADER",
    "INVOKE_MEDIA_TYPE",
    "INVOKE_PATH",
    "LEASE_PATH",
    "ControlPlaneClient",
    "ControlPlaneError",
    "ControlPlaneRequest",
    "InvokeRequest",
    "Lease",
    "LeaseRequest",
    "RunContext",
]
