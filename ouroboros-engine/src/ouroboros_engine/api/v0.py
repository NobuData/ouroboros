"""``/v0`` — the versioned internal contract, and the rule that governs it.

Every route ``ouroboros-rest`` calls lives under this prefix, and the prefix is written
here rather than in each router so that "which version is this operation in" is one
answer instead of one per module.

**The version is in the path, and a breaking change is a new prefix.** ``/v0`` is
unstable by definition — it changes with the two services that share it, which deploy
together — so a field may be added to a response and a route may be added to the prefix
without ceremony. What may not happen inside it is a field disappearing, a field changing
type, or a route changing what it means: those are a ``/v1`` served alongside ``/v0``
until the gateway has moved, not an edit here. A stable ``/v1`` is a later promise; this
one is deliberately not it.

The contract itself is the specification: ``openapi.yaml`` at the module root is
authoritative, this service serves it verbatim, and ``ouroboros-rest``'s typed client
mirrors it (#35). The engine's test suite fails when the routes, the response models or
the version drift from what that document claims (``tests/test_openapi.py``), which is
what keeps a hand-written contract honest.

Two routers are under the prefix today: :mod:`ouroboros_engine.api.status`, which reports
which build is answering, and :mod:`ouroboros_engine.api.tasks`, which carries the
request/response exemplar the rest of the contract is written to.
"""

#: The versioned prefix every internal route lives under. See the module docstring for
#: what may and may not change inside it.
V0_PREFIX = "/v0"

#: How operations under the prefix are grouped in the specification. One tag, so a reader
#: of the document sees the versioned contract as one surface rather than as a list of
#: routers that happen to share a path.
V0_TAG = "v0"
