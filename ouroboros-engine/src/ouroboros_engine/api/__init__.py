"""HTTP surface — one module per router, registered by the application factory.

Five routers today: :mod:`ouroboros_engine.api.health` (``/healthz``, the one path served
without the internal key), :mod:`ouroboros_engine.api.root` (``GET /``),
:mod:`ouroboros_engine.api.status` (``/v0/status``),
:mod:`ouroboros_engine.api.tasks` (``POST /v0/tasks/echo``) and
:mod:`ouroboros_engine.api.estimate` (``POST /v0/estimate``, the first operation that does
work rather than demonstrating the shape of it). The prefix the last three share and the
compatibility rule that governs it are :mod:`ouroboros_engine.api.v0`, which is where a
router under ``/v0`` reads them from rather than restating them.

Adding a router is a module here plus one ``include_router`` line in
:func:`ouroboros_engine.main.create_app`. It is guarded the moment it is registered —
:class:`ouroboros_engine.core.security.InternalKeyMiddleware` runs before routing, so a
new path requires the key without anything having to be remembered.
"""
