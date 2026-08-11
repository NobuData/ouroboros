"""HTTP surface — one module per router, registered by the application factory.

Four routers today: :mod:`ouroboros_engine.api.health` (``/healthz``, the one path served
without the internal key), :mod:`ouroboros_engine.api.root` (``GET /``),
:mod:`ouroboros_engine.api.status` (``/v0/status``) and
:mod:`ouroboros_engine.api.tasks` (``POST /v0/tasks/echo``). The prefix the last two share
and the compatibility rule that governs it are :mod:`ouroboros_engine.api.v0`, which is
where a router under ``/v0`` reads them from rather than restating them.

Adding a router is a module here plus one ``include_router`` line in
:func:`ouroboros_engine.main.create_app`. It is guarded the moment it is registered —
:class:`ouroboros_engine.core.security.InternalKeyMiddleware` runs before routing, so a
new path requires the key without anything having to be remembered.
"""
