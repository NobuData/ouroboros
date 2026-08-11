"""HTTP surface — one module per router, registered by the application factory.

Three routers today: :mod:`ouroboros_engine.api.health` (``/healthz``, the one path
served without the internal key), :mod:`ouroboros_engine.api.root` (``GET /``) and
:mod:`ouroboros_engine.api.status` (``/v0/status``). The rest of the versioned internal
contract under ``/v0`` is #52.

Adding a router is a module here plus one ``include_router`` line in
:func:`ouroboros_engine.main.create_app`. It is guarded the moment it is registered —
:class:`ouroboros_engine.core.security.InternalKeyMiddleware` runs before routing, so a
new path requires the key without anything having to be remembered.
"""
