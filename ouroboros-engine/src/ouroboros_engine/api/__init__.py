"""HTTP surface — one module per router, registered by the application factory.

:mod:`ouroboros_engine.api.root` is the only router the scaffold carries. Liveness
(``/healthz``) and the authenticated ``/v0/status`` arrive with #51, and the versioned
internal contract under ``/v0`` with #52; both are new modules here plus one
``include_router`` line in :func:`ouroboros_engine.main.create_app`.
"""
