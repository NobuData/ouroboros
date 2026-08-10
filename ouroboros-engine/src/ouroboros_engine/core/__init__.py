"""Process-wide concerns that are not routes.

Logging configuration lives here today. The internal-key middleware that makes every
``/v0`` route require ``X-Ouro-Internal-Key`` joins it in #51, and the engine's own
execution logic — the loops the product is named for — grows here rather than in
:mod:`ouroboros_engine.api`, which stays a thin HTTP surface over it.
"""
