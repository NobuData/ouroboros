"""Process-wide concerns that are not routes.

Logging configuration (:mod:`ouroboros_engine.core.logging`), the guard that requires
``X-Ouro-Internal-Key`` on every path but liveness
(:mod:`ouroboros_engine.core.security`), and the process stopwatch ``/v0/status``
reports from (:mod:`ouroboros_engine.core.uptime`). The engine's own execution logic —
the loops the product is named for — grows here rather than in
:mod:`ouroboros_engine.api`, which stays a thin HTTP surface over it.
"""
